// ClawFleet · ตัวโหลดข้อมูล "ใบนับสต๊อก" → รูป PNG (ใช้ใน route `/count/[id]/image`).
// สร้าง DocImageInput (โครงกลาง · reuse renderDocImage จาก lib/dc/doc-image.tsx — generic 100%).
//
// ★ NOT "use server": helper ธรรมดา (เรียกจาก route handler ที่ตั้ง runtime nodejs แล้ว)
//   → return DocImageInput | null (null = ไม่พบ/ไม่มีสิทธิ์ → route ตอบ 404).
//
// READ-ONLY: อ่านจาก CfStockCount + CfStockCountLine — ไม่เขียน movement/สต๊อก/ต้นทุน.
// SCOPE: บังคับ orgId + branchId + สิทธิ์เข้าถึงสาขา (assertCanAccessBranch) → ไม่รั่วข้ามสาขา.
//   (mirror lib/clawfleet/receive-doc.ts เป๊ะ — access pattern + DocImageInput shape เดียวกัน)

import { prisma } from "@/lib/prisma";
import { requireCfSession, assertCanAccessBranch } from "@/lib/clawfleet/role-guard";
import type { DocImageInput } from "@/lib/dc/doc-image";

function n0(n: number): string {
  return new Intl.NumberFormat("th-TH").format(n);
}
function longDateTime(d: Date): string {
  return new Intl.DateTimeFormat("th-TH", {
    day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok",
  }).format(d);
}
// ขาด/เกิน: 0 = "ตรงพอดี" · +เกิน · −ขาด (มีเครื่องหมายชัด)
function varianceText(diff: number): string {
  if (diff === 0) return "ตรงพอดี";
  return `${diff > 0 ? "+" : ""}${n0(diff)}`;
}
// สถานะ → ป้ายไทย (mirror pill ใน mobile history)
function statusText(status: string): string {
  switch (status) {
    case "APPLIED": return "ปรับยอดแล้ว";
    case "PENDING": return "รอผู้จัดการอนุมัติ";
    case "APPROVED": return "อนุมัติแล้ว";
    case "REJECTED": return "ไม่อนุมัติ";
    default: return status;
  }
}

async function loadOrg(orgId: string): Promise<{ name: string; logoUrl: string | null }> {
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { name: true, logoUrl: true } });
  return { name: org?.name ?? "บริษัท", logoUrl: org?.logoUrl ?? null };
}

/**
 * สร้าง DocImageInput ของ "ใบนับสต๊อก" (count · id = CfStockCount.id).
 *   caller ต้องมีสิทธิ์เข้าถึง branchId (assertCanAccessBranch → redirect /403 ถ้าไม่มีสิทธิ์).
 *   คืน null เมื่อ: org ไม่ตรง · หาใบนับนี้ในสาขาไม่เจอ (ถูกลบ/คนละสาขา).
 */
export async function buildClawFleetCountDocImage(
  orgId: string,
  branchId: string,
  countId: string,
): Promise<DocImageInput | null> {
  if (!orgId || !branchId || !countId) return null;

  // สิทธิ์: ผู้ใช้ต้องเข้าถึงสาขานี้ได้ (admin/viewer = ผ่าน · staff/manager = ต้องสังกัดสาขา)
  const session = await assertCanAccessBranch(branchId);
  if (session.user.org_id !== orgId) return null;

  // ใบนับของสาขา (scope orgId + branchId + countId ครบ · ไม่รั่วข้ามสาขา) พร้อมบรรทัดนับ
  const count = await prisma.cfStockCount.findFirst({
    where: { id: countId, orgId, branchId },
    select: {
      countCode: true, note: true, countedAt: true, countedByName: true,
      itemsCounted: true, totalDiff: true, status: true,
      lines: {
        orderBy: { createdAt: "asc" },
        select: { productName: true, systemQty: true, countedQty: true, diff: true },
      },
    },
  });
  if (!count) return null;

  const [org, branch] = await Promise.all([
    loadOrg(orgId),
    prisma.branch.findFirst({ where: { id: branchId, orgId }, select: { name: true } }),
  ]);
  const branchName = branch?.name ?? "—";

  const rows = count.lines.map((l) => ({
    cells: {
      name: l.productName,
      systemQty: n0(l.systemQty),
      countedQty: n0(l.countedQty),
      variance: varianceText(l.diff),
    },
  }));

  const netText = varianceText(count.totalDiff);

  return {
    org,
    docTitle: "ใบนับสต๊อก",
    docTitleEn: "Stock Count Sheet",
    code: count.countCode,
    // filename ถูก sanitize เป็น ASCII ใน renderDocImage → ใช้ countId ท่อนสั้น (ASCII) กัน code ไทยกลายเป็น "_"
    filename: `CNT-${countId.slice(0, 8)}`,
    headerRight: [
      { label: "วันที่นับ", value: longDateTime(count.countedAt) },
      { label: "สถานะ", value: statusText(count.status) },
    ],
    metaLeft: [
      { label: "สาขา", value: branchName },
      { label: "ผู้นับ", value: count.countedByName ?? "—" },
    ],
    metaRight: [{ label: "จำนวนรายการ", value: `${n0(count.lines.length)} รายการ` }],
    columns: [
      { key: "name", header: "สินค้า", flex: 6, align: "left" },
      { key: "systemQty", header: "ระบบมี", flex: 2, align: "right" },
      { key: "countedQty", header: "นับได้", flex: 2, align: "right" },
      { key: "variance", header: "ขาด/เกิน", flex: 3, align: "right" },
    ],
    rows,
    totals: [{ label: "ส่วนต่างรวม (ขาดหักเกิน)", value: netText, strong: true }],
    note: count.note,
  };
}

/**
 * resolve สาขาของ "ใบนับ" countId ตาม session ปัจจุบัน (สำหรับ route ที่มีแค่ [id]).
 *   หา CfStockCount ใน org ที่ผู้ใช้ล็อกอิน แล้วคืน branchId → route ส่งต่อ buildClawFleetCountDocImage.
 *   คืน null เมื่อไม่พบในตาราง (route ตอบ 404).
 */
export async function resolveCountDocBranch(countId: string): Promise<{ orgId: string; branchId: string } | null> {
  if (!countId) return null;
  const session = await requireCfSession();
  const orgId = session.user.org_id;

  const count = await prisma.cfStockCount.findFirst({
    where: { id: countId, orgId },
    select: { branchId: true },
  });
  if (!count) return null;

  return { orgId, branchId: count.branchId };
}
