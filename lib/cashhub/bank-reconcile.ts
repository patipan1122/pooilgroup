// Bank-reconcile data adapter.
//
// V1 strategy: NO new tables. Treat the existing daily_reports + cash_shortages
// stream as a "reconcile preview" — cash diff vs expected = our match diff,
// approved reports = matched, submitted = no-bank-yet, missing-day rows
// surface in [[cashhub-shortage-flow-d020]]'s shortage stream.
//
// Per [[cashhub-shortage-flow-d020]] — we DISPLAY shortages here, never resolve
// or rewrite reconcile formulas. The "ปรับยอด / ทักผู้กรอก" actions navigate
// to the report detail page; we never mutate diffs from this surface.

import { adminClient } from "@/lib/db/server";
import { formatInTimeZone } from "date-fns-tz";
import { subDays } from "date-fns";
import type { SupabaseClient } from "@supabase/supabase-js";

const TZ = process.env.NEXT_PUBLIC_APP_TIMEZONE || "Asia/Bangkok";

export type ReconcileStatus = "matched" | "diff" | "no-bank" | "missing-fill";

export interface ReconcileRow {
  date: string;           // YYYY-MM-DD
  branchId: string | null;
  code: string;
  name: string;
  businessType: string;
  filled: number;         // ยอดในระบบ (total_sales)
  bank: number | null;    // เงินเข้าจริง — for v1 = received - shortage, null if no report
  diff: number | null;
  status: ReconcileStatus;
  staffName: string | null;
  staffPhone: string | null;
  shift: string | null;
  reportId: string | null;
}

interface LoadOptions {
  /** Inclusive ISO date YYYY-MM-DD */
  from: string;
  /** Inclusive ISO date YYYY-MM-DD */
  to: string;
  /** Only show rows where status !== "matched" */
  abnormalOnly?: boolean;
  /** Filter by business type slug */
  businessType?: string;
}

interface Summary {
  matched: number;
  diff: number;
  noBank: number;
  missingFill: number;
  bankIncomeToday: number;
}

function buildRow(args: {
  date: string;
  reportId: string | null;
  code: string;
  name: string;
  businessType: string;
  totalSales: number;
  cash: number;
  transfer: number;
  card: number;
  credit: number;
  shortage: number;
  status: string;
  branchId: string | null;
  staffName: string | null;
  staffPhone: string | null;
  shift: string | null;
}): ReconcileRow {
  const received =
    (args.cash || 0) +
    (args.transfer || 0) +
    (args.card || 0) +
    (args.credit || 0);
  // For v1 we treat shortage as the "diff": positive shortage = under-collected.
  const diff = args.shortage > 0 ? -args.shortage : args.shortage < 0 ? -args.shortage : 0;
  let status: ReconcileStatus;
  if (args.status === "submitted") status = "no-bank";
  else if (args.shortage !== 0) status = "diff";
  else status = "matched";

  return {
    date: args.date,
    branchId: args.branchId,
    code: args.code,
    name: args.name,
    businessType: args.businessType,
    filled: args.totalSales,
    bank: received,
    diff,
    status,
    staffName: args.staffName,
    staffPhone: args.staffPhone,
    shift: args.shift,
    reportId: args.reportId,
  };
}

async function fetchRows(
  admin: SupabaseClient,
  orgId: string,
  { from, to }: { from: string; to: string },
) {
  const { data, error } = await admin
    .from("daily_reports")
    .select(
      "id, branch_id, report_date, shift, status, total_sales, cash, transfer, card, credit, shortage, submitted_by_id, " +
        "branches!inner(code, name, business_type)",
    )
    .eq("org_id", orgId)
    .gte("report_date", from)
    .lte("report_date", to)
    .in("status", ["approved", "submitted"])
    .order("report_date", { ascending: false })
    .limit(500);
  if (error) throw error;
  return data ?? [];
}

async function fetchSubmitterNames(
  admin: SupabaseClient,
  ids: string[],
): Promise<Map<string, { name: string; phone: string | null }>> {
  if (ids.length === 0) return new Map();
  const { data } = await admin
    .from("users")
    .select("id, name, phone")
    .in("id", ids);
  return new Map(
    (data ?? []).map((u) => [
      u.id,
      { name: u.name, phone: (u as { phone?: string | null }).phone ?? null },
    ]),
  );
}

