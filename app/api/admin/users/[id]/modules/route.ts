// PUT /api/admin/users/[id]/modules — set the modules a user can access.
// Replaces the user's full membership list in one call.
// Admin tier (super_admin / org_admin / admin) does not need rows here —
// they bypass the user_modules check in lib/auth/module-access.ts. Sending
// modules for an admin-tier user is accepted but is a no-op visibility-wise.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";
import { canManageUser } from "@/lib/auth/role-guards";
import type { DbUser } from "@/lib/auth/session";
import { MODULES } from "@/lib/modules";

// Derived from the registry so every current module is grantable — the old
// hard-coded 5-slug enum silently blocked inbox/chairops/clawfleet/etc.
const ModuleSchema = z.enum(Object.keys(MODULES) as [string, ...string[]]);

const PutSchema = z.object({
  modules: z.array(ModuleSchema),
  // Subset of `modules` the user is the ADMIN of (program admin). Others are
  // plain members. Written explicitly so re-saving never silently demotes a
  // program admin to member (BUGSOLVE P1-3).
  adminModules: z.array(ModuleSchema).optional(),
});

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await requireRole("super_admin", "org_admin", "admin");
  const { id: targetId } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = PutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" },
      { status: 400 },
    );
  }

  const admin = adminClient();

  // Confirm target is in caller's org
  const { data: target } = await admin
    .from("users")
    .select("id, org_id, name, role")
    .eq("id", targetId)
    .eq("org_id", session.user.org_id)
    .maybeSingle();

  if (!target) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!canManageUser(session.user.role, target.role as DbUser["role"])) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const orgId = session.user.org_id;
  const requested = Array.from(new Set(parsed.data.modules));
  const adminSet = new Set(parsed.data.adminModules ?? []);
  const now = new Date().toISOString();

  // CostCtrl = CEO-only (super_admin) · enforce server-side (BUGSOLVE P1-2).
  if (
    (requested.includes("costctrl") || adminSet.has("costctrl")) &&
    session.user.role !== "super_admin"
  ) {
    return NextResponse.json(
      { error: "เฉพาะ super_admin เท่านั้นที่ให้สิทธิ์ ศูนย์ควบคุมต้นทุน ได้" },
      { status: 403 },
    );
  }

  // Strategy: deactivate ALL existing rows for this user, then upsert the
  // requested set. Cleaner than diff-and-patch and the table is small.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin.from as any)("user_modules")
    .update({ is_active: false, updated_at: now })
    .eq("user_id", targetId)
    .eq("org_id", orgId);

  if (requested.length > 0) {
    const rows = requested.map((module_name) => ({
      org_id: orgId,
      user_id: targetId,
      module_name,
      is_active: true,
      // Write role EXPLICITLY so re-saving never silently demotes/leaves stale
      // (BUGSOLVE P1-3). Modules in adminModules → 'admin', rest → 'member'.
      role: adminSet.has(module_name) ? "admin" : "member",
      granted_by: session.user.id,
      updated_at: now,
    }));

    // Upsert on the (org_id, user_id, module_name) composite — re-activates
    // any row that existed previously without creating duplicates.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (admin.from as any)("user_modules").upsert(rows, {
      onConflict: "org_id,user_id,module_name",
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  await audit({
    orgId,
    userId: session.user.id,
    action: "UPDATE_USER_MODULES",
    resourceType: "user",
    resourceId: targetId,
    diff: {
      new: {
        modules: requested,
        admin_modules: Array.from(adminSet),
        target_role: target.role,
      },
    },
  });

  return NextResponse.json({ success: true, modules: requested });
}
