// /api/docuflow/document-groups — org-managed DocumentGroup catalog CRUD (list/create)
// ────────────────────────────────────────────────────────────────────
// GET:  list DocumentGroup rows for the caller's org (executive role — same
//       read tier as /api/docuflow/document-types GET; document groups
//       aren't sensitive, just admin-managed).
// POST: create a new DocumentGroup row (admin tier only — matches every
//       other DocuFlow admin-mutation route, e.g. /api/docuflow/document-types POST).
//
// Mirrors app/api/docuflow/document-types/route.ts exactly, minus the
// category/businessType/frequency/dangerLevel/regulator fields DocumentGroup
// doesn't have.
// ────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { isProgramAdminTier, isExecutiveRole } from "@/lib/auth/role-guards";
import { audit } from "@/lib/audit/log";
import {
  listAllDocumentGroupsForAdmin,
  createDocumentGroup,
} from "@/lib/docuflow/document-groups";

export const dynamic = "force-dynamic";

const CreateSchema = z.object({
  name: z.string().min(1, "ใส่ชื่อกลุ่มเอกสาร").max(255),
  description: z.string().max(2000).nullable().optional(),
});

export async function GET() {
  const session = await requireSession();
  if (!isExecutiveRole(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const documentGroups = await listAllDocumentGroupsForAdmin(
    session.user.org_id,
  );
  return NextResponse.json({ documentGroups });
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

  try {
    const created = await createDocumentGroup(orgId, {
      name: data.name,
      description: data.description ?? null,
    });

    await audit({
      orgId,
      userId: session.user.id,
      action: "DOCUFLOW_DOCGROUP_CREATE",
      resourceType: "document_group",
      resourceId: created.id,
      diff: { new: { name: created.name } },
    });

    return NextResponse.json({ documentGroup: created }, { status: 201 });
  } catch (e) {
    // Prisma P2002 = unique constraint (orgId, name) violation
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
