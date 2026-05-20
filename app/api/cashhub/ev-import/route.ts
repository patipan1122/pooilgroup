// POST /api/cashhub/ev-import
// Bulk-import aggregated EV charge sessions from CONNEXT Looker Studio.
// Behavior:
//  - Auto-create missing branches (business_type=ev_station, company=Pooil Oil)
//    when createMissingBranches=true
//  - Upsert DailyReport (org_id, branch_id, report_date, shift=all)
//  - overwrite=true updates existing rows; false skips them

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { withDbDefaults } from "@/lib/db/insert";
import { audit } from "@/lib/audit/log";

const POOIL_OIL_COMPANY_ID = "00000000-0000-0000-0000-0000000000a1";

const AggSchema = z.object({
  stationName: z.string().min(1).max(200),
  reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sessions: z.number().int().min(0).max(100000),
  totalKwh: z.number().min(0).max(10_000_000),
  totalRevenue: z.number().min(0).max(1_000_000_000),
});

const Schema = z.object({
  aggregates: z.array(AggSchema).min(1).max(2000),
  createMissingBranches: z.boolean().default(false),
  overwrite: z.boolean().default(false),
});

type Aggregate = z.infer<typeof AggSchema>;

function normalizeName(name: string): string {
  // Loose match — strip spaces + lowercase. Looker exports sometimes have
  // double-spaces or trailing whitespace; DB names typically don't.
  return name.replace(/\s+/g, "").toLowerCase();
}

async function nextEvBranchCode(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  orgId: string,
): Promise<(start: number) => string> {
  const { data } = await admin
    .from("branches")
    .select("code")
    .eq("org_id", orgId)
    .like("code", "PO-EV-%");
  const used = new Set<number>();
  for (const r of (data ?? []) as Array<{ code: string }>) {
    const m = r.code.match(/^PO-EV-(\d+)$/);
    if (m) used.add(Number.parseInt(m[1]!, 10));
  }
  return (start: number) => {
    let n = Math.max(start, 1);
    while (used.has(n)) n++;
    used.add(n);
    return `PO-EV-${String(n).padStart(3, "0")}`;
  };
}

