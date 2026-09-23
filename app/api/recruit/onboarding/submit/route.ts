// Recruit Onboarding · PUBLIC final submit (ระบบรับพนักงานใหม่ออนไลน์)
// ────────────────────────────────────────────────────────────────────
// POST application/json — everything the candidate produced in one shot:
// the 41 form answers, the Drive descriptors returned by
// /api/recruit/onboarding/upload, the signature + selfie descriptors, the
// scroll-gate flag and the 4 consent booleans.
//
// Fully unauthenticated (one permanent public link, no login, no per-person
// code — spec "Goal & Users"), so every gate here is server-side by necessity:
// rate limit, zod, Thai-ID checksum, 18+, company resolution from a CODE (never
// a client-sent UUID), and a server-rendered contract hash. Nothing the client
// asserts about identity or about the contract it displayed is trusted.
//
// Writes all three tables in ONE prisma.$transaction so a half-written
// submission (documents with no consent row, or vice-versa) is impossible —
// this is the project's first $transaction, deliberately the simplest possible
// form (a sequential array, ids pre-generated) rather than an interactive one.
//
// RecruitOnboardingConsent carries a DB-level WORM trigger (UPDATE/DELETE
// blocked) — insert once, never upsert, never retry-by-update.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { zUUID } from "@/lib/zod-helpers";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";
import { audit } from "@/lib/audit/log";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { POOILGROUP_ORG_ID } from "@/lib/rentspace/format";
import { normalizePhone } from "@/lib/repair/slug";
import { hashOnboardingContract } from "@/lib/recruit/onboarding-contract";
import {
  ONBOARDING_ALLOWED_DOC_MIMES,
  ONBOARDING_DOC_TYPES,
  ONBOARDING_REQUIRED_DOC_TYPES,
  ONBOARDING_DOC_TYPE_LABELS_TH,
  onboardingCompanyLegalName,
  type OnboardingDocType,
} from "@/lib/recruit/onboarding-types";
import {
  isOnboardingPublicFlowEnabled,
  ONBOARDING_CLOSED_MESSAGE,
} from "@/lib/recruit/onboarding-availability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ต้องเป็นวันที่รูปแบบ YYYY-MM-DD");

// Google Drive file/folder ids — opaque, but always URL-safe base64-ish. Shape
// check only; the real proof that the candidate owns these ids is that they
// were handed out by the upload route for this draft (see folder-consistency
// check in POST below).
const DriveId = z.string().regex(/^[A-Za-z0-9_-]{8,200}$/, "รหัสไฟล์ไม่ถูกต้อง");

const DocDescriptorSchema = z.object({
  fileId: DriveId,
  folderId: DriveId,
  fileName: z.string().min(1).max(255),
  mimeType: z.enum(ONBOARDING_ALLOWED_DOC_MIMES),
});

const UploadedDocSchema = DocDescriptorSchema.extend({
  docType: z.enum(ONBOARDING_DOC_TYPES),
});

const AddressPartSchema = z.object({
  line: z.string().min(1, "กรอกที่อยู่").max(300), // บ้านเลขที่ / หมู่ / ซอย / ถนน
  subDistrict: z.string().min(1, "กรอกตำบล/แขวง").max(100),
  district: z.string().min(1, "กรอกอำเภอ/เขต").max(100),
  province: z.string().min(1, "กรอกจังหวัด").max(100),
  postalCode: z.string().regex(/^\d{5}$/, "รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก"),
});

const EmergencyContactSchema = z.object({
  name: z.string().min(1, "กรอกชื่อผู้ติดต่อฉุกเฉิน").max(200),
  relation: z.string().min(1, "กรอกความสัมพันธ์").max(100),
  phone: z.string().min(1, "กรอกเบอร์โทร").max(30),
  address: z.string().max(300).optional(),
});

const EducationSchema = z.object({
  level: z.string().min(1, "กรอกระดับการศึกษา").max(100),
  institute: z.string().min(1, "กรอกสถาบันการศึกษา").max(200),
  major: z.string().max(200).optional(),
  graduationYear: z.string().max(10).optional(),
  gpa: z.string().max(10).optional(),
});

const WorkHistorySchema = z.object({
  company: z.string().min(1).max(200),
  position: z.string().max(200).optional(),
  period: z.string().max(100).optional(),
  salary: z.string().max(50).optional(),
  reasonLeaving: z.string().max(300).optional(),
});

