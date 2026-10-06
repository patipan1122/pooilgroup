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
  coverImageUrl?: string;
}

export function ApplyClient({
  slug,
  schema,
  jobTitle,
  jobDescription,
  companyName,
  referralCode,
  coverImageUrl,
}: Props) {
  const router = useRouter();
  const [rawDraft] = useState<Record<string, unknown>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const raw = window.localStorage.getItem(`recruit_draft_${slug}`);
      return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  });
  const draftOwnerName = (rawDraft["_applicant_fullName"] as string | undefined)?.trim();
  // Only ask when there's a name to confirm against — an empty/partial draft
  // (e.g. just a gender tap) has nothing worth a confirmation screen for.
  const [draftChoice, setDraftChoice] = useState<"pending" | "resume" | "fresh">(
    draftOwnerName ? "pending" : "resume",
  );
  const initialAnswers = draftChoice === "resume" ? rawDraft : {};

  function startFresh() {
    try {
      window.localStorage.removeItem(`recruit_draft_${slug}`);
    } catch {}
    setDraftChoice("fresh");
  }

  // Rough field count for time estimate (1 minute per 4 fields)
  const fieldCount = schema.sections.reduce((sum, s) => sum + s.fields.length, 0) + 3;
  const minMinutes = Math.max(3, Math.ceil(fieldCount / 4));
  const maxMinutes = Math.max(5, Math.ceil(fieldCount / 2));

  return (
    <div className="min-h-screen bg-zinc-50">
      {/* HERO — canvas Screen 03-1 (bg = workplace cover image if set) */}
      <div className="relative overflow-hidden text-white">
        {coverImageUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={coverImageUrl}
              alt=""
              aria-hidden
              className="absolute inset-0 w-full h-full object-cover"
            />
            {/* Dark brand overlay keeps white text legible over any photo */}
            <div className="absolute inset-0 bg-gradient-to-br from-[var(--color-brand-900)]/92 via-[var(--color-brand-800)]/85 to-[var(--color-brand-700)]/80" />
          </>
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-[var(--color-brand-600)] via-[var(--color-brand-700)] to-[var(--color-brand-900)]" />
        )}
        <div className="relative max-w-2xl mx-auto px-5 sm:px-8 pt-10 pb-12 sm:pt-14 sm:pb-16">
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
        <div className="relative h-6 bg-zinc-50 -mt-px rounded-t-[24px]" />
      </div>

      {/* FORM CARD */}
      <div className="max-w-2xl mx-auto px-4 sm:px-6 -mt-6">
        <div className="bg-white rounded-3xl border border-zinc-200 shadow-soft p-5 sm:p-8">
          {draftChoice === "pending" ? (
            // Draft is keyed only by job slug, not by person — on a shared/
            // walk-in device the next applicant would silently inherit the
            // previous one's name+answers. Confirm the owner before
            // auto-filling, same pattern as /onboard's resume screen.
            <div>
              <h2 className="text-xl font-extrabold text-zinc-900 font-display">
                พบข้อมูลที่กรอกค้างไว้
              </h2>
              <p className="text-sm text-zinc-600 mt-2 leading-relaxed">
                เครื่องนี้มีข้อมูลที่กรอกค้างไว้ · ชื่อ “{draftOwnerName}”
              </p>
              <p className="text-xs text-zinc-500 mt-2">
                ถ้าไม่ใช่คุณ ให้กด “เริ่มกรอกใหม่” — ระบบจะลบข้อมูลเดิมออกจากเครื่องนี้
              </p>
              <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => setDraftChoice("resume")}
                  className="h-12 rounded-xl bg-[var(--color-brand-600)] text-white font-bold hover:bg-[var(--color-brand-700)] transition-colors"
                >
                  ใช่ ฉันคือ “{draftOwnerName}” · ต่อจากเดิม
                </button>
                <button
                  type="button"
                  onClick={startFresh}
                  className="h-12 rounded-xl border-2 border-zinc-300 text-zinc-700 font-bold hover:border-zinc-400 transition-colors"
                >
                  ไม่ใช่ฉัน · เริ่มกรอกใหม่
                </button>
              </div>
            </div>
          ) : (
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
          )}
        </div>
        <p className="text-center text-xs text-zinc-500 mt-6 pb-10">
          {companyName} · ข้อมูลส่วนบุคคลเก็บตาม PDPA · ไม่เกิน 2 ปี
        </p>
      </div>
    </div>
  );
}
