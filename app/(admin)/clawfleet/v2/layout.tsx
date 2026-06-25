import type { ReactNode } from "react";
import { V2Shell } from "@/components/clawfleet/v2/shell";
import { loadBranches, loadNavCounts } from "@/lib/clawfleet/v2-loaders";
import { getSession } from "@/lib/auth/session";
import type { DbUser } from "@/lib/auth/session";
import "./clawfleet-redesign.css";
import "./clawfleet-playalot.css"; // Playalot skin — loaded AFTER base to override tokens
import "./clawfleet-house.css"; // House style (Playland/ChairOps) — loaded LAST, wins over Playalot

export const dynamic = "force-dynamic";

/** role → human label ภาษาคน (ไม่โชว์ enum ดิบให้ผู้ใช้) */
const ROLE_LABEL: Partial<Record<DbUser["role"], string>> = {
  super_admin: "ผู้ดูแลระบบ",
  org_admin: "แอดมินองค์กร",
  admin: "แอดมินองค์กร",
  branch_manager: "ผู้จัดการสาขา",
  area_manager: "ผู้จัดการเขต",
  staff: "พนักงาน",
};

/**
 * ClawFleet v2 (redesign) layout.
 *
 * Auth + module-entitlement is already enforced by the parent
 * `app/(admin)/clawfleet/layout.tsx` (requireSession → role check →
 * userHasModuleAccess → isModuleDisabled). This nested layout only:
 *   1. loads the scoped redesign CSS once for the whole v2 subtree
 *   2. wraps everything in `.cf-scope` so the design tokens + reset apply
 *      without bleeding into the rest of Pool.
 *   3. renders the SPA shell (Sidebar + TopBar) once · pages render content only.
 */
export default async function ClawfleetV2Layout({ children }: { children: ReactNode }) {
  const [branches, navCounts, session] = await Promise.all([
    loadBranches(),
    loadNavCounts(),
    getSession(),
  ]);
  const role = session?.user.role;
  const user = session
    ? {
        name: session.user.name,
        roleLabel: (role && ROLE_LABEL[role]) || role || "",
        initial: session.user.name.trim().charAt(0) || "?",
      }
    : null;
  return (
    <div className="cf-scope">
      <V2Shell branches={branches} navCounts={navCounts} user={user}>
        {children}
      </V2Shell>
    </div>
  );
}
