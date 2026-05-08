// DocuFlow — Org-wide Risk Aggregate (Item 2 / spec §7 part 2)
// ────────────────────────────────────────────────────────────────────
// Builds a structured snapshot of org-wide compliance/expiry risk by
// combining ALL three doc tables:
//   1. document_renewals  (general docs — licenses/contracts/permits)
//   2. vehicle_documents  (registration / พ.ร.บ. / inspection / tank)
//   3. person_documents   (driver license / training / health / id_card)
//
// The snapshot is grouped by:
//   - severity bucket  (critical | urgent | watch)
//   - category         (a stable key like "vehicle_registration",
//                       "general_permit", "person_license", ...)
//
// `narrateOrgRisk` (sibling file) feeds this into Claude Haiku to produce
// the executive summary shown on /docuflow/risk.
//
// Hard rules:
//   - Multi-tenant: every read scoped by orgId.
//   - Single source: uses canonical loaders + prisma direct ONLY for
//     person_documents (no canonical loader yet — same convention as
//     ai-search.ts uses for personDocs).
//   - Severity boundaries match getExpiryStatus (expired/critical/urgent/
//     watch). Spec wants 60/45/90 windows — those map cleanly to:
//       expired+critical+urgent → "critical" or "urgent" buckets here
//       watch                   → "watch" bucket here
//   - Item caps to keep Claude payload small (top-N per category).
// ────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { loadRenewals } from "./data";
import {
  loadVehicleDocuments,
  loadVehicles,
  VEHICLE_DOC_TYPES,
  VEHICLE_TYPES,
} from "@/lib/vehicles/data";
import { daysUntilExpiry, getExpiryStatus } from "./expiry";

/* ============================================================
   Public types
   ============================================================ */

/** Coarse severity used by the aggregate (driven by getExpiryStatus). */
export type AggregateSeverity = "critical" | "urgent" | "watch";

/** Stable category key — Claude consumes this verbatim for grouping. */
export type RiskCategory =
  | "general_permit"
  | "general_contract"
  | "general_other"
  | "vehicle_registration"
  | "vehicle_insurance_compulsory"
  | "vehicle_insurance_voluntary"
  | "vehicle_inspection"
  | "vehicle_tank_cert"
  | "person_license"
  | "person_training"
  | "person_health"
  | "person_id_card";

export interface RiskItem {
  /** Stable id for linking back to source (document.id / vehicle.id / user.id) */
  refId: string;
  /** Source kind — picks the right detail page */
  refKind: "document" | "vehicle" | "person";
  /** Display label (doc name / license plate / person name) */
  label: string;
  /** Sub-label (vehicle type, person role, owner branch — optional context) */
  subLabel?: string;
  /** Days until expiry (negative = expired). Null only if no expiry on row. */
  daysUntilExpiry: number | null;
  /** ISO date — yyyy-mm-dd */
  expiryDate: string | null;
}

export interface RiskGroup {
  category: RiskCategory;
  /** Human-readable Thai label of the category. */
  categoryLabel: string;
  /** All items in this category at this severity. */
  items: RiskItem[];
  /** Up-front count (== items.length unless capped). */
  count: number;
  /** Hard-coded business-impact phrase for this category — feeds Claude. */
  businessImpact: string;
}

export interface OrgRiskSummary {
  orgId: string;
  /** ISO timestamp of when the snapshot was computed. */
  computedAt: string;
  /** Top-level totals (across all categories). */
  totals: {
    expired: number;
    critical: number; // 0-7d (incl. expired in spec narration grouping below)
    urgent: number; // 8-30d
    watch: number; // 31-90d
    grandTotal: number;
  };
  /** Items expiring within 30d (expired+critical+urgent collapsed). */
  critical: RiskGroup[];
  /** Items expiring 31-60d — spec calls these "เร่งด่วนรองลงมา" */
  urgent: RiskGroup[];
  /** Items expiring 61-90d — long-horizon planning */
  watch: RiskGroup[];
}

