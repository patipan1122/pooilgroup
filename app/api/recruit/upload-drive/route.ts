// Public upload endpoint that stores an applicant file in the org's Google
// Drive (folder "Recruit — ใบสมัครงาน") and returns a shareable link.
//
// Unlike the R2 route (browser presigns + PUTs directly), the file routes
// THROUGH this server function so we can upload it with the org's Drive token
// → capped below Vercel's ~4.5MB serverless body limit. Resumes fit; bigger
// portfolios are meant to be attached as a link instead.
//
// Best-effort: if Drive isn't connected / the file is too big, we return
// { fallback: true } so the client falls back to R2 and the applicant is never
// blocked.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { ALLOWED_FILE_MIMES } from "@/lib/recruit/types";
import { uploadApplicantFileToDrive } from "@/lib/recruit/drive";

export const runtime = "nodejs"; // Buffer + prisma + Drive REST
export const dynamic = "force-dynamic";

const MAX_DRIVE_UPLOAD = 4 * 1024 * 1024; // 4 MB (server body-limit headroom)

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";
  const rl = await checkRateLimit({
    bucket: `recruit-upload-drive:ip:${ip}`,
    max: 20,
    windowSec: 15 * 60,
  });
  if (rl.limited) {
    return NextResponse.json(
      { error: "ลองอีกครั้งในอีกสักครู่" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "invalid form" }, { status: 400 });
  }
  const slug = String(form.get("slug") ?? "");
  const file = form.get("file");
  if (!slug || !(file instanceof File)) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }

  const contentType = file.type;
  if (
    !ALLOWED_FILE_MIMES.includes(
      contentType as (typeof ALLOWED_FILE_MIMES)[number],
    )
  ) {
    return NextResponse.json(
      { error: `ชนิดไฟล์ไม่รองรับ: ${contentType}` },
      { status: 400 },
    );
  }
  if (file.size > MAX_DRIVE_UPLOAD) {
    // Too big to route through the server → fall back to R2 (direct browser PUT).
    return NextResponse.json({ fallback: true, reason: "too_large" });
  }

  const posting = await prisma.recruitJobPosting.findUnique({
    where: { slug },
    select: { id: true, status: true, orgId: true, title: true },
  });
  if (!posting || posting.status !== "OPEN") {
    return NextResponse.json({ error: "ประกาศปิดรับแล้ว" }, { status: 400 });
  }

  const safeName =
    file.name.replace(/[^a-zA-Z0-9._\-ก-๙ ]/g, "_").slice(0, 120) || "file";
  const bytes = Buffer.from(await file.arrayBuffer());

  const drive = await uploadApplicantFileToDrive({
    orgId: posting.orgId,
    postingLabel: posting.title,
    fileName: `${Date.now()}-${safeName}`,
    mimeType: contentType,
    bytes,
  });
  if (!drive) {
    // Drive not connected / upload failed → client falls back to R2.
    return NextResponse.json({ fallback: true, reason: "drive_unavailable" });
  }

  return NextResponse.json({
    ok: true,
    storage: "drive",
    key: drive.fileId,
    url: drive.viewUrl,
    name: safeName,
    size: file.size,
    mime: contentType,
  });
}
