// DocuFlow — Smart Upload Templates
// ────────────────────────────────────────────────────────────────────
// แปลง CanonicalDocSpec → upload defaults (level, tags, expiry, alertDays)
// ใช้โดย /docuflow/documents/upload/template + UploadForm autofill
//
// Phase 2 redesign 2026-05-10. เป้า: user เลือก template แล้วได้ form
// ที่ pre-filled 80% ของ field — เหลือแค่ไฟล์ + scope (สาขา/บริษัท)
// ────────────────────────────────────────────────────────────────────

import type {
  CanonicalDocSpec,
  DocFrequency,
  DocDangerLevel,
  DocCategory,
} from "./canonical-docs";

/** Ownership level enum reused from upload-form */
export type OwnershipLevel =
  | "group"
  | "company"
  | "business_type"
  | "branch"
  | "person";

export interface TemplateDefaults {
  /** Suggested base name — UI may append branch code suffix */
  suggestedName: string;
  /** Ownership level recommended for this doc category */
  suggestedLevel: OwnershipLevel;
  /** Auto-tag chips — user can toggle off, plus add custom */
  suggestedTags: string[];
  /** Years from today → default expiryDate (null = not applicable) */
  expiryYears: number | null;
  /** Preset alert days based on danger level */
  alertDays: number[];
  /** Description carried from canonical → shown as helper text */
  description: string;
  /** Pass-through metadata (used in display) */
  category: DocCategory;
  dangerLevel: DocDangerLevel;
  frequency: DocFrequency;
  regulator: string | null;
}

/* ============================================================
   FREQUENCY → expiryYears mapping
   ============================================================ */

function frequencyToYears(f: DocFrequency): number | null {
  switch (f) {
    case "ทุกปี":
    case "รายเดือน": // expiry uses end-of-year for monthly forms
    case "ทุกวัน":
      return 1;
    case "ทุก 2 ปี":
      return 2;
    case "ทุก 3 ปี":
      return 3;
    case "ทุก 5 ปี":
      return 5;
    case "5-10 ปี":
      return 7; // mid-point default — admin can override
    case "ตามสัญญา":
      return null; // admin must set manually
    case "ถาวร":
    case "ตลอด":
      return null; // no expiry
    case "เมื่อมีเหตุ":
      return null;
  }
}

/* ============================================================
   CATEGORY → suggestedLevel mapping
   - license / permanent → branch (most are branch-specific)
   - personnel → person
   - form → branch (operational records by branch)
   ============================================================ */

function categoryToLevel(category: DocCategory): OwnershipLevel {
  switch (category) {
    case "license":
      return "branch"; // ใบอนุญาตส่วนใหญ่ออกระดับสาขา
    case "permanent":
      return "branch"; // โฉนด/แบบแปลน — สาขา
    case "personnel":
      return "person"; // ใบขับขี่/ฝึกอบรม — บุคคล
    case "form":
      return "branch"; // บันทึก/รายงานประจำวัน — สาขา
  }
}

/* ============================================================
   DANGER → alertDays mapping
   ============================================================ */

function dangerToAlertDays(d: DocDangerLevel): number[] {
  switch (d) {
    case "critical":
      return [180, 90, 30, 14, 7];
    case "high":
      return [90, 30, 14, 7];
    case "medium":
      return [60, 30, 7];
    case "low":
      return [30, 7];
  }
}

/* ============================================================
   buildTags — auto-suggested tag chips
   ============================================================ */

function buildSuggestedTags(spec: CanonicalDocSpec): string[] {
  const tags: string[] = [];

  // Category as primary tag
  if (spec.category === "license") tags.push("ใบอนุญาต");
  if (spec.category === "permanent") tags.push("ถาวร");
  if (spec.category === "form") tags.push("แบบฟอร์ม");
  if (spec.category === "personnel") tags.push("บุคลากร");

  // Frequency
  if (spec.frequency !== "ถาวร" && spec.frequency !== "ตลอด") {
    tags.push(spec.frequency);
  }

  // Regulator (short form for common ones)
  if (spec.regulator) {
    const shortMap: Record<string, string> = {
      กรมธุรกิจพลังงาน: "ธพ.",
      กรมการขนส่งทางบก: "ขบ.",
      กรมโรงงานอุตสาหกรรม: "รง.",
      กรมพัฒนาธุรกิจการค้า: "พค.",
      กรมสรรพากร: "สรรพากร",
      กรมพัฒนาฝีมือแรงงาน: "พม.",
    };
    tags.push(shortMap[spec.regulator] ?? spec.regulator);
  }

  // Danger as visible tag for critical only (others: avoid noise)
  if (spec.dangerLevel === "critical") tags.push("วิกฤต");

  return tags;
}

/* ============================================================
   templateDefaults — main API
   ============================================================ */

export function templateDefaults(spec: CanonicalDocSpec): TemplateDefaults {
  return {
    suggestedName: spec.name,
    suggestedLevel: categoryToLevel(spec.category),
    suggestedTags: buildSuggestedTags(spec),
    expiryYears: frequencyToYears(spec.frequency),
    alertDays: dangerToAlertDays(spec.dangerLevel),
    description: spec.description,
    category: spec.category,
    dangerLevel: spec.dangerLevel,
    frequency: spec.frequency,
    regulator: spec.regulator,
  };
}

/** Default ISO yyyy-MM-dd string for today + N years (or null if N is null) */
export function defaultExpiryISO(years: number | null): string {
  if (years === null) return "";
  const d = new Date();
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().slice(0, 10);
}

/* ============================================================
   Last-context memory (client-side)
   stored under localStorage key — used by UploadForm to pre-pick
   level/companyId/branchId next time an admin uploads.
   ============================================================ */

export const LAST_CONTEXT_KEY = "docuflow.lastUploadContext";

export interface LastUploadContext {
  level: OwnershipLevel;
  companyId?: string;
  branchId?: string;
  businessType?: string;
  personId?: string;
  /** Display label for the "+ อัปโหลดอีกใบใน X" chip */
  label: string;
}

export function readLastContext(): LastUploadContext | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LAST_CONTEXT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as LastUploadContext;
  } catch {
    return null;
  }
}

export function writeLastContext(ctx: LastUploadContext): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAST_CONTEXT_KEY, JSON.stringify(ctx));
  } catch {
    // ignore quota errors
  }
}

export function clearLastContext(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(LAST_CONTEXT_KEY);
}
