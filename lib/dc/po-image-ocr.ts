"use server";

// DC · ใบสั่งซื้อจีน — "แนบรูป → อ่านอัตโนมัติ" (server action).
//
// รับ key รูป (ที่ client อัปเข้า R2 ผ่าน /api/dc/upload มาแล้ว) → อ่านด้วย Gemini vision:
//   • ดึงรายการสินค้าในรูป: ชื่อจีน + ชื่อไทย(AI ตั้งให้ · CEO อ่านจีนไม่ออก) + จำนวน + ราคา/หน่วย(实付)
//   • bounding box ของรูปสินค้าแต่ละตัว → ครอป (sharp) → อัปเป็นรูปประจำสินค้า (R2)
//   • ตรวจยอดรวม: Σ(จำนวน×ราคา) เทียบ "总实付" + Σจำนวน เทียบ "共X件" → เตือนถ้าไม่ตรง
//   • ลองจับคู่สินค้าเดิม (ชื่อตรง) → เสนอให้ใช้ตัวเดิมได้ (กันสร้างซ้ำ)
//
// 💰 เงิน/จำนวน = "ผู้ช่วยคีย์" เท่านั้น → คนต้องตรวจ/แก้ในจอ review ก่อนสร้าง PO เสมอ (ไม่ auto).
// ผ่าน budget-guard (cost-cap) เหมือน ledger OCR · โมเดล Gemini หลัก/สำรอง.

import sharp from "sharp";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { canDcManage } from "@/lib/dc/role-guard";
import { checkAiBudget, recordAiUsage } from "@/lib/ai/cost-cap";
import { getObject } from "@/lib/r2/upload";
import { storeDcProductImage } from "@/lib/dc/product-image-store";

const PRIMARY_MODEL = "gemini-3.1-flash-lite";
const FALLBACK_MODEL = "gemini-2.5-flash-lite";
const MAX_IMAGES = 12; // กันโหลดหนัก/ค่า AI บาน ต่อครั้ง
const MAX_ITEMS_PER_IMAGE = 40;

const OCR_PROMPT = `You are reading a purchase-order / product-list screenshot from 1688 / Taobao or a Chinese supplier order sheet (may also be a Thai shop order). Extract EVERY product line item you can see.

For EACH line item return an object:
- "name_zh": the product name exactly as printed (Chinese if Chinese). null if none.
- "name_th": a short, natural THAI product name a Thai warehouse worker would understand — translate/transliterate from the Chinese/English name, keep it concise, and include the key variant shown (สี/ขนาด/รุ่น) when present. This field is REQUIRED and must be Thai.
- "qty": ordered quantity as an integer. Look for "x36", "×24", "下单数量", "จำนวน". REQUIRED.
- "unit_price": the ACTUAL unit price paid, as a number. Prefer the "实付" (actual paid) figure over the crossed-out original. Do not include the currency symbol. REQUIRED.
- "box_2d": bounding box of THIS item's PRODUCT THUMBNAIL IMAGE (the picture, not the text), as [ymin, xmin, ymax, xmax] normalized 0-1000. null if this line has no product picture.

Also return at the top level:
- "total_paid": the grand total actually paid shown on the page (e.g. "总实付", "รวม"). number or null.
- "piece_count": total pieces if stated (e.g. "共120件"). integer or null.
- "currency": "CNY" or "THB".

Return ONLY minified JSON of the shape:
{"items":[{"name_zh":..,"name_th":..,"qty":..,"unit_price":..,"box_2d":..}],"total_paid":..,"piece_count":..,"currency":".."}
No markdown, no commentary.`;

export type OcrLineItem = {
  /** row key ฝั่ง client */
  key: string;
  nameZh: string | null;
  nameTh: string;
  qty: number;
  /** ราคา/หน่วยในสกุลของใบ (CNY จีน / THB ไทย) */
  unitPrice: number;
  /** รูปสินค้าที่ครอปแล้ว (full URL) — ใช้เป็นรูปประจำสินค้า · null ถ้าครอปไม่ได้ */
  croppedUrl: string | null;
  croppedKey: string | null;
  /** ถ้าตรงกับสินค้าเดิมในระบบ → เสนอให้ใช้ตัวเดิม */
  matchProductId: string | null;
  matchLabel: string | null;
  /** มาจากรูปที่เท่าไร (1-based) — โชว์ให้ผู้ใช้รู้ที่มา */
  sourceImage: number;
};

