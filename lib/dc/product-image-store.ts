// DC คลังกลาง · จุดเดียวที่ "บันทึกรูปสินค้า" (Option B — CEO 2026-07-10)
//
// เมื่อบันทึกรูปสินค้า DC (ผ่านฟอร์มแนบรูปในใบ PO หรือ 1688 AI-crop) →
//   • R2 : ทำสำเนา "ย่อ" (resize ≤900px, JPEG q80) ไว้แสดงผล  → url นี้ = ที่เก็บเป็นรูปสินค้า
//   • Drive : เก็บ "ต้นฉบับ" ความละเอียดเต็ม (best-effort — ถ้าไม่เชื่อมก็ข้าม)
//
// ⚠️ url ที่คืน = R2 display URL "เสมอ" → imageR2Path ยังเป็น R2 → การแสดงผล/พิมพ์/lightbox
//    (Waves 1) ไม่พัง. Drive webViewLink เป็นหน้า viewer ไม่ใช่รูปฝังได้ → ห้ามเอาไปเป็นรูป.

import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { putObject } from "@/lib/r2/upload";
import { uploadDcImageToDrive } from "@/lib/dc/drive-store";

export interface StoredDcProductImage {
  /** R2 key ของสำเนาย่อ (ที่แสดงผล) */
  key: string;
  /** R2 public URL — ค่านี้เก็บเป็น imageR2Path เสมอ (display never breaks) */
  url: string;
  /** Drive webViewLink ของต้นฉบับ (viewer page) — null ถ้าไม่เชื่อม Drive / พลาด */
  driveUrl: string | null;
}

/**
 * บันทึกรูปสินค้า DC → R2 (สำเนาย่อ · แสดงผล) + Drive (ต้นฉบับ · best-effort).
 * คืน { key, url, driveUrl } — `url` เป็น R2 display URL เสมอ.
 */
export async function storeDcProductImage(opts: {
  orgId: string;
  bytes: Buffer;
  mimeType: string;
  name: string;
}): Promise<StoredDcProductImage> {
  const { orgId, bytes, mimeType, name } = opts;

  // ── 1) สำเนาย่อลง R2 (ทำเสมอ · นี่คือรูปที่ใช้แสดงผลจริง) ──
  const key = `dc/img/${orgId}/${randomUUID()}.jpg`;
  let displayBuf: Buffer;
  let displayType = "image/jpeg";
  try {
    displayBuf = await sharp(bytes)
      .rotate() // เคารพ EXIF orientation (รูปมือถือไม่ตะแคง)
      .resize({ width: 900, height: 900, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
  } catch (e) {
    // input แปลก ๆ ที่ sharp ย่อไม่ได้ → เก็บ bytes เดิมไว้ (display ยังไม่พัง)
    console.warn("[dc image] sharp resize failed, storing original bytes", e);
    displayBuf = bytes;
    displayType = mimeType || "application/octet-stream";
  }
  const url = await putObject(key, displayBuf, displayType);

  // ── 2) ต้นฉบับลง Drive (best-effort · Drive พังก็ไม่กระทบ R2/การอัปโหลด) ──
  const drive = await uploadDcImageToDrive({ orgId, bytes, mimeType, name });
  const driveUrl = drive?.driveUrl ?? null;

  return { key, url, driveUrl };
}
