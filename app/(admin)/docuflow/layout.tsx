// Layout guard for /docuflow/** routes — blocks users who don't have DocuFlow
// in their user_modules grants. Admin tier (super/org_admin/admin) bypasses.
//
// Wraps children in `.df-root` so canvas-aligned design tokens from
// `./docuflow.css` apply across all /docuflow pages without polluting
// other modules. Also renders the canvas-style mobile bottom nav.

import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { userHasModuleAccess, isAdminTier } from "@/lib/auth/module-access";
import { isModuleDisabled } from "@/lib/modules";
import { prisma } from "@/lib/prisma";
import { DfMobileBottomNav } from "@/components/docuflow/df-mobile-nav";
import "./docuflow.css";

export const dynamic = "force-dynamic";

export default async function DocuFlowLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (isModuleDisabled("docuflow")) redirect("/dashboard");
  const session = await requireSession();
  if (!isAdminTier(session.user.role)) {
    const ok = await userHasModuleAccess(session.user, "docuflow");
    if (!ok) redirect("/403");
  }

  // Count expiring docs ≤30d for the mobile bottom-nav badge
  const renewBadge = await prisma.documentRenewal.count({
    where: {
      orgId: session.user.org_id,
      expiryDate: { lte: new Date(Date.now() + 30 * 86400000) },
      document: { isActive: true },
    },
  });

  return (
    <div className="df-root">
      {children}
      <DfMobileBottomNav badgeRenew={renewBadge} />
    </div>
  );
}
