// PATCH  /api/admin/branches/[id]  : update branch
// DELETE /api/admin/branches/[id]  : soft-deactivate
// POST   not used (use /reactivate child route)

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { zUUID } from "@/lib/zod-helpers";
import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";

const PatchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  province: z.string().max(50).nullable().optional(),
  region: z.string().max(50).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  managerId: zUUID().nullable().optional(),
  lineGroupId: z.string().max(120).nullable().optional(),
  reportDeadline: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional(),
});

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await requireRole("super_admin", "org_admin", "admin");
  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" },
      { status: 400 },
    );
  }

  const admin = adminClient();
  const { data: existing } = await admin
    .from("branches")
    .select("*")
    .eq("id", id)
    .eq("org_id", session.user.org_id)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.province !== undefined) updates.province = parsed.data.province;
  if (parsed.data.region !== undefined) updates.region = parsed.data.region;
  if (parsed.data.address !== undefined) updates.address = parsed.data.address;
  if (parsed.data.phone !== undefined) updates.phone = parsed.data.phone;
  if (parsed.data.lat !== undefined) updates.lat = parsed.data.lat;
  if (parsed.data.lng !== undefined) updates.lng = parsed.data.lng;
  if (parsed.data.managerId !== undefined) {
    // Validate manager belongs to same org + is_active before assigning
    if (parsed.data.managerId) {
      const { data: mgr } = await admin
        .from("users")
        .select("id")
        .eq("id", parsed.data.managerId)
        .eq("org_id", session.user.org_id)
        .eq("is_active", true)
        .maybeSingle();
      if (!mgr) {
        return NextResponse.json(
          { error: "ผู้จัดการที่เลือกไม่อยู่ในบริษัท หรือถูกปิดบัญชีแล้ว" },
          { status: 400 },
        );
      }
    }
    updates.manager_id = parsed.data.managerId;
  }
  if (parsed.data.lineGroupId !== undefined)
    updates.line_group_id = parsed.data.lineGroupId;
  if (parsed.data.reportDeadline !== undefined)
    updates.report_deadline = parsed.data.reportDeadline;

  const { error } = await admin.from("branches").update(updates).eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "UPDATE_BRANCH",
    resourceType: "branch",
    resourceId: id,
    diff: { old: existing, new: updates },
  });

  return NextResponse.json({ success: true });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await requireRole("super_admin", "org_admin", "admin");
  const { id } = await ctx.params;
  const admin = adminClient();

  const { data: existing } = await admin
    .from("branches")
    .select("id, name, is_active")
    .eq("id", id)
    .eq("org_id", session.user.org_id)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!existing.is_active) {
    return NextResponse.json(
      { error: "สาขานี้ปิดอยู่แล้ว" },
      { status: 409 },
    );
  }

  await admin
    .from("branches")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", id);

  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "UPDATE_BRANCH",
    resourceType: "branch",
    resourceId: id,
    diff: { new: { is_active: false } },
  });

  return NextResponse.json({ success: true });
}
