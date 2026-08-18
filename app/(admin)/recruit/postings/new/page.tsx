// /recruit/postings/new — create new posting

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { requireRecruitWrite } from "@/lib/recruit/role-guard";
import { prisma } from "@/lib/prisma";
import { PostingEditor } from "@/components/recruit/posting-editor";
import { EMPTY_FORM_SCHEMA } from "@/lib/recruit/types";
import { readCompanyCookie } from "@/lib/auth/company-context";

export const dynamic = "force-dynamic";

export default async function NewPostingPage() {
  const session = await requireSession();
  requireRecruitWrite(session.user.role);

  const companies = await prisma.company.findMany({
    where: { orgId: session.user.org_id, isActive: true },
    select: { id: true, name: true, code: true },
    orderBy: { code: "asc" },
  });

  const tagRows = await prisma.recruitJobPosting.findMany({
    where: { orgId: session.user.org_id },
    select: { tags: true },
  });
  const orgTags = [...new Set(tagRows.flatMap((r) => r.tags))].sort((a, b) =>
    a.localeCompare(b, "th"),
  );

  // บริษัทของประกาศใหม่ = บริษัทที่เลือกอยู่บน "ตัวสลับบริษัทด้านบน" (คุกกี้) — ไม่มีตัวเลือก
  // ในฟอร์มแล้ว. ถ้าเลือก "ทุกบริษัท" อยู่ (คุกกี้ว่าง) → ประกาศเป็นแบบใช้รวม (companyId=null).
  const activeCompanyId = await readCompanyCookie();
  const defaultCompanyId =
    activeCompanyId && companies.some((c) => c.id === activeCompanyId)
      ? activeCompanyId
      : null;

  return (
    <>
      {/* P2-3: breadcrumb so Newbie HR knows page hierarchy */}
      <nav aria-label="breadcrumb" className="px-5 sm:px-7 pt-4 pb-2 text-sm text-zinc-500 flex items-center gap-1">
        <Link href="/recruit/postings" className="hover:text-zinc-900 hover:underline">
          ประกาศทั้งหมด
        </Link>
        <ChevronRight className="size-3.5 text-zinc-400" aria-hidden />
        <span className="text-zinc-900 font-medium">สร้างประกาศใหม่</span>
      </nav>
      <PostingEditor
        mode="create"
        companies={companies}
        orgTags={orgTags}
        initialData={{
          title: "",
          description: "",
          companyId: defaultCompanyId,
          opensAt: null,
          closesAt: null,
          fieldSchema: EMPTY_FORM_SCHEMA,
          status: "DRAFT",
          coverImageUrl: null,
          caption: "",
          tags: [],
        }}
      />
    </>
  );
}
