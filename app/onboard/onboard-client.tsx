"use client";

/* ============================================================================
 * HANDOFF CONTRACT — อ่านตรงนี้ก่อน ถ้าคุณกำลังทำหน้า /onboard/sign
 * ============================================================================
 * เมื่อฟอร์มนี้ผ่าน validation ครบและอัปโหลดเอกสารบังคับครบแล้ว ปุ่มส่งจะ:
 *   1) sessionStorage.setItem("recruit_onboard_handoff_<sessionId>", JSON)
 *   2) sessionStorage.setItem("recruit_onboard_handoff_session", sessionId)
 *   3) router.push(`/onboard/sign?s=<sessionId>`)
 *
 * → หน้า sign ให้หา sessionId จาก query `?s=` ก่อน ถ้าไม่มีให้ fallback ไปอ่าน
 *   pointer key `recruit_onboard_handoff_session` แล้วอ่าน payload จาก
 *   `onboardingHandoffKey(sessionId)` (export ไว้ด้านล่าง — อย่า hardcode prefix ซ้ำ)
 *   ถ้าไม่เจอ payload = ผู้ใช้เปิด /onboard/sign ตรง ๆ หรือรีเฟรชข้ามแท็บ
 *   → ควร redirect กลับ /onboard พร้อมข้อความว่าให้กรอกฟอร์มก่อน
 *
 * ชนิดข้อมูล: `OnboardingHandoffPayload` (export จากไฟล์นี้ — import type ได้เลย
 *   `import type { OnboardingHandoffPayload } from "@/app/onboard/onboard-client"`)
 *
 * {
 *   version: 1,
 *   sessionId: string,          // = submissionDraftId ที่ใช้ตอนอัปโหลดไฟล์ทุกไฟล์
 *   createdAt: string,          // ISO
 *   form: { ...41 ช่อง, ดู OnboardingHandoffForm },
 *   documents: [{ fileId, folderId, docType, fileName, mimeType }, ...]
 * }
 *
 * หมายเหตุสำคัญสำหรับฝั่ง API:
 *  - `companyCode` เป็น "POOIL" | "JPSYNC" (ตรงกับ Company.code — resolve companyId
 *    ที่ server เท่านั้น ห้ามเชื่อ UUID จาก client)
 *  - ช่องที่เป็นตัวเลือก (คำนำหน้า/สถานะทหาร/สถานภาพ/วุฒิ/ความสัมพันธ์) ส่งเป็น
 *    **ข้อความไทยที่ผู้ใช้เห็น** เพราะ schema เก็บเป็น string อยู่แล้ว
 *  - ธนาคารส่งทั้ง `bankCode` (KBANK/SCB/...) และ `bankName` (ชื่อไทย)
 *  - ตัวเลขถูก normalize แล้ว (`salary: number`, `graduationYearBe: number | null`)
 *  - `phone` ทุกช่องเป็นตัวเลขล้วน (ลบ -, เว้นวรรค, +66 ออกแล้ว)
 *  - ยังไม่มี consent ข้อที่ 42 (ยอมรับสัญญาจ้าง) ในนี้ — เป็นของหน้า sign
 * ==========================================================================*/

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Upload,
  X,
  Loader2,
  Check,
  ChevronDown,
  Plus,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import {
  ONBOARDING_ALLOWED_DOC_MIMES,
  ONBOARDING_ALLOWED_DOC_EXTENSIONS,
  ONBOARDING_MAX_FILE_SIZE,
  ONBOARDING_DOC_TYPES,
  ONBOARDING_DOC_TYPE_LABELS_TH,
  ONBOARDING_REQUIRED_DOC_TYPES,
  type OnboardingDocType,
} from "@/lib/recruit/onboarding-types";
import {
  downscaleImageForUpload,
  formatFileSizeMb,
  ONBOARDING_UPLOAD_HARD_CEILING,
} from "@/lib/recruit/onboarding-image";
// นโยบายความเป็นส่วนตัว — ข้อความจริงเป็นเจ้าของโดย lib สัญญา (ไม่ก๊อปมาเขียนซ้ำ
// เพราะถ้าฝ่ายกฎหมายแก้ถ้อยคำ ต้องแก้ที่เดียว)
import { renderPrivacyPolicy } from "@/lib/recruit/onboarding-contract";
// Ladder (RULE I): มีรายชื่อธนาคารไทยพร้อม dropdown อยู่แล้วใน bank-recon
// → ใช้ซ้ำ ไม่สร้างลิสต์ใหม่ (ตัด TRUEMONEY ออกเพราะรับเงินเดือนไม่ได้)
import { BANK_OPTIONS } from "@/lib/ledger/bank-adapters/types";

/* ---------------------------------------------------------------- constants */

const DRAFT_PREFIX = "recruit_onboard_draft_";
const DRAFT_POINTER_KEY = "recruit_onboard_draft_session";
const HANDOFF_PREFIX = "recruit_onboard_handoff_";
/** pointer ใน sessionStorage → sessionId ล่าสุดที่ส่งต่อให้หน้าเซ็นสัญญา */
export const ONBOARDING_HANDOFF_POINTER_KEY = "recruit_onboard_handoff_session";
/** key ของ payload ใน sessionStorage */
export function onboardingHandoffKey(sessionId: string): string {
  return `${HANDOFF_PREFIX}${sessionId}`;
}

/** ดราฟต์เก่ากว่านี้ถือว่าไม่ใช่ของคนที่กำลังยืนอยู่หน้าเครื่อง → ทิ้งเงียบ ๆ */
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

const COMPANY_OPTIONS = [
  { code: "POOIL", name: "บริษัท พีโอออยล์ จำกัด" },
  { code: "JPSYNC", name: "บริษัท เจพีซิงค์ กรุ๊ป จำกัด" },
] as const;
type CompanyCode = (typeof COMPANY_OPTIONS)[number]["code"];

const TITLE_PREFIXES = ["นาย", "นาง", "นางสาว"] as const;
// "ยังไม่ถึงกำหนด" ถูกตัดออกตามที่ CEO สั่ง 2026-09-23 — พนักงานที่ยังไม่ถึง
// เกณฑ์ไม่ควรเลือกตัวเลือกนี้เองในฟอร์มรับเข้าทำงาน
const MILITARY_STATUSES = [
  "ผ่านการเกณฑ์ทหารแล้ว",
  "ได้รับการยกเว้น",
  "เรียน รด. ครบ",
] as const;
const MARITAL_STATUSES = ["โสด", "สมรส", "หย่า", "หม้าย"] as const;
const RELATIONS = ["พ่อ", "แม่", "พี่น้อง", "คู่สมรส", "ญาติ", "อื่นๆ"] as const;
const EDUCATION_LEVELS = [
  "ต่ำกว่า ม.3",
  "ม.3",
  "ม.6",
  "ปวช.",
  "ปวส.",
  "ป.ตรี",
  "สูงกว่า ป.ตรี",
] as const;

// บริษัทจ่ายเงินเดือนผ่าน ttb เท่านั้น (CEO 2026-09-23) — ไม่ให้เลือกธนาคารอื่น
// เพื่อกันกรณีพนักงานกรอกบัญชีธนาคารอื่นแล้วโอนเงินเดือนไม่เข้า
const SALARY_BANK_CODE = "TTB";
const SALARY_BANKS = BANK_OPTIONS.filter((b) => b.code === SALARY_BANK_CODE);

const MAX_WORK_HISTORY = 5;

/** ช่วยผู้ใช้ถ่ายรูปให้ถูก — ข้อความนี้มาจากสเปกของ CEO โดยตรง */
const DOC_HELP: Record<OnboardingDocType, string> = {
  ID_CARD: "แนะนำให้ปิดช่องศาสนาและกรุ๊ปเลือดก่อนถ่าย",
  HOUSE_REGISTRATION: "หน้าที่มีชื่อพนักงาน",
  BANK_BOOK: "ต้องเห็นชื่อและเลขบัญชี",
  PHOTO: "รูปหน้าตรง เห็นหน้าชัด",
  EDUCATION: "ถ้ามี",
  OTHER: "แนบได้หลายไฟล์",
};

const MAX_FILES_PER_DOC: Record<OnboardingDocType, number> = {
  ID_CARD: 2,
  HOUSE_REGISTRATION: 2,
  BANK_BOOK: 1,
  PHOTO: 1,
  EDUCATION: 3,
  OTHER: 5,
};

const UPLOAD_ACCEPT = [
  "image/*",
  ...ONBOARDING_ALLOWED_DOC_EXTENSIONS.map((e) => `.${e}`),
  "application/pdf",
].join(",");

const INPUT_BASE =
  "w-full px-3.5 rounded-xl border border-zinc-300 bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-400)] text-base disabled:bg-zinc-100 aria-[invalid=true]:border-red-400 aria-[invalid=true]:focus:ring-red-300";
const INPUT = `${INPUT_BASE} h-12`;
/** ช่องย่อย (ที่อยู่ / ประวัติงาน) — เตี้ยลงนิดแต่ยังแตะง่าย (RULE L งบพื้นที่) */
const INPUT_SM = `${INPUT_BASE} h-11 text-[15px]`;

/* -------------------------------------------------------------- data shapes */

export interface OnboardingHandoffAddress {
  houseNo: string;
  moo: string;
  road: string;
  subDistrict: string;
  district: string;
  province: string;
  postalCode: string;
}

