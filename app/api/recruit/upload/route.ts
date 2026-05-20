// Public R2 upload endpoint
// Validates slug, content type, size · returns signed URL
// Rate limit: 20 req/IP/15min (gentle for legit applicants attaching multiple files)

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUploadUrl } from "@/lib/r2/upload";
import {
  ALLOWED_FILE_MIMES,
  MAX_FILE_SIZE,
} from "@/lib/recruit/types";

const ipBuckets = new Map<string, { count: number; resetAt: number }>();

function rateLimit(ip: string, max = 20, windowMs = 15 * 60 * 1000): boolean {
  const now = Date.now();
  const cur = ipBuckets.get(ip);
  if (!cur || cur.resetAt < now) {
    ipBuckets.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (cur.count >= max) return false;
  cur.count++;
  return true;
}

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";
  if (!rateLimit(ip)) {
    return NextResponse.json(
      { error: "ลองอีกครั้งในอีกสักครู่" },
      { status: 429 },
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

  // Validate posting open
  const posting = await prisma.recruitJobPosting.findUnique({
    where: { slug },
    select: { id: true, status: true, orgId: true },
  });
  if (!posting || posting.status !== "OPEN") {
    return NextResponse.json({ error: "ประกาศปิดรับแล้ว" }, { status: 400 });
  }

  // Sanitize filename
  const safe = fileName.replace(/[^a-zA-Z0-9._\-ก-๙]/g, "_").slice(0, 100);
  const key = `recruit/${posting.orgId}/${slug}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`;

  try {
    const { url, publicUrl } = await getUploadUrl(key, contentType);
    return NextResponse.json({ url, key, publicUrl });
  } catch (e) {
    console.error("[recruit-upload]", e);
    return NextResponse.json({ error: "upload setup failed" }, { status: 500 });
  }
}
