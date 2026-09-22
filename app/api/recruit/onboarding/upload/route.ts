// Recruit Onboarding · PUBLIC document upload (ระบบรับพนักงานใหม่ออนไลน์)
// ────────────────────────────────────────────────────────────────────
// POST multipart/form-data { file, docType, submissionDraftId } → Google Drive.
//
// Key difference from the sibling public route `app/api/recruit/upload/route.ts`:
// that one hands the browser a presigned R2 URL and the bytes never touch this
// server. Drive has no presigned-upload equivalent we can hand a browser, so
// here the bytes DO route through the server and are forwarded with the org's
// Drive token (same shape as app/api/recruit/upload-drive/route.ts). Two
// consequences worth knowing:
//   1. Vercel's serverless request-body ceiling (~4.5 MB) is LOWER than
//      ONBOARDING_MAX_FILE_SIZE (8 MB) — an 8 MB phone photo is rejected by the
//      platform before this handler ever runs. The client should downscale
//      camera shots before POSTing; the size check below is the second gate,
//      not the first.
//   2. There is NO R2 fallback for this feature (CEO decision, see
//      lib/recruit/onboarding-drive.ts header + spec P0). If Drive is down we
//      fail loudly in Thai instead of returning `{ fallback: true }` the way
//      upload-drive does — a silently-succeeded upload here would mean an ID
//      card that nobody ever stored.
//
// No DB rows are written here: the RecruitOnboardingSubmission row does not
// exist yet at upload time. The client holds the returned descriptors and posts
// them back to /api/recruit/onboarding/submit, which persists them inside the
// one submit transaction.
//
// Fully unauthenticated (permanent public link, no session, no per-person code)
// → rate limit is the ONLY gate, and it is mandatory.

import { NextResponse, type NextRequest } from "next/server";
import { zUUID } from "@/lib/zod-helpers";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { POOILGROUP_ORG_ID } from "@/lib/rentspace/format";
import {
  isOnboardingDriveReady,
  uploadOnboardingDocumentToDrive,
} from "@/lib/recruit/onboarding-drive";
import {
  ONBOARDING_ALLOWED_DOC_EXTENSIONS,
  ONBOARDING_ALLOWED_DOC_MIMES,
  ONBOARDING_DOC_TYPES,
  ONBOARDING_MAX_CAPTURE_SIZE,
  ONBOARDING_MAX_FILE_SIZE,
} from "@/lib/recruit/onboarding-types";

export const runtime = "nodejs"; // Buffer + Drive REST
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type AllowedMime = (typeof ONBOARDING_ALLOWED_DOC_MIMES)[number];

// Wire-level upload kinds = the 6 persisted doc types PLUS the two live
// captures taken on the signing screen. SIGNATURE/SELFIE deliberately do NOT
// exist in the migrated `RecruitOnboardingDocType` enum — the submit route
// stores both as `OTHER` rows and the RecruitOnboardingConsent row points at
// them via signatureDocId/selfieDocId (schema comment: "plain pointer, no FK").
// Keeping them distinct on the wire is what lets us apply the tighter
// capture-only rules below (images only, 4 MB not 8 MB).
const CAPTURE_KINDS = ["SIGNATURE", "SELFIE"] as const;
const UPLOAD_KINDS = [...ONBOARDING_DOC_TYPES, ...CAPTURE_KINDS] as const;
type UploadKind = (typeof UPLOAD_KINDS)[number];
type CaptureKind = (typeof CAPTURE_KINDS)[number];

function isCaptureKind(kind: UploadKind): kind is CaptureKind {
  return (CAPTURE_KINDS as readonly string[]).includes(kind);
}

// A drawn signature / live selfie is always a canvas or camera frame — never a
// PDF. Narrowing the allowlist here (rather than adding a new constant) keeps
// lib/recruit/onboarding-types.ts as the single source of truth.
const CAPTURE_MIMES: readonly AllowedMime[] = ONBOARDING_ALLOWED_DOC_MIMES.filter(
  (m): m is AllowedMime => m !== "application/pdf",
);

// Extension must agree with the declared MIME — same defence as
// app/api/recruit/upload/route.ts (catches `.exe` claiming to be image/jpeg).
// Magic-byte sniffing is still not done; unlike that route we DO hold the bytes
// here, so it is a future hardening option rather than an impossibility.
const EXTS_BY_MIME: Record<AllowedMime, readonly string[]> = {
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
  "application/pdf": ["pdf"],
};

function fileExtension(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot < 0 || dot === name.length - 1) return null;
  return name.slice(dot + 1).toLowerCase();
}

