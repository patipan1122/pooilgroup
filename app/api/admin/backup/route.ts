// POST /api/admin/backup — manual backup trigger (audit-log only)
// GET  /api/admin/backup — download a CSV bundle dump of the org's core data
//
// v1 design: synchronous CSV bundle (small/medium org = a few thousand rows).
// Returns a single .csv concatenating BRANCHES + USERS + DAILY_REPORTS +
// CASH_SHORTAGES with section headers between them. Excel/Sheets parses each
// table until it hits a blank line + new "# SECTION" + new column header row.
// Heavy/async R2-upload version comes later (Upstash queue job).
//
// Spec: ดีเทลv1/CORE_SYSTEM.md §6 Settings · Backup
// Audit: BACKUP_TRIGGERED on POST · EXPORT_DATA on GET (different shapes)
// Auth:  super_admin / org_admin only

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function csvSection(title: string, header: string[], rows: unknown[][]): string {
  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push(header.map(csvCell).join(","));
  for (const r of rows) lines.push(r.map(csvCell).join(","));
  lines.push("");
  return lines.join("\n");
}

export async function POST() {
  const session = await requireRole("super_admin", "org_admin");

  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "BACKUP_TRIGGERED",
    resourceType: "backup",
    resourceId: session.user.org_id,
    diff: { new: { triggeredAt: new Date().toISOString(), kind: "manual" } },
  });

  return NextResponse.json({
    success: true,
    message: "บันทึกการขอ Backup แล้ว · ดาวน์โหลดได้ที่ปุ่ม Download CSV",
    queuedAt: new Date().toISOString(),
    downloadUrl: "/api/admin/backup",
  });
}

interface ReportRow {
  report_date: string;
  shift: string;
  total_sales: string | number;
  qty1: string | number | null;
  qty1_unit: string | null;
  cash: string | number;
  transfer: string | number;
  card: string | number;
  credit: string | number;
  shortage: string | number;
  status: string;
  submitted_at: string | null;
  approved_at: string | null;
  branches: { code: string } | { code: string }[] | null;
}

interface ShortageRow {
  report_date: string;
  amount: string | number;
  person_name: string | null;
  is_identified: boolean;
  note: string | null;
  branches: { code: string } | { code: string }[] | null;
}

export async function GET() {
  const session = await requireRole("super_admin", "org_admin");
  const orgId = session.user.org_id;
  const admin = adminClient();

  const [branches, reports, shortages, users] = await Promise.all([
    admin
      .from("branches")
      .select(
        "code, name, business_type, province, region, manager_id, is_active, created_at",
      )
      .eq("org_id", orgId)
      .limit(5000),
    admin
      .from("daily_reports")
      .select(
        "report_date, shift, total_sales, qty1, qty1_unit, cash, transfer, card, credit, shortage, status, submitted_at, approved_at, branches(code)",
      )
      .eq("org_id", orgId)
      .order("report_date", { ascending: false })
      .limit(20_000),
    admin
      .from("cash_shortages")
      .select(
        "report_date, amount, person_name, is_identified, note, branches(code)",
      )
      .eq("org_id", orgId)
      .order("report_date", { ascending: false })
      .limit(5000),
    admin
      .from("users")
      .select("email, name, role, is_active, last_login_at, created_at")
      .eq("org_id", orgId)
      .limit(5000),
  ]);

  const reportRows = ((reports.data ?? []) as unknown as ReportRow[]).map(
    (r) => {
      const branch = Array.isArray(r.branches) ? r.branches[0] : r.branches;
      return [
        r.report_date,
        branch?.code ?? "",
        r.shift,
        r.total_sales,
        r.qty1,
        r.qty1_unit,
        r.cash,
        r.transfer,
        r.card,
        r.credit,
        r.shortage,
        r.status,
        r.submitted_at,
        r.approved_at,
      ];
    },
  );

  const shortageRows = ((shortages.data ?? []) as unknown as ShortageRow[]).map(
    (r) => {
      const branch = Array.isArray(r.branches) ? r.branches[0] : r.branches;
      return [
        r.report_date,
        branch?.code ?? "",
        r.amount,
        r.is_identified ? "Y" : "N",
        r.person_name,
        r.note,
      ];
    },
  );

  const branchRows = (
    (branches.data ?? []) as Array<Record<string, unknown>>
  ).map((b) => [
    b.code,
    b.name,
    b.business_type,
    b.province,
    b.region,
    b.manager_id,
    b.is_active ? "Y" : "N",
    b.created_at,
  ]);

  const userRows = ((users.data ?? []) as Array<Record<string, unknown>>).map(
    (u) => [
      u.email,
      u.name,
      u.role,
      u.is_active ? "Y" : "N",
      u.last_login_at,
      u.created_at,
    ],
  );

  // UTF-8 BOM so Excel auto-detects Thai encoding
  const csv =
    "﻿" +
    [
      `# Pooilgroup Backup Bundle — generated ${new Date().toISOString()}`,
      `# org_id = ${orgId}`,
      "",
      csvSection(
        "BRANCHES",
        [
          "code",
          "name",
          "business_type",
          "province",
          "region",
          "manager_id",
          "is_active",
          "created_at",
        ],
        branchRows,
      ),
      csvSection(
        "USERS",
        ["email", "name", "role", "is_active", "last_login_at", "created_at"],
        userRows,
      ),
      csvSection(
        "DAILY_REPORTS",
        [
          "report_date",
          "branch_code",
          "shift",
          "total_sales",
          "qty1",
          "qty1_unit",
          "cash",
          "transfer",
          "card",
          "credit",
          "shortage",
          "status",
          "submitted_at",
          "approved_at",
        ],
        reportRows,
      ),
      csvSection(
        "CASH_SHORTAGES",
        [
          "report_date",
          "branch_code",
          "amount",
          "is_identified",
          "person_name",
          "note",
        ],
        shortageRows,
      ),
    ].join("\n");

  await audit({
    orgId,
    userId: session.user.id,
    action: "EXPORT_DATA",
    resourceType: "backup_bundle",
    diff: {
      new: {
        branches: branchRows.length,
        users: userRows.length,
        reports: reportRows.length,
        shortages: shortageRows.length,
      },
    },
  });

  const filename = `pooilgroup-backup-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
