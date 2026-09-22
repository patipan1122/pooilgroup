// Recruit Onboarding · shared constants + types for the public "ระบบรับพนักงาน
// ใหม่ออนไลน์" flow (docs/BIGFEATURE_recruit-onboarding_SPEC.md).
//
// Deliberately SEPARATE from lib/recruit/types.ts's ALLOWED_FILE_MIMES/
// MAX_FILE_SIZE — those constants are shared live by app/apply/[slug] (the
// existing job-application flow); tightening them for this feature's ID-photo
// requirements would silently change what applicants can attach there too.

// Registered Thai legal entity names — the ONLY names allowed to appear in the
// employment contract and in the contract hash.
//
// WHY THIS EXISTS: `Company.name` in the DB holds the short ENGLISH trading
// name ("Pooil Oil" / "JP Sync Group"), which is fine for admin UI but wrong
// for a Thai employment contract — the contract must name the registered legal
// entity. Without this map the signed contract would read
// "ตกลงทำสัญญาจ้างแรงงานกับ Pooil Oil" while the form the candidate filled
// said "บริษัท พีโอออยล์ จำกัด".
//
// Every place that renders OR hashes the contract must use this, never
// `company.name` — submit route, signing page, and HR verification page all
// read from here so the rendered text and the stored hash can never diverge.
export const ONBOARDING_COMPANY_LEGAL_NAMES_TH: Record<string, string> = {
  POOIL: "บริษัท พีโอออยล์ จำกัด",
  JPSYNC: "บริษัท เจพีซิงค์ กรุ๊ป จำกัด",
};

/** Resolve the contract-facing legal name for a company code. Falls back to the
 *  DB name only if the code is unknown (shouldn't happen — the form offers a
 *  fixed two-item list — but a contract must never render blank). */
export function onboardingCompanyLegalName(
  code: string,
  fallbackName: string,
): string {
  return ONBOARDING_COMPANY_LEGAL_NAMES_TH[code] ?? fallbackName;
}

export const ONBOARDING_ALLOWED_DOC_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf", // education cert / "other" documents may be a PDF
] as const;

export const ONBOARDING_ALLOWED_DOC_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "pdf"] as const;

export const ONBOARDING_MAX_FILE_SIZE = 8 * 1024 * 1024; // 8 MB — phone camera photos run larger than the 5MB resume limit

// Selfie + signature captured live during signing — always an image, smaller
// ceiling (canvas/webcam capture, not a user-picked file).
export const ONBOARDING_MAX_CAPTURE_SIZE = 4 * 1024 * 1024;

export const ONBOARDING_DOC_TYPES = [
  "ID_CARD",
  "HOUSE_REGISTRATION",
  "BANK_BOOK",
  "PHOTO",
  "EDUCATION",
  "OTHER",
] as const;
export type OnboardingDocType = (typeof ONBOARDING_DOC_TYPES)[number];

export const ONBOARDING_DOC_TYPE_LABELS_TH: Record<OnboardingDocType, string> = {
  ID_CARD: "รูปบัตรประชาชน",
  HOUSE_REGISTRATION: "สำเนาทะเบียนบ้าน",
  BANK_BOOK: "รูปหน้าสมุดบัญชีธนาคาร",
  PHOTO: "รูปถ่ายหน้าตรง",
  EDUCATION: "วุฒิการศึกษา",
  OTHER: "เอกสารอื่นๆ",
};

// Required per the source PDF form spec §8 — ID_CARD/HOUSE_REGISTRATION/
// BANK_BOOK/PHOTO are mandatory (*), EDUCATION/OTHER are optional.
export const ONBOARDING_REQUIRED_DOC_TYPES: OnboardingDocType[] = [
  "ID_CARD",
  "HOUSE_REGISTRATION",
  "BANK_BOOK",
  "PHOTO",
];
