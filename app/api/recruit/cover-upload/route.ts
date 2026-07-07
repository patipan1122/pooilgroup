// Admin R2 upload for a posting's COVER image (workplace photo).
// Separate from the public /api/recruit/upload (which requires status=OPEN and
// is for applicant attachments) — this one is admin-authenticated and works on
// DRAFT postings so HR can add the cover while still editing.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { getUploadUrl } from "@/lib/r2/upload";
import { canRecruitWrite } from "@/lib/recruit/role-guard";

const COVER_MIMES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const COVER_MAX_SIZE = 10 * 1024 * 1024; // 10 MB (admin, workplace photos)

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!canRecruitWrite(session.user.role)) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์" }, { status: 403 });
  }

  let body: {
    postingId?: string;
    fileName?: string;
    contentType?: string;
    size?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { postingId, fileName, contentType, size } = body;
  if (!postingId || !fileName || !contentType || typeof size !== "number") {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }

  const ext = COVER_MIMES[contentType];
  if (!ext) {
    return NextResponse.json(
      { error: "รองรับเฉพาะรูป JPG / PNG / WEBP" },
      { status: 400 },
    );
  }
  if (size > COVER_MAX_SIZE) {
    return NextResponse.json({ error: "รูปใหญ่เกิน 10 MB" }, { status: 400 });
  }

  // Posting must belong to this org (any status — cover can be set while DRAFT)
  const posting = await prisma.recruitJobPosting.findFirst({
    where: { id: postingId, orgId: session.user.org_id },
    select: { slug: true, orgId: true },
  });
  if (!posting) {
    return NextResponse.json({ error: "ไม่พบประกาศ" }, { status: 404 });
  }

  const uniq = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const key = `recruit/${posting.orgId}/${posting.slug}/cover-${Date.now()}-${uniq}.${ext}`;

  try {
    const { url, publicUrl } = await getUploadUrl(key, contentType);
    return NextResponse.json({ url, key, publicUrl });
  } catch (e) {
    console.error("[recruit-cover-upload]", e);
    return NextResponse.json({ error: "upload setup failed" }, { status: 500 });
  }
}
