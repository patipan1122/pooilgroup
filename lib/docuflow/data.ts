// CANONICAL DATA LOADERS · DocuFlow Single Source of Truth
// ────────────────────────────────────────────────────────────────────
// อ่านก่อนแก้: feedback_single_source_of_truth.md
//
// ทุก UI/page/component ที่ต้องการข้อมูลเอกสาร DocuFlow (documents,
// document_ownership, document_tags, document_renewals) ต้องผ่านฟังก์ชัน
// ในไฟล์นี้ ห้ามเรียก Prisma/Supabase ตรงๆ
//
// ข้อยกเว้น:
//   - API mutation routes ที่ fetch by primary key (download URL, update)
//   - Migration / seed scripts
// ────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import {
  type ExpiryStatus,
  daysUntilExpiry,
  getExpiryStatus,
} from "./expiry";

/* ============================================================
   TYPES — canonical shapes (ทุก consumer ใช้เหมือนกัน)
   ============================================================ */

export interface CanonicalDocument {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  fileKey: string;
  filePublicUrl: string | null;
  mimeType: string | null;
  fileSize: number | null;
  uploadedById: string | null;
  uploadedAt: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  /** Levels assigned to this doc (group/company/business_type/branch/person) */
  ownership: CanonicalOwnership[];
  /** Tag strings assigned to this doc */
  tags: string[];
  /** Most recent active renewal (if any) */
  renewal: CanonicalRenewal | null;
}

export interface CanonicalOwnership {
  id: string;
  level: string;
  companyId: string | null;
  branchId: string | null;
  personId: string | null;
  businessType: string | null;
}

export interface CanonicalRenewal {
  id: string;
  documentId: string;
  expiryDate: Date;
  renewalPeriodYears: number | null;
  alertDays: number[];
  responsibleUserId: string | null;
  status: string;
  lastRenewedDate: Date | null;
  nextRenewalDate: Date | null;
  notes: string | null;
  /** Derived — days until expiry (negative = expired) */
  daysUntilExpiry: number;
  /** Derived — bucket: expired/critical/urgent/watch/normal */
  expiryStatus: ExpiryStatus;
}

/* ============================================================
   loadDocuments — paginated document list with relations
   ============================================================ */

export interface LoadDocumentsOpts {
  /** Filter by ownership level (group/company/business_type/branch/person) */
  level?: string;
  /** Filter by branch (in document_ownership) */
  branchId?: string;
  /** Filter by company (in document_ownership) */
  companyId?: string;
  /** Filter by business type (in document_ownership) */
  businessType?: string;
  /** Filter by tag (string match in document_tags) */
  tag?: string;
  /** Filter by computed expiry status (renewal must exist) */
  expiryStatus?: ExpiryStatus;
  /** Default: true — only active documents (soft-delete aware) */
  isActive?: boolean;
  /** Free-text search (name + description, case-insensitive) */
  search?: string;
  /** Cursor-based pagination — pass last id from previous page */
  cursor?: string;
  /** Page size (default 50, max 200) */
  limit?: number;
}

