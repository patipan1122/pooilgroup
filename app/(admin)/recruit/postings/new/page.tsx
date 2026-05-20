// /recruit/postings/new — create new posting

import { requireSession } from "@/lib/auth/session";
import { requireRecruitWrite } from "@/lib/recruit/role-guard";
import { prisma } from "@/lib/prisma";
import { PostingEditor } from "@/components/recruit/posting-editor";
import { EMPTY_FORM_SCHEMA } from "@/lib/recruit/types";

export const dynamic = "force-dynamic";

export default async function NewPostingPage() {
  const session = await requireSession();
  requireRecruitWrite(session.user.role);

  const companies = await prisma.company.findMany({
    where: { orgId: session.user.org_id, isActive: true },
    select: { id: true, name: true, code: true },
    orderBy: { code: "asc" },
  });

  return (
    <PostingEditor
      mode="create"
      companies={companies}
      initialData={{
        title: "",
        description: "",
        companyId: companies[0]?.id ?? null,
        opensAt: null,
        closesAt: null,
        fieldSchema: EMPTY_FORM_SCHEMA,
        status: "DRAFT",
      }}
    />
  );
}
