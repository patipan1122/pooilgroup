// POST /api/ledger/r2/presign
// Presigned URL for direct client→R2 upload of a receipt image, before the
// draft expense is created. Mirrors app/api/chairops/r2/presign (auth + scope +
// org-namespaced key). Key shape matches lib/ledger/storage.receiptKey so the
// original and its later DB row line up.

import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { userHasModuleAccess } from "@/lib/auth/module-access";
import { isAdminTier } from "@/lib/auth/role-guards";
import { getUploadUrl } from "@/lib/r2/upload";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  companyId?: string;
  uploadId?: string; // client-generated id used to name the file
  contentType?: string;
}

function extFromContentType(ct: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/gif": "gif",
  };
  return map[ct.toLowerCase()] ?? "jpg";
}

export async function POST(req: NextRequest) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isAdminTier(session.user.role)) {
    const ok = await userHasModuleAccess(session.user, "ledger");
    if (!ok) return NextResponse.json({ error: "ไม่มีสิทธิ์" }, { status: 403 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  }

  const { companyId, uploadId, contentType } = body;
  if (!companyId) return NextResponse.json({ error: "missing-companyId" }, { status: 400 });
  if (!contentType || !contentType.startsWith("image/")) {
    return NextResponse.json({ error: "image-only" }, { status: 400 });
  }

  const orgId = session.user.org_id;

  // Verify company belongs to the caller's org (multi-tenant scope).
  const company = await prisma.company.findFirst({
    where: { id: companyId, orgId },
    select: { id: true, code: true },
  });
  if (!company) return NextResponse.json({ error: "company-not-found" }, { status: 404 });

  const safeUpload = (uploadId ?? `${session.user.id}-${Date.now()}`)
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 80);
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const ext = extFromContentType(contentType);
  // Org-namespaced so a public-URL leak can't reveal another org's tree.
  const key = `orgs/${orgId}/ledger/${yyyy}/${mm}/${company.code}/${safeUpload}.${ext}`;

  try {
    const { url, publicUrl } = await getUploadUrl(key, contentType);
    return NextResponse.json({ url, publicUrl, key });
  } catch (err) {
    console.error("[ledger:r2:presign] failed", err);
    return NextResponse.json({ error: "presign-failed" }, { status: 500 });
  }
}
