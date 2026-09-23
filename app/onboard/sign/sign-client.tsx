"use client";

/* ============================================================================
 * /onboard/sign — ขั้นสุดท้ายของ "ระบบรับพนักงานใหม่ออนไลน์"
 * ============================================================================
 * ลำดับบนหน้าจอ (ตามสเปก · docs/BIGFEATURE_recruit-onboarding_SPEC.md):
 *   (ก) สรุปสั้น ๆ ว่ากำลังเซ็นในนามใคร ตำแหน่งอะไร สาขาไหน
 *   (ข) ตัวสัญญา — อยู่ในกล่องเลื่อนของตัวเอง "ต้องเลื่อนอ่านจนสุด" ก่อน
 *   (ค) ติ๊กยืนยันข้อสุดท้าย (ปลดล็อกเมื่ออ่านจบ)
 *   (ง) วาดลายเซ็น
 *   (จ) ถ่ายรูปยืนยันตัวตนสด ๆ
 *   (ฉ) ส่ง — ปุ่มติดล่างจอ ปิดอยู่จนครบทุกข้อ และบอกเหตุผลบนปุ่มเอง
 *
 * ข้อมูลเข้าหน้านี้มาจาก sessionStorage ที่ /onboard เขียนไว้ (HANDOFF CONTRACT
 * ที่หัวไฟล์ app/onboard/onboard-client.tsx) — ไม่มีการยิง DB มาเอา
 * `sessionId` ตัวเดียวกันนี้คือ `submissionDraftId` ที่ใช้ตอนอัปโหลดเอกสาร 6 ชิ้น
 * → ลายเซ็น/เซลฟี่ต้องอัปโหลดด้วย id เดียวกัน ไฟล์ทั้งหมดถึงจะลงโฟลเดอร์ Drive
 * เดียวกัน (route submit บังคับว่าทุกไฟล์ต้อง folderId ตรงกันหมด)
 *
 * ⚠️ ตัวข้อความสัญญาอยู่ที่ lib/recruit/onboarding-contract.ts ซึ่งเป็น server-only
 * (import `node:crypto`) → ไฟล์นี้ **ห้าม** import ตัวข้อความมาเอง ต้องขอผ่าน
 * server action `loadContract` ที่ส่งเข้ามาทาง props เท่านั้น (เหตุผลเต็มอยู่ที่
 * หัวไฟล์ ./page.tsx)
 * ==========================================================================*/

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import SignatureCanvas from "react-signature-canvas";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  Check,
  CheckCircle2,
  Loader2,
  PenLine,
  RotateCcw,
  ScrollText,
  ShieldQuestion,
  Upload,
} from "lucide-react";
import {
  onboardingHandoffKey,
  ONBOARDING_HANDOFF_POINTER_KEY,
  type OnboardingHandoffAddress,
  type OnboardingHandoffDoc,
  type OnboardingHandoffForm,
  type OnboardingHandoffPayload,
} from "@/app/onboard/onboard-client";
import { ONBOARDING_MAX_CAPTURE_SIZE } from "@/lib/recruit/onboarding-types";

/* ======================================================= สัญญากับ page.tsx */

/** ท่อนที่อยู่แบบเดียวกับ AddressPartSchema ของ route submit */
export interface OnboardingAddressPart {
  line: string;
  subDistrict: string;
  district: string;
  province: string;
  postalCode: string;
}

/** ค่าที่ต้องเติมลงสัญญา — client มีครบ (อ่านจาก sessionStorage) แต่ render ไม่ได้เอง */
export interface OnboardingContractRequest {
  companyCode: string;
  fullNameTh: string;
  nationalId: string;
  registeredAddress: OnboardingAddressPart;
  position: string;
  branch: string;
  /** YYYY-MM-DD (ปี ค.ศ.) — server เป็นคนแปลงเป็น "1 ตุลาคม 2569" */
  startDate: string;
}

/** หนึ่ง "ข้อ" ของสัญญาที่ render เสร็จแล้ว (โครงเดียวกับ ContractSection ใน lib) */
export interface OnboardingContractSectionVm {
  id: string;
  heading: string;
  paragraphs: string[];
}

export type OnboardingContractResult =
  | {
      ok: true;
      sections: OnboardingContractSectionVm[];
      /** ชื่อบริษัทตามทะเบียน (มาจาก DB — ตัวเดียวกับที่ route submit เอาไปทำ hash) */
      companyName: string;
      /** ชื่อสาขาที่ match ได้ใน DB · ถ้า match ไม่ได้คือข้อความที่ผู้สมัครพิมพ์ */
      branchName: string;
      /** "1 ตุลาคม 2569" */
      startDateText: string;
    }
  | { ok: false; error: string };

export interface SignClientProps {
  /** ?s= จาก URL — null เมื่อเปิดหน้านี้ตรง ๆ (จะ fallback ไปอ่าน pointer key) */
  sessionIdFromQuery: string | null;
  contractTitle: string;
  /** FINAL_ACKNOWLEDGMENT_TEXT จาก lib (ไม่ได้อยู่ในตัวสัญญา จึงไม่อยู่ใน hash) */
  acknowledgmentText: string;
  /** ONBOARDING_CONTRACT_VERSION — เก็บลง answersJson ไว้ audit ย้อนหลัง */
  contractVersion: string;
  loadContract: (req: OnboardingContractRequest) => Promise<OnboardingContractResult>;
}

/* ============================================================== ค่าคงที่ UI */

/**
 * "ถึงท้ายแล้ว" ใช้ระยะเผื่อ ไม่ใช้เท่ากับเป๊ะ เพราะ:
 *   · iOS Safari rubber-band ทำให้ scrollTop ทะลุเกิน max (ผลลบ → ผ่านอยู่แล้ว)
 *   · pinch-zoom / ปรับขนาดฟอนต์ ทำให้ scrollHeight-clientHeight เหลือเศษทศนิยม
 *   · Android Chrome บางรุ่นปัดค่าไม่ลงตัว ขาดไปหลัก 1-2 px เสมอ
 */
const SCROLL_END_TOLERANCE_PX = 24;

/** จุดน้อยกว่านี้ = ไม่ใช่ลายเซ็น (แตะจุดเดียว/ขีดสั้น ๆ ไม่ผ่าน) */
const MIN_SIGNATURE_POINTS = 8;
/** ขนาดกรอบลายเซ็นขั้นต่ำ — อิงความกว้างแป้นจริง จึงไม่เพี้ยนตามขนาดจอ/ซูม */
const MIN_SIGNATURE_SPAN_PX = 40;
const MIN_SIGNATURE_SPAN_RATIO = 0.1;

/**
 * เป้าหมายขนาดไฟล์ภาพหลังย่อ
 *
 * เพดานจริงมี 2 ชั้น และชั้นที่เตี้ยกว่าอยู่ *นอก* โค้ดเรา:
 *   1. Vercel จำกัด request body ~4.5 MB — ไฟล์วิ่งผ่าน server จริง (ไม่ใช่ presigned)
 *      ถ้าเกิน แพลตฟอร์มตัดทิ้งก่อน handler ทำงาน ผู้ใช้จะเห็นแค่ error ดิบ ๆ
 *   2. route upload จำกัด capture ไว้ที่ ONBOARDING_MAX_CAPTURE_SIZE (4 MB)
 * มือถือรุ่นใหม่ถ่ายเซลฟี่ทีละ 3-6 MB → ถ้าไม่ย่อฝั่ง client จะชนเพดานทันที
 * ตั้งเป้าไว้ 1.2 MB เพื่อเผื่อที่หายใจเยอะ ๆ บนเน็ตมือถือที่ช้า
 */
const CAPTURE_TARGET_BYTES = 1_200_000;
const CAPTURE_SIZES = [960, 720, 540] as const;
const CAPTURE_QUALITIES = [0.85, 0.72, 0.6] as const;

/** handoff เก่ากว่านี้ถือว่าไม่ใช่ของคนที่ยืนอยู่หน้าเครื่อง (ตรงกับ DRAFT_TTL_MS ที่ /onboard) */
const HANDOFF_TTL_MS = 24 * 60 * 60 * 1000;

