// Daily inbox summary cron. Builds a per-business stats summary (free, no AI),
// stores it (web-visible), and pushes the ChairOps summary to the CEO LINE group.
// Scheduled in vercel.json. Auth via CRON_SECRET (reuses chairops guard).

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCronSecret } from "@/lib/chairops/auth/cron-secret";
import { buildAndStoreDailySummary } from "@/lib/inbox/summary";
import { getBotSettings } from "@/lib/inbox/bot/settings";
import { businessLabel } from "@/lib/inbox/business";
import { notifyChannel } from "@/lib/chairops/line/messaging";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const guard = requireCronSecret(req);
  if (guard) return guard;

  const channels = await prisma.inboxChannel.findMany({
    select: { orgId: true, businessTag: true },
  });

  const seen = new Set<string>();
  const pairs: { orgId: string; businessTag: string }[] = [];
  for (const c of channels) {
    const tag = c.businessTag ?? "other";
    const key = `${c.orgId}::${tag}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ orgId: c.orgId, businessTag: tag });
  }

  const results: Record<string, unknown>[] = [];
  for (const p of pairs) {
    try {
      const settings = await getBotSettings(p.orgId, p.businessTag);
      if (!settings.dailySummary) {
        results.push({ ...p, skipped: true });
        continue;
      }
      const out = await buildAndStoreDailySummary(p.orgId, p.businessTag, businessLabel(p.businessTag));
      let pushed = false;
      if (out && p.businessTag === "chairops") {
        const r = await notifyChannel("ceo", out.text);
        pushed = r.ok;
      }
      results.push({ ...p, ok: !!out, pushed });
    } catch (e) {
      console.error("[inbox daily-summary]", p, e);
      results.push({ ...p, ok: false, error: (e as Error).message });
    }
  }

  return NextResponse.json({ ok: true, count: pairs.length, results });
}
