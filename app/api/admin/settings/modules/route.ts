// PATCH /api/admin/settings/modules — toggle module on/off for org
//   body: { moduleName: "cashhub", isActive: boolean }
// Inserts row if missing, updates if exists.
// (FuelOS / DocuFlow re-add to enum when those modules ship)

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";

const Schema = z.object({
  moduleName: z.enum(["cashhub"]),
  isActive: z.boolean(),
});

export async function PATCH(req: NextRequest) {
  const session = await requireRole("super_admin", "org_admin");
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const admin = adminClient();
  const now = new Date().toISOString();

  const { data: existing } = await admin
    .from("org_modules")
    .select("id, is_active")
    .eq("org_id", session.user.org_id)
    .eq("module_name", parsed.data.moduleName)
    .maybeSingle();

  if (existing) {
    await admin
      .from("org_modules")
      .update({
        is_active: parsed.data.isActive,
        deactivated_at: parsed.data.isActive ? null : now,
      })
      .eq("id", existing.id);
  } else {
    await admin.from("org_modules").insert({
      id: crypto.randomUUID(),
      org_id: session.user.org_id,
      module_name: parsed.data.moduleName,
      is_active: parsed.data.isActive,
      deactivated_at: parsed.data.isActive ? null : now,
    });
  }

  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "UPDATE_USER",
    resourceType: "org_module",
    resourceId: parsed.data.moduleName,
    diff: { new: { isActive: parsed.data.isActive } },
  });

  return NextResponse.json({ success: true });
}
