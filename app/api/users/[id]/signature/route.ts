// GET/POST/DELETE /api/users/[id]/signature
// ────────────────────────────────────────────────────────────────────
// ADMIN sets/clears a signature ON BEHALF OF another user — e.g. during
// onboarding, or when a user can't draw their own at /profile/signature.
// This is a NEW, distinct surface from app/api/profile/signature/route.ts
// (self-service, session-only — every handler there resolves the target
// user ONLY from the session and can never touch anyone else).
//
// This route is an extension of the existing admin user-edit surface
// (app/(admin)/users/[id]/edit/) and is gated EXACTLY the way that page's
// own mutation route is gated (app/api/admin/users/[id]/route.ts):
//   - requireRole("super_admin", "org_admin", "admin") — same 3-role tier
//     used by app/(admin)/users/[id]/edit/page.tsx. NOT
//     requireProgramAdminTier — that tier is reserved for module-scoped
//     routes (docuflow/cashhub feature gates), not this org-wide
//     users-admin surface.
//   - target user re-confirmed to be in the SAME org as the caller (404
//     if not — mirrors admin/users/[id]/route.ts, and never leaks whether
//     a user id exists in a different org).
//   - for mutations (POST/DELETE): canManageUser() rank check, same as
//     the PATCH route, so a lower-tier admin can't bind/clear a
//     higher-tier user's signature either.
//
// The org check here is intentionally NOT the only line of defense: this
// route uses adminClient()/prisma (service-role, bypasses RLS) for every
// query, so `saveUserSignatureAsAdmin` (lib/docuflow/my-signature.ts)
// independently re-verifies the same org match before writing anything —
// see the comment there for why.
// ────────────────────────────────────────────────────────────────────

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { canManageUser } from "@/lib/auth/role-guards";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";
import {
  clearMySignature,
  getMySignatureUrl,
  saveUserSignatureAsAdmin,
} from "@/lib/docuflow/my-signature";

export const dynamic = "force-dynamic";

// Same PNG-data-URL shape/validation as app/api/profile/signature/route.ts
// (duplicated here, not imported — it's a 4-line zod schema and this route
// must not depend on the self-service route file).
const BodySchema = z.object({
  // PNG data URL: "data:image/png;base64,iVBOR..."
  imageDataUrl: z
    .string()
    .min(32)
    .max(8 * 1024 * 1024) // 8MB cap (data URL is ~33% larger than bytes)
    .refine((v) => v.startsWith("data:image/png;base64,"), {
      message: "Expected base64 PNG data URL",
    }),
});

function decodeDataUrl(dataUrl: string): Buffer {
  const base64 = dataUrl.split(",")[1] ?? "";
  return Buffer.from(base64, "base64");
}

/**
 * Resolve `targetId` to a user row IFF it belongs to `orgId` — mirrors the
 * exact org-scoping check in app/api/admin/users/[id]/route.ts so this
 * route can't be used to probe or touch a user in a different org.
 */
async function resolveTargetInOrg(targetId: string, orgId: string) {
  const admin = adminClient();
  const { data } = await admin
    .from("users")
    .select("id, org_id, role, name")
    .eq("id", targetId)
    .eq("org_id", orgId)
    .maybeSingle();
  return data;
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await requireRole("super_admin", "org_admin", "admin");
  const { id: targetId } = await ctx.params;

  const target = await resolveTargetInOrg(targetId, session.user.org_id);
  if (!target) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const previewUrl = await getMySignatureUrl(targetId);
  return NextResponse.json({
    hasSignature: previewUrl !== null,
    previewUrl,
  });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await requireRole("super_admin", "org_admin", "admin");
  const { id: targetId } = await ctx.params;

  const target = await resolveTargetInOrg(targetId, session.user.org_id);
  if (!target) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // Privilege-escalation guard: caller must out-rank the target — same
  // rule app/api/admin/users/[id]/route.ts applies to every other write
  // against this user. Without this, a lower-tier admin could bind a
  // signature onto (and thereby impersonate the signing of) a
  // higher-tier admin's account.
  if (
    !canManageUser(
      session.user.role,
      target.role as Parameters<typeof canManageUser>[1],
    )
  ) {
    return NextResponse.json(
      { error: "ไม่มีสิทธิ์ตั้งค่าลายเซ็นของผู้ใช้ระดับนี้" },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "ข้อมูลลายเซ็นไม่ถูกต้อง", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const buf = decodeDataUrl(parsed.data.imageDataUrl);
  if (buf.length < 64) {
    return NextResponse.json(
      { error: "ลายเซ็นว่างเปล่า กรุณาเซ็นอีกครั้ง" },
      { status: 400 },
    );
  }

  try {
    await saveUserSignatureAsAdmin({
      actorUserId: session.user.id,
      actorOrgId: session.user.org_id,
      targetUserId: targetId,
      pngBuffer: buf,
    });
  } catch (err) {
    console.error("[users/[id]/signature POST] save failed", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "บันทึกลายเซ็นไม่สำเร็จ ลองใหม่",
      },
      { status: 500 },
    );
  }

  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "DOCUFLOW_ADMIN_SET_USER_SIGNATURE",
    resourceType: "user",
    resourceId: targetId,
  });

  return NextResponse.json({ success: true });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await requireRole("super_admin", "org_admin", "admin");
  const { id: targetId } = await ctx.params;

  const target = await resolveTargetInOrg(targetId, session.user.org_id);
  if (!target) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (
    !canManageUser(
      session.user.role,
      target.role as Parameters<typeof canManageUser>[1],
    )
  ) {
    return NextResponse.json(
      { error: "ไม่มีสิทธิ์ลบลายเซ็นของผู้ใช้ระดับนี้" },
      { status: 403 },
    );
  }

  try {
    await clearMySignature(targetId);
  } catch (err) {
    console.error("[users/[id]/signature DELETE] failed", err);
    return NextResponse.json(
      { error: "ลบลายเซ็นไม่สำเร็จ ลองใหม่" },
      { status: 500 },
    );
  }

  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "DOCUFLOW_ADMIN_CLEAR_USER_SIGNATURE",
    resourceType: "user",
    resourceId: targetId,
  });

  return NextResponse.json({ success: true });
}
