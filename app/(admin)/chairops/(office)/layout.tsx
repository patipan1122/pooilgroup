// Office route-group shell.
//
// Wraps every (office) page in:
//   1. OFFICE+ role gate (defense-in-depth on top of chairops/layout.tsx
//      entitlement gate per [[module-entitlement-must-gate-all-layouts]])
//   2. `.co-scope` + `.chairops-scope` CSS namespaces so kit primitives pick up
//      ChairOps redesign tokens.
//
// The Pool admin shell (app/(admin)/layout.tsx) already renders the topbar +
// left sidebar (the single ChairOps nav, from lib/modules.ts). The old in-shell
// header + horizontal top-nav were a DUPLICATE of that sidebar (CEO 2026-05-28
// "เมนูซ้ำ") and were removed. Content is now full-width (no max-w) to match the
// mockup (CEO "พื้นที่สีขาวเหลือเยอะ · ใช้เต็มพื้นที่").

import { requireRole } from "@/lib/chairops/auth/session";

export const dynamic = "force-dynamic";

export default async function OfficeShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireRole("OFFICE");

  return (
    <div className="co-scope chairops-scope min-h-[calc(100vh-3.5rem)] bg-muted/40 sm:min-h-[calc(100vh-4rem)]">
      <main className="w-full px-4 py-5 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}
