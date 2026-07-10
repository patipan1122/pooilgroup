// Public application page — no auth required
// /apply/[slug]
// Uses adminClient() to bypass RLS for read (validates slug + status=OPEN)
//
// SEO (quality pass 2026-05-28):
//  - per-posting <title> + description + OpenGraph so LINE/Facebook share
//    cards render the job title (not the bare site title)
//  - keep robots noindex inherited from root layout (recruit is internal —
//    HR shares the link manually; we don't want Google indexing PII surfaces)

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  FormSchemaSchema,
  EMPTY_FORM_SCHEMA,
  type FormSchema,
} from "@/lib/recruit/types";
import { ApplyClient } from "./apply-client";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  // Lightweight metadata-only fetch (no schema/answer columns).
  let posting = await prisma.recruitJobPosting.findUnique({
    where: { slug },
    select: {
      title: true,
      description: true,
      status: true,
      company: { select: { name: true } },
      org: { select: { name: true } },
    },
  });
  // Same trailing-token fallback as the page component so a rescued link
  // (e.g. old Thai slug backfilled to ASCII) gets the correct <title>, not
  // "ไม่พบประกาศ".
  if (!posting) {
    const token = slug.split("-").pop();
    if (token && token.length >= 4) {
      posting = await prisma.recruitJobPosting.findFirst({
        where: { slug: { endsWith: `-${token}` } },
        select: {
          title: true,
          description: true,
          status: true,
          company: { select: { name: true } },
          org: { select: { name: true } },
        },
      });
    }
  }
  if (!posting) {
    return { title: "ไม่พบประกาศ", robots: { index: false, follow: false } };
  }
  const companyName = posting.company?.name ?? posting.org.name;
  const title = `สมัครงาน · ${posting.title} · ${companyName}`;
  const description =
    posting.description?.replace(/\s+/g, " ").slice(0, 160) ??
    `ส่งใบสมัครตำแหน่ง ${posting.title} กับ ${companyName} · ไม่ต้องล็อกอิน · PDPA ปลอดภัย`;
  // Lock the share card to the public domain (pooilgroup.com) so Facebook/LINE
  // never surface "…vercel.app" — even if the link was copied off the back-office
  // URL. Hardcoded (not NEXT_PUBLIC_APP_URL, which is localhost in dev) so the
  // displayed domain + the auto-generated opengraph-image URL are ALWAYS
  // pooilgroup.com, regardless of environment.
  return {
    metadataBase: new URL("https://pooilgroup.com"),
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: {
      title,
      description,
      type: "website",
      siteName: companyName,
      url: `/apply/${slug}`,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function ApplyPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ ref?: string }>;
}) {
  const { slug } = await params;
  const { ref } = await searchParams;

  let posting = await prisma.recruitJobPosting.findUnique({
    where: { slug },
    include: {
      company: { select: { name: true } },
      org: { select: { name: true } },
    },
  });

  // Belt-and-suspenders: if the exact slug misses, resolve by the trailing
  // random token (the "-abcd" suffix). Rescues links whose readable prefix was
  // altered/re-slugified (e.g. an old Thai slug backfilled to ASCII) as long as
  // the unique token still matches.
  if (!posting) {
    const token = slug.split("-").pop();
    if (token && token.length >= 4) {
      posting = await prisma.recruitJobPosting.findFirst({
        where: { slug: { endsWith: `-${token}` } },
        include: {
          company: { select: { name: true } },
          org: { select: { name: true } },
        },
      });
    }
  }

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

  // SECURITY (audit 2026-07-07): strip answer keys before sending the schema to
  // the public applicant browser — correctAnswer/etc must NEVER reach the client
  // (view-source would reveal the IQ key). HR-side scoring re-reads the keys from
  // posting.fieldSchema server-side, so grading is unaffected.
  const publicSchema: FormSchema = {
    ...schema,
    sections: schema.sections.map((s) => ({
      ...s,
      fields: s.fields.map((f) => {
        const clean = { ...f };
        delete clean.correctAnswer;
        delete clean.correctPoints;
        delete clean.hasCorrectAnswer;
        // เฉลยหลุด (2026-07-10): ข้อสอบไอคิวจากรูปบางข้อฝัง "กฎวิธีแก้" ไว้ในวงเล็บท้าย label
        // (เช่น "...? (นับเพิ่มตามแนวนอน + รูปเปลี่ยนตามแนวตั้ง)") = บอกคำตอบผู้สมัคร.
        // ตัดวงเล็บ "ท้ายสุด" ทิ้งก่อนส่งให้ผู้สมัคร โดยเช็คจาก imageUrl (/recruit-iq/) —
        // ห้ามเช็คจาก id เพราะ id ถูกสุ่มใหม่ (f_xxxx) ตอน copy template ลง posting.fieldSchema.
        // scope เฉพาะรูป IQ → ไม่แตะวงเล็บที่ตั้งใจ (เช่น "(ลำดับที่ 5)" กลางประโยค · "(ถ้ามี)").
        // ครอบคลุมประกาศเก่าที่ baked label ไว้ใน DB แล้ว.
        if (typeof clean.imageUrl === "string" && clean.imageUrl.includes("/recruit-iq/")) {
          clean.label = clean.label.replace(/\s*\([^)]*\)\s*$/u, "").trim();
        }
        return clean;
      }),
    })),
  };

  const applySettings =
    posting.settings &&
    typeof posting.settings === "object" &&
    !Array.isArray(posting.settings)
      ? (posting.settings as { coverImageUrl?: string })
      : {};

  return (
    <ApplyClient
      slug={slug}
      schema={publicSchema}
      jobTitle={posting.title}
      jobDescription={posting.description ?? undefined}
      companyName={posting.company?.name ?? posting.org.name}
      referralCode={ref}
      coverImageUrl={applySettings.coverImageUrl}
    />
  );
}
