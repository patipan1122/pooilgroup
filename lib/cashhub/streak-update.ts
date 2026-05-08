// Branch streak update — race-safe upsert with retry.
//
// branch_streaks has @@unique([branchId]); concurrent computes (e.g. cron +
// seed-test-data running together) hit Postgres unique-violation. We use
// ON CONFLICT (atomic) but wrap in a tiny retry for transient connection
// errors (network blip → Supabase pooler reset).
//
// Use from any place that updates streak after a report state change:
//   - approve flow (after a report becomes status='approved')
//   - cron job that recomputes nightly
//   - seed/demo helpers

import { adminClient } from "@/lib/db/server";
import { computeStreak } from "@/lib/cashhub/streak";

export interface StreakUpdateInput {
  orgId: string;
  branchId: string;
  /** All YYYY-MM-DD strings where the branch has a non-rejected report. */
  filledDates: string[];
  /** YYYY-MM-DD reference date (typically `bkkToday()`). */
  today: string;
}

const MAX_RETRIES = 3;

export async function updateBranchStreak(
  input: StreakUpdateInput,
): Promise<{ ok: true; current: number; longest: number } | { ok: false; error: string }> {
  const admin = adminClient();
  const streak = computeStreak(input.filledDates, input.today);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (admin.from as any)("branch_streaks").upsert(
        {
          id: crypto.randomUUID(),
          org_id: input.orgId,
          branch_id: input.branchId,
          current_streak: streak.current,
          longest_streak: streak.longest,
          last_report_date: streak.lastDate,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "branch_id", ignoreDuplicates: false },
      );

      // 23P01 / 23505 = race on the unique constraint despite onConflict —
      // very rare, but retry anyway.
      if (error && (error.code === "23505" || error.code === "40001")) {
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, 50 * attempt));
          continue;
        }
      }

      // 42P01 = relation does not exist (migration not applied) — silent skip
      if (error && (error.code === "42P01" || error.code === "PGRST205")) {
        return { ok: false, error: "branch_streaks table missing — apply migrations" };
      }

      if (error) {
        return { ok: false, error: error.message ?? "unknown" };
      }

      return { ok: true, current: streak.current, longest: streak.longest };
    } catch (err) {
      if (attempt === MAX_RETRIES) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "transient",
        };
      }
      await new Promise((r) => setTimeout(r, 50 * attempt));
    }
  }
  return { ok: false, error: "max retries exceeded" };
}