export async function loadDocuments(
  orgId: string,
  opts: LoadDocumentsOpts = {},
): Promise<CanonicalDocument[]> {
  const {
    level,
    branchId,
    companyId,
    businessType,
    tag,
    expiryStatus,
    isActive = true,
    search,
    cursor,
    limit = 50,
  } = opts;

  const safeLimit = Math.min(Math.max(limit, 1), 200);

  // Compose ownership filter (joined via `some` on the relation)
  const ownershipFilter:
    | {
        level?: string;
        branchId?: string;
        companyId?: string;
        businessType?: string;
      }
    | undefined =
    level || branchId || companyId || businessType
      ? {
          ...(level ? { level } : {}),
          ...(branchId ? { branchId } : {}),
          ...(companyId ? { companyId } : {}),
          ...(businessType ? { businessType } : {}),
        }
      : undefined;

  const docs = await prisma.document.findMany({
    where: {
      orgId,
      ...(isActive !== undefined ? { isActive } : {}),
      ...(ownershipFilter ? { ownership: { some: ownershipFilter } } : {}),
      ...(tag ? { tags: { some: { tag } } } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { description: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: {
      ownership: true,
      tags: true,
      renewals: {
        orderBy: { expiryDate: "asc" },
        take: 1,
      },
    },
    orderBy: { uploadedAt: "desc" },
    take: safeLimit,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
  });

  const mapped = docs.map(toCanonicalDocument);

  // Post-filter by computed expiry status (no DB-level enum)
  if (expiryStatus) {
    return mapped.filter((d) => d.renewal?.expiryStatus === expiryStatus);
  }
  return mapped;
}

/* ============================================================
   loadDocumentById — single doc with full relations
   ============================================================ */

export async function loadDocumentById(
  orgId: string,
  id: string,
): Promise<CanonicalDocument | null> {
  const doc = await prisma.document.findFirst({
    where: { id, orgId },
    include: {
      ownership: true,
      tags: true,
      renewals: {
        orderBy: { expiryDate: "asc" },
        take: 1,
      },
    },
  });
  if (!doc) return null;
  return toCanonicalDocument(doc);
}

/* ============================================================
   loadDocumentsSharedToBranch — เอกสารที่ถูก share มาที่สาขานี้
   ผ่านตาราง document_shared_branches (cross-branch sharing)
   ============================================================ */

export async function loadDocumentsSharedToBranch(
  orgId: string,
  branchId: string,
  opts: { isActive?: boolean; limit?: number } = {},
): Promise<CanonicalDocument[]> {
  const { isActive = true, limit = 200 } = opts;
  const safeLimit = Math.min(Math.max(limit, 1), 500);

  const docs = await prisma.document.findMany({
    where: {
      orgId,
      ...(isActive !== undefined ? { isActive } : {}),
      sharedBranches: { some: { branchId } },
    },
    include: {
      ownership: true,
      tags: true,
      renewals: {
        orderBy: { expiryDate: "asc" },
        take: 1,
      },
    },
    orderBy: { uploadedAt: "desc" },
    take: safeLimit,
  });

  return docs.map(toCanonicalDocument);
}

/* ============================================================
   loadRenewals — direct query on document_renewals
   For the expiry dashboard / cron job
   ============================================================ */

export interface LoadRenewalsOpts {
  /** Only renewals expiring on/before this many days from now (default 90) */
  withinDays?: number;
  /** Filter by status (pending|in_progress|renewed|overdue) */
  status?: string;
  /** Exclude these statuses (default: ["renewed"]) */
  excludeStatuses?: string[];
  /** Filter by responsible user */
  responsibleUserId?: string;
  /** Filter by specific document */
  documentId?: string;
}

export interface RenewalWithDocument extends CanonicalRenewal {
  document: {
    id: string;
    name: string;
    fileKey: string;
    isActive: boolean;
  };
}

export async function loadRenewals(
  orgId: string,
  opts: LoadRenewalsOpts = {},
): Promise<RenewalWithDocument[]> {
  const {
    withinDays = 90,
    status,
    excludeStatuses = ["renewed"],
    responsibleUserId,
    documentId,
  } = opts;

  const horizon = new Date();
  horizon.setUTCDate(horizon.getUTCDate() + withinDays);

  const rows = await prisma.documentRenewal.findMany({
    where: {
      orgId,
      ...(documentId ? { documentId } : {}),
      ...(responsibleUserId ? { responsibleUserId } : {}),
      ...(status ? { status } : {}),
      ...(excludeStatuses.length > 0
        ? { NOT: { status: { in: excludeStatuses } } }
        : {}),
      expiryDate: { lte: horizon },
      document: { isActive: true },
    },
    include: {
      document: {
        select: { id: true, name: true, fileKey: true, isActive: true },
      },
    },
    orderBy: { expiryDate: "asc" },
  });

  return rows.map((r) => ({
    id: r.id,
    documentId: r.documentId,
    expiryDate: r.expiryDate,
    renewalPeriodYears: r.renewalPeriodYears,
    alertDays: r.alertDays,
    responsibleUserId: r.responsibleUserId,
    status: r.status,
    lastRenewedDate: r.lastRenewedDate,
    nextRenewalDate: r.nextRenewalDate,
    notes: r.notes,
    daysUntilExpiry: daysUntilExpiry(r.expiryDate),
    expiryStatus: getExpiryStatus(r.expiryDate),
    document: r.document,
  }));
}

/* ============================================================
   loadDocumentTags — tag list for a doc (or distinct tags org-wide)
   ============================================================ */

export async function loadDocumentTags(
  orgId: string,
  docId?: string,
): Promise<string[]> {
  if (docId) {
    const rows = await prisma.documentTag.findMany({
      where: { orgId, documentId: docId },
      select: { tag: true },
      orderBy: { tag: "asc" },
    });
    return rows.map((r) => r.tag);
  }
  const rows = await prisma.documentTag.findMany({
    where: { orgId },
    select: { tag: true },
    distinct: ["tag"],
    orderBy: { tag: "asc" },
  });
  return rows.map((r) => r.tag);
}

/* ============================================================
   indexDocuments — id → doc lookup map (for aggregation logic)
   ============================================================ */

export function indexDocuments(
  docs: CanonicalDocument[],
): Map<string, CanonicalDocument> {
  const m = new Map<string, CanonicalDocument>();
  for (const d of docs) m.set(d.id, d);
  return m;
}

/* ============================================================
   Internal: shape Prisma row into CanonicalDocument
   ============================================================ */

type DocumentWithRelations = {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  fileKey: string;
  filePublicUrl: string | null;
  mimeType: string | null;
  fileSize: number | null;
  uploadedById: string | null;
  uploadedAt: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  ownership: Array<{
    id: string;
    level: string;
    companyId: string | null;
    branchId: string | null;
    personId: string | null;
    businessType: string | null;
  }>;
  tags: Array<{ tag: string }>;
  renewals: Array<{
    id: string;
    documentId: string;
    expiryDate: Date;
    renewalPeriodYears: number | null;
    alertDays: number[];
    responsibleUserId: string | null;
    status: string;
    lastRenewedDate: Date | null;
    nextRenewalDate: Date | null;
    notes: string | null;
  }>;
};

function toCanonicalDocument(row: DocumentWithRelations): CanonicalDocument {
  const r = row.renewals[0] ?? null;
  return {
    id: row.id,
    orgId: row.orgId,
    name: row.name,
    description: row.description,
    fileKey: row.fileKey,
    filePublicUrl: row.filePublicUrl,
    mimeType: row.mimeType,
    fileSize: row.fileSize,
    uploadedById: row.uploadedById,
    uploadedAt: row.uploadedAt,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ownership: row.ownership.map((o) => ({
      id: o.id,
      level: o.level,
      companyId: o.companyId,
      branchId: o.branchId,
      personId: o.personId,
      businessType: o.businessType,
    })),
    tags: row.tags.map((t) => t.tag),
    renewal: r
      ? {
          id: r.id,
          documentId: r.documentId,
          expiryDate: r.expiryDate,
          renewalPeriodYears: r.renewalPeriodYears,
          alertDays: r.alertDays,
          responsibleUserId: r.responsibleUserId,
          status: r.status,
          lastRenewedDate: r.lastRenewedDate,
          nextRenewalDate: r.nextRenewalDate,
          notes: r.notes,
          daysUntilExpiry: daysUntilExpiry(r.expiryDate),
          expiryStatus: getExpiryStatus(r.expiryDate),
        }
      : null,
  };
}