export type OcrTotalsCheck = {
  extractedSum: number;
  currency: "CNY" | "THB";
};

export type IngestPoImagesResult =
  | { ok: true; items: OcrLineItem[]; totals: OcrTotalsCheck; warnings: string[] }
  | { ok: false; error: string };

type RawItem = {
  name_zh?: unknown;
  name_th?: unknown;
  qty?: unknown;
  unit_price?: unknown;
  box_2d?: unknown;
};
type RawParsed = {
  items?: unknown;
  total_paid?: unknown;
  piece_count?: unknown;
  currency?: unknown;
};

function safeParseJson(raw: string): RawParsed {
  try {
    return JSON.parse(raw) as RawParsed;
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]) as RawParsed;
      } catch {
        /* fall through */
      }
    }
    return {};
  }
}

function toNum(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[^0-9.\-]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function toStr(v: unknown): string | null {
  if (typeof v === "string") {
    const s = v.trim();
    return s.length ? s : null;
  }
  return null;
}

/** ทำชื่อไฟล์รูปสินค้าให้ปลอดภัย (ตัดอักขระต้องห้ามใน Drive/OS · จำกัดความยาว). */
function safeImageName(s: string): string {
  const base = (s || "dc-product")
    .replace(/[\r\n\t]/g, " ")
    .replace(/[\\/:*?"<>|]/g, "-")
    .trim()
    .slice(0, 60) || "dc-product";
  return base;
}

/** [ymin,xmin,ymax,xmax] 0-1000 → พิกเซลจริง (clamp ในกรอบภาพ) หรือ null ถ้าไม่สมเหตุผล. */
function boxToRegion(
  box: unknown,
  imgW: number,
  imgH: number,
): { left: number; top: number; width: number; height: number } | null {
  if (!Array.isArray(box) || box.length !== 4) return null;
  const [ymin, xmin, ymax, xmax] = box.map((n) => toNum(n));
  if ([ymin, xmin, ymax, xmax].some((n) => !Number.isFinite(n))) return null;
  let left = Math.round((Math.min(xmin, xmax) / 1000) * imgW);
  let top = Math.round((Math.min(ymin, ymax) / 1000) * imgH);
  let width = Math.round((Math.abs(xmax - xmin) / 1000) * imgW);
  let height = Math.round((Math.abs(ymax - ymin) / 1000) * imgH);
  left = Math.max(0, Math.min(left, imgW - 1));
  top = Math.max(0, Math.min(top, imgH - 1));
  width = Math.max(1, Math.min(width, imgW - left));
  height = Math.max(1, Math.min(height, imgH - top));
  // เล็กเกินไป = คงไม่ใช่รูปสินค้า → ข้าม
  if (width < 24 || height < 24) return null;
  return { left, top, width, height };
}

async function callGeminiModel(
  ai: import("@google/genai").GoogleGenAI,
  model: string,
  base64: string,
  mimeType: string,
): Promise<{ raw: string; inTok: number; outTok: number; ok: boolean }> {
  const result = await ai.models.generateContent({
    model,
    contents: [
      {
        role: "user",
        parts: [
          { text: OCR_PROMPT },
          { inlineData: { mimeType, data: base64 } },
        ],
      },
    ],
    config: { temperature: 0, maxOutputTokens: 2600, responseMimeType: "application/json" },
  });
  const raw = result.text ?? "";
  const inTok = result.usageMetadata?.promptTokenCount ?? 1500;
  const outTok = result.usageMetadata?.candidatesTokenCount ?? 400;
  return { raw, inTok, outTok, ok: raw.length >= 5 };
}

async function runOcr(
  base64: string,
  mimeType: string,
): Promise<{ parsed: RawParsed; model: string; inTok: number; outTok: number }> {
  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  let r = await callGeminiModel(ai, PRIMARY_MODEL, base64, mimeType).catch(
    () => ({ raw: "", inTok: 0, outTok: 0, ok: false }),
  );
  let model = PRIMARY_MODEL;
  if (!r.ok) {
    r = await callGeminiModel(ai, FALLBACK_MODEL, base64, mimeType).catch(
      () => ({ raw: "", inTok: 0, outTok: 0, ok: false }),
    );
    model = FALLBACK_MODEL;
  }
  return { parsed: safeParseJson(r.raw), model, inTok: r.inTok, outTok: r.outTok };
}

/**
 * อ่านรูปออเดอร์หลายใบ → คืนรายการสินค้าที่ดึงได้ (พร้อมรูปครอป + ข้อเสนอจับคู่ของเดิม).
 * ไม่สร้าง/แก้อะไรในคลัง — แค่ "เสนอ" ให้คนตรวจในจอ review ก่อนเพิ่มเข้าใบ.
 */
export async function ingestPoImages(input: {
  imageKeys: string[];
  origin: "CHINA" | "THAI";
}): Promise<IngestPoImagesResult> {
  const session = await requireSession();
  if (!canDcManage(session.user.role)) {
    return { ok: false, error: "ไม่มีสิทธิ์จัดการใบสั่งซื้อ" };
  }
  const orgId = session.user.org_id;
  const userId = session.user.id;

  const keys = (input.imageKeys ?? [])
    .map((k) => (typeof k === "string" ? k.trim() : ""))
    .filter(Boolean)
    // กันอ่านไฟล์ข้ามองค์กร: key ต้องอยู่ใต้ dc/po/<orgId>/
    .filter((k) => k.startsWith(`dc/po/${orgId}/`))
    .slice(0, MAX_IMAGES);
  if (keys.length === 0) return { ok: false, error: "ไม่พบรูปที่อัปโหลด" };

  const budget = await checkAiBudget({ userId, orgId, endpoint: "dc.po-ocr" });
  if (!budget.allowed) {
    return { ok: false, error: budget.reason ?? "เกินโควตา AI ชั่วคราว ลองใหม่ภายหลัง" };
  }

  const currency: "CNY" | "THB" = input.origin === "THAI" ? "THB" : "CNY";
  const items: OcrLineItem[] = [];
  const warnings: string[] = [];
  let extractedSum = 0;
  let rowSeq = 0;

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const imgNo = i + 1;
    let buf: Buffer;
    try {
      buf = await getObject(key);
    } catch {
      warnings.push(`รูปที่ ${imgNo}: เปิดไฟล์ไม่ได้ — ข้ามไป`);
      continue;
    }

    const mimeType = key.endsWith(".png")
      ? "image/png"
      : key.endsWith(".webp")
        ? "image/webp"
        : "image/jpeg";

    let ocr;
    try {
      ocr = await runOcr(buf.toString("base64"), mimeType);
    } catch {
      warnings.push(`รูปที่ ${imgNo}: อ่านด้วย AI ไม่สำเร็จ — ข้ามไป`);
      continue;
    }
    await recordAiUsage({
      userId,
      orgId,
      endpoint: "dc.po-ocr",
      model: ocr.model,
      moduleName: "dc",
      inputTokens: ocr.inTok,
      outputTokens: ocr.outTok,
    });

    const rawItems = Array.isArray(ocr.parsed.items)
      ? (ocr.parsed.items as RawItem[]).slice(0, MAX_ITEMS_PER_IMAGE)
      : [];
    if (rawItems.length === 0) {
      warnings.push(`รูปที่ ${imgNo}: อ่านรายการสินค้าไม่ได้ (อาจเป็นรูปสินค้าเปล่า) — คีย์เองได้`);
      continue;
    }

    // meta ภาพ (สำหรับครอป)
    let imgW = 0;
    let imgH = 0;
    try {
      const meta = await sharp(buf).metadata();
      imgW = meta.width ?? 0;
      imgH = meta.height ?? 0;
    } catch {
      /* ครอปไม่ได้ก็ปล่อยรูป null */
    }

    let imgSum = 0;
    let imgPieces = 0;

    for (const ri of rawItems) {
      const nameTh =
        toStr(ri.name_th) ?? toStr(ri.name_zh) ?? `สินค้า (รูปที่ ${imgNo})`;
      const qty = Math.max(0, Math.round(toNum(ri.qty)));
      const unitPrice = Math.max(0, toNum(ri.unit_price));
      if (qty <= 0 && unitPrice <= 0) continue; // แถวว่าง

      rowSeq += 1;
      imgSum += qty * unitPrice;
      imgPieces += qty;
      extractedSum += qty * unitPrice;

      // ครอปรูปสินค้า (ถ้ามี box + เปิดภาพได้)
      let croppedUrl: string | null = null;
      let croppedKey: string | null = null;
      if (imgW > 0 && imgH > 0) {
        const region = boxToRegion(ri.box_2d, imgW, imgH);
        if (region) {
          try {
            const cropBuf = await sharp(buf)
              .extract(region)
              .jpeg({ quality: 82 })
              .toBuffer();
            // เก็บ 2 ที่: R2 (สำเนาย่อ · แสดงผล) + Drive (ต้นฉบับครอป · best-effort).
            // croppedUrl = R2 display URL เสมอ → เก็บเป็นรูปสินค้าได้เหมือนเดิม.
            const stored = await storeDcProductImage({
              orgId,
              bytes: cropBuf,
              mimeType: "image/jpeg",
              name: `${safeImageName(nameTh)}-${randomUUID().slice(0, 8)}.jpg`,
            });
            croppedUrl = stored.url;
            croppedKey = stored.key;
          } catch {
            /* ครอปไม่ได้ → ปล่อยรูป null */
          }
        }
      }

      // จับคู่สินค้าเดิม (ชื่อตรง ไม่สนพิมพ์เล็ก/ใหญ่)
      let matchProductId: string | null = null;
      let matchLabel: string | null = null;
      const existing = await prisma.dcProduct.findFirst({
        where: { orgId, active: true, name: { equals: nameTh, mode: "insensitive" } },
        select: { id: true, name: true, sku: true },
      });
      if (existing) {
        matchProductId = existing.id;
        matchLabel = `${existing.name} · ${existing.sku}`;
      }

      items.push({
        key: `ocr-${rowSeq}`,
        nameZh: toStr(ri.name_zh),
        nameTh,
        qty,
        unitPrice,
        croppedUrl,
        croppedKey,
        matchProductId,
        matchLabel,
        sourceImage: imgNo,
      });
    }

    // ── ตรวจยอดรวมของรูปนี้ ──
    const declaredTotal = toNum(ocr.parsed.total_paid);
    const declaredPieces = Math.round(toNum(ocr.parsed.piece_count));
    if (declaredTotal > 0) {
      const diff = Math.abs(imgSum - declaredTotal);
      // เผื่อค่าส่ง/ส่วนลด ~5% → ถ้าเกินนั้นค่อยเตือน
      if (diff > Math.max(1, declaredTotal * 0.05)) {
        warnings.push(
          `รูปที่ ${imgNo}: ยอดรวมรายการ ${imgSum.toFixed(2)} ≠ ยอดในรูป ${declaredTotal.toFixed(2)} (ต่าง ${diff.toFixed(2)} — อาจเป็นค่าส่ง/อ่านเลขคลาด ตรวจอีกที)`,
        );
      }
    }
    if (declaredPieces > 0 && imgPieces !== declaredPieces) {
      warnings.push(
        `รูปที่ ${imgNo}: จำนวนชิ้นรวม ${imgPieces} ≠ ที่ระบุในรูป ${declaredPieces} ชิ้น — ตรวจจำนวนอีกที`,
      );
    }
  }

  if (items.length === 0) {
    return {
      ok: false,
      error:
        warnings[0] ??
        "อ่านรายการสินค้าจากรูปไม่ได้ — ลองรูปที่ชัดกว่า หรือคีย์เองได้",
    };
  }

  return { ok: true, items, totals: { extractedSum, currency }, warnings };
}
