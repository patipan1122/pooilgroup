"use server";

// DocuFlow — nested document-group folder tree server actions
// (CEO feedback 2026-10-11, replaces the derived "ประเภทธุรกิจ" buckets in
// the "ตามบริษัท" tree view with a user-creatable, unlimited-depth folder
// tree per company). See lib/docuflow/document-groups.ts for the data-layer
// functions this wraps — same admin-tier gate + audit-log pattern as
// move-document.ts.

import { requireSession } from "@/lib/auth/session";
import { userIsModuleAdmin } from "@/lib/auth/module-access";
import { audit } from "@/lib/audit/log";
import { zUUID } from "@/lib/zod-helpers";
import {
  createNestedDocumentGroup,
  deleteDocumentGroupNode,
  type DocumentGroupRecord,
} from "./document-groups";

const UUID = zUUID();

export type CreateFolderResult =
  | { ok: true; group: DocumentGroupRecord }
  | { ok: false; error: string };

export async function createDocumentGroupFolder(input: {
  companyId: string;
  parentGroupId: string | null;
  name: string;
}): Promise<CreateFolderResult> {
  if (!UUID.safeParse(input.companyId).success) {
    return { ok: false, error: "ไม่พบบริษัทนี้" };
  }
  if (input.parentGroupId && !UUID.safeParse(input.parentGroupId).success) {
    return { ok: false, error: "ไม่พบโฟลเดอร์แม่" };
  }

  const session = await requireSession();
  if (!(await userIsModuleAdmin(session.user, "docuflow"))) {
    return { ok: false, error: "เฉพาะแอดมินของ DocuFlow เท่านั้นที่สร้างโฟลเดอร์ได้" };
  }

  try {
    const group = await createNestedDocumentGroup(session.user.org_id, {
      companyId: input.companyId,
      parentGroupId: input.parentGroupId,
      name: input.name,
    });
    await audit({
      orgId: session.user.org_id,
      userId: session.user.id,
      action: "DOCUFLOW_DOCGROUP_CREATE",
      resourceType: "document_group",
      resourceId: group.id,
      diff: {
        new: {
          name: group.name,
          companyId: group.companyId,
          parentGroupId: group.parentGroupId,
        },
      },
    });
    return { ok: true, group };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "สร้างโฟลเดอร์ไม่สำเร็จ",
    };
  }
}

export type DeleteFolderResult = { ok: true } | { ok: false; error: string };

export async function deleteDocumentGroupFolder(
  groupId: string,
): Promise<DeleteFolderResult> {
  if (!UUID.safeParse(groupId).success) {
    return { ok: false, error: "ไม่พบโฟลเดอร์นี้" };
  }

  const session = await requireSession();
  if (!(await userIsModuleAdmin(session.user, "docuflow"))) {
    return { ok: false, error: "เฉพาะแอดมินของ DocuFlow เท่านั้นที่ลบโฟลเดอร์ได้" };
  }

  try {
    await deleteDocumentGroupNode(session.user.org_id, groupId);
    await audit({
      orgId: session.user.org_id,
      userId: session.user.id,
      action: "DOCUFLOW_DOCGROUP_DELETE",
      resourceType: "document_group",
      resourceId: groupId,
      diff: {},
    });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "ลบโฟลเดอร์ไม่สำเร็จ",
    };
  }
}
