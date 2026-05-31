// CostCtrl sync orchestrator — pulls metrics from every enabled provider
// + aggregates ai_usage table for Anthropic/Gemini · writes cost_snapshot rows.
// Runs on cron at 02:00 ICT daily OR via manual "Sync now" button.

import { prisma } from "@/lib/prisma";
import {
  fetchVercel,
  fetchSupabase,
  fetchR2,
  decryptToObject,
  type FetcherResult,
  type MetricPoint,
} from "./fetchers";
import { aiUsageMtdTotalsByProvider } from "./data";
import { evaluateAlerts } from "./alerts";

function firstOfMonth(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

async function writeSnapshots(
  providerId: string,
  month: Date,
  points: MetricPoint[],
  source: "api" | "aggregated" | "manual",
): Promise<number> {
  if (!points.length) return 0;
  let n = 0;
  for (const p of points) {
    await prisma.costSnapshot.create({
      data: {
        providerId,
        periodMonth: month,
        metric: p.metric,
        unit: p.unit,
        value: p.value,
        costUsd: p.costUsd,
        raw: p.raw == null ? undefined : (p.raw as object),
        source,
      },
    });
    n++;
  }
  return n;
}

async function syncProvider(slug: string, month: Date): Promise<{ slug: string; status: string; newRows: number }> {
  const provider = await prisma.costProvider.findUnique({
    where: { slug },
    include: { credentials: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!provider || !provider.enabled) {
    return { slug, status: "skipped", newRows: 0 };
  }

  // 1. Anthropic + Gemini come from ai_usage table (always — we own the data)
  if (slug === "anthropic" || slug === "gemini") {
    const totals = await aiUsageMtdTotalsByProvider();
    const row = totals.find((t) => t.provider === slug);
    const points: MetricPoint[] = row
      ? [
          { metric: "tokens_in",  unit: "tokens", value: row.tokensIn,  costUsd: 0 },
          { metric: "tokens_out", unit: "tokens", value: row.tokensOut, costUsd: 0 },
          { metric: "calls",      unit: "count",  value: row.calls,     costUsd: 0 },
          { metric: "cost_usd",   unit: "USD",    value: row.costUsd,   costUsd: row.costUsd },
        ]
      : [];
    const newRows = await writeSnapshots(provider.id, month, points, "aggregated");
    await prisma.costProvider.update({
      where: { id: provider.id },
      data: { lastSyncAt: new Date(), lastSyncStatus: points.length ? "ok" : "no-data" },
    });
    return { slug, status: points.length ? "ok" : "no-data", newRows };
  }

  // 2. Infra providers — need API credential
  const cred = provider.credentials[0];
  if (!cred) {
    await prisma.costProvider.update({
      where: { id: provider.id },
      data: { lastSyncStatus: "no-credential" },
    });
    return { slug, status: "no-credential", newRows: 0 };
  }

  const obj = decryptToObject(cred.ciphertext);
  if (!obj || !obj.token) {
    await prisma.costProvider.update({
      where: { id: provider.id },
      data: { lastSyncStatus: "bad-credential" },
    });
    return { slug, status: "bad-credential", newRows: 0 };
  }

  let result: FetcherResult;
  if (slug === "vercel") {
    result = await fetchVercel({ token: obj.token, teamId: obj.teamId });
  } else if (slug === "supabase") {
    result = await fetchSupabase({ token: obj.token, projectRef: obj.projectRef ?? "" });
  } else if (slug === "r2") {
    result = await fetchR2({ token: obj.token, accountId: obj.accountId ?? "", bucket: obj.bucket });
  } else {
    result = { ok: false, error: `no fetcher for provider ${slug}` };
  }

  if (!result.ok) {
    await prisma.costProvider.update({
      where: { id: provider.id },
      data: { lastSyncAt: new Date(), lastSyncStatus: `error: ${result.error}` },
    });
    await prisma.costApiCredential.update({
      where: { id: cred.id },
      data: { lastError: result.error, lastUsedAt: new Date() },
    });
    return { slug, status: `error: ${result.error.slice(0, 80)}`, newRows: 0 };
  }

  const newRows = await writeSnapshots(provider.id, month, result.points, "api");
  await prisma.costProvider.update({
    where: { id: provider.id },
    data: { lastSyncAt: new Date(), lastSyncStatus: "ok" },
  });
  await prisma.costApiCredential.update({
    where: { id: cred.id },
    data: { lastUsedAt: new Date(), lastError: null },
  });
  return { slug, status: "ok", newRows };
}

export async function runFullSync(): Promise<{
  startedAt: string;
  finishedAt: string;
  totalNewRows: number;
  providers: Array<{ slug: string; status: string; newRows: number }>;
  alertsTriggered: number;
}> {
  const startedAt = new Date();
  const month = firstOfMonth(startedAt);

  // 5 providers — sequential to keep cron under 60s budget
  const order = ["anthropic", "gemini", "vercel", "supabase", "r2"];
  const results: Array<{ slug: string; status: string; newRows: number }> = [];
  for (const slug of order) {
    try {
      results.push(await syncProvider(slug, month));
    } catch (e) {
      results.push({ slug, status: `crash: ${(e as Error).message.slice(0, 80)}`, newRows: 0 });
    }
  }

  // Evaluate alert rules after fresh snapshots land
  const alertsTriggered = await evaluateAlerts();

  return {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    totalNewRows: results.reduce((s, r) => s + r.newRows, 0),
    providers: results,
    alertsTriggered,
  };
}

export async function runProviderSync(slug: string): Promise<{ slug: string; status: string; newRows: number }> {
  const month = firstOfMonth();
  return syncProvider(slug, month);
}
