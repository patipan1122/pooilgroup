// /api/docuflow/document-types — org-managed DocumentType catalog CRUD (list/create)
// ────────────────────────────────────────────────────────────────────
// GET:  list DocumentType rows for the caller's org (executive role — same
//       read tier as /api/docuflow/vehicles GET; document types aren't
//       sensitive, just admin-managed).
// POST: create a new DocumentType row (admin tier only — matches every
//       other DocuFlow admin-mutation route, e.g. /api/docuflow/vehicles POST).
//
// DocuFlow redesign Track A · Item 1 (settings/document-types CRUD).
// ────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { isProgramAdminTier, isExecutiveRole } from "@/lib/auth/role-guards";
import { audit } from "@/lib/audit/log";
import { prisma } from "@/lib/prisma";
import {
  listAllDocumentTypesForAdmin,
  createDocumentType,
} from "@/lib/docuflow/document-types";

export const dynamic = "force-dynamic";

const CreateSchema = z.object({
  name: z.string().min(1, "ใส่ชื่อประเภทเอกสาร").max(255),
  category: z.string().max(64).nullable().optional(),
  businessType: z.string().max(64).nullable().optional(),
  companyId: z.string().uuid().nullable().optional(),
  frequency: z.string().max(64).nullable().optional(),
  dangerLevel: z.string().max(32).nullable().optional(),
  regulator: z.string().max(255).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
});

export async function GET() {
  const session = await requireSession();
  if (!isExecutiveRole(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const documentTypes = await listAllDocumentTypesForAdmin(
    session.user.org_id,
  );
  return NextResponse.json({ documentTypes });
}

export async function POST(req: Request) {
  const session = await requireSession();
  if (!isProgramAdminTier(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const orgId = session.user.org_id;
  const data = parsed.data;

  if (data.companyId) {
    const company = await prisma.company.findFirst({
      where: { id: data.companyId, orgId },
      select: { id: true },
    });
    if (!company) {
      return NextResponse.json({ error: "ไม่พบบริษัทนี้" }, { status: 400 });
    }
  }

  try {
    const created = await createDocumentType(orgId, {
      name: data.name,
      category: data.category ?? null,
      businessType: data.businessType ?? null,
      companyId: data.companyId ?? null,
      frequency: data.frequency ?? null,
      dangerLevel: data.dangerLevel ?? null,
      regulator: data.regulator ?? null,
      description: data.description ?? null,
    });

    await audit({
      orgId,
      userId: session.user.id,
      action: "DOCUFLOW_DOCTYPE_CREATE",
      resourceType: "document_type",
      resourceId: created.id,
      diff: { new: { name: created.name, businessType: created.businessType } },
    });

    return NextResponse.json({ documentType: created }, { status: 201 });
  } catch (e) {
    // Prisma P2002 = unique constraint (orgId, name) violation
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
