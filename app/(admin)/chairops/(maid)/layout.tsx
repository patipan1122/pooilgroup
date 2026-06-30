// Maid-only PWA layout · mobile-first · 360x640 baseline · Android Go.
//
// W6 spec (claude-design Phase 2 §W6):
//   - viewport meta width=device-width, initial-scale=1
//   - bottom-nav 4 items only (เก็บเงิน/ความสะอาด/แจ้งซ่อม/บัญชี per IA §4.4)
//   - 44pt touch targets
//   - no backdrop-blur (Chrome <80 unsupported)
//   - .chairops-scope wrapper (D-NEW-5)
//
// MAID role gate enforced here; per-page guards still call requireExactRole.
// F9: inactive maid → graceful deactivated screen (not /403).
// F4: onboarding gate → /chairops/m/onboarding before MAID can use /m/*.

import type { Metadata, Viewport } from "next";
import { redirect } from "next/navigation";
import {
  getMaidUserRaw,
} from "@/lib/chairops/auth/session";
import { requireSession as poolRequireSession, getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { MaidShell } from "./_components/maid-shell";

export const dynamic = "force-dynamic";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#0f172a",
};

export const metadata: Metadata = {
  title: "ChairOps · แม่บ้าน",
};

export default async function MaidRouteGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Step 1: enforce Pool authentication (redirects to /login if not signed in)
  await poolRequireSession();

  // Check if a super_admin is currently impersonating this maid
  const poolSession = await getSession();
  const actingAsName = poolSession?.actingAs?.realUser.name ?? null;

  // Step 2: get raw ChairopsUser — includes inactive users (needed for F9)
  const rawUser = await getMaidUserRaw();

  // No ChairopsUser row at all → access denied
  if (!rawUser) redirect("/403?reason=chairops_access_pending");

  // F9: deactivated maid → graceful screen (not /403)
  // The /deactivated route is OUTSIDE the (maid) layout group so it doesn't loop.
  if (!rawUser.isActive) redirect("/chairops/m/deactivated");

  // Non-maid roles (admin/office tapping Rich Menu) → branch collector
  if (rawUser.role !== "MAID") redirect("/chairops/branch-collect");

  // F4: onboarding gate — maid must complete profile before using /m/*
  // Skip gate for /m/onboarding itself to avoid infinite redirect.
  if (!rawUser.onboardingComplete) {
    redirect("/chairops/m/onboarding");
  }

  // Step 3: safe to query with active maid confirmed
  const pendingDepositCount = rawUser.primaryBranchId
    ? await prisma.chairopsCashCollection.count({
        where: {
          // soft-delete: hide rows deleted by super_admin (CEO 2026-06-30)
          deletedAt: null,
          orgId: rawUser.orgId,
          branchId: rawUser.primaryBranchId,
          maidId: rawUser.id,
          depositId: null,
        },
      })
    : 0;

  return (
    <div className="chairops-scope">
      <MaidShell
        displayName={rawUser.displayName}
        pendingDepositCount={pendingDepositCount}
        actingAsAdminName={actingAsName}
      >
        {children}
      </MaidShell>
    </div>
  );
}
