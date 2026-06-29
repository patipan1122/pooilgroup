/**
 * ตู้คีบ OS — พนักงาน (Staff)
 * Server: Team data จริง (getTeamData) → ตารางพนักงานทุกสาขา + จัดการทีม (เชิญ/แก้สิทธิ์/ปิดใช้).
 * ถ้า DB ว่าง → client ใช้ SAMPLE fallback + แบนเนอร์ "กำลังแสดงตัวอย่าง".
 * NOTE: "รอบเก็บ" / "ยอดไม่ตรง" ต่อคน ยังไม่มี metric จริง — ดู backend gap.
 * จัดการทีม (เพิ่ม/แก้สิทธิ์/ปิดใช้/สร้างลิงก์เชิญ) เปิดให้เฉพาะ admin-tier (isAdmin).
 */
import { getTeamData } from "@/lib/clawfleet/admin-queries";
import { requireSession } from "@/lib/auth/session";
import { userIsModuleAdmin } from "@/lib/auth/module-access";
import { isCfAdmin } from "@/lib/clawfleet/role-guard";
import { StaffClient, type StaffRow, type BranchOpt } from "./staff-client";

export const dynamic = "force-dynamic";

export default async function StaffPage() {
  const session = await requireSession();
  // ให้ตรงกับ server gate (assertCfAdmin = cfHasAdminPower): admin-tier + area_manager +
  // program_admin ที่ได้สิทธิ์ clawfleet จัดการทีมได้ (การยกบทบาทถูกกัน rank แล้วใน team-actions)
  const isAdmin = isCfAdmin(session.user.role) || (await userIsModuleAdmin(session.user, "clawfleet"));

  let team: Awaited<ReturnType<typeof getTeamData>> | null = null;
  try {
    team = await getTeamData();
  } catch {
    // graceful: DB ว่าง/ยังไม่ migrate → sample fallback ในฝั่ง client
  }

  // unique ต่อคน (user เดียวอาจอยู่หลายสาขา → รวมชื่อสาขา + เก็บ branchId แรกไว้สำหรับ action)
  const byId = new Map<string, StaffRow>();
  for (const br of team?.branches ?? []) {
    for (const m of br.staff) {
      const existing = byId.get(m.id);
      if (existing) {
        if (!existing.branchName.includes(m.branchName)) {
          existing.branchName = `${existing.branchName}, ${m.branchName}`;
        }
        continue;
      }
      byId.set(m.id, {
        id: m.id,
        name: m.name,
        role: m.role,
        // branchId/branchName ของ row แรกที่เจอ → ใช้เป็น scope ตอนแก้สิทธิ์/เอาออก
        branchId: m.branchId,
        branchName: m.branchName,
        status: m.status,
        rounds: null,
        mismatch: null,
      });
    }
  }
  const staff = Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name, "th"));

  // ตัวเลือกสาขาสำหรับฟอร์มเชิญ (ทุกสาขาตู้คีบที่ผู้ใช้เห็น)
  const branches: BranchOpt[] = (team?.branches ?? []).map((b) => ({ id: b.id, name: b.name }));

  return (
    <StaffClient
      staff={staff}
      totalStaff={team?.totals.staff ?? staff.length}
      branches={branches}
      isAdmin={isAdmin}
    />
  );
}
