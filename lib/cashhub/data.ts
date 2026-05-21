// CANONICAL DATA LOADERS · Single Source of Truth
// ────────────────────────────────────────────────────────────────────
// อ่านก่อนแก้: feedback_single_source_of_truth.md
//
// ทุก UI/page/component ที่ต้องการข้อมูล `branches` หรือ `daily_reports`
// ต้องผ่านฟังก์ชันในไฟล์นี้ ห้ามเรียก Supabase ตรงๆ
//
// ข้อยกเว้น:
//   - API mutation routes ที่ fetch by primary key (approve, unlock, ฯลฯ)
//   - Migration / seed scripts
//
// ────────────────────────────────────────────────────────────────────

import { adminClient } from "@/lib/db/server";

/* ============================================================
   TYPES — canonical shapes (ทุก consumer ใช้เหมือนกัน)
   ============================================================ */

export interface CanonicalBranch {
  id: string;
  code: string;
  name: string;
  business_type: string;
  province: string | null;
  region: string | null;
  is_active: boolean;
  manager_id: string | null;
  phone: string | null;
  line_group_id: string | null;
  company_id: string | null;
  parent_branch_id: string | null;
  settings: Record<string, unknown> | null;
}

export interface CanonicalReport {
  id: string;
  org_id: string;
  branch_id: string;
  report_date: string;
  shift: string;
  status: string;
  total_sales: number;
  cash: number;
  transfer: number;
  card: number;
  credit: number;
  shortage: number;
  qty1: number | null;
  qty1_unit: string | null;
  qty2: number | null;
  qty2_unit: string | null;
  notes: string | null;
  submitted_at: string | null;
  approved_at: string | null;
}

/* ============================================================
   loadBranches — canonical branch list
   - ทุกหน้าที่แสดง "ชื่อสาขา / ประเภทธุรกิจ / นับสาขา" ใช้ฟังก์ชันนี้
   ============================================================ */

export interface LoadBranchesOpts {
  /** Default: true — ดึงเฉพาะสาขาที่เปิดใช้งาน */
  activeOnly?: boolean;
  /** กรองตามบริษัท (นิติบุคคล) */
  companyId?: string;
  /** กรองตามประเภทธุรกิจ (e.g. fuel_station, hotel) */
  businessTypes?: string[];
  /** ดึงเฉพาะ branch IDs ที่ระบุ */
  branchIds?: string[];
}

export async function loadBranches(
  orgId: string,
  opts: LoadBranchesOpts = {},
): Promise<CanonicalBranch[]> {
  const { activeOnly = true, companyId, businessTypes, branchIds } = opts;
  const admin = adminClient();

  let q = admin
    .from("branches")
    .select(
      "id, code, name, business_type, province, region, is_active, manager_id, phone, line_group_id, company_id, parent_branch_id, settings",
    )
    .eq("org_id", orgId)
    .order("code");

  if (activeOnly) q = q.eq("is_active", true);
  if (companyId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    q = (q as any).eq("company_id", companyId);
  }
  if (businessTypes && businessTypes.length > 0) {
    q = q.in("business_type", businessTypes);
  }
  if (branchIds && branchIds.length > 0) {
    q = q.in("id", branchIds);
  }

  const { data } = await q;
  return (data ?? []) as CanonicalBranch[];
}

/* ============================================================
   loadReports — canonical raw report list
   - ทุกที่ที่ต้อง aggregate ยอดขายควรใช้ฟังก์ชันนี้
   ============================================================ */

export interface LoadReportsOpts {
  /** ISO date "yyyy-MM-dd" — รวมวันนี้ */
  dateFrom?: string;
  /** ISO date "yyyy-MM-dd" — รวมวันนี้ */
  dateTo?: string;
  /** Default: ["approved", "submitted"] — ไม่รวม draft/rejected */
  statuses?: string[];
  /** กรองตาม branch_ids ที่ระบุ */
  branchIds?: string[];
  /** กรองเฉพาะรายงานที่ user(s) นี้เป็นคนกรอก/ส่ง */
  submittedByIds?: string[];
  /** Newest-first sort by submitted_at, with optional limit. */
  newestFirst?: boolean;
  limit?: number;
}

export async function loadReports(
  orgId: string,
  opts: LoadReportsOpts = {},
): Promise<CanonicalReport[]> {
  const {
    dateFrom,
    dateTo,
    statuses = ["approved", "submitted"],
    branchIds,
    submittedByIds,
    newestFirst,
    limit,
  } = opts;
  const admin = adminClient();

  let q = admin
    .from("daily_reports")
    .select(
      "id, org_id, branch_id, report_date, shift, status, total_sales, cash, transfer, card, credit, shortage, qty1, qty1_unit, qty2, qty2_unit, notes, submitted_at, approved_at",
    )
    .eq("org_id", orgId);

  if (dateFrom) q = q.gte("report_date", dateFrom);
  if (dateTo) q = q.lte("report_date", dateTo);
  if (statuses.length > 0) q = q.in("status", statuses);
  if (branchIds && branchIds.length > 0) q = q.in("branch_id", branchIds);
  if (submittedByIds && submittedByIds.length > 0) {
    q = q.in("submitted_by_id", submittedByIds);
  }
  if (newestFirst) {
    q = q
      .order("report_date", { ascending: false })
      .order("submitted_at", { ascending: false });
  }
  if (limit) q = q.limit(limit);

  const { data } = await q;
  return (data ?? []) as CanonicalReport[];
}

/* ============================================================
   Helper: branch lookup map (id → branch) สำหรับ aggregation logic
   ============================================================ */

export function indexBranches(
  branches: CanonicalBranch[],
): Map<string, CanonicalBranch> {
  const m = new Map<string, CanonicalBranch>();
  for (const b of branches) m.set(b.id, b);
  return m;
}
