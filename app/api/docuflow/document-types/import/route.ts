// POST /api/docuflow/document-types/import — bulk-create DocumentType rows
// from lib/docuflow/canonical-docs.ts for one business type.
// ────────────────────────────────────────────────────────────────────
// This is the ONLY path in the whole app that writes canonical-docs.ts
// entries into the real document_types table — always admin-triggered
// from a single explicit button ("นำเข้าจากรายการมาตรฐาน") on the
// settings/document-types page, NEVER automatic. See lib/docuflow/
// document-types.ts header for the hybrid-model rationale.
//
// Idempotent: re-running for a business type that already has some rows
// skips names that already exist (unique [orgId, name]) instead of erroring.
// ────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { isProgramAdminTier } from "@/lib/auth/role-guards";
import { audit } from "@/lib/audit/log";
import { importCanonicalDocTypesForBizType } from "@/lib/docuflow/document-types";
import { getCanonicalDocsForBizType } from "@/lib/docuflow/canonical-docs";

export const dynamic = "force-dynamic";

const ImportSchema = z.object({
  businessType: z.string().min(1).max(64),
});

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

  const parsed = ImportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { businessType } = parsed.data;
  const orgId = session.user.org_id;

  if (getCanonicalDocsForBizType(businessType).length === 0) {
    return NextResponse.json(
      { error: "ไม่พบรายการมาตรฐานสำหรับประเภทธุรกิจนี้" },
      { status: 400 },
    );
  }

  const result = await importCanonicalDocTypesForBizType(orgId, businessType);

  await audit({
    orgId,
    userId: session.user.id,
    action: "DOCUFLOW_DOCTYPE_IMPORT_CANONICAL",
    resourceType: "document_type",
    diff: {
      new: {
        businessType,
        created: result.created,
        skipped: result.skipped,
      },
    },
  });

  return NextResponse.json(result);
}
