// Public R2 upload endpoint
// Validates slug, content type, size · returns signed URL
// Rate limit: 20 req/IP/15min (gentle for legit applicants attaching multiple files)

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUploadUrl } from "@/lib/r2/upload";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  ALLOWED_FILE_MIMES,
  MAX_FILE_SIZE,
} from "@/lib/recruit/types";

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";
  // DB-backed shared limiter — the per-instance Map below was useless on
  // Vercel's multi-instance serverless (each invocation could pick a fresh
  // instance with an empty bucket, defeating the rate limit entirely).
  const rl = await checkRateLimit({
    bucket: `recruit-upload:ip:${ip}`,
    max: 20,
    windowSec: 15 * 60,
  });
  if (rl.limited) {
    return NextResponse.json(
      { error: "ลองอีกครั้งในอีกสักครู่" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  let body: {
    slug?: string;
    fileName?: string;
    contentType?: string;
    size?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { slug, fileName, contentType, size } = body;
  if (!slug || !fileName || !contentType || typeof size !== "number") {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }

  // Validate MIME
  if (!ALLOWED_FILE_MIMES.includes(contentType as (typeof ALLOWED_FILE_MIMES)[number])) {
    return NextResponse.json(
      { error: `ชนิดไฟล์ไม่รองรับ: ${contentType}` },
      { status: 400 },
    );
  }
  if (size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "ไฟล์ใหญ่เกิน 5 MB" }, { status: 400 });
  }
  // P1-8 partial fix: filename ext must match contentType (catches `.exe` lying as image/jpeg).
  // Note: real magic-bytes check requires server-side stream (current flow is client→R2 direct
  // via signed URL) · CEO architectural call to add R2-side post-validation worker.
  const expectedExts: Record<string, string[]> = {
    "image/jpeg": ["jpg", "jpeg"],
    "image/png": ["png"],
    "image/webp": ["webp"],
    "application/pdf": ["pdf"],
    "application/msword": ["doc"],
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
  };
  const allowedExts = expectedExts[contentType];
  if (allowedExts) {
    const lower = fileName.toLowerCase();
    if (!allowedExts.some((ext) => lower.endsWith(`.${ext}`))) {
      return NextResponse.json(
        { error: `นามสกุลไฟล์ไม่ตรงกับ ${contentType}` },
        { status: 400 },
      );
    }
  }

  // Validate posting open
  const posting = await prisma.recruitJobPosting.findUnique({
    where: { slug },
    select: { id: true, status: true, orgId: true },
  });
  if (!posting || posting.status !== "OPEN") {
    return NextResponse.json({ error: "ประกาศปิดรับแล้ว" }, { status: 400 });
  }

  // Sanitize filename + use crypto.randomUUID() (not Math.random) so keys
  // aren't guessable. Even though R2 keys are large already, a guessable
  // suffix narrows the search space if any key fragment ever leaks.
  const safe = fileName.replace(/[^a-zA-Z0-9._\-ก-๙]/g, "_").slice(0, 100);
  const uniq = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const key = `recruit/${posting.orgId}/${slug}/${Date.now()}-${uniq}-${safe}`;

  try {
    const { url, publicUrl } = await getUploadUrl(key, contentType);
    return NextResponse.json({ url, key, publicUrl });
  } catch (e) {
    console.error("[recruit-upload]", e);
    return NextResponse.json({ error: "upload setup failed" }, { status: 500 });
  }
}