async function fetchActiveBranches(admin: SupabaseClient, orgId: string) {
  const { data } = await admin
    .from("branches")
    .select("id, code, name, business_type")
    .eq("org_id", orgId)
    .eq("is_active", true);
  return data ?? [];
}

export async function loadReconcile(
  orgId: string,
  opts: LoadOptions,
): Promise<{ rows: ReconcileRow[]; summary: Summary }> {
  const admin = adminClient();
  const [rawRows, activeBranches] = await Promise.all([
    fetchRows(admin, orgId, { from: opts.from, to: opts.to }),
    fetchActiveBranches(admin, orgId),
  ]);

  type RawRow = {
    id: string;
    branch_id: string;
    report_date: string;
    shift: string | null;
    status: string;
    total_sales: number;
    cash: number;
    transfer: number;
    card: number;
    credit: number;
    shortage: number;
    submitted_by_id: string | null;
    branches:
      | { code: string; name: string; business_type: string }
      | { code: string; name: string; business_type: string }[]
      | null;
  };

  const submitterIds = Array.from(
    new Set(
      (rawRows as unknown as RawRow[])
        .map((r) => r.submitted_by_id)
        .filter((v): v is string => !!v),
    ),
  );
  const submitterNames = await fetchSubmitterNames(admin, submitterIds);

  const rows: ReconcileRow[] = (rawRows as unknown as RawRow[]).map((r) => {
    const branch = Array.isArray(r.branches) ? r.branches[0] : r.branches;
    return buildRow({
      date: r.report_date,
      reportId: r.id,
      branchId: r.branch_id,
      code: branch?.code ?? "—",
      name: branch?.name ?? "—",
      businessType: branch?.business_type ?? "",
      totalSales: Number(r.total_sales || 0),
      cash: Number(r.cash || 0),
      transfer: Number(r.transfer || 0),
      card: Number(r.card || 0),
      credit: Number(r.credit || 0),
      shortage: Number(r.shortage || 0),
      status: r.status,
      staffName: r.submitted_by_id
        ? submitterNames.get(r.submitted_by_id)?.name ?? null
        : null,
      staffPhone: r.submitted_by_id
        ? submitterNames.get(r.submitted_by_id)?.phone ?? null
        : null,
      shift: r.shift,
    });
  });

  // "missing-fill" rows — yesterday-only synthesis to avoid blowing up the table.
  const yesterday = formatInTimeZone(subDays(new Date(), 1), TZ, "yyyy-MM-dd");
  if (yesterday >= opts.from && yesterday <= opts.to) {
    const reportedBranchIds = new Set(
      rows.filter((r) => r.date === yesterday).map((r) => r.branchId),
    );
    for (const b of activeBranches) {
      if (!reportedBranchIds.has(b.id)) {
        rows.push({
          date: yesterday,
          branchId: b.id,
          code: b.code,
          name: b.name,
          businessType: b.business_type,
          filled: 0,
          bank: null,
          diff: null,
          status: "missing-fill",
          staffName: null,
          staffPhone: null,
          shift: null,
          reportId: null,
        });
      }
    }
  }

  // Filters
  let filtered = rows;
  if (opts.abnormalOnly) {
    filtered = filtered.filter((r) => r.status !== "matched");
  }
  if (opts.businessType) {
    filtered = filtered.filter((r) => r.businessType === opts.businessType);
  }

  filtered.sort((a, b) =>
    a.date === b.date ? a.code.localeCompare(b.code) : a.date < b.date ? 1 : -1,
  );

  const today = formatInTimeZone(new Date(), TZ, "yyyy-MM-dd");
  const summary: Summary = {
    matched: rows.filter((r) => r.status === "matched").length,
    diff: rows.filter((r) => r.status === "diff").length,
    noBank: rows.filter((r) => r.status === "no-bank").length,
    missingFill: rows.filter((r) => r.status === "missing-fill").length,
    bankIncomeToday: rows
      .filter((r) => r.date === today && r.status === "matched")
      .reduce((s, r) => s + (r.bank ?? 0), 0),
  };

  return { rows: filtered, summary };
}
