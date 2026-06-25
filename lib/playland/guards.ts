// Cross-org safety helpers · use INSIDE actions to verify scoped writes
// Per security review: actions were trusting client-supplied IDs without org-check

import { prisma } from "@/lib/prisma";
import type { DbUser } from "@/lib/auth/session";
import { canPlaylandAdmin } from "./role-guard";

export async function verifyBranchOrg(branchId: string, orgId: string): Promise<boolean> {
  const b = await prisma.playlandBranch.findFirst({ where: { id: branchId, orgId }, select: { id: true } });
  return Boolean(b);
}

/**
 * ด่านกลาง: branchId ที่ action รับมา ต้องเป็นสาขาที่ "พนักงานคนนี้ถูกมอบหมายจริง"
 * (เดิมจำกัดแค่ UI → สาขา A ยิง action ใส่ branchId ของสาขา B ได้)
 *  • admin tier (super/org/admin/program_admin) = ทุกสาขาใน org (ผ่าน · ยังเช็ค org)
 *  • พนักงาน/ผจก.สาขา ที่ถูกผูก staff_branches แล้ว = เฉพาะสาขาที่ผูก
 *  • พนักงานที่ยังไม่ถูกผูกเลย = ทุกสาขาใน org (backward-compatible · ตรงกับ getAllowedBranchList)
 * คืน false → action ต้อง return err ปฏิเสธ
 */
export async function verifyBranchAssignment(
  branchId: string,
  orgId: string,
  userId: string,
  role: DbUser["role"],
): Promise<boolean> {
  // ต้องอยู่ใน org เสมอ (กันยิงข้าม org)
  if (!(await verifyBranchOrg(branchId, orgId))) return false;
  // admin tier เข้าได้ทุกสาขาใน org
  if (canPlaylandAdmin(role)) return true;
  // staff/branch-manager: ถ้าถูกผูกสาขาแล้ว → branchId ต้องอยู่ในรายการที่ผูก
  const assigned = await prisma.playlandStaffBranch.findMany({
    where: { orgId, userId },
    select: { branchId: true },
  });
  if (assigned.length === 0) return true; // ยังไม่ผูก = ไม่ล็อก (backward-compatible)
  return assigned.some((a) => a.branchId === branchId);
}

export async function verifyMemberOrg(memberId: string, orgId: string): Promise<boolean> {
  const m = await prisma.playlandMember.findFirst({ where: { id: memberId, orgId, deletedAt: null }, select: { id: true } });
  return Boolean(m);
}

export async function verifyPackageOrg(packageId: string, orgId: string): Promise<boolean> {
  const p = await prisma.playlandPackage.findFirst({ where: { id: packageId, orgId }, select: { id: true } });
  return Boolean(p);
}

export async function verifyBookingOrg(bookingId: string, orgId: string): Promise<boolean> {
  const b = await prisma.playlandBooking.findFirst({ where: { id: bookingId, orgId }, select: { id: true } });
  return Boolean(b);
}

/** Validate Thai phone — 9-10 digits, optionally with leading 0 */
export function isValidThaiPhone(s: string): boolean {
  const t = s.replace(/[\s-]/g, "");
  return /^0\d{8,9}$/.test(t);
}

/** Photo data URL size guard · returns size in bytes (decoded) · throws if invalid */
export function decodePhotoDataUrl(dataUrl: string, maxBytes = 2_000_000): Buffer {
  if (!dataUrl.startsWith("data:image/")) throw new Error("not an image data URL");
  const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
  const buf = Buffer.from(base64, "base64");
  if (buf.length > maxBytes) throw new Error(`photo too large: ${buf.length} bytes (max ${maxBytes})`);
  return buf;
}
