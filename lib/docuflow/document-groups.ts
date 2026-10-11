// DOCUMENT GROUPS — data-access helpers for the DocuFlow redesign
// ────────────────────────────────────────────────────────────────────
// A SECOND, INDEPENDENT taxonomy dimension alongside DocumentType (see
// lib/docuflow/document-types.ts). NOT the hardcoded browse-page category tiles
// ("เอกสารนิติบุคคล/ภาษี/ประกัน") — this is a brand new, freely-defined grouping
// concept an org can use for anything beyond "type".
//
// Unlike DocumentType, there is NO canonical/static catalog backing this and NO
// read-time fallback — groups are whatever the admin actually creates. Real DB
// rows only, always.
//
// Consumers:
//   - app/api/docuflow/document-groups/route.ts (GET/POST)
//   - app/api/docuflow/document-groups/[id]/route.ts (PATCH/DELETE)
//   - app/(admin)/docuflow/settings/document-groups/page.tsx (admin CRUD page)
// ────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";

/* ============================================================
   TYPES
   ============================================================ */

export interface DocumentGroupRecord {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  /** Nested-folder tree fields (2026-10-11) — null on every pre-existing
   *  top-level group created before this feature. */
  companyId: string | null;
  parentGroupId: string | null;
}

function toDocumentGroupRecord(row: {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  companyId: string | null;
  parentGroupId: string | null;
}): DocumentGroupRecord {
  return { ...row };
}

/* ============================================================
   listDocumentGroups — active DocumentGroup rows for an org
   ============================================================ */

export async function listDocumentGroups(
  orgId: string,
): Promise<DocumentGroupRecord[]> {
  const rows = await prisma.documentGroup.findMany({
    where: { orgId, isActive: true },
    orderBy: { name: "asc" },
  });
  return rows.map(toDocumentGroupRecord);
}

/* ============================================================
   listAllDocumentGroupsForAdmin — active + inactive rows for an org.
   Used ONLY by the settings/document-groups management page so an
   admin can see (and reactivate) soft-deleted rows — every other
   consumer should keep using listDocumentGroups() above, which
   deliberately hides inactive rows.
   ============================================================ */

export async function listAllDocumentGroupsForAdmin(
  orgId: string,
): Promise<DocumentGroupRecord[]> {
  const rows = await prisma.documentGroup.findMany({
    where: { orgId },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });
  return rows.map(toDocumentGroupRecord);
}

/* ============================================================
   CRUD helpers — org-scoped wrappers used by the settings CRUD API
   routes (app/api/docuflow/document-groups/**).
   ============================================================ */

export interface CreateDocumentGroupInput {
  name: string;
  description?: string | null;
}

export async function createDocumentGroup(
  orgId: string,
  input: CreateDocumentGroupInput,
): Promise<DocumentGroupRecord> {
  const row = await prisma.documentGroup.create({
    data: {
      orgId,
      name: input.name,
      description: input.description ?? null,
    },
  });
  return toDocumentGroupRecord(row);
}

export type UpdateDocumentGroupInput = Partial<CreateDocumentGroupInput> & {
  /** Deactivate/reactivate — lets the same PATCH endpoint power both the
      "ปิดใช้งาน" (soft-delete via softDeleteDocumentGroup below) button AND
      an "เปิดใช้งานอีกครั้ง" reactivate action from the admin management page. */
  isActive?: boolean;
};

/**
 * Org-scoped update. Throws if the row doesn't belong to this org (or doesn't
 * exist) rather than silently no-op-ing — `updateMany`'s count is checked.
 */
