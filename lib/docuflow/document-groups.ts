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
}

function toDocumentGroupRecord(row: {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
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
