// CafeOrder module layout — gates entire /cafeorder/** back-office subtree.
//
// Gate stack (per [[module-entitlement-must-gate-all-layouts]]):
//   1. Kill switch (MODULES_DISABLED env)
//   2. Session required
//   3. Role minimum (CAFE_ROLES)
//   4. Module entitlement (user_modules grant or admin tier)
//
// NOTE: customer storefront (/order/<shopSlug>) is a PUBLIC web route — NOT under (admin),
//       so it is intentionally not gated here (web-first pivot 2026-07-25).

import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { userHasModuleAccess, isAdminTier } from "@/lib/auth/module-access";
import { isModuleDisabled } from "@/lib/modules";
import { requireCafeAccess } from "@/lib/cafeorder/role-guard";
import "@/components/cafeorder/tokens.css";

export const dynamic = "force-dynamic";

export const metadata = { title: "CafeOrder" };

export default async function CafeOrderLayout({ children }: { children: React.ReactNode }) {
  if (isModuleDisabled("cafeorder")) redirect("/dashboard");
  const session = await requireSession();
  requireCafeAccess(session.user.role);
  if (!isAdminTier(session.user.role)) {
    const ok = await userHasModuleAccess(session.user, "cafeorder");
    if (!ok) redirect("/403");
  }
  return <div className="cafe-scope">{children}</div>;
}
