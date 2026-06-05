// GET /api/chairops/cron/gmail-import
// Daily cron — scans Gmail for StarThing XLSX emails → auto-imports.
// Protected by CRON_SECRET (Authorization: Bearer <secret>).
// Schedule: 1:00 UTC = 08:00 Thailand. CEO 2026-06-05.

import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/chairops/auth/cron-secret";
import { runWithMonitor } from "@/lib/cron/runner";
import { autoIngestAllOrgs } from "@/lib/chairops/email/auto-ingest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120; // 2 min ceiling (Vercel Pro) — allows up to ~20 XLSX files

export async function GET(request: NextRequest) {
  const guard = requireCronSecret(request);
  if (guard) return guard;

  try {
    return await runWithMonitor(
      "chairops-gmail-import",
      async () => {
        const t0 = Date.now();
        const results = await autoIngestAllOrgs();

        const totalCommitted = results.reduce((s, r) => s + r.totalCommitted, 0);
        const errors = results.filter((r) => r.error).map((r) => ({
          orgId: r.orgId,
          error: r.error,
        }));

        return NextResponse.json({
          ok: true,
          orgs: results.length,
          totalCommitted,
          errors: errors.length > 0 ? errors : undefined,
          ms: Date.now() - t0,
        });
      },
      { req: request, allowMultipleRunsPerDay: true },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