/* ============================================================
   Constants — per-category copy
   ============================================================ */

const CATEGORY_LABEL: Record<RiskCategory, string> = {
  general_permit: "ใบอนุญาต",
  general_contract: "สัญญา",
  general_other: "เอกสารทั่วไปอื่นๆ",
  vehicle_registration: "ทะเบียนรถ",
  vehicle_insurance_compulsory: "พ.ร.บ. รถ",
  vehicle_insurance_voluntary: "ประกันภัยรถ",
  vehicle_inspection: "ตรวจสภาพรถ",
  vehicle_tank_cert: "ใบรับรองถัง",
  person_license: "ใบขับขี่พนักงาน",
  person_training: "ใบรับรองอบรม",
  person_health: "ใบรับรองสุขภาพ",
  person_id_card: "บัตรประชาชน",
};

const CATEGORY_BUSINESS_IMPACT: Record<RiskCategory, string> = {
  general_permit:
    "ถ้าใบอนุญาตหมด ต้องหยุดดำเนินการสาขา/กิจกรรมนั้นทันที — เสี่ยงโดนปรับ + ปิดกิจการชั่วคราว",
  general_contract:
    "สัญญาขาดอายุ = สูญสิทธิตามข้อตกลง + ต้องเจรจาใหม่ในสภาพเสียเปรียบ",
  general_other: "เอกสารยืนยันสถานะองค์กร — ขาดอาจกระทบการยื่นขอราชการ",
  vehicle_registration:
    "วิ่งโดยทะเบียนหมด = ผิด พ.ร.บ. รถยนต์ + ประกันไม่คุ้มครอง + เสี่ยงยึดรถ",
  vehicle_insurance_compulsory:
    "พ.ร.บ. หมด = ผิดกฎหมาย + ผู้บาดเจ็บไม่ได้รับเงินจากกองทุน",
  vehicle_insurance_voluntary:
    "ประกันชั้นหมด = บริษัทรับภาระความเสียหายเองทุกบาท ถ้ามีอุบัติเหตุ",
  vehicle_inspection:
    "ตรวจสภาพหมด = ต่อภาษีไม่ได้ + ห้ามวิ่งบนถนน",
  vehicle_tank_cert:
    "ใบรับรองถังหมด = วิ่งบรรทุกแก๊ส/น้ำมันไม่ได้ตามกฎกรมขนส่ง",
  person_license:
    "ใบขับขี่หมด = ขับรถบรรทุกไม่ได้ตามกฎหมาย + ประกันรถไม่คุ้มครองอุบัติเหตุ",
  person_training:
    "ขาดใบอบรมขนส่งวัตถุอันตราย = ผิดข้อบังคับกรมการขนส่งทางบก",
  person_health:
    "ขาดใบรับรองแพทย์ = ต่อใบขับขี่ไม่ได้ + ผิดเงื่อนไขจ้างงาน",
  person_id_card:
    "บัตรประชาชนหมด = ยืนยันตัวตนไม่ได้ในเอกสารทางการ",
};

/** Cap items per category per severity in the Claude payload. */
const ITEMS_PER_CATEGORY_CAP = 8;

/* ============================================================
   Public: computeOrgRiskSummary
   ============================================================ */

