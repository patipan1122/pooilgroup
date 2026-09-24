// /api/docuflow/document-types/[id] — update / soft-delete one DocumentType row
// ────────────────────────────────────────────────────────────────────
// PATCH:  partial update (also powers reactivate via { isActive: true }).
// DELETE: soft-delete (isActive: false) — NEVER a hard delete, since
//         Document.documentTypeId (onDelete: SetNull) may still reference
//         this row and other org data may point at it by canonicalKey.
//
// DocuFlow redesign Track A · Item 1 (settings/document-types CRUD).
// ────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { isProgramAdminTier } from "@/lib/auth/role-guards";
import { audit } from "@/lib/audit/log";
import {
  updateDocumentType,
  softDeleteDocumentType,
} from "@/lib/docuflow/document-types";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const UpdateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  category: z.string().max(64).nullable().optional(),
  businessType: z.string().max(64).nullable().optional(),
  companyId: z.string().uuid().nullable().optional(),
  frequency: z.string().max(64).nullable().optional(),
  dangerLevel: z.string().max(32).nullable().optional(),
  regulator: z.string().max(255).nullable().optional(),
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

  const before = await prisma.documentType.findFirst({
    where: { id, orgId },
    select: { name: true, isActive: true },
  });
  if (!before) {
    return NextResponse.json(
      { error: "ไม่พบประเภทเอกสารนี้" },
      { status: 404 },
    );
  }

  if (parsed.data.companyId) {
    const company = await prisma.company.findFirst({
      where: { id: parsed.data.companyId, orgId },
      select: { id: true },
    });
    if (!company) {
      return NextResponse.json({ error: "ไม่พบบริษัทนี้" }, { status: 400 });
    }
  }

  try {
    const updated = await updateDocumentType(orgId, id, parsed.data);

    await audit({
      orgId,
      userId: session.user.id,
      action: "DOCUFLOW_DOCTYPE_UPDATE",
      resourceType: "document_type",
      resourceId: id,
      diff: {
        old: { name: before.name, isActive: before.isActive },
        new: { name: updated.name, isActive: updated.isActive },
      },
    });

    return NextResponse.json({ documentType: updated });
  } catch (e) {
    const code = (e as { code?: string } | null)?.code;
    if (code === "P2002") {
      return NextResponse.json(
        { error: "มีประเภทเอกสารชื่อนี้อยู่แล้วในองค์กร" },
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

  const before = await prisma.documentType.findFirst({
    where: { id, orgId },
    select: { name: true },
  });
  if (!before) {
    return NextResponse.json(
      { error: "ไม่พบประเภทเอกสารนี้" },
      { status: 404 },
    );
  }

  await softDeleteDocumentType(orgId, id);

  await audit({
    orgId,
    userId: session.user.id,
    action: "DOCUFLOW_DOCTYPE_DELETE",
    resourceType: "document_type",
    resourceId: id,
    diff: { old: { name: before.name } },
  });

  return NextResponse.json({ ok: true });
}
