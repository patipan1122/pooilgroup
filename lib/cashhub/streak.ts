// Streak calculator — counts consecutive days a branch has reported.
// Pure function. Pass it sorted dates (ascending) and a reference "today".

import { differenceInCalendarDays, parseISO } from "date-fns";

export interface StreakResult {
  current: number;
  longest: number;
  lastDate: string | null;
}

/**
 * Compute current + longest streak.
 *
 * @param dates  Unique YYYY-MM-DD dates of reports (any shift) for one branch
 * @param today  Today's date in YYYY-MM-DD (Asia/Bangkok)
 */
export function computeStreak(dates: string[], today: string): StreakResult {
  if (dates.length === 0) return { current: 0, longest: 0, lastDate: null };

  const unique = Array.from(new Set(dates)).sort();
  const todayDate = parseISO(today);

  // Longest streak — walk through sorted unique dates
  let longest = 1;
  let run = 1;
  for (let i = 1; i < unique.length; i++) {
    const diff = differenceInCalendarDays(parseISO(unique[i]!), parseISO(unique[i - 1]!));
    if (diff === 1) {
      run += 1;
      if (run > longest) longest = run;
    } else {
      run = 1;
    }
  }

  // Current streak — count back from latest date if it is "today" or "yesterday"
  const last = unique[unique.length - 1]!;
  const gap = differenceInCalendarDays(todayDate, parseISO(last));
  let current = 0;
  if (gap === 0 || gap === 1) {
    current = 1;
    for (let i = unique.length - 2; i >= 0; i--) {
      const diff = differenceInCalendarDays(
        parseISO(unique[i + 1]!),
        parseISO(unique[i]!),
      );
      if (diff === 1) current += 1;
      else break;
    }
  }

  return { current, longest, lastDate: last };
}

/**
 * Streak badge UI hint
 * 🔥  ≥ 7 day streak (great)
 * ✅  current streak ≥ 1 (filled today/yesterday)
 * 🟡  gap of 1 day
 * 🔴  gap of 2-3 days
 * ⚫  gap ≥ 4 days
 */
export function streakBadge(
  lastDate: string | null,
  today: string,
  currentStreak: number,
): { emoji: string; label: string; tone: "success" | "warning" | "danger" | "neutral" } {
  if (!lastDate) return { emoji: "⚫", label: "ยังไม่เคยกรอก", tone: "danger" };
  const gap = differenceInCalendarDays(parseISO(today), parseISO(lastDate));
  if (currentStreak >= 7 && gap <= 1) {
    return {
      emoji: "🔥",
      label: `${currentStreak} วันต่อเนื่อง`,
      tone: "success",
    };
  }
  if (gap === 0) return { emoji: "✅", label: "กรอกวันนี้", tone: "success" };
  if (gap === 1) return { emoji: "🟡", label: "ขาด 1 วัน", tone: "warning" };
  if (gap <= 3) return { emoji: "🔴", label: `ขาด ${gap} วัน`, tone: "danger" };
  return { emoji: "⚫", label: `ขาด ${gap} วัน!`, tone: "danger" };
}
