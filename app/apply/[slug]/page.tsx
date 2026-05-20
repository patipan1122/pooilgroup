// Public application page — no auth required
// /apply/[slug]
// Uses adminClient() to bypass RLS for read (validates slug + status=OPEN)

import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  FormSchemaSchema,
  EMPTY_FORM_SCHEMA,
  type FormSchema,
} from "@/lib/recruit/types";
import { ApplyClient } from "./apply-client";

export const dynamic = "force-dynamic";

export default async function ApplyPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const posting = await prisma.recruitJobPosting.findUnique({
    where: { slug },
    include: {
      company: { select: { name: true } },
      org: { select: { name: true } },
    },
  });

  if (!posting || posting.status === "DRAFT" || posting.status === "ARCHIVED") {
    return notFound();
  }

  let schema: FormSchema = EMPTY_FORM_SCHEMA;
  try {
    schema = FormSchemaSchema.parse(posting.fieldSchema);
  } catch {
    // fallback
  }

  const isClosed =
    posting.status === "CLOSED" ||
    (posting.closesAt && new Date(posting.closesAt) < new Date());

  if (isClosed) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-zinc-50">
        <div className="max-w-md w-full bg-white rounded-3xl border-2 border-zinc-200 p-8 text-center">
          <div className="text-5xl mb-3">⏹</div>
          <h1 className="text-2xl font-extrabold text-zinc-900 font-display">
            ปิดรับสมัครแล้ว
          </h1>
          <p className="text-sm text-zinc-600 mt-2">
            ตำแหน่ง &quot;{posting.title}&quot; ปิดรับสมัครแล้ว
          </p>
          <p className="text-xs text-zinc-500 mt-4">
            ขอบคุณที่สนใจ {posting.company?.name ?? posting.org.name}
          </p>
        </div>
      </div>
    );
  }

  return (
    <ApplyClient
      slug={slug}
      schema={schema}
      jobTitle={posting.title}
      jobDescription={posting.description ?? undefined}
      companyName={posting.company?.name ?? posting.org.name}
    />
  );
}
