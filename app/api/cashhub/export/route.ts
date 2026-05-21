import { type NextRequest } from "next/server";
import { cashHubApiGuard } from "@/lib/cashhub/api-guard";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";
import { can } from "@/lib/auth/permissions";

// CSV injection guard — Excel/Sheets evaluate any cell starting with
// `= + - @ \t \r` as a formula. A branch named `=cmd|'...'` or a note
// starting with `+` could exfil data or trigger external requests when
// the file is opened. Prefix with `'` (de-facto Excel "literal" marker)
// and still quote per RFC 4180 rules.
const FORMULA_TRIGGERS = /^[=+\-@\t\r]/;
function escapeCsv(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (FORMULA_TRIGGERS.test(s)) {
    s = "'" + s;
  }
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// Strip anything that could break the Content-Disposition header.
// Was: raw `${fromDate}` / `${toDate}` could carry quotes, semicolons,
// or newlines (header injection) since the from/to params weren't checked.
function safeFilenamePart(s: string | null | undefined, fallback: string): string {
  if (!s) return fallback;
  return s.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32) || fallback;
}

export async function GET(req: NextRequest) {
  const gate = await cashHubApiGuard();
  if (gate.error) return gate.error;
  const session = gate.session;
  if (!can(session.user, "cashhub.export")) {
    return new Response("Forbidden", { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const fromDate = searchParams.get("from");
  const toDate = searchParams.get("to");
  const branchId = searchParams.get("branchId");
  const status = searchParams.get("status");

  const admin = adminClient();
  let query = admin
    .from("daily_reports")
    .select(
      "report_date, shift, total_sales, qty1, qty1_unit, cash, transfer, card, credit, shortage, status, submitted_at, approved_at, notes, branches(code, name, business_type)",
    )
    .eq("org_id", session.user.org_id)
    .order("report_date", { ascending: false })
    .limit(5000);

  if (fromDate) query = query.gte("report_date", fromDate);
  if (toDate) query = query.lte("report_date", toDate);
  if (branchId) query = query.eq("branch_id", branchId);
  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) return new Response(error.message, { status: 500 });

  const headers = [
    "วันที่",
    "รหัสสาขา",
    "ชื่อสาขา",
    "ประเภท",
    "กะ",
    "ยอดขาย",
    "จำนวน",
    "หน่วย",
    "เงินสด",
    "โอน",
    "บัตร",
    "เครดิต",
    "เงินขาด",
    "สถานะ",
    "เวลาส่ง",
    "เวลาอนุมัติ",
    "หมายเหตุ",
  ];
  const rows = (data ?? []).map((r) => {
    const b = Array.isArray(r.branches) ? r.branches[0] : r.branches;
    const br = b as { code?: string; name?: string; business_type?: string } | null;
    return [
      r.report_date,
      br?.code ?? "",
      br?.name ?? "",
      br?.business_type ?? "",
      r.shift,
      r.total_sales,
      r.qty1 ?? "",
      r.qty1_unit ?? "",
      r.cash,
      r.transfer,
      r.card,
      r.credit,
      r.shortage,
      r.status,
      r.submitted_at ?? "",
      r.approved_at ?? "",
      r.notes ?? "",
    ].map(escapeCsv).join(",");
  });

  const csv = "﻿" + [headers.map(escapeCsv).join(","), ...rows].join("\n");
  const filename = `cashhub_${safeFilenamePart(fromDate, "all")}_${safeFilenamePart(toDate, "now")}.csv`;

  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "EXPORT_DATA",
    resourceType: "daily_reports",
    diff: { new: { count: rows.length, filters: { fromDate, toDate, branchId, status } } },
  });

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
