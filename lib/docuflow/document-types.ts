// DOCUMENT TYPES — data-access helpers for the DocuFlow redesign Track A Item 3
// ────────────────────────────────────────────────────────────────────
// The org-managed `document_types` table is additive alongside the legacy free-text
// `documents.document_type` string column (untouched, still works for back-compat).
//
// Hybrid model: real DB rows always win. When an org has zero DocumentType rows for a
// given business type, listDocumentTypesForBusinessType() falls back to the static
// industry-standard list in canonical-docs.ts so the UI never shows an empty list on
// day one. This is a READ-TIME fallback only — nothing is written/backfilled here.
// A separate, explicit "import from canonical list" admin action is the only path
// that turns a canonical entry into a real row — see importCanonicalDocTypesForBizType()
// below, wired to POST /api/docuflow/document-types/import (settings hub Item 1).
//
// Consumers (Item 1 — DocuFlow redesign Track A):
//   - app/api/docuflow/document-types/route.ts (GET/POST)
//   - app/api/docuflow/document-types/[id]/route.ts (PATCH/DELETE)
//   - app/api/docuflow/document-types/import/route.ts (POST, canonical bulk import)
//   - app/(admin)/docuflow/settings/document-types/page.tsx (admin CRUD page)
//   - app/(admin)/docuflow/documents/page.tsx (documentTypeId filter chip)
// ────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { getCanonicalDocsForBizType } from "./canonical-docs";

/* ============================================================
   TYPES
   ============================================================ */

export interface DocumentTypeRecord {
  id: string;
  orgId: string;
  name: string;
  category: string | null;
  businessType: string | null;
  companyId: string | null;
  frequency: string | null;
  dangerLevel: string | null;
  regulator: string | null;
  description: string | null;
  canonicalKey: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A document-type option ready for UI consumption — either a real DB row
 * (`isCanonical: false`, `id` populated) or a read-time fallback entry synthesized
 * from canonical-docs.ts (`isCanonical: true`, `id: null` — nothing has been
 * written to the DB for it).
 */
export interface DocumentTypeOption {
  id: string | null;
  name: string;
  category: string | null;
  businessType: string | null;
  companyId: string | null;
  frequency: string | null;
  dangerLevel: string | null;
  regulator: string | null;
  description: string | null;
  canonicalKey: string | null;
  isCanonical: boolean;
}

function toDocumentTypeRecord(row: {
  id: string;
  orgId: string;
  name: string;
  category: string | null;
  businessType: string | null;
  companyId: string | null;
  frequency: string | null;
  dangerLevel: string | null;
  regulator: string | null;
  description: string | null;
  canonicalKey: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}): DocumentTypeRecord {
  return { ...row };
}

/* ============================================================
   listDocumentTypes — all active DocumentType rows for an org
   (no canonical fallback — this is the raw DB read)
   ============================================================ */

export async function listDocumentTypes(
  orgId: string,
): Promise<DocumentTypeRecord[]> {
  const rows = await prisma.documentType.findMany({
    where: { orgId, isActive: true },
    orderBy: { name: "asc" },
  });
  return rows.map(toDocumentTypeRecord);
}

/* ============================================================
   listAllDocumentTypesForAdmin — active + inactive rows for an org.
   Used ONLY by the settings/document-types management page so an
   admin can see (and reactivate) soft-deleted rows — every other
   consumer (filters, upload form) should keep using listDocumentTypes()
   above, which deliberately hides inactive rows.
   ============================================================ */

export async function listAllDocumentTypesForAdmin(
  orgId: string,
): Promise<DocumentTypeRecord[]> {
  const rows = await prisma.documentType.findMany({
    where: { orgId },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });
  return rows.map(toDocumentTypeRecord);
}

/* ============================================================
   listDocumentTypesForBusinessType — read-time fallback to
   canonical-docs.ts when the org has zero rows for this biz type.
   Does NOT write/backfill anything to the DB.
   ============================================================ */

export async function listDocumentTypesForBusinessType(
  orgId: string,
  businessType: string,
): Promise<DocumentTypeOption[]> {
  const rows = await prisma.documentType.findMany({
    where: { orgId, isActive: true, businessType },
    orderBy: { name: "asc" },
  });

  if (rows.length > 0) {
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      category: row.category,
      businessType: row.businessType,
      companyId: row.companyId,
      frequency: row.frequency,
      dangerLevel: row.dangerLevel,
      regulator: row.regulator,
      description: row.description,
      canonicalKey: row.canonicalKey,
      isCanonical: false,
    }));
  }

  // Zero real rows for this business type — fall back to the static canonical list so
  // the UI never shows an empty list on day one. Read-time only; nothing written here.
  return getCanonicalDocsForBizType(businessType).map((spec) => ({
    id: null,
    name: spec.name,
    category: spec.category,
    businessType,
    companyId: null,
    frequency: spec.frequency,
    dangerLevel: spec.dangerLevel,
    regulator: spec.regulator,
    description: spec.description,
    canonicalKey: spec.name,
    isCanonical: true,
  }));
}

/* ============================================================
   listDocumentTypesForUpload — the upload form's type-picker.
   Real rows only — NO canonical-catalog fallback. CEO feedback
   2026-09-24: document types must be what the admin actually
   configured ("ตั้งชื่อประเภทเอกสารเอง ไม่ใช่โผล่มาทุกเอกสาร"), not an
   auto-dumped generic list merged across every business type. When
   an org has zero real DocumentType rows, the picker is simply
   empty — that's correct, not a bug to paper over.

   NOTE: listDocumentTypesForBusinessType() above (used by the
   Checklist feature) intentionally keeps its canonical fallback —
   that one is unrelated to this fix and must stay untouched.
   ============================================================ */

