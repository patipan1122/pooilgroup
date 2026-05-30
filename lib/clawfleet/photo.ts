// ClawFleet — photo upload helpers (R2)
// Spec: docs/CLAWFLEET_PLAN.md §11

import { putObject } from "@/lib/r2/upload";

export type PhotoPhase =
  | "meter_before"
  | "cash"
  | "meter_after"
  | "stock"
  | "prize_meter"
  | "stock_after";

export function photoKey(opts: {
  orgId: string;
  machineCode: string;
  eventId: string;
  phase: PhotoPhase;
}): string {
  const ym = new Date().toISOString().slice(0, 7); // YYYY-MM
  return `clawfleet/${opts.orgId}/${ym}/${opts.machineCode}/${opts.eventId}/${opts.phase}.webp`;
}

export async function uploadEventPhoto(opts: {
  orgId: string;
  machineCode: string;
  eventId: string;
  phase: PhotoPhase;
  body: Buffer;
}): Promise<string> {
  const key = photoKey(opts);
  const url = await putObject(key, opts.body as unknown as Uint8Array, "image/webp");
  return url;
}

/**
 * Validate uploaded image is acceptable (size, format).
 * Server-side guard against bypass attempts.
 */
export function validateImageBuffer(buf: Buffer | ArrayBuffer): {
  ok: boolean;
  reason?: string;
} {
  const size = buf.byteLength;
  if (size === 0) return { ok: false, reason: "empty file" };
  if (size > 500 * 1024) return { ok: false, reason: "ไฟล์ใหญ่เกิน 500KB · ต้อง resize ก่อน upload" };
  // Magic bytes check — accept JPEG / PNG / WebP
  const arr = buf instanceof ArrayBuffer ? Buffer.from(buf) : (buf as Buffer);
  // WebP: "RIFF....WEBP"
  const isWebP = arr[0] === 0x52 && arr[1] === 0x49 && arr[8] === 0x57 && arr[9] === 0x45;
  // JPEG: FFD8FF
  const isJpeg = arr[0] === 0xff && arr[1] === 0xd8 && arr[2] === 0xff;
  // PNG: 89504E47
  const isPng = arr[0] === 0x89 && arr[1] === 0x50 && arr[2] === 0x4e && arr[3] === 0x47;
  if (!isWebP && !isJpeg && !isPng) {
    return { ok: false, reason: "รองรับเฉพาะ JPEG / PNG / WebP" };
  }
  return { ok: true };
}
