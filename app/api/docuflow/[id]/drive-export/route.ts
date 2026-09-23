// POST /api/docuflow/[id]/drive-export
// ────────────────────────────────────────────────────────────────────
// Export a document (or its final signed version) to the org's existing
// Google Drive connection (reused from ChairOps — no new OAuth). Opt-in,
// admin-triggered, org-scoped. See lib/docuflow/drive-export.ts for the
// actual transfer logic; this route only gates + shapes the response.
// ────────────────────────────────────────────────────────────────────

import { NextResponse, type NextRequest } from "next/server";
import { zUUID } from "@/lib/zod-helpers";
import { requireSession } from "@/lib/auth/session";
import { isProgramAdminTier } from "@/lib/auth/role-guards";
import { prisma } from "@/lib/prisma";
import { exportDocumentToDrive } from "@/lib/docuflow/drive-export";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const IdSchema = zUUID();

const REASON_MESSAGE: Record<string, string> = {
  not_connected: "ยังไม่ได้เชื่อมต่อ Google Drive",
  too_large: "ไฟล์ใหญ่เกิน 100MB ส่งออกไม่ได้ตอนนี้",
  upload_failed: "ส่งออกไม่สำเร็จ ลองใหม่อีกครั้ง",
};

const REASON_STATUS: Record<string, number> = {
  not_connected: 409,
  too_large: 413,
  upload_failed: 502,
};

export async function POST(_req: NextRequest, ctx: RouteContext) {
  const session = await requireSession();
  if (!isProgramAdminTier(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await ctx.params;
  if (!IdSchema.safeParse(id).success) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const orgId = session.user.org_id;

  // Confirm the document belongs to this org (and is active) before doing
  // any Drive work — cross-tenant guard, matches every other mutating
  // DocuFlow route (see app/api/docuflow/[id]/route.ts).
  const doc = await prisma.document.findFirst({
    where: { id, orgId },
    select: { id: true, isActive: true },
  });
  if (!doc) {
    return NextResponse.json({ error: "ไม่พบเอกสาร" }, { status: 404 });
  }
  if (!doc.isActive) {
    return NextResponse.json({ error: "เอกสารถูกลบแล้ว" }, { status: 409 });
  }

  const result = await exportDocumentToDrive({
    orgId,
    documentId: id,
    userId: session.user.id,
  });

  if (!result.ok) {
    return NextResponse.json(
      { success: false, reason: result.reason, error: REASON_MESSAGE[result.reason] },
      { status: REASON_STATUS[result.reason] ?? 500 },
    );
  }

  return NextResponse.json({ success: true, driveUrl: result.driveUrl });
}
