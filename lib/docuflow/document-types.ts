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

/**
 * Company-switcher scoping Phase 3 (docuflow, 2026-10-11) — DocumentType.
 * companyId is nullable (null = "applies to every company", an explicit
 * design intent per the Prisma schema comment); a non-null value scopes a
 * type to exactly one legal entity. When `companyId` is given, every
 * list* helper below now hides types scoped to the OTHER company instead
 * of showing every org's type regardless of which company is selected
 * (the cross-company leakage the Phase 3 audit flagged — e.g. the upload
 * form's "ประเภทเอกสาร" picker used to show a JP Sync-only type while
 * uploading under Pool Oil). Omit `companyId` to get the old org-wide
 * behavior (used nowhere post-Phase-3, kept optional for safety).
 */
function companyScopeWhere(companyId: string | undefined) {
  return companyId ? { OR: [{ companyId: null }, { companyId }] } : {};
}

/* ============================================================
   listDocumentTypes — all active DocumentType rows for an org
   (no canonical fallback — this is the raw DB read)
   ============================================================ */

export async function listDocumentTypes(
  orgId: string,
  companyId?: string,
): Promise<DocumentTypeRecord[]> {
  const rows = await prisma.documentType.findMany({
    where: { orgId, isActive: true, ...companyScopeWhere(companyId) },
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
  companyId?: string,
): Promise<DocumentTypeRecord[]> {
  const rows = await prisma.documentType.findMany({
    where: { orgId, ...companyScopeWhere(companyId) },
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
  companyId?: string,
): Promise<DocumentTypeOption[]> {
  const rows = await listDocumentTypes(orgId, companyId);
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
   listChecklistRequirements — merged real+canonical requirements list,
   used ONLY by the Checklist compliance page
   (app/(admin)/docuflow/checklist/page.tsx), Pinpoint 18-pt Batch 3
   (2026-10-13).

   This is DELIBERATELY different from listDocumentTypesForBusinessType()
   above. That function is all-or-nothing (real rows win completely the
   moment ANY exist) — correct for the upload-form picker, where showing
   one coherent list matters more than exhaustiveness. But the Checklist
   page's whole purpose is "never let a legally-required document silently
   disappear" ("ขาดแม้แต่ใบเดียวก็โดนปิดสาขา/ปรับ" per the page's own copy) —
   if an admin creates ONE custom org-specific checklist item for a
   business type, the all-or-nothing rule would hide every other static
   legal requirement for that business type from the compliance view,
   which is a correctness regression for a compliance tool, not a cosmetic
   one.

   So this ADDITIVELY merges:
     - every real active DocumentType row for this org+businessType
       (includes rows created via the admin CRUD UI at
       /docuflow/settings/document-types, whether genuinely custom or
       previously imported from the canonical list)
     - every canonical-docs.ts spec NOT already covered by a real row,
       matched by canonicalKey (set when a row was created via the
       explicit "นำเข้าจากรายการมาตรฐาน" import action) OR by exact
       case-insensitive name (covers a manually-created row that happens
       to share a canonical item's name without going through import)

   Read-time only; nothing written here. Company-unscoped on purpose —
   this page has never had a company switcher (shows every company's
   requirements org-wide), so this keeps that existing behavior rather
   than introducing new scoping as a side effect of this fix.
   ============================================================ */

export async function listChecklistRequirements(
  orgId: string,
  businessType: string,
): Promise<DocumentTypeOption[]> {
  const rows = await prisma.documentType.findMany({
    where: { orgId, isActive: true, businessType },
    orderBy: { name: "asc" },
  });

  const real: DocumentTypeOption[] = rows.map((row) => ({
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

  const coveredKeys = new Set(
    rows.map((r) => r.canonicalKey).filter((k): k is string => !!k),
  );
  const coveredNames = new Set(rows.map((r) => r.name.trim().toLowerCase()));

  const canonicalFallback: DocumentTypeOption[] = getCanonicalDocsForBizType(
    businessType,
  )
    .filter(
      (spec) =>
        !coveredKeys.has(spec.name) &&
        !coveredNames.has(spec.name.trim().toLowerCase()),
    )
    .map((spec) => ({
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

  return [...real, ...canonicalFallback];
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
