// Dev/demo endpoint: populates dashboard with sample reports for testing
// Admin-only. Idempotent — re-running just adds more recent dates.

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";
import { subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

const TZ = process.env.NEXT_PUBLIC_APP_TIMEZONE || "Asia/Bangkok";

interface SampleConfig {
  totalSales: number;
  qty1?: number;
  qty1Unit?: string;
  cash: number;
  transfer: number;
  card: number;
  credit: number;
}

const SAMPLE_BY_TYPE: Record<string, SampleConfig> = {
  fuel_station: {
    totalSales: 145000,
    qty1: 5200,
    qty1Unit: "liter",
    cash: 80000,
    transfer: 45000,
    card: 20000,
    credit: 0,
  },
  lpg_station: {
    totalSales: 28000,
    qty1: 56,
    qty1Unit: "tank",
    cash: 18000,
    transfer: 8000,
    card: 0,
    credit: 2000,
  },
  bottling_plant: {
    totalSales: 285000,
    qty1: 320,
    qty1Unit: "tank",
    cash: 45000,
    transfer: 200000,
    card: 0,
    credit: 40000,
  },
  hotel: {
    totalSales: 38500,
    qty1: 12,
    qty1Unit: "room",
    cash: 8500,
    transfer: 12000,
    card: 18000,
    credit: 0,
  },
  cafe: {
    totalSales: 9800,
    qty1: 145,
    qty1Unit: "cup",
    cash: 5800,
    transfer: 4000,
    card: 0,
    credit: 0,
  },
  ev_station: {
    totalSales: 4200,
    qty1: 18,
    qty1Unit: "session",
    cash: 1200,
    transfer: 3000,
    card: 0,
    credit: 0,
  },
  convenience_store: {
    totalSales: 12400,
    cash: 12400,
    transfer: 0,
    card: 0,
    credit: 0,
  },
};

export async function POST() {
  const session = await requireRole("super_admin", "org_admin");
  const admin = adminClient();
  const orgId = session.user.org_id;

  // Get all branches
  const { data: branches } = await admin
    .from("branches")
    .select("id, business_type")
    .eq("org_id", orgId)
    .eq("is_active", true);

  if (!branches || branches.length === 0) {
    return NextResponse.json(
      { error: "ไม่มีสาขาในระบบ" },
      { status: 400 },
    );
  }

  const today = new Date();
  let created = 0;
  let skipped = 0;
  const errors: string[] = [];

  // Create reports for last 7 days for each branch
  for (let daysAgo = 0; daysAgo < 7; daysAgo++) {
    const reportDate = formatInTimeZone(subDays(today, daysAgo), TZ, "yyyy-MM-dd");

    for (const branch of branches) {
      const sample = SAMPLE_BY_TYPE[branch.business_type as string];
      if (!sample) continue;

      // Vary slightly so dashboard looks realistic
      const variance = 0.85 + Math.random() * 0.3; // 85% - 115%
      const totalSales = Math.round(sample.totalSales * variance);
      const cash = Math.round(sample.cash * variance);
      const transfer = Math.round(sample.transfer * variance);
      const card = Math.round(sample.card * variance);
      const credit = Math.round(sample.credit * variance);

      // Force balance: sales = cash + transfer + card + credit
      const total = cash + transfer + card + credit;
      const adjustedTotalSales = total > 0 ? total : totalSales;

      const status = daysAgo === 0 ? "submitted" : "approved";
      const now = new Date().toISOString();
      const submittedAt = subDays(today, daysAgo).toISOString();

      const payload = {
        id: crypto.randomUUID(),
        org_id: orgId,
        branch_id: branch.id,
        report_date: reportDate,
        shift: "all",
        total_sales: adjustedTotalSales,
        qty1: sample.qty1 ?? null,
        qty1_unit: sample.qty1Unit ?? null,
        cash,
        transfer,
        card,
        credit,
        shortage: 0,
        status,
        submitted_by_id: session.user.id,
        submitted_at: submittedAt,
        approved_by_id: status === "approved" ? session.user.id : null,
        approved_at: status === "approved" ? submittedAt : null,
        updated_at: now,
      };

      const { error } = await admin.from("daily_reports").insert(payload);
      if (error) {
        if (error.code === "23505") {
          skipped++;
        } else {
          errors.push(`${branch.id}@${reportDate}: ${error.message}`);
        }
      } else {
        created++;
      }
    }
  }

  await audit({
    orgId,
    userId: session.user.id,
    action: "EXPORT_DATA",
    resourceType: "demo_seed",
    diff: { new: { created, skipped } },
  });

  return NextResponse.json({
    success: true,
    created,
    skipped,
    errors: errors.slice(0, 5),
  });
}
