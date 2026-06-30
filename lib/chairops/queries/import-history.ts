// ============================================================
// CSV Import History — CEO 2026-06-30
// ============================================================
// "พนักงานกดนำเข้าเงินฝาก CSV แต่ผม super admin ไม่เห็น แล้วอยากกดลบได้"
//
// One place that lists EVERY maid-collection CSV import (across branches and
// the full date window — so it can't hide behind the ledger's per-branch /
// 30-day default), grouped into the batch each commit wrote. From here the
// super_admin can soft-delete a whole import or a single row (reversible).
//
// Grouping key:
//   - importBatchId   (new imports, stamped per commit)  → one row per commit
//   - "legacy:<importedById>:<bangkok-day>"  (rows imported before the column
//     existed)  → best-effort grouping so old imports are still listable.
//
// IMPORTANT: this query deliberately does NOT filter `deletedAt` — the history
// must show deleted batches too so the CEO can RESTORE them. Every OTHER read
// in the system hides deletedAt != null. See [[chairops-csv-import-visibility-delete]].
// ============================================================

import { prisma } from "@/lib/prisma";

function isoDay(d: Date): string {
  return new Date(d.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
}
function fmtDateTime(d: Date): string {
  const ms = d.getTime() + 7 * 3_600_000;
  const u = new Date(ms);
  const M = String(u.getUTCMonth() + 1).padStart(2, "0");
  const D = String(u.getUTCDate()).padStart(2, "0");
  const h = String(u.getUTCHours()).padStart(2, "0");
  const m = String(u.getUTCMinutes()).padStart(2, "0");
  return `${u.getUTCFullYear()}-${M}-${D} ${h}:${m}`;
}

export interface CsvImportRow {
  id: string;
  collectedAt: string;
  branchName: string;
  maidName: string;
  countedAmount: number;
  source: "CSV_IMPORT" | "OFFICE_PROXY";
  hasSlip: boolean;
  deposited: boolean;
  deleted: boolean;
}

export interface CsvImportBatch {
  key: string;
  isRealBatch: boolean;
  importedAt: string;
  importedByName: string;
  branchLabel: string;
  rowCount: number;
  deletedRowCount: number;
  totalAmount: number;
  deletedTotalAmount: number;
  collectedFrom: string | null;
  collectedTo: string | null;
  /** active = nothing deleted · partial = some · deleted = all rows deleted */
  status: "active" | "partial" | "deleted";
  deletedAt: string | null;
  deletedByName: string | null;
  deleteReason: string | null;
  /** has any row already linked to a bank deposit (extra warning before delete). */
  hasDeposited: boolean;
  activeIds: string[];
  deletedIds: string[];
  rows: CsvImportRow[];
}

export async function getCsvImportHistory(args: {
  orgId: string;
}): Promise<CsvImportBatch[]> {
  const { orgId } = args;
  // Imported rows only (CSV_IMPORT + OFFICE_PROXY). Include deleted ones so the
  // CEO can restore. Org-scoped (multi-tenant).
  const rows = await prisma.chairopsCashCollection.findMany({
    where: { orgId, source: { in: ["CSV_IMPORT", "OFFICE_PROXY"] } },
    select: {
      id: true,
      collectedAt: true,
      countedAmount: true,
      source: true,
      slipPhotoUrl: true,
      depositId: true,
      importBatchId: true,
      importedById: true,
      createdAt: true,
      deletedAt: true,
      deletedById: true,
      deleteReason: true,
      branch: { select: { name: true } },
      importer: { select: { displayName: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // Resolve the display name of whoever DELETED each batch (deletedById has no
  // Prisma relation — look the ids up in one query).
  const deleterIds = [
    ...new Set(rows.map((r) => r.deletedById).filter((x): x is string => !!x)),
  ];
  const deleters = deleterIds.length
    ? await prisma.chairopsUser.findMany({
        where: { id: { in: deleterIds } },
        select: { id: true, displayName: true },
      })
    : [];
  const deleterName = new Map(deleters.map((u) => [u.id, u.displayName]));

  // Group into batches.
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key =
      r.importBatchId ??
      `legacy:${r.importedById ?? "unknown"}:${isoDay(r.createdAt)}`;
    const arr = groups.get(key) ?? [];
    arr.push(r);
    groups.set(key, arr);
  }

  const batches: CsvImportBatch[] = [];
  for (const [key, grp] of groups) {
    const active = grp.filter((r) => r.deletedAt == null);
    const deleted = grp.filter((r) => r.deletedAt != null);
    const branchNames = [...new Set(grp.map((r) => r.branch.name))];
    const collectedTimes = grp.map((r) => r.collectedAt.getTime());
    const importedAt = grp.reduce(
      (min, r) => (r.createdAt.getTime() < min ? r.createdAt.getTime() : min),
      grp[0].createdAt.getTime(),
    );
    const firstDeleted = deleted[0];
    batches.push({
      key,
      isRealBatch: !!grp[0].importBatchId,
      importedAt: fmtDateTime(new Date(importedAt)),
      importedByName: grp.find((r) => r.importer?.displayName)?.importer
        ?.displayName ?? "—",
      branchLabel:
        branchNames.length === 1
          ? branchNames[0]
          : `${branchNames.length} สาขา`,
      rowCount: active.length,
      deletedRowCount: deleted.length,
      totalAmount: active.reduce((s, r) => s + r.countedAmount, 0),
      deletedTotalAmount: deleted.reduce((s, r) => s + r.countedAmount, 0),
      collectedFrom: collectedTimes.length
        ? isoDay(new Date(Math.min(...collectedTimes)))
        : null,
      collectedTo: collectedTimes.length
        ? isoDay(new Date(Math.max(...collectedTimes)))
        : null,
      status:
        deleted.length === 0
          ? "active"
          : active.length === 0
            ? "deleted"
            : "partial",
      deletedAt: firstDeleted?.deletedAt
        ? fmtDateTime(firstDeleted.deletedAt)
        : null,
      deletedByName: firstDeleted?.deletedById
        ? deleterName.get(firstDeleted.deletedById) ?? "—"
        : null,
      deleteReason: firstDeleted?.deleteReason ?? null,
      hasDeposited: grp.some((r) => r.depositId != null),
      activeIds: active.map((r) => r.id),
      deletedIds: deleted.map((r) => r.id),
      rows: grp.map((r) => ({
        id: r.id,
        collectedAt: fmtDateTime(r.collectedAt),
        branchName: r.branch.name,
        maidName: r.importer?.displayName ?? "—",
        countedAmount: r.countedAmount,
        source: (r.source === "OFFICE_PROXY" ? "OFFICE_PROXY" : "CSV_IMPORT") as
          | "CSV_IMPORT"
          | "OFFICE_PROXY",
        hasSlip: !!r.slipPhotoUrl,
        deposited: r.depositId != null,
        deleted: r.deletedAt != null,
      })),
    });
  }

  // Newest import first.
  batches.sort((a, b) => (a.importedAt < b.importedAt ? 1 : -1));
  return batches;
}
