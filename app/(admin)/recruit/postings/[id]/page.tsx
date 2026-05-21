// /recruit/postings/[id] — edit + publish posting + see applications + share link

import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { requireRecruitAccess, canRecruitWrite } from "@/lib/recruit/role-guard";
import { prisma } from "@/lib/prisma";
import { PostingEditor } from "@/components/recruit/posting-editor";
import { PostingShareCard } from "@/components/recruit/posting-share-card";
import {
  FormSchemaSchema,
  EMPTY_FORM_SCHEMA,
  POSTING_STATUS_LABELS,
  type PostingStatus,
  type FormSchema,
} from "@/lib/recruit/types";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function PostingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession();
  requireRecruitAccess(session.user.role);

  const posting = await prisma.recruitJobPosting.findFirst({
    where: { id, orgId: session.user.org_id },
    include: {
      company: { select: { id: true, name: true, code: true } },
      _count: { select: { applications: { where: { draft: false } } } },
      createdBy: { select: { name: true } },
    },
  });
  if (!posting) return notFound();

  const companies = await prisma.company.findMany({
    where: { orgId: session.user.org_id, isActive: true },
    select: { id: true, name: true, code: true },
    orderBy: { code: "asc" },
  });

  let schema: FormSchema = EMPTY_FORM_SCHEMA;
  try {
    schema = FormSchemaSchema.parse(posting.fieldSchema);
  } catch {
    // fallback
  }

  const canEdit = canRecruitWrite(session.user.role);

  return (
    <div className="p-5 sm:p-8 max-w-6xl mx-auto space-y-6">
      {/* Top bar */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <Link
            href="/recruit/postings"
            className="inline-flex items-center h-10 -ml-2 px-2 text-sm text-zinc-500 hover:text-zinc-900 rounded-lg hover:bg-zinc-100"
          >
            ← ประกาศทั้งหมด
          </Link>
          <h1 className="text-3xl font-extrabold tracking-tight font-display mt-2">
            {posting.title}
          </h1>
          <div className="flex items-center gap-2 mt-2 text-xs flex-wrap">
            <Badge tone={posting.status === "OPEN" ? "success" : "neutral"}>
              {POSTING_STATUS_LABELS[posting.status as PostingStatus]}
            </Badge>
            {posting.company && (
              <span className="text-zinc-500">{posting.company.name}</span>
            )}
            <span className="text-zinc-400">
              · {posting._count.applications} ใบสมัคร
            </span>
            <span className="text-zinc-400">
              · สร้างโดย {posting.createdBy.name}
            </span>
          </div>
        </div>
      </div>

      {/* Share card (if open) */}
      {posting.status === "OPEN" && (
        <PostingShareCard slug={posting.slug} title={posting.title} />
      )}

      {/* Editor */}
      <PostingEditor
        mode={canEdit ? "edit" : "view"}
        postingId={posting.id}
        companies={companies}
        initialData={{
          title: posting.title,
          description: posting.description ?? "",
          companyId: posting.companyId,
          opensAt: posting.opensAt?.toISOString().slice(0, 10) ?? null,
          closesAt: posting.closesAt?.toISOString().slice(0, 10) ?? null,
          fieldSchema: schema,
          status: posting.status as PostingStatus,
        }}
        canPublish={canEdit && posting.status === "DRAFT"}
        canClose={canEdit && posting.status === "OPEN"}
      />

      {/* Recent applications quick link */}
      {posting._count.applications > 0 && (
        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <p className="text-xs text-zinc-500 font-bold mb-2">
            ใบสมัคร
          </p>
          <Link
            href={`/recruit?posting=${posting.id}`}
            className="text-sm text-[var(--color-brand-700)] font-bold hover:underline"
          >
            ดู {posting._count.applications} ใบสมัครทั้งหมด →
          </Link>
        </div>
      )}
    </div>
  );
}
