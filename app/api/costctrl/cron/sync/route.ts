// GET /api/costctrl/cron/sync
// Runs daily at 02:00 ICT (vercel.json "0 19 * * *" = 19:00 UTC).
// Pulls latest MTD metrics from every enabled provider + aggregates
// ai_usage for Anthropic/Gemini + evaluates alert rules + pushes LINE
// to CEO when thresholds cross.
//
// Manual invoke (smoke test):
//   curl -H "Authorization: Bearer $CRON_SECRET" \
//        https://pooilgroup.vercel.app/api/costctrl/cron/sync

import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/chairops/auth/cron-secret";
import { runFullSync } from "@/lib/costctrl/sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const guard = requireCronSecret(request);
  if (guard) return guard;
  try {
    const result = await runFullSync();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    console.error("[costctrl cron sync] failed", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
