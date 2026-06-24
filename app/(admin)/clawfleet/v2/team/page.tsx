/**
 * ClawFleet v2 — Team & สาขา.
 * Roster บรรทัดเดียวต่อพนักงาน (avatar · ชื่อ · บทบาท · สาขา · เข้าใช้ล่าสุด · สถานะ · ปุ่ม).
 * เพิ่มพนักงาน → สร้างลิงก์เชิญ · แก้สิทธิ์ · เข้าใช้แทน · เอาออก.
 * Data จาก getTeamData() (lib/clawfleet/v2-admin-queries) · ทุกปุ่มต่อ server action จริง
 * ใน lib/clawfleet/team-actions.ts (+ REUSE impersonate API).
 */
import { TeamClient } from "@/components/clawfleet/v2/team-client";
import { getTeamData } from "@/lib/clawfleet/v2-admin-queries";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const data = await getTeamData();
  return <TeamClient data={data} />;
}