export async function updateDocumentGroup(
  orgId: string,
  id: string,
  input: UpdateDocumentGroupInput,
): Promise<DocumentGroupRecord> {
  const result = await prisma.documentGroup.updateMany({
    where: { id, orgId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  });

  if (result.count === 0) {
    throw new Error(
      `DocumentGroup ${id} not found for org ${orgId} (or already deleted)`,
    );
  }

  const row = await prisma.documentGroup.findUniqueOrThrow({ where: { id } });
  return toDocumentGroupRecord(row);
}

/**
 * Soft-delete — sets isActive: false, org-scoped. Matches the module's existing
 * soft-delete convention (Document.isActive, DocumentType.isActive).
 */
export async function softDeleteDocumentGroup(
  orgId: string,
  id: string,
): Promise<void> {
  const result = await prisma.documentGroup.updateMany({
    where: { id, orgId },
    data: { isActive: false },
  });

  if (result.count === 0) {
    throw new Error(
      `DocumentGroup ${id} not found for org ${orgId} (or already deleted)`,
    );
  }
}

/* ============================================================
   NESTED FOLDER TREE — CEO feedback 2026-10-11
   ────────────────────────────────────────────────────────────
   Unlimited-depth folders scoped per company, browsed via a vertical
   drill-down UI (not a sidebar tree — one level's children at a time,
   tap to go deeper). Replaces the derived "ประเภทธุรกิจ" buckets in the
   "ตามบริษัท" tree view for that one screen only — business_type stays
   as a real DocumentOwnership level everywhere else (upload picker,
   level filter chips, etc.), untouched.

   No re-parenting (move a folder to a different parent) in this version
   — create/rename/delete only, so no cycle-prevention logic is needed.
   ============================================================ */

export interface DocumentGroupNode {
  id: string;
  name: string;
  description: string | null;
  companyId: string | null;
  parentGroupId: string | null;
  childCount: number;
  documentCount: number;
}

/**
 * Children of a given folder (or the top-level folders directly under a
 * company, when `parentGroupId` is null) — one drill-down screen's worth.
 * Includes live counts so the UI can show "3 โฟลเดอร์ · 5 เอกสาร" without a
 * second round-trip.
 */
export async function listDocumentGroupChildren(
  orgId: string,
  companyId: string,
  parentGroupId: string | null,
): Promise<DocumentGroupNode[]> {
  const rows = await prisma.documentGroup.findMany({
    where: { orgId, companyId, parentGroupId, isActive: true },
    orderBy: { name: "asc" },
    include: {
      _count: {
        select: {
          childGroups: { where: { isActive: true } },
          documents: { where: { isActive: true } },
        },
      },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    companyId: r.companyId,
    parentGroupId: r.parentGroupId,
    childCount: r._count.childGroups,
    documentCount: r._count.documents,
  }));
}

/** Single folder, org-scoped — used to render the current folder's own
 *  name/description at the top of a drill-down screen. */
export async function getDocumentGroupNode(
  orgId: string,
  id: string,
): Promise<DocumentGroupNode | null> {
  const row = await prisma.documentGroup.findFirst({
    where: { id, orgId, isActive: true },
    include: {
      _count: {
        select: {
          childGroups: { where: { isActive: true } },
          documents: { where: { isActive: true } },
        },
      },
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    companyId: row.companyId,
    parentGroupId: row.parentGroupId,
    childCount: row._count.childGroups,
    documentCount: row._count.documents,
  };
}

export interface BreadcrumbEntry {
  id: string;
  name: string;
}

/** Root-to-current path for the breadcrumb bar. Depth is bounded by
 *  however deep the admin actually nested folders (realistically single
 *  digits) — a plain walk-up-the-chain loop is simpler and cheap enough
 *  at this scale, no recursive CTE needed. */
export async function getDocumentGroupBreadcrumb(
  orgId: string,
  groupId: string,
): Promise<BreadcrumbEntry[]> {
  const path: BreadcrumbEntry[] = [];
  let currentId: string | null = groupId;
  // Hard cap purely as a safety net against a corrupted/cyclic chain —
  // this version never lets a cycle form (no re-parenting), so this
  // should never actually trigger.
  for (let i = 0; i < 50 && currentId; i++) {
    const row: { id: string; name: string; parentGroupId: string | null } | null =
      await prisma.documentGroup.findFirst({
        where: { id: currentId, orgId },
        select: { id: true, name: true, parentGroupId: true },
      });
    if (!row) break;
    path.unshift({ id: row.id, name: row.name });
    currentId = row.parentGroupId;
  }
  return path;
}

export interface CreateNestedDocumentGroupInput {
  companyId: string;
  /** null = create at the top level, directly under the company */
  parentGroupId: string | null;
  name: string;
  description?: string | null;
}

/**
 * Creates a folder under a company (and optionally under a parent folder).
 * Validates:
 *   - the company belongs to this org and is active
 *   - if parentGroupId is given, that folder belongs to this org, is
 *     active, AND belongs to the SAME company (folders don't span
 *     companies — prevents a confusing cross-company nested tree)
 *   - no active sibling already has this exact name (app-layer check,
 *     not a DB constraint — see migration.sql for why)
 */
export async function createNestedDocumentGroup(
  orgId: string,
  input: CreateNestedDocumentGroupInput,
): Promise<DocumentGroupRecord> {
  const name = input.name.trim();
  if (!name) {
    throw new Error("ชื่อโฟลเดอร์ห้ามว่าง");
  }

  const company = await prisma.company.findFirst({
    where: { id: input.companyId, orgId, isActive: true },
    select: { id: true },
  });
  if (!company) {
    throw new Error("ไม่พบบริษัทนี้");
  }

  if (input.parentGroupId) {
    const parent = await prisma.documentGroup.findFirst({
      where: {
        id: input.parentGroupId,
        orgId,
        isActive: true,
        companyId: input.companyId,
      },
      select: { id: true },
    });
    if (!parent) {
      throw new Error("ไม่พบโฟลเดอร์แม่ (อาจถูกลบไปแล้ว)");
    }
  }

  const sibling = await prisma.documentGroup.findFirst({
    where: {
      orgId,
      companyId: input.companyId,
      parentGroupId: input.parentGroupId,
      isActive: true,
      name,
    },
    select: { id: true },
  });
  if (sibling) {
    throw new Error(`มีโฟลเดอร์ชื่อ "${name}" อยู่ในตำแหน่งนี้แล้ว`);
  }

  const row = await prisma.documentGroup.create({
    data: {
      orgId,
      companyId: input.companyId,
      parentGroupId: input.parentGroupId,
      name,
      description: input.description?.trim() || null,
    },
  });
  return toDocumentGroupRecord(row);
}

/**
 * Deletes a folder in the nested tree — rejects if it still has active
 * child folders OR active documents placed directly in it (idempotency/
 * data-consistency guard: never silently orphans a subtree or a
 * document's group reference).
 */
export async function deleteDocumentGroupNode(
  orgId: string,
  id: string,
): Promise<void> {
  const node = await prisma.documentGroup.findFirst({
    where: { id, orgId, isActive: true },
    include: {
      _count: {
        select: {
          childGroups: { where: { isActive: true } },
          documents: { where: { isActive: true } },
        },
      },
    },
  });
  if (!node) {
    throw new Error("ไม่พบโฟลเดอร์นี้");
  }
  if (node._count.childGroups > 0) {
    throw new Error("ต้องลบ/ย้ายโฟลเดอร์ย่อยข้างในออกก่อน");
  }
  if (node._count.documents > 0) {
    throw new Error("ต้องย้าย/ลบเอกสารในโฟลเดอร์นี้ออกก่อน");
  }
  await softDeleteDocumentGroup(orgId, id);
}