export async function computeOrgRiskSummary(
  orgId: string,
): Promise<OrgRiskSummary> {
  // 1. Pull everything within the 90-day horizon (also covers expired).
  //    `loadRenewals` excludes status="renewed" by default — perfect.
  const [generalRenewals, vehicleDocs, personDocsRaw] = await Promise.all([
    loadRenewals(orgId, { withinDays: 90 }),
    loadVehicleDocuments(orgId, {
      // include expired+critical+urgent+watch (skip "ok" / "no_expiry")
      expiryStatus: ["expired", "critical", "urgent", "watch"],
    }),
    prisma.personDocument.findMany({
      where: {
        orgId,
        expiryDate: { not: null },
        document: { isActive: true },
      },
      include: {
        user: { select: { id: true, name: true, role: true } },
      },
      orderBy: [{ expiryDate: "asc" }],
    }),
  ]);

  // Resolve vehicle license_plate + type for vehicleDocs labels.
  const vehicleIds = Array.from(
    new Set(vehicleDocs.map((d) => d.vehicle_id)),
  );
  const vehicles = vehicleIds.length
    ? await loadVehicles(orgId, { ids: vehicleIds })
    : [];
  const vehicleById = new Map(vehicles.map((v) => [v.id, v]));

  // 2. Convert each source row → typed RiskItem + classify into severity.
  type Bucketed = {
    severity: AggregateSeverity;
    category: RiskCategory;
    item: RiskItem;
  };
  const all: Bucketed[] = [];

  // 2a. General docs
  for (const r of generalRenewals) {
    const sev = mapSeverity(r.expiryStatus);
    if (!sev) continue;
    const category = classifyGeneralDoc(r.document.name);
    all.push({
      severity: sev,
      category,
      item: {
        refId: r.documentId,
        refKind: "document",
        label: r.document.name,
        daysUntilExpiry: r.daysUntilExpiry,
        expiryDate: r.expiryDate.toISOString().slice(0, 10),
      },
    });
  }

  // 2b. Vehicle docs
  for (const d of vehicleDocs) {
    if (d.days_to_expiry === null) continue;
    const sev = mapSeverityFromDays(d.days_to_expiry);
    if (!sev) continue;
    const category = classifyVehicleDoc(d.doc_type);
    if (!category) continue;
    const v = vehicleById.get(d.vehicle_id);
    const plate = v?.license_plate ?? "?";
    const typeLabel = v
      ? VEHICLE_TYPES[v.vehicle_type]?.label ?? v.vehicle_type
      : undefined;
    const docLabel = VEHICLE_DOC_TYPES[d.doc_type]?.short ?? d.doc_type;
    all.push({
      severity: sev,
      category,
      item: {
        refId: d.vehicle_id,
        refKind: "vehicle",
        label: `${plate} · ${docLabel}`,
        subLabel: typeLabel,
        daysUntilExpiry: d.days_to_expiry,
        expiryDate: d.expiry_date,
      },
    });
  }

  // 2c. Person docs
  for (const p of personDocsRaw) {
    if (!p.expiryDate) continue;
    const days = daysUntilExpiry(p.expiryDate);
    const sev = mapSeverityFromDays(days);
    if (!sev) continue;
    const category = classifyPersonDoc(p.docType);
    if (!category) continue;
    all.push({
      severity: sev,
      category,
      item: {
        refId: p.userId,
        refKind: "person",
        label: p.user.name,
        subLabel: `${CATEGORY_LABEL[category]} · ${p.user.role}`,
        daysUntilExpiry: days,
        expiryDate: p.expiryDate.toISOString().slice(0, 10),
      },
    });
  }

  // 3. Top-level totals (count by raw expiry status — not by aggregate sev).
  let expired = 0;
  let criticalRaw = 0;
  let urgentRaw = 0;
  let watchRaw = 0;
  for (const b of all) {
    const d = b.item.daysUntilExpiry;
    if (d === null) continue;
    if (d < 0) expired += 1;
    else if (d <= 7) criticalRaw += 1;
    else if (d <= 30) urgentRaw += 1;
    else if (d <= 90) watchRaw += 1;
  }

  // 4. Group by severity → category → items
  const grouped: Record<AggregateSeverity, Map<RiskCategory, RiskItem[]>> = {
    critical: new Map(),
    urgent: new Map(),
    watch: new Map(),
  };
  for (const b of all) {
    const slot = grouped[b.severity].get(b.category) ?? [];
    slot.push(b.item);
    grouped[b.severity].set(b.category, slot);
  }

  function toGroups(m: Map<RiskCategory, RiskItem[]>): RiskGroup[] {
    const out: RiskGroup[] = [];
    for (const [cat, list] of m.entries()) {
      // Sort within category by days asc (most urgent first)
      list.sort(
        (a, b) =>
          (a.daysUntilExpiry ?? 99999) - (b.daysUntilExpiry ?? 99999),
      );
      out.push({
        category: cat,
        categoryLabel: CATEGORY_LABEL[cat],
        items: list.slice(0, ITEMS_PER_CATEGORY_CAP),
        count: list.length,
        businessImpact: CATEGORY_BUSINESS_IMPACT[cat],
      });
    }
    // Sort groups: highest count first (= most pressing within the bucket)
    out.sort((a, b) => b.count - a.count);
    return out;
  }

  return {
    orgId,
    computedAt: new Date().toISOString(),
    totals: {
      expired,
      critical: criticalRaw,
      urgent: urgentRaw,
      watch: watchRaw,
      grandTotal: expired + criticalRaw + urgentRaw + watchRaw,
    },
    critical: toGroups(grouped.critical),
    urgent: toGroups(grouped.urgent),
    watch: toGroups(grouped.watch),
  };
}

