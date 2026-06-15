// GET /api/ledger/cron/scb-statement-import
// Daily cron — scans connected Gmail mailboxes for SCB Business Anywhere
// "Historical Statement" ZIP emails → decrypts → auto-imports into bank-recon.
// Protected by CRON_SECRET (Authorization: Bearer <secret>).
// Schedule: 2:00 UTC = 09:00 Thailand — SCB sends ~07:00; gives the mail time to land.

import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/chairops/auth/cron-secret";
import { runWithMonitor } from "@/lib/cron/runner";
import { autoImportScbStatements } from "@/lib/ledger/scb-statement-ingest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120; // 2 min ceiling (Vercel Pro)

export async function GET(request: NextRequest) {
  const guard = requireCronSecret(request);
  if (guard) return guard;

  try {
    return await runWithMonitor(
      "ledger-scb-statement-import",
      async () => {
        const t0 = Date.now();
        const results = await autoImportScbStatements();

        const importedMessages = results.reduce((s, r) => s + r.importedMessages, 0);
        const insertedRows = results.reduce((s, r) => s + r.insertedRows, 0);
        const batches = results.reduce((s, r) => s + r.batches, 0);
        const errors = results
          .filter((r) => r.error)
          .map((r) => ({ mailbox: r.gmailEmail, error: r.error }));

        return NextResponse.json({
          ok: true,
          mailboxes: results.length,
          importedMessages,
          batches,
          insertedRows,
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