const SubmitSchema = z.object({
  // Groups this candidate's Drive uploads; recorded in answersJson so HR can
  // trace a submission back to its Drive folder name.
  submissionDraftId: zUUID("รหัสอ้างอิงแบบฟอร์มไม่ถูกต้อง"),

  // ส่วนที่ 1 — ตำแหน่งที่สมัคร
  // companyCode, never companyId: a client-supplied UUID would let anyone
  // attach their submission to an arbitrary Company row.
  companyCode: z.enum(["POOIL", "JPSYNC"]),
  branch: z.string().min(1, "กรอกสาขา/สถานที่ทำงาน").max(200), // free text per the source form
  positionApplied: z.string().min(1, "กรอกตำแหน่งงาน").max(200),
  desiredStartDate: DateString,
  desiredSalary: z.number().positive("เงินเดือนต้องมากกว่า 0").max(9_999_999),

  // ส่วนที่ 2 — ข้อมูลส่วนตัว
  titlePrefix: z.string().min(1, "เลือกคำนำหน้า").max(20),
  fullNameTh: z.string().min(1, "กรอกชื่อ-นามสกุล (ไทย)").max(200),
  fullNameEn: z.string().max(200).optional(),
  nickname: z.string().min(1, "กรอกชื่อเล่น").max(100),
  nationalId: z.string().regex(/^\d{13}$/, "เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก"),
  birthDate: DateString,
  nationality: z.string().min(1, "กรอกสัญชาติ").max(100),
  militaryStatus: z.string().max(100).optional(),
  phone: z.string().min(1, "กรอกเบอร์โทรศัพท์").max(30),
  lineId: z.string().max(100).optional(),
  email: z.string().email("อีเมลไม่ถูกต้อง").max(200).optional().or(z.literal("")),
  maritalStatus: z.string().max(100).optional(),

  // ส่วนที่ 3-7
  address: z.object({
    registered: AddressPartSchema,
    sameAsRegistered: z.boolean().default(false),
    current: AddressPartSchema.optional(),
  }),
  emergencyContacts: z.array(EmergencyContactSchema).length(2, "ต้องกรอกผู้ติดต่อฉุกเฉิน 2 คน"),
  education: EducationSchema,
  workHistory: z.array(WorkHistorySchema).max(10).default([]),
  bankName: z.string().min(1, "กรอกชื่อธนาคาร").max(100),
  bankAccountNo: z.string().min(1, "กรอกเลขบัญชี").max(30),
  bankAccountName: z.string().min(1, "กรอกชื่อบัญชี").max(200),

  // ส่วนที่ 8 — เอกสารแนบ (อัปโหลดไว้แล้วผ่าน /api/recruit/onboarding/upload)
  documents: z.array(UploadedDocSchema).min(1).max(12),
  signature: DocDescriptorSchema,
  selfie: DocDescriptorSchema,

  // ส่วนที่ 9 — สัญญา + การยินยอม
  scrolledToEnd: z.boolean(),
  consents: z.object({
    truthful: z.boolean(),
    privacyRead: z.boolean(),
    emergencyContactNotified: z.boolean(),
    referenceCheck: z.boolean(),
  }),

  // Anything the form collects that has no typed column yet — mirrors
  // RecruitApplication's own answersJson escape hatch. Size-capped: it is an
  // open-shaped bag on a public endpoint, so without a cap it is a free
  // write-anything-you-like channel into the DB.
  answers: z
    .record(z.string(), z.unknown())
    .refine((v) => JSON.stringify(v).length <= 20_000, "ข้อมูลเพิ่มเติมยาวเกินกำหนด")
    .default({}),
});

type SubmitInput = z.infer<typeof SubmitSchema>;

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

/**
 * Thai national-ID checksum (mod-11 weighted): digits 1-12 are weighted 13..2,
 * summed, and the check digit is (11 - sum % 11) % 10. Catches typos and most
 * made-up numbers; it does NOT prove the ID exists — HR still eyeballs the
 * uploaded ID-card photo.
 */
function isValidThaiNationalId(id: string): boolean {
  if (!/^\d{13}$/.test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(id[i]) * (13 - i);
  }
  return ((11 - (sum % 11)) % 10) === Number(id[12]);
}

/** Today in Asia/Bangkok as {y,m,d} — the server runs in UTC on Vercel. */
function bangkokToday(now: Date): { y: number; m: number; d: number } {
  const bkk = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return { y: bkk.getUTCFullYear(), m: bkk.getUTCMonth() + 1, d: bkk.getUTCDate() };
}

