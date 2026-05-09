// Cron runner helper — adds idempotency + monitoring + Telegram alerts.
//
// Usage:
//   export const GET = withCronGuard("morning-brief", async (ctx) => {
//     // your cron logic
//     return { sent: 5 };
//   });
//
// Provides:
//   - CRON_SECRET verification (Authorization: Bearer)
//   - Idempotency: skip if already ran today (per cron_name × run_date)
//   - Audit log (cron_runs table)
//   - Telegram alert on failure (sendToAdminChat)

import { NextResponse, type NextRequest } from "next/server";
import { adminClient } from "@/lib/db/server";
import { sendToAdminChat } from "@/lib/telegram/send";
import { formatInTimeZone } from "date-fns-tz";

const TZ = process.env.NEXT_PUBLIC_APP_TIMEZONE || "Asia/Bangkok";

interface MonitorOpts {
  /** Skip idempotency check (allow > 1 run per day) — e.g. deadline-reminder runs hourly */
  allowMultipleRunsPerDay?: boolean;
}

/**
 * Lightweight monitor wrapper for existing cron handlers.
 * Use when you already have GET/POST handlers with their own auth check.
 *
 * Adds:
 *   - Idempotency check (per cron_name × run_date) — skip if already succeeded today
 *   - cron_runs row insert/update
 *   - Telegram alert on uncaught error
 *   - ?force=1 query param to bypass idempotency (admin debugging)
 *
 * Usage:
 *   export async function GET(req) {
 *     // ... auth check ...
 *     return runWithMonitor("morning-brief", () => myHandler(), { req });
 *   }
 */
