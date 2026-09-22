// /onboard/success — หน้ายืนยันหลังเซ็นสัญญาเสร็จ
//
// หน้าเซ็นสัญญา (/onboard/sign) จะ redirect มาที่ `/onboard/success?ref=<เลขอ้างอิง>`
//
// ⚠️ ถ้อยคำสำคัญ: ห้ามบอกว่า "เสร็จสมบูรณ์" — ณ จุดนี้ยังเป็นแค่ "ส่งข้อมูลแล้ว"
// สัญญามีผลต่อเมื่อบริษัทอนุมัติ (ฝ่ายบุคคลตรวจเอกสารก่อน) → ถ้าเขียนว่าเสร็จแล้ว
// พนักงานใหม่จะเข้าใจผิดว่าได้งานแน่นอนแล้วตั้งแต่กดส่ง

import type { Metadata } from "next";
import { CheckCircle2, Clock3, MessageCircle } from "lucide-react";

export const metadata: Metadata = {
  title: "ส่งข้อมูลเรียบร้อย · รอฝ่ายบุคคลตรวจสอบ",
  robots: { index: false, follow: false, nocache: true },
};

export default async function OnboardSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const { ref } = await searchParams;

  return (
    <div className="min-h-screen flex items-center justify-center p-5 bg-zinc-50">
      <div className="max-w-md w-full bg-white rounded-3xl border-2 border-[var(--color-brand-200)] p-6 sm:p-8 text-center shadow-soft">
        <div className="size-16 mx-auto rounded-2xl bg-green-50 border-2 border-green-200 flex items-center justify-center text-green-700">
          <CheckCircle2 className="size-8" />
        </div>
        <h1 className="mt-5 text-2xl sm:text-3xl font-extrabold text-zinc-900 font-display">
          ส่งข้อมูลเรียบร้อยแล้ว
        </h1>
        <p className="text-sm text-zinc-600 mt-3 leading-relaxed">
          ฝ่ายบุคคลได้รับข้อมูลและเอกสารของคุณแล้ว
          <br />
          ขั้นต่อไปคือการตรวจสอบก่อนอนุมัติ
        </p>

        {ref && (
          <div className="mt-5 inline-block px-4 py-3 rounded-xl bg-zinc-100">
            <p className="text-xs text-zinc-600 font-bold">
              เลขอ้างอิง · ใช้แจ้งฝ่ายบุคคลเมื่อสอบถาม
            </p>
            <p className="font-mono text-base font-bold text-zinc-900 mt-1.5 tabular-nums break-all">
              {ref}
            </p>
          </div>
        )}

        <div className="mt-6 space-y-2.5 text-left">
          <div className="flex gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-3.5">
            <Clock3 className="size-4 text-amber-700 shrink-0 mt-0.5" aria-hidden />
            <p className="text-[13px] leading-relaxed text-amber-950">
              <strong>สัญญาจ้างจะมีผลเมื่อบริษัทอนุมัติ</strong> — ตอนนี้ยังอยู่ระหว่าง
              ตรวจสอบข้อมูลและเอกสาร ฝ่ายบุคคลจะติดต่อกลับหากต้องการข้อมูลเพิ่มเติม
            </p>
          </div>
          <div className="flex gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-3.5">
            <MessageCircle className="size-4 text-zinc-500 shrink-0 mt-0.5" aria-hidden />
            <p className="text-[13px] leading-relaxed text-zinc-700">
              เมื่ออนุมัติแล้ว คุณจะได้รับ<strong>สำเนาสัญญาจ้าง</strong>ทาง LINE หรืออีเมล
              ที่กรอกไว้ · โปรดเก็บไว้เป็นหลักฐาน
            </p>
          </div>
        </div>

        <p className="text-xs text-zinc-500 mt-6">
          ปิดหน้านี้ได้เลย · หากมีคำถามติดต่อฝ่ายบุคคลที่บริษัท
        </p>
      </div>
    </div>
  );
}
