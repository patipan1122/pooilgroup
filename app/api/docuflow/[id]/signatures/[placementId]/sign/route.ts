// POST /api/docuflow/[id]/signatures/[placementId]/sign
// ────────────────────────────────────────────────────────────────────
// Signer endpoint. Accepts a signature PNG data URL from the canvas,
// uploads it to R2, updates the placement (signedAt + signedImageKey),
// and — if every placement on the document is now signed — kicks off
// the embed step that produces the final signed PDF.
//
// Auth model:
//   - placement.signerUserId set → caller must be that user (logged in)
//   - placement.signerUserId null but signerName set → any signed-in
//     user with the link can sign (org-scoped). Re-signing is blocked.
// ────────────────────────────────────────────────────────────────────

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { zUUID } from "@/lib/zod-helpers";
import { requireSession } from "@/lib/auth/session";
import { isAdminTier } from "@/lib/auth/role-guards";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit/log";
import { putObject } from "@/lib/r2/upload";
import { embedSignatures } from "@/lib/docuflow/signature";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string; placementId: string }>;
};

const IdSchema = zUUID();

const BodySchema = z.object({
  // PNG data URL: "data:image/png;base64,iVBOR..."
  imageDataUrl: z
    .string()
    .min(32)
    .max(8 * 1024 * 1024) // 8MB cap (data URL is ~33% larger than bytes)
    .refine((v) => v.startsWith("data:image/png;base64,"), {
      message: "Expected base64 PNG data URL",
    }),
});

function decodeDataUrl(dataUrl: string): Buffer {
  const base64 = dataUrl.split(",")[1] ?? "";
  return Buffer.from(base64, "base64");
}

function buildSignatureKey(
  orgId: string,
  placementId: string,
  ts: number,
): string {
  return `signatures/${orgId}/${placementId}/${ts}.png`;
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const session = await requireSession();
  const { id: documentId, placementId } = await ctx.params;

  if (
    !IdSchema.safeParse(documentId).success ||
    !IdSchema.safeParse(placementId).success
  ) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "ข้อมูลลายเซ็นไม่ถูกต้อง", details: parsed.error.issues },
      { status: 400 },
    );
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

  // Auto-fill placement types (date / name / text) are stamped at embed time
  // — they don't accept a manual signature.
  if (placement.placementType && placement.placementType !== "signature") {
    return NextResponse.json(
      {
        error:
          "จุดนี้เป็นช่องเติมอัตโนมัติ (วันที่/ชื่อ/ข้อความ) ไม่ต้องเซ็นด้วยตนเอง",
      },
      { status: 400 },
    );
  }

  // Auth:
  //   - signerUserId set → caller must match exactly
  //   - signerUserId null → admin-tier fallback only (mirror of /sign page);
  //     prevents any logged-in org user from signing open placements on
  //     sensitive admin docs.
  if (placement.signerUserId) {
    if (placement.signerUserId !== session.user.id) {
      return NextResponse.json(
        { error: "คุณไม่ได้รับสิทธิ์เซ็นจุดนี้" },
        { status: 403 },
      );
    }
  } else if (!isAdminTier(session.user.role)) {
    return NextResponse.json(
      { error: "คุณไม่ได้รับสิทธิ์เซ็นจุดนี้" },
      { status: 403 },
    );
  }

  // Re-signing not allowed (admin can delete + recreate to redo)
  if (placement.signedAt) {
    return NextResponse.json(
      { error: "จุดเซ็นนี้มีลายเซ็นแล้ว" },
      { status: 409 },
    );
  }

  // Upload PNG to R2
  const ts = Date.now();
  const key = buildSignatureKey(orgId, placementId, ts);
  const buf = decodeDataUrl(parsed.data.imageDataUrl);
  if (buf.length < 64) {
    return NextResponse.json(
      { error: "ลายเซ็นว่างเปล่า กรุณาเซ็นอีกครั้ง" },
      { status: 400 },
    );
  }

  try {
    await putObject(key, buf, "image/png");
  } catch (err) {
    console.error("[sign POST] R2 upload failed", err);
    return NextResponse.json(
      { error: "อัปโหลดลายเซ็นไม่สำเร็จ ลองใหม่" },
      { status: 502 },
    );
  }

  // Save placement
  await prisma.documentSignaturePlacement.update({
    where: { id: placementId },
    data: {
      signedAt: new Date(ts),
      signedImageKey: key,
    },
  });

  await audit({
    orgId,
    userId: session.user.id,
    action: "DOCUFLOW_SIGNATURE_SIGNED",
    resourceType: "document_signature_placement",
    resourceId: placementId,
    diff: {
      new: {
        documentId,
        signedAt: new Date(ts).toISOString(),
        signedImageKey: key,
      },
    },
  });

  // If every placement is signed, build the final signed PDF.
  const remaining = await prisma.documentSignaturePlacement.count({
    where: { orgId, documentId, signedAt: null },
  });

  let signedFileKey: string | null = null;
  if (remaining === 0) {
    try {
      const result = await embedSignatures(documentId, orgId);
      if (result?.signedFileKey) {
        signedFileKey = result.signedFileKey;
      }
    } catch (err) {
      // Don't fail the user request — embed can be retried by an admin
      // by re-saving any placement, or via a manual endpoint later.
      console.error("[sign POST] embedSignatures failed", err);
    }
  }

  return NextResponse.json({
    success: true,
    remaining,
    signedFileKey,
  });
}
