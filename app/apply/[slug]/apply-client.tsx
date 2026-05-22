"use client";

// /apply/[slug] — public applicant form
// Redesigned per Recruit Redesign canvas (2026-05-22):
//  - Hero with brand gradient + posting title + trust chips (Screen 03-1)
//  - White card containing form sections with colored numbered dots (Screen 03-4..8)
//  - Sticky submit-zone via PublicFormRenderer (hideHeader=true)
//  - PDPA notice in footer

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PublicFormRenderer } from "@/components/recruit/public-form-renderer";
import { submitPublicApplication } from "./submit-action";
import type { FormSchema } from "@/lib/recruit/types";
import { Clock, ShieldCheck, Smartphone } from "lucide-react";

interface Props {
  slug: string;
  schema: FormSchema;
  jobTitle: string;
  jobDescription?: string;
  companyName: string;
  referralCode?: string;
}

export function ApplyClient({
  slug,
  schema,
  jobTitle,
  jobDescription,
  companyName,
  referralCode,
}: Props) {
  const router = useRouter();
  const [initialAnswers] = useState<Record<string, unknown>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const raw = window.localStorage.getItem(`recruit_draft_${slug}`);
      return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  });

  // Rough field count for time estimate (1 minute per 4 fields)
  const fieldCount = schema.sections.reduce((sum, s) => sum + s.fields.length, 0) + 3;
  const minMinutes = Math.max(3, Math.ceil(fieldCount / 4));
  const maxMinutes = Math.max(5, Math.ceil(fieldCount / 2));

  return (
    <div className="min-h-screen bg-zinc-50">
      {/* HERO — canvas Screen 03-1 */}
      <div className="relative overflow-hidden bg-gradient-to-br from-[var(--color-brand-600)] via-[var(--color-brand-700)] to-[var(--color-brand-900)] text-white">
        <div className="max-w-2xl mx-auto px-5 sm:px-8 pt-10 pb-12 sm:pt-14 sm:pb-16">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide bg-white/15 backdrop-blur px-3 py-1 rounded-full">
            <span className="size-1.5 rounded-full bg-emerald-300" />
            เปิดรับสมัคร
            {referralCode && (
              <>
                <span className="opacity-50">·</span>
                <span className="text-emerald-200">ผ่านการแนะนำ</span>
              </>
            )}
          </span>
          <h1 className="mt-4 text-3xl sm:text-4xl font-extrabold tracking-tight font-display leading-tight">
            {jobTitle}
          </h1>
          <p className="mt-2 text-sm sm:text-base text-white/85 font-medium">
            {companyName}
          </p>
          {jobDescription && (
            <p className="mt-4 text-sm text-white/75 leading-relaxed line-clamp-3 whitespace-pre-wrap">
              {jobDescription}
            </p>
          )}
          {/* Trust chips */}
          <div className="mt-6 flex flex-wrap gap-2 text-[11px] font-medium">
            <span className="inline-flex items-center gap-1.5 bg-white/15 backdrop-blur px-3 py-1.5 rounded-full">
              <Clock className="size-3" />
              ใช้เวลา {minMinutes}-{maxMinutes} นาที
            </span>
            <span className="inline-flex items-center gap-1.5 bg-white/15 backdrop-blur px-3 py-1.5 rounded-full">
              <Smartphone className="size-3" />
              ไม่ต้องล็อกอิน
            </span>
            <span className="inline-flex items-center gap-1.5 bg-white/15 backdrop-blur px-3 py-1.5 rounded-full">
              <ShieldCheck className="size-3" />
              PDPA ปลอดภัย
            </span>
          </div>
        </div>
        {/* Bottom curve */}
        <div className="h-6 bg-zinc-50 -mt-px rounded-t-[24px]" />
      </div>

      {/* FORM CARD */}
      <div className="max-w-2xl mx-auto px-4 sm:px-6 -mt-6">
        <div className="bg-white rounded-3xl border border-zinc-200 shadow-soft p-5 sm:p-8">
          <PublicFormRenderer
            schema={schema}
            jobTitle={jobTitle}
            jobDescription={jobDescription}
            companyName={companyName}
            slug={slug}
            initialAnswers={initialAnswers}
            hideHeader
            onSubmit={async (input) => {
              const result = await submitPublicApplication({
                slug,
                applicant: input.applicant,
                answers: input.answers,
                files: input.files,
                referralCode,
              });
              router.push(`/apply/${slug}/success?ref=${result.refId}`);
            }}
          />
        </div>
        <p className="text-center text-xs text-zinc-500 mt-6 pb-10">
          {companyName} · ข้อมูลส่วนบุคคลเก็บตาม PDPA · ไม่เกิน 2 ปี
        </p>
      </div>
    </div>
  );
}
