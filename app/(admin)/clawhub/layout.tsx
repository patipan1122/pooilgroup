// ClawHub (JOLLY PLAY) — back-office module layout.
//
// This is a NESTED layout: the global app/(admin)/layout.tsx already renders the
// AdminShell (top nav + module switcher + sidebar built from MODULES.clawhub). So
// here we only (1) gate the whole /clawhub subtree and (2) load the ClawHub theme
// tokens + wrap the page content in `.clawhub-scope` so the warm arcade palette
// applies without bleeding into other modules.
//
// Gate: requireClawhubAdmin() — super_admin/org_admin/admin OR a program_admin who
// holds an active "clawhub" module grant. Anyone else → /403 (no hidden gate, per
// the program-admin-must-just-work principle).

import "@/components/clawhub/tokens.css";
import { requireClawhubAdmin } from "@/lib/clawhub/access";

export const dynamic = "force-dynamic";

export const metadata = { title: "JOLLY PLAY · ClawHub" };

export default async function ClawhubAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireClawhubAdmin();
  return <div className="clawhub-scope">{children}</div>;
}
