// AI อ่านสลิปธนาคาร (ยอด/วันที่/ชื่อบัญชีปลายทาง/เลขที่รายการ) — CEO 2026-08-17,
// เพิ่มเลขที่รายการ 2026-08-18.
//
// พี่น้องของ extractSlipAmount ใน app/(admin)/chairops/collect/actions.ts (ตัวนั้น
// อ่านแค่ยอดสำหรับ auto-fill ฟอร์มแม่บ้านแบบ ephemeral ไม่เก็บผล). ตัวนี้อ่านครบ 4
// อย่างเพื่อเก็บถาวรบน ChairopsCashDeposit — ใช้ตรวจสลิปซ้ำ (เลขที่รายการตรงกัน หรือ
// fallback วันที่+ยอดตรงกัน — ในสาขาเดียวกันเท่านั้น) และบัญชีปลายทางไม่ตรงกับที่
// สาขาตั้งค่าไว้ (checkSlipFraud ด้านล่าง).
//
// Plain lib function (ไม่ใช่ "use server") — เรียกจาก server action (batchDeposit)
// เท่านั้น ไม่ได้ตั้งใจให้ client เรียกตรง (ดู memory:
// feedback-use-server-file-export-raw-tenant-id — helper ที่รับ orgId ดิบต้องอยู่
// นอกไฟล์ "use server").

import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { isAllowedPhotoUrl } from "@/lib/chairops/utils/url-guard";
import { recordAiUsage } from "@/lib/ai/cost-cap";

export type SlipOcrDetails = {
  amount: number | null;
  date: string | null; // "YYYY-MM-DD"
  accountName: string | null;
  // CEO 2026-08-18: เลขที่รายการ/เลขอ้างอิงบนสลิป — ถ้าอ่านได้และตรงกันเป๊ะกับใบ
  // อื่น = สัญญาณสลิปซ้ำที่มั่นใจสูงกว่าวันที่+ยอด (สลิป 2 ใบคนละรายการจริงแทบ
  // เป็นไปไม่ได้ที่จะมีเลขรายการตรงกัน ต่างจากยอด+วันที่ที่บังเอิญตรงกันได้).
  refNo: string | null;
};

const EMPTY: SlipOcrDetails = { amount: null, date: null, accountName: null, refNo: null };

async function fetchImageAsBase64(
  url: string,
): Promise<{ base64: string; mediaType: "image/jpeg" | "image/png" | "image/webp" } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "image/jpeg";
    const mediaType = ct.startsWith("image/png")
      ? "image/png"
      : ct.startsWith("image/webp")
        ? "image/webp"
        : "image/jpeg";
    const buf = Buffer.from(await res.arrayBuffer());
    return { base64: buf.toString("base64"), mediaType };
  } catch {
    return null;
  }
}

/** อ่านยอด/วันที่/ชื่อบัญชีปลายทางจากรูปสลิปธนาคารไทย — best-effort เสมอ (ไม่ throw)
 *  อ่านไม่ได้ก็คืนค่า null ทุกช่อง เหมือน extractSlipAmount เดิม */
export async function extractSlipDetails(
  slipPublicUrl: string,
  actor: { userId: string; orgId: string },
): Promise<SlipOcrDetails> {
  if (!slipPublicUrl || !isAllowedPhotoUrl(slipPublicUrl)) return EMPTY;

  try {
    const img = await fetchImageAsBase64(slipPublicUrl);
    if (!img) return EMPTY;

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 256,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: img.mediaType, data: img.base64 },
            },
            {
              type: "text",
              text:
                "นี่คือสลิปธนาคารไทย กรุณาอ่าน 4 อย่าง: " +
                "(1) ยอดเงินที่โอน/ฝาก (ไม่ใช่ยอดคงเหลือ) " +
                "(2) วันที่ทำรายการบนสลิป แปลงเป็น YYYY-MM-DD " +
                "(3) ชื่อบัญชีปลายทาง/ผู้รับโอนที่พิมพ์อยู่บนสลิป " +
                "(4) เลขที่รายการ/เลขอ้างอิงธุรกรรม (transaction ID / เลขที่รายการ / " +
                "Ref no. — ถ้ามีพิมพ์อยู่บนสลิป) " +
                'ตอบ JSON เท่านั้น ไม่มีข้อความอื่น: {"amount": <number|null>, ' +
                '"date": "<YYYY-MM-DD>"|null, "accountName": "<string>"|null, ' +
                '"refNo": "<string>"|null}',
            },
          ],
        },
      ],
    });

    // บันทึกต้นทุน AI แยก endpoint จาก extractSlipAmount เดิม (ตัวนี้ยิงเพิ่มจริง
    // ไม่ใช่ตัวเดียวกัน — อยากให้ CostCtrl แยกเห็นชัดว่ามาจากจุดไหน). Non-fatal.
    try {
      await recordAiUsage({
        userId: actor.userId,
        orgId: actor.orgId,
        endpoint: "chairops.slip-ocr-details",
        model: "claude-haiku-4-5-20251001",
        moduleName: "chairops",
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
      });
    } catch {
      /* metering ต้องไม่ทำให้การอ่านสลิปพัง */
    }

    const text =
      response.content[0]?.type === "text" ? response.content[0].text.trim() : "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return EMPTY;

    let parsed: { amount?: unknown; date?: unknown; accountName?: unknown; refNo?: unknown };
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return EMPTY;
    }

    const amountNum =
      typeof parsed.amount === "number" || typeof parsed.amount === "string"
        ? Math.round(Number(parsed.amount))
        : null;
    const amount = amountNum != null && !isNaN(amountNum) && amountNum > 0 ? amountNum : null;

    const date =
      typeof parsed.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date)
        ? parsed.date
        : null;

    const accountName =
      typeof parsed.accountName === "string" && parsed.accountName.trim().length > 0
        ? parsed.accountName.trim().slice(0, 200)
        : null;

    const refNo =
      typeof parsed.refNo === "string" && parsed.refNo.trim().length > 0
        ? parsed.refNo.trim().slice(0, 100)
        : null;

    return { amount, date, accountName, refNo };
  } catch (e) {
    console.error("[chairops] extractSlipDetails failed (non-fatal)", e);
    return EMPTY;
  }
}

