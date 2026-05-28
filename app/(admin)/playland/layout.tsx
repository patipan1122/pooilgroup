// Playland module layout — gates entire /playland/** subtree.
//
// Gate stack (per memory module-entitlement-must-gate-all-layouts):
//   1. Kill switch (MODULES_DISABLED env)
//   2. Session required
//   3. Module entitlement (user_modules grant or admin tier)
//   4. Role minimum (any PLAYLAND_ROLES)

import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { userHasModuleAccess, isAdminTier } from "@/lib/auth/module-access";
import { isModuleDisabled } from "@/lib/modules";
import { requirePlaylandAccess } from "@/lib/playland/role-guard";
import { CommandPalette } from "@/components/playland/command-palette";
import { MobileBottomNav } from "@/components/playland/mobile-bottom-nav";
import "./playland.css";

export const dynamic = "force-dynamic";

export default async function PlaylandLayout({ children }: { children: React.ReactNode }) {
  if (isModuleDisabled("playland")) redirect("/dashboard");
  const session = await requireSession();
  requirePlaylandAccess(session.user.role);
  if (!isAdminTier(session.user.role)) {
    const ok = await userHasModuleAccess(session.user, "playland");
    if (!ok) redirect("/403");
  }
  return (
    <div className="pl-root pl-shell">
      <CommandPalette />
      {children}
      <MobileBottomNav />
    </div>
  );
}
