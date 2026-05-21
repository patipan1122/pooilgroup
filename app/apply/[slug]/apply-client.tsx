"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PublicFormRenderer } from "@/components/recruit/public-form-renderer";
import { submitPublicApplication } from "./submit-action";
import type { FormSchema } from "@/lib/recruit/types";

interface Props {
  slug: string;
  schema: FormSchema;
  jobTitle: string;
  jobDescription?: string;
  companyName: string;
}

export function ApplyClient({
  slug,
  schema,
  jobTitle,
  jobDescription,
  companyName,
}: Props) {
  const router = useRouter();
  // Lazy initialise from localStorage so we don't re-render after first paint.
  const [initialAnswers] = useState<Record<string, unknown>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const raw = window.localStorage.getItem(`recruit_draft_${slug}`);
      return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  });

  return (
    <div className="min-h-screen bg-zinc-50 py-6 sm:py-12 px-4">
      <div className="max-w-2xl mx-auto bg-white rounded-3xl border border-zinc-200 p-5 sm:p-8 shadow-soft">
        <PublicFormRenderer
          schema={schema}
          jobTitle={jobTitle}
          jobDescription={jobDescription}
          companyName={companyName}
          slug={slug}
          initialAnswers={initialAnswers}
          onSubmit={async (input) => {
            const result = await submitPublicApplication({
              slug,
              applicant: input.applicant,
              answers: input.answers,
              files: input.files,
            });
            router.push(`/apply/${slug}/success?ref=${result.refId}`);
          }}
        />
      </div>
      <p className="text-center text-[11px] text-zinc-400 mt-6">
        Pooilgroup · ข้อมูลส่วนบุคคลถูกเก็บตามมาตรฐาน PDPA
      </p>
    </div>
  );
}
