"use client";

// ปุ่ม "ดูใบสมัคร / พิมพ์ PDF" ในหน้าตรวจของ HR
//
// CEO 2026-09-23: "จากหน้านี้ ไม่สามารถกดปริ้น PDF การรับสมัครพนักงานแบบ PDF ได้"
//
// ใช้ RecruitApplicationDocument ตัวเดียวกับที่ผู้สมัครเห็น → HR พิมพ์เก็บเข้าแฟ้ม
// ได้หน้าตาเหมือนกันเป๊ะ ไม่ต้องมีเอกสารสองเวอร์ชันให้เพี้ยนกันทีหลัง

import { useEffect, useState } from "react";
import { FileText, Printer, X } from "lucide-react";
import {
  RecruitApplicationDocument,
  type ApplicationDocData,
} from "@/components/recruit/application-document";

export function PrintApplicationButton({ data }: { data: ApplicationDocData }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-300 bg-white px-3 py-2 text-[13px] font-bold text-zinc-700 active:bg-zinc-50"
      >
        <FileText className="size-4" aria-hidden />
        ดูใบสมัคร / พิมพ์ PDF
      </button>

      {open && (
        <div
          className="onboard-appdoc-modal fixed inset-0 z-50 bg-zinc-900/60 backdrop-blur-sm flex flex-col text-left"
          role="dialog"
          aria-modal="true"
          aria-label="ใบสมัครงาน"
        >
          <div className="onboard-appdoc-bar shrink-0 flex items-center justify-between gap-2 px-3 py-2.5 bg-white border-b border-zinc-200">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex items-center gap-1.5 text-[13px] font-bold text-zinc-700 px-2 py-1.5 -ml-1"
            >
              <X className="size-4" aria-hidden />
              ปิด
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--color-brand-600)] px-3.5 py-2 text-[13px] font-bold text-white"
            >
              <Printer className="size-4" aria-hidden />
              พิมพ์ / บันทึก PDF
            </button>
          </div>
          <div className="flex-1 overflow-y-auto overscroll-contain p-3 sm:p-6">
            <p className="sm:hidden mx-auto w-full max-w-[820px] mb-2 text-[11px] text-white/80 text-center">
              เลื่อนซ้าย-ขวาเพื่อดูทั้งใบ · กดปุ่มพิมพ์เพื่อดูเต็มหน้า A4
            </p>
            <div className="mx-auto w-full max-w-[820px] bg-white rounded-xl shadow-lg overflow-hidden">
              <RecruitApplicationDocument data={data} printId="recruit-application-doc" />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