export interface OnboardingHandoffEmergencyContact {
  fullName: string;
  relation: string;
  phone: string;
}

export interface OnboardingHandoffWorkItem {
  employer: string;
  position: string;
  period: string;
  lastSalary: number | null;
  reasonForLeaving: string;
}

export interface OnboardingHandoffForm {
  companyCode: CompanyCode;
  companyName: string;
  branch: string;
  position: string;
  startDate: string;
  salary: number;

  titlePrefix: string;
  firstName: string;
  lastName: string;
  /** "<คำนำหน้า><ชื่อ> <นามสกุล>" — ประกอบไว้ให้เลย ฝั่ง server ไม่ต้องเดา */
  fullNameTh: string;
  fullNameEn: string;
  nickname: string;
  nationalId: string;
  birthDate: string;
  nationality: string;
  /** "" เมื่อคำนำหน้าไม่ใช่ "นาย" (ไม่เกี่ยวกับการเกณฑ์ทหาร) */
  militaryStatus: string;
  phone: string;
  lineId: string;
  email: string;
  maritalStatus: string;

  registeredAddress: OnboardingHandoffAddress;
  currentAddress: OnboardingHandoffAddress;
  currentAddressSameAsRegistered: boolean;

  emergencyContacts: [
    OnboardingHandoffEmergencyContact,
    OnboardingHandoffEmergencyContact,
  ];

  educationLevel: string;
  institution: string;
  graduationYearBe: number | null;

  hasWorkExperience: boolean;
  workHistory: OnboardingHandoffWorkItem[];
  reference: { name: string; phone: string } | null;
  consentContactReference: boolean;

  bankCode: string;
  bankName: string;
  noBankAccountYet: boolean;
  bankAccountNo: string;
  bankAccountName: string;

  consentTruthful: boolean;
  consentPrivacyRead: boolean;
  consentEmergencyContactNotified: boolean;
}

export interface OnboardingHandoffDoc {
  fileId: string;
  folderId: string;
  docType: OnboardingDocType;
  fileName: string;
  mimeType: string;
}

export interface OnboardingHandoffPayload {
  version: 1;
  sessionId: string;
  createdAt: string;
  form: OnboardingHandoffForm;
  documents: OnboardingHandoffDoc[];
}

/* ------------------------------------------------- internal (editable) state */

interface AddressState {
  houseNo: string;
  moo: string;
  road: string;
  subDistrict: string;
  district: string;
  province: string;
  postalCode: string;
}

interface ContactState {
  fullName: string;
  relation: string;
  relationOther: string;
  phone: string;
}

interface WorkItemState {
  employer: string;
  position: string;
  period: string;
  lastSalary: string;
  reasonForLeaving: string;
}

interface FormState {
  companyCode: CompanyCode | "";
  branch: string;
  position: string;
  startDate: string;
  salary: string;

  titlePrefix: string;
  firstName: string;
  lastName: string;
  fullNameEn: string;
  nickname: string;
  nationalId: string;
  birthDate: string;
  nationality: string;
  militaryStatus: string;
  phone: string;
  lineId: string;
  email: string;
  maritalStatus: string;

  registeredAddress: AddressState;
  currentAddress: AddressState;
  currentSameAsRegistered: boolean;

  contacts: [ContactState, ContactState];

  educationLevel: string;
  institution: string;
  graduationYear: string;

  hasWorkExperience: "" | "yes" | "no";
  workHistory: WorkItemState[];
  referenceName: string;
  referencePhone: string;
  consentContactReference: boolean;

  bankCode: string;
  bankAccountNo: string;
  bankAccountName: string;
  noBankAccountYet: boolean;

  consentTruthful: boolean;
  consentPrivacyRead: boolean;
  consentEmergencyNotified: boolean;
}

const EMPTY_ADDRESS: AddressState = {
  houseNo: "",
  moo: "",
  road: "",
  subDistrict: "",
  district: "",
  province: "",
  postalCode: "",
};

const EMPTY_CONTACT: ContactState = {
  fullName: "",
  relation: "",
  relationOther: "",
  phone: "",
};

const EMPTY_WORK_ITEM: WorkItemState = {
  employer: "",
  position: "",
  period: "",
  lastSalary: "",
  reasonForLeaving: "",
};

function emptyForm(): FormState {
  return {
    companyCode: "",
    branch: "",
    position: "",
    startDate: "",
    salary: "",
    titlePrefix: "",
    firstName: "",
    lastName: "",
    fullNameEn: "",
    nickname: "",
    nationalId: "",
    birthDate: "",
    nationality: "ไทย",
    militaryStatus: "",
    phone: "",
    lineId: "",
    email: "",
    maritalStatus: "",
    registeredAddress: { ...EMPTY_ADDRESS },
    currentAddress: { ...EMPTY_ADDRESS },
    currentSameAsRegistered: false,
    contacts: [{ ...EMPTY_CONTACT }, { ...EMPTY_CONTACT }],
    educationLevel: "",
    institution: "",
    graduationYear: "",
    hasWorkExperience: "",
    workHistory: [{ ...EMPTY_WORK_ITEM }],
    referenceName: "",
    referencePhone: "",
    consentContactReference: false,
    bankCode: SALARY_BANK_CODE,
    noBankAccountYet: false,
    bankAccountNo: "",
    bankAccountName: "",
    consentTruthful: false,
    consentPrivacyRead: false,
    consentEmergencyNotified: false,
  };
}

type DocMap = Record<OnboardingDocType, OnboardingHandoffDoc[]>;

function emptyDocs(): DocMap {
  return {
    ID_CARD: [],
    HOUSE_REGISTRATION: [],
    BANK_BOOK: [],
    PHOTO: [],
    EDUCATION: [],
    OTHER: [],
  };
}

interface DraftEnvelope {
  savedAt: number;
  form: FormState;
  docs: DocMap;
}

/* -------------------------------------------------------------- validation */

/** เลขบัตรประชาชนไทย 13 หลัก + ตรวจ checksum หลักสุดท้าย */
function isValidThaiNationalId(id: string): boolean {
  if (!/^\d{13}$/.test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(id[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(id[12]);
}

function ageFromBirthDate(iso: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age;
}

/** ตัดให้เหลือเลขล้วน + ตัด +66 / 66 นำหน้าเป็น 0 เพื่อเทียบซ้ำได้จริง */
function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("66") && digits.length >= 11) return `0${digits.slice(2)}`;
  return digits;
}

function isValidThaiPhone(raw: string): boolean {
  return /^0\d{8,9}$/.test(normalizePhone(raw));
}

function isValidEmail(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(raw.trim());
}

function addressFilled(a: AddressState): boolean {
  return (
    a.houseNo.trim() !== "" &&
    a.subDistrict.trim() !== "" &&
    a.district.trim() !== "" &&
    a.province.trim() !== "" &&
    /^\d{5}$/.test(a.postalCode.trim())
  );
}

function trimAddress(a: AddressState): OnboardingHandoffAddress {
  return {
    houseNo: a.houseNo.trim(),
    moo: a.moo.trim(),
    road: a.road.trim(),
    subDistrict: a.subDistrict.trim(),
    district: a.district.trim(),
    province: a.province.trim(),
    postalCode: a.postalCode.trim(),
  };
}

function contactRelation(c: ContactState): string {
  return c.relation === "อื่นๆ" ? c.relationOther.trim() || "อื่นๆ" : c.relation;
}

function isUploadedDoc(v: unknown): v is OnboardingHandoffDoc {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.fileId === "string" &&
    typeof o.folderId === "string" &&
    typeof o.fileName === "string" &&
    typeof o.mimeType === "string" &&
    typeof o.docType === "string" &&
    (ONBOARDING_DOC_TYPES as readonly string[]).includes(o.docType)
  );
}

/* ================================================================ component */

