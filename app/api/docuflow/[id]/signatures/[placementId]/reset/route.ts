// POST /api/docuflow/[id]/signatures/[placementId]/reset
// ────────────────────────────────────────────────────────────────────
// "ขอเซ็นใหม่" — admin clears a signature placement so the same signer
// can redo. Preserves coords + role/user (only signedAt, signedImageKey
// are cleared). Audit-logged.
//
// Only valid for placementType='signature'. Auto-fill types (date/name/
// text) are immutable at embed time — to redo those, admin should
// delete + re-create.
// ────────────────────────────────────────────────────────────────────

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { zUUID } from "@/lib/zod-helpers";
import { requireSession } from "@/lib/auth/session";
import { requireAdminTier } from "@/lib/auth/role-guards";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit/log";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string; placementId: string }>;
};

const IdSchema = zUUID();

export async function POST(_req: NextRequest, ctx: RouteContext) {
  const session = await requireSession();
  requireAdminTier(session.user.role);

  const { id: documentId, placementId } = await ctx.params;
  if (
    !IdSchema.safeParse(documentId).success ||
    !IdSchema.safeParse(placementId).success
  ) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const orgId = session.user.org_id;

  const placement = await prisma.documentSignaturePlacement.findFirst({
    where: { id: placementId, orgId, documentId },
  });
  if (!placement) {
    return NextResponse.json(
      { error: "ไม่พบจุดเซ็นนี้" },
      { status: 404 },
    );
  }

  if (placement.placementType && placement.placementType !== "signature") {
    return NextResponse.json(
      {
        error:
          "จุดนี้เป็นช่องเติมอัตโนมัติ ไม่สามารถ ‘ขอเซ็นใหม่’ ได้ (ลบแล้วสร้างใหม่แทน)",
      },
      { status: 400 },
    );
  }

  if (!placement.signedAt) {
    return NextResponse.json(
      { error: "จุดนี้ยังไม่เคยเซ็น ไม่ต้อง reset" },
      { status: 400 },
    );
  }

  await prisma.documentSignaturePlacement.update({
    where: { id: placementId },
    data: {
      signedAt: null,
      signedImageKey: null,
      // Keep signedFileKey on row so the previous signed PDF stays
      // navigable until a new one is generated; it will be overwritten
      // the next time `embedSignatures` runs successfully.
    },
  });

  await audit({
    orgId,
    userId: session.user.id,
    action: "DOCUFLOW_SIGN_PLACEMENT_RESET",
    resourceType: "document_signature_placement",
    resourceId: placementId,
    diff: {
      old: {
        signedAt: placement.signedAt?.toISOString() ?? null,
        signedImageKey: placement.signedImageKey,
      },
      new: {
        signedAt: null,
        signedImageKey: null,
      },
    },
  });

  return NextResponse.json({ success: true });
}
