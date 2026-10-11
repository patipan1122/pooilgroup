"use server";

// DocuFlow — "ย้ายไปที่..." move a document to a different DocumentGroup
// (Workshop Must #5, docs/WORKSHOP_docuflow-org-structure-2026-10-10.md
// Section 4, 2026-10-10). Button-driven, NOT drag-and-drop — the team ruled
// drag-and-drop out for this phase (mobile touch conflicts with scroll).
//
// SCHEMA NOTE (verified against the real schema, not assumed): a document's
// group/folder placement lives in the plain nullable Document.documentGroupId
// column — confirmed against every real read/write call site
// (lib/docuflow/data.ts, components/docuflow/upload-form.tsx,
// app/api/docuflow/upload/route.ts, app/api/docuflow/upload-proxy/route.ts).
// It is NOT a DocumentOwnership row — DocumentOwnership.level is a separate,
// unrelated org-hierarchy ownership scope (group = whole Pooilgroup / company
// / business_type / branch / person; see LEVEL_LABEL in
// app/(admin)/docuflow/documents/[id]/page.tsx). Because the real field is a
// plain column on Document (not a child table row), there is no "row might
// not exist yet" case — moving is always a single-row UPDATE, never an
// upsert.
//
// Exclusive placement (one group at a time) is intentional per the locked
// workshop design, not a gap to fix here.

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { userIsModuleAdmin } from "@/lib/auth/module-access";
import { audit } from "@/lib/audit/log";
import { zUUID } from "@/lib/zod-helpers";

const UUID = zUUID();

export type MoveDocumentToGroupResult =
  | {
      ok: true;
      documentId: string;
      fromGroupId: string | null;
      toGroupId: string;
      toGroupName: string;
    }
  | { ok: false; error: string };

export async function moveDocumentToGroup(input: {
  documentId: string;
  toGroupId: string;
}): Promise<MoveDocumentToGroupResult> {
  if (!UUID.safeParse(input.documentId).success) {
    return { ok: false, error: "ไม่พบเอกสารนี้" };
  }
  if (!UUID.safeParse(input.toGroupId).success) {
    return { ok: false, error: "ไม่พบกลุ่มเอกสารปลายทาง" };
  }

  const session = await requireSession();
  // Restricted to DocuFlow module-admin tier — same gate every other
  // DocuFlow admin mutation uses (e.g. document-groups CRUD routes via
  // userCanAdminModule, which wraps this same check). Not open to every
  // staff member with view access.
  if (!(await userIsModuleAdmin(session.user, "docuflow"))) {
    return {
      ok: false,
      error: "เฉพาะแอดมินของ DocuFlow เท่านั้นที่ย้ายกลุ่มเอกสารได้",
    };
  }

  const orgId = session.user.org_id;

  const [doc, targetGroup] = await Promise.all([
    prisma.document.findFirst({
      where: { id: input.documentId, orgId },
      select: { id: true, isActive: true, documentGroupId: true },
    }),
    prisma.documentGroup.findFirst({
      where: { id: input.toGroupId, orgId, isActive: true },
      select: { id: true, name: true },
    }),
  ]);

  if (!doc || !doc.isActive) {
    return { ok: false, error: "ไม่พบเอกสารนี้" };
  }
  if (!targetGroup) {
    return { ok: false, error: "ไม่พบกลุ่มเอกสารปลายทาง (อาจถูกปิดใช้งานไปแล้ว)" };
  }

  const fromGroupId = doc.documentGroupId;

  // Idempotency — selecting the group the document is already in is a
  // deliberate no-op (not an error, not a duplicate log row). This also
  // means a double-click/double-submit of the exact same move only ever
  // writes one log row: the first call changes fromGroupId -> toGroupId,
  // the second call sees fromGroupId === toGroupId and short-circuits here.
  if (fromGroupId === targetGroup.id) {
    return {
      ok: false,
      error: `เอกสารนี้อยู่ในกลุ่ม "${targetGroup.name}" อยู่แล้ว`,
    };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.document.updateMany({
        where: { id: input.documentId, orgId },
        data: { documentGroupId: targetGroup.id },
      });
      if (updated.count === 0) {
        // Org-scope mismatch or the row disappeared between the read above
        // and this write (e.g. concurrent delete) — abort, roll back.
        throw new Error("DOCUMENT_NOT_FOUND");
      }

      await tx.documentGroupMoveLog.create({
        data: {
          orgId,
          documentId: input.documentId,
          fromGroupId,
          toGroupId: targetGroup.id,
          movedByUserId: session.user.id,
        },
      });
    });
  } catch (err) {
    if (err instanceof Error && err.message === "DOCUMENT_NOT_FOUND") {
      return { ok: false, error: "ไม่พบเอกสารนี้" };
    }
    console.error("moveDocumentToGroup: transaction failed", err);
    return { ok: false, error: "ย้ายเอกสารไม่สำเร็จ — ลองใหม่อีกครั้ง" };
  }

  await audit({
    orgId,
    userId: session.user.id,
    action: "DOCUFLOW_DOCUMENT_GROUP_MOVED",
    resourceType: "document",
    resourceId: input.documentId,
    diff: {
      old: { documentGroupId: fromGroupId },
      new: { documentGroupId: targetGroup.id, documentGroupName: targetGroup.name },
    },
  });

  return {
    ok: true,
    documentId: input.documentId,
    fromGroupId,
    toGroupId: targetGroup.id,
    toGroupName: targetGroup.name,
  };
}
