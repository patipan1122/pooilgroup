// Dev/demo endpoint — fills the dashboard with realistic data so it doesn't look empty.
// Idempotent: re-runs INSERT with ON CONFLICT skip. Updates streaks + targets + health each run.
// Admin-only.

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";
import { subDays, getDate, getDaysInMonth, getDay } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { computeHealth } from "@/lib/cashhub/health-score";
import { computeStreak } from "@/lib/cashhub/streak";

const TZ = process.env.NEXT_PUBLIC_APP_TIMEZONE || "Asia/Bangkok";

interface Sample {
  totalSales: number;
  qty1?: number;
  qty1Unit?: string;
  cashPct: number;
  transferPct: number;
  cardPct: number;
  creditPct: number;
}

const SAMPLE_BY_TYPE: Record<string, Sample> = {
  fuel_station: {
    totalSales: 145_000,
    qty1: 5_200,
    qty1Unit: "liter",
    cashPct: 0.55,
    transferPct: 0.31,
    cardPct: 0.14,
    creditPct: 0,
  },
  lpg_station: {
    totalSales: 28_000,
    qty1: 56,
    qty1Unit: "tank",
    cashPct: 0.65,
    transferPct: 0.27,
    cardPct: 0,
    creditPct: 0.08,
  },
  bottling_plant: {
    totalSales: 285_000,
    qty1: 320,
    qty1Unit: "tank",
    cashPct: 0.16,
    transferPct: 0.7,
    cardPct: 0,
    creditPct: 0.14,
  },
  hotel: {
    totalSales: 38_500,
    qty1: 12,
    qty1Unit: "room",
    cashPct: 0.22,
    transferPct: 0.31,
    cardPct: 0.47,
    creditPct: 0,
  },
  cafe: {
    totalSales: 9_800,
    qty1: 145,
    qty1Unit: "cup",
    cashPct: 0.59,
    transferPct: 0.41,
    cardPct: 0,
    creditPct: 0,
  },
  ev_station: {
    totalSales: 4_200,
    qty1: 18,
    qty1Unit: "session",
    cashPct: 0.29,
    transferPct: 0.71,
    cardPct: 0,
    creditPct: 0,
  },
  convenience_store: {
    totalSales: 12_400,
    cashPct: 1,
    transferPct: 0,
    cardPct: 0,
    creditPct: 0,
  },
  // ---- New 5 types (2026-05-05) ----
  lpg_retail: {
    totalSales: 7_800,
    qty1: 18,
    qty1Unit: "tank",
    cashPct: 0.7,
    transferPct: 0.22,
    cardPct: 0,
    creditPct: 0.08,
  },
  cafe_punthai: {
    totalSales: 8_400,
    qty1: 130,
    qty1Unit: "cup",
    cashPct: 0.55,
    transferPct: 0.45,
    cardPct: 0,
    creditPct: 0,
  },
  massage_chair: {
    totalSales: 4_260,
    qty1: 142,
    qty1Unit: "session",
    cashPct: 1,
    transferPct: 0,
    cardPct: 0,
    creditPct: 0,
  },
  claw_machine: {
    totalSales: 3_200,
    qty1: 320,
    qty1Unit: "play",
    cashPct: 1,
    transferPct: 0,
    cardPct: 0,
    creditPct: 0,
  },
  training_center: {
    totalSales: 145_000,
    qty1: 4,
    qty1Unit: "session",
    cashPct: 0.05,
    transferPct: 0.95,
    cardPct: 0,
    creditPct: 0,
  },
};

// Per-branch personality so the dashboard isn't all identical
const PERSONALITIES = [
  { factor: 1.15, fillRate: 1.0, balanceOk: 1.0, label: "rockstar" },
  { factor: 1.08, fillRate: 0.97, balanceOk: 0.98, label: "good" },
  { factor: 1.0, fillRate: 0.95, balanceOk: 0.97, label: "avg" },
  { factor: 0.92, fillRate: 0.9, balanceOk: 0.94, label: "ok" },
  { factor: 0.85, fillRate: 0.8, balanceOk: 0.9, label: "weak" },
  { factor: 0.7, fillRate: 0.6, balanceOk: 0.8, label: "struggling" },
];

