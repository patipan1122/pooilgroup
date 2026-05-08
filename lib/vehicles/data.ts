// CANONICAL VEHICLE LOADER · Single Source of Truth (Fleet)
// ────────────────────────────────────────────────────────────────────
// Generic — DocuFlow uses now, FuelOS Phase 2 will reuse.
// อ่านก่อนแก้: feedback_single_source_of_truth.md
//
// ทุก UI/page/component ที่ต้องการข้อมูล `vehicles` หรือ `vehicle_documents`
// ต้องผ่านฟังก์ชันในไฟล์นี้ ห้าม query Prisma vehicles ตรงจาก UI
//
// ข้อยกเว้น:
//   - API mutation routes ที่ fetch by primary key (renew, deactivate)
//   - Migration / seed scripts
//
// ────────────────────────────────────────────────────────────────────
//
// Pattern อ้างอิง: lib/cashhub/data.ts (loadBranches/loadReports/indexBranches)
// แต่ใช้ Prisma แทน Supabase admin (เพราะ Vehicle/VehicleDocument มี relation)
//
// ────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";

/* ============================================================
   TYPES — canonical shapes
   ============================================================ */

export interface CanonicalVehicle {
  id: string;
  org_id: string;
  license_plate: string;
  vehicle_type: string; // fuel_truck | gas_truck | service | personal | other
  company_id: string | null;
  branch_id: string | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CanonicalVehicleDocument {
  id: string;
  org_id: string;
  vehicle_id: string;
  document_id: string;
  doc_type: string; // registration | insurance_compulsory | insurance_voluntary | inspection | tank_cert
  expiry_date: string | null; // ISO date "yyyy-MM-dd"
  expiry_status: ExpiryStatus;
  days_to_expiry: number | null;
  document: {
    id: string;
    name: string;
    file_key: string;
    file_public_url: string | null;
    mime_type: string | null;
  } | null;
  created_at: string;
}

export type ExpiryStatus = "expired" | "critical" | "urgent" | "watch" | "ok" | "no_expiry";

/* ============================================================
   loadVehicles — canonical vehicle list
   ============================================================ */

export interface LoadVehiclesOpts {
  /** Default: true — ดึงเฉพาะรถที่ active */
  activeOnly?: boolean;
  companyId?: string;
  branchId?: string;
  vehicleType?: string;
  /** Substring match on licensePlate (case-insensitive) */
  licensePlateSearch?: string;
  /** Vehicle IDs ที่ระบุ */
  ids?: string[];
}

export async function loadVehicles(
  orgId: string,
  opts: LoadVehiclesOpts = {},
): Promise<CanonicalVehicle[]> {
  const {
    activeOnly = true,
    companyId,
    branchId,
    vehicleType,
    licensePlateSearch,
    ids,
  } = opts;

  const rows = await prisma.vehicle.findMany({
    where: {
      orgId,
      ...(activeOnly ? { isActive: true } : {}),
      ...(companyId ? { companyId } : {}),
      ...(branchId ? { branchId } : {}),
      ...(vehicleType ? { vehicleType } : {}),
      ...(licensePlateSearch
        ? {
            licensePlate: {
              contains: licensePlateSearch,
              mode: "insensitive" as const,
            },
          }
        : {}),
      ...(ids && ids.length > 0 ? { id: { in: ids } } : {}),
    },
    orderBy: [{ licensePlate: "asc" }],
  });

  return rows.map((r) => ({
    id: r.id,
    org_id: r.orgId,
    license_plate: r.licensePlate,
    vehicle_type: r.vehicleType,
    company_id: r.companyId,
    branch_id: r.branchId,
    is_active: r.isActive,
    notes: r.notes,
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
  }));
}

/* ============================================================
   loadVehicleDocuments — joined with Document + DocumentRenewal
   - คำนวณ expiry_status + days_to_expiry ให้ caller ใช้ตรงๆ
   ============================================================ */

export interface LoadVehicleDocumentsOpts {
  vehicleIds?: string[];
  /** Filter by computed expiry status */
  expiryStatus?: ExpiryStatus | ExpiryStatus[];
  /** registration | insurance_compulsory | inspection | tank_cert | ... */
  docType?: string | string[];
}

export async function loadVehicleDocuments(
  orgId: string,
  opts: LoadVehicleDocumentsOpts = {},
): Promise<CanonicalVehicleDocument[]> {
  const { vehicleIds, expiryStatus, docType } = opts;

  const rows = await prisma.vehicleDocument.findMany({
    where: {
      orgId,
      ...(vehicleIds && vehicleIds.length > 0
        ? { vehicleId: { in: vehicleIds } }
        : {}),
      ...(docType
        ? Array.isArray(docType)
          ? { docType: { in: docType } }
          : { docType }
        : {}),
    },
    include: {
      document: {
        select: {
          id: true,
          name: true,
          fileKey: true,
          filePublicUrl: true,
          mimeType: true,
          isActive: true,
        },
      },
    },
    orderBy: [{ expiryDate: "asc" }],
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const out: CanonicalVehicleDocument[] = rows.map((r) => {
    let status: ExpiryStatus = "no_expiry";
    let days: number | null = null;
    if (r.expiryDate) {
      const exp = new Date(r.expiryDate);
      exp.setHours(0, 0, 0, 0);
      days = Math.floor(
        (exp.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
      );
      status = classifyExpiry(days);
    }
    return {
      id: r.id,
      org_id: r.orgId,
      vehicle_id: r.vehicleId,
      document_id: r.documentId,
      doc_type: r.docType,
      expiry_date: r.expiryDate
        ? r.expiryDate.toISOString().slice(0, 10)
        : null,
      expiry_status: status,
      days_to_expiry: days,
      document: r.document
        ? {
            id: r.document.id,
            name: r.document.name,
            file_key: r.document.fileKey,
            file_public_url: r.document.filePublicUrl,
            mime_type: r.document.mimeType,
          }
        : null,
      created_at: r.createdAt.toISOString(),
    };
  });

  if (expiryStatus) {
    const allow = Array.isArray(expiryStatus) ? expiryStatus : [expiryStatus];
    return out.filter((d) => allow.includes(d.expiry_status));
  }
  return out;
}

/* ============================================================
   classifyExpiry — shared rule for badge color/severity
   - expired: < 0 days
   - critical: 0-7 days
   - urgent: 8-30 days
   - watch: 31-90 days
   - ok: > 90 days
   ============================================================ */

export function classifyExpiry(daysToExpiry: number): ExpiryStatus {
  if (daysToExpiry < 0) return "expired";
  if (daysToExpiry <= 7) return "critical";
  if (daysToExpiry <= 30) return "urgent";
  if (daysToExpiry <= 90) return "watch";
  return "ok";
}

/* ============================================================
   indexVehicles — id → vehicle map for fast lookup
   ============================================================ */

export function indexVehicles(
  vehicles: CanonicalVehicle[],
): Map<string, CanonicalVehicle> {
  const m = new Map<string, CanonicalVehicle>();
  for (const v of vehicles) m.set(v.id, v);
  return m;
}

/* ============================================================
   Vehicle type config — emoji + Thai label (UI consumes)
   ============================================================ */

export const VEHICLE_TYPES: Record<
  string,
  { label: string; emoji: string }
> = {
  fuel_truck: { label: "รถบรรทุกน้ำมัน", emoji: "🛢️" },
  gas_truck: { label: "รถบรรทุกแก๊ส", emoji: "🚛" },
  service: { label: "รถบริการ", emoji: "🚐" },
  personal: { label: "รถส่วนบุคคล", emoji: "🚗" },
  other: { label: "อื่นๆ", emoji: "🚙" },
};

export function getVehicleTypeConfig(t: string) {
  return VEHICLE_TYPES[t] ?? { label: t, emoji: "🚙" };
}

/* ============================================================
   Doc type config — vehicle document types
   ============================================================ */

export const VEHICLE_DOC_TYPES: Record<
  string,
  { label: string; short: string }
> = {
  registration: { label: "ทะเบียนรถ", short: "ทะเบียน" },
  insurance_compulsory: { label: "พ.ร.บ.", short: "พ.ร.บ." },
  insurance_voluntary: { label: "ประกันภัย", short: "ประกัน" },
  inspection: { label: "ตรวจสภาพรถ", short: "ตรวจสภาพ" },
  tank_cert: { label: "ใบรับรองถัง", short: "ถัง" },
};

/** Standard 4 doc types ทุกคันต้องมี (ดูใน UI list/card) */
export const STANDARD_VEHICLE_DOC_TYPES = [
  "registration",
  "insurance_compulsory",
  "inspection",
  "tank_cert",
] as const;
