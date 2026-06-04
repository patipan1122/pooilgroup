// POST /api/ledger/drive/sync — { id, companyId }
// Archive ONE expense's receipt original into Google Drive (เดือน/สาขา/หมวด) and
// store the shareable link on the row. Used by:
//   • the review-pane "ส่งเข้า Google Drive" button (manual / re-share)
//   • the LIFF/web capture app (fire-and-forget after a draft is created)
// Idempotent: if the row already has a Drive file, returns it unchanged.
// No-op-safe: if Drive env isn't configured, returns a friendly notConfigured.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { userHasModuleAccess } from "@/lib/auth/module-access";
import { isAdminTier } from "@/lib/auth/role-guards";
import { archiveReceiptToDrive, isDriveConfigured } from "@/lib/ledger/drive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!isAdminTier(session.user.role)) {
    const ok = await userHasModuleAccess(session.user, "ledger");
    if (!ok) return NextResponse.json({ ok: false, error: "ไม่มีสิทธิ์" }, { status: 403 });
  }

  if (!isDriveConfigured()) {
    return NextResponse.json({ ok: false, notConfigured: true, error: "ยังไม่ได้ตั้งค่า Google Drive" });
  }

  let body: { id?: string; companyId?: string };
  try {
    body = (await req.json()) as { id?: string; companyId?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "bad request" }, { status: 400 });
  }
  if (!body.id || !body.companyId) {
    return NextResponse.json({ ok: false, error: "missing id" }, { status: 400 });
  }

  const exp = await prisma.ledgerExpense.findFirst({
    where: { id: body.id, orgId: session.user.org_id, companyId: body.companyId },
    select: {
      id: true, docCode: true, vendor: true, docDate: true, thumbUrl: true,
      originalUrl: true, driveFileId: true, driveWebUrl: true, branchId: true,
      category: { select: { name: true } },
    },
  });
  if (!exp) return NextResponse.json({ ok: false, error: "ไม่พบรายการ" }, { status: 404 });

  // Already archived → idempotent.
  if (exp.driveFileId && exp.driveWebUrl) {
    return NextResponse.json({ ok: true, driveWebUrl: exp.driveWebUrl, already: true });
  }

  // The receipt bytes live on R2 (thumbUrl/originalUrl). Fetch them to upload.
  const srcUrl = exp.thumbUrl || exp.originalUrl;
  if (!srcUrl || !/^https?:\/\//.test(srcUrl)) {
    return NextResponse.json({ ok: false, error: "ไม่มีไฟล์รูปให้ส่ง" }, { status: 400 });
  }
  let bytes: Buffer;
  let mimeType = "image/jpeg";
  try {
    const r = await fetch(srcUrl, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(String(r.status));
    bytes = Buffer.from(await r.arrayBuffer());
    mimeType = r.headers.get("content-type") || "image/jpeg";
  } catch {
    return NextResponse.json({ ok: false, error: "โหลดรูปไม่สำเร็จ" }, { status: 502 });
  }

  // Period (Asia/Bangkok) for the month folder.
  const bkk = new Date(Date.now() + 7 * 3600_000);
  const period = `${bkk.getUTCFullYear()}-${String(bkk.getUTCMonth() + 1).padStart(2, "0")}`;
  let branchName: string | null = null;
  if (exp.branchId) {
    const b = await prisma.branch.findUnique({ where: { id: exp.branchId }, select: { name: true } });
    branchName = b?.name ?? null;
  }

  const drive = await archiveReceiptToDrive({
    bytes,
    mimeType,
    period,
    branchName,
    categoryName: exp.category?.name ?? null,
    docCode: exp.docCode,
    vendor: exp.vendor,
    docDate: exp.docDate ? exp.docDate.toISOString().slice(0, 10) : null,
  });
  if (!drive) {
    return NextResponse.json({ ok: false, error: "ส่งเข้า Drive ไม่สำเร็จ" }, { status: 502 });
  }

  await prisma.ledgerExpense.update({
    where: { id: exp.id },
    data: { driveFileId: drive.fileId, driveWebUrl: drive.webViewLink },
  });

  return NextResponse.json({ ok: true, driveWebUrl: drive.webViewLink });
}
