// DocuFlow · ตั้งค่า → ผู้ใช้งาน & สิทธิ์
// ────────────────────────────────────────────────────────────────────
// CEO 2026-09-30 (บนหน้า /docuflow/settings): "กรมผู้ใช้งานและสิทธิ์ตรงนี้ควร
// จะมีเวอร์ชันของมันเลยว่าในโปรแกรมนี้มันมีทั้งหมดกี่สิทธิ์แล้วจะต้องสามารถ
// เชิญพนักงานเฉพาะโปรแกรมนี้ได้เพื่อสามารถซอยตำแหน่งย่อยในหน้านี้ได้ด้วย" —
// เดิมการ์ด "ผู้ใช้งาน & สิทธิ์" ใน settings hub ลิงก์ไปหน้ากลางองค์กร (/users)
// ซึ่งไม่ได้เจาะจงโปรแกรมนี้ หน้านี้แทนที่ลิงก์นั้น (settings/page.tsx).
//
// Layout (locked ข้ามระบบ 2026-09-30 — โครงสร้าง ไม่ใช่ดีไซน์): แถวบน = tab
// ตำแหน่ง/สิทธิ์ พร้อมสรุป 1 บรรทัดต่อตำแหน่ง · ด้านล่าง = ตาราง employee ×
// permission-category (คอลัมน์ = หมวดสิทธิ์ที่จัดกลุ่มแล้ว ไม่ใช่ราย
// permission เดี่ยวๆ).
//
// คอลัมน์สิทธิ์ 3 คอลัมน์ในตารางนี้ผูกกับ gate จริงในโค้ด (ไม่ใช่ของสมมติ):
//   - "ดูเอกสาร/รายงาน"      → มี user_modules grant ที่ active สำหรับ docuflow
//     (userCanViewModule() — lib/auth/module-access.ts)
//   - "อัปโหลด/จัดการ/ตั้งค่า" → userIsModuleAdmin() (เกตทุกหน้าที่เขียนข้อมูล
//     ผ่าน requireModuleAdmin()/userCanAdminModule())
//   - "เชิญพนักงานเข้าโปรแกรมนี้" → userIsModuleAdmin() + canAssignRole() — กฎ
//     เดียวกับที่ inviteProgramStaff ใช้ตัดสินใจจริง
//
// 2026-09-30 FIXED (เดิมเป็นช่องโหว่ที่ค้นพบตอนสร้างหน้านี้): requireExecutiveRole/
// isProgramAdminTier เดิมเช็คแค่ org-wide role เท่านั้น ไม่เห็น user_modules grant
// เลย — พนักงานที่เชิญผ่านปุ่มด้านล่าง (ตำแหน่ง "staff" เสมอ) เปิดหน้า DocuFlow
// ไหนก็ไม่ได้เลย. แก้โดยเพิ่ม requireModuleView/requireModuleAdmin +
// userCanViewModule/userCanAdminModule (lib/auth/module-access.ts) — OR-condition
// เพิ่มเติมจาก grant เฉพาะโปรแกรมนี้ ไม่แตะ role-guards.ts เดิมหรือโมดูลอื่นเลย.
// ดู postmortems/staff-invite-grant-access-gate-2026-09-30.md
// ────────────────────────────────────────────────────────────────────

import { Check, Users as UsersIcon } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { roleRank } from "@/lib/auth/role-guards";
import { requireModuleAdmin } from "@/lib/auth/module-access";
import type { DbUser } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { MODULES } from "@/lib/modules";
import {
  DfCard,
  DfEyebrow,
  DfPageHeader,
  DfAvatar,
} from "@/components/docuflow/df-ui";
import { DfTopBanner } from "@/components/docuflow/df-top-banner";
import { InviteProgramStaffButton } from "@/components/users/invite-program-staff-button";
import { RoleCell } from "./role-cell";

export const dynamic = "force-dynamic";

const MODULE = "docuflow";

type TabKey = "all" | "admin_tier" | "program_admin" | "manager_viewer" | "staff_driver";

type Row = {
  id: string;
  name: string;
  email: string | null;
  orgRole: DbUser["role"];
  moduleRole: "admin" | "member" | null; // null = admin-tier bypass, ไม่มี grant row จริง
  tab: TabKey;
  canView: boolean;
  canManage: boolean;
  canInviteOthers: boolean;
};

const ORG_ROLE_LABEL: Record<DbUser["role"], string> = {
  super_admin: "Super Admin",
  org_admin: "Org Admin",
  admin: "แอดมิน",
  area_manager: "ผู้จัดการเขต",
  branch_manager: "ผู้จัดการสาขา",
  program_admin: "แอดมินโปรแกรม",
  staff: "พนักงาน",
  driver: "คนขับ",
  viewer: "ผู้ดูอย่างเดียว",
};

