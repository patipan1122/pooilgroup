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

import type { Metadata, Viewport } from "next";
import { redirect } from "next/navigation";
import {
  requireAuth,
} from "@/lib/chairops/auth/session";
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
  const session = await requireAuth();
  // 2026-05-30: Rich Menu URIs always land here even when the caller is an
  // admin/office user (the URI is global per LINE OA, not per user). Hard-
  // 403 was unfriendly — bounce non-maid roles to the office branch picker
  // so CEO can pick a branch + impersonate from the same tap.
  if (session.user.role !== "MAID") {
    redirect("/chairops/branch-collect");
  }
  return (
    <div className="chairops-scope">
      <MaidShell displayName={session.user.displayName}>{children}</MaidShell>
    </div>
  );
}
