// ClawFleet — photo upload helpers (R2)
// Spec: docs/CLAWFLEET_PLAN.md §11

import { randomUUID } from "node:crypto";
import { putObject } from "@/lib/r2/upload";

export type PhotoPhase =
  | "meter_before"
  | "cash"
  | "meter_after"
  | "stock"
  | "prize_meter"
  | "stock_after"
  // N1 baseline / N4 machine photo / N6 goods-receipt / N3 stock-count (bigfeature 2026-07-08)
  | "machine"
  | "money_meter_top"
  | "money_meter_bottom"
  | "doll_meter_top"
  | "doll_meter_bottom"
  | "baseline_stock"
  | "goods_receipt"
  | "stock_count"
  // เวิร์กช็อป 2026-08-29 · แนบสลิปฝากเงินจากหน้าประวัติเก็บเงิน (แทน hack เดิมที่ใช้ phase "cash")
  | "deposit_slip";

// 🛡️ path-safety: อนุญาตเฉพาะอักษร/ตัวเลข/._- (ไม่มี "/" ไม่มี "..") → กัน path traversal
// เมื่อค่ามาจาก client. eventScopeId = "{sessionId}-{machineId}" (uuid สองก้อน ~73 ตัว) จึง
// ตั้งเพดานยาว 128 ให้พอ · ก้อนสั้น (orgId/machineCode) ก็ผ่านเกณฑ์เดียวกัน.
const SAFE_KEY_SEGMENT = /^[A-Za-z0-9._-]{1,128}$/;
export function isSafeKeySegment(v: string): boolean {
  // ".." (และ ".") เป็น traversal แม้จะ match charset ด้านบน → ปฏิเสธชัดเจน
  if (v === "." || v === "..") return false;
  // กัน ".." ที่แฝงเป็นส่วนหนึ่งของค่า (เช่น "a..b" ไม่ traversal แต่ "../" กันด้วย charset ที่ไม่มี "/")
  return SAFE_KEY_SEGMENT.test(v);
}

// machine.code ตามจริงไม่ใช่รหัสระบบ ASCII เสมอไป (พบ 17/239 ตู้ตั้งชื่อเป็นภาษาไทย/มีวรรค
// เช่น "711 ลำทะเมนชัย" · "บ้านเอื้ออาทร 1") — isSafeKeySegment ปฏิเสธหมด → อัปรูปพังถาวรทุกครั้ง
// สำหรับตู้กลุ่มนี้ (2026-08-15). ต่างจาก orgId/eventId ที่ผูกกับ auth/lookup จริงต้อง reject
// ตรงๆ ห้ามเดา — machineCode ในนี้ใช้แค่จัดโฟลเดอร์ R2 ให้อ่านง่าย (ความไม่ซ้ำของไฟล์มาจาก
// eventId+รูปสุ่มท้ายชื่ออยู่แล้ว) จึง sanitize แทนการปฏิเสธได้อย่างปลอดภัย.
export function sanitizeKeySegment(v: string, fallback = "x"): string {
  const cleaned = v
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "");
  return cleaned || fallback;
}

// ตรวจชนิดรูปจาก magic bytes → คืนนามสกุล + content-type ที่ถูกต้อง
// (เดิม hardcode ".webp"/"image/webp" เสมอ · แต่ client บน iOS ส่ง JPEG มา — ถ้า label ผิด
//  metadata บน R2 จะไม่ตรงกับไบต์จริง. validateImageBuffer กันฟอร์แมตแปลกไว้แล้ว จึง default = jpg.)
function detectImageType(buf: Buffer): { ext: string; contentType: string } {
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
    return { ext: "jpg", contentType: "image/jpeg" };
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)
    return { ext: "png", contentType: "image/png" };
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[8] === 0x57 && buf[9] === 0x45)
    return { ext: "webp", contentType: "image/webp" };
  return { ext: "jpg", contentType: "image/jpeg" };
}

export function photoKey(opts: {
  orgId: string;
  machineCode: string;
  eventId: string;
  phase: PhotoPhase;
  ext?: string;
}): string {
  // orgId/eventId ผูกกับ auth/lookup จริง (ดูใน upload/route.ts) → reject ตรงๆ ถ้าไม่ปลอดภัย
  if (!isSafeKeySegment(opts.orgId)) throw new Error("invalid orgId for photo key");
  if (!isSafeKeySegment(opts.eventId)) throw new Error("invalid eventId for photo key");
  const ym = new Date().toISOString().slice(0, 7); // YYYY-MM
  const ext = opts.ext ?? "jpg";
  // machineCode ใช้แค่จัดโฟลเดอร์ → sanitize แทน reject (ตู้ชื่อภาษาไทย/มีวรรคยังอัปรูปได้)
  const safeMachineCode = sanitizeKeySegment(opts.machineCode, "machine");
  // 🛡️ anti-tamper: สุ่ม suffix ต่อการอัปทุกครั้ง → key ไม่ซ้ำ → อัปทับหลักฐานเดิมไม่ได้
  // (last-write-wins ของ R2 จะ overwrite ก็ต่อเมื่อ key เดียวกัน — เราทำให้ key ไม่มีวันซ้ำ)
  const rand = randomUUID().slice(0, 8);
  return `clawfleet/${opts.orgId}/${ym}/${safeMachineCode}/${opts.eventId}/${opts.phase}-${rand}.${ext}`;
}

export async function uploadEventPhoto(opts: {
  orgId: string;
  machineCode: string;
  eventId: string;
  phase: PhotoPhase;
  body: Buffer;
}): Promise<string> {
  const { ext, contentType } = detectImageType(opts.body);
  const key = photoKey({ ...opts, ext });
  const url = await putObject(key, opts.body as unknown as Uint8Array, contentType);
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
