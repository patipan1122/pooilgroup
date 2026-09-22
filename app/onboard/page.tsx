// /onboard — ลิงก์สาธารณะถาวรสำหรับ "ระบบรับพนักงานใหม่ออนไลน์"
// (docs/BIGFEATURE_recruit-onboarding_SPEC.md)
//
// ลิงก์เดียว ใช้ได้ตลอด ไม่มีล็อกอิน ไม่มีวันหมดอายุ ไม่มีรหัสรายคน
// → หน้านี้จึง "ไม่แตะ DB เลย" เพื่อให้ไม่มีทางที่ลิงก์สาธารณะจะ 500
//   (เนื้อหาทุกอย่างเป็น static · ฟอร์มจริงอยู่ใน ./onboard-client)
//
// ดีไซน์: เป็นน้องของ /apply/[slug] — hero gradient แบรนด์ + trust chips +
// การ์ดขาวหัวข้อมีเลข + ปุ่มส่งติดล่าง (ไม่สร้างภาษาใหม่)
//
// SEO: noindex/nofollow เด็ดขาด — หน้านี้รับเลขบัตรประชาชน/เลขบัญชี/รูปถ่าย
// ไม่ควรถูก Google index และไม่ควรมีคนมาเจอโดยบังเอิญ

import type { Metadata } from "next";
import { Clock, ShieldCheck, Smartphone, ShieldAlert } from "lucide-react";
import { OnboardClient } from "./onboard-client";

export const metadata: Metadata = {
  title: "กรอกข้อมูลพนักงานใหม่ · PO Oil / JP Sync Group",
  description:
    "แบบฟอร์มข้อมูลพนักงานใหม่ สำหรับผู้ที่ฝ่ายบุคคลติดต่อและนัดวันเริ่มงานไว้แล้ว",
  robots: { index: false, follow: false, nocache: true },
};

export default function OnboardPage() {
  return (
    <div className="min-h-screen bg-zinc-50">
      {/* HERO — โครงเดียวกับ /apply/[slug] (brand gradient + trust chips) */}
      <div className="relative overflow-hidden text-white">
        <div className="absolute inset-0 bg-gradient-to-br from-[var(--color-brand-600)] via-[var(--color-brand-700)] to-[var(--color-brand-900)]" />
        <div className="relative max-w-2xl mx-auto px-5 sm:px-8 pt-9 pb-11 sm:pt-12 sm:pb-14">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide bg-white/15 backdrop-blur px-3 py-1 rounded-full">
            <span className="size-1.5 rounded-full bg-emerald-300" />
            สำหรับพนักงานใหม่
          </span>
          <h1 className="mt-4 text-3xl sm:text-4xl font-extrabold tracking-tight font-display leading-tight">
            กรอกข้อมูลพนักงานใหม่
          </h1>
          <p className="mt-2 text-sm sm:text-base text-white/85 font-medium">
            บริษัท พีโอออยล์ จำกัด · บริษัท เจพีซิงค์ กรุ๊ป จำกัด
          </p>
          <div className="mt-5 flex flex-wrap gap-2 text-[11px] font-medium">
            <span className="inline-flex items-center gap-1.5 bg-white/15 backdrop-blur px-3 py-1.5 rounded-full">
              <Clock className="size-3" />
              ใช้เวลา 10-15 นาที
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
        <div className="relative h-6 bg-zinc-50 -mt-px rounded-t-[24px]" />
      </div>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 -mt-6">
        {/* แบนเนอร์เดียวของหน้านี้ (RULE L: ≤1 แบนเนอร์อธิบายต่อจอ) —
            ฟอร์มที่ขอบัตรประชาชน + เลขบัญชี + รูปถ่าย มีหน้าตาเหมือนสแกมพอดี
            จึงต้องบอกตรง ๆ ว่าใครควรกรอก และเราจะไม่ขออะไรแบบไหน */}
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 flex gap-3">
          <ShieldAlert className="size-5 text-amber-700 shrink-0 mt-0.5" aria-hidden />
          <div className="text-[13px] leading-relaxed text-amber-950">
            <p className="font-bold">ลิงก์นี้ใช้เฉพาะผู้ที่ฝ่ายบุคคลติดต่อไปแล้วเท่านั้น</p>
            <p className="mt-1">
              ถ้าคุณ<strong>ไม่ได้</strong>คุยกับฝ่ายบุคคลของ PO Oil / JP Sync Group
              และยังไม่ได้ตกลงวันเริ่มงาน กรุณาปิดหน้านี้และอย่ากรอกข้อมูล
            </p>
            <p className="mt-1">
              เราจะ<strong>ไม่</strong>ขอรหัส OTP · รหัสผ่าน · รหัสหลังบัตร
              และ<strong>ไม่</strong>ขอให้โอนเงินใด ๆ ทั้งสิ้น
            </p>
          </div>
        </div>

        <OnboardClient />

        <p className="text-center text-xs text-zinc-500 mt-6 pb-10">
          ข้อมูลส่วนบุคคลเก็บตาม PDPA · ใช้เพื่อการจ้างงานและจัดทำทะเบียนพนักงานเท่านั้น
        </p>
      </div>
    </div>
  );
}