/** Completed years between a YYYY-MM-DD birth date and Bangkok "today". */
function ageOn(birth: string, now: Date): number {
  const [by, bm, bd] = birth.split("-").map(Number);
  const t = bangkokToday(now);
  let age = t.y - by;
  if (t.m < bm || (t.m === bm && t.d < bd)) age -= 1;
  return age;
}

function isRealDate(s: string): boolean {
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// Deterministic, locale-independent Thai date formatting for the contract vars.
//
// Why not toLocaleDateString("th-TH") / lib/utils/format's thaiDateLong: the
// stored contractContentHash must be re-computable years from now, on a
// different Node/ICU build, to prove what the candidate signed — Intl locale
// data changes between releases, a hand-built table does not. (thaiDateLong
// also renders the abbreviated "2 พ.ค. 69" form, not the full form a contract
// needs.) Output matches the example in OnboardingContractVars: "1 ตุลาคม 2569".
const TH_MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
] as const;

function fmtDateTh(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${TH_MONTHS[m - 1]} ${y + 543}`;
}

function fmtDateTimeTh(at: Date): string {
  const bkk = new Date(at.getTime() + 7 * 60 * 60 * 1000); // server runs UTC
  const p = (n: number) => String(n).padStart(2, "0");
  return `${bkk.getUTCDate()} ${TH_MONTHS[bkk.getUTCMonth()]} ${
    bkk.getUTCFullYear() + 543
  } เวลา ${p(bkk.getUTCHours())}:${p(bkk.getUTCMinutes())} น.`;
}

function oneLineAddress(a: z.infer<typeof AddressPartSchema>): string {
  return `${a.line} ต./แขวง ${a.subDistrict} อ./เขต ${a.district} จ.${a.province} ${a.postalCode}`;
}

/** `inet` columns reject free text — getClientIp() returns "unknown" when it
 * cannot determine one, which would blow up the INSERT. Store null instead. */
function inetOrNull(ip: string): string | null {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip;
  if (/^[0-9a-fA-F:]{2,45}$/.test(ip) && ip.includes(":")) return ip;
  return null;
}

function toJson(v: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(v ?? null)) as Prisma.InputJsonValue;
}

export async function POST(req: NextRequest) {
  if (!isOnboardingPublicFlowEnabled()) {
    return NextResponse.json(
      { error: ONBOARDING_CLOSED_MESSAGE },
      { status: 503 },
    );
  }
  const ip = getClientIp(req);

  // Two buckets on purpose. checkRateLimit() RECORDS every call it allows, so a
  // single 5/IP/24h gate at the top of the handler would spend a candidate's
  // whole day's quota on validation errors — and on a 41-field phone form,
  // five rejected attempts ("เลขบัตรประชาชนไม่ถูกต้อง", a missed consent box)
  // is an ordinary afternoon, not an attack. The public link has no per-person
  // code and no HR-side reset, so that candidate would simply be stuck.
  //   • burst bucket  — cheap anti-flood on raw attempts, checked first
  //   • daily bucket  — the spec's 5/IP/24h, consumed only by a submission that
  //                     passed every gate and is about to be written
  const burst = await checkRateLimit({
    bucket: `recruit-onboarding-submit-attempt:ip:${ip}`,
    max: 20,
    windowSec: 15 * 60,
  });
  if (burst.limited) {
    return NextResponse.json(
      { error: "ส่งข้อมูลถี่เกินไป · กรุณารอสักครู่แล้วลองใหม่" },
      { status: 429, headers: { "Retry-After": String(burst.retryAfterSec) } },
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return bad("ข้อมูลที่ส่งมาไม่ถูกต้อง");
  }
  const parsed = SubmitSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      {
        error: `ข้อมูลไม่ครบหรือไม่ถูกต้อง: ${first?.message ?? "กรุณาตรวจสอบอีกครั้ง"}`,
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
      { status: 400 },
    );
  }
  const input: SubmitInput = parsed.data;

  // ── 1. Business validation ─────────────────────────────────────────
  if (!isValidThaiNationalId(input.nationalId)) {
    return bad("เลขบัตรประชาชนไม่ถูกต้อง · กรุณาตรวจสอบตัวเลข 13 หลักอีกครั้ง");
  }
  if (!isRealDate(input.birthDate) || !isRealDate(input.desiredStartDate)) {
    return bad("วันที่ไม่ถูกต้อง · กรุณาตรวจสอบวันเกิดและวันที่เริ่มงาน");
  }

  const now = new Date();
  const age = ageOn(input.birthDate, now);
  if (age < 0 || age > 100) {
    return bad("วันเกิดไม่ถูกต้อง · กรุณาตรวจสอบอีกครั้ง");
  }
  // Minors must not self-serve through a public link (spec: legal + PDPA) —
  // tell them exactly what to do instead of leaving them stuck.
  if (age < 18) {
    return bad(
      "ระบบนี้รับเฉพาะผู้ที่มีอายุ 18 ปีบริบูรณ์ขึ้นไป · หากคุณอายุต่ำกว่า 18 ปี กรุณาติดต่อฝ่ายบุคคลโดยตรงเพื่อดำเนินการแบบมีผู้ปกครองยินยอม",
    );
  }

  // Thai users type dates in พ.ศ. by habit; "2569-10-01" parses as a perfectly
  // valid year-2569 date and would sit in the DB (and in the signed contract)
  // looking plausible. A ±1-year window round today catches it while still
  // allowing "started last month" back-dating.
  const startYear = Number(input.desiredStartDate.slice(0, 4));
  const thisYear = bangkokToday(now).y;
  if (startYear < thisYear - 1 || startYear > thisYear + 1) {
    return bad("วันที่เริ่มงานไม่ถูกต้อง · กรุณากรอกเป็นปี ค.ศ. (เช่น 2026) และอยู่ในช่วง 1 ปี");
  }

  const phone = normalizePhone(input.phone);
  if (!phone) return bad("เบอร์โทรศัพท์ไม่ถูกต้อง (กรอก 9-10 หลัก ขึ้นต้นด้วย 0 หรือ +66)");

  const ecPhones: string[] = [];
  for (let i = 0; i < input.emergencyContacts.length; i++) {
    const p = normalizePhone(input.emergencyContacts[i].phone);
    if (!p) return bad(`เบอร์โทรผู้ติดต่อฉุกเฉินคนที่ ${i + 1} ไม่ถูกต้อง`);
    ecPhones.push(p);
  }
  // Two identical "emergency" numbers (or the employee's own) is the failure
  // mode this check exists for: a contact list that cannot actually reach
  // anyone in an emergency.
  if (ecPhones[0] === ecPhones[1]) {
    return bad("ผู้ติดต่อฉุกเฉิน 2 คนต้องใช้เบอร์โทรต่างกัน");
  }
  if (ecPhones.includes(phone)) {
    return bad("เบอร์ผู้ติดต่อฉุกเฉินต้องไม่ใช่เบอร์ของตัวเอง");
  }

  if (!input.address.sameAsRegistered && !input.address.current) {
    return bad("กรอกที่อยู่ปัจจุบัน หรือเลือก “ใช้ที่อยู่เดียวกับทะเบียนบ้าน”");
  }

  const c = input.consents;
  if (!c.truthful || !c.privacyRead || !c.emergencyContactNotified || !c.referenceCheck) {
    return bad("กรุณายินยอมให้ครบทุกข้อก่อนส่งข้อมูล");
  }

  // Required documents — EDUCATION/OTHER stay optional per the source form §8.
  const presentTypes = new Set<OnboardingDocType>(input.documents.map((d) => d.docType));
  const missing = ONBOARDING_REQUIRED_DOC_TYPES.filter((t) => !presentTypes.has(t));
  if (missing.length > 0) {
    return bad(
      `ยังขาดเอกสาร: ${missing.map((t) => ONBOARDING_DOC_TYPE_LABELS_TH[t]).join(" · ")}`,
    );
  }

  // Signature + selfie are images only — the upload route already enforces
  // this for docType SIGNATURE/SELFIE; re-checked here because the descriptors
  // arrive from the client, not from that response.
  if (input.signature.mimeType === "application/pdf" || input.selfie.mimeType === "application/pdf") {
    return bad("ลายเซ็นและรูปเซลฟี่ต้องเป็นรูปภาพเท่านั้น");
  }

  // Cheap anti-tamper: every descriptor must sit in the SAME Drive folder, and
  // that folder is only ever handed back by the upload route for this draft.
  // It does not prove ownership of a file id, but it stops a submission from
  // stitching in files that belong to a different candidate's folder.
  const allDescriptors = [...input.documents, input.signature, input.selfie];
  const folderIds = new Set(allDescriptors.map((d) => d.folderId));
  if (folderIds.size !== 1) {
    return bad("ไฟล์แนบไม่ตรงกับแบบฟอร์มนี้ · กรุณาอัปโหลดเอกสารใหม่อีกครั้ง");
  }
  const fileIds = new Set(allDescriptors.map((d) => d.fileId));
  if (fileIds.size !== allDescriptors.length) {
    return bad("มีไฟล์แนบซ้ำกัน · กรุณาตรวจสอบเอกสารที่อัปโหลด");
  }

  // ── 2. Resolve org-owned references server-side ────────────────────
  const company = await prisma.company.findFirst({
    where: { orgId: POOILGROUP_ORG_ID, code: input.companyCode },
    select: { id: true, name: true, code: true },
  });
  if (!company) {
    console.error("[onboarding-submit] company code not found", input.companyCode);
    return bad("ไม่พบบริษัทที่เลือก · กรุณาติดต่อฝ่ายบุคคล", 500);
  }

  // The form's branch field is free text (spec) — match it to a real Branch
  // when we can so HR gets a proper link, otherwise leave null and keep the
  // typed text in answersJson. Never reject on a no-match.
  const branchText = input.branch.trim();
  const branch = await prisma.branch.findFirst({
    where: {
      orgId: POOILGROUP_ORG_ID,
      companyId: company.id,
      OR: [
        { code: { equals: branchText, mode: "insensitive" } },
        { name: { equals: branchText, mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true },
  });

  // ── 3. Server-side contract hash ───────────────────────────────────
  // Rendered from the SUBMITTED values, never from a client-sent hash: the
  // stored hash is this server's statement of what these answers produce.
  //
  // hashOnboardingContract (not hashContractText ∘ render) on purpose — it
  // re-renders with signedAtText: "" so the hash equals the text the candidate
  // actually READ, which is the whole point of storing it. Every identifying
  // var (name, national ID, address, position, branch, start date, company)
  // still participates, so any later tampering breaks the hash. The signing
  // moment lives in the consent row's own immutable signedAt column.
  const signedAt = now;
  const contractContentHash = hashOnboardingContract({
    // Registered Thai legal name, never company.name (the English trading
    // name) — see ONBOARDING_COMPANY_LEGAL_NAMES_TH. Must match the signing
    // page + HR verification page exactly or the hash is meaningless.
    companyName: onboardingCompanyLegalName(company.code, company.name),
    fullNameTh: input.fullNameTh.trim(),
    nationalId: input.nationalId,
    registeredAddress: oneLineAddress(input.address.registered),
    position: input.positionApplied.trim(),
    branch: branch?.name ?? branchText,
    startDate: fmtDateTh(input.desiredStartDate),
    signedAtText: fmtDateTimeTh(signedAt), // ignored by the hash; kept truthful
  });

  // ── 4. Spend the daily quota, then write ───────────────────────────
  // Checked here, not at the top: only a submission that passed every gate and
  // is about to be persisted should consume one of the 5 allowed per IP per
  // 24h (see the two-bucket note at the top of this handler).
  const daily = await checkRateLimit({
    bucket: `recruit-onboarding-submit:ip:${ip}`,
    max: 5,
    windowSec: 24 * 60 * 60,
  });
  if (daily.limited) {
    return NextResponse.json(
      { error: "ส่งข้อมูลครบจำนวนที่อนุญาตต่อวันแล้ว · กรุณาติดต่อฝ่ายบุคคลหากต้องการส่งอีกครั้ง" },
      { status: 429, headers: { "Retry-After": String(daily.retryAfterSec) } },
    );
  }

  const submissionId = crypto.randomUUID();
  const userAgent = req.headers.get("user-agent")?.slice(0, 500) ?? null;
  const submittedIp = inetOrNull(ip);

  const docRows = input.documents.map((d) => ({
    id: crypto.randomUUID(),
    submissionId,
    docType: d.docType,
    driveFileId: d.fileId,
    driveFolderId: d.folderId,
    fileName: d.fileName,
    mimeType: d.mimeType,
  }));
  // SIGNATURE/SELFIE have no enum member of their own (the migrated
  // RecruitOnboardingDocType has 6 values) → stored as OTHER and identified by
  // the consent row's signatureDocId/selfieDocId pointers, plus the SIGNATURE-/
  // SELFIE- prefix the upload route puts on the Drive filename.
  const signatureRow = {
    id: crypto.randomUUID(),
    submissionId,
    docType: "OTHER" as const,
    driveFileId: input.signature.fileId,
    driveFolderId: input.signature.folderId,
    fileName: input.signature.fileName,
    mimeType: input.signature.mimeType,
  };
  const selfieRow = {
    id: crypto.randomUUID(),
    submissionId,
    docType: "OTHER" as const,
    driveFileId: input.selfie.fileId,
    driveFolderId: input.selfie.folderId,
    fileName: input.selfie.fileName,
    mimeType: input.selfie.mimeType,
  };

  const consentedAt = now;
  try {
    await prisma.$transaction([
      prisma.recruitOnboardingSubmission.create({
        data: {
          id: submissionId,
          orgId: POOILGROUP_ORG_ID,
          companyId: company.id,
          branchId: branch?.id ?? null,
          positionApplied: input.positionApplied.trim(),
          desiredStartDate: new Date(`${input.desiredStartDate}T00:00:00.000Z`),
          desiredSalary: new Prisma.Decimal(input.desiredSalary.toFixed(2)),
          titlePrefix: input.titlePrefix.trim(),
          fullNameTh: input.fullNameTh.trim(),
          fullNameEn: input.fullNameEn?.trim() || null,
          nickname: input.nickname.trim(),
          nationalId: input.nationalId,
          birthDate: new Date(`${input.birthDate}T00:00:00.000Z`),
          nationality: input.nationality.trim(),
          militaryStatus: input.militaryStatus?.trim() || null,
          phone,
          lineId: input.lineId?.trim() || null,
          email: input.email?.trim() || null,
          maritalStatus: input.maritalStatus?.trim() || null,
          addressJson: toJson({
            registered: input.address.registered,
            sameAsRegistered: input.address.sameAsRegistered,
            current: input.address.sameAsRegistered
              ? input.address.registered
              : input.address.current,
          }),
          emergencyContactsJson: toJson(
            input.emergencyContacts.map((ec, i) => ({ ...ec, phone: ecPhones[i] })),
          ),
          educationJson: toJson(input.education),
          workHistoryJson: toJson(input.workHistory),
          bankName: input.bankName.trim(),
          bankAccountNo: input.bankAccountNo.replace(/[\s-]/g, ""),
          bankAccountName: input.bankAccountName.trim(),
          consentTruthfulAt: consentedAt,
          consentPrivacyReadAt: consentedAt,
          consentEmergencyContactNotifiedAt: consentedAt,
          consentReferenceCheckAt: consentedAt,
          answersJson: toJson({
            ...input.answers,
            submissionDraftId: input.submissionDraftId, // → Drive folder name
            branchText, // what the candidate typed, kept even when branchId resolved
          }),
          status: "SUBMITTED",
          submittedIp,
          submittedUserAgent: userAgent,
        },
      }),
      prisma.recruitOnboardingDocument.createMany({
        data: [...docRows, signatureRow, selfieRow],
      }),
      // WORM table — insert only, never upsert/update (DB trigger blocks it).
      prisma.recruitOnboardingConsent.create({
        data: {
          submissionId,
          signedAt,
          signedIp: submittedIp,
          signedUserAgent: userAgent,
          contractContentHash,
          scrolledToEnd: input.scrolledToEnd, // recorded honestly — a false here
          // is itself evidence HR needs on the review screen, so we do not
          // reject it server-side (the scroll gate is a UI affordance).
          signatureDocId: signatureRow.id,
          selfieDocId: selfieRow.id,
        },
      }),
    ]);
  } catch (e) {
    console.error("[onboarding-submit] transaction failed", e);
    return bad("บันทึกข้อมูลไม่สำเร็จ · กรุณาลองใหม่อีกครั้ง หากยังไม่ได้ กรุณาติดต่อฝ่ายบุคคล", 500);
  }

  // Public submission → no session, so userId is null (same precedent as
  // app/apply/[slug]/submit-action.ts's public application audit).
  await audit({
    orgId: POOILGROUP_ORG_ID,
    userId: null,
    action: "RECRUIT_ONBOARDING_SUBMITTED",
    resourceType: "recruit_onboarding_submission",
    resourceId: submissionId,
    diff: {
      new: {
        companyCode: input.companyCode,
        branch: branchText,
        branchId: branch?.id ?? null,
        position: input.positionApplied.trim(),
        fullNameTh: input.fullNameTh.trim(),
        documents: docRows.length + 2,
        scrolledToEnd: input.scrolledToEnd,
        contractContentHash,
      },
    },
    ipAddress: submittedIp ?? undefined,
    userAgent: userAgent ?? undefined,
  });

  // Short reference the candidate can quote to HR over the phone — HR looks it
  // up by the first 8 chars of the submission id on the review screen.
  return NextResponse.json({
    ok: true,
    submissionId,
    reference: submissionId.slice(0, 8).toUpperCase(),
  });
}
