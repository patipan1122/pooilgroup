// POST /api/docuflow/[id]/signatures/[placementId]/sign
// ────────────────────────────────────────────────────────────────────
// Signer endpoint. Accepts either:
//   (a) a signature PNG data URL from the canvas (`imageDataUrl`,
//       optionally `saveAsDefault: true` to also save it as the user's
//       reusable signature), or
//   (b) a one-tap request to reuse the caller's already-saved signature
//       (`useSavedSignature: true`).
// Either way, uploads the resulting PNG to a FRESH key dedicated to this
// placement, updates the placement (signedAt + signedImageKey), and — if
// every placement on the document is now signed — kicks off the embed
// step that produces the final signed PDF.
//
// Auth model:
//   - placement.signerUserId set → caller must be that user (logged in)
//   - placement.signerUserId null but signerName set → any signed-in
//     user with the link can sign (org-scoped). Re-signing is blocked.
//
// Immutability note (useSavedSignature path): `signedImageKey` NEVER
// points directly at the user's `savedSignatureKey` — the saved-signature
// bytes are copied into a new placement-dedicated key. This keeps every
// placement's signed artifact immutable even if the user later changes
// or clears their saved signature; a previously-signed document must
// never retroactively appear to change. `embedSignatures()` needs zero
// changes for this — it still just reads `signedImageKey` as before.
// ────────────────────────────────────────────────────────────────────

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { zUUID } from "@/lib/zod-helpers";
import { requireSession } from "@/lib/auth/session";
import { isProgramAdminTier } from "@/lib/auth/role-guards";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit/log";
import { deleteObject, getObject, putObject } from "@/lib/r2/upload";
import { embedSignatures } from "@/lib/docuflow/signature";
import { saveMySignature } from "@/lib/docuflow/my-signature";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string; placementId: string }>;
};

const IdSchema = zUUID();

// Existing shape (draw-and-submit), unchanged validation — plus one new
// optional field.
const DrawnSignatureSchema = z.object({
  // PNG data URL: "data:image/png;base64,iVBOR..."
  imageDataUrl: z
    .string()
    .min(32)
    .max(8 * 1024 * 1024) // 8MB cap (data URL is ~33% larger than bytes)
    .refine((v) => v.startsWith("data:image/png;base64,"), {
      message: "Expected base64 PNG data URL",
    }),
  // Default-checked in the UI when the signer has no saved signature yet.
  saveAsDefault: z.boolean().optional(),
});

// New: one-tap "use my saved signature" path.
const UseSavedSignatureSchema = z.object({
  useSavedSignature: z.literal(true),
});

const BodySchema = z.union([DrawnSignatureSchema, UseSavedSignatureSchema]);

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
  } else if (!isProgramAdminTier(session.user.role)) {
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

  // Resolve the PNG bytes to store, and whether to also save them as the
  // user's default signature (only ever true on the drawn-signature path).
  let buf: Buffer;
  let saveAsDefault = false;

  if ("useSavedSignature" in parsed.data) {
    // Client shouldn't offer this button without a saved signature, but
    // the API must never trust that assumption — re-check the DB.
    const savedUser = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { savedSignatureKey: true },
    });
    if (!savedUser?.savedSignatureKey) {
      return NextResponse.json(
        { error: "คุณยังไม่ได้บันทึกลายเซ็นไว้ กรุณาวาดลายเซ็นใหม่" },
        { status: 400 },
      );
    }
    try {
      buf = await getObject(savedUser.savedSignatureKey);
    } catch (err) {
      console.error("[sign POST] failed to read saved signature", err);
      return NextResponse.json(
        { error: "โหลดลายเซ็นที่บันทึกไว้ไม่สำเร็จ ลองใหม่" },
        { status: 502 },
      );
    }
  } else {
    buf = decodeDataUrl(parsed.data.imageDataUrl);
    saveAsDefault = parsed.data.saveAsDefault === true;
  }

  if (buf.length < 64) {
    return NextResponse.json(
      { error: "ลายเซ็นว่างเปล่า กรุณาเซ็นอีกครั้ง" },
      { status: 400 },
    );
  }

  // Upload PNG to R2 — ALWAYS a fresh key dedicated to this placement, even
  // on the useSavedSignature path (see immutability note at top of file).
  const ts = Date.now();
  const key = buildSignatureKey(orgId, placementId, ts);

  try {
    await putObject(key, buf, "image/png");
  } catch (err) {
    console.error("[sign POST] R2 upload failed", err);
    return NextResponse.json(
      { error: "อัปโหลดลายเซ็นไม่สำเร็จ ลองใหม่" },
      { status: 502 },
    );
  }

  // B24 fix: wrap DB write so R2 PNG doesn't orphan if Prisma throws
  try {
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
  } catch (err) {
    console.error("[sign POST] DB update failed — rolling back R2 PNG", err);
    await deleteObject(key);
    return NextResponse.json(
      { error: "บันทึกลายเซ็นไม่สำเร็จ ลองใหม่" },
      { status: 500 },
    );
  }

  // Best-effort convenience save: the signer drew a fresh signature and
  // checked "save this for next time." Never fails the response — the
  // placement update above is the source of truth for "did they sign,"
  // this is secondary.
  if (saveAsDefault) {
    try {
      await saveMySignature({
        userId: session.user.id,
        orgId,
        pngBuffer: buf,
      });
    } catch (err) {
      console.error(
        "[sign POST] saveAsDefault best-effort save failed",
        err,
      );
    }
  }

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
