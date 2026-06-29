/**
 * ตู้คีบ OS — ตั้งค่า & สิทธิ์ (Settings / Permissions)
 * Server: ดึงบัญชีผู้ใช้จริง (getTeamData) + snapshot การตั้งค่าระบบ (getSettingsData) ใน try/catch.
 * ถ้า DB ว่าง/ยังไม่ migrate → client ใช้ SAMPLE fallback + แบนเนอร์ "ตัวอย่าง" (ตาม pattern ClawFleet).
 */
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { userIsModuleAdmin } from "@/lib/auth/module-access";
import { isCfAdmin } from "@/lib/clawfleet/role-guard";
import { getTeamData, getSettingsData } from "@/lib/clawfleet/admin-queries";
import { SettingsClient, type SettingsUserRow } from "./settings-client";

export const dynamic = "force-dynamic";

/** จัด role key ของ user → bucket 4 บทบาทในดีไซน์ (เจ้าของ/ผจก./เก็บเงิน/ช่าง) */
function roleBucket(role: string): SettingsUserRow["roleKey"] {
  if (["super_admin", "org_admin", "admin", "area_manager", "program_admin"].includes(role)) return "owner";
  if (role === "branch_manager") return "manager";
  if (role === "staff") return "collector";
  if (role === "viewer") return "tech";
  return "collector";
}

function lastLoginLabel(d: Date | null): string {
  if (!d) return "ยังไม่เคยเข้า";
  const diffMs = Date.now() - d.getTime();
  const hr = Math.floor(diffMs / 3_600_000);
  if (hr < 1) return "เมื่อสักครู่";
  if (hr < 24) return `${hr} ชม.ก่อน`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "เมื่อวาน";
  if (day < 7) return `${day} วันก่อน`;
  return d.toLocaleDateString("th-TH", { day: "numeric", month: "short" });
}

export default async function SettingsPage() {
  // หน้าตั้งค่า & สิทธิ์ = เฉพาะแอดมินตู้คีบ (กัน staff/viewer URL-hop เข้าดูบัญชีผู้ใช้/นโยบาย)
  const session = await requireSession();
  const canSee = isCfAdmin(session.user.role) || (await userIsModuleAdmin(session.user, "clawfleet"));
  if (!canSee) redirect("/clawfleet/os/dashboard");

  let users: SettingsUserRow[] = [];
  let counts = { branches: 0, machines: 0 };

  try {
    const [team, settings] = await Promise.all([getTeamData(), getSettingsData()]);

    // รวม user ที่อยู่หลายสาขา → 1 แถว, รวมชื่อสาขาเป็นขอบเขต
    const byUser = new Map<string, SettingsUserRow>();
    for (const b of team.branches) {
      for (const m of b.staff) {
        const existing = byUser.get(m.id);
        if (existing) {
          if (!existing.scopeBranches.includes(m.branchName)) existing.scopeBranches.push(m.branchName);
          continue;
        }
        byUser.set(m.id, {
          id: m.id,
          name: m.name,
          roleKey: roleBucket(m.role),
          scopeBranches: [m.branchName],
          lastLogin: lastLoginLabel(m.lastLoginAt),
          status: m.status,
        });
      }
    }
    users = [...byUser.values()].sort((a, b) => a.name.localeCompare(b.name, "th"));
    counts = { branches: settings.counts.branches, machines: settings.counts.machines };
  } catch {
    // graceful: DB ว่าง/ยังไม่ migrate → client ใช้ sample fallback
  }

  return <SettingsClient users={users} counts={counts} />;
}
