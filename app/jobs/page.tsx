// Public job listing — /jobs?ref=<code>
// Used by referral landing + as a general public job board

import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Briefcase, Building, ChevronRight } from "lucide-react";

export const dynamic = "force-dynamic";

interface SearchParams {
  ref?: string;
}

export default async function JobsListingPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const ref = params.ref;

  const postings = await prisma.recruitJobPosting.findMany({
    where: { status: "OPEN" },
    select: {
      slug: true,
      title: true,
      description: true,
      company: { select: { name: true } },
      org: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return (
    <div className="min-h-screen bg-zinc-50 py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-8">
          <div className="size-14 mx-auto rounded-2xl bg-[var(--color-brand-600)] text-white flex items-center justify-center">
            <Briefcase className="size-6" />
          </div>
          <h1 className="text-3xl font-extrabold text-zinc-900 font-display mt-4">
            ตำแหน่งงานเปิดรับ
          </h1>
          <p className="text-sm text-zinc-600 mt-2">
            {postings.length > 0
              ? `${postings.length} ตำแหน่งกำลังเปิดรับสมัคร`
              : "ยังไม่มีตำแหน่งเปิดรับในขณะนี้"}
          </p>
          {ref && (
            <p className="inline-flex items-center gap-1.5 text-xs text-purple-700 bg-purple-50 px-3 py-1.5 rounded-full mt-3">
              ✨ มาจากการแนะนำ · รหัส {ref}
            </p>
          )}
        </div>

        {postings.length === 0 ? (
          <div className="rounded-3xl border-2 border-dashed border-zinc-200 bg-white p-12 text-center">
            <p className="text-sm text-zinc-500">ยังไม่มีตำแหน่งเปิดในขณะนี้</p>
          </div>
        ) : (
          <div className="space-y-3">
            {postings.map((p) => (
              <Link
                key={p.slug}
                href={`/apply/${p.slug}${ref ? `?ref=${ref}` : ""}`}
                className="block bg-white rounded-2xl border-2 border-zinc-200 p-5 hover:border-[var(--color-brand-300)] transition-colors group"
              >
                <div className="flex items-start gap-3">
                  <div className="size-10 rounded-xl bg-[var(--color-brand-50)] text-[var(--color-brand-700)] flex items-center justify-center shrink-0">
                    <Briefcase className="size-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2 className="font-bold text-zinc-900 group-hover:text-[var(--color-brand-700)]">
                      {p.title}
                    </h2>
                    <p className="text-xs text-zinc-500 mt-1 flex items-center gap-1">
                      <Building className="size-3" />
                      {p.company?.name ?? p.org.name}
                    </p>
                    {p.description && (
                      <p className="text-xs text-zinc-600 mt-2 line-clamp-2">
                        {p.description}
                      </p>
                    )}
                  </div>
                  <ChevronRight className="size-5 text-zinc-300 group-hover:text-[var(--color-brand-500)] shrink-0" />
                </div>
              </Link>
            ))}
          </div>
        )}

        <p className="text-center text-[11px] text-zinc-400 mt-8">
          ข้อมูลส่วนตัวเก็บตาม PDPA · ใช้เฉพาะการพิจารณาจ้างงาน
        </p>
      </div>
    </div>
  );
}
