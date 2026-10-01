// Playland · วาดสายรัดเด็กเป็นบิตแมป 1 บิต สำหรับเครื่องพิมพ์ NIIMBOT K2 (สต็อก TS25*206 สีฟ้า)
//
// ทำงานบน "เบราว์เซอร์แคชเชียร์" เท่านั้น (ใช้ canvas ซึ่งจัดสระ/วรรณยุกต์ไทยถูกต้องด้วยเอนจินของเบราว์เซอร์)
// ผลลัพธ์ = PNG แนวตั้ง 200x1648 จุด (8 จุด/มม. = 25x206 มม.) แถวบนสุดพิมพ์ออกก่อน
//
// กฎที่ได้จากการทดสอบจริงกับ CEO (2026-10-01) — ห้ามแก้เลย์เอาต์โดยไม่ทดสอบพิมพ์จริง:
//  - ทุกอย่างต้องอยู่บน "แผ่นขาว" (เริ่ม ~117 มม. กว้าง ~19 มม.) · แถบฟ้าใช้ไม่ได้: สแกนเนอร์เลเซอร์แดงอ่านแท่งดำบนพื้นฟ้าไม่ออก + ส่วนฟ้าถูกพับซ่อนตอนสวม
//  - บาร์โค้ดต้องสั้น (9 ตัวท้าย ≈ 34 มม.) ไม่งั้นโค้งรอบข้อมือแล้วสแกนยาก · 2 จุด/โมดูลคือเล็กสุดที่ใช้ได้
//  - ไม่พิมพ์ "เวลาออก" (เวลาเริ่มนับจริงคือตอนสแกนเข้าประตู ไม่ใช่ตอนพิมพ์)
// ตัวเลขตำแหน่ง/สเกลทั้งหมดอยู่ใน LAYOUT ด้านล่างที่เดียว

import { encodeCode128B } from "./code128";
import { wristbandBarcodeData } from "./wristband-code";
import { WRISTBAND_BITMAP_BYTES, WRISTBAND_BYTES_PER_ROW, WRISTBAND_DOTS_ACROSS, WRISTBAND_DOTS_ALONG } from "./wristband-bitmap-spec";

const LAYOUT = {
  // แผ่นขาวเริ่มที่ ~117.5 มม. ในรอบวัด แต่ ~128 มม. ในอีกใบ (ตำแหน่งเริ่มพิมพ์เทียบแผ่นขาวเลื่อนได้ ~10 มม. เมื่อฉีกสายรัดทำให้กระดาษขยับ)
  // → ใช้เฉพาะช่วง 130–205 มม. ที่เป็นแผ่นขาวในทุกกรณีที่เจอ
  padX0: 1040, // ≈130 มม.
  padW: 600, // 75 มม. (สิ้นสุด ≈205 มม. ก่อนจบพื้นที่พิมพ์ 206 มม.)
  logoY: 40,
  logoH: 44,
  infoCenterY: 54,
  infoMaxPx: 30,
  infoMinPx: 22,
  nameTop: 94,
  nameBoxH: 66,
  nameMaxPx: 68,
  nameMinPx: 40,
  nameWrapPx: 36,
  nameWrapMinPx: 24,
  nameLineGap: 4,
  barY: 72,
  barH: 60,
  barModule: 2, // จุดต่อโมดูล (0.25 มม.)
  codeCenterY: 148,
  codePx: 22,
  nameBarGap: 24,
  threshold: 150,
} as const;

const FONT_FAMILY = "PlayalotWristband";
const FONT_URL = "/fonts/ibm-plex-sans-thai-bold.ttf";
const LOGO_URL = "/playland/brand/wristband-logo.png";

export interface WristbandBitmapInput {
  name: string;
  /** นาทีของแพ็กเกจ · null = ไม่แสดง */
  durationMinutes: number | null;
  date: Date;
  /** รหัสเต็ม เช่น PW-A3F7K9M4Q */
  code: string;
  /** ฐาน URL ของ asset (ทดสอบ/โฮสต์อื่น) · ปกติเว้นว่าง */
  assetBase?: string;
}

