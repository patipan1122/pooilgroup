"use server";

// LedgerLine /ledger/reconcile — CSV export of the reconcile worklist (PR4).
//
// Mirrors exportConfirmedCsv in ../_actions.ts for the security bar:
//   • requireLedgerAccess (session + module entitlement for non-admins)
//   • expense.export capability (accountant/admin tier)
//   • company belongs to the caller's org (no cross-org/company read)
//   • audit trail of what left the system
// Read-only: builds a CSV string from listReconcile; the client triggers the
// download from the returned string (no extra API route needed).
//
// HARD RULE: every read is scoped by orgId AND companyId — one org owns multiple
// legal entities (Pooil ↔ JP Sync, separate VAT), an org-only export would leak.

import { requireSession } from "@/lib/auth/session";
import { isAdminTier } from "@/lib/auth/role-guards";
import { userHasModuleAccess } from "@/lib/auth/module-access";
import { ledgerWebCanForRole } from "@/lib/ledger/liff-auth";
import { ledgerPayreqV1 } from "@/lib/ledger/flags";
import { listCompanies, listBranches } from "@/lib/ledger/queries";
import { audit } from "@/lib/audit/log";
import {
  listReconcile,
  type ReconcileFilters,
  type ReconcileRequestRow,
} from "@/lib/ledger/payment-request-queries";

export type ExportReconcileResult =
  | { ok: true; csv: string; filename: string; rows: number }
  | { ok: false; error: string };

export interface ExportReconcileInput {
  companyId: string;
  branchId?: string | null;
  month?: string | null;
  vendor?: string | null;
}

/** Thai labels for the request state — same wording as the on-page pills. */
const STATE_LABEL_TH: Record<string, string> = {
  open: "รอโอน",
  partial: "จ่ายบางส่วน",
  paid: "จ่ายแล้ว",
  abnormal: "ต้องตรวจ",
  cancelled: "ยกเลิก",
  reversed: "ทำรายการคืน",
};

