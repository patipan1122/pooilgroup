// /api/docuflow/document-groups/[id] — update / soft-delete one DocumentGroup row
// ────────────────────────────────────────────────────────────────────
// PATCH:  partial update (also powers reactivate via { isActive: true }).
// DELETE: soft-delete (isActive: false) — NEVER a hard delete, since
//         Document.documentGroupId may still reference this row.
//
// Mirrors app/api/docuflow/document-types/[id]/route.ts exactly, minus the
// category/businessType/frequency/dangerLevel/regulator fields DocumentGroup
// doesn't have.
// ────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { isProgramAdminTier } from "@/lib/auth/role-guards";
import { audit } from "@/lib/audit/log";
import {
  updateDocumentGroup,
  softDeleteDocumentGroup,
} from "@/lib/docuflow/document-groups";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const UpdateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).nullable().optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (!isProgramAdminTier(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const orgId = session.user.org_id;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const before = await prisma.documentGroup.findFirst({
    where: { id, orgId },
    select: { name: true, isActive: true },
  });
  if (!before) {
    return NextResponse.json(
      { error: "ไม่พบกลุ่มเอกสารนี้" },
      { status: 404 },
    );
  }

  try {
    const updated = await updateDocumentGroup(orgId, id, parsed.data);

    await audit({
      orgId,
      userId: session.user.id,
      action: "DOCUFLOW_DOCGROUP_UPDATE",
      resourceType: "document_group",
      resourceId: id,
      diff: {
        old: { name: before.name, isActive: before.isActive },
        new: { name: updated.name, isActive: updated.isActive },
      },
    });

    return NextResponse.json({ documentGroup: updated });
  } catch (e) {
    const code = (e as { code?: string } | null)?.code;
    if (code === "P2002") {
      return NextResponse.json(
        { error: "มีกลุ่มเอกสารชื่อนี้อยู่แล้วในองค์กร" },
        { status: 409 },
      );
    }
    throw e;
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (!isProgramAdminTier(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const orgId = session.user.org_id;

  const before = await prisma.documentGroup.findFirst({
    where: { id, orgId },
    select: { name: true },
  });
  if (!before) {
    return NextResponse.json(
      { error: "ไม่พบกลุ่มเอกสารนี้" },
      { status: 404 },
    );
  }

  await softDeleteDocumentGroup(orgId, id);

  await audit({
    orgId,
    userId: session.user.id,
    action: "DOCUFLOW_DOCGROUP_DELETE",
    resourceType: "document_group",
    resourceId: id,
    diff: { old: { name: before.name } },
  });

  return NextResponse.json({ ok: true });
}