export async function runWithMonitor<T>(
  cronName: string,
  handler: () => Promise<T>,
  opts: MonitorOpts & { req?: NextRequest } = {},
): Promise<T> {
  const startedAt = new Date();
  const runDate = formatInTimeZone(startedAt, TZ, "yyyy-MM-dd");
  const admin = adminClient();

  // ?force=1 bypasses idempotency (manual re-trigger by admin)
  const forceRun = opts.req?.nextUrl?.searchParams?.get("force") === "1";

  // Idempotency: skip if today's run already succeeded
  if (!opts.allowMultipleRunsPerDay && !forceRun) {
    const { data: prior } = await admin
      .from("cron_runs")
      .select("id")
      .eq("cron_name", cronName)
      .eq("run_date", runDate)
      .eq("status", "success")
      .maybeSingle();
    if (prior) {
      return NextResponse.json({
        ok: true,
        skipped: "already_ran_today",
        cron: cronName,
        run_date: runDate,
      }) as unknown as T;
    }
  }

  // Best-effort row insert (fall through if duplicate)
  let runId: string | null = null;
  const { data: inserted } = await admin
    .from("cron_runs")
    .insert({
      cron_name: cronName,
      run_date: runDate,
      status: "running",
      started_at: startedAt.toISOString(),
      payload: {},
    })
    .select("id")
    .single();
  runId = inserted?.id ?? null;

  let result: T;
  let errorMessage: string | null = null;
  try {
    result = await handler();
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[cron/${cronName}] failed`, err);
    if (runId) {
      await admin
        .from("cron_runs")
        .update({
          status: "failed",
          duration_ms: Date.now() - startedAt.getTime(),
          error_message: errorMessage,
          completed_at: new Date().toISOString(),
        })
        .eq("id", runId);
    }
    try {
      await sendToAdminChat({
        text:
          `🚨 <b>Cron failed: ${cronName}</b>\n` +
          `<i>Date:</i> ${runDate}\n` +
          `<i>Error:</i> ${errorMessage.slice(0, 500)}`,
        parseMode: "HTML",
      });
    } catch { /* ignore */ }
    throw err;
  }

  // Success — update row
  if (runId) {
    await admin
      .from("cron_runs")
      .update({
        status: "success",
        duration_ms: Date.now() - startedAt.getTime(),
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId);
  }
  return result;
}


interface CronContext {
  startedAt: Date;
  runDate: string; // YYYY-MM-DD in TZ
  forceRun: boolean;
}

interface CronOptions {
  /**
   * Skip the idempotency check (allow multiple runs per day).
   * Useful for cron jobs that intentionally fire many times (e.g. deadline-reminder runs hourly).
   */
  allowMultipleRunsPerDay?: boolean;
}

export function withCronGuard<T = unknown>(
  cronName: string,
  handler: (ctx: CronContext) => Promise<T>,
  opts: CronOptions = {},
) {
  return async function GET(req: NextRequest): Promise<NextResponse> {
    // 1. Auth — verify CRON_SECRET
    const auth = req.headers.get("authorization");
    const expected = `Bearer ${process.env.CRON_SECRET}`;
    if (!process.env.CRON_SECRET) {
      console.error(`[cron/${cronName}] CRON_SECRET not set`);
      return NextResponse.json(
        { error: "Cron not configured" },
        { status: 503 },
      );
    }
    if (auth !== expected) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const startedAt = new Date();
    const runDate = formatInTimeZone(startedAt, TZ, "yyyy-MM-dd");
    const forceRun = req.nextUrl.searchParams.get("force") === "1";
    const admin = adminClient();

    // 2. Idempotency — skip if already ran successfully today
    if (!opts.allowMultipleRunsPerDay && !forceRun) {
      const { data: prior } = await admin
        .from("cron_runs")
        .select("id, status")
        .eq("cron_name", cronName)
        .eq("run_date", runDate)
        .eq("status", "success")
        .maybeSingle();
      if (prior) {
        return NextResponse.json({
          ok: true,
          skipped: "already_ran_today",
          run_date: runDate,
        });
      }
    }

    // 3. Insert pending row (best-effort lock)
    let runId: string | null = null;
    try {
      const { data: inserted } = await admin
        .from("cron_runs")
        .insert({
          cron_name: cronName,
          run_date: runDate,
          status: "running",
          started_at: startedAt.toISOString(),
          payload: {},
        })
        .select("id")
        .single();
      runId = inserted?.id ?? null;
    } catch {
      // Already exists for today (UNIQUE constraint) — proceed if forceRun else skip
      if (!forceRun && !opts.allowMultipleRunsPerDay) {
        return NextResponse.json({
          ok: true,
          skipped: "already_running_today",
          run_date: runDate,
        });
      }
    }

    // 4. Run handler
    let result: T | null = null;
    let errorMessage: string | null = null;
    let success = false;
    try {
      result = await handler({ startedAt, runDate, forceRun });
      success = true;
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`[cron/${cronName}] failed`, err);
    }

    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();

    // 5. Update cron_runs row
    if (runId) {
      await admin
        .from("cron_runs")
        .update({
          status: success ? "success" : "failed",
          duration_ms: durationMs,
          payload: success ? (result as Record<string, unknown>) ?? {} : {},
          error_message: errorMessage,
          completed_at: completedAt.toISOString(),
        })
        .eq("id", runId);
    }

    // 6. Telegram alert on failure (BUG-018)
    if (!success && errorMessage) {
      try {
        await sendToAdminChat({
          text:
            `🚨 <b>Cron failed: ${cronName}</b>\n\n` +
            `<i>Date:</i> ${runDate}\n` +
            `<i>Duration:</i> ${durationMs}ms\n` +
            `<i>Error:</i> ${errorMessage.slice(0, 500)}`,
          parseMode: "HTML",
        });
      } catch {
        /* ignore telegram failures */
      }
    }

    // 7. Response
    if (!success) {
      return NextResponse.json(
        {
          ok: false,
          error: errorMessage,
          cron: cronName,
          run_date: runDate,
          duration_ms: durationMs,
        },
        { status: 500 },
      );
    }
    return NextResponse.json({
      ok: true,
      cron: cronName,
      run_date: runDate,
      duration_ms: durationMs,
      result,
    });
  };
}
