/**
 * ClawOS layout — gate (module entitlement + role) แล้วเรนเดอร์เนื้อหาภายใน AdminShell มาตรฐาน.
 * Chrome (เมนูซ้าย ตู้คีบ OS · ติชม Pinpoint · กลับหน้าหลัก · เปลี่ยนโปรแกรม · Audit log · ตั้งค่า)
 * มาจาก AdminShell ของ app/(admin)/layout.tsx อัตโนมัติ — เหมือนทุกโปรแกรม (CashHub/DC).
 * เมนูตู้คีบมาจาก lib/modules.ts (nav + section หลังบ้าน/หน้าบ้าน + roles).
 */
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { userHasModuleAccess, isAdminTier } from "@/lib/auth/module-access";
import { isModuleDisabled } from "@/lib/modules";
import { CF_ALL_ROLES } from "@/lib/clawfleet/role-guard";
import { OsChrome } from "@/components/clawfleet/os/os-header";
import "./clawos.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "ตู้คีบ OS" };

export default async function ClawOsLayout({ children }: { children: React.ReactNode }) {
  if (isModuleDisabled("clawfleet")) redirect("/dashboard");
  const session = await requireSession();
  if (!(CF_ALL_ROLES as readonly string[]).includes(session.user.role)) redirect("/403");
  if (!isAdminTier(session.user.role)) {
    const ok = await userHasModuleAccess(session.user, "clawfleet");
    if (!ok) redirect("/403");
  }

  return (
    <div className="clawos" style={{ background: "#F5F6F8", minHeight: "100%" }}>
      <OsChrome>{children}</OsChrome>
    </div>
  );
}
