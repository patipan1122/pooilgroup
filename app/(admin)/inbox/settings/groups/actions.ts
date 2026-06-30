"use server";

// CEO 2026-06-30 · maid-inbox · bind a LINE group conversation to a chairops
// branch so /inbox shows the branch label. Org-scoped; the branch must belong
// to the caller's org (no cross-tenant binding).

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { isSuperAdmin } from "@/lib/auth/role-guards";

export async function bindGroupBranch(formData: FormData) {
  const session = await requireSession();
  if (!isSuperAdmin(session.user.role)) redirect("/403");
  const orgId = session.user.org_id;

  const conversationId = String(formData.get("conversationId") ?? "");
  const branchRefId = String(formData.get("branchRefId") ?? "");
  if (!conversationId) {
    revalidatePath("/inbox/settings/groups");
    return;
  }

  let refId: string | null = null;
  let branchLabel: string | null = null;
  if (branchRefId) {
    const branch = await prisma.chairopsBranch.findFirst({
      where: { id: branchRefId, orgId },
      select: { id: true, name: true },
    });
    if (branch) {
      refId = branch.id;
      branchLabel = branch.name;
    }
  }

  // Only group conversations in this org (groupId not null) can be bound.
  await prisma.inboxConversation.updateMany({
    where: { id: conversationId, orgId, groupId: { not: null } },
    data: { branchRefId: refId, branchLabel },
  });

  revalidatePath("/inbox/settings/groups");
  revalidatePath("/inbox");
}