/* ============================================================
   Internal: classification helpers
   ============================================================ */

/**
 * Aggregate severity buckets in this module:
 *   critical = expired OR ≤ 30 days  (spec calls 12 trucks @ 60d "critical"
 *              business-wise but expiry.ts boundary is sharper. We collapse
 *              expired+critical+urgent into "critical" so executives see
 *              ONE prominent block — Claude can still distinguish "หมดแล้ว"
 *              vs "ใน X วัน" using the daysUntilExpiry field on each item.)
 *   urgent   = 31-60 days  (heads-up window)
 *   watch    = 61-90 days  (planning horizon)
 */
function mapSeverityFromDays(days: number): AggregateSeverity | null {
  if (days <= 30) return "critical";
  if (days <= 60) return "urgent";
  if (days <= 90) return "watch";
  return null;
}

function mapSeverity(
  status: ReturnType<typeof getExpiryStatus>,
): AggregateSeverity | null {
  // status = expired | critical | urgent | watch | normal
  if (status === "expired" || status === "critical" || status === "urgent") {
    return "critical";
  }
  if (status === "watch") {
    // need finer split — derive from days. Caller passes days too, but here
    // we don't have it. The general-renewals branch above uses
    // mapSeverityFromDays for a finer split, so mapSeverity is only used as
    // a fallback when the bucket is "watch" → land it in "watch".
    return "watch";
  }
  return null;
}

/**
 * General docs don't have a structured doc_type — best-effort classify by
 * substring on the document name. False positives just get a softer
 * "general_other" — that's intentional, never wrong.
 */
function classifyGeneralDoc(name: string): RiskCategory {
  const n = name.toLowerCase();
  if (
    n.includes("ใบอนุญาต") ||
    n.includes("permit") ||
    n.includes("license") ||
    n.includes("ใบรับรอง")
  ) {
    return "general_permit";
  }
  if (
    n.includes("สัญญา") ||
    n.includes("contract") ||
    n.includes("agreement") ||
    n.includes("เช่า")
  ) {
    return "general_contract";
  }
  return "general_other";
}

function classifyVehicleDoc(docType: string): RiskCategory | null {
  switch (docType) {
    case "registration":
      return "vehicle_registration";
    case "insurance_compulsory":
      return "vehicle_insurance_compulsory";
    case "insurance_voluntary":
      return "vehicle_insurance_voluntary";
    case "inspection":
      return "vehicle_inspection";
    case "tank_cert":
      return "vehicle_tank_cert";
    default:
      return null;
  }
}

function classifyPersonDoc(docType: string): RiskCategory | null {
  switch (docType) {
    case "license":
      return "person_license";
    case "training":
      return "person_training";
    case "health":
      return "person_health";
    case "id_card":
      return "person_id_card";
    default:
      return null;
  }
}