export type SlipFraudCheck = { flagged: boolean; reason: string | null };

const normalizeName = (s: string) => s.replace(/\s+/g, "").toLowerCase();

/** ตรวจสลิปซ้ำ (ในสาขาเดียวกันเท่านั้น — CEO 2026-08-18: "ให้จับเลขในสาขาเดียวกันที่
 *  พนักงานคนนั้นดูแล เพื่อที่จะได้ไม่ต้องเช็คเยอะ") + บัญชีปลายทางไม่ตรงกับที่สาขา
 *  ตั้งค่าไว้ (ถ้าตั้งค่าไว้แล้วและอ่านชื่อบัญชีได้ทั้งคู่) — ผลนี้ใช้ตั้ง requiresReview
 *  เหมือนเกณฑ์ |diff|>=500 เดิม (BF1 MAID-04), พร้อมเหตุผลให้ office เห็นทันทีในหน้า
 *  คิวตรวจสอบ ไม่ต้องเดา.
 *
 *  ลำดับตรวจสลิปซ้ำ: (1) เลขที่รายการตรงกันเป๊ะ = มั่นใจสูงสุด (สลิปจริง 2 ใบคนละ
 *  รายการแทบเป็นไปไม่ได้ที่เลขจะตรงกัน) → เช็คก่อนเสมอถ้าอ่านได้ (2) ไม่มีเลขที่
 *  รายการอ่านได้ → fallback วันที่+ยอดตรงกัน (สัญญาณอ่อนกว่า อาจบังเอิญตรงกันได้ แต่
 *  ยังคุ้มที่จะติดธงให้คนตรวจ). Best-effort — ไม่มีวันที่/ยอดอ่านได้ก็ข้ามการตรวจซ้ำ
 *  (เกณฑ์เดิม |diff|>=500 ยังทำงานแยกต่างหากอยู่แล้ว). */
export async function checkSlipFraud(args: {
  orgId: string;
  branchId: string;
  depositId: string;
  ocr: SlipOcrDetails;
  configuredAccountName: string | null;
}): Promise<SlipFraudCheck> {
  const { orgId, branchId, depositId, ocr, configuredAccountName } = args;

  if (ocr.refNo) {
    const dupRef = await prisma.chairopsCashDeposit.findFirst({
      where: { orgId, branchId, id: { not: depositId }, ocrRefNo: ocr.refNo },
      select: { id: true, maid: { select: { displayName: true } } },
    });
    if (dupRef) {
      return {
        flagged: true,
        reason: `สลิปนี้มีเลขที่รายการตรงกับใบฝากอื่นในสาขาเดียวกัน (โดย ${dupRef.maid.displayName}) เป๊ะ — สงสัยเอาสลิปเดิมมาส่งซ้ำ กรุณาตรวจสอบ`,
      };
    }
  } else if (ocr.amount != null && ocr.date != null) {
    const dup = await prisma.chairopsCashDeposit.findFirst({
      where: {
        orgId,
        branchId,
        id: { not: depositId },
        ocrAmount: ocr.amount,
        ocrDate: new Date(`${ocr.date}T00:00:00.000Z`),
      },
      select: { id: true, maid: { select: { displayName: true } } },
    });
    if (dup) {
      return {
        flagged: true,
        reason: `สลิปนี้วันที่+ยอดตรงกับใบฝากอื่นในสาขาเดียวกัน (โดย ${dup.maid.displayName}) — กรุณาตรวจสอบว่าไม่ใช่สลิปเดิมที่เอามาส่งซ้ำ`,
      };
    }
  }

  if (configuredAccountName && ocr.accountName) {
    const a = normalizeName(configuredAccountName);
    const b = normalizeName(ocr.accountName);
    const matches = a.length > 0 && b.length > 0 && (a.includes(b) || b.includes(a));
    if (!matches) {
      return {
        flagged: true,
        reason: `ชื่อบัญชีปลายทางบนสลิป ("${ocr.accountName}") ดูไม่ตรงกับบัญชีที่ตั้งค่าไว้ ("${configuredAccountName}") — กรุณาตรวจสอบว่าเงินเข้าบัญชีถูกต้อง`,
      };
    }
  }

  return { flagged: false, reason: null };
}
