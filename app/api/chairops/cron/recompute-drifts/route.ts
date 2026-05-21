// GET /api/cron/recompute-drifts
// Protected by CRON_SECRET. Designed to be hit by Vercel Cron every 30 min.
// Recomputes per-branch drift and emits SHORTAGE / MISSED_COLLECTION alerts.
import { NextRequest, NextResponse } from "next/server";
import { evaluateAndEmitAlerts } from "@/lib/chairops/reconcile/alerts";
import { requireCronSecret } from "@/lib/chairops/auth/cron-secret";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const guard = requireCronSecret(request);
  if (guard) return guard;

  const t0 = Date.now();
  try {
    const { snapshots, emitted } = await evaluateAndEmitAlerts();
    return NextResponse.json({
      ok: true,
      snapshots: snapshots.length,
      emitted: emitted.length,
      ms: Date.now() - t0,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json(
      { ok: false, error: msg, ms: Date.now() - t0 },
      { status: 500 }
    );
  }
}
