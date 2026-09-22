// Recruit Onboarding · shared presentation constants for the HR review screens.
// Plain module (no JSX, no "use server") so both the server pages and the
// client review panel can import it.

import type { RecruitOnboardingStatus } from "@/lib/generated/prisma/client";

export const ONBOARDING_STATUS_LABELS_TH: Record<RecruitOnboardingStatus, string> = {
  SUBMITTED: "ส่งเข้ามาใหม่",
  HR_REVIEWING: "กำลังตรวจ",
  APPROVED: "อนุมัติแล้ว",
  REJECTED: "ตีกลับ/ไม่รับ",
};

/** Tailwind classes per status — one badge look used on both list + detail. */
export const ONBOARDING_STATUS_CLASSES: Record<RecruitOnboardingStatus, string> = {
  SUBMITTED: "bg-blue-50 text-blue-700 border-blue-200",
  HR_REVIEWING: "bg-amber-50 text-amber-700 border-amber-200",
  APPROVED: "bg-green-50 text-green-700 border-green-200",
  REJECTED: "bg-red-50 text-red-700 border-red-200",
};

export const ONBOARDING_STATUS_ORDER: RecruitOnboardingStatus[] = [
  "SUBMITTED",
  "HR_REVIEWING",
  "APPROVED",
  "REJECTED",
];

/** Statuses that are still open for an approve/reject decision. */
export const ONBOARDING_OPEN_STATUSES: RecruitOnboardingStatus[] = [
  "SUBMITTED",
  "HR_REVIEWING",
];

export function isOnboardingStatus(v: string): v is RecruitOnboardingStatus {
  return (ONBOARDING_STATUS_ORDER as string[]).includes(v);
}

/** The 9 sections of the paper form, in the order the candidate fills them. */
export const ONBOARDING_SECTIONS = [
  { no: 1, title: "ตำแหน่งที่สมัคร" },
  { no: 2, title: "ข้อมูลส่วนตัว" },
  { no: 3, title: "ที่อยู่" },
  { no: 4, title: "ผู้ติดต่อฉุกเฉิน" },
  { no: 5, title: "การศึกษา" },
  { no: 6, title: "ประวัติการทำงาน" },
  { no: 7, title: "บัญชีรับเงินเดือน" },
  { no: 8, title: "เอกสารแนบ" },
  { no: 9, title: "การยินยอม + สัญญาจ้าง" },
] as const;