const CARD = "bg-white rounded-3xl border border-zinc-200 shadow-soft p-4 sm:p-6";
const CARD_TITLE = "flex items-center gap-2 text-sm font-bold text-[var(--color-brand-700)]";

/* ============================================ รูปร่างข้อมูลที่ส่งให้ route submit */

/** ตรงกับ DocDescriptorSchema ของ route submit (ไม่มี docType) */
interface CaptureDescriptor {
  fileId: string;
  folderId: string;
  fileName: string;
  mimeType: string;
}

interface SelfieState {
  blob: Blob;
  previewUrl: string;
  /** descriptor ที่อัปโหลดสำเร็จแล้ว — เก็บไว้เพื่อไม่ต้องอัปซ้ำตอนกดส่งใหม่ */
  uploaded: CaptureDescriptor | null;
}

interface SubmitIssue {
  path: string;
  message: string;
}

/* ================================================== อ่าน handoff จาก sessionStorage */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isAddressShape(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.houseNo === "string" &&
    typeof value.moo === "string" &&
    typeof value.road === "string" &&
    typeof value.subDistrict === "string" &&
    typeof value.district === "string" &&
    typeof value.province === "string" &&
    typeof value.postalCode === "string"
  );
}

function isDocShape(value: unknown): value is OnboardingHandoffDoc {
  return (
    isRecord(value) &&
    typeof value.fileId === "string" &&
    typeof value.folderId === "string" &&
    typeof value.docType === "string" &&
    typeof value.fileName === "string" &&
    typeof value.mimeType === "string"
  );
}

type HandoffProblem = "missing" | "corrupt" | "version" | "expired";

type HandoffRead =
  | { ok: true; payload: OnboardingHandoffPayload }
  | { ok: false; problem: HandoffProblem };

/**
 * ตรวจเฉพาะส่วนที่หน้านี้ "ใช้จริง" ไม่ได้ตรวจครบ 41 ช่อง — ช่องที่เหลือมี zod
 * ฝั่ง server เป็นด่านจริงอยู่แล้ว และ error ของมันเราเอามาแสดงเป็นภาษาไทยได้
 */
function readHandoff(sessionId: string): HandoffRead {
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(onboardingHandoffKey(sessionId));
  } catch {
    return { ok: false, problem: "missing" };
  }
  if (!raw) return { ok: false, problem: "missing" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, problem: "corrupt" };
  }
  if (!isRecord(parsed)) return { ok: false, problem: "corrupt" };
  if (parsed.version !== 1) return { ok: false, problem: "version" };

  const createdAt = Date.parse(str(parsed.createdAt));
  if (Number.isFinite(createdAt) && Date.now() - createdAt > HANDOFF_TTL_MS) {
    return { ok: false, problem: "expired" };
  }

  const form = parsed.form;
  if (
    typeof parsed.sessionId !== "string" ||
    parsed.sessionId === "" ||
    !isRecord(form) ||
    typeof form.companyCode !== "string" ||
    typeof form.fullNameTh !== "string" ||
    typeof form.nationalId !== "string" ||
    !isAddressShape(form.registeredAddress) ||
    !isAddressShape(form.currentAddress) ||
    !Array.isArray(form.emergencyContacts) ||
    form.emergencyContacts.length !== 2 ||
    !Array.isArray(parsed.documents) ||
    !parsed.documents.every(isDocShape)
  ) {
    return { ok: false, problem: "corrupt" };
  }

  // ตรวจโครงครบแล้ว — cast ครั้งเดียวตรงนี้ (ชนิดจริงเป็นของ onboard-client)
  return { ok: true, payload: parsed as unknown as OnboardingHandoffPayload };
}

/* ========================================================== แปลงค่าไปฝั่ง server */

/**
 * ยุบ บ้านเลขที่ / หมู่ / ถนน เป็นบรรทัดเดียว = ค่าที่ route submit เอาไปต่อกับ
 * ตำบล/อำเภอ/จังหวัด/ไปรษณีย์ ใน oneLineAddress() แล้วโยนเข้าสัญญาเป็น
 * {{ที่อยู่ตามทะเบียนบ้าน}}
 *
 * ประกอบที่นี่ที่เดียว แล้วส่งชุดเดียวกันนี้ให้ทั้ง (1) server action ที่ render
 * สัญญาให้อ่าน และ (2) route submit ที่คำนวณ hash — ถ้าประกอบกันคนละที่เมื่อไร
 * "ข้อความที่พนักงานอ่าน" กับ "ข้อความที่ระบบ hash" จะต่างกันทันที
 *
 * ตัวสัญญาเขียนนำไว้แล้วว่า "อยู่บ้านเลขที่ ..." จึงไม่ใส่คำว่าบ้านเลขที่ซ้ำ
 */
function toAddressPart(a: OnboardingHandoffAddress): OnboardingAddressPart {
  const line = [
    a.houseNo.trim(),
    a.moo.trim() === "" ? "" : `หมู่ ${a.moo.trim()}`,
    a.road.trim() === "" ? "" : `ถ.${a.road.trim()}`,
  ]
    .filter((part) => part !== "")
    .join(" ");
  return {
    line,
    subDistrict: a.subDistrict.trim(),
    district: a.district.trim(),
    province: a.province.trim(),
    postalCode: a.postalCode.trim(),
  };
}

function blank(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * ช่องที่ route submit บังคับ แต่ /onboard ไม่ได้บังคับ → ต้องดักตั้งแต่เปิดหน้านี้
 * ไม่ใช่ปล่อยให้ไปเจอตอนกดส่ง (ตอนนั้นเขาวาดลายเซ็น+ถ่ายรูปไปแล้ว เสียของ)
 *
 * ไล่ทั้ง schema แล้วเหลือจริง ๆ ข้อเดียว คือสถาบันการศึกษา: /onboard บังคับแค่
 * "ระดับ" (validate() §5) แต่ zod ฝั่ง server ตั้ง institute ไว้ min(1)
 */
function missingForServer(form: OnboardingHandoffForm): string[] {
  const missing: string[] = [];
  if (form.institution.trim() === "") missing.push("สถาบันการศึกษา (ข้อ 5 ของแบบฟอร์ม)");
  return missing;
}

/* ============================================================ ตัวช่วยเรื่องรูปภาพ */

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

/**
 * ครอปเป็นจัตุรัสกลางภาพ แล้วไล่ลดขนาด/คุณภาพจนไฟล์เล็กกว่าเป้า
 * (คืนไฟล์ที่เล็กที่สุดที่ทำได้เสมอ — คนเรียกเป็นคนตัดสินว่ายังใหญ่ไปไหม)
 */
async function encodeSquareJpeg(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
): Promise<Blob> {
  const side = Math.min(sourceWidth, sourceHeight);
  if (side <= 0) throw new Error("ภาพเสียหาย · ลองถ่ายใหม่อีกครั้ง");
  const sx = (sourceWidth - side) / 2;
  const sy = (sourceHeight - side) / 2;

  let smallest: Blob | null = null;
  for (const size of CAPTURE_SIZES) {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("เบราว์เซอร์นี้ประมวลผลรูปไม่ได้");
    ctx.drawImage(source, sx, sy, side, side, 0, 0, size, size);
    for (const quality of CAPTURE_QUALITIES) {
      const blob = await canvasToBlob(canvas, "image/jpeg", quality);
      if (!blob) continue;
      if (!smallest || blob.size < smallest.size) smallest = blob;
      if (blob.size <= CAPTURE_TARGET_BYTES) return blob;
    }
  }
  if (!smallest) throw new Error("ย่อรูปไม่สำเร็จ · ลองถ่ายใหม่อีกครั้ง");
  return smallest;
}

interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
}

function loadViaImgElement(file: File): Promise<DecodedImage> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ source: img, width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("เปิดไฟล์รูปนี้ไม่ได้ · ลองถ่ายใหม่อีกครั้ง"));
    };
    img.src = url;
  });
}

