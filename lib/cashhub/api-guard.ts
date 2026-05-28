// Unified entitlement + role gate for /api/cashhub/* routes.
//
// Why: the layout `app/(admin)/cashhub/layout.tsx` already calls
// `isModuleDisabled("cashhub")` + `userHasModuleAccess(...)`, but API
// routes hit Supabase directly without going through the layout.
// Without this guard, a user without CashHub entitlement could still
// POST /api/cashhub/approve from a stale tab. [[module-entitlement-must-gate-all-layouts]]
// applies here too — role + entitlement.
//
// Usage pattern (most read-only endpoints):
//   const gate = await cashHubApiGuard();
//   if (gate.error) return gate.error;
//   const { session } = gate;
//
// For approve/unlock/destructive endpoints, pass `{ executive: true }`
// to also enforce `requireExecutiveRole` semantics.

import { NextResponse } from "next/server";
import { getSession, type Session } from "@/lib/auth/session";
import { isModuleDisabled } from "@/lib/modules";
import { userHasModuleAccess, isAdminTier } from "@/lib/auth/module-access";
import { isExecutiveRole } from "@/lib/auth/role-guards";

interface GuardOptions {
  /** Require executive role (super_admin / org_admin / admin / executive). */
  executive?: boolean;
}

type GuardResult =
  | { error: NextResponse; session?: undefined }
  | { error?: undefined; session: Session };

export async function cashHubApiGuard(
  options: GuardOptions = {},
): Promise<GuardResult> {
  if (isModuleDisabled("cashhub")) {
    return {
      error: NextResponse.json(
        { error: "CashHub is disabled" },
        { status: 503 },
      ),
    };
  }

  const session = await getSession();
  if (!session) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  if (options.executive && !isExecutiveRole(session.user.role)) {
    return {
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  // Admin tier bypasses entitlement check (mirrors module-access.userHasModuleAccess).
  if (!isAdminTier(session.user.role)) {
    const ok = await userHasModuleAccess(session.user, "cashhub");
    if (!ok) {
      return {
        error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
      };
    }
  }

  return { session };
}
