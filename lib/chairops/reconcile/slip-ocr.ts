// AI อ่านสลิปธนาคาร (ยอด/วันที่/ชื่อบัญชีปลายทาง) — CEO 2026-08-17.
//
// พี่น้องของ extractSlipAmount ใน app/(admin)/chairops/collect/actions.ts (ตัวนั้น
// อ่านแค่ยอดสำหรับ auto-fill ฟอร์มแม่บ้านแบบ ephemeral ไม่เก็บผล). ตัวนี้อ่านครบ 3
// อย่างเพื่อเก็บถาวรบน ChairopsCashDeposit — ใช้ตรวจสลิปซ้ำ (วันที่+ยอด ตรงกับใบอื่น)
// และบัญชีปลายทางไม่ตรงกับที่สาขาตั้งค่าไว้ (checkSlipFraud ด้านล่าง).
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
};

const EMPTY: SlipOcrDetails = { amount: null, date: null, accountName: null };

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
                "นี่คือสลิปธนาคารไทย กรุณาอ่าน 3 อย่าง: " +
                "(1) ยอดเงินที่โอน/ฝาก (ไม่ใช่ยอดคงเหลือ) " +
                "(2) วันที่ทำรายการบนสลิป แปลงเป็น YYYY-MM-DD " +
                "(3) ชื่อบัญชีปลายทาง/ผู้รับโอนที่พิมพ์อยู่บนสลิป " +
                'ตอบ JSON เท่านั้น ไม่มีข้อความอื่น: {"amount": <number|null>, ' +
                '"date": "<YYYY-MM-DD>"|null, "accountName": "<string>"|null}',
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

    let parsed: { amount?: unknown; date?: unknown; accountName?: unknown };
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

    return { amount, date, accountName };
  } catch (e) {
    console.error("[chairops] extractSlipDetails failed (non-fatal)", e);
    return EMPTY;
  }
}

export type SlipFraudCheck = { flagged: boolean; reason: string | null };

const normalizeName = (s: string) => s.replace(/\s+/g, "").toLowerCase();

/** ตรวจสลิปซ้ำ (วันที่+ยอดตรงกับใบฝากอื่นในองค์กร — คนละใบ) + บัญชีปลายทางไม่ตรง
 *  กับที่สาขาตั้งค่าไว้ (ถ้าตั้งค่าไว้แล้วและอ่านชื่อบัญชีได้ทั้งคู่) — ผลนี้ใช้ตั้ง
 *  requiresReview เหมือนเกณฑ์ |diff|>=500 เดิม (BF1 MAID-04), พร้อมเหตุผลให้ office
 *  เห็นทันทีในหน้าคิวตรวจสอบ ไม่ต้องเดา. Best-effort — ไม่มีวันที่/ยอดอ่านได้ก็ข้าม
 *  การตรวจซ้ำ (เกณฑ์เดิม |diff|>=500 ยังทำงานแยกต่างหากอยู่แล้ว). */
export async function checkSlipFraud(args: {
  orgId: string;
  depositId: string;
  ocr: SlipOcrDetails;
  configuredAccountName: string | null;
}): Promise<SlipFraudCheck> {
  const { orgId, depositId, ocr, configuredAccountName } = args;

  if (ocr.amount != null && ocr.date != null) {
    const dup = await prisma.chairopsCashDeposit.findFirst({
      where: {
        orgId,
        id: { not: depositId },
        ocrAmount: ocr.amount,
        ocrDate: new Date(`${ocr.date}T00:00:00.000Z`),
      },
      select: { id: true, branch: { select: { name: true } } },
    });
    if (dup) {
      return {
        flagged: true,
        reason: `สลิปนี้ดูเหมือนซ้ำกับใบฝากอื่นที่สาขา "${dup.branch.name}" (วันที่+ยอดตรงกัน) — กรุณาตรวจสอบว่าไม่ใช่สลิปเดิมที่เอามาส่งซ้ำ`,
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