/**
 * ใช้เฉพาะทาง fallback (แอปกล้องของเครื่อง) — ทางกล้องสดวาดจาก <video> ตรง ๆ
 *
 * createImageBitmap + imageOrientation:"from-image" มาก่อน เพราะรูปจากแอปกล้อง
 * มือถือมักเก็บ EXIF Orientation ไว้ (ภาพแนวตั้งถูกบันทึกเป็นแนวนอน + ธงบอกให้หมุน)
 * เบราว์เซอร์ตั้งแต่ปี 2020 หมุนให้เองตอน decode เข้า <img> แต่มือถือ Android
 * รุ่นเก่า — ซึ่งก็คือกลุ่มที่ต้องใช้ fallback นี้พอดี — ไม่หมุนให้ ผลคือรูป
 * ยืนยันตัวตนตะแคง 90° ส่วน <img> เก็บไว้เป็นทางสำรองของ Safari รุ่นเก่า
 */
async function decodeImageFile(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height };
    } catch {
      /* ตกไปใช้ <img> ต่อ */
    }
  }
  return loadViaImgElement(file);
}

/* ================================================================ ลายเซ็น: วัดหมึก */

interface InkStats {
  strokes: number;
  points: number;
  spanX: number;
  spanY: number;
}

/**
 * วัด "หมึก" จากข้อมูลเส้นจริง ไม่ใช่แค่ isEmpty()
 * แตะจุดเดียว = 1 เส้น 1 จุด กรอบ 0×0 → ตกทุกเกณฑ์ ซึ่งคือสิ่งที่ต้องการ
 */
function measureInk(pad: SignatureCanvas): InkStats {
  const groups = pad.toData();
  let points = 0;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const group of groups) {
    for (const point of group) {
      points += 1;
      if (point.x < minX) minX = point.x;
      if (point.x > maxX) maxX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.y > maxY) maxY = point.y;
    }
  }
  if (points === 0) return { strokes: 0, points: 0, spanX: 0, spanY: 0 };
  return { strokes: groups.length, points, spanX: maxX - minX, spanY: maxY - minY };
}

function inkIsEnough(stats: InkStats, canvasWidth: number): boolean {
  if (stats.points < MIN_SIGNATURE_POINTS) return false;
  const required = Math.max(MIN_SIGNATURE_SPAN_PX, canvasWidth * MIN_SIGNATURE_SPAN_RATIO);
  return Math.hypot(stats.spanX, stats.spanY) >= required;
}

/** ตัดขอบว่างออก แล้ววางบนพื้นขาว — ลายเซ็นพื้นโปร่งใสบนโปรแกรมดูภาพพื้นดำจะมองไม่เห็น */
async function signatureToBlob(pad: SignatureCanvas): Promise<Blob> {
  const trimmed = pad.getTrimmedCanvas();
  const margin = 12;
  const out = document.createElement("canvas");
  out.width = Math.max(1, trimmed.width) + margin * 2;
  out.height = Math.max(1, trimmed.height) + margin * 2;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("เบราว์เซอร์นี้ประมวลผลรูปไม่ได้");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(trimmed, margin, margin);

  const png = await canvasToBlob(out, "image/png");
  if (png && png.size <= CAPTURE_TARGET_BYTES) return png;
  // เซ็นเต็มแป้นบนจอ 3x อาจได้ PNG ใหญ่กว่าคาด → ถอยไป JPEG (พื้นขาวอยู่แล้ว)
  const jpeg = await canvasToBlob(out, "image/jpeg", 0.92);
  if (jpeg) return jpeg;
  if (png) return png;
  throw new Error("บันทึกลายเซ็นไม่สำเร็จ · ลองเซ็นใหม่อีกครั้ง");
}

/* =========================================================== เรียก API ฝั่งเรา */

function errorMessageOf(body: unknown, fallback: string): string {
  if (isRecord(body) && typeof body.error === "string" && body.error !== "") return body.error;
  return fallback;
}

function issuesOf(body: unknown): SubmitIssue[] {
  if (!isRecord(body) || !Array.isArray(body.issues)) return [];
  const out: SubmitIssue[] = [];
  for (const issue of body.issues) {
    if (isRecord(issue) && typeof issue.message === "string") {
      out.push({ path: str(issue.path), message: issue.message });
    }
  }
  return out;
}

async function uploadCapture(
  kind: "SIGNATURE" | "SELFIE",
  blob: Blob,
  submissionDraftId: string,
): Promise<CaptureDescriptor> {
  if (blob.size > ONBOARDING_MAX_CAPTURE_SIZE) {
    throw new Error("ไฟล์รูปใหญ่เกินกำหนด · กรุณาถ่าย/เซ็นใหม่อีกครั้ง");
  }
  const extension = blob.type === "image/png" ? "png" : "jpg";
  const body = new FormData();
  body.append("file", blob, `${kind.toLowerCase()}.${extension}`);
  body.append("docType", kind);
  body.append("submissionDraftId", submissionDraftId);

  const res = await fetch("/api/recruit/onboarding/upload", { method: "POST", body });
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      errorMessageOf(
        json,
        kind === "SIGNATURE" ? "อัปโหลดลายเซ็นไม่สำเร็จ" : "อัปโหลดรูปยืนยันตัวตนไม่สำเร็จ",
      ),
    );
  }
  if (
    !isRecord(json) ||
    typeof json.fileId !== "string" ||
    typeof json.folderId !== "string" ||
    typeof json.fileName !== "string" ||
    typeof json.mimeType !== "string"
  ) {
    throw new Error("ระบบตอบกลับไม่ครบ · กรุณาลองใหม่อีกครั้ง");
  }
  return {
    fileId: json.fileId,
    folderId: json.folderId,
    fileName: json.fileName,
    mimeType: json.mimeType,
  };
}

/* ================================================================== component */