function tabGroupOf(orgRole: DbUser["role"], isAdminTierBypass: boolean): TabKey {
  if (isAdminTierBypass) return "admin_tier";
  if (orgRole === "program_admin") return "program_admin";
  if (orgRole === "branch_manager" || orgRole === "area_manager" || orgRole === "viewer") {
    return "manager_viewer";
  }
  return "staff_driver"; // staff, driver
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

const TAB_META: Record<
  Exclude<TabKey, "all">,
  { label: string; summary: string }
> = {
  admin_tier: {
    label: "ผู้ดูแลระบบ",
    summary: "ดูแลได้ทุกอย่างในทุกโปรแกรมอยู่แล้ว · ไม่ต้องเชิญเพิ่ม",
  },
  program_admin: {
    label: "แอดมินโปรแกรม",
    summary: "อัปโหลด · ตั้งค่า · จัดการลายเซ็น · เชิญคนอื่นเข้าโปรแกรมนี้ได้เต็มที่",
  },
  manager_viewer: {
    label: "ผู้จัดการ / ดูรายงาน",
    summary: "ดูเอกสารและรายงานได้ · แก้ไข/อัปโหลด/ตั้งค่าไม่ได้",
  },
  staff_driver: {
    label: "พนักงานเฉพาะโปรแกรมนี้",
    summary: "เชิญผ่านปุ่มด้านล่างได้ · ดูเอกสารและรายงานของโปรแกรมนี้ได้ทันที",
  },
};

export default async function DocuFlowUsersPermissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  const session = await requireSession();
  await requireModuleAdmin(session.user, "docuflow");
  const orgId = session.user.org_id;
  const callerIsSuperAdmin = session.user.role === "super_admin";

  const sp = await searchParams;
  const activeTab: TabKey = (
    ["admin_tier", "program_admin", "manager_viewer", "staff_driver"].includes(
      sp.role ?? "",
    )
      ? sp.role
      : "all"
  ) as TabKey;

  const admin = adminClient();

  const [{ data: adminTierUsers }, { data: grantRows }] = await Promise.all([
    admin
      .from("users")
      .select("id, name, email, role, is_active")
      .eq("org_id", orgId)
      .eq("is_active", true)
      .in("role", ["super_admin", "org_admin", "admin"]),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (admin.from as any)("user_modules")
      // `users` explicit FK hint (!user_modules_user_id_fkey) is REQUIRED —
      // user_modules has TWO foreign keys into users (user_id AND
      // granted_by), so a plain `users(...)` embed is ambiguous and
      // PostgREST returns PGRST201 with data=null (silently, if the error
      // isn't checked). Found live while testing this page: the org-wide
      // /users/permissions overview page has the exact same bug — see
      // that file for the same fix.
      .select(
        "user_id, role, users!user_modules_user_id_fkey(id, name, email, role, is_active)",
      )
      .eq("org_id", orgId)
      .eq("module_name", MODULE)
      .eq("is_active", true),
  ]);

  type GrantRow = {
    user_id: string;
    role: "admin" | "member";
    users: { id: string; name: string; email: string | null; role: DbUser["role"]; is_active: boolean } | null;
  };

  const rowMap = new Map<string, Row>();

  for (const u of (adminTierUsers ?? []) as Array<{
    id: string;
    name: string;
    email: string | null;
    role: DbUser["role"];
    is_active: boolean;
  }>) {
    rowMap.set(u.id, {
      id: u.id,
      name: u.name,
      email: u.email,
      orgRole: u.role,
      moduleRole: null,
      tab: "admin_tier",
      canView: true,
      canManage: true,
      canInviteOthers: true,
    });
  }

  for (const g of (grantRows ?? []) as GrantRow[]) {
    if (!g.users?.is_active) continue; // ปิดบัญชีแล้ว — ไม่โชว์เหมือนมีสิทธิ์อยู่
    if (rowMap.has(g.user_id)) continue; // เป็นแอดมินองค์กรอยู่แล้ว ครอบคลุมเต็มที่กว่า grant row นี้
    const orgRole = g.users.role;
    const moduleRole = g.role;
    const isModuleAdminSignal = orgRole === "program_admin" || moduleRole === "admin";
    rowMap.set(g.user_id, {
      id: g.user_id,
      name: g.users.name,
      email: g.users.email,
      orgRole,
      moduleRole,
      tab: tabGroupOf(orgRole, false),
      // 2026-09-30 fix: holding ANY active grant row here (this loop only
      // iterates docuflow grant rows) now IS the view-access signal — see
      // requireModuleAdmin/userCanViewModule in lib/auth/module-access.ts.
      // canManage mirrors userIsModuleAdmin()'s own logic exactly
      // (isModuleAdminSignal, computed above).
      canView: true,
      canManage: isModuleAdminSignal,
      canInviteOthers: isModuleAdminSignal && roleRank(orgRole) > roleRank("staff"),
    });
  }

  const rows = Array.from(rowMap.values()).sort((a, b) => {
    const rankDiff = roleRank(b.orgRole) - roleRank(a.orgRole);
    if (rankDiff !== 0) return rankDiff;
    return a.name.localeCompare(b.name, "th");
  });

  const countByTab: Record<Exclude<TabKey, "all">, number> = {
    admin_tier: 0,
    program_admin: 0,
    manager_viewer: 0,
    staff_driver: 0,
  };
  for (const r of rows) countByTab[r.tab as Exclude<TabKey, "all">]++;

  const visibleRows = activeTab === "all" ? rows : rows.filter((r) => r.tab === activeTab);
  const tabKeys: Exclude<TabKey, "all">[] = [
    "admin_tier",
    "program_admin",
    "manager_viewer",
    "staff_driver",
  ];
  const levelCount = tabKeys.filter((k) => countByTab[k] > 0).length || tabKeys.length;

  return (
    <div
      style={{
        padding: "28px clamp(16px, 4vw, 40px)",
        paddingBottom: 96,
        maxWidth: 1200,
        margin: "0 auto",
      }}
    >
      <DfTopBanner
        breadcrumbs={[
          { label: "หน้าหลัก", href: "/docuflow" },
          { label: "ตั้งค่า", href: "/docuflow/settings" },
          { label: "ผู้ใช้งาน & สิทธิ์" },
        ]}
      />

      <DfPageHeader
        eyebrow={<DfEyebrow>ตั้งค่า DocuFlow</DfEyebrow>}
        title="ผู้ใช้งาน & สิทธิ์"
        description={`ในโปรแกรมนี้มี ${levelCount} ระดับตำแหน่ง · ${rows.length} คนมีสิทธิ์เข้าใช้งานอยู่ตอนนี้ — เชิญพนักงานเฉพาะ DocuFlow และดูว่าใครทำอะไรได้บ้าง`}
        actions={
          <div style={{ textAlign: "right" }}>
            <InviteProgramStaffButton moduleSlug={MODULE} programName={MODULES.docuflow.name} />
          </div>
        }
      />

      <DfCard
        padding={14}
        style={{
          marginBottom: 20,
          display: "flex",
          gap: 10,
          alignItems: "flex-start",
          background: "var(--df-success-soft)",
          borderColor: "var(--df-success)",
        }}
      >
        <UsersIcon size={16} style={{ color: "var(--df-success)", flexShrink: 0, marginTop: 2 }} />
        <p style={{ fontSize: 12.5, color: "var(--df-ink-2)", margin: 0, lineHeight: 1.6 }}>
          <b>หมายเหตุ:</b> พนักงานที่เชิญผ่านปุ่ม &ldquo;เชิญพนักงาน&rdquo; จะได้ตำแหน่ง
          &ldquo;พนักงาน&rdquo; เสมอ (ต่ำกว่าคุณเสมอ กันไม่ให้แต่งตั้งคนระดับเดียวกัน) — เปิดดูเอกสาร/รายงานของ
          DocuFlow ได้ทันทีที่รับคำเชิญ ถ้าต้องการให้อัปโหลด/จัดการ/ตั้งค่าได้ด้วย ให้ปรับตำแหน่งในตารางด้านล่างเป็น
          &ldquo;แอดมิน&rdquo;
        </p>
      </DfCard>

      {/* แถว role tabs — โครงสร้างล็อกไว้ 2026-09-30: 1 tab ต่อ 1 ตำแหน่ง
          พร้อมสรุปความสามารถ 1 บรรทัด · tab ที่เลือกอยู่ถูกไฮไลต์ */}
      <div
        style={{
          display: "flex",
          gap: 10,
          overflowX: "auto",
          paddingBottom: 4,
          marginBottom: 20,
        }}
      >
        <RoleTab
          href="/docuflow/settings/users"
          active={activeTab === "all"}
          label="ทั้งหมด"
          summary={`ดูทุกตำแหน่งรวมกัน (${rows.length} คน)`}
          count={rows.length}
        />
        {tabKeys.map((k) => (
          <RoleTab
            key={k}
            href={`/docuflow/settings/users?role=${k}`}
            active={activeTab === k}
            label={TAB_META[k].label}
            summary={TAB_META[k].summary}
            count={countByTab[k]}
          />
        ))}
      </div>

      {/* ตาราง employee × permission-category — คอลัมน์แรก = พนักงาน,
          คอลัมน์ที่ 2 = ตำแหน่ง (แก้ไขได้), ที่เหลือ = หมวดสิทธิ์ที่จัดกลุ่มแล้ว */}
      <div
        style={{
          overflowX: "auto",
          borderRadius: 16,
          border: "1px solid var(--df-line)",
          background: "var(--df-surface)",
        }}
      >
        <table style={{ width: "100%", minWidth: 720, borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "var(--df-bg-warm)" }}>
              <Th style={{ position: "sticky", left: 0, background: "var(--df-bg-warm)", zIndex: 1 }}>
                พนักงาน
              </Th>
              <Th>ตำแหน่งในโปรแกรมนี้</Th>
              <Th center>ดูเอกสาร / รายงาน</Th>
              <Th center>อัปโหลด / จัดการ / ตั้งค่า</Th>
              <Th center>เชิญพนักงานเข้าโปรแกรมนี้</Th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 && (
              <tr>
                <td colSpan={5} style={{ padding: "32px 16px", textAlign: "center", color: "var(--df-muted)", fontSize: 13 }}>
                  ยังไม่มีใครอยู่ในตำแหน่งนี้
                </td>
              </tr>
            )}
            {visibleRows.map((r, i) => (
              <tr key={r.id} style={{ borderTop: "1px solid var(--df-line)" }}>
                <td
                  style={{
                    padding: "10px 14px",
                    position: "sticky",
                    left: 0,
                    background: i % 2 === 0 ? "var(--df-surface)" : "var(--df-surface-soft)",
                    zIndex: 1,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <DfAvatar initials={initialsOf(r.name)} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, color: "var(--df-ink)", whiteSpace: "nowrap" }}>
                        {r.name}
                        {r.id === session.user.id && (
                          <span style={{ marginLeft: 6, fontSize: 10, color: "var(--df-muted)" }}>
                            (คุณ)
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--df-muted)" }}>
                        {r.email ?? "—"} · {ORG_ROLE_LABEL[r.orgRole]}
                      </div>
                    </div>
                  </div>
                </td>
                <td style={{ padding: "10px 14px" }}>
                  {r.moduleRole === null ? (
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: "var(--df-brand)",
                        background: "var(--df-brand-soft)",
                        borderRadius: 999,
                        padding: "4px 10px",
                        whiteSpace: "nowrap",
                      }}
                    >
                      ผู้ดูแลระบบ
                    </span>
                  ) : (
                    <RoleCell
                      userId={r.id}
                      initialRole={r.moduleRole}
                      callerIsSuperAdmin={callerIsSuperAdmin}
                    />
                  )}
                </td>
                <Cell ok={r.canView} />
                <Cell ok={r.canManage} />
                <Cell ok={r.canInviteOthers} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RoleTab({
  href,
  active,
  label,
  summary,
  count,
}: {
  href: string;
  active: boolean;
  label: string;
  summary: string;
  count: number;
}) {
  return (
    <a
      href={href}
      style={{
        flex: "0 0 auto",
        minWidth: 200,
        maxWidth: 240,
        padding: "12px 14px",
        borderRadius: 14,
        textDecoration: "none",
        border: active ? "1.5px solid var(--df-brand)" : "1px solid var(--df-line)",
        background: active ? "var(--df-brand-soft)" : "var(--df-surface)",
        boxShadow: active ? "var(--df-shadow-1)" : "none",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 4,
        }}
      >
        <span
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: active ? "var(--df-brand)" : "var(--df-ink)",
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: active ? "var(--df-brand)" : "var(--df-muted)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {count}
        </span>
      </div>
      <p style={{ fontSize: 11, color: "var(--df-muted)", margin: 0, lineHeight: 1.5 }}>
        {summary}
      </p>
    </a>
  );
}

function Th({
  children,
  center,
  style,
}: {
  children: React.ReactNode;
  center?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <th
      style={{
        padding: "10px 14px",
        textAlign: center ? "center" : "left",
        fontSize: 11,
        fontWeight: 700,
        color: "var(--df-ink-2)",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {children}
    </th>
  );
}

function Cell({ ok }: { ok: boolean }) {
  return (
    <td style={{ padding: "10px 14px", textAlign: "center" }}>
      {ok ? (
        <span
          style={{
            display: "inline-flex",
            width: 24,
            height: 24,
            borderRadius: 999,
            alignItems: "center",
            justifyContent: "center",
            background: "var(--df-success-soft)",
            color: "var(--df-success)",
          }}
          aria-label="ทำได้"
        >
          <Check size={14} strokeWidth={3} />
        </span>
      ) : (
        <span style={{ color: "var(--df-muted-2)" }} aria-label="ทำไม่ได้">
          —
        </span>
      )}
    </td>
  );
}
