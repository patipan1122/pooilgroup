// GET /api/cashhub/shortages/export — CSV of cash_shortages, scoped to org
//   ?from=YYYY-MM-DD  ?to=YYYY-MM-DD  ?branchId=...  ?personId=...
//
// CSV (not XLSX) for v1: Excel opens .csv directly with UTF-8 BOM.
// XLSX would require a library (`xlsx`/`exceljs`) which is heavier than the
// audit's "low" priority justifies. CSV gets the data into Excel/Sheets
// instantly and round-trips cleanly.

import { type NextRequest } from "next/server";
import { cashHubApiGuard } from "@/lib/cashhub/api-guard";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";
import { can } from "@/lib/auth/permissions";

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

interface ShortageRow {
  report_date: string;
  amount: number | string;
  person_name: string | null;
  is_identified: boolean;
  note: string | null;
  created_at: string;
  branches: { code: string; name: string } | { code: string; name: string }[] | null;
}

export async function GET(req: NextRequest) {
  const gate = await cashHubApiGuard();
  if (gate.error) return gate.error;
  const session = gate.session;
  if (!can(session.user, "cashhub.export")) {
    return new Response("Forbidden", { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const branchId = searchParams.get("branchId");
  const personId = searchParams.get("personId");

  const admin = adminClient();
  let query = admin
    .from("cash_shortages")
    .select(
      "report_date, amount, person_name, is_identified, note, created_at, branches(code, name)",
    )
    .eq("org_id", session.user.org_id)
    .order("report_date", { ascending: false })
    .limit(10_000);

  if (from) query = query.gte("report_date", from);
  if (to) query = query.lte("report_date", to);
  if (branchId) query = query.eq("branch_id", branchId);
  if (personId) query = query.eq("person_id", personId);

  const { data } = await query;
  const rows = (data ?? []) as unknown as ShortageRow[];

  const header = [
    "วันที่",
    "รหัสสาขา",
    "ชื่อสาขา",
    "จำนวนขาด (บาท)",
    "ระบุชื่อได้",
    "ผู้รับผิดชอบ",
    "หมายเหตุ",
    "บันทึกเมื่อ",
  ];

  const lines: string[] = [header.map(csvCell).join(",")];
  for (const r of rows) {
    const branch = Array.isArray(r.branches) ? r.branches[0] : r.branches;
    lines.push(
      [
        r.report_date,
        branch?.code ?? "",
        branch?.name ?? "",
        Number(r.amount).toFixed(2),
        r.is_identified ? "ใช่" : "ไม่",
        r.person_name ?? "",
        r.note ?? "",
        r.created_at,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  // UTF-8 BOM so Excel auto-detects Thai encoding (otherwise mojibake)
  const csv = "﻿" + lines.join("\n");

  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "EXPORT_DATA",
    resourceType: "cash_shortages_export",
    diff: { new: { rows: rows.length, from, to, branchId, personId } },
  });

  const filename = `pooilgroup-shortages-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