export interface WristbandBitmap {
  /** PNG แนวตั้ง 200x1648 ขาว-ดำล้วน (base64 ไม่มี prefix data:) · ไว้ดู/ดีบัก */
  pngBase64: string;
  /** บิตแมปแพ็ก 1648 แถว x 25 ไบต์ (1 = จุดดำ, MSB ก่อน) เป็น base64 · นี่คือสิ่งที่ส่งเข้าคิวพิมพ์จริง */
  bitmapBase64: string;
  /** รูปแนวนอน 1648x200 สำหรับแสดงพรีวิวบนจอ */
  previewDataUrl: string;
  /** ข้อมูลที่ใช้ตัดสินใจจริง (ไว้ log/ทดสอบ) */
  meta: { nameLines: string[]; namePx: number; truncated: boolean; barcodeData: string; infoText: string };
}

export function formatDurationTh(minutes: number | null): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return "";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m} นาที`;
  return m === 0 ? `${h} ชม.` : `${h} ชม. ${m} นาที`;
}

const TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

// วันที่ตามเวลาไทย แบบย่อ พ.ศ. 2 หลัก: "1 ต.ค. 69"
export function formatDateTh(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bangkok", day: "numeric", month: "numeric", year: "numeric" }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const be = get("year") + 543;
  return `${get("day")} ${TH_MONTHS[get("month") - 1]} ${String(be % 100).padStart(2, "0")}`;
}

let fontPromise: Promise<void> | null = null;
function ensureFont(base: string): Promise<void> {
  if (!fontPromise) {
    fontPromise = (async () => {
      const face = new FontFace(FONT_FAMILY, `url(${base}${FONT_URL})`, { weight: "700" });
      await face.load();
      document.fonts.add(face);
    })().catch((e) => {
      fontPromise = null;
      throw e;
    });
  }
  return fontPromise;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`โหลดภาพไม่สำเร็จ: ${url}`));
    img.src = url;
  });
}

function graphemes(text: string): string[] {
  const Seg = (Intl as unknown as { Segmenter?: new (l: string, o: { granularity: string }) => { segment(s: string): Iterable<{ segment: string }> } }).Segmenter;
  return Seg ? Array.from(new Seg("th", { granularity: "grapheme" }).segment(text), (s) => s.segment) : Array.from(text);
}

function words(text: string): string[] {
  const Seg = (Intl as unknown as { Segmenter?: new (l: string, o: { granularity: string }) => { segment(s: string): Iterable<{ segment: string }> } }).Segmenter;
  return Seg ? Array.from(new Seg("th", { granularity: "word" }).segment(text), (s) => s.segment) : text.split(/(\s+)/);
}

interface NameLine {
  text: string;
  asc: number;
  desc: number;
}

interface NameLayout {
  lines: NameLine[];
  px: number;
  truncated: boolean;
}

// วัดความสูง "หมึกจริง" ของข้อความ (สระบน/วรรณยุกต์/หางล่าง) เพราะฟอนต์ไทยแต่ละตัวสูงไม่เท่ากัน ห้ามเดาจากขนาดฟอนต์
function ink(ctx: CanvasRenderingContext2D, s: string, px: number): NameLine & { w: number } {
  ctx.font = `700 ${px}px ${FONT_FAMILY}`;
  const m = ctx.measureText(s);
  return { text: s, w: m.width, asc: m.actualBoundingBoxAscent, desc: m.actualBoundingBoxDescent };
}

function layoutName(ctx: CanvasRenderingContext2D, rawName: string, availW: number): NameLayout {
  const text = rawName.replace(/\s+/g, " ").trim() || "-";
  const boxH = LAYOUT.nameBoxH;
  const strip = (m: NameLine & { w: number }): NameLine => ({ text: m.text, asc: m.asc, desc: m.desc });

  // 1) บรรทัดเดียว ใหญ่สุดที่ทั้ง "กว้างพอดี" และ "สูงพอดีกล่อง"
  for (let px = LAYOUT.nameMaxPx; px >= LAYOUT.nameMinPx; px -= 2) {
    const m = ink(ctx, text, px);
    if (m.w <= availW && m.asc + m.desc <= boxH) return { lines: [strip(m)], px, truncated: false };
  }

  // 2) ตัดเป็น 2 บรรทัดตามคำ (ไทยใช้พจนานุกรมของเบราว์เซอร์) ลดขนาดจนสูงรวมพอดีกล่อง
  for (let px = LAYOUT.nameWrapPx; px >= LAYOUT.nameWrapMinPx; px -= 1) {
    const lines = breakLines(ctx, text, availW, px);
    if (lines.length > 2) continue;
    const ms = lines.map((l) => ink(ctx, l, px));
    const total = ms.reduce((a, m) => a + m.asc + m.desc, 0) + (ms.length - 1) * LAYOUT.nameLineGap;
    if (total <= boxH) return { lines: ms.map(strip), px, truncated: false };
  }

  // 3) ยังยาวเกิน → บรรทัดเดียว ตัดท้ายด้วย … (ตัดทีละ grapheme ไม่ให้สระลอย)
  const gs = graphemes(text);
  const pxT = LAYOUT.nameMinPx;
  while (gs.length > 1 && ink(ctx, gs.join("") + "…", pxT).w > availW) gs.pop();
  return { lines: [strip(ink(ctx, gs.join("") + "…", pxT))], px: pxT, truncated: true };
}

function breakLines(ctx: CanvasRenderingContext2D, text: string, availW: number, px: number): string[] {
  const width = (s: string) => ink(ctx, s, px).w;
  const lines: string[] = [];
  let cur = "";
  for (const w of words(text)) {
    if (width((cur + w).trim()) <= availW) {
      cur += w;
      continue;
    }
    if (cur.trim()) lines.push(cur.trim());
    cur = "";
    if (width(w.trim()) <= availW) {
      cur = w.trimStart();
      continue;
    }
    for (const g of graphemes(w)) {
      if (width(cur + g) > availW) {
        lines.push(cur);
        cur = "";
      }
      cur += g;
    }
  }
  if (cur.trim()) lines.push(cur.trim());
  return lines;
}

export async function renderWristbandBitmap(input: WristbandBitmapInput): Promise<WristbandBitmap> {
  if (typeof document === "undefined") throw new Error("renderWristbandBitmap ใช้ได้เฉพาะบนเบราว์เซอร์");
  const base = input.assetBase ?? "";
  const [, logo] = await Promise.all([ensureFont(base), loadImage(`${base}${LOGO_URL}`)]);

  const W = WRISTBAND_DOTS_ALONG;
  const H = WRISTBAND_DOTS_ACROSS;
  const land = document.createElement("canvas");
  land.width = W;
  land.height = H;
  const ctx = land.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("เบราว์เซอร์ไม่รองรับ canvas");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#000";
  ctx.textBaseline = "middle";

  const L = LAYOUT;
  const right = L.padX0 + L.padW;

  // โลโก้ (ซ้ายบน)
  const logoW = (logo.width / logo.height) * L.logoH;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(logo, L.padX0, L.logoY, logoW, L.logoH);

  // บรรทัดข้อมูล: "30 นาที | 1 ต.ค. 69" ชิดขวาบน
  const infoParts = [formatDurationTh(input.durationMinutes), formatDateTh(input.date)].filter(Boolean);
  const infoText = infoParts.join("  |  ");
  const infoAvail = L.padW - logoW - 20;
  let infoPx = L.infoMaxPx;
  ctx.font = `700 ${infoPx}px ${FONT_FAMILY}`;
  while (ctx.measureText(infoText).width > infoAvail && infoPx > L.infoMinPx) {
    infoPx -= 1;
    ctx.font = `700 ${infoPx}px ${FONT_FAMILY}`;
  }
  ctx.textAlign = "right";
  ctx.fillText(infoText, right, L.infoCenterY);

  // บาร์โค้ด Code128 (9 ตัวท้ายของรหัส) ชิดขวา
  const barcodeData = wristbandBarcodeData(input.code);
  const modules = encodeCode128B(barcodeData);
  const barW = modules.length * L.barModule;
  const barX = right - barW;
  for (let i = 0; i < modules.length; ) {
    if (modules[i] === "1") {
      let j = i;
      while (j < modules.length && modules[j] === "1") j++;
      ctx.fillRect(barX + i * L.barModule, L.barY, (j - i) * L.barModule, L.barH);
      i = j;
    } else i++;
  }

  // รหัสตัวอักษรใต้บาร์โค้ด (เผื่อสแกนไม่ติด พนักงานพิมพ์เอง)
  ctx.font = `700 ${L.codePx}px ${FONT_FAMILY}`;
  ctx.textAlign = "left";
  const chars = Array.from(barcodeData);
  const gap = 4;
  const widths = chars.map((c) => ctx.measureText(c).width);
  const codeW = widths.reduce((a, b) => a + b, 0) + gap * (chars.length - 1);
  let cx = barX + (barW - codeW) / 2;
  chars.forEach((c, i) => {
    ctx.fillText(c, cx, L.codeCenterY);
    cx += widths[i] + gap;
  });

  // ชื่อ (ซ้ายล่าง) ย่อ/ตัด 2 บรรทัด/ตัดท้ายให้พอดีเสมอ ไม่ชนบาร์โค้ด
  const nameAvail = barX - L.nameBarGap - L.padX0;
  const nl = layoutName(ctx, input.name, nameAvail);
  ctx.textAlign = "left";
  ctx.font = `700 ${nl.px}px ${FONT_FAMILY}`;
  const inkTotal = nl.lines.reduce((a, l) => a + l.asc + l.desc, 0) + (nl.lines.length - 1) * L.nameLineGap;
  let baseline = L.nameTop + Math.max(0, (L.nameBoxH - inkTotal) / 2);
  ctx.textBaseline = "alphabetic";
  nl.lines.forEach((l) => {
    baseline += l.asc;
    ctx.fillText(l.text, L.padX0, baseline);
    baseline += l.desc + L.nameLineGap;
  });
  ctx.textBaseline = "middle";

  // บีบเป็นขาว-ดำล้วน (หัวพิมพ์ความร้อนเป็น 1 บิต)
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  for (let p = 0; p < d.length; p += 4) {
    const luma = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
    const v = luma < L.threshold ? 0 : 255;
    d[p] = d[p + 1] = d[p + 2] = v;
    d[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  // หมุน 90° ตามเข็ม: ขอบซ้ายของแนวนอน → แถวบนสุดที่พิมพ์ออกก่อน
  const port = document.createElement("canvas");
  port.width = H;
  port.height = W;
  const pctx = port.getContext("2d");
  if (!pctx) throw new Error("เบราว์เซอร์ไม่รองรับ canvas");
  pctx.translate(H, 0);
  pctx.rotate(Math.PI / 2);
  pctx.drawImage(land, 0, 0);

  const pngBase64 = port.toDataURL("image/png").split(",")[1] ?? "";

  // แพ็กเป็น 1 บิตต่อจุด ส่งเข้าคิวพิมพ์ (agent ไม่ต้องมีตัวถอดรหัส PNG)
  const px = pctx.getImageData(0, 0, H, W).data;
  const packed = new Uint8Array(WRISTBAND_BITMAP_BYTES);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < H; x++) {
      if (px[(y * H + x) * 4] < 128) packed[y * WRISTBAND_BYTES_PER_ROW + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  let bin = "";
  for (let i = 0; i < packed.length; i += 8192) bin += String.fromCharCode(...packed.subarray(i, i + 8192));
  const bitmapBase64 = btoa(bin);

  return {
    pngBase64,
    bitmapBase64,
    previewDataUrl: land.toDataURL("image/png"),
    meta: { nameLines: nl.lines.map((l) => l.text), namePx: nl.px, truncated: nl.truncated, barcodeData, infoText },
  };
}
