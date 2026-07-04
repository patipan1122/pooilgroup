// GET /api/cron/recompute-drifts
// Protected by CRON_SECRET. Designed to be hit by Vercel Cron every 30 min.
// Recomputes per-branch drift and emits SHORTAGE / MISSED_COLLECTION alerts.
//
// BIGFEATURE §2.10 — wrapped in runWithMonitor so failures show up in
// `cron_runs` and trigger a Telegram alert (no more silent ChairOps).
// `allowMultipleRunsPerDay: true` because Vercel Cron hits this every 30 min.
import { NextRequest, NextResponse } from "next/server";
import { evaluateAndEmitAlerts } from "@/lib/chairops/reconcile/alerts";
import { syncBranchDailyFromPosDaily } from "@/lib/chairops/reconcile/branch-daily-sync";
import { requireCronSecret } from "@/lib/chairops/auth/cron-secret";
import { runWithMonitor } from "@/lib/cron/runner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const guard = requireCronSecret(request);
  if (guard) return guard;

  try {
    return await runWithMonitor(
      "chairops-recompute-drifts",
      async () => {
        const t0 = Date.now();
        // 2026-07-04 · self-heal branch_daily_revenue from ChairopsPosDaily BEFORE
        // recomputing drift, so drift is never computed on a silently-dropped
        // branch rollup again. Heals 0 rows in steady state; > 0 = a gap existed.
        const healed = await syncBranchDailyFromPosDaily();
        if (healed > 0) {
          console.warn(
            `[branch-daily-sync] healed ${healed} missing branch_daily_revenue rows from ChairopsPosDaily — an importer storeName mismatch had silently dropped them`,
          );
        }
        const { snapshots, emitted } = await evaluateAndEmitAlerts();
        return NextResponse.json({
          ok: true,
          branchDailyHealed: healed,
          snapshots: snapshots.length,
          emitted: emitted.length,
          ms: Date.now() - t0,
        });
      },
      { req: request, allowMultipleRunsPerDay: true },
    );
  } catch (e) {
    // runWithMonitor has already recorded the failure + sent Telegram alert;
    // we still return the original {ok:false,error} JSON shape for callers.
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