export function OnboardClient() {
  const router = useRouter();

  const [sessionId, setSessionId] = useState("");
  const [form, setForm] = useState<FormState>(emptyForm);
  const [docs, setDocs] = useState<DocMap>(emptyDocs);
  const [uploading, setUploading] = useState<Partial<Record<OnboardingDocType, boolean>>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  /** ดราฟต์เก่าที่เจอตอนเปิดหน้า — ต้องให้ผู้ใช้เลือกเอง ห้าม restore เงียบ ๆ */
  const [pendingDraft, setPendingDraft] = useState<
    { sessionId: string; envelope: DraftEnvelope } | null
  >(null);
  const [ready, setReady] = useState(false);
  const honeypotRef = useRef<HTMLInputElement>(null);

  /* ---- boot: สร้าง session id ของตัวเอง + มองหาดราฟต์เก่าแบบถามก่อน -------
     ต้องอยู่ใน effect จริง ๆ: localStorage + crypto.randomUUID() มีเฉพาะฝั่ง
     browser — ถ้าอ่านตอน render แรก SSR กับ client จะได้คนละ tree (hydration
     mismatch) → ใช้ pattern เดียวกับที่โปรเจ็กต์ใช้อยู่ (disable แบบระบุเหตุผล) */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    let previous: { sessionId: string; envelope: DraftEnvelope } | null = null;
    try {
      const prevId = window.localStorage.getItem(DRAFT_POINTER_KEY);
      if (prevId) {
        const raw = window.localStorage.getItem(`${DRAFT_PREFIX}${prevId}`);
        if (raw) {
          const parsed: unknown = JSON.parse(raw);
          if (
            typeof parsed === "object" &&
            parsed !== null &&
            typeof (parsed as DraftEnvelope).savedAt === "number" &&
            typeof (parsed as DraftEnvelope).form === "object"
          ) {
            const envelope = parsed as DraftEnvelope;
            if (Date.now() - envelope.savedAt <= DRAFT_TTL_MS) {
              previous = { sessionId: prevId, envelope };
            } else {
              // เกิน TTL — ของคนก่อนหน้าแน่ ๆ ทิ้งทันที ไม่ถามให้เสียเวลา
              window.localStorage.removeItem(`${DRAFT_PREFIX}${prevId}`);
              window.localStorage.removeItem(DRAFT_POINTER_KEY);
            }
          }
        }
      }
    } catch {
      previous = null;
    }
    setPendingDraft(previous);
    // ลิงก์ไม่มีรหัสรายคน → ถ้า key ดราฟต์เป็นค่าคงที่ คนที่ 2 บนแท็บเล็ต HR
    // เครื่องเดียวกันจะเปิดเจอเลขบัตรของคนที่ 1 → id สุ่มใหม่ทุกครั้งที่เริ่มกรอก
    setSessionId(crypto.randomUUID());
    setReady(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  /* ---- autosave (debounce) ---------------------------------------------- */
  const hasContent = useMemo(() => {
    return (
      form.firstName.trim() !== "" ||
      form.lastName.trim() !== "" ||
      form.nationalId !== "" ||
      form.phone !== "" ||
      form.position.trim() !== ""
    );
  }, [form.firstName, form.lastName, form.nationalId, form.phone, form.position]);

  useEffect(() => {
    if (!ready || !sessionId || pendingDraft || !hasContent) return;
    const t = window.setTimeout(() => {
      try {
        const envelope: DraftEnvelope = { savedAt: Date.now(), form, docs };
        window.localStorage.setItem(
          `${DRAFT_PREFIX}${sessionId}`,
          JSON.stringify(envelope),
        );
        window.localStorage.setItem(DRAFT_POINTER_KEY, sessionId);
        setSavedAt(envelope.savedAt);
      } catch {
        // เครื่องปิด storage / เต็ม — ไม่ต้องขัดจังหวะการกรอก
      }
    }, 600);
    return () => window.clearTimeout(t);
  }, [ready, sessionId, pendingDraft, hasContent, form, docs]);

  const clearDraft = useCallback((id: string) => {
    try {
      window.localStorage.removeItem(`${DRAFT_PREFIX}${id}`);
      const pointer = window.localStorage.getItem(DRAFT_POINTER_KEY);
      if (pointer === id) window.localStorage.removeItem(DRAFT_POINTER_KEY);
    } catch {
      // ignore
    }
  }, []);

  function resumeDraft() {
    if (!pendingDraft) return;
    setForm({ ...emptyForm(), ...pendingDraft.envelope.form });
    setDocs({ ...emptyDocs(), ...pendingDraft.envelope.docs });
    setSessionId(pendingDraft.sessionId);
    setSavedAt(pendingDraft.envelope.savedAt);
    setPendingDraft(null);
  }

  function discardDraft() {
    if (!pendingDraft) return;
    clearDraft(pendingDraft.sessionId);
    setPendingDraft(null);
  }

  /* ---- field setters ----------------------------------------------------- */

  const set = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => (e[key as string] ? { ...e, [key as string]: "" } : e));
  }, []);

  function setAddress(
    which: "registeredAddress" | "currentAddress",
    key: keyof AddressState,
    value: string,
  ) {
    setForm((f) => {
      const next: FormState = { ...f, [which]: { ...f[which], [key]: value } };
      // ติ๊ก "เหมือนทะเบียนบ้าน" ไว้แล้วค่อยแก้ทะเบียนบ้าน → ที่อยู่ปัจจุบันต้องตามไปด้วย
      if (which === "registeredAddress" && f.currentSameAsRegistered) {
        next.currentAddress = { ...next.registeredAddress };
      }
      return next;
    });
    setErrors((e) => (e[which] ? { ...e, [which]: "" } : e));
  }

  function toggleSameAddress(checked: boolean) {
    setForm((f) => ({
      ...f,
      currentSameAsRegistered: checked,
      currentAddress: checked ? { ...f.registeredAddress } : f.currentAddress,
    }));
    setErrors((e) => ({ ...e, currentAddress: "" }));
  }

  function setContact(idx: 0 | 1, key: keyof ContactState, value: string) {
    setForm((f) => {
      const contacts: [ContactState, ContactState] = [
        { ...f.contacts[0] },
        { ...f.contacts[1] },
      ];
      contacts[idx] = { ...contacts[idx], [key]: value };
      return { ...f, contacts };
    });
    setErrors((e) => ({ ...e, [`contact${idx}_${key}`]: "" }));
  }

  function setWorkItem(idx: number, key: keyof WorkItemState, value: string) {
    setForm((f) => {
      const workHistory = f.workHistory.map((w, i) =>
        i === idx ? { ...w, [key]: value } : w,
      );
      return { ...f, workHistory };
    });
  }

  /* ---- uploads ----------------------------------------------------------- */

  async function uploadDoc(docType: OnboardingDocType, originalFile: File) {
    if (
      !(ONBOARDING_ALLOWED_DOC_MIMES as readonly string[]).includes(
        originalFile.type,
      )
    ) {
      toast.error("รองรับเฉพาะรูปภาพ (JPG/PNG/WEBP) หรือ PDF");
      return;
    }
    if (originalFile.size > ONBOARDING_MAX_FILE_SIZE) {
      toast.error(
        `ไฟล์ใหญ่เกิน ${Math.round(ONBOARDING_MAX_FILE_SIZE / 1024 / 1024)} MB (ไฟล์นี้ ${formatFileSizeMb(originalFile.size)})`,
      );
      return;
    }
    if (!sessionId) return;

    setUploading((u) => ({ ...u, [docType]: true }));
    try {
      // Shrink phone-camera photos BEFORE the request — these bytes go through
      // our server on the way to Drive, and the platform rejects oversized
      // bodies before our handler can return a readable Thai error.
      const file = await downscaleImageForUpload(originalFile);
      if (file.size > ONBOARDING_UPLOAD_HARD_CEILING) {
        toast.error(
          `ไฟล์ใหญ่เกินไป (${formatFileSizeMb(file.size)}) · ลองถ่ายใหม่ให้ความละเอียดต่ำลง หรือเลือกไฟล์อื่น`,
        );
        return;
      }
      const fd = new FormData();
      fd.append("file", file);
      fd.append("docType", docType);
      fd.append("submissionDraftId", sessionId);
      const resp = await fetch("/api/recruit/onboarding/upload", {
        method: "POST",
        body: fd,
      });
      const body: unknown = await resp.json().catch(() => null);
      if (!resp.ok) {
        const message =
          typeof body === "object" &&
          body !== null &&
          typeof (body as { error?: unknown }).error === "string"
            ? (body as { error: string }).error
            : "อัปโหลดไม่สำเร็จ · ลองใหม่อีกครั้ง";
        toast.error(message);
        return;
      }
      if (!isUploadedDoc(body)) {
        toast.error("อัปโหลดไม่สำเร็จ · เซิร์ฟเวอร์ตอบกลับไม่ครบ");
        return;
      }
      setDocs((d) => ({ ...d, [docType]: [...d[docType], body] }));
      setErrors((e) => ({ ...e, [`doc_${docType}`]: "" }));
      toast.success(`แนบ${ONBOARDING_DOC_TYPE_LABELS_TH[docType]}แล้ว`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "อัปโหลดไม่สำเร็จ · เช็คสัญญาณเน็ต",
      );
    } finally {
      setUploading((u) => ({ ...u, [docType]: false }));
    }
  }

  function removeDoc(docType: OnboardingDocType, fileId: string) {
    setDocs((d) => ({
      ...d,
      [docType]: d[docType].filter((f) => f.fileId !== fileId),
    }));
  }

  /* ---- live (ตรวจทันทีระหว่างพิมพ์) ------------------------------------- */

  const nationalIdError = useMemo(() => {
    if (form.nationalId === "") return "";
    if (form.nationalId.length < 13) return `ยังไม่ครบ 13 หลัก (${form.nationalId.length}/13)`;
    if (!isValidThaiNationalId(form.nationalId)) return "เลขบัตรไม่ถูกต้อง · ตรวจตัวเลขอีกครั้ง";
    return "";
  }, [form.nationalId]);

  const age = useMemo(() => ageFromBirthDate(form.birthDate), [form.birthDate]);
  const underage = age !== null && age < 18;

  const ownPhone = normalizePhone(form.phone);
  const contact0Phone = normalizePhone(form.contacts[0].phone);
  const contact1Phone = normalizePhone(form.contacts[1].phone);

  const contactPhoneErrors = useMemo<[string, string]>(() => {
    const out: [string, string] = ["", ""];
    const phones = [contact0Phone, contact1Phone];
    phones.forEach((p, i) => {
      if (p === "") return;
      if (!isValidThaiPhone(p)) {
        out[i] = "เบอร์ไม่ถูกต้อง (9-10 หลัก ขึ้นต้น 0)";
      } else if (ownPhone !== "" && p === ownPhone) {
        out[i] = "ห้ามใช้เบอร์ของตัวเอง — ต้องเป็นเบอร์ที่ติดต่อคนอื่นได้จริง";
      }
    });
    if (out[1] === "" && contact1Phone !== "" && contact1Phone === contact0Phone) {
      out[1] = "ซ้ำกับผู้ติดต่อคนที่ 1 — ต้องเป็นคนละเบอร์";
    }
    return out;
  }, [contact0Phone, contact1Phone, ownPhone]);

  const requiresMilitary = form.titlePrefix === "นาย";

  const selectedCompany = COMPANY_OPTIONS.find((c) => c.code === form.companyCode);
  const companyNameForPolicy = selectedCompany?.name ?? "บริษัทในเครือ PO Oil / JP Sync Group";

  const missingRequiredDocs = ONBOARDING_REQUIRED_DOC_TYPES.filter(
    (t) => docs[t].length === 0,
  );

  /* ---- validate + submit -------------------------------------------------- */

  function validate(): boolean {
    const e: Record<string, string> = {};
    const req = (key: keyof FormState & string, label: string) => {
      const v = form[key];
      if (typeof v === "string" && v.trim() === "") e[key] = `กรุณากรอก${label}`;
    };

    // §1
    if (!form.companyCode) e.companyCode = "เลือกบริษัท";
    req("branch", "สาขา");
    req("position", "ตำแหน่ง");
    req("startDate", "วันที่เริ่มงาน");
    if (form.salary.trim() === "" || Number(form.salary) <= 0)
      e.salary = "กรอกค่าแรงต่อวันที่ตกลงไว้";

    // §2
    if (!form.titlePrefix) e.titlePrefix = "เลือกคำนำหน้า";
    req("firstName", "ชื่อ");
    req("lastName", "นามสกุล");
    req("nickname", "ชื่อเล่น");
    if (!isValidThaiNationalId(form.nationalId))
      e.nationalId = form.nationalId === "" ? "กรอกเลขบัตรประชาชน" : "เลขบัตรไม่ถูกต้อง";
    if (form.birthDate === "") e.birthDate = "กรอกวันเกิด";
    else if (age === null) e.birthDate = "วันเกิดไม่ถูกต้อง";
    else if (age < 18) e.birthDate = "อายุไม่ถึง 18 ปี — กรุณาติดต่อฝ่ายบุคคลโดยตรง";
    req("nationality", "สัญชาติ");
    if (requiresMilitary && !form.militaryStatus)
      e.militaryStatus = "เลือกสถานะการเกณฑ์ทหาร";
    if (!isValidThaiPhone(form.phone))
      e.phone = form.phone === "" ? "กรอกเบอร์มือถือ" : "เบอร์ไม่ถูกต้อง (9-10 หลัก ขึ้นต้น 0)";
    if (form.email.trim() !== "" && !isValidEmail(form.email))
      e.email = "อีเมลไม่ถูกต้อง";

    // §3
    if (!addressFilled(form.registeredAddress))
      e.registeredAddress = "กรอกที่อยู่ตามทะเบียนบ้านให้ครบ (บ้านเลขที่ · ตำบล · อำเภอ · จังหวัด · รหัสไปรษณีย์ 5 หลัก)";
    if (!form.currentSameAsRegistered && !addressFilled(form.currentAddress))
      e.currentAddress = "กรอกที่อยู่ปัจจุบันให้ครบ หรือติ๊ก “เหมือนทะเบียนบ้าน”";

    // §4
    ([0, 1] as const).forEach((i) => {
      const c = form.contacts[i];
      if (c.fullName.trim() === "") e[`contact${i}_fullName`] = "กรอกชื่อ-นามสกุล";
      if (c.relation === "") e[`contact${i}_relation`] = "เลือกความสัมพันธ์";
      if (c.phone.trim() === "") e[`contact${i}_phone`] = "กรอกเบอร์โทร";
      else if (contactPhoneErrors[i]) e[`contact${i}_phone`] = contactPhoneErrors[i];
    });

    // §5
    if (!form.educationLevel) e.educationLevel = "เลือกวุฒิการศึกษาสูงสุด";

    // §6
    if (form.hasWorkExperience === "") e.hasWorkExperience = "เลือกว่ามีประสบการณ์ทำงานหรือไม่";
    if (form.referencePhone.trim() !== "" && !isValidThaiPhone(form.referencePhone))
      e.referencePhone = "เบอร์ไม่ถูกต้อง";

    // §7
    // ยังไม่มีบัญชี ttb → เว้นว่างได้ทั้งหมด (HR เปิดบัญชีให้ทีหลัง)
    if (!form.noBankAccountYet) {
      if (!/^\d{9,15}$/.test(form.bankAccountNo.replace(/\D/g, "")))
        e.bankAccountNo = "เลขบัญชีไม่ถูกต้อง (ตัวเลข 9-15 หลัก)";
      req("bankAccountName", "ชื่อบัญชี");
    }

    // §8
    for (const t of ONBOARDING_REQUIRED_DOC_TYPES) {
      if (docs[t].length === 0)
        e[`doc_${t}`] = `แนบ${ONBOARDING_DOC_TYPE_LABELS_TH[t]}`;
    }

    // §9
    if (!form.consentTruthful) e.consentTruthful = "ต้องยืนยันข้อนี้";
    if (!form.consentPrivacyRead) e.consentPrivacyRead = "ต้องยืนยันข้อนี้";
    if (!form.consentEmergencyNotified) e.consentEmergencyNotified = "ต้องยืนยันข้อนี้";

    setErrors(e);
    const keys = Object.keys(e);
    if (keys.length > 0) {
      toast.error(`ยังกรอกไม่ครบ ${keys.length} จุด`);
      const el = document.getElementById(`f-${keys[0]}`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      return false;
    }
    return true;
  }

  function buildPayload(): OnboardingHandoffPayload | null {
    if (!form.companyCode) return null;
    const company = COMPANY_OPTIONS.find((c) => c.code === form.companyCode);
    if (!company) return null;
    const bank = SALARY_BANKS.find((b) => b.code === form.bankCode);

    const registeredAddress = trimAddress(form.registeredAddress);
    const currentAddress = form.currentSameAsRegistered
      ? registeredAddress
      : trimAddress(form.currentAddress);

    const workHistory: OnboardingHandoffWorkItem[] =
      form.hasWorkExperience === "yes"
        ? form.workHistory
            .filter((w) => w.employer.trim() !== "" || w.position.trim() !== "")
            .map((w) => ({
              employer: w.employer.trim(),
              position: w.position.trim(),
              period: w.period.trim(),
              lastSalary:
                w.lastSalary.trim() === "" ? null : Number(w.lastSalary.replace(/[^\d.]/g, "")),
              reasonForLeaving: w.reasonForLeaving.trim(),
            }))
        : [];

    const referenceName = form.referenceName.trim();
    const referencePhone = normalizePhone(form.referencePhone);

    const formOut: OnboardingHandoffForm = {
      companyCode: company.code,
      companyName: company.name,
      branch: form.branch.trim(),
      position: form.position.trim(),
      startDate: form.startDate,
      salary: Number(form.salary),

      titlePrefix: form.titlePrefix,
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      fullNameTh: `${form.titlePrefix}${form.firstName.trim()} ${form.lastName.trim()}`.trim(),
      fullNameEn: form.fullNameEn.trim(),
      nickname: form.nickname.trim(),
      nationalId: form.nationalId,
      birthDate: form.birthDate,
      nationality: form.nationality.trim(),
      militaryStatus: requiresMilitary ? form.militaryStatus : "",
      phone: ownPhone,
      lineId: form.lineId.trim(),
      email: form.email.trim(),
      maritalStatus: form.maritalStatus,

      registeredAddress,
      currentAddress,
      currentAddressSameAsRegistered: form.currentSameAsRegistered,

      emergencyContacts: [
        {
          fullName: form.contacts[0].fullName.trim(),
          relation: contactRelation(form.contacts[0]),
          phone: contact0Phone,
        },
        {
          fullName: form.contacts[1].fullName.trim(),
          relation: contactRelation(form.contacts[1]),
          phone: contact1Phone,
        },
      ],

      educationLevel: form.educationLevel,
      institution: form.institution.trim(),
      graduationYearBe:
        form.graduationYear.trim() === "" ? null : Number(form.graduationYear),

      hasWorkExperience: form.hasWorkExperience === "yes",
      workHistory,
      reference:
        referenceName === "" && referencePhone === ""
          ? null
          : { name: referenceName, phone: referencePhone },
      consentContactReference: form.consentContactReference,

      bankCode: form.bankCode,
      bankName: bank?.label ?? form.bankCode,
      bankAccountNo: form.bankAccountNo.replace(/\D/g, ""),
      bankAccountName: form.bankAccountName.trim(),
      noBankAccountYet: form.noBankAccountYet,

      consentTruthful: form.consentTruthful,
      consentPrivacyRead: form.consentPrivacyRead,
      consentEmergencyContactNotified: form.consentEmergencyNotified,
    };

    return {
      version: 1,
      sessionId,
      createdAt: new Date().toISOString(),
      form: formOut,
      documents: ONBOARDING_DOC_TYPES.flatMap((t) => docs[t]),
    };
  }

  function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (submitting) return;
    if (honeypotRef.current?.value) return; // bot
    if (!validate()) return;
    const payload = buildPayload();
    if (!payload) {
      toast.error("ข้อมูลไม่ครบ · ลองใหม่อีกครั้ง");
      return;
    }
    setSubmitting(true);
    try {
      window.sessionStorage.setItem(
        onboardingHandoffKey(sessionId),
        JSON.stringify(payload),
      );
      window.sessionStorage.setItem(ONBOARDING_HANDOFF_POINTER_KEY, sessionId);
    } catch {
      setSubmitting(false);
      toast.error("บราวเซอร์ไม่ให้บันทึกข้อมูลชั่วคราว · ปิดโหมดไม่ระบุตัวตนแล้วลองใหม่");
      return;
    }
    router.push(`/onboard/sign?s=${encodeURIComponent(sessionId)}`);
  }

  /* ------------------------------------------------------------------ render */

  if (!ready) {
    return (
      <div className="bg-white rounded-3xl border border-zinc-200 shadow-soft p-8 mt-4 flex items-center justify-center gap-2 text-zinc-500">
        <Loader2 className="size-4 animate-spin" />
        <span className="text-sm">กำลังเตรียมแบบฟอร์ม...</span>
      </div>
    );
  }

  if (pendingDraft) {
    const savedDate = new Date(pendingDraft.envelope.savedAt);
    const who =
      `${pendingDraft.envelope.form.firstName ?? ""} ${pendingDraft.envelope.form.lastName ?? ""}`.trim();
    return (
      <div className="bg-white rounded-3xl border border-zinc-200 shadow-soft p-6 sm:p-8 mt-4">
        <h2 className="text-xl font-extrabold text-zinc-900 font-display">
          พบข้อมูลที่กรอกค้างไว้
        </h2>
        <p className="text-sm text-zinc-600 mt-2 leading-relaxed">
          เครื่องนี้มีข้อมูลที่กรอกค้างไว้เมื่อ{" "}
          {savedDate.toLocaleString("th-TH", {
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}
          {who !== "" && <> · ชื่อ “{who}”</>}
        </p>
        <p className="text-xs text-zinc-500 mt-2">
          ถ้าไม่ใช่ข้อมูลของคุณ ให้กด “เริ่มกรอกใหม่” — ระบบจะลบข้อมูลเดิมออกจากเครื่องนี้
        </p>
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={resumeDraft}
            className="h-12 rounded-xl bg-[var(--color-brand-600)] text-white font-bold hover:bg-[var(--color-brand-700)] transition-colors"
          >
            กรอกต่อจากเดิม
          </button>
          <button
            type="button"
            onClick={discardDraft}
            className="h-12 rounded-xl border-2 border-zinc-200 text-zinc-700 font-bold hover:border-zinc-400 transition-colors"
          >
            เริ่มกรอกใหม่
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-4 space-y-4 pb-[env(safe-area-inset-bottom)]"
      noValidate
    >
      <input
        ref={honeypotRef}
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden
        className="absolute left-[-9999px] opacity-0 pointer-events-none"
      />

      {/* §1 ---------------------------------------------------------------- */}
      <SectionCard index={1} title="ตำแหน่งที่รับเข้าทำงาน">
        <FieldShell id="companyCode" label="บริษัท" required group error={errors.companyCode}>
          <PillGroup
            options={COMPANY_OPTIONS.map((c) => ({ value: c.code, label: c.name }))}
            value={form.companyCode}
            onChange={(v) => set("companyCode", v as CompanyCode)}
            columns={1}
          />
        </FieldShell>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FieldShell id="branch" label="สาขา" required error={errors.branch}>
            <input
              className={INPUT}
              value={form.branch}
              onChange={(e) => set("branch", e.target.value)}
              placeholder="เช่น สาขาสำนักงานใหญ่"
              maxLength={120}
              aria-invalid={!!errors.branch}
            />
          </FieldShell>
          <FieldShell id="position" label="ตำแหน่ง" required error={errors.position}>
            <input
              className={INPUT}
              value={form.position}
              onChange={(e) => set("position", e.target.value)}
              placeholder="เช่น พนักงานหน้าลาน"
              maxLength={120}
              aria-invalid={!!errors.position}
            />
          </FieldShell>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FieldShell id="startDate" label="วันที่เริ่มงาน" required error={errors.startDate}>
            <input
              type="date"
              className={INPUT}
              value={form.startDate}
              onChange={(e) => set("startDate", e.target.value)}
              aria-invalid={!!errors.startDate}
            />
          </FieldShell>
          <FieldShell
            id="salary"
            label="ค่าแรงต่อวัน ที่ตกลงไว้ (บาท/วัน)"
            required
            help="HR จะตรวจสอบอีกครั้ง"
            error={errors.salary}
          >
            <input
              type="text"
              inputMode="numeric"
              className={`${INPUT} tabular-nums`}
              value={form.salary}
              onChange={(e) => set("salary", e.target.value.replace(/[^\d]/g, ""))}
              placeholder="เช่น 15000"
              maxLength={8}
              aria-invalid={!!errors.salary}
            />
          </FieldShell>
        </div>
      </SectionCard>

      {/* §2 ---------------------------------------------------------------- */}
      <SectionCard index={2} title="ข้อมูลส่วนตัว">
        <FieldShell id="titlePrefix" label="คำนำหน้า" required group error={errors.titlePrefix}>
          <PillGroup
            options={TITLE_PREFIXES.map((t) => ({ value: t, label: t }))}
            value={form.titlePrefix}
            onChange={(v) => {
              set("titlePrefix", v);
              if (v !== "นาย") set("militaryStatus", "");
            }}
            columns={3}
          />
        </FieldShell>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FieldShell id="firstName" label="ชื่อ" required error={errors.firstName}>
            <input
              className={INPUT}
              value={form.firstName}
              onChange={(e) => set("firstName", e.target.value)}
              autoComplete="given-name"
              maxLength={80}
              aria-invalid={!!errors.firstName}
            />
          </FieldShell>
          <FieldShell id="lastName" label="นามสกุล" required error={errors.lastName}>
            <input
              className={INPUT}
              value={form.lastName}
              onChange={(e) => set("lastName", e.target.value)}
              autoComplete="family-name"
              maxLength={80}
              aria-invalid={!!errors.lastName}
            />
          </FieldShell>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FieldShell id="fullNameEn" label="ชื่อ-นามสกุล ภาษาอังกฤษ">
            <input
              className={INPUT}
              value={form.fullNameEn}
              onChange={(e) => set("fullNameEn", e.target.value)}
              placeholder="Somchai Jaidee"
              maxLength={160}
            />
          </FieldShell>
          <FieldShell id="nickname" label="ชื่อเล่น" required error={errors.nickname}>
            <input
              className={INPUT}
              value={form.nickname}
              onChange={(e) => set("nickname", e.target.value)}
              maxLength={40}
              aria-invalid={!!errors.nickname}
            />
          </FieldShell>
        </div>
        <FieldShell
          id="nationalId"
          label="เลขบัตรประชาชน (13 หลัก)"
          required
          error={errors.nationalId || nationalIdError}
          okMessage={
            form.nationalId.length === 13 && !nationalIdError ? "เลขบัตรถูกต้อง" : undefined
          }
        >
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            className={`${INPUT} tabular-nums tracking-[0.12em]`}
            value={form.nationalId}
            onChange={(e) => set("nationalId", e.target.value.replace(/\D/g, "").slice(0, 13))}
            placeholder="1234567890123"
            maxLength={13}
            aria-invalid={!!(errors.nationalId || nationalIdError)}
          />
        </FieldShell>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FieldShell
            id="birthDate"
            label="วันเกิด"
            required
            error={errors.birthDate}
            okMessage={age !== null && age >= 18 ? `อายุ ${age} ปี` : undefined}
          >
            <input
              type="date"
              className={INPUT}
              value={form.birthDate}
              onChange={(e) => set("birthDate", e.target.value)}
              aria-invalid={!!errors.birthDate || underage}
            />
          </FieldShell>
          <FieldShell id="nationality" label="สัญชาติ" required error={errors.nationality}>
            <input
              className={INPUT}
              value={form.nationality}
              onChange={(e) => set("nationality", e.target.value)}
              maxLength={40}
              aria-invalid={!!errors.nationality}
            />
          </FieldShell>
        </div>
        {underage && (
          <div
            role="alert"
            className="rounded-xl border border-red-300 bg-red-50 p-3 flex gap-2.5 text-[13px] text-red-900 leading-relaxed"
          >
            <AlertTriangle className="size-4 shrink-0 mt-0.5" aria-hidden />
            <span>
              อายุ {age} ปี — ยังไม่ถึง 18 ปีบริบูรณ์ จึงยังกรอกแบบฟอร์มนี้ไม่ได้
              <strong> กรุณาติดต่อฝ่ายบุคคลโดยตรง</strong> เพื่อดำเนินการตามขั้นตอนสำหรับผู้เยาว์
            </span>
          </div>
        )}
        {requiresMilitary && (
          <FieldShell
            id="militaryStatus"
            label="สถานะการเกณฑ์ทหาร"
            required
            group
            error={errors.militaryStatus}
          >
            <PillGroup
              options={MILITARY_STATUSES.map((m) => ({ value: m, label: m }))}
              value={form.militaryStatus}
              onChange={(v) => set("militaryStatus", v)}
              columns={2}
            />
          </FieldShell>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FieldShell id="phone" label="เบอร์มือถือ" required error={errors.phone}>
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              className={`${INPUT} tabular-nums`}
              value={form.phone}
              onChange={(e) => set("phone", e.target.value.replace(/[^\d]/g, "").slice(0, 10))}
              placeholder="0812345678"
              maxLength={10}
              aria-invalid={!!errors.phone}
            />
          </FieldShell>
          <FieldShell id="lineId" label="LINE ID">
            <input
              className={INPUT}
              value={form.lineId}
              onChange={(e) => set("lineId", e.target.value)}
              maxLength={60}
              autoCapitalize="none"
            />
          </FieldShell>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FieldShell id="email" label="อีเมล" error={errors.email}>
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              className={INPUT}
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              placeholder="email@example.com"
              maxLength={160}
              aria-invalid={!!errors.email}
            />
          </FieldShell>
          <FieldShell id="maritalStatus" label="สถานภาพ" group>
            <PillGroup
              options={MARITAL_STATUSES.map((m) => ({ value: m, label: m }))}
              value={form.maritalStatus}
              onChange={(v) => set("maritalStatus", form.maritalStatus === v ? "" : v)}
              columns={4}
            />
          </FieldShell>
        </div>
      </SectionCard>

      {/* §3 ---------------------------------------------------------------- */}
      <SectionCard index={3} title="ที่อยู่">
        <FieldShell
          id="registeredAddress"
          label="ที่อยู่ตามทะเบียนบ้าน"
          required
          group
          error={errors.registeredAddress}
        >
          <AddressFields
            value={form.registeredAddress}
            onChange={(k, v) => setAddress("registeredAddress", k, v)}
            namePrefix="reg"
          />
        </FieldShell>

        <div className="pt-1">
          <label className="flex items-center gap-2.5 text-sm font-medium text-zinc-800 cursor-pointer">
            <input
              type="checkbox"
              checked={form.currentSameAsRegistered}
              onChange={(e) => toggleSameAddress(e.target.checked)}
              className="size-4 accent-[var(--color-brand-600)]"
            />
            ที่อยู่ปัจจุบันเหมือนทะเบียนบ้าน
          </label>
        </div>

        {!form.currentSameAsRegistered && (
          <FieldShell
            id="currentAddress"
            label="ที่อยู่ปัจจุบัน"
            required
            group
            error={errors.currentAddress}
          >
            <AddressFields
              value={form.currentAddress}
              onChange={(k, v) => setAddress("currentAddress", k, v)}
              namePrefix="cur"
            />
          </FieldShell>
        )}
      </SectionCard>

      {/* §4 ---------------------------------------------------------------- */}
      <SectionCard
        index={4}
        title="ผู้ติดต่อกรณีฉุกเฉิน"
        subtitle="ต้องเป็นคนละคนและคนละเบอร์ · ใช้ติดต่อเมื่อเกิดเหตุฉุกเฉินเท่านั้น"
      >
        {([0, 1] as const).map((i) => (
          <div
            key={i}
            className="rounded-2xl border border-zinc-200 bg-zinc-50/60 p-3 space-y-3"
          >
            <p className="text-xs font-bold text-zinc-500">คนที่ {i + 1}</p>
            <FieldShell
              id={`contact${i}_fullName`}
              label="ชื่อ-นามสกุล"
              required
              error={errors[`contact${i}_fullName`]}
            >
              <input
                className={INPUT_SM}
                value={form.contacts[i].fullName}
                onChange={(e) => setContact(i, "fullName", e.target.value)}
                maxLength={120}
                aria-invalid={!!errors[`contact${i}_fullName`]}
              />
            </FieldShell>
            <FieldShell
              id={`contact${i}_relation`}
              label="ความสัมพันธ์"
              required
              group
              error={errors[`contact${i}_relation`]}
            >
              <PillGroup
                options={RELATIONS.map((r) => ({ value: r, label: r }))}
                value={form.contacts[i].relation}
                onChange={(v) => setContact(i, "relation", v)}
                columns={3}
              />
            </FieldShell>
            {form.contacts[i].relation === "อื่นๆ" && (
              <input
                className={INPUT_SM}
                value={form.contacts[i].relationOther}
                onChange={(e) => setContact(i, "relationOther", e.target.value)}
                placeholder="ระบุความสัมพันธ์"
                maxLength={40}
              />
            )}
            <FieldShell
              id={`contact${i}_phone`}
              label="เบอร์โทร"
              required
              error={errors[`contact${i}_phone`] || contactPhoneErrors[i]}
            >
              <input
                type="tel"
                inputMode="tel"
                className={`${INPUT_SM} tabular-nums`}
                value={form.contacts[i].phone}
                onChange={(e) =>
                  setContact(i, "phone", e.target.value.replace(/[^\d]/g, "").slice(0, 10))
                }
                placeholder="0812345678"
                maxLength={10}
                aria-invalid={!!(errors[`contact${i}_phone`] || contactPhoneErrors[i])}
              />
            </FieldShell>
          </div>
        ))}
      </SectionCard>

      {/* §5 ---------------------------------------------------------------- */}
      <SectionCard index={5} title="การศึกษา">
        <FieldShell
          id="educationLevel"
          label="วุฒิการศึกษาสูงสุด"
          required
          group
          error={errors.educationLevel}
        >
          <PillGroup
            options={EDUCATION_LEVELS.map((l) => ({ value: l, label: l }))}
            value={form.educationLevel}
            onChange={(v) => set("educationLevel", v)}
            columns={3}
          />
        </FieldShell>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FieldShell id="institution" label="สถาบันการศึกษา">
            <input
              className={INPUT}
              value={form.institution}
              onChange={(e) => set("institution", e.target.value)}
              maxLength={160}
            />
          </FieldShell>
          <FieldShell id="graduationYear" label="ปีที่จบ (พ.ศ.)">
            <input
              type="text"
              inputMode="numeric"
              className={`${INPUT} tabular-nums`}
              value={form.graduationYear}
              onChange={(e) =>
                set("graduationYear", e.target.value.replace(/\D/g, "").slice(0, 4))
              }
              placeholder="2566"
              maxLength={4}
            />
          </FieldShell>
        </div>
      </SectionCard>

      {/* §6 ---------------------------------------------------------------- */}
      <SectionCard index={6} title="ประวัติการทำงาน">
        <FieldShell
          id="hasWorkExperience"
          label="มีประสบการณ์ทำงานหรือไม่"
          required
          group
          error={errors.hasWorkExperience}
        >
          <PillGroup
            options={[
              { value: "yes", label: "มี" },
              { value: "no", label: "ไม่มี" },
            ]}
            value={form.hasWorkExperience}
            onChange={(v) => set("hasWorkExperience", v === "yes" ? "yes" : "no")}
            columns={2}
          />
        </FieldShell>

        {form.hasWorkExperience === "yes" && (
          <div className="space-y-3">
            {form.workHistory.map((w, idx) => (
              <div
                key={idx}
                className="rounded-2xl border border-zinc-200 bg-zinc-50/60 p-3 space-y-2.5"
              >
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-zinc-500">ที่ทำงานที่ {idx + 1}</p>
                  {form.workHistory.length > 1 && (
                    <button
                      type="button"
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          workHistory: f.workHistory.filter((_, i) => i !== idx),
                        }))
                      }
                      className="text-zinc-400 hover:text-red-600 p-1"
                      aria-label={`ลบที่ทำงานที่ ${idx + 1}`}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <input
                    className={INPUT_SM}
                    value={w.employer}
                    onChange={(e) => setWorkItem(idx, "employer", e.target.value)}
                    placeholder="ชื่อที่ทำงาน"
                    maxLength={160}
                    aria-label="ชื่อที่ทำงาน"
                  />
                  <input
                    className={INPUT_SM}
                    value={w.position}
                    onChange={(e) => setWorkItem(idx, "position", e.target.value)}
                    placeholder="ตำแหน่ง"
                    maxLength={120}
                    aria-label="ตำแหน่ง"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <input
                    className={INPUT_SM}
                    value={w.period}
                    onChange={(e) => setWorkItem(idx, "period", e.target.value)}
                    placeholder="ช่วงเวลา เช่น 01/2565 - 08/2567"
                    maxLength={60}
                    aria-label="ช่วงเวลาที่ทำงาน"
                  />
                  <input
                    type="text"
                    inputMode="numeric"
                    className={`${INPUT_SM} tabular-nums`}
                    value={w.lastSalary}
                    onChange={(e) =>
                      setWorkItem(idx, "lastSalary", e.target.value.replace(/[^\d]/g, ""))
                    }
                    placeholder="เงินเดือนล่าสุด (บาท)"
                    maxLength={8}
                    aria-label="เงินเดือนล่าสุด"
                  />
                </div>
                <input
                  className={INPUT_SM}
                  value={w.reasonForLeaving}
                  onChange={(e) => setWorkItem(idx, "reasonForLeaving", e.target.value)}
                  placeholder="เหตุผลที่ออก"
                  maxLength={200}
                  aria-label="เหตุผลที่ออก"
                />
              </div>
            ))}
            {form.workHistory.length < MAX_WORK_HISTORY && (
              <button
                type="button"
                onClick={() =>
                  setForm((f) => ({
                    ...f,
                    workHistory: [...f.workHistory, { ...EMPTY_WORK_ITEM }],
                  }))
                }
                className="w-full h-11 rounded-xl border-2 border-dashed border-zinc-300 text-sm font-bold text-zinc-600 hover:border-[var(--color-brand-400)] hover:text-[var(--color-brand-700)] transition-colors inline-flex items-center justify-center gap-1.5"
              >
                <Plus className="size-4" />
                เพิ่มที่ทำงาน
              </button>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FieldShell id="referenceName" label="บุคคลอ้างอิง — ชื่อ">
            <input
              className={INPUT}
              value={form.referenceName}
              onChange={(e) => set("referenceName", e.target.value)}
              maxLength={120}
            />
          </FieldShell>
          <FieldShell
            id="referencePhone"
            label="บุคคลอ้างอิง — เบอร์โทร"
            error={errors.referencePhone}
          >
            <input
              type="tel"
              inputMode="tel"
              className={`${INPUT} tabular-nums`}
              value={form.referencePhone}
              onChange={(e) =>
                set("referencePhone", e.target.value.replace(/[^\d]/g, "").slice(0, 10))
              }
              placeholder="0812345678"
              maxLength={10}
              aria-invalid={!!errors.referencePhone}
            />
          </FieldShell>
        </div>
        <CheckboxRow
          id="consentContactReference"
          checked={form.consentContactReference}
          onChange={(v) => set("consentContactReference", v)}
          label="ยินยอมให้บริษัทติดต่อสอบถามบุคคลอ้างอิง"
        />
      </SectionCard>

      {/* §7 ---------------------------------------------------------------- */}
      <SectionCard
        index={7}
        title="บัญชีรับเงินเดือน"
        subtitle="ชื่อบัญชีต้องตรงกับชื่อพนักงาน ไม่รับบัญชีของคนอื่น"
      >
        <FieldShell id="bankCode" label="ธนาคาร" required error={errors.bankCode}>
          {/* บริษัทจ่ายผ่าน ttb เท่านั้น — แสดงเป็นข้อความคงที่ ไม่ใช่ dropdown
              ที่มีตัวเลือกเดียว (กดแล้วไม่มีอะไรให้เลือก = สับสนเปล่า ๆ) */}
          <div className={`${INPUT} flex items-center bg-zinc-50 text-zinc-700`}>
            {SALARY_BANKS[0]?.label ?? "ทหารไทยธนชาต"} (ttb)
          </div>
        </FieldShell>

        <label className="flex items-start gap-2.5 mt-1 cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5 size-[18px] accent-[var(--color-brand-600)] shrink-0"
            checked={form.noBankAccountYet}
            onChange={(e) => {
              const on = e.target.checked;
              setForm((f) => ({
                ...f,
                noBankAccountYet: on,
                // ติ๊กแล้วล้างช่องที่กรอกค้างไว้ ไม่ให้เลขบัญชีเก่าหลุดไปกับฟอร์ม
                bankAccountNo: on ? "" : f.bankAccountNo,
                bankAccountName: on ? "" : f.bankAccountName,
              }));
              setErrors((prev) => ({ ...prev, bankAccountNo: "", bankAccountName: "" }));
            }}
          />
          <span className="text-[13px] text-zinc-700 leading-snug">
            ยังไม่ได้เปิดบัญชี ttb — เว้นช่องด้านล่างไว้ก่อน แล้ว HR จะดำเนินการให้
          </span>
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FieldShell
            id="bankAccountNo"
            label="เลขบัญชี"
            required
            error={errors.bankAccountNo}
          >
            <input
              type="text"
              inputMode="numeric"
              className={`${INPUT} tabular-nums`}
              value={form.bankAccountNo}
              onChange={(e) =>
                set("bankAccountNo", e.target.value.replace(/[^\d]/g, "").slice(0, 15))
              }
              placeholder="เลขบัญชีไม่ต้องใส่ขีด"
              maxLength={15}
              aria-invalid={!!errors.bankAccountNo}
            />
          </FieldShell>
          <FieldShell
            id="bankAccountName"
            label="ชื่อบัญชี"
            required
            error={errors.bankAccountName}
          >
            <input
              className={INPUT}
              value={form.bankAccountName}
              onChange={(e) => set("bankAccountName", e.target.value)}
              maxLength={160}
              aria-invalid={!!errors.bankAccountName}
            />
          </FieldShell>
        </div>
      </SectionCard>

      {/* §8 ---------------------------------------------------------------- */}
      <SectionCard
        index={8}
        title="เอกสารแนบ"
        subtitle={`รูปถ่ายจากมือถือได้เลย · ไฟล์ละไม่เกิน ${Math.round(ONBOARDING_MAX_FILE_SIZE / 1024 / 1024)} MB`}
      >
        <div className="grid grid-cols-2 gap-2.5">
          {ONBOARDING_DOC_TYPES.map((t) => (
            <UploadTile
              key={t}
              docType={t}
              required={ONBOARDING_REQUIRED_DOC_TYPES.includes(t)}
              files={docs[t]}
              maxFiles={MAX_FILES_PER_DOC[t]}
              busy={!!uploading[t]}
              error={errors[`doc_${t}`]}
              onPick={(file) => void uploadDoc(t, file)}
              onRemove={(fileId) => removeDoc(t, fileId)}
            />
          ))}
        </div>
      </SectionCard>

      {/* §9 ---------------------------------------------------------------- */}
      <SectionCard index={9} title="การยินยอม">
        <CheckboxRow
          id="consentTruthful"
          checked={form.consentTruthful}
          onChange={(v) => set("consentTruthful", v)}
          error={errors.consentTruthful}
          required
          label="ข้าพเจ้ายืนยันว่าข้อมูลทั้งหมดเป็นความจริง หากเป็นเท็จ บริษัทมีสิทธิ์เลิกจ้าง"
        />
        <div>
          <CheckboxRow
            id="consentPrivacyRead"
            checked={form.consentPrivacyRead}
            onChange={(v) => set("consentPrivacyRead", v)}
            error={errors.consentPrivacyRead}
            required
            label="ข้าพเจ้าได้อ่านนโยบายความเป็นส่วนตัวแล้ว"
          />
          <button
            type="button"
            onClick={() => setPolicyOpen((o) => !o)}
            className="mt-1.5 ml-7 text-xs font-bold text-[var(--color-brand-700)] underline underline-offset-2 inline-flex items-center gap-1"
            aria-expanded={policyOpen}
          >
            {policyOpen ? "ซ่อนนโยบายความเป็นส่วนตัว" : "อ่านนโยบายความเป็นส่วนตัว"}
            <ChevronDown
              className={`size-3 transition-transform ${policyOpen ? "rotate-180" : ""}`}
              aria-hidden
            />
          </button>
          {policyOpen && (
            <div className="mt-2 ml-7 max-h-64 overflow-y-auto rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-[12px] leading-relaxed text-zinc-700 whitespace-pre-wrap">
              {renderPrivacyPolicy(companyNameForPolicy)}
            </div>
          )}
        </div>
        <CheckboxRow
          id="consentEmergencyNotified"
          checked={form.consentEmergencyNotified}
          onChange={(v) => set("consentEmergencyNotified", v)}
          error={errors.consentEmergencyNotified}
          required
          label="ข้าพเจ้าได้แจ้งผู้ติดต่อฉุกเฉินแล้วว่าให้ข้อมูลของเขาแก่บริษัท"
        />
      </SectionCard>

      {/* SUBMIT ------------------------------------------------------------- */}
      <div className="pt-1">
        <button
          type="submit"
          disabled={submitting || underage}
          style={{ scrollMarginBottom: "100px" }}
          className="w-full h-14 rounded-2xl bg-[var(--color-brand-600)] text-white font-extrabold text-base hover:bg-[var(--color-brand-700)] disabled:opacity-40 transition-all flex items-center justify-center gap-2 shadow-[0_6px_16px_rgba(30,58,255,0.25)] disabled:shadow-none"
        >
          {submitting ? (
            <>
              <Loader2 className="size-5 animate-spin" />
              กำลังไปหน้าเซ็นสัญญา...
            </>
          ) : underage ? (
            "อายุไม่ถึง 18 ปี — ติดต่อฝ่ายบุคคล"
          ) : (
            <>
              ถัดไป · อ่านและเซ็นสัญญาจ้าง
              <span aria-hidden>→</span>
            </>
          )}
        </button>
        {missingRequiredDocs.length > 0 && (
          <p className="text-xs text-zinc-500 text-center mt-2">
            ยังขาดเอกสาร: {missingRequiredDocs.map((t) => ONBOARDING_DOC_TYPE_LABELS_TH[t]).join(" · ")}
          </p>
        )}
        <div className="mt-2 flex items-center justify-center gap-2 text-xs text-zinc-500">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
            {savedAt
              ? `บันทึกอัตโนมัติแล้ว ${new Date(savedAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}`
              : "บันทึกอัตโนมัติในเครื่องนี้"}
          </span>
          <span aria-hidden>·</span>
          <button
            type="button"
            onClick={() => {
              clearDraft(sessionId);
              setForm(emptyForm());
              setDocs(emptyDocs());
              setErrors({});
              setSavedAt(null);
              setSessionId(crypto.randomUUID());
              toast.success("ล้างข้อมูลในเครื่องนี้แล้ว");
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            className="underline underline-offset-2 hover:text-zinc-700"
          >
            ล้างข้อมูลในเครื่องนี้
          </button>
        </div>
      </div>
    </form>
  );
}

/* ================================================================== pieces */

function SectionCard({
  index,
  title,
  subtitle,
  children,
}: {
  index: number;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white rounded-3xl border border-zinc-200 shadow-soft p-4 sm:p-6">
      <p className="flex items-center gap-2 text-sm font-bold text-[var(--color-brand-700)]">
        <span className="size-2 rounded-full bg-[var(--color-brand-500)]" />
        <span className="text-zinc-400 tabular-nums text-xs">
          {String(index).padStart(2, "0")}
        </span>
        {title}
      </p>
      {subtitle && <p className="text-xs text-zinc-500 mt-1 ml-4">{subtitle}</p>}
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

/**
 * กรอบหนึ่งช่องกรอก + ป้ายชื่อ + ข้อความ error/ผ่าน
 *
 * `group` = true เมื่อข้างในเป็น "กลุ่มตัวควบคุม" (ปุ่ม pill / ที่อยู่หลายช่อง)
 * ห้ามใช้ <label> ครอบ เพราะ <button> เป็น labelable element → แตะที่ข้อความ
 * ป้ายชื่อจะไปกดปุ่มตัวแรกให้เอง (เช่น แตะคำว่า "คำนำหน้า" แล้วติด "นาย" เอง)
 * → กลุ่มใช้ role="group" + aria-labelledby แทน
 */
function FieldShell({
  id,
  label,
  required,
  help,
  error,
  okMessage,
  group,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  help?: string;
  error?: string;
  okMessage?: string;
  group?: boolean;
  children: React.ReactNode;
}) {
  const body = (
    <>
      <span id={`lbl-${id}`} className="text-sm font-medium text-zinc-800 block">
        {label}
        {required && (
          <>
            <span className="text-red-500 ml-0.5" aria-hidden>
              *
            </span>
            <span className="sr-only">(จำเป็นต้องกรอก)</span>
          </>
        )}
      </span>
      {help && <span className="block text-xs text-zinc-500 mt-0.5">{help}</span>}
      <div className="mt-1.5">{children}</div>
      {error ? (
        <p role="alert" className="text-xs text-red-600 mt-1">
          {error}
        </p>
      ) : okMessage ? (
        <p className="text-xs text-emerald-600 mt-1 inline-flex items-center gap-1">
          <Check className="size-3" aria-hidden />
          {okMessage}
        </p>
      ) : null}
    </>
  );

  if (group) {
    return (
      <div id={`f-${id}`} role="group" aria-labelledby={`lbl-${id}`}>
        {body}
      </div>
    );
  }
  return (
    <label id={`f-${id}`} className="block">
      {body}
    </label>
  );
}

/** ตัวเลือก 2-6 ทาง = ปุ่ม pill สูง 42-44px (RULE L: ไม่ใช้การ์ด radio เปลืองที่) */
function PillGroup({
  options,
  value,
  onChange,
  columns,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  columns: 1 | 2 | 3 | 4;
}) {
  const gridClass =
    columns === 1
      ? "grid-cols-1"
      : columns === 2
        ? "grid-cols-2"
        : columns === 3
          ? "grid-cols-3"
          : "grid-cols-4";
  return (
    <div className={`grid ${gridClass} gap-2`}>
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            className={`min-h-11 px-2 py-2 rounded-xl border-2 text-sm font-bold transition-colors leading-tight ${
              active
                ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)] text-[var(--color-brand-800)]"
                : "border-zinc-200 text-zinc-700 hover:border-zinc-400"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function AddressFields({
  value,
  onChange,
  namePrefix,
}: {
  value: AddressState;
  onChange: (key: keyof AddressState, v: string) => void;
  namePrefix: string;
}) {
  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-3 gap-2.5">
        <input
          className={INPUT_SM}
          value={value.houseNo}
          onChange={(e) => onChange("houseNo", e.target.value)}
          placeholder="บ้านเลขที่"
          maxLength={40}
          aria-label="บ้านเลขที่"
          name={`${namePrefix}-house`}
        />
        <input
          className={INPUT_SM}
          value={value.moo}
          onChange={(e) => onChange("moo", e.target.value)}
          placeholder="หมู่"
          maxLength={20}
          aria-label="หมู่"
          name={`${namePrefix}-moo`}
        />
        <input
          className={INPUT_SM}
          value={value.road}
          onChange={(e) => onChange("road", e.target.value)}
          placeholder="ถนน"
          maxLength={80}
          aria-label="ถนน"
          name={`${namePrefix}-road`}
        />
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <input
          className={INPUT_SM}
          value={value.subDistrict}
          onChange={(e) => onChange("subDistrict", e.target.value)}
          placeholder="ตำบล/แขวง"
          maxLength={80}
          aria-label="ตำบลหรือแขวง"
          name={`${namePrefix}-subdistrict`}
        />
        <input
          className={INPUT_SM}
          value={value.district}
          onChange={(e) => onChange("district", e.target.value)}
          placeholder="อำเภอ/เขต"
          maxLength={80}
          aria-label="อำเภอหรือเขต"
          name={`${namePrefix}-district`}
        />
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <input
          className={INPUT_SM}
          value={value.province}
          onChange={(e) => onChange("province", e.target.value)}
          placeholder="จังหวัด"
          maxLength={80}
          aria-label="จังหวัด"
          name={`${namePrefix}-province`}
        />
        <input
          type="text"
          inputMode="numeric"
          className={`${INPUT_SM} tabular-nums`}
          value={value.postalCode}
          onChange={(e) => onChange("postalCode", e.target.value.replace(/\D/g, "").slice(0, 5))}
          placeholder="รหัสไปรษณีย์"
          maxLength={5}
          aria-label="รหัสไปรษณีย์"
          name={`${namePrefix}-postal`}
        />
      </div>
    </div>
  );
}

function CheckboxRow({
  id,
  checked,
  onChange,
  label,
  required,
  error,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  required?: boolean;
  error?: string;
}) {
  return (
    <div id={`f-${id}`}>
      <label
        className={`flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-colors ${
          error
            ? "border-red-300 bg-red-50/50"
            : checked
              ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)]"
              : "border-zinc-200 hover:border-zinc-400"
        }`}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-[var(--color-brand-600)]"
          aria-invalid={!!error}
        />
        <span className="text-[13px] text-zinc-800 leading-relaxed">
          {label}
          {required && (
            <span className="text-red-500 ml-0.5" aria-hidden>
              *
            </span>
          )}
        </span>
      </label>
      {error && (
        <p role="alert" className="text-xs text-red-600 mt-1">
          {error}
        </p>
      )}
    </div>
  );
}

/** ช่องแนบเอกสารแบบไทล์ — 6 ประเภทเรียงเป็นกริด 2 คอลัมน์ ไม่ใช่ dropzone เต็มจอ 6 อัน */
function UploadTile({
  docType,
  required,
  files,
  maxFiles,
  busy,
  error,
  onPick,
  onRemove,
}: {
  docType: OnboardingDocType;
  required: boolean;
  files: OnboardingHandoffDoc[];
  maxFiles: number;
  busy: boolean;
  error?: string;
  onPick: (file: File) => void;
  onRemove: (fileId: string) => void;
}) {
  const full = files.length >= maxFiles;
  const done = files.length > 0;
  return (
    <div id={`f-doc_${docType}`} className="flex flex-col">
      <label
        className={`relative flex flex-col items-center justify-center text-center gap-1 rounded-2xl border-2 border-dashed p-2.5 min-h-[92px] transition-colors ${
          full ? "cursor-default" : "cursor-pointer"
        } ${
          error
            ? "border-red-300 bg-red-50/50"
            : done
              ? "border-emerald-300 bg-emerald-50/50"
              : "border-zinc-300 hover:border-[var(--color-brand-400)] hover:bg-[var(--color-brand-50)]/40"
        }`}
      >
        <input
          type="file"
          accept={UPLOAD_ACCEPT}
          disabled={busy || full}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onPick(file);
            e.target.value = "";
          }}
          className="hidden"
        />
        {busy ? (
          <Loader2 className="size-5 text-[var(--color-brand-600)] animate-spin" aria-hidden />
        ) : done ? (
          <Check className="size-5 text-emerald-600" aria-hidden />
        ) : (
          <Upload className="size-5 text-zinc-400" aria-hidden />
        )}
        <span className="text-[13px] font-bold text-zinc-800 leading-tight">
          {ONBOARDING_DOC_TYPE_LABELS_TH[docType]}
          {required && (
            <span className="text-red-500 ml-0.5" aria-hidden>
              *
            </span>
          )}
        </span>
        <span className="text-[10px] text-zinc-500 leading-tight">
          {busy ? "กำลังอัปโหลด..." : done ? `แนบแล้ว ${files.length} ไฟล์` : DOC_HELP[docType]}
        </span>
        {done && !full && !busy && (
          <span className="text-[10px] font-bold text-[var(--color-brand-700)]">+ เพิ่มไฟล์</span>
        )}
      </label>
      {files.map((f) => (
        <div
          key={f.fileId}
          className="mt-1 flex items-center justify-between gap-1.5 rounded-lg bg-zinc-100 px-2 py-1"
        >
          <span className="text-[10px] text-zinc-600 truncate">{f.fileName}</span>
          <button
            type="button"
            onClick={() => onRemove(f.fileId)}
            className="text-zinc-400 hover:text-red-600 shrink-0"
            aria-label={`ลบไฟล์ ${f.fileName}`}
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
      {error && (
        <p role="alert" className="text-[10px] text-red-600 mt-1">
          {error}
        </p>
      )}
    </div>
  );
}
