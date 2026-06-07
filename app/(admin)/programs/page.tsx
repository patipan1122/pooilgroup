// /programs — the full program directory (mobile bottom-nav "โปรแกรม" tab +
// desktop sidebar "โปรแกรมทั้งหมด"). Pure launcher: grouped grid of every
// program the user can access. No module-specific data (module isolation rule).

import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { loadUserModules } from "@/lib/auth/module-access";
import { buildProgramGroups, ProgramGrid } from "@/components/features/hub/programs";

export const dynamic = "force-dynamic";

export default async function ProgramsPage() {
  const session = await requireSession();

  // Same audience as /home — field roles live inside one module.
  if (session.user.role === "driver") redirect("/driver");
  if (session.user.role === "staff") redirect("/cashhub/quick-fill");
  if (session.user.role === "branch_manager") redirect("/cashhub/my-branches");
  if (session.user.role === "area_manager") redirect("/cashhub/dashboard");

  const orgId = session.user.org_id;
  const isSuperAdmin = session.user.role === "super_admin";

  const access = await loadUserModules(session.user);
  const canSee = (slug: string) => access.has(slug as never);

  const { data: moduleStatus } = await adminClient()
    .from("org_modules")
    .select("module_name, is_active")
    .eq("org_id", orgId);

  const moduleEnabled: Record<string, boolean> = {
    cashhub: true,
    ...Object.fromEntries(
      (moduleStatus ?? []).map((m) => [m.module_name, m.is_active]),
    ),
  };

  const { groups, total } = buildProgramGroups(
    canSee,
    moduleEnabled,
    isSuperAdmin,
  );

  return (
    <div className="p-4 sm:p-8 lg:p-12 max-w-6xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-extrabold tracking-tight font-display text-zinc-900">
          โปรแกรมทั้งหมด
        </h1>
        <p className="text-sm text-zinc-500 mt-1">
          แตะการ์ดเพื่อเข้าโปรแกรม — ทุกโปรแกรมใช้บัญชีเดียวกัน
        </p>
      </header>

      <ProgramGrid groups={groups} total={total} />
    </div>
  );
}
