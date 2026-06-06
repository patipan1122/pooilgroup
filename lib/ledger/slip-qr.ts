// LedgerLine — decode a bank-transfer slip's EMVCo/PromptPay mini-QR LOCALLY.
//
// FREE (no API, no AI). The slip mini-QR carries the sending-bank code + a
// per-transfer reference (transRef) that is unique forever → the deterministic,
// zero-token duplicate-payment key (PR1 unique index org_id + sending_bank +
// trans_ref). The amount is NOT in the mini-QR — the caller gets it from AI-OCR as
// a fallback when needed (PR4). Parsing the Thai-bank TLV is delegated to the
// `promptparse` library (purpose-built + tested) rather than hand-rolled, so the
// dedup key can never be wrong.
//
// NEVER throws: a corrupt/QR-less image must not 500 the LINE webhook. On any
// failure it returns { decoded:false, reason }.
import jsQR from "jsqr";
import sharp from "sharp";
import { slipVerify } from "promptparse/validate";

export interface SlipQrResult {
  decoded: boolean;
  transRef: string | null; // bank transaction ref — the dedup key
  sendingBank: string | null; // 3-digit bank code
  rawPayload: string | null; // the raw QR string (audit / QR-hit-rate metric)
  reason?: string;
}

const fail = (reason: string, rawPayload: string | null = null): SlipQrResult => ({
  decoded: false,
  transRef: null,
  sendingBank: null,
  rawPayload,
  reason,
});

/**
 * Decode the slip image → { sendingBank, transRef }. Pure-local, free, no AI.
 * @param imageBytes the raw slip image (jpeg/png/webp) as a Buffer.
 */
export async function decodeSlipQr(imageBytes: Buffer): Promise<SlipQrResult> {
  try {
    // image → raw RGBA pixels (ensureAlpha → 4 channels, the layout jsQR expects).
    const { data, info } = await sharp(imageBytes)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const px = new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
    const qr = jsQR(px, info.width, info.height);
    if (!qr || !qr.data) return fail("ไม่พบ QR บนสลิป");

    let parsed: { sendingBank?: string; transRef?: string } | null = null;
    try {
      // crcAutoFix=true tolerates the minor CRC drift some bank apps emit.
      parsed = slipVerify(qr.data, true);
    } catch {
      return fail("QR ไม่ใช่สลิปโอนเงิน (ถอด TLV ไม่ได้)", qr.data);
    }
    if (!parsed || !parsed.transRef) return fail("อ่านเลขอ้างอิงจาก QR ไม่ได้", qr.data);

    return {
      decoded: true,
      transRef: parsed.transRef,
      sendingBank: parsed.sendingBank ?? null,
      rawPayload: qr.data,
    };
  } catch {
    return fail("ถอด QR ไม่สำเร็จ (รูปเสีย/ไม่มี QR)");
  }
}
