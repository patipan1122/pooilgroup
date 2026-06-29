/**
 * ตู้คีบ OS — พนักงาน (Staff)
 * Server: Team data จริง (getTeamData) → ตารางพนักงานทุกสาขา.
 * ถ้า DB ว่าง → client ใช้ SAMPLE fallback + แบนเนอร์ "กำลังแสดงตัวอย่าง".
 * NOTE: "รอบเก็บ" / "ยอดไม่ตรง" ต่อคน ยังไม่มี metric จริง — ดู backend gap.
 */
import { getTeamData } from "@/lib/clawfleet/v2-admin-queries";
import { StaffClient, type StaffRow } from "./staff-client";

export const dynamic = "force-dynamic";

export default async function StaffPage() {
  let team: Awaited<ReturnType<typeof getTeamData>> | null = null;
  try {
    team = await getTeamData();
  } catch {
    // graceful: DB ว่าง/ยังไม่ migrate → sample fallback ในฝั่ง client
  }

  // unique ต่อคน (user เดียวอาจอยู่หลายสาขา → รวมชื่อสาขา)
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
        branchName: m.branchName,
        status: m.status,
        rounds: null,
        mismatch: null,
      });
    }
  }
  const staff = Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name, "th"));

  return <StaffClient staff={staff} totalStaff={team?.totals.staff ?? staff.length} />;
}