/** RFC-4180 cell escaping: wrap in quotes + double inner quotes when needed. */
function csvCell(value: string | number | null | undefined): string {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const baht = (n: number): string =>
  n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function isoToThaiDate(iso: string | null): string {
  if (!iso) return "";
  // YYYY-MM-DD (calendar date) — keep the CSV deterministic / spreadsheet-friendly.
  return iso.slice(0, 10);
}

/**
 * Export the reconcile worklist (รอโอน + จ่ายบางส่วน + จ่ายแล้ว + ต้องตรวจ) to CSV.
 * ONE ROW PER BILL so the columns (เลขบิล, ยอดบิล, หัก ณ ที่จ่าย) are meaningful;
 * the request-level totals repeat across its bill rows (a flat sheet the
 * accountant can pivot). Floating slips are intentionally NOT exported here —
 * they have no request/bill context yet (they live only in "ต้องตรวจ" on-screen).
 */
export async function exportReconcileCsv(
  input: ExportReconcileInput,
): Promise<ExportReconcileResult> {
  if (!ledgerPayreqV1()) {
    return { ok: false, error: "ระบบกระทบยอดจ่ายยังไม่เปิดใช้" };
  }

  // ---- gate (mirror requireLedgerAccess + exportConfirmedCsv) ----
  let session: Awaited<ReturnType<typeof requireSession>>;
  try {
    session = await requireSession();
  } catch {
    return { ok: false, error: "unauthorized" };
  }
  if (!isAdminTier(session.user.role)) {
    const has = await userHasModuleAccess(session.user, "ledger");
    if (!has) return { ok: false, error: "ไม่มีสิทธิ์ใช้งานโมดูลนี้" };
  }
  const orgId = session.user.org_id;
  if (!(await ledgerWebCanForRole(orgId, session.user.role, "expense.export"))) {
    return { ok: false, error: "เฉพาะบัญชี/ผู้ดูแลส่งออกได้" };
  }

  if (!input.companyId) return { ok: false, error: "ไม่ได้ระบุบริษัท" };

  // Scope check: the company must belong to the caller's org.
  const companies = await listCompanies(orgId);
  const company = companies.find((c) => c.id === input.companyId);
  if (!company) return { ok: false, error: "ไม่พบบริษัท" };

  // Branch name lookup (companyId-scoped) for the "สาขา" column.
  const branches = await listBranches(orgId, input.companyId);
  const branchName = new Map<string, string>(
    branches.map((b): [string, string] => [b.id, b.name]),
  );

  const filters: ReconcileFilters = {
    branchId: input.branchId ?? null,
    month: input.month ?? null,
    vendor: input.vendor ?? null,
  };
  const data = await listReconcile(orgId, input.companyId, filters);

  // All request buckets flattened (floating slips excluded — see docstring).
  const allRequests: ReconcileRequestRow[] = [
    ...data.awaiting,
    ...data.partial,
    ...data.paid,
    ...data.abnormal,
  ];

  const header = [
    "บริษัท",
    "สาขา",
    "ผู้ขาย",
    "เลขบิล",
    "ยอดบิล",
    "หัก ณ ที่จ่าย",
    "ยอดที่ต้องโอน",
    "ยอดจ่ายแล้ว",
    "สถานะ",
    "เลขอ้างอิงสลิป",
    "วันที่จ่าย",
  ];

  // Slip transRef per request (for the "เลขอ้างอิงสลิป" column) — best-effort: a
  // request may have 1+ slips; we don't re-query payments here to keep the export
  // light. The accountant cross-references the slip in "ต้องตรวจ" if needed.
  const lines: string[] = [header.map(csvCell).join(",")];
  let rowCount = 0;
  for (const req of allRequests) {
    const stateLabel = STATE_LABEL_TH[req.state] ?? req.state;
    const paidDate = isoToThaiDate(req.paidAt);
    const branchLabel = req.branchId ? branchName.get(req.branchId) ?? "" : "";
    if (req.bills.length === 0) {
      // A request with no active bills still belongs in the sheet (one summary row).
      lines.push(
        [
          company.name,
          branchLabel,
          req.vendor ?? "",
          "",
          "",
          baht(req.whtTotal),
          baht(req.expectedTransfer),
          baht(req.paidTotal),
          stateLabel,
          "",
          paidDate,
        ]
          .map(csvCell)
          .join(","),
      );
      rowCount += 1;
      continue;
    }
    for (const bill of req.bills) {
      lines.push(
        [
          company.name,
          branchLabel,
          req.vendor ?? "",
          bill.docCode,
          baht(bill.amount),
          baht(bill.wht),
          baht(req.expectedTransfer),
          baht(req.paidTotal),
          stateLabel,
          "",
          paidDate,
        ]
          .map(csvCell)
          .join(","),
      );
      rowCount += 1;
    }
  }

  if (rowCount === 0) {
    return { ok: false, error: "ไม่มีรายการกระทบยอดในเงื่อนไขที่เลือก" };
  }

  // UTF-8 BOM so Excel renders Thai correctly.
  const csv = "﻿" + lines.join("\r\n") + "\r\n";

  try {
    await audit({
      orgId,
      userId: session.user.id,
      action: "LEDGER_RECONCILE_EXPORTED",
      resourceType: "ledger_payment_request",
      resourceId: input.companyId,
      diff: { new: { rows: rowCount, branchId: filters.branchId, month: filters.month } },
    });
  } catch (err) {
    // The CSV is still useful even if audit logging hiccups — don't block it.
    console.error("[ledger:exportReconcileCsv] audit failed", err);
  }

  const stamp = filters.month && /^\d{4}-\d{2}$/.test(filters.month)
    ? filters.month
    : new Date().toISOString().slice(0, 10);
  const filename = `reconcile-${company.code}-${stamp}.csv`;
  return { ok: true, csv, filename, rows: rowCount };
}