export function SignClient({
  sessionIdFromQuery,
  contractTitle,
  acknowledgmentText,
  contractVersion,
  loadContract,
}: SignClientProps) {
  const router = useRouter();

  /* --------------------------------------------------------- handoff payload */
  const [payload, setPayload] = useState<OnboardingHandoffPayload | null>(null);
  const [handoffProblem, setHandoffProblem] = useState<HandoffProblem | null>(null);
  const [blockingGaps, setBlockingGaps] = useState<string[]>([]);

  // sessionStorage อ่านได้เฉพาะหลัง mount (ฝั่ง server ไม่มี) → setState ใน effect
  // คือทางเดียวจริง ๆ ถ้าอ่านตอน render จะได้ HTML คนละชุดกับที่ server ส่งมา
  // (hydration mismatch) · รูปแบบเดียวกับที่ /onboard ทำตอนกู้ดราฟต์จาก localStorage
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    let sessionId = sessionIdFromQuery ?? "";
    if (sessionId === "") {
      try {
        sessionId = window.sessionStorage.getItem(ONBOARDING_HANDOFF_POINTER_KEY) ?? "";
      } catch {
        sessionId = "";
      }
    }
    if (sessionId === "") {
      setHandoffProblem("missing");
      return;
    }
    const result = readHandoff(sessionId);
    if (!result.ok) {
      setHandoffProblem(result.problem);
      return;
    }
    setBlockingGaps(missingForServer(result.payload.form));
    setPayload(result.payload);
  }, [sessionIdFromQuery]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const form = payload?.form ?? null;

  /* ----------------------------------------------------------- ตัวสัญญา (server) */
  const [contract, setContract] = useState<OnboardingContractResult | null>(null);
  const [contractAttempt, setContractAttempt] = useState(0);
  /** รอบที่โหลดเสร็จแล้ว — ต่างจาก contractAttempt เมื่อไร แปลว่ากำลังโหลดอยู่ */
  const [loadedAttempt, setLoadedAttempt] = useState(-1);
  const contractLoading = form !== null && loadedAttempt !== contractAttempt;

  useEffect(() => {
    if (!form) return;
    const attempt = contractAttempt;
    let cancelled = false;
    loadContract({
      companyCode: form.companyCode,
      fullNameTh: form.fullNameTh,
      nationalId: form.nationalId,
      registeredAddress: toAddressPart(form.registeredAddress),
      position: form.position,
      branch: form.branch,
      startDate: form.startDate,
    })
      .then((result) => {
        if (!cancelled) setContract(result);
      })
      .catch(() => {
        if (!cancelled) {
          setContract({
            ok: false,
            error: "โหลดสัญญาไม่สำเร็จ · ตรวจสัญญาณอินเทอร์เน็ตแล้วลองใหม่",
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoadedAttempt(attempt);
      });
    return () => {
      cancelled = true;
    };
  }, [form, loadContract, contractAttempt]);

  /* ------------------------------------------------------------------ ด่านอ่าน */
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [readProgress, setReadProgress] = useState(0);
  const [scrolledToEnd, setScrolledToEnd] = useState(false);

  const evaluateScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    // เนื้อหาสั้นกว่ากล่อง = เห็นครบตั้งแต่แรก → ถือว่าอ่านจบ ไม่งั้นจะติดล็อกถาวร
    if (max <= SCROLL_END_TOLERANCE_PX) {
      setReadProgress(1);
      setScrolledToEnd(true);
      return;
    }
    const top = el.scrollTop;
    setReadProgress(Math.min(1, Math.max(0, top / max)));
    // ค้างเป็น true ตลอด: iOS ดีดกลับ / ฟอนต์ reflow / หมุนจอ ไม่ควรทำให้ "อ่านแล้ว" หาย
    if (max - top <= SCROLL_END_TOLERANCE_PX) setScrolledToEnd(true);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content) return;
    evaluateScroll();
    // ต้องดูทั้งกล่อง (หมุนจอ/แถบ URL ยุบ) และเนื้อหา (ฟอนต์ไทยโหลดเสร็จแล้ว reflow)
    const ro = new ResizeObserver(() => evaluateScroll());
    ro.observe(el);
    ro.observe(content);
    return () => ro.disconnect();
  }, [evaluateScroll, contract]);

  /* ---------------------------------------------------------------- ยินยอมข้อท้าย */
  const [acknowledged, setAcknowledged] = useState(false);

  /**
   * /onboard ไม่ได้บังคับติ๊ก "ยินยอมให้ติดต่อบุคคลอ้างอิง" (เป็นช่องไม่บังคับที่นั่น)
   * แต่ route submit บังคับว่า consents ต้องครบทั้ง 4 ข้อ → ถ้าปล่อยผ่านมา
   * ผู้สมัครจะโดนตีกลับตอนกดส่งด้วยข้อความรวม ๆ ทั้งที่เซ็นไปหมดแล้ว
   * ทางออก: ติ๊กมาแล้วไม่ถามซ้ำ · ยังไม่ติ๊กให้ถามที่นี่ (ห้ามติ๊กให้ล่วงหน้าเด็ดขาด)
   */
  const needsReferenceConsent = form !== null && !form.consentContactReference;
  const [referenceConsent, setReferenceConsent] = useState(false);
  const referenceConsentOk = !needsReferenceConsent || referenceConsent;

  /* ------------------------------------------------------------------- ลายเซ็น */
  const padRef = useRef<SignatureCanvas | null>(null);
  const padBoxRef = useRef<HTMLDivElement | null>(null);
  const padWidthRef = useRef(0);
  const [inkOk, setInkOk] = useState(false);
  const [signatureNote, setSignatureNote] = useState<string | null>(null);
  /**
   * descriptor ของลายเซ็นที่อัปโหลดสำเร็จแล้ว — ตัวหมึกเองยังอยู่บนแป้น
   * (ไม่ได้เก็บ Blob ไว้ใน state) ส่งใหม่หลังเน็ตหลุดจึงไม่ต้องเซ็นซ้ำ
   */
  const [signatureUpload, setSignatureUpload] = useState<CaptureDescriptor | null>(null);

  const refreshInk = useCallback(() => {
    const pad = padRef.current;
    if (!pad) return;
    const enough = inkIsEnough(measureInk(pad), pad.getCanvas().offsetWidth);
    setInkOk(enough);
    setSignatureNote(enough ? null : "ลายเซ็นสั้นเกินไป · กรุณาเซ็นชื่อให้เต็มกว่านี้");
    setSignatureUpload(null); // เซ็นเพิ่ม = ของที่อัปไว้ก่อนหน้าใช้ไม่ได้แล้ว
  }, []);

  const clearPad = useCallback(() => {
    padRef.current?.clear();
    setInkOk(false);
    setSignatureNote(null);
    setSignatureUpload(null);
  }, []);

  /**
   * ปรับความละเอียดแป้นตามจอ (DPR) เอง แทนที่จะพึ่ง clearOnResize ของไลบรารี
   * เหตุผล: บนมือถือ แถบ URL ยุบ/ขยายจะยิง resize รัว ๆ ถ้าใช้ค่า default
   * (clearOnResize = true) ลายเซ็นที่เพิ่งวาดจะถูกล้างทิ้งเองแบบงง ๆ
   * → ปิดของไลบรารี แล้วล้างเฉพาะตอน "ความกว้างเปลี่ยนจริง" (หมุนจอ) เท่านั้น
   */
  useEffect(() => {
    const box = padBoxRef.current;
    if (!box) return;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (width <= 0) return;
      if (padWidthRef.current === 0) {
        padWidthRef.current = width;
        return;
      }
      if (Math.abs(width - padWidthRef.current) < 2) return;
      padWidthRef.current = width;
      const pad = padRef.current;
      if (!pad) return;
      const canvas = pad.getCanvas();
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      canvas.width = Math.round(canvas.offsetWidth * ratio);
      canvas.height = Math.round(canvas.offsetHeight * ratio);
      // setTransform ไม่ใช่ scale — scale จะทบกับของเดิมทุกรอบที่หมุนจอ
      canvas.getContext("2d")?.setTransform(ratio, 0, 0, ratio, 0, 0);
      clearPad();
    });
    ro.observe(box);
    return () => ro.disconnect();
  }, [clearPad]);

  /* --------------------------------------------------------------------- เซลฟี่ */
  const [selfie, setSelfie] = useState<SelfieState | null>(null);
  const selfieUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (selfieUrlRef.current) URL.revokeObjectURL(selfieUrlRef.current);
      selfieUrlRef.current = null;
    };
  }, []);

  const onSelfieCaptured = useCallback((blob: Blob) => {
    const url = URL.createObjectURL(blob);
    if (selfieUrlRef.current) URL.revokeObjectURL(selfieUrlRef.current);
    selfieUrlRef.current = url;
    setSelfie({ blob, previewUrl: url, uploaded: null });
  }, []);

  const onSelfieCleared = useCallback(() => {
    if (selfieUrlRef.current) URL.revokeObjectURL(selfieUrlRef.current);
    selfieUrlRef.current = null;
    setSelfie(null);
  }, []);

  /* ------------------------------------------------------ ดาวน์โหลดฉบับเต็ม */

  /* ------------------------------------------------------------------ ส่งข้อมูล */
  const submittingRef = useRef(false);
  const navigatedRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitStep, setSubmitStep] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitIssues, setSubmitIssues] = useState<SubmitIssue[]>([]);

  const blocker = useMemo((): string | null => {
    if (contract === null) return "กำลังโหลดสัญญา...";
    if (!contract.ok) return "โหลดสัญญาไม่สำเร็จ";
    if (!scrolledToEnd) return "เลื่อนอ่านสัญญาให้ครบก่อน";
    if (!acknowledged) return "ติ๊กยอมรับสัญญาก่อน";
    if (!referenceConsentOk) return "ติ๊กยินยอมให้ติดต่อบุคคลอ้างอิงก่อน";
    if (!inkOk) return "วาดลายเซ็นก่อน";
    if (!selfie) return "ถ่ายรูปยืนยันตัวตนก่อน";
    return null;
  }, [contract, scrolledToEnd, acknowledged, referenceConsentOk, inkOk, selfie]);

  async function handleSubmit() {
    if (submittingRef.current) return;
    if (!payload || !form || blocker !== null) return;
    const pad = padRef.current;
    if (!pad) return;

    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError(null);
    setSubmitIssues([]);

    try {
      /* 1) ลายเซ็น — อัปแล้วไม่อัปซ้ำ (เน็ตหลุดตอนกดส่งจะได้ไม่ต้องเซ็นใหม่) */
      let signatureDescriptor = signatureUpload;
      if (!signatureDescriptor) {
        setSubmitStep("กำลังบันทึกลายเซ็น...");
        signatureDescriptor = await uploadCapture(
          "SIGNATURE",
          await signatureToBlob(pad),
          payload.sessionId,
        );
        setSignatureUpload(signatureDescriptor);
      }

      /* 2) เซลฟี่ */
      let selfieDescriptor = selfie?.uploaded ?? null;
      if (!selfieDescriptor) {
        if (!selfie) throw new Error("ยังไม่มีรูปยืนยันตัวตน");
        setSubmitStep("กำลังบันทึกรูปยืนยันตัวตน...");
        selfieDescriptor = await uploadCapture("SELFIE", selfie.blob, payload.sessionId);
        const uploaded = selfieDescriptor;
        setSelfie((prev) => (prev ? { ...prev, uploaded } : prev));
      }

      /* 3) ส่งทั้งชุด */
      setSubmitStep("กำลังส่งข้อมูล...");
      const body = {
        submissionDraftId: payload.sessionId,
        companyCode: form.companyCode,
        branch: form.branch,
        positionApplied: form.position,
        desiredStartDate: form.startDate,
        desiredSalary: form.salary,

        titlePrefix: form.titlePrefix,
        fullNameTh: form.fullNameTh,
        fullNameEn: blank(form.fullNameEn),
        nickname: form.nickname,
        nationalId: form.nationalId,
        birthDate: form.birthDate,
        nationality: form.nationality,
        militaryStatus: blank(form.militaryStatus),
        phone: form.phone,
        lineId: blank(form.lineId),
        email: blank(form.email),
        maritalStatus: blank(form.maritalStatus),

        address: {
          registered: toAddressPart(form.registeredAddress),
          sameAsRegistered: form.currentAddressSameAsRegistered,
          current: form.currentAddressSameAsRegistered
            ? undefined
            : toAddressPart(form.currentAddress),
        },
        emergencyContacts: form.emergencyContacts.map((contact) => ({
          name: contact.fullName,
          relation: contact.relation,
          phone: contact.phone,
        })),
        education: {
          level: form.educationLevel,
          institute: form.institution,
          graduationYear:
            form.graduationYearBe === null ? undefined : String(form.graduationYearBe),
        },
        // employer ว่าง = zod ตีกลับ (company min 1) — /onboard เก็บแถวที่มีแต่ตำแหน่งได้
        workHistory: form.workHistory
          .filter((item) => item.employer.trim() !== "")
          .map((item) => ({
            company: item.employer,
            position: blank(item.position),
            period: blank(item.period),
            salary: item.lastSalary === null ? undefined : String(item.lastSalary),
            reasonLeaving: blank(item.reasonForLeaving),
          })),
        bankName: form.bankName,
        bankAccountNo: form.bankAccountNo,
        bankAccountName: form.bankAccountName,
        noBankAccountYet: form.noBankAccountYet,

        documents: payload.documents,
        signature: signatureDescriptor,
        selfie: selfieDescriptor,

        scrolledToEnd,
        consents: {
          truthful: form.consentTruthful,
          privacyRead: form.consentPrivacyRead,
          emergencyContactNotified: form.consentEmergencyContactNotified,
          referenceCheck: form.consentContactReference || referenceConsent,
        },
        // ของที่ไม่มีคอลัมน์ของตัวเองใน schema — เก็บดิบไว้ให้ฝ่ายบุคคลย้อนดูได้
        answers: {
          contractVersion,
          firstName: form.firstName,
          lastName: form.lastName,
          bankCode: form.bankCode,
          hasWorkExperience: form.hasWorkExperience,
          reference: form.reference,
          graduationYearBe: form.graduationYearBe,
          registeredAddressParts: form.registeredAddress,
          currentAddressParts: form.currentAddressSameAsRegistered
            ? form.registeredAddress
            : form.currentAddress,
          referenceCheckConsentedAtSigning: needsReferenceConsent,
          handoffCreatedAt: payload.createdAt,
        },
      };

      const res = await fetch("/api/recruit/onboarding/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setSubmitIssues(issuesOf(json));
        throw new Error(errorMessageOf(json, "ส่งข้อมูลไม่สำเร็จ · กรุณาลองใหม่อีกครั้ง"));
      }
      if (!isRecord(json) || typeof json.reference !== "string") {
        throw new Error("ระบบตอบกลับไม่ครบ · กรุณาติดต่อฝ่ายบุคคลเพื่อตรวจสอบ");
      }

      // ส่งสำเร็จแล้ว ล้าง handoff ทิ้ง กันกด back แล้วส่งซ้ำ
      try {
        window.sessionStorage.removeItem(onboardingHandoffKey(payload.sessionId));
        window.sessionStorage.removeItem(ONBOARDING_HANDOFF_POINTER_KEY);
      } catch {
        /* โหมดไม่ระบุตัวตนอาจไม่ให้ลบ — ไม่ใช่เรื่องคอขาดบาดตาย */
      }
      navigatedRef.current = true;
      setSubmitStep("ส่งเรียบร้อย · กำลังเปิดหน้ายืนยัน...");
      router.push(`/onboard/success?ref=${encodeURIComponent(json.reference)}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "เกิดข้อผิดพลาด · กรุณาลองใหม่";
      setSubmitError(message);
      toast.error(message);
    } finally {
      // สำเร็จแล้ว = กำลังเปลี่ยนหน้า ห้ามปลดล็อกปุ่มให้กดซ้ำได้ระหว่างรอ
      if (!navigatedRef.current) {
        setSubmitStep("");
        submittingRef.current = false;
        setSubmitting(false);
      }
    }
  }

  /* ================================================================== render */

  if (handoffProblem !== null) return <RecoveryScreen problem={handoffProblem} />;
  if (blockingGaps.length > 0) return <GapScreen gaps={blockingGaps} />;

  if (!payload || !form) {
    return (
      <div className={`${CARD} mt-4 flex items-center justify-center gap-2 text-zinc-500`}>
        <Loader2 className="size-4 animate-spin" />
        <span className="text-sm">กำลังเตรียมสัญญา...</span>
      </div>
    );
  }

  const percent = Math.round(readProgress * 100);

  return (
    <div className="mt-4 space-y-3 pb-32">
      {/* (ก) กำลังเซ็นในนามใคร ------------------------------------------------ */}
      <section className={CARD}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-lg font-extrabold text-zinc-900 font-display leading-snug break-words">
              {form.fullNameTh}
            </p>
            <p className="text-[13px] text-zinc-600 mt-0.5 break-words">
              {form.position} · สาขา{contract?.ok ? contract.branchName : form.branch}
            </p>
            <p className="text-[13px] text-zinc-600 break-words">
              {contract?.ok ? contract.companyName : form.companyName}
            </p>
            <p className="text-[13px] text-zinc-600">
              เริ่มงาน {contract?.ok ? contract.startDateText : form.startDate}
            </p>
          </div>
          <Link
            href="/onboard"
            className="shrink-0 inline-flex items-center gap-1 text-xs font-bold text-[var(--color-brand-700)] underline underline-offset-2"
          >
            <ArrowLeft className="size-3" aria-hidden />
            แก้ข้อมูล
          </Link>
        </div>
        <p className="mt-2.5 pt-2.5 border-t border-zinc-100 text-xs text-zinc-500 inline-flex items-center gap-1.5">
          <Check className="size-3 text-emerald-600" aria-hidden />
          เอกสารแนบ {payload.documents.length} ไฟล์ · ส่งพร้อมสัญญานี้
        </p>
      </section>

      {/* (ข) ตัวสัญญา + ด่านอ่าน --------------------------------------------- */}
      <section className={CARD}>
        <div className="flex items-start justify-between gap-2">
          <p className={`${CARD_TITLE} min-w-0`}>
            <ScrollText className="size-4 shrink-0" aria-hidden />
            <span className="break-words">{contractTitle}</span>
          </p>
        </div>

        {contractLoading && contract === null && (
          <div className="mt-3 h-48 rounded-2xl border border-zinc-200 bg-zinc-50 flex items-center justify-center gap-2 text-sm text-zinc-500">
            <Loader2 className="size-4 animate-spin" />
            กำลังโหลดสัญญา...
          </div>
        )}

        {contract !== null && !contract.ok && (
          <div className="mt-3 rounded-2xl border border-red-300 bg-red-50 p-4 text-[13px] text-red-900">
            <p className="font-bold">{contract.error}</p>
            <button
              type="button"
              onClick={() => setContractAttempt((n) => n + 1)}
              disabled={contractLoading}
              className="mt-2 h-10 px-4 rounded-xl bg-white border border-red-300 font-bold text-red-800 disabled:opacity-50"
            >
              {contractLoading ? "กำลังลองใหม่..." : "ลองโหลดใหม่"}
            </button>
          </div>
        )}

        {contract?.ok && (
          <>
            {/* แถบความคืบหน้าการอ่าน — บางที่สุดเท่าที่ยังเห็น (RULE L งบพื้นที่) */}
            <div
              className="mt-3 h-1 rounded-full bg-zinc-200 overflow-hidden"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={scrolledToEnd ? 100 : percent}
              aria-label="ความคืบหน้าการอ่านสัญญา"
            >
              <div
                className={`h-full transition-[width] duration-150 ${
                  scrolledToEnd ? "bg-emerald-500" : "bg-[var(--color-brand-500)]"
                }`}
                style={{ width: `${scrolledToEnd ? 100 : percent}%` }}
              />
            </div>

            <div
              ref={scrollRef}
              onScroll={evaluateScroll}
              tabIndex={0}
              aria-label="เนื้อหาสัญญาจ้าง"
              onCopy={(e) => e.preventDefault()}
              onCut={(e) => e.preventDefault()}
              onContextMenu={(e) => e.preventDefault()}
              onDragStart={(e) => e.preventDefault()}
              className="onboard-protected mt-2 h-[52vh] min-h-[300px] max-h-[560px] overflow-y-auto overscroll-contain rounded-2xl border border-zinc-200 bg-zinc-50 px-3.5 py-3 focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-300)]"
            >
              {/* เห็นเฉพาะตอนสั่งพิมพ์/บันทึกเป็น PDF — ตัวสัญญาจะถูกซ่อนแทน */}
              <p className="onboard-protected-print-notice hidden text-[13px] text-zinc-700">
                สัญญาฉบับนี้ไม่อนุญาตให้พิมพ์หรือบันทึกเป็นไฟล์
                · ติดต่อฝ่ายบุคคลหากต้องการสำเนา
              </p>
              <div ref={contentRef} className="space-y-3">
                {contract.sections.map((section) => (
                  <div key={section.id}>
                    {section.heading !== "" && (
                      <p className="text-[13px] font-bold text-zinc-900">{section.heading}</p>
                    )}
                    {section.paragraphs.map((paragraph, index) => (
                      <p
                        key={`${section.id}-${index}`}
                        className="text-[13px] leading-relaxed text-zinc-700 mt-1"
                      >
                        {paragraph}
                      </p>
                    ))}
                  </div>
                ))}
                <p className="text-[11px] text-zinc-400 pt-1 border-t border-zinc-200">
                  — จบสัญญา —
                </p>
              </div>
            </div>

            <p
              className={`mt-2 text-xs font-medium inline-flex items-center gap-1.5 ${
                scrolledToEnd ? "text-emerald-700" : "text-zinc-500"
              }`}
            >
              {scrolledToEnd ? (
                <>
                  <CheckCircle2 className="size-3.5" aria-hidden />
                  อ่านครบแล้ว
                </>
              ) : (
                `อ่านแล้ว ${percent}% · เลื่อนลงจนสุดเพื่อปลดล็อกช่องยินยอม`
              )}
            </p>
          </>
        )}
      </section>

      {/* (ค) ติ๊กยินยอม ------------------------------------------------------- */}
      <section className={CARD}>
        <label
          className={`flex gap-3 items-start ${
            scrolledToEnd ? "cursor-pointer" : "cursor-not-allowed opacity-55"
          }`}
        >
          <input
            type="checkbox"
            checked={acknowledged}
            disabled={!scrolledToEnd}
            onChange={(e) => setAcknowledged(e.target.checked)}
            className="mt-0.5 size-5 shrink-0 rounded accent-[var(--color-brand-600)] disabled:cursor-not-allowed"
          />
          <span className="text-[13px] leading-relaxed text-zinc-800">
            {acknowledgmentText}
            <span className="text-red-500 ml-0.5" aria-hidden>
              *
            </span>
          </span>
        </label>
        {!scrolledToEnd && (
          <p className="mt-2 ml-8 text-xs text-zinc-500">
            ติ๊กได้เมื่อเลื่อนอ่านสัญญาด้านบนจนจบ
          </p>
        )}

        {needsReferenceConsent && (
          <label
            className={`mt-3 pt-3 border-t border-zinc-100 flex gap-3 items-start ${
              scrolledToEnd ? "cursor-pointer" : "cursor-not-allowed opacity-55"
            }`}
          >
            <input
              type="checkbox"
              checked={referenceConsent}
              disabled={!scrolledToEnd}
              onChange={(e) => setReferenceConsent(e.target.checked)}
              className="mt-0.5 size-5 shrink-0 rounded accent-[var(--color-brand-600)] disabled:cursor-not-allowed"
            />
            <span className="text-[13px] leading-relaxed text-zinc-800">
              ยินยอมให้บริษัทติดต่อสอบถามบุคคลอ้างอิงเพื่อตรวจสอบประวัติการทำงาน
              <span className="text-red-500 ml-0.5" aria-hidden>
                *
              </span>
            </span>
          </label>
        )}
      </section>

      {/* (ง) ลายเซ็น ---------------------------------------------------------- */}
      <section className={CARD}>
        <div className="flex items-center justify-between gap-2">
          <p className={CARD_TITLE}>
            <PenLine className="size-4" aria-hidden />
            วาดลายเซ็นของคุณ
          </p>
          <button
            type="button"
            onClick={clearPad}
            className="inline-flex items-center gap-1 h-9 px-3 rounded-xl border border-zinc-200 text-xs font-bold text-zinc-600 hover:bg-zinc-50"
          >
            <RotateCcw className="size-3.5" aria-hidden />
            เซ็นใหม่
          </button>
        </div>

        <div
          ref={padBoxRef}
          className="mt-2 relative rounded-2xl border-2 border-dashed border-zinc-300 bg-white overflow-hidden"
        >
          <SignatureCanvas
            ref={padRef}
            penColor="#0a0a0a"
            clearOnResize={false}
            onEnd={refreshInk}
            canvasProps={{
              className: "block w-full h-40 sm:h-44 touch-none",
              "aria-label": "พื้นที่วาดลายเซ็น",
            }}
          />
          <div className="pointer-events-none absolute inset-x-5 bottom-6 border-b border-dashed border-zinc-300" />
          {!inkOk && (
            <p className="pointer-events-none absolute inset-x-0 bottom-1.5 text-center text-[11px] text-zinc-400">
              ใช้นิ้วลากเซ็นชื่อในกรอบนี้
            </p>
          )}
        </div>

        {signatureNote ? (
          <p role="alert" className="mt-1.5 text-xs text-amber-700">
            {signatureNote}
          </p>
        ) : inkOk ? (
          <p className="mt-1.5 text-xs text-emerald-600 inline-flex items-center gap-1">
            <Check className="size-3" aria-hidden />
            เซ็นเรียบร้อย
          </p>
        ) : null}
      </section>

      {/* (จ) เซลฟี่ ----------------------------------------------------------- */}
      <section className={CARD}>
        <p className={CARD_TITLE}>
          <Camera className="size-4" aria-hidden />
          ถ่ายรูปยืนยันตัวตน
        </p>
        <p className="text-xs text-zinc-500 mt-1">
          ถ่ายหน้าตรง ไม่ใส่หมวกหรือแว่นดำ · ใช้ยืนยันว่าคนเซ็นคือคุณจริง
        </p>
        <SelfieCapture
          previewUrl={selfie?.previewUrl ?? null}
          onCaptured={onSelfieCaptured}
          onCleared={onSelfieCleared}
        />
      </section>

      {/* ข้อผิดพลาดจาก server ------------------------------------------------- */}
      {submitError !== null && (
        <div className="rounded-2xl border border-red-300 bg-red-50 p-4">
          <p className="flex items-start gap-2 text-[13px] font-bold text-red-900">
            <AlertTriangle className="size-4 shrink-0 mt-0.5" aria-hidden />
            {submitError}
          </p>
          {submitIssues.length > 0 && (
            <>
              <ul className="mt-2 ml-6 list-disc space-y-0.5 text-[13px] text-red-800">
                {submitIssues.slice(0, 8).map((issue, index) => (
                  <li key={`${issue.path}-${index}`}>{issue.message}</li>
                ))}
              </ul>
              <Link
                href="/onboard"
                className="mt-2.5 ml-6 inline-flex items-center gap-1 text-[13px] font-bold text-red-900 underline underline-offset-2"
              >
                <ArrowLeft className="size-3.5" aria-hidden />
                กลับไปแก้ข้อมูลในแบบฟอร์ม
              </Link>
            </>
          )}
          <p className="mt-2 ml-6 text-xs text-red-700">
            ลายเซ็นและรูปที่ถ่ายไว้ยังอยู่ · กดส่งใหม่ได้เลย ไม่ต้องทำซ้ำ
          </p>
        </div>
      )}

      {/* (ฉ) ปุ่มส่ง ติดล่างจอ ------------------------------------------------- */}
      <div className="fixed inset-x-0 bottom-0 z-30 bg-white/95 backdrop-blur border-t border-zinc-200">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={blocker !== null || submitting}
            className="w-full h-14 rounded-2xl bg-[var(--color-brand-600)] text-white font-extrabold text-base hover:bg-[var(--color-brand-700)] disabled:bg-zinc-200 disabled:text-zinc-500 transition-colors flex items-center justify-center gap-2 shadow-[0_6px_16px_rgba(30,58,255,0.25)] disabled:shadow-none"
          >
            {submitting ? (
              <>
                <Loader2 className="size-5 animate-spin" />
                {submitStep === "" ? "กำลังส่ง..." : submitStep}
              </>
            ) : blocker !== null ? (
              blocker
            ) : (
              <>
                <CheckCircle2 className="size-5" aria-hidden />
                ยืนยันและส่งสัญญา
              </>
            )}
          </button>
          <p className="mt-1.5 text-center text-[11px] text-zinc-500">
            กดส่ง = ลงลายมือชื่ออิเล็กทรอนิกส์ตามข้อ 10.1 ของสัญญา
          </p>
        </div>
      </div>
    </div>
  );
}

/* ================================================================ sub-screens */

const RECOVERY_COPY: Record<HandoffProblem, string> = {
  missing:
    "ไม่พบข้อมูลที่กรอกไว้ในเครื่องนี้ — อาจเพราะเปิดลิงก์นี้ตรง ๆ หรือเปลี่ยนแท็บ/เบราว์เซอร์ระหว่างทาง",
  corrupt: "ข้อมูลที่กรอกไว้เสียหาย อ่านต่อไม่ได้",
  version: "ระบบมีการอัปเดต ข้อมูลที่กรอกไว้เป็นรูปแบบเดิม",
  expired: "ข้อมูลที่กรอกไว้เก่าเกิน 24 ชั่วโมง",
};

function RecoveryScreen({ problem }: { problem: HandoffProblem }) {
  return (
    <div className={`${CARD} mt-4 text-center`}>
      <div className="size-14 mx-auto rounded-2xl bg-amber-50 border-2 border-amber-200 flex items-center justify-center text-amber-700">
        <AlertTriangle className="size-7" aria-hidden />
      </div>
      <h2 className="mt-4 text-xl font-extrabold text-zinc-900 font-display">
        ยังเซ็นสัญญาตรงนี้ไม่ได้
      </h2>
      <p className="mt-2 text-sm text-zinc-600 leading-relaxed">{RECOVERY_COPY[problem]}</p>
      <p className="mt-2 text-sm text-zinc-600 leading-relaxed">
        กรุณากลับไปที่แบบฟอร์มแล้วกดถัดไปอีกครั้ง — ถ้าเคยกรอกในเครื่องนี้
        ระบบจะถามว่าต้องการใช้ข้อมูลเดิมไหม ไม่ต้องพิมพ์ใหม่ทั้งหมด
      </p>
      <Link
        href="/onboard"
        className="mt-5 inline-flex w-full items-center justify-center gap-2 py-3.5 rounded-2xl bg-[var(--color-brand-600)] text-white font-extrabold"
      >
        <ArrowLeft className="size-5" aria-hidden />
        กลับไปที่แบบฟอร์ม
      </Link>
      <p className="mt-3 text-xs text-zinc-500">
        ถ้ายังไม่ได้ กรุณาติดต่อฝ่ายบุคคลที่ติดต่อคุณไว้
      </p>
    </div>
  );
}

function GapScreen({ gaps }: { gaps: string[] }) {
  return (
    <div className={`${CARD} mt-4`}>
      <div className="size-14 rounded-2xl bg-amber-50 border-2 border-amber-200 flex items-center justify-center text-amber-700">
        <AlertTriangle className="size-7" aria-hidden />
      </div>
      <h2 className="mt-4 text-xl font-extrabold text-zinc-900 font-display">
        ข้อมูลยังไม่ครบสำหรับทำสัญญา
      </h2>
      <p className="mt-2 text-sm text-zinc-600 leading-relaxed">
        สัญญาจ้างต้องใช้ข้อมูลครบกว่าที่กรอกไว้ ยังขาด:
      </p>
      <ul className="mt-2 ml-5 list-disc text-sm text-zinc-800 space-y-0.5">
        {gaps.map((gap) => (
          <li key={gap} className="font-medium">
            {gap}
          </li>
        ))}
      </ul>
      <Link
        href="/onboard"
        className="mt-5 inline-flex w-full items-center justify-center gap-2 py-3.5 rounded-2xl bg-[var(--color-brand-600)] text-white font-extrabold"
      >
        <ArrowLeft className="size-5" aria-hidden />
        กลับไปกรอกให้ครบ
      </Link>
      <p className="mt-3 text-center text-xs text-zinc-500">
        ข้อมูลเดิมยังอยู่ · กรอกเฉพาะที่ขาดแล้วกดถัดไปได้เลย
      </p>
    </div>
  );
}

/* ======================================================= เซลฟี่ (กล้องสด + fallback) */

type CameraErrorKind = "denied" | "no-camera" | "in-use" | "no-support" | "other";

interface CameraError {
  kind: CameraErrorKind;
  detail: string;
}

/**
 * แปลง error ของ getUserMedia เป็นภาษาคน — ลอกตารางมาจาก
 * components/playland/face-capture.tsx ซึ่งผ่านการใช้งานจริงมาแล้ว
 */
function classifyCameraError(e: unknown): CameraError {
  const err = e as { name?: string; message?: string };
  if (err?.name === "NotAllowedError" || err?.name === "SecurityError") {
    return { kind: "denied", detail: "เบราว์เซอร์ยังไม่อนุญาตให้ใช้กล้อง" };
  }
  if (err?.name === "NotFoundError" || err?.name === "OverconstrainedError") {
    return { kind: "no-camera", detail: "ไม่พบกล้องในเครื่องนี้" };
  }
  if (err?.name === "NotReadableError") {
    return { kind: "in-use", detail: "กล้องถูกแอปอื่นใช้อยู่ · ปิดแอปนั้นก่อน" };
  }
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return { kind: "no-support", detail: "เบราว์เซอร์นี้เปิดกล้องในหน้าเว็บไม่ได้" };
  }
  return { kind: "other", detail: "เปิดกล้องไม่สำเร็จ" };
}

/**
 * ทำไมไม่ import <FaceCapture/> ของ playland มาตรง ๆ ทั้งที่ props พอใช้ได้:
 * ตัวนั้นเขียนสไตล์ฝังในไฟล์ด้วย inline style โทนมืด + class `pl-btn` และตัวแปร
 * `--pl-*` ซึ่งมีเฉพาะในสไตล์ชีตของ playland → วางบนการ์ดขาวของ /onboard แล้ว
 * ปุ่มจะกลายเป็นปุ่มเปล่าของเบราว์เซอร์ และ props ไม่มีช่องให้เปลี่ยนสไตล์เลย
 * จึงยกเฉพาะ "กลไก" มา (gesture gate · ตาราง error · ถ่ายใหม่ · พรีวิวกลับด้าน ·
 * fallback capture="user") แล้วแต่งด้วย token ของแบรนด์แทน
 *
 * ต่างจากต้นฉบับอีกจุด: ต้นทางคืนค่าเป็น base64 dataURL แต่ที่นี่คืนเป็น Blob
 * เพราะปลายทางคือ multipart upload — base64 บวมขึ้น ~33% ซึ่งกินโควตา body
 * ของ Vercel ไปฟรี ๆ
 *
 * เก็บทางหนี fallback ไว้ตามสเปก (ความเสี่ยงข้อ 2): ถ้าบังคับกล้องสดอย่างเดียว
 * คนที่ใช้มือถือเก่า/เบราว์เซอร์ที่ปิดกล้องจะไปต่อไม่ได้เลย และไม่มีเลขอ้างอิง
 * ให้ฝ่ายบุคคลตามเรื่องด้วย
 */
function SelfieCapture({
  previewUrl,
  onCaptured,
  onCleared,
}: {
  previewUrl: string | null;
  onCaptured: (blob: Blob) => void;
  onCleared: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<CameraError | null>(null);
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setLive(false);
  }, []);

  useEffect(() => stopStream, [stopStream]);

  // เปิดกล้องจากการ "กดปุ่ม" เท่านั้น — เบราว์เซอร์หลายตัวเมินคำขอที่ยิงจาก
  // useEffect โดยไม่มี user gesture และจะไม่ขึ้นกล่องขออนุญาตให้เลย
  const startCamera = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError({ kind: "no-support", detail: "เบราว์เซอร์นี้เปิดกล้องในหน้าเว็บไม่ได้" });
      return;
    }
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 1280 } },
        audio: false,
      });
      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      video.srcObject = stream;
      await video.play();
      setLive(true);
    } catch (e) {
      setError(classifyCameraError(e));
      stopStream();
    }
  }, [stopStream]);

  async function capture() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    setBusy(true);
    try {
      const blob = await encodeSquareJpeg(video, video.videoWidth, video.videoHeight);
      onCaptured(blob);
      stopStream();
      setError(null);
    } catch (e) {
      setError({ kind: "other", detail: e instanceof Error ? e.message : "ถ่ายรูปไม่สำเร็จ" });
    } finally {
      setBusy(false);
    }
  }

  async function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // เผื่อเลือกไฟล์เดิมซ้ำ
    if (!file) return;
    setBusy(true);
    try {
      const decoded = await decodeImageFile(file);
      // ย่อทุกกรณี — กล้องมือถือรุ่นใหม่ให้ไฟล์ 3-6 MB ซึ่งเกินเพดาน body ของ Vercel
      const blob = await encodeSquareJpeg(decoded.source, decoded.width, decoded.height);
      if (typeof ImageBitmap !== "undefined" && decoded.source instanceof ImageBitmap) {
        decoded.source.close(); // คืนหน่วยความจำรูป 12MP ทันที ไม่รอ GC
      }
      onCaptured(blob);
      setError(null);
    } catch (err) {
      setError({ kind: "other", detail: err instanceof Error ? err.message : "ใช้รูปนี้ไม่ได้" });
    } finally {
      setBusy(false);
    }
  }

  const showVideo = live && previewUrl === null;

  return (
    <div className="mt-2.5">
      <div className="relative w-full max-w-[300px] aspect-square rounded-2xl overflow-hidden border border-zinc-200 bg-zinc-100">
        {/* วิดีโอต้องอยู่ใน DOM ตลอด (แค่ซ่อน) — ถ้าให้ mount/unmount ตามสถานะ
            ref จะชี้ไปคนละ element กับตัวที่เพิ่งต่อ srcObject → จอดำ */}
        <video
          ref={videoRef}
          muted
          playsInline
          className={
            showVideo ? "w-full h-full object-cover -scale-x-100" : "hidden"
          }
        />

        {previewUrl !== null ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- blob: URL ในเครื่อง ไม่ควรผ่าน optimizer ของ next/image */}
            <img
              src={previewUrl}
              alt="รูปยืนยันตัวตนที่ถ่ายไว้"
              className="w-full h-full object-cover"
            />
            <span className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white">
              <CheckCircle2 className="size-3" aria-hidden />
              ถ่ายแล้ว
            </span>
          </>
        ) : showVideo ? null : error !== null ? (
          <div className="h-full grid place-items-center gap-2 p-5 text-center">
            <AlertTriangle className="size-7 text-amber-600" aria-hidden />
            <p className="text-[13px] font-bold text-zinc-800">{error.detail}</p>
            <p className="text-[11px] text-zinc-500 leading-relaxed">
              กดปุ่ม “เปิดกล้องของเครื่อง” ด้านล่างแทนได้ — แอปกล้องจะเปิดขึ้นมาให้ถ่ายสด
            </p>
          </div>
        ) : (
          <button
            type="button"
            onClick={startCamera}
            className="h-full w-full grid place-items-center gap-2 p-5 text-center bg-gradient-to-br from-zinc-50 to-zinc-100"
          >
            <span className="inline-flex p-3.5 rounded-full bg-[var(--color-brand-50)] text-[var(--color-brand-600)]">
              <ShieldQuestion className="size-7" aria-hidden />
            </span>
            <span className="text-[15px] font-bold text-zinc-800">แตะเพื่อเปิดกล้อง</span>
            <span className="text-[11px] text-zinc-500">เบราว์เซอร์จะถามขออนุญาตก่อน</span>
          </button>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="user"
        onChange={onFilePicked}
        className="hidden"
      />

      <div className="mt-2.5 flex flex-wrap gap-2">
        {previewUrl !== null ? (
          <button
            type="button"
            onClick={() => {
              onCleared();
              setError(null);
            }}
            className="inline-flex items-center gap-1.5 h-11 px-4 rounded-xl border border-zinc-200 text-sm font-bold text-zinc-700 hover:bg-zinc-50"
          >
            <RotateCcw className="size-4" aria-hidden />
            ถ่ายใหม่
          </button>
        ) : (
          <>
            {showVideo && (
              <button
                type="button"
                onClick={capture}
                disabled={busy}
                className="inline-flex items-center gap-1.5 h-11 px-5 rounded-xl bg-[var(--color-brand-600)] text-sm font-bold text-white disabled:bg-zinc-300"
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Camera className="size-4" aria-hidden />
                )}
                ถ่ายเลย
              </button>
            )}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 h-11 px-4 rounded-xl border border-zinc-200 text-sm font-bold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
            >
              <Upload className="size-4" aria-hidden />
              เปิดกล้องของเครื่อง
            </button>
          </>
        )}
      </div>
    </div>
  );
}