export async function POST(req: NextRequest) {
  const session = await requireRole("super_admin", "org_admin", "admin");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" },
      { status: 400 },
    );
  }
  const { aggregates, createMissingBranches, overwrite } = parsed.data;
  const orgId = session.user.org_id;
  const admin = adminClient();

  // 1. Load existing EV branches in this org → name lookup map
  const { data: existingBranches } = await admin
    .from("branches")
    .select("id, code, name, business_type")
    .eq("org_id", orgId)
    .eq("is_active", true);

  const branchByNormName = new Map<string, { id: string; code: string }>();
  for (const b of (existingBranches ?? []) as Array<{
    id: string;
    code: string;
    name: string;
    business_type: string;
  }>) {
    if (b.business_type === "ev_station") {
      branchByNormName.set(normalizeName(b.name), { id: b.id, code: b.code });
    }
  }

  // 2. Find unique stations + which are missing
  const stationsInPayload = Array.from(
    new Set(aggregates.map((a) => a.stationName)),
  );
  const missingStations = stationsInPayload.filter(
    (s) => !branchByNormName.has(normalizeName(s)),
  );

  const createdBranches: Array<{ id: string; code: string; name: string }> = [];

  // 3. Create missing branches if asked
  if (missingStations.length > 0 && createMissingBranches) {
    const nextCode = await nextEvBranchCode(admin, orgId);

    for (const stationName of missingStations) {
      const code = nextCode(2); // PO-EV-001 is reserved for the existing manual seed
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const { error } = await admin.from("branches").insert({
        id,
        org_id: orgId,
        company_id: POOIL_OIL_COMPANY_ID,
        code,
        name: stationName,
        business_type: "ev_station",
        province: null,
        region: null,
        address: null,
        phone: null,
        lat: null,
        lng: null,
        manager_id: null,
        line_group_id: null,
        report_deadline: "21:00",
        is_active: true,
        created_at: now,
        updated_at: now,
      });
      if (error) {
        return NextResponse.json(
          {
            error: `สร้างสาขา ${stationName} ไม่สำเร็จ: ${error.message}`,
            createdBranches,
          },
          { status: 500 },
        );
      }
      branchByNormName.set(normalizeName(stationName), { id, code });
      createdBranches.push({ id, code, name: stationName });
    }
  }

  // 4. Upsert daily reports
  const reportsCreated: Array<{ branchCode: string; date: string }> = [];
  const reportsUpdated: Array<{ branchCode: string; date: string }> = [];
  const skipped: Array<{ stationName: string; date: string; reason: string }> = [];

  for (const agg of aggregates) {
    const branch = branchByNormName.get(normalizeName(agg.stationName));
    if (!branch) {
      skipped.push({
        stationName: agg.stationName,
        date: agg.reportDate,
        reason: "ไม่พบสาขาในระบบ (createMissingBranches=false)",
      });
      continue;
    }

    // EV stations don't take cash — all revenue from app/QR/card.
    // We don't know the split → put everything in `transfer` (app payment),
    // formula `totalSales == cash + transfer + card + shortage` still balances.
    const payload = withDbDefaults({
      org_id: orgId,
      branch_id: branch.id,
      report_date: agg.reportDate,
      shift: "all",
      total_sales: agg.totalRevenue,
      qty1: agg.sessions,
      qty1_unit: "session",
      qty2: agg.totalKwh,
      qty2_unit: "kwh",
      cash: 0,
      transfer: agg.totalRevenue,
      card: 0,
      credit: 0,
      shortage: 0,
      rental_income: 0,
      training_sessions: null,
      notes: `[CONNEXT import ${new Date().toISOString().slice(0, 10)}]`,
      extra_fields: { source: "connext_csv" },
      status: "submitted",
      submitted_by_id: session.user.id,
      submitted_at: new Date().toISOString(),
    });

    const { error } = await admin.from("daily_reports").insert(payload);

    if (!error) {
      reportsCreated.push({ branchCode: branch.code, date: agg.reportDate });
      continue;
    }

    if (error.code === "23505") {
      // Already exists for (branch, date, shift)
      if (!overwrite) {
        skipped.push({
          stationName: agg.stationName,
          date: agg.reportDate,
          reason: "มีรายงานเดิมอยู่แล้ว (overwrite=false)",
        });
        continue;
      }
      const { error: updateError } = await admin
        .from("daily_reports")
        .update({
          total_sales: agg.totalRevenue,
          qty1: agg.sessions,
          qty1_unit: "session",
          qty2: agg.totalKwh,
          qty2_unit: "kwh",
          transfer: agg.totalRevenue,
          cash: 0,
          card: 0,
          notes: `[CONNEXT import ${new Date().toISOString().slice(0, 10)} · overwrite]`,
          extra_fields: { source: "connext_csv" },
          updated_at: new Date().toISOString(),
        })
        .eq("branch_id", branch.id)
        .eq("report_date", agg.reportDate)
        .eq("shift", "all");
      if (updateError) {
        skipped.push({
          stationName: agg.stationName,
          date: agg.reportDate,
          reason: `อัปเดตไม่สำเร็จ: ${updateError.message}`,
        });
      } else {
        reportsUpdated.push({ branchCode: branch.code, date: agg.reportDate });
      }
      continue;
    }

    skipped.push({
      stationName: agg.stationName,
      date: agg.reportDate,
      reason: `DB error: ${error.message}`,
    });
  }

  await audit({
    orgId,
    userId: session.user.id,
    action: "BULK_IMPORT_EV_REPORTS",
    resourceType: "daily_report",
    diff: {
      new: {
        aggregatesIn: aggregates.length,
        createdBranches: createdBranches.length,
        reportsCreated: reportsCreated.length,
        reportsUpdated: reportsUpdated.length,
        skipped: skipped.length,
      },
    },
  });

  return NextResponse.json({
    ok: true,
    createdBranches,
    reportsCreated,
    reportsUpdated,
    skipped,
    missingStations: createMissingBranches ? [] : missingStations,
  });
}
