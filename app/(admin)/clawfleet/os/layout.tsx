/**
 * ClawOS layout — gate (module entitlement + role) แล้วครอบด้วย ClawOsShell.
 * full-bleed: AdminShell ฝั่งนอกจะข้าม chrome ให้ (ดู isClawOsFullBleedPath ใน admin-shell.tsx).
 */
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { userHasModuleAccess, isAdminTier } from "@/lib/auth/module-access";
import { isModuleDisabled } from "@/lib/modules";
import { CF_ALL_ROLES } from "@/lib/clawfleet/role-guard";
import { loadNavCounts } from "@/lib/clawfleet/v2-loaders";
import { ClawOsShell } from "@/components/clawfleet/os/shell";
import type { NavCounts } from "@/components/clawfleet/os/nav";
import "./clawos.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "ตู้คีบ OS" };

const ROLE_LABEL: Record<string, string> = {
  super_admin: "เจ้าของร้าน",
  org_admin: "เจ้าของร้าน",
  admin: "เจ้าของร้าน",
  area_manager: "ผู้จัดการเขต",
  branch_manager: "ผจก.สาขา",
  staff: "พนักงานเก็บเงิน",
  viewer: "ผู้ดูข้อมูล",
  program_admin: "แอดมินโปรแกรม",
};

export default async function ClawOsLayout({ children }: { children: React.ReactNode }) {
  if (isModuleDisabled("clawfleet")) redirect("/dashboard");
  const session = await requireSession();
  if (!(CF_ALL_ROLES as readonly string[]).includes(session.user.role)) redirect("/403");
  if (!isAdminTier(session.user.role)) {
    const ok = await userHasModuleAccess(session.user, "clawfleet");
    if (!ok) redirect("/403");
  }

  let counts: NavCounts = {};
  try {
    const nav = await loadNavCounts();
    counts = { diffs: nav.anomalies, anomalies: nav.anomalies };
  } catch {
    counts = {};
  }

  return (
    <ClawOsShell
      user={{ name: session.user.name ?? "พนักงาน", roleLabel: ROLE_LABEL[session.user.role] ?? "ผู้ใช้" }}
      role={session.user.role}
      counts={counts}
    >
      {children}
    </ClawOsShell>
  );
}
