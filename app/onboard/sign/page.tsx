// /onboard/sign — ขั้นตอนสุดท้ายของ "ระบบรับพนักงานใหม่ออนไลน์"
// (docs/BIGFEATURE_recruit-onboarding_SPEC.md)
//
// ผู้สมัครกรอก 41 ช่อง + แนบเอกสาร 6 ชิ้นที่ /onboard เสร็จแล้ว ถูกส่งต่อมาที่นี่
// เพื่ออ่านสัญญาจ้างฉบับจริง → ติ๊กยินยอม → วาดลายเซ็น → ถ่ายรูปยืนยันตัวตน → ส่ง
//
// ═══════════════════════════════════════════════════════════════════════════
// ทำไมต้องมี server action `loadOnboardingContract` ในไฟล์นี้
// ═══════════════════════════════════════════════════════════════════════════
// ปัญหา: ตัวข้อความสัญญาอยู่ใน lib/recruit/onboarding-contract.ts ซึ่ง import
// `node:crypto` → เป็น server-only แตะจากไฟล์ 'use client' ไม่ได้ แต่ค่าที่ต้อง
// เติมลงสัญญา (ชื่อ · เลขบัตร · ที่อยู่ · ตำแหน่ง · สาขา · วันเริ่มงาน) อยู่ใน
// sessionStorage ซึ่งอ่านได้เฉพาะฝั่ง client → ต้องมีสะพานข้ามฝั่งหนึ่งอัน
//
// ทางที่ไม่เลือก: ส่งเทมเพลตที่ยังมี {{...}} ลงไปแล้วแทนค่าฝั่ง client
//   → ต้องก๊อปกติกาการแทนค่าทั้งชุด (cleanValue · BLANK · แทนรอบเดียวกัน
//     injection · โยน error เมื่อเจอ placeholder แปลกปลอม) ไปไว้อีกที่หนึ่ง
//   → ถ้อยคำสัญญาจะมีสองแหล่งทันที ซึ่งเป็นสิ่งที่ห้ามที่สุดในเอกสารกฎหมาย
//
// ทางที่เลือก: client ส่ง "ค่า" ขึ้นมา · server คืน "ข้อความที่ render เสร็จแล้ว"
//   → lib ยังเป็นเจ้าของถ้อยคำแต่เพียงผู้เดียวตลอดไป
//
// server action ตัวนี้ยัง resolve ชื่อบริษัท/ชื่อสาขา จาก DB ด้วย "วิธีเดียวกัน
// เป๊ะ ๆ" กับ app/api/recruit/onboarding/submit/route.ts เพราะ hash ที่ตอนส่ง
// เก็บลง RecruitOnboardingConsent.contractContentHash คำนวณจากค่าเหล่านั้น —
// ถ้าหน้าจอโชว์ "ปั๊มบางนา" แต่ hash คิดจาก "สาขาบางนา" เราจะพิสูจน์ไม่ได้ว่า
// "ข้อความที่พนักงานอ่าน = ข้อความที่ระบบเก็บ" ซึ่งคือทั้งหมดที่ hash มีไว้ทำ
// (พ.ร.บ. ธุรกรรมทางอิเล็กทรอนิกส์ ม.9)
//
// หน้าตัวมันเอง (ส่วนที่ render ออกไปตอนโหลด) ยังไม่แตะ DB เลย — เหมือน
// /onboard ที่จงใจไม่แตะ เพื่อให้ลิงก์สาธารณะไม่มีทาง 500 ถ้า DB มีปัญหา
// ผู้ใช้จะเห็นกล่องสัญญาขึ้น error พร้อมปุ่มลองใหม่ ไม่ใช่หน้าพัง
//
// SEO: noindex/nofollow เด็ดขาด — หน้านี้แสดงชื่อ/เลขบัตร/ที่อยู่ของคนจริง

import type { Metadata } from "next";
import { z } from "zod";
import { ShieldCheck } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { POOILGROUP_ORG_ID } from "@/lib/rentspace/format";
import { onboardingCompanyLegalName } from "@/lib/recruit/onboarding-types";
import {
  FINAL_ACKNOWLEDGMENT_TEXT,
  ONBOARDING_CONTRACT_TITLE,
  ONBOARDING_CONTRACT_VERSION,
  getOnboardingContractSections,
} from "@/lib/recruit/onboarding-contract";
import {
  SignClient,
  type OnboardingContractRequest,
  type OnboardingContractResult,
} from "./sign-client";

export const metadata: Metadata = {
  title: "อ่านและเซ็นสัญญาจ้าง · PO Oil / JP Sync Group",
  description: "ขั้นตอนสุดท้ายของการรับพนักงานใหม่ — อ่านสัญญาจ้าง ลงลายมือชื่อ และยืนยันตัวตน",
  robots: { index: false, follow: false, nocache: true },
};