/** Strip anything that could confuse Drive's file naming; keep Thai letters. */
function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._\-ก-๙ ]/g, "_").slice(0, 120) || "file";
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  // 20 uploads / IP / 15 min — matches the existing public-recruit convention
  // (a legit candidate uploads 6 documents + signature + selfie = 8).
  const rl = await checkRateLimit({
    bucket: `recruit-onboarding-upload:ip:${ip}`,
    max: 20,
    windowSec: 15 * 60,
  });
  if (rl.limited) {
    return NextResponse.json(
      { error: "อัปโหลดถี่เกินไป · ลองอีกครั้งในอีกสักครู่" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "ข้อมูลที่ส่งมาไม่ถูกต้อง" }, { status: 400 });
  }

  const file = form.get("file");
  const rawDocType = String(form.get("docType") ?? "");
  const rawDraftId = String(form.get("submissionDraftId") ?? "");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "ไม่พบไฟล์ที่อัปโหลด" }, { status: 400 });
  }
  if (!(UPLOAD_KINDS as readonly string[]).includes(rawDocType)) {
    return NextResponse.json({ error: "ประเภทเอกสารไม่ถูกต้อง" }, { status: 400 });
  }
  const docType = rawDocType as UploadKind;

  // The draft id groups one candidate's uploads into a single Drive folder
  // before any submission row exists (UX persona §2: the public link has no
  // per-person code, so the client generates a crypto.randomUUID() per draft).
  if (!zUUID().safeParse(rawDraftId).success) {
    return NextResponse.json({ error: "รหัสอ้างอิงแบบฟอร์มไม่ถูกต้อง" }, { status: 400 });
  }

  const capture = isCaptureKind(docType);
  const mimeType = file.type;
  const allowedMimes: readonly AllowedMime[] = capture
    ? CAPTURE_MIMES
    : ONBOARDING_ALLOWED_DOC_MIMES;
  if (!(allowedMimes as readonly string[]).includes(mimeType)) {
    return NextResponse.json(
      {
        error: capture
          ? "ลายเซ็น/รูปเซลฟี่ต้องเป็นรูปภาพเท่านั้น (JPG · PNG · WEBP)"
          : `ชนิดไฟล์ไม่รองรับ: ${mimeType || "ไม่ทราบชนิด"} (รองรับ JPG · PNG · WEBP · PDF)`,
      },
      { status: 400 },
    );
  }
  const declaredMime = mimeType as AllowedMime;

  const maxSize = capture ? ONBOARDING_MAX_CAPTURE_SIZE : ONBOARDING_MAX_FILE_SIZE;
  if (file.size > maxSize) {
    const mb = Math.round(maxSize / (1024 * 1024));
    return NextResponse.json(
      { error: `ไฟล์ใหญ่เกิน ${mb} MB · กรุณาย่อรูปแล้วลองใหม่` },
      { status: 400 },
    );
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "ไฟล์ว่าง · กรุณาเลือกไฟล์ใหม่" }, { status: 400 });
  }

  // Extension ↔ MIME consistency.
  //
  // For candidate-picked documents this is strict. For the two live captures it
  // is not: a canvas/webcam Blob appended to FormData arrives named "blob" with
  // no extension at all, and rejecting that would strand every candidate at the
  // signing step over a filename that carries no user intent. So for captures we
  // synthesise the name from the (already allowlisted) MIME instead.
  const ext = fileExtension(file.name);
  let outName: string;
  if (capture && (!ext || !EXTS_BY_MIME[declaredMime].includes(ext))) {
    outName = `${docType.toLowerCase()}.${EXTS_BY_MIME[declaredMime][0]}`;
  } else {
    if (!ext || !(ONBOARDING_ALLOWED_DOC_EXTENSIONS as readonly string[]).includes(ext)) {
      return NextResponse.json(
        { error: "นามสกุลไฟล์ไม่รองรับ (รองรับ .jpg .jpeg .png .webp .pdf)" },
        { status: 400 },
      );
    }
    if (!EXTS_BY_MIME[declaredMime].includes(ext)) {
      return NextResponse.json(
        { error: `นามสกุลไฟล์ไม่ตรงกับชนิดไฟล์จริง (${declaredMime})` },
        { status: 400 },
      );
    }
    outName = safeFileName(file.name);
  }

  // Fail loudly, never silently: a candidate must not believe their ID card was
  // stored when the org's Drive connection is down. No R2 fallback exists here.
  if (!(await isOnboardingDriveReady(POOILGROUP_ORG_ID))) {
    return NextResponse.json(
      {
        error:
          "ระบบเก็บเอกสารยังไม่พร้อมใช้งานชั่วคราว · กรุณาติดต่อฝ่ายบุคคล แล้วลองใหม่อีกครั้ง",
      },
      { status: 503 },
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  // Prefix with the wire kind + timestamp: SIGNATURE/SELFIE both persist as
  // docType OTHER in the DB, so the Drive filename is what tells HR which is
  // which when they open the folder directly.
  const driveFileName = `${docType}-${Date.now()}-${outName}`;

  const uploaded = await uploadOnboardingDocumentToDrive({
    orgId: POOILGROUP_ORG_ID,
    submissionId: rawDraftId, // folder key — the submission row does not exist yet
    fileName: driveFileName,
    mimeType: declaredMime,
    bytes,
  });
  if (!uploaded) {
    console.error("[onboarding-upload] drive upload returned null", {
      docType,
      draftId: rawDraftId,
      size: file.size,
    });
    return NextResponse.json(
      { error: "อัปโหลดไฟล์ไม่สำเร็จ · กรุณาลองใหม่อีกครั้ง" },
      { status: 502 },
    );
  }

  // The client keeps these four values per file and posts them back at submit
  // time; that is the only record of the upload until the submit transaction.
  return NextResponse.json({
    fileId: uploaded.fileId,
    folderId: uploaded.folderId,
    docType,
    fileName: driveFileName,
    mimeType: declaredMime,
  });
}
