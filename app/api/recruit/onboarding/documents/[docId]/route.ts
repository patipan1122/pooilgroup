// GET /api/recruit/onboarding/documents/[docId]
//
// Authenticated proxy that streams ONE private onboarding document (บัตรประชาชน /
// ทะเบียนบ้าน / หน้าสมุดบัญชี / รูปถ่าย / วุฒิ / ลายเซ็น / เซลฟี่) from the org's
// Google Drive to an HR reviewer.
//
// Why a proxy at all: these files are deliberately PRIVATE in Drive (no
// "anyone with the link" permission is ever granted — see
// lib/recruit/onboarding-drive.ts and the P0 note in
// docs/BIGFEATURE_recruit-onboarding_SPEC.md). A raw Drive URL must never
// reach the browser; the only way to see a national-ID photo is through this
// route, with a live session, the recruit-admin role, and the document's own
// submission inside the caller's org.
//
// Leak policy: everything that is "not yours" answers 404, never 403 — a 403
// would confirm that a given docId exists in some other org.

import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { canRecruitAdmin } from "@/lib/recruit/role-guard";
import { fetchOnboardingDocumentBytes } from "@/lib/recruit/onboarding-drive";

// Private documents · never cached by a shared proxy or the browser disk cache.
const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
  "X-Content-Type-Options": "nosniff",
  // Anything unexpected renders inline as a download instead of executing.
  "Content-Security-Policy": "default-src 'none'; sandbox",
} as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function notFound() {
  return NextResponse.json({ error: "ไม่พบเอกสาร" }, { status: 404 });
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ docId: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "ต้องเข้าสู่ระบบ" }, { status: 401 });
  }
  // Same admin tier that can approve a submission can see its documents.
  if (!canRecruitAdmin(session.user.role)) return notFound();

  const { docId } = await ctx.params;
  // Guard the DB call: a non-UUID id would make Prisma throw on a @db.Uuid column.
  if (!UUID_RE.test(docId)) return notFound();

  const doc = await prisma.recruitOnboardingDocument.findFirst({
    // Org scoping lives on the parent submission — a document row has no orgId
    // of its own, so it must be joined, never trusted from the URL.
    where: { id: docId, submission: { orgId: session.user.org_id } },
    select: { driveFileId: true, fileName: true, mimeType: true },
  });
  if (!doc) return notFound();

  const file = await fetchOnboardingDocumentBytes(session.user.org_id, doc.driveFileId);
  if (!file) {
    // Drive disconnected / token expired / file removed upstream — this is an
    // operational failure, not a permissions one, so say so rather than 404.
    return NextResponse.json(
      { error: "เปิดเอกสารไม่ได้ · Google Drive ขององค์กรอาจยังไม่ได้เชื่อมต่อ" },
      { status: 502 },
    );
  }

  // Trust the row's stored mimeType only if Drive agrees it is one we render.
  const mimeType = file.mimeType || doc.mimeType || "application/octet-stream";
  const safeName = doc.fileName.replace(/["\r\n]/g, "").slice(0, 120) || "document";

  return new NextResponse(new Uint8Array(file.bytes), {
    status: 200,
    headers: {
      ...PRIVATE_HEADERS,
      "Content-Type": mimeType,
      "Content-Length": String(file.bytes.byteLength),
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(safeName)}`,
    },
  });
}