export async function POST() {
  // D-020 ปิด endpoint นี้ใน production · กัน CEO เผลอกดแล้วข้อมูลปลอมปนของจริง
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "ไม่อนุญาตใน production · feature นี้ใช้ได้เฉพาะ dev/local" },
      { status: 403 },
    );
  }
  const session = await requireRole("super_admin", "org_admin");
  const admin = adminClient();
  const orgId = session.user.org_id;
  const userId = session.user.id;

  const { data: branches } = await admin
    .from("branches")
    .select("id, business_type, code, name")
    .eq("org_id", orgId)
    .eq("is_active", true);

  if (!branches || branches.length === 0) {
    return NextResponse.json({ error: "ไม่มีสาขาในระบบ" }, { status: 400 });
  }

  const now = new Date();
  const today = formatInTimeZone(now, TZ, "yyyy-MM-dd");

  let created = 0;
  let skipped = 0;
  const errors: string[] = [];

  // Window: last 35 days so prev-month comparisons have data
  const WINDOW_DAYS = 35;
  // Today: leave as "submitted" — earlier days approved.
  // 2-day weekend bias: weekends (Sat/Sun) get a boost for hotel/cafe; lower for fuel/bottling

  for (let bIdx = 0; bIdx < branches.length; bIdx++) {
    const branch = branches[bIdx]!;
    const sample = SAMPLE_BY_TYPE[branch.business_type as string];
    if (!sample) continue;
    const personality = PERSONALITIES[bIdx % PERSONALITIES.length]!;
    const filledDates: string[] = [];

    for (let daysAgo = WINDOW_DAYS - 1; daysAgo >= 0; daysAgo--) {
      const reportDate = formatInTimeZone(
        subDays(now, daysAgo),
        TZ,
        "yyyy-MM-dd",
      );
      // Some branches skip days based on fillRate
      if (Math.random() > personality.fillRate) continue;
      // weekend bias
      const dow = getDay(subDays(now, daysAgo));
      const weekendBoost =
        branch.business_type === "hotel" || branch.business_type === "cafe"
          ? dow === 0 || dow === 6
            ? 1.2
            : 1.0
          : branch.business_type === "fuel_station" ||
              branch.business_type === "bottling_plant"
            ? dow === 0 || dow === 6
              ? 0.85
              : 1.0
            : 1.0;
      const variance = 0.9 + Math.random() * 0.25; // 90%-115%
      const totalSalesRaw = Math.round(
        sample.totalSales *
          personality.factor *
          weekendBoost *
          variance,
      );
      // Force balance — distribute by mix
      const cash = Math.round(totalSalesRaw * sample.cashPct);
      const transfer = Math.round(totalSalesRaw * sample.transferPct);
      const card = Math.round(totalSalesRaw * sample.cardPct);
      const credit = Math.round(totalSalesRaw * sample.creditPct);
      let shortage = 0;
      let totalSales = cash + transfer + card + credit;
      // Occasionally introduce a small shortage so the shortage page has rows
      if (
        sample.cashPct > 0.5 &&
        Math.random() < (1 - personality.balanceOk) * 0.5
      ) {
        shortage = Math.round(totalSalesRaw * 0.005); // small ~0.5%
        totalSales = cash + transfer + card + credit + shortage;
      }

      const isToday = daysAgo === 0;
      const status = isToday ? "submitted" : "approved";
      const submittedAt = subDays(now, daysAgo).toISOString();

      const payload = {
        id: crypto.randomUUID(),
        org_id: orgId,
        branch_id: branch.id,
        report_date: reportDate,
        shift: "all",
        total_sales: totalSales,
        qty1: sample.qty1
          ? Math.round(sample.qty1 * personality.factor * variance)
          : null,
        qty1_unit: sample.qty1Unit ?? null,
        cash,
        transfer,
        card,
        credit,
        shortage,
        status,
        submitted_by_id: userId,
        submitted_at: submittedAt,
        approved_by_id: status === "approved" ? userId : null,
        approved_at: status === "approved" ? submittedAt : null,
        updated_at: new Date().toISOString(),
      };

      const { error } = await admin.from("daily_reports").insert(payload);
      if (error) {
        if (error.code === "23505") {
          skipped += 1;
          filledDates.push(reportDate);
        } else {
          errors.push(`${branch.code}@${reportDate}: ${error.message}`);
        }
      } else {
        created += 1;
        filledDates.push(reportDate);
        // Insert a shortage row when applicable
        if (shortage > 0) {
          await admin.from("cash_shortages").insert({
            id: crypto.randomUUID(),
            org_id: orgId,
            report_id: payload.id,
            branch_id: branch.id,
            report_date: reportDate,
            amount: shortage,
            person_id: null,
            person_name: pickPerson(),
            is_identified: true,
            note: pickShortageNote(),
          });
        }
      }
    }

    // ---- Streak ----
    const streak = computeStreak(filledDates, today);
    await safeUpsert(admin, "branch_streaks", {
      org_id: orgId,
      branch_id: branch.id,
      current_streak: streak.current,
      longest_streak: streak.longest,
      last_report_date: streak.lastDate,
      updated_at: new Date().toISOString(),
    });

    // ---- Target (auto-derive: avg × 1.05) ----
    const monthYear = parseInt(formatInTimeZone(now, TZ, "yyyy"), 10);
    const monthNum = parseInt(formatInTimeZone(now, TZ, "M"), 10);
    const monthlySales =
      sample.totalSales * personality.factor * 30 * 1.05;
    await safeUpsert(admin, "branch_targets", {
      org_id: orgId,
      branch_id: branch.id,
      year: monthYear,
      month: monthNum,
      amount: Math.round(monthlySales / 1000) * 1000,
      source: "derived_avg_3m",
      updated_at: new Date().toISOString(),
    });

    // ---- Health Score (call the same algorithm cron will use) ----
    const expectedDays = 30;
    const reportedDays = filledDates.filter((d) => {
      const days = Math.floor(
        (now.getTime() - new Date(d + "T00:00:00").getTime()) /
          (1000 * 60 * 60 * 24),
      );
      return days >= 0 && days < 30;
    }).length;
    const daysInMonth = getDaysInMonth(now);
    const daysIntoMonth = getDate(now);

    // Crude: assume on-time rate ≈ fillRate, balanced rate ≈ balanceOk
    const onTimeDays = Math.round(reportedDays * personality.fillRate);
    const balancedDays = Math.round(reportedDays * personality.balanceOk);
    const diffOnePctDays = Math.max(
      0,
      Math.round(reportedDays * (1 - personality.balanceOk) * 0.7),
    );
    const diffFivePctDays = Math.max(
      0,
      Math.round(reportedDays * (1 - personality.balanceOk) * 0.1),
    );

    const totalSalesWindow =
      sample.totalSales * personality.factor * reportedDays;
    const prevTotalSalesWindow = totalSalesWindow / 1.04; // pretend prior was 4% lower

    const monthlyTarget = Math.round(monthlySales / 1000) * 1000;
    const actualThisMonth = sample.totalSales * personality.factor * daysIntoMonth;

    const result = computeHealth({
      expectedDays,
      reportedDays,
      onTimeDays,
      balancedDays,
      diffOnePctDays,
      diffFivePctDays,
      totalSales: totalSalesWindow,
      prevTotalSales: prevTotalSalesWindow,
      targetThisMonth: monthlyTarget,
      actualThisMonth,
      daysIntoMonth,
      daysInMonth,
      consecutiveDeclineDays: personality.factor < 0.85 ? 3 : 0,
    });
    await safeUpsert(admin, "branch_health_scores", {
      org_id: orgId,
      branch_id: branch.id,
      computed_for: today,
      score: result.score,
      grade: result.grade,
      breakdown: { items: result.breakdown },
    });
  }

  await audit({
    orgId,
    userId,
    action: "EXPORT_DATA",
    resourceType: "demo_seed",
    diff: { new: { created, skipped, branches: branches.length } },
  });

  return NextResponse.json({
    success: true,
    created,
    skipped,
    branches: branches.length,
    errors: errors.slice(0, 5),
  });
}

