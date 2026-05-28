import type { ReactNode } from "react";
import { V2Shell } from "@/components/clawfleet/v2/shell";
import { loadBranches } from "@/lib/clawfleet/v2-loaders";
import "./clawfleet-redesign.css";

export const dynamic = "force-dynamic";

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
  const branches = await loadBranches();
  return (
    <div className="cf-scope">
      <V2Shell branches={branches}>{children}</V2Shell>
    </div>
  );
}
