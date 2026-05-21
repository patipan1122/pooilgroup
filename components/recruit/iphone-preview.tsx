"use client";

// iPhone-style live preview frame for posting editor
// Wraps PublicFormRenderer in a faux iPhone bezel so HR sees how applicants will see the form.

import { PublicFormRenderer } from "./public-form-renderer";
import type { FormSchema } from "@/lib/recruit/types";
import { Smartphone } from "lucide-react";

interface Props {
  schema: FormSchema;
  jobTitle: string;
  jobDescription?: string;
  companyName: string;
}

export function IPhonePreview({
  schema,
  jobTitle,
  jobDescription,
  companyName,
}: Props) {
  const hasFields = schema.sections.some((s) => s.fields.length > 0);
  const displayTitle = jobTitle.trim() || "ตัวอย่างตำแหน่ง";

  return (
    <div className="flex flex-col items-center">
      {/* Caption */}
      <div className="flex items-center gap-1.5 text-xs font-bold text-zinc-700 mb-3">
        <Smartphone className="size-3.5" />
        Preview · ผู้สมัครเห็นแบบนี้ใน iPhone
      </div>

      {/* iPhone frame */}
      <div
        className="relative bg-zinc-900 rounded-[42px] p-2 shadow-[0_8px_32px_-8px_rgba(0,0,0,0.25)] mx-auto"
        style={{ width: 340 }}
      >
        {/* Bezel highlight */}
        <div className="absolute inset-0 rounded-[42px] ring-1 ring-zinc-800/40 pointer-events-none" />

        {/* Notch */}
        <div className="absolute top-2.5 left-1/2 -translate-x-1/2 z-10 bg-zinc-900 rounded-full px-5 py-1.5 flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-zinc-700" />
        </div>

        {/* Screen */}
        <div
          className="rounded-[34px] overflow-hidden bg-zinc-50 relative"
          style={{ height: 620 }}
        >
          {/* Status bar */}
          <div className="absolute top-0 left-0 right-0 z-10 px-7 pt-3 pb-1 flex items-center justify-between text-[10px] font-bold text-zinc-900 bg-gradient-to-b from-zinc-50 to-transparent">
            <span>9:41</span>
            <span className="flex items-center gap-1">
              <svg viewBox="0 0 18 12" width="14" height="9" fill="currentColor">
                <rect x="0" y="3" width="3" height="6" rx="0.5" />
                <rect x="5" y="2" width="3" height="8" rx="0.5" />
                <rect x="10" y="0" width="3" height="11" rx="0.5" opacity="0.4" />
              </svg>
              <svg viewBox="0 0 24 12" width="22" height="10" fill="none" stroke="currentColor" strokeWidth="1">
                <rect x="0.5" y="1.5" width="20" height="9" rx="2" />
                <rect x="2" y="3" width="15" height="6" rx="1" fill="currentColor" />
                <rect x="21.5" y="4" width="1.5" height="4" rx="0.5" fill="currentColor" />
              </svg>
            </span>
          </div>

          {/* Scrollable preview content */}
          <div className="absolute inset-0 pt-7 overflow-y-auto">
            {!hasFields ? (
              <div className="h-full flex flex-col items-center justify-center text-center px-8">
                <div className="size-14 rounded-full bg-zinc-100 flex items-center justify-center mb-3">
                  <Smartphone className="size-6 text-zinc-400" />
                </div>
                <p className="text-sm font-bold text-zinc-700">
                  ยังไม่มี field
                </p>
                <p className="text-xs text-zinc-500 mt-1.5 leading-relaxed">
                  เพิ่มช่องจากปุ่ม &quot;เพิ่ม field&quot; ในส่วนแก้ฟอร์ม
                  <br />
                  → ผู้สมัครจะเห็น preview ที่นี่ทันที
                </p>
              </div>
            ) : (
              <div className="px-3 pb-6">
                <PublicFormRenderer
                  schema={schema}
                  jobTitle={displayTitle}
                  jobDescription={jobDescription}
                  companyName={companyName}
                  onSubmit={() => {}}
                  disabled
                  preview
                />
              </div>
            )}
          </div>

          {/* Home indicator */}
          <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 w-24 h-1 rounded-full bg-zinc-900/70" />
        </div>
      </div>

      {/* Caption underneath */}
      <p className="text-[11px] text-zinc-500 mt-3 text-center max-w-[340px] leading-relaxed">
        Preview อัพเดตทันทีเมื่อคุณแก้ฟอร์ม · scroll ใน mockup ได้
      </p>
    </div>
  );
}
