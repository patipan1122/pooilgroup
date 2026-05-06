// PATCH /api/admin/register-requests/[id]
//   body: { action: "approve" | "reject", rejectReason?: string }
// Approve: creates pending invite User row + returns invite link.
// Reject: marks status="rejected" with reason.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";
import { getBaseUrl } from "@/lib/utils/base-url";

const Schema = z.object({
  action: z.enum(["approve", "reject"]),
  rejectReason: z.string().max(500).optional(),
});

function makeToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await requireRole("super_admin", "org_admin");
  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" },
      { status: 400 },
    );
  }

  const admin = adminClient();
  const { data: request } = await admin
    .from("register_requests")
    .select("*")
    .eq("id", id)
    .eq("org_id", session.user.org_id)
    .maybeSingle();

  if (!request) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (request.status !== "pending") {
    return NextResponse.json(
      { error: "คำขอนี้ถูกพิจารณาไปแล้ว" },
      { status: 409 },
    );
  }

  const now = new Date().toISOString();

  if (parsed.data.action === "reject") {
    await admin
      .from("register_requests")
      .update({
        status: "rejected",
        reviewed_by_id: session.user.id,
        reviewed_at: now,
        reject_reason: parsed.data.rejectReason ?? null,
      })
      .eq("id", id);

    await audit({
      orgId: session.user.org_id,
      userId: session.user.id,
      action: "UPDATE_USER",
      resourceType: "register_request",
      resourceId: id,
      diff: {
        new: { rejected: true, reason: parsed.data.rejectReason },
      },
    });

    return NextResponse.json({ success: true });
  }

  // Approve: create invite User row
  const userId = crypto.randomUUID();
  const token = makeToken();
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

  await admin.from("users").insert({
    id: userId,
    org_id: session.user.org_id,
    email: request.email || null,
    name: request.name,
    phone: request.phone,
    role: request.requested_role,
    must_change_password: true,
    is_active: false,
    invite_token: token,
    invite_expires_at: expiresAt,
    invited_by: session.user.id,
    updated_at: now,
  });

  if (request.branch_id) {
    await admin.from("user_branches").insert({
      id: crypto.randomUUID(),
      org_id: session.user.org_id,
      user_id: userId,
      branch_id: request.branch_id,
      is_active: true,
    });
  }

  await admin
    .from("register_requests")
    .update({
      status: "approved",
      reviewed_by_id: session.user.id,
      reviewed_at: now,
      result_user_id: userId,
    })
    .eq("id", id);

  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "CREATE_USER",
    resourceType: "user",
    resourceId: userId,
    diff: { new: { from_register_request: id, role: request.requested_role } },
  });

  return NextResponse.json({
    success: true,
    userId,
    inviteUrl: `${getBaseUrl()}/invite/${token}`,
    expiresAt,
  });
}
