"use client";

// /onboard/success — ปุ่ม "ดูใบสมัครของฉัน" + โมดัลพรีวิว
//
// CEO 2026-09-23: "หน้านี้ควรกดดูใบสมัครเราได้"
//
// ข้อมูลมาจาก sessionStorage คีย์ onboardingReceiptKey(<เลขอ้างอิง>) ซึ่งหน้าเซ็น
// เขียนไว้ "ก่อน" จะล้าง handoff ที่ใช้ส่งข้อมูลทิ้ง → กด back แล้วส่งซ้ำยังไม่ได้
// เหมือนเดิม แต่ยังเปิดดูใบสมัครของตัวเองได้ในเซสชันนั้น
//
// ไม่มีในเครื่อง (เปิดลิงก์ใหม่/คนละเครื่อง/โหมดไม่ระบุตัวตน) → ไม่ขึ้นปุ่มเลย
// ดีกว่าโชว์ปุ่มที่กดแล้วพัง

import { useEffect, useState } from "react";
import { FileText, Printer, X } from "lucide-react";
import {
  RecruitApplicationDocument,
  onboardingReceiptKey,
  type ApplicationDocData,
} from "@/components/recruit/application-document";

export function OnboardReceiptView({ reference }: { reference: string }) {
  const [data, setData] = useState<ApplicationDocData | null>(null);
  const [open, setOpen] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect -- sessionStorage อ่านได้เฉพาะ
     ฝั่งเบราว์เซอร์ ถ้าอ่านตอน render จะ hydration mismatch (pattern เดียวกับ
     app/onboard/onboard-client.tsx:507) */
  useEffect(() => {
    if (reference === "") return;
    try {
      const raw = window.sessionStorage.getItem(onboardingReceiptKey(reference));
      if (raw === null) return;
      const parsed: unknown = JSON.parse(raw);
      // ตรวจหยาบ ๆ พอให้มั่นใจว่าเป็นของจริง ไม่ใช่ค่าค้างรูปแบบเก่า
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        typeof (parsed as ApplicationDocData).fullNameTh === "string"
      ) {
        setData(parsed as ApplicationDocData);
      }
    } catch {
      /* อ่านไม่ได้ = ไม่ต้องขึ้นปุ่ม */
    }
  }, [reference]);
  /* eslint-enable react-hooks/set-state-in-effect */

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

  if (data === null) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-4 w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-[13px] font-bold text-zinc-700 active:bg-zinc-50"
      >
        <FileText className="size-4" aria-hidden />
        ดูใบสมัครของฉัน (พิมพ์ / บันทึก PDF)
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
