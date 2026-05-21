// /recruit/settings/permissions — permission matrix (read-only view)
// Per Recruit Redesign canvas Section 13A (PermissionSettings)
//
// Displays current role → capability matrix · sources of truth:
//   lib/recruit/role-guard.ts (RECRUIT_ROLES, _WRITE_ROLES, _ADMIN_ROLES)

import { requireSession } from "@/lib/auth/session";
import { requireRecruitAdmin } from "@/lib/recruit/role-guard";
import { prisma } from "@/lib/prisma";
import { Section } from "@/components/ui/section";
import { Shield, Check, X } from "lucide-react";

export const dynamic = "force-dynamic";

const ROLES = [
  { key: "super_admin", label: "Super Admin", color: "bg-purple-100 text-purple-800" },
  { key: "org_admin", label: "Org Admin", color: "bg-blue-100 text-blue-800" },
  { key: "admin", label: "Admin / HR", color: "bg-[var(--color-brand-100)] text-[var(--color-brand-800)]" },
  { key: "area_manager", label: "Area Manager", color: "bg-orange-100 text-orange-800" },
  { key: "branch_manager", label: "ผจก. สาขา", color: "bg-amber-100 text-amber-800" },
  { key: "viewer", label: "Viewer", color: "bg-zinc-100 text-zinc-700" },
];

const CAPABILITIES = [
  // [label, allowedRoles[]]
  { label: "📄 ดูใบสมัคร", access: ["super_admin", "org_admin", "admin", "area_manager", "branch_manager", "viewer"] },
  { label: "📝 สร้างประกาศ", access: ["super_admin", "org_admin", "admin", "area_manager", "branch_manager"] },
  { label: "🔄 เปลี่ยน status", access: ["super_admin", "org_admin", "admin", "area_manager", "branch_manager"] },
  { label: "🏷 ติด tag / ให้ดาว", access: ["super_admin", "org_admin", "admin", "area_manager", "branch_manager"] },
  { label: "💬 ส่งข้อความ (Messaging)", access: ["super_admin", "org_admin", "admin", "area_manager", "branch_manager"] },
  { label: "📅 นัดสัมภาษณ์", access: ["super_admin", "org_admin", "admin", "area_manager", "branch_manager"] },
  { label: "🤖 ประเมินด้วย AI", access: ["super_admin", "org_admin", "admin", "area_manager", "branch_manager"] },
  { label: "🚫 เพิ่ม Blacklist", access: ["super_admin", "org_admin", "admin", "area_manager", "branch_manager"] },
  { label: "🗑 ถอน Blacklist", access: ["super_admin", "org_admin", "admin"] },
  { label: "⚡ ตั้งกฎ Auto-screen", access: ["super_admin", "org_admin", "admin"] },
  { label: "💰 จ่ายโบนัส Referral", access: ["super_admin", "org_admin", "admin"] },
  { label: "🔥 ลบข้อมูล (PDPA)", access: ["super_admin", "org_admin", "admin"] },
  { label: "⚙️ ตั้งค่าโปรแกรม", access: ["super_admin", "org_admin", "admin"] },
];

export default async function PermissionsPage() {
  const session = await requireSession();
  requireRecruitAdmin(session.user.role);

  // Count users per role
  const userCounts = await prisma.user.groupBy({
    by: ["role"],
    where: { orgId: session.user.org_id, isActive: true },
    _count: { id: true },
  });
  const countByRole = new Map<string, number>(
    userCounts.map((c) => [c.role as string, c._count.id]),
  );

  return (
    <div className="p-5 sm:p-8 max-w-6xl mx-auto">
      <Section
        number="13.2"
        label="Permissions"
        title="สิทธิการใช้งาน"
        description="แสดงว่า role ไหนทำอะไรได้ใน Recruit module · แก้ไข role assignment ที่ /users"
      >
        <div className="rounded-2xl bg-gradient-to-br from-[var(--color-brand-50)] to-white border border-[var(--color-brand-200)] p-4 mb-6 flex items-center gap-3">
          <Shield className="size-5 text-[var(--color-brand-700)] shrink-0" />
          <div className="flex-1 text-xs text-zinc-700 leading-relaxed">
            <b className="text-[var(--color-brand-900)]">หมายเหตุ:</b> สิทธิ์เป็น read-only ที่นี่ ·
            ปรับ role ของแต่ละคนได้ที่หน้า{" "}
            <a href="/users" className="text-[var(--color-brand-700)] font-bold underline">
              /users
            </a>
            {" · "}
            ทุก action ที่จำกัด role จะถูก enforce ที่ server (role-guard.ts)
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-zinc-50 border-b border-zinc-200">
                <th className="text-left text-xs font-bold text-zinc-700 px-4 py-3 min-w-[260px]">
                  ความสามารถ
                </th>
                {ROLES.map((r) => (
                  <th
                    key={r.key}
                    className="text-center text-xs font-bold text-zinc-700 px-3 py-3 min-w-[100px]"
                  >
                    <div className="flex flex-col items-center gap-1">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${r.color}`}>
                        {r.label}
                      </span>
                      <span className="text-[10px] text-zinc-400 tabular-num">
                        {countByRole.get(r.key) ?? 0} คน
                      </span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CAPABILITIES.map((cap, i) => (
                <tr
                  key={cap.label}
                  className={`border-b border-zinc-100 ${i % 2 === 0 ? "" : "bg-zinc-50/30"}`}
                >
                  <td className="text-sm text-zinc-900 px-4 py-3 font-medium">{cap.label}</td>
                  {ROLES.map((r) => (
                    <td key={r.key} className="text-center px-3 py-3">
                      {cap.access.includes(r.key) ? (
                        <span className="inline-flex size-7 rounded-full bg-green-100 text-green-700 items-center justify-center">
                          <Check className="size-4" strokeWidth={3} />
                        </span>
                      ) : (
                        <span className="inline-flex size-7 rounded-full bg-zinc-100 text-zinc-400 items-center justify-center">
                          <X className="size-3.5" />
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-6 rounded-2xl bg-amber-50 border border-amber-200 p-4 text-xs text-amber-900 leading-relaxed">
          <p className="font-bold mb-1">📌 หลักการตั้ง role:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <b>Admin / HR</b> = บทบาทหลักทำงาน recruit ทุกวัน
            </li>
            <li>
              <b>Branch Manager / Area Manager</b> = HR ภาคสนาม · ใช้ในสาขา · เพิ่ม Blacklist
              ได้แต่ถอนไม่ได้
            </li>
            <li>
              <b>Super Admin / Org Admin</b> = เปลี่ยนตั้งค่าได้ทุกอย่าง · ใช้สำหรับเจ้าของ /
              ผู้ดูแลหลัก
            </li>
            <li>
              <b>Viewer</b> = read-only · เหมาะกับฝ่ายบัญชี / ผู้ตรวจสอบ
            </li>
          </ul>
        </div>
      </Section>
    </div>
  );
}