export async function listDocumentTypesForUpload(
  orgId: string,
): Promise<DocumentTypeOption[]> {
  const rows = await listDocumentTypes(orgId);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    businessType: row.businessType,
    companyId: row.companyId,
    frequency: row.frequency,
    dangerLevel: row.dangerLevel,
    regulator: row.regulator,
    description: row.description,
    canonicalKey: row.canonicalKey,
    isCanonical: false,
  }));
}

/* ============================================================
   CRUD helpers — org-scoped wrappers used by the settings CRUD API
   routes (app/api/docuflow/document-types/**).
   ============================================================ */

export interface CreateDocumentTypeInput {
  name: string;
  category?: string | null;
  businessType?: string | null;
  companyId?: string | null;
  frequency?: string | null;
  dangerLevel?: string | null;
  regulator?: string | null;
  description?: string | null;
  canonicalKey?: string | null;
}

export async function createDocumentType(
  orgId: string,
  input: CreateDocumentTypeInput,
): Promise<DocumentTypeRecord> {
  const row = await prisma.documentType.create({
    data: {
      orgId,
      name: input.name,
      category: input.category ?? null,
      businessType: input.businessType ?? null,
      companyId: input.companyId ?? null,
      frequency: input.frequency ?? null,
      dangerLevel: input.dangerLevel ?? null,
      regulator: input.regulator ?? null,
      description: input.description ?? null,
      canonicalKey: input.canonicalKey ?? null,
    },
  });
  return toDocumentTypeRecord(row);
}

export type UpdateDocumentTypeInput = Partial<CreateDocumentTypeInput> & {
  /** Deactivate/reactivate — lets the same PATCH endpoint power both the
      "ปิดใช้งาน" (soft-delete via softDeleteDocumentType below) button AND
      an "เปิดใช้งานอีกครั้ง" reactivate action from the admin management page. */
  isActive?: boolean;
};

/**
 * Org-scoped update. Throws if the row doesn't belong to this org (or doesn't
 * exist) rather than silently no-op-ing — `updateMany`'s count is checked.
 */
export async function updateDocumentType(
  orgId: string,
  id: string,
  input: UpdateDocumentTypeInput,
): Promise<DocumentTypeRecord> {
  const result = await prisma.documentType.updateMany({
    where: { id, orgId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.category !== undefined ? { category: input.category } : {}),
      ...(input.businessType !== undefined
        ? { businessType: input.businessType }
        : {}),
      ...(input.companyId !== undefined ? { companyId: input.companyId } : {}),
      ...(input.frequency !== undefined ? { frequency: input.frequency } : {}),
      ...(input.dangerLevel !== undefined
        ? { dangerLevel: input.dangerLevel }
        : {}),
      ...(input.regulator !== undefined ? { regulator: input.regulator } : {}),
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
      ...(input.canonicalKey !== undefined
        ? { canonicalKey: input.canonicalKey }
        : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  });

  if (result.count === 0) {
    throw new Error(
      `DocumentType ${id} not found for org ${orgId} (or already deleted)`,
    );
  }

  const row = await prisma.documentType.findUniqueOrThrow({ where: { id } });
  return toDocumentTypeRecord(row);
}

/**
 * Soft-delete — sets isActive: false, org-scoped. Matches the module's existing
 * soft-delete convention (Document.isActive, Vehicle.isActive).
 */
export async function softDeleteDocumentType(
  orgId: string,
  id: string,
): Promise<void> {
  const result = await prisma.documentType.updateMany({
    where: { id, orgId },
    data: { isActive: false },
  });

  if (result.count === 0) {
    throw new Error(
      `DocumentType ${id} not found for org ${orgId} (or already deleted)`,
    );
  }
}

/* ============================================================
   importCanonicalDocTypesForBizType — the ONE explicit, admin-triggered
   path that turns canonical-docs.ts entries into real DocumentType rows.
   Never called automatically — only from the settings/document-types
   page's "นำเข้าจากรายการมาตรฐาน" button via the import API route.

   Uses createMany + skipDuplicates so re-running the import for a biz
   type that already has some rows is a safe, idempotent no-op for the
   names that already exist (unique on [orgId, name]).
   ============================================================ */

export interface ImportCanonicalResult {
  /** How many new rows were actually written. */
  created: number;
  /** How many canonical entries were skipped because a row with that
      name already existed for this org (duplicate, not an error). */
  skipped: number;
}

export async function importCanonicalDocTypesForBizType(
  orgId: string,
  businessType: string,
): Promise<ImportCanonicalResult> {
  const specs = getCanonicalDocsForBizType(businessType);
  if (specs.length === 0) {
    return { created: 0, skipped: 0 };
  }

  const result = await prisma.documentType.createMany({
    data: specs.map((spec) => ({
      orgId,
      name: spec.name,
      category: spec.category,
      businessType,
      frequency: spec.frequency,
      dangerLevel: spec.dangerLevel,
      regulator: spec.regulator,
      description: spec.description,
      canonicalKey: spec.name,
    })),
    skipDuplicates: true,
  });

  return { created: result.count, skipped: specs.length - result.count };
}
