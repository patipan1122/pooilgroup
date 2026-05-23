// Admin-only image upload for IQ question prompts (e.g. left/right/up/down image)
// Different from /api/recruit/upload (which is public for applicants attaching files)
//
// - Requires authenticated session with canRecruitWrite role
// - Limits to images only (jpg/png/webp · 5 MB)
// - Returns signed PUT URL + final public URL for storage in field.imageUrl

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { canRecruitWrite } from "@/lib/recruit/role-guard";
import { getUploadUrl } from "@/lib/r2/upload";

const ALLOWED_IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5 MB

export async function POST(req: NextRequest) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canRecruitWrite(session.user.role)) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์" }, { status: 403 });
  }

  let body: {
    fileName?: string;
    contentType?: string;
    size?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { fileName, contentType, size } = body;
  if (!fileName || !contentType || typeof size !== "number") {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }

  if (!ALLOWED_IMAGE_MIMES.includes(contentType as (typeof ALLOWED_IMAGE_MIMES)[number])) {
    return NextResponse.json(
      { error: `รองรับเฉพาะ jpg / png / webp · พบ ${contentType}` },
      { status: 400 },
    );
  }
  if (size > MAX_IMAGE_SIZE) {
    return NextResponse.json({ error: "ไฟล์ใหญ่เกิน 5 MB" }, { status: 400 });
  }

  const safe = fileName.replace(/[^a-zA-Z0-9._\-ก-๙]/g, "_").slice(0, 100);
  const uniq = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const key = `recruit-questions/${session.user.org_id}/${Date.now()}-${uniq}-${safe}`;

  try {
    const { url, publicUrl } = await getUploadUrl(key, contentType);
    return NextResponse.json({ url, key, publicUrl });
  } catch (e) {
    console.error("[recruit-question-image-upload]", e);
    return NextResponse.json({ error: "upload setup failed" }, { status: 500 });
  }
}
