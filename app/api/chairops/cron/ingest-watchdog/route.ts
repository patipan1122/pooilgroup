// GET /api/chairops/cron/ingest-watchdog
// Daily 09:00 BKK (02:00 UTC) · runs ALL four BF2 detectors:
//   D1 POS_NOT_INGESTED — every branch missing fresh ChairopsBranchDailyRevenue
//   D2 CHAIR_OFFLINE    — every chair with no PosDaily activity (skips POS-blocked branches)
//   D3 CLEANLINESS_FAIL — cron backstop for last-24h FAIL reports (primary path is event-hook)
//   D4 REPAIR_OVERDUE   — every open damage ticket past SLA
//
// Detectors return NewAlert[] without writing · this orchestrator handles:
//   • idempotency (already done inside detectors via findOpenAlert)
//   • DB create
//   • fatigue-guarded LINE dispatch per channel
//   • runWithMonitor + cron_runs audit
//
// Vercel Hobby cron limit: this route adds the ONLY new entry to vercel.json
// (single daily run, well within the daily budget per
// [[vercel-hobby-cron-block-2026-05-30]]).
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCronSecret } from "@/lib/chairops/auth/cron-secret";
import { runWithMonitor } from "@/lib/cron/runner";
import type { Prisma } from "@/lib/generated/prisma/client";
import {
  fatigueCheck,
  formatLineMessage,
  notifyChannel,
  type NewAlert,
} from "@/lib/chairops/alerts/_shared";
import { detectPosNotIngested } from "@/lib/chairops/alerts/detectors/pos-not-ingested";
import { detectChairOffline } from "@/lib/chairops/alerts/detectors/chair-offline";
import { detectCleanlinessFail } from "@/lib/chairops/alerts/detectors/cleanliness-fail";
import { detectRepairOverdue } from "@/lib/chairops/alerts/detectors/repair-overdue";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const guard = requireCronSecret(request);
  if (guard) return guard;
  try {
    return await runWithMonitor(
      "chairops-ingest-watchdog",
      async () => watchdogHandler(),
      { req: request },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

interface DetectorOutcome {
  name: string;
  proposed: number;
  created: number;
  notified: number;
  errors: string[];
}

async function watchdogHandler(): Promise<NextResponse> {
  const outcomes: DetectorOutcome[] = [];

  // Run sequentially so we can use D1's results to gate D2 (avoids
  // double-alerting when POS itself is missing). The detectors themselves
  // also check OPEN POS_NOT_INGESTED to skip blocked branches.
  outcomes.push(await runDetector("pos-not-ingested", detectPosNotIngested));
  outcomes.push(await runDetector("chair-offline", detectChairOffline));
  outcomes.push(await runDetector("cleanliness-fail-backstop", detectCleanlinessFail));
  outcomes.push(await runDetector("repair-overdue", detectRepairOverdue));

  const totals = outcomes.reduce(
    (acc, o) => ({
      proposed: acc.proposed + o.proposed,
      created: acc.created + o.created,
      notified: acc.notified + o.notified,
      errors: acc.errors + o.errors.length,
    }),
    { proposed: 0, created: 0, notified: 0, errors: 0 },
  );

  return NextResponse.json({ ok: true, ...totals, detectors: outcomes });
}

async function runDetector(
  name: string,
  detector: (orgId?: string) => Promise<NewAlert[]>,
): Promise<DetectorOutcome> {
  const outcome: DetectorOutcome = { name, proposed: 0, created: 0, notified: 0, errors: [] };
  try {
    const proposed = await detector();
    outcome.proposed = proposed.length;
    for (const alert of proposed) {
      try {
        const row = await prisma.chairopsAlert.create({
          data: {
            orgId: alert.orgId,
            branchId: alert.branchId,
            kind: alert.kind,
            level: alert.level,
            title: alert.title,
            message: alert.message,
            contextJson: alert.contextJson as Prisma.InputJsonValue,
          },
        });
        outcome.created++;
        const line = formatLineMessage(alert);
        for (const ch of alert.channels) {
          if (!fatigueCheck(ch)) continue;
          const result = await notifyChannel(ch, line);
          if (result.ok) outcome.notified++;
        }
        // 1-line audit so the cron_runs log can correlate to alert ids.
        if (process.env.NODE_ENV !== "production") {
          console.log(`[bf2:${name}] emitted ${row.id} · ${row.kind}/${row.level}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        outcome.errors.push(`${alert.kind}:${alert.branchId ?? "org"}: ${msg}`);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    outcome.errors.push(`detector-fatal: ${msg}`);
  }
  return outcome;
}
