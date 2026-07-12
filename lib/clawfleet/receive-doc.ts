// ClawFleet · ตัวโหลดข้อมูล "ใบรับสินค้า" → รูป PNG (ใช้ใน route `/receipt/[id]/image`).
// สร้าง DocImageInput (โครงกลาง · reuse renderDocImage จาก lib/dc/doc-image.tsx — generic 100%).
//
// ★ NOT "use server": helper ธรรมดา (เรียกจาก route handler ที่ตั้ง runtime nodejs แล้ว)
//   → return DocImageInput | null (null = ไม่พบ/ไม่มีสิทธิ์ → route ตอบ 404).
//
// READ-ONLY: อ่านจาก ledger (getReceivedHistory) — ไม่เขียน movement/สต๊อก/ต้นทุน.
// SCOPE: บังคับ orgId + branchId + สิทธิ์เข้าถึงสาขา (assertCanAccessBranch) → ไม่รั่วข้ามสาขา.

import { prisma } from "@/lib/prisma";
import { requireCfSession, assertCanAccessBranch } from "@/lib/clawfleet/role-guard";
import { getReceivedHistory } from "@/lib/clawfleet/stock-queries";
import type { DocImageInput } from "@/lib/dc/doc-image";

function n0(n: number): string {
  return new Intl.NumberFormat("th-TH").format(n);
}
function longDateTime(d: Date): string {
  return new Intl.DateTimeFormat("th-TH", {
    day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok",
  }).format(d);
}

async function loadOrg(orgId: string): Promise<{ name: string; logoUrl: string | null }> {
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { name: true, logoUrl: true } });
  return { name: org?.name ?? "บริษัท", logoUrl: org?.logoUrl ?? null };
}

/**
 * สร้าง DocImageInput ของ "ใบรับสินค้า" (received doc · refId = cfDelivery.id หรือ dcTransfer.id).
 *   caller ต้องมีสิทธิ์เข้าถึง branchId (assertCanAccessBranch → redirect /403 ถ้าไม่มีสิทธิ์).
 *   คืน null เมื่อ: org ไม่ตรง · หา received doc นี้ในสาขาไม่เจอ (ถูกลบ/ยังไม่รับ/คนละสาขา).
 */
export async function buildClawFleetReceiveDocImage(
  orgId: string,
  branchId: string,
  refId: string,
): Promise<DocImageInput | null> {
  if (!orgId || !branchId || !refId) return null;

  // สิทธิ์: ผู้ใช้ต้องเข้าถึงสาขานี้ได้ (admin/viewer = ผ่าน · staff/manager = ต้องสังกัดสาขา)
  const session = await assertCanAccessBranch(branchId);
  if (session.user.org_id !== orgId) return null;

  // ประวัติรับแล้วของสาขา (จาก ledger · scope orgId+branchId · status DELIVERED/CONFIRMED ในตัว) → หาใบตาม refId
  //   ใช้ limit สูงพอสมควรเพื่อครอบคลุมใบเป้าหมาย (ประวัติมือถือ take 50 · ที่นี่ 200 กันใบเก่าตกช่วง)
  const history = await getReceivedHistory(orgId, branchId, 200);
  const doc = history.find((d) => d.id === refId);
  if (!doc) return null;

  const [org, branch] = await Promise.all([
    loadOrg(orgId),
    prisma.branch.findFirst({ where: { id: branchId, orgId }, select: { name: true } }),
  ]);
  const branchName = branch?.name ?? "—";

  const rows = doc.lines.map((l) => ({
    imageUrl: l.imageUrl,
    cells: {
      name: l.productName,
      qty: n0(l.qty),
    },
  }));

  return {
    org,
    docTitle: "ใบรับสินค้า",
    docTitleEn: "Goods Received Note",
    code: doc.code,
    // filename ถูก sanitize เป็น ASCII ใน renderDocImage → ใช้ refId ท่อนสั้น (ASCII) กัน code ไทยกลายเป็น "_"
    filename: `RCV-${refId.slice(0, 8)}`,
    headerRight: [
      { label: "วันที่รับ", value: longDateTime(doc.receivedAt) },
      { label: "แหล่ง", value: doc.source === "dc_transfer" ? "โอนจากคลังกลาง" : "ใบกระจาย" },
    ],
    metaLeft: [
      { label: "สาขา", value: branchName },
      { label: "ผู้รับ", value: doc.receivedByName ?? "—" },
    ],
    metaRight: [{ label: "จำนวนรายการ", value: `${n0(doc.lines.length)} รายการ` }],
    columns: [
      { key: "name", header: "สินค้า", flex: 7, align: "left" },
      { key: "qty", header: "รับเข้า (ชิ้น)", flex: 3, align: "right" },
    ],
    rows,
    totals: [{ label: "รวมรับเข้า (ชิ้น)", value: n0(doc.unitsCount), strong: true }],
    note: null,
  };
}

/**
 * resolve สาขาของ "ใบรับ" refId ตาม session ปัจจุบัน (สำหรับ route ที่มีแค่ [id]).
 *   หา CfDelivery หรือ DcTransfer ใน org ที่ผู้ใช้ล็อกอิน แล้วคืน branchId → route ส่งต่อ buildClawFleetReceiveDocImage.
 *   คืน null เมื่อไม่พบในทั้งสองตาราง (route ตอบ 404).
 */
export async function resolveReceiveDocBranch(refId: string): Promise<{ orgId: string; branchId: string } | null> {
  if (!refId) return null;
  const session = await requireCfSession();
  const orgId = session.user.org_id;

  // ลอง cfDelivery ก่อน (DELIVERED) → ถ้าไม่เจอ ลอง dcTransfer (CONFIRMED · ปลายทางสาขา)
  const cf = await prisma.cfDelivery.findFirst({
    where: { id: refId, orgId, status: "DELIVERED" },
    select: { branchId: true },
  });
  if (cf) return { orgId, branchId: cf.branchId };

  const dc = await prisma.dcTransfer.findFirst({
    where: { id: refId, orgId, status: "CONFIRMED", toBranchId: { not: null } },
    select: { toBranchId: true },
  });
  if (dc?.toBranchId) return { orgId, branchId: dc.toBranchId };

  return null;
}