/* ------------------------------------------------------------------ helpers */

// ตารางเดือนไทยแบบเขียนมือ (ไม่ใช้ Intl) — คัดลอกโครงมาจาก
// app/api/recruit/onboarding/submit/route.ts โดยตั้งใจ เพราะ route file ของ
// Next.js export ฟังก์ชันช่วยออกมาใช้ซ้ำไม่ได้
//
// ⚠️ ห้ามแก้ข้างเดียว: ผลลัพธ์ของ fmtDateTh() ที่นี่ต้องตรงกับของ route submit
// ทุกตัวอักษร ไม่งั้นข้อความที่พนักงานอ่าน (ที่นี่) กับข้อความที่ถูก hash
// (ที่ route) จะต่างกันแค่วันเริ่มงาน แล้ว hash ที่เก็บไว้จะพิสูจน์อะไรไม่ได้เลย
// เหตุผลที่ไม่ใช้ Intl/toLocaleDateString: ICU เปลี่ยนรูปแบบข้ามเวอร์ชัน Node ได้
// แต่ตารางที่เขียนมือไม่เปลี่ยน → hash ยังคำนวณซ้ำได้อีกหลายปีข้างหน้า
const TH_MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
] as const;

/** "2026-10-01" → "1 ตุลาคม 2569" */
function fmtDateTh(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${TH_MONTHS[m - 1]} ${y + 543}`;
}

/** ต้องตรงกับ oneLineAddress() ของ route submit ทุกตัวอักษร (ดูหมายเหตุด้านบน) */
function oneLineAddress(a: {
  line: string;
  subDistrict: string;
  district: string;
  province: string;
  postalCode: string;
}): string {
  return `${a.line} ต./แขวง ${a.subDistrict} อ./เขต ${a.district} จ.${a.province} ${a.postalCode}`;
}

const AddressPart = z.object({
  line: z.string().max(300),
  subDistrict: z.string().max(100),
  district: z.string().max(100),
  province: z.string().max(100),
  postalCode: z.string().max(10),
});

// จำกัดความยาวทุกช่อง: action นี้เปิดสาธารณะเหมือน API route ทุกประการ
// (ใครยิงเข้ามาตรง ๆ ก็ได้) จึงต้องมีเพดานเหมือนกัน — ค่าที่ได้ไม่ถูกเขียนลง DB
// และการแทนค่าใน lib เป็นแบบรอบเดียว ค่าที่แทนลงไปจึงแทรกอะไรกลับไม่ได้
const ContractVars = z.object({
  companyCode: z.enum(["POOIL", "JPSYNC"]),
  fullNameTh: z.string().max(200),
  nationalId: z.string().max(20),
  registeredAddress: AddressPart,
  position: z.string().max(200),
  branch: z.string().max(200),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/* ------------------------------------------------------------ server action */

async function loadOnboardingContract(
  input: OnboardingContractRequest,
): Promise<OnboardingContractResult> {
  "use server";

  const parsed = ContractVars.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "ข้อมูลที่กรอกไว้ไม่ครบ · กรุณากลับไปแก้ที่แบบฟอร์ม" };
  }
  const vars = parsed.data;

  // ไม่ได้เขียนอะไรลง DB แต่อ่าน 2 ครั้งต่อการเรียกหนึ่งครั้ง และเปิดสาธารณะ
  // → ต้องมีเพดานกันยิงรัว เพดานตั้งหลวม ๆ เพราะเปิดหน้า/กดลองใหม่หลายรอบ
  // เป็นพฤติกรรมปกติของคนกรอกจริง ไม่ใช่การโจมตี
  const rl = await checkRateLimit({
    bucket: "recruit-onboarding-contract:all",
    max: 600,
    windowSec: 15 * 60,
  });
  if (rl.limited) {
    return { ok: false, error: "ระบบกำลังมีผู้ใช้งานมาก · กรุณารอสักครู่แล้วกดลองใหม่" };
  }

  try {
    // companyCode ไม่ใช่ companyId — ห้ามเชื่อ UUID จาก client (กติกาเดียวกับ
    // route submit ซึ่งเป็นคนคำนวณ hash จริง)
    const company = await prisma.company.findFirst({
      where: { orgId: POOILGROUP_ORG_ID, code: vars.companyCode },
      select: { name: true, id: true, code: true },
    });
    if (!company) {
      return { ok: false, error: "ไม่พบบริษัทที่เลือก · กรุณาติดต่อฝ่ายบุคคล" };
    }
    // ชื่อนิติบุคคลภาษาไทยตามทะเบียน ไม่ใช่ company.name (ชื่อการค้าอังกฤษใน DB)
    // — ต้องตรงกับฝั่ง submit + หน้าตรวจของ HR เป๊ะ ๆ ไม่งั้น hash ไม่ตรง
    const companyLegalName = onboardingCompanyLegalName(company.code, company.name);

    // สาขาในแบบฟอร์มเป็นข้อความอิสระ — จับคู่กับ Branch จริงได้ก็ใช้ชื่อทางการ
    // จับไม่ได้ก็ใช้ข้อความที่ผู้สมัครพิมพ์ (ตรรกะเดียวกับ route submit เป๊ะ)
    const branchText = vars.branch.trim();
    const branch = await prisma.branch.findFirst({
      where: {
        orgId: POOILGROUP_ORG_ID,
        companyId: company.id,
        OR: [
          { code: { equals: branchText, mode: "insensitive" } },
          { name: { equals: branchText, mode: "insensitive" } },
        ],
      },
      select: { name: true },
    });

    const branchName = branch?.name ?? branchText;
    const startDateText = fmtDateTh(vars.startDate);

    // signedAtText: "" โดยตั้งใจ — ตอนอ่านยังไม่มี "วันเวลาที่กดยินยอม" และ
    // hashOnboardingContract() ฝั่ง submit ก็ hash ฉบับที่ค่านี้ว่างเหมือนกัน
    // (ดูคอมเมนต์ยาวเหนือ hashOnboardingContract) → ข้อความที่อ่านกับที่ถูก hash
    // จึงเป็นชุดเดียวกันจริง ๆ ในสัญญาจะเห็นเป็นเส้นจุดไข่ปลาแทน
    const sections = getOnboardingContractSections({
      companyName: companyLegalName,
      fullNameTh: vars.fullNameTh.trim(),
      nationalId: vars.nationalId,
      registeredAddress: oneLineAddress(vars.registeredAddress),
      position: vars.position.trim(),
      branch: branchName,
      startDate: startDateText,
      signedAtText: "",
    });

    return {
      ok: true,
      sections,
      companyName: companyLegalName,
      branchName,
      startDateText,
    };
  } catch (e) {
    console.error("[onboard-sign] load contract failed", e);
    return { ok: false, error: "โหลดสัญญาไม่สำเร็จ · กรุณากดลองใหม่อีกครั้ง" };
  }
}

/* -------------------------------------------------------------------- page */

export default async function OnboardSignPage({
  searchParams,
}: {
  searchParams: Promise<{ s?: string }>;
}) {
  // อ่าน ?s= ฝั่ง server แล้วส่งลงไปเป็น prop แทนที่จะให้ client เรียก
  // useSearchParams() — จะได้ไม่ต้องห่อ Suspense เพิ่มอีกชั้นเปล่า ๆ
  const { s } = await searchParams;
  const sessionIdFromQuery = typeof s === "string" && s !== "" ? s : null;

  return (
    <div className="min-h-screen bg-zinc-50">
      {/* HERO — เตี้ยกว่า /onboard เพราะเป็นขั้นที่ 2 ไม่ใช่หน้าแรกที่ต้องสร้างความมั่นใจ
          ใหม่ทั้งหมด (RULE L งบพื้นที่: ให้เห็นตัวสัญญาเร็วที่สุด) */}
      <div className="relative overflow-hidden text-white">
        <div className="absolute inset-0 bg-gradient-to-br from-[var(--color-brand-600)] via-[var(--color-brand-700)] to-[var(--color-brand-900)]" />
        <div className="relative max-w-2xl mx-auto px-5 sm:px-8 pt-7 pb-9">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide bg-white/15 backdrop-blur px-3 py-1 rounded-full">
            <span className="size-1.5 rounded-full bg-emerald-300" />
            ขั้นตอนสุดท้าย
          </span>
          <h1 className="mt-3 text-2xl sm:text-3xl font-extrabold tracking-tight font-display leading-tight">
            อ่านและเซ็นสัญญาจ้าง
          </h1>
          <p className="mt-1.5 text-sm text-white/85 font-medium inline-flex items-center gap-1.5">
            <ShieldCheck className="size-3.5" aria-hidden />
            ลายเซ็นอิเล็กทรอนิกส์ มีผลเท่ากับเซ็นบนกระดาษ
          </p>
        </div>
        <div className="relative h-6 bg-zinc-50 -mt-px rounded-t-[24px]" />
      </div>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 -mt-6">
        <SignClient
          sessionIdFromQuery={sessionIdFromQuery}
          contractTitle={ONBOARDING_CONTRACT_TITLE}
          acknowledgmentText={FINAL_ACKNOWLEDGMENT_TEXT}
          contractVersion={ONBOARDING_CONTRACT_VERSION}
          loadContract={loadOnboardingContract}
        />
      </div>
    </div>
  );
}
