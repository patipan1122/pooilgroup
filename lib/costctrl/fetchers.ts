// CostCtrl provider fetchers — pull current MTD usage from each provider API.
// Each fetcher returns an array of metric points; the sync orchestrator writes
// them into cost_snapshot. Fetcher failure is non-fatal — sync logs status.

import { decryptCredential } from "./crypto";

export type MetricPoint = {
  metric: string;
  unit: string;
  value: number;
  costUsd: number;
  raw?: unknown;
};

export type FetcherResult =
  | { ok: true; points: MetricPoint[] }
  | { ok: false; error: string };

// ── Vercel ─────────────────────────────────────────────────
// Token scope: "Read Access" team-scoped works for /v1/usage endpoint.
// Docs: https://vercel.com/docs/rest-api/endpoints/usage
type VercelCred = { token: string; teamId?: string };

export async function fetchVercel(cred: VercelCred): Promise<FetcherResult> {
  try {
    const url = new URL("https://api.vercel.com/v1/usage");
    if (cred.teamId) url.searchParams.set("teamId", cred.teamId);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${cred.token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `vercel ${res.status}: ${body.slice(0, 200)}` };
    }
    const json: { usage?: Record<string, { used?: number }>; total?: number } = await res.json();
    const points: MetricPoint[] = [];
    const usage = json.usage ?? {};
    if (usage.bandwidth?.used != null) points.push({ metric: "bandwidth_gb", unit: "GB", value: usage.bandwidth.used / 1024 / 1024 / 1024, costUsd: 0 });
    if (usage.functionInvocations?.used != null) points.push({ metric: "function_invocations", unit: "count", value: usage.functionInvocations.used, costUsd: 0 });
    if (usage.buildMinutes?.used != null) points.push({ metric: "build_minutes", unit: "min", value: usage.buildMinutes.used, costUsd: 0 });
    if (usage.edgeRequests?.used != null) points.push({ metric: "edge_requests", unit: "count", value: usage.edgeRequests.used, costUsd: 0 });
    if (json.total != null) points.push({ metric: "cost_usd", unit: "USD", value: json.total, costUsd: json.total });
    return { ok: true, points };
  } catch (e) {
    return { ok: false, error: `vercel fetch: ${(e as Error).message}` };
  }
}

// ── Supabase ───────────────────────────────────────────────
// Management API: https://api.supabase.com/v1/projects/{ref}/usage
type SupabaseCred = { token: string; projectRef: string };

export async function fetchSupabase(cred: SupabaseCred): Promise<FetcherResult> {
  try {
    const res = await fetch(`https://api.supabase.com/v1/projects/${cred.projectRef}/usage`, {
      headers: { Authorization: `Bearer ${cred.token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `supabase ${res.status}: ${body.slice(0, 200)}` };
    }
    const json: Record<string, unknown> = await res.json();
    const points: MetricPoint[] = [];
    const db = (json.db_size as { current?: number } | undefined)?.current;
    if (db != null) points.push({ metric: "db_size_mb", unit: "MB", value: db / 1024 / 1024, costUsd: 0 });
    const egress = (json.egress as { current?: number } | undefined)?.current;
    if (egress != null) points.push({ metric: "egress_gb", unit: "GB", value: egress / 1024 / 1024 / 1024, costUsd: 0 });
    const mau = (json.mau as { current?: number } | undefined)?.current;
    if (mau != null) points.push({ metric: "mau", unit: "count", value: mau, costUsd: 0 });
    return { ok: true, points };
  } catch (e) {
    return { ok: false, error: `supabase fetch: ${(e as Error).message}` };
  }
}

// ── Cloudflare R2 ──────────────────────────────────────────
type R2Cred = { token: string; accountId: string; bucket?: string };

export async function fetchR2(cred: R2Cred): Promise<FetcherResult> {
  try {
    // Cloudflare Analytics API for R2 storage/operations.
    // Note: R2 doesn't expose a single /usage endpoint · we use the GraphQL analytics API.
    // For MVP we fall back to "manual" if endpoint shape changes.
    const query = `query {
      viewer { accounts(filter: { accountTag: "${cred.accountId}" }) {
        r2StorageAdaptiveGroups(limit: 1, filter: { datetime_geq: "${new Date(Date.now() - 86400_000).toISOString()}" }) {
          sum { payloadSize objectCount }
        }
      } }
    }`;
    const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${cred.token}` },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `r2 ${res.status}: ${body.slice(0, 200)}` };
    }
    const json: { data?: { viewer?: { accounts?: Array<{ r2StorageAdaptiveGroups?: Array<{ sum?: { payloadSize?: number; objectCount?: number } }> }> } } } =
      await res.json();
    const sums = json.data?.viewer?.accounts?.[0]?.r2StorageAdaptiveGroups?.[0]?.sum;
    const points: MetricPoint[] = [];
    if (sums?.payloadSize != null) {
      points.push({ metric: "storage_gb", unit: "GB", value: sums.payloadSize / 1024 / 1024 / 1024, costUsd: 0 });
    }
    if (sums?.objectCount != null) {
      points.push({ metric: "object_count", unit: "count", value: sums.objectCount, costUsd: 0 });
    }
    return { ok: true, points };
  } catch (e) {
    return { ok: false, error: `r2 fetch: ${(e as Error).message}` };
  }
}

// ── Credential loader ──────────────────────────────────────
export function parseCredentialAsJson(plaintext: string): Record<string, string> | null {
  try {
    const obj = JSON.parse(plaintext);
    return typeof obj === "object" && obj ? (obj as Record<string, string>) : null;
  } catch {
    return null;
  }
}

export function decryptToObject(ciphertext: string): Record<string, string> | null {
  const plain = decryptCredential(ciphertext);
  if (!plain) return null;
  // Support both formats: pure token string OR JSON {token, teamId/projectRef/...}
  const asObj = parseCredentialAsJson(plain);
  if (asObj) return asObj;
  return { token: plain };
}