// ---- helpers ----
async function safeUpsert(
  admin: ReturnType<typeof adminClient>,
  table: string,
  payload: Record<string, unknown>,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = admin.from(table);
  try {
    const res = await builder.upsert(
      { id: crypto.randomUUID(), ...payload },
      { onConflict: conflictKeyFor(table), ignoreDuplicates: false },
    );
    if (res.error) {
      if (res.error.code === "42P01" || res.error.code === "PGRST205") {
        // Table doesn't exist yet — silent skip
        return;
      }
      // ignore other errors so seed never blocks
    }
  } catch {
    /* swallow */
  }
}

function conflictKeyFor(table: string): string {
  switch (table) {
    case "branch_streaks":
      return "branch_id";
    case "branch_targets":
      return "branch_id,year,month";
    case "branch_health_scores":
      return "branch_id,computed_for";
    default:
      return "id";
  }
}

const NAMES = [
  "สมชาย ใจดี",
  "สุดา รักดี",
  "มานะ พิทักษ์",
  "วิชัย สามัคคี",
  "ดารินทร์ บุญมา",
  "เก่ง ทองคำ",
];
function pickPerson(): string {
  return NAMES[Math.floor(Math.random() * NAMES.length)]!;
}

const NOTES = [
  "นับเงินผิดเล็กน้อย",
  "บัตรติดธุรกรรมล่าช้า",
  "ทอนเงินไม่ครบ",
  "รวมร้านยังไม่หาเจอ",
];
function pickShortageNote(): string {
  return NOTES[Math.floor(Math.random() * NOTES.length)]!;
}
