// DC คลังกลาง · จุดเดียวที่ "บันทึกรูปสินค้า" (Option B — CEO 2026-07-10)
//
// เมื่อบันทึกรูปสินค้า DC (ผ่านฟอร์มแนบรูปในใบ PO หรือ 1688 AI-crop) →
//   • R2 : สำเนาแสดงผล (JPEG q90 รอบเดียว) — รูปเล็กขยายให้คม, รูปใหญ่คุมเพดาน → url นี้ = รูปสินค้า
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

  // ── 1) สำเนาแสดงผลลง R2 (ทำเสมอ · นี่คือรูปที่ใช้แสดงผลจริง) ──
  // เป้าหมาย: เปิด lightbox แล้วเห็นได้ + คม โดยไม่ให้ไฟล์บวมเกินจำเป็น
  //   • รูปครอปเล็ก (เช่นจาก 1688 ~200px) → ขยายเข้าใกล้ TARGET (ไม่เกิน 4 เท่า) + ชาร์ปขอบ
  //     ทำ "ครั้งเดียว" ด้วย lanczos ที่นี่ (คุณภาพดีกว่าปล่อยเบราว์เซอร์ขยายตอนเปิดดู)
  //     ต้นฉบับเล็กมาก (~200px) → ต้องใหญ่พอให้ "มองเห็น" ไม่งั้นจิ๋วจนดูไม่ออก (CEO 2026-07-25)
  //   • รูปใหญ่พอแล้ว → คงคมเดิม แค่จำกัดเพดาน MAX ไม่ให้ไฟล์บวม
  //   • เข้ารหัส JPEG q90 "รอบเดียว" (เดิม q80 + โดนบีบซ้ำจากขั้นครอป = เบลอ)
  const TARGET = 900;
  const MAX = 1600;
  const key = `dc/img/${orgId}/${randomUUID()}.jpg`;
  let displayBuf: Buffer;
  let displayType = "image/jpeg";
  try {
    const meta = await sharp(bytes).metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    const longest = Math.max(w, h);
    let pipe = sharp(bytes).rotate(); // เคารพ EXIF orientation (รูปมือถือไม่ตะแคง)
    if (longest > 0 && longest < TARGET) {
      const scale = Math.min(4, TARGET / longest); // ขยายไม่เกิน 4 เท่า (พอให้เห็นชัด · เกินนั้น lanczos เริ่มเละ)
      pipe = pipe
        .resize({ width: Math.max(1, Math.round(w * scale)), kernel: "lanczos3" })
        .sharpen({ sigma: 0.8 });
    } else {
      pipe = pipe.resize({ width: MAX, height: MAX, fit: "inside", withoutEnlargement: true });
    }
    displayBuf = await pipe.jpeg({ quality: 90 }).toBuffer();
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
