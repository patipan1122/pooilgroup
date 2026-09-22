// GET /api/cron/recompute-drifts
// Protected by CRON_SECRET.
// 2026-09-20 bigsolvebug: this comment used to say "every 30 min" — it
// doesn't; vercel.json schedules it once daily ("0 22 * * *"). This is the
// only guaranteed-to-run backstop for the drift/self-heal work that the
// pos-ingest commit path also tries to run inline via `after()` — if that
// inline attempt is ever slow/interrupted, a branch can go up to ~24h
// before this cron catches it up. Flag to CEO if that gap is too wide;
// changing the schedule is a Vercel-invocation-cost decision, not a
// mechanical fix (see docs/AUDIT_chairops_2026-06-15.md CO-BE-02).
// Recomputes per-branch drift and emits SHORTAGE / MISSED_COLLECTION alerts.
//
// BIGFEATURE §2.10 — wrapped in runWithMonitor so failures show up in
// `cron_runs` and trigger a Telegram alert (no more silent ChairOps).
// `allowMultipleRunsPerDay: true` kept for safety in case the schedule is
// ever tightened later — harmless no-op at the current once-daily cadence.
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
