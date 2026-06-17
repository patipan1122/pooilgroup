"use client";

// ClawHub help — FAQ accordion (CLAWHUB_FAQ) + support phone + the "not gambling" line.

import { useState } from "react";
import { CwHeader, CwButtonLink } from "./ui";
import { CLAWHUB_FAQ } from "@/lib/clawhub/faq";
import { SUPPORT_PHONE } from "@/lib/clawhub/constants";

export function HelpScreen() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <div className="mx-auto w-full max-w-md pb-10">
      <CwHeader title="ช่วยเหลือ & คำถามที่พบบ่อย" />

      <div className="space-y-2 px-4">
        {CLAWHUB_FAQ.map((f, i) => {
          const isOpen = open === i;
          return (
            <div key={i} className="cw-card overflow-hidden">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 p-4 text-left"
                onClick={() => setOpen(isOpen ? null : i)}
              >
                <span className="text-[14px] font-bold" style={{ color: "var(--cw-text)" }}>
                  {f.q}
                </span>
                <span
                  className="shrink-0 text-[18px]"
                  style={{ color: "var(--cw-brand)", transform: isOpen ? "rotate(45deg)" : "none", transition: "transform 0.15s" }}
                >
                  +
                </span>
              </button>
              {isOpen ? (
                <div className="px-4 pb-4 text-[13.5px] leading-relaxed" style={{ color: "var(--cw-text-2)" }}>
                  {f.a}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="mt-5 space-y-3 px-4">
        <a href={`tel:${SUPPORT_PHONE}`} className="cw-btn" style={{ width: "100%" }}>
          📞 โทรหาทีมงาน {SUPPORT_PHONE}
        </a>
        <CwButtonLink href="/liff/clawhub?screen=home" variant="ghost">
          กลับหน้าหลัก
        </CwButtonLink>
      </div>

      <p className="mt-6 px-6 text-center text-[11.5px]" style={{ color: "var(--cw-text-3)" }}>
        JOLLY PLAY เป็นเครื่องจำหน่ายสินค้าอัตโนมัติ ไม่ใช่การพนัน · แต้มใช้แลกของจริงเท่านั้น
      </p>
    </div>
  );
}
