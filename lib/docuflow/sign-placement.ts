// Shared "sign one placement" logic — single source of truth for BOTH:
//   - POST /api/docuflow/[id]/signatures/[placementId]/sign (web signer UI)
//   - POST /api/telegram/webapp/sign (Telegram Mini App)
// ────────────────────────────────────────────────────────────────────
// Extracted 2026-10-16 (DocuFlow Telegram Mini App) from the web route
// VERBATIM — no behavior change. The web route is now a thin wrapper
// that resolves the session + parses the request body, then calls
// `signPlacement()`; the Mini App route does the same using its
// Telegram-resolved identity instead of a cookie session. Neither route
// re-implements PDF embedding, R2 upload, or audit logging — this is
// the only place that logic lives now.
//
// Accepts either:
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
// Auth model (caller's responsibility to resolve `userId`/`orgId` first):
//   - placement.signerUserId set → caller must be that user
//   - placement.signerUserId null but signerName set → caller must pass
//     `isModuleAdmin: true` (any signed-in org user with DocuFlow admin
//     rights may sign open placements; a non-admin may not)
//
// Immutability note (useSavedSignature path): `signedImageKey` NEVER
// points directly at the user's `savedSignatureKey` — the saved-signature
// bytes are copied into a new placement-dedicated key. This keeps every
// placement's signed artifact immutable even if the user later changes
// or clears their saved signature; a previously-signed document must
// never retroactively appear to change. `embedSignatures()` needs zero
// changes for this — it still just reads `signedImageKey` as before.
// ────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit/log";
import { deleteObject, getObject, putObject } from "@/lib/r2/upload";
import { embedSignatures } from "@/lib/docuflow/signature";
import { saveMySignature } from "@/lib/docuflow/my-signature";

export type SignPlacementBody =
  | { useSavedSignature: true }
  | { imageDataUrl: string; saveAsDefault?: boolean };

export interface SignPlacementInput {
  documentId: string;
  placementId: string;
  orgId: string;
  userId: string;
  /**
   * Resolves whether the caller is allowed to sign placements with no
   * specific `signerUserId` (DocuFlow admin tier). A LAZY callback, not a
   * plain boolean — only invoked when the placement itself has
   * `signerUserId === null`, so callers never pay for the admin-tier
   * lookup (a DB round-trip for `program_admin`) on the common path
   * where the placement is already assigned to a specific signer.
   * Callers that never expect to hit the null-signerUserId path (e.g.
   * the Mini App, whose placements all come from a query already
   * filtered to `signerUserId: <caller>`) may pass `async () => false`.
   */
  isModuleAdmin: () => Promise<boolean>;
  body: SignPlacementBody;
}

export type SignPlacementResult =
  | { ok: true; remaining: number; signedFileKey: string | null }
  | { ok: false; status: number; error: string };

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

export async function signPlacement(
  input: SignPlacementInput,
): Promise<SignPlacementResult> {
  const { documentId, placementId, orgId, userId, isModuleAdmin, body } =
    input;

  const placement = await prisma.documentSignaturePlacement.findFirst({
    where: { id: placementId, orgId, documentId },
  });
  if (!placement) {
    return { ok: false, status: 404, error: "ไม่พบจุดเซ็นนี้" };
  }

  // Auto-fill placement types (date / name / text) are stamped at embed time
  // — they don't accept a manual signature.
  if (placement.placementType && placement.placementType !== "signature") {
    return {
      ok: false,
      status: 400,
      error:
        "จุดนี้เป็นช่องเติมอัตโนมัติ (วันที่/ชื่อ/ข้อความ) ไม่ต้องเซ็นด้วยตนเอง",
    };
  }

  // Auth:
  //   - signerUserId set → caller must match exactly
  //   - signerUserId null → admin-tier fallback only; prevents any
  //     logged-in org user from signing open placements on sensitive
  //     admin docs.
  if (placement.signerUserId) {
    if (placement.signerUserId !== userId) {
      return { ok: false, status: 403, error: "คุณไม่ได้รับสิทธิ์เซ็นจุดนี้" };
    }
  } else if (!(await isModuleAdmin())) {
    return { ok: false, status: 403, error: "คุณไม่ได้รับสิทธิ์เซ็นจุดนี้" };
  }

  // Re-signing not allowed (admin can delete + recreate to redo)
  if (placement.signedAt) {
    return { ok: false, status: 409, error: "จุดเซ็นนี้มีลายเซ็นแล้ว" };
  }

  // Resolve the PNG bytes to store, and whether to also save them as the
  // user's default signature (only ever true on the drawn-signature path).
  let buf: Buffer;
  let saveAsDefault = false;

  if ("useSavedSignature" in body) {
    // Client shouldn't offer this button without a saved signature, but
    // the API must never trust that assumption — re-check the DB.
    const savedUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { savedSignatureKey: true },
    });
    if (!savedUser?.savedSignatureKey) {
      return {
        ok: false,
        status: 400,
        error: "คุณยังไม่ได้บันทึกลายเซ็นไว้ กรุณาวาดลายเซ็นใหม่",
      };
    }
    try {
      buf = await getObject(savedUser.savedSignatureKey);
    } catch (err) {
      console.error("[signPlacement] failed to read saved signature", err);
      return {
        ok: false,
        status: 502,
        error: "โหลดลายเซ็นที่บันทึกไว้ไม่สำเร็จ ลองใหม่",
      };
    }
  } else {
    buf = decodeDataUrl(body.imageDataUrl);
    saveAsDefault = body.saveAsDefault === true;
  }

  if (buf.length < 64) {
    return { ok: false, status: 400, error: "ลายเซ็นว่างเปล่า กรุณาเซ็นอีกครั้ง" };
  }

  // Upload PNG to R2 — ALWAYS a fresh key dedicated to this placement, even
  // on the useSavedSignature path (see immutability note at top of file).
  const ts = Date.now();
  const key = buildSignatureKey(orgId, placementId, ts);

  try {
    await putObject(key, buf, "image/png");
  } catch (err) {
    console.error("[signPlacement] R2 upload failed", err);
    return { ok: false, status: 502, error: "อัปโหลดลายเซ็นไม่สำเร็จ ลองใหม่" };
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
      userId,
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
    console.error("[signPlacement] DB update failed — rolling back R2 PNG", err);
    await deleteObject(key);
    return { ok: false, status: 500, error: "บันทึกลายเซ็นไม่สำเร็จ ลองใหม่" };
  }

  // Best-effort convenience save: the signer drew a fresh signature and
  // checked "save this for next time." Never fails the response — the
  // placement update above is the source of truth for "did they sign,"
  // this is secondary.
  if (saveAsDefault) {
    try {
      await saveMySignature({ userId, orgId, pngBuffer: buf });
    } catch (err) {
      console.error("[signPlacement] saveAsDefault best-effort save failed", err);
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
      console.error("[signPlacement] embedSignatures failed", err);
    }
  }

  return { ok: true, remaining, signedFileKey };
}
