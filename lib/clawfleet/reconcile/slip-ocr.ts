// ClawFleet · AI อ่านสลิปธนาคาร (ยอด/วันที่/ชื่อ+เลขบัญชีปลายทาง/เลขที่รายการ) — เวิร์กช็อป 2026-08-29
//
// Port มาจาก lib/chairops/reconcile/slip-ocr.ts (proven pattern — แก้บั๊กพังเงียบมาแล้ว 2 รอบ
// ในโปรดักชันจริง + แก้บั๊กเช็คบัญชีผิดด้วยชื่อติดธงเท็จ 72/75 ใบมาแล้วอีกรอบ) ไม่ใช่เขียนใหม่จากศูนย์
// เพื่อไม่พังซ้ำบั๊กเดิม 3 คลาส:
//   (1) auth provider ผิด → OCR fail เงียบทุกช่อง null แต่ ocrReadAt ติ๊กเหมือนสำเร็จ (ใช้ Gemini ตั้งแต่ต้น กันบั๊กนี้)
//   (2) thinkingConfig.thinkingBudget default กิน token คิดจน JSON ตอบไม่ครบ (ตั้ง thinkingBudget=0 เสมอ)
//   (3) เช็ค "บัญชีผิด" ด้วยชื่อบัญชี (ocrAccountName) แทนเลขบัญชี → ชื่อนิติบุคคลเต็มบนสลิปเขียนคนละ
//       รูปแบบกับชื่อย่อที่ตั้งค่าไว้ในระบบเสมอ → ติดธงเท็จเกือบทุกใบ (ChairOps ยืนยันจริง 73/73 ใบ)
//       → ใช้ ocrAccountNumber (เลขบัญชี, ตัวเลขล้วน, AI อ่านแม่นกว่ามาก) เป็นตัวชี้ขาดเท่านั้น
//
// Plain lib function (ไม่ใช่ "use server") — เรียกจาก server action (recordCashDeposit) เท่านั้น.

import { prisma } from "@/lib/prisma";
import { adminClient } from "@/lib/db/server";
import { isAllowedPhotoUrl } from "@/lib/chairops/utils/url-guard";
import { recordAiUsage } from "@/lib/ai/cost-cap";

export type SlipOcrDetails = {
  amount: number | null;
  date: string | null; // "YYYY-MM-DD"
  accountName: string | null; // display เท่านั้น — ห้ามใช้ตรวจ "บัญชีผิด"
  refNo: string | null;
  accountNumber: string | null; // ตัวชี้ขาดตรวจ "บัญชีผิด"
};

const EMPTY: SlipOcrDetails = {
  amount: null,
  date: null,
  accountName: null,
  refNo: null,
  accountNumber: null,
};

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

const SLIP_DETAILS_PROMPT = `นี่คือสลิปธนาคารไทย กรุณาอ่าน 5 อย่าง:
(1) ยอดเงินที่โอน/ฝาก (ไม่ใช่ยอดคงเหลือ)
(2) วันที่ทำรายการบนสลิป แปลงเป็น YYYY-MM-DD
(3) ชื่อบัญชีปลายทาง/ผู้รับโอนที่พิมพ์อยู่บนสลิป
(4) เลขที่รายการ/เลขอ้างอิงธุรกรรม (transaction ID / เลขที่รายการ / Ref no. — ถ้ามีพิมพ์อยู่บนสลิป)
(5) เลขบัญชีปลายทาง/ผู้รับโอน (destination account number — คัดลอกตัวเลขและขีดตามที่เห็นเป๊ะ แม้บางหลักจะถูกปิดบังด้วย x หรือ * ก็ใส่มาตามนั้น)

ตอบ JSON เท่านั้น ไม่มีข้อความอื่น ไม่มี markdown:
{"amount": <number|null>, "date": "<YYYY-MM-DD>"|null, "accountName": "<string>"|null, "refNo": "<string>"|null, "accountNumber": "<string>"|null}

ถ้าฟิลด์ไหนอ่านไม่ออก ให้คืน null ห้ามเดา`;

/** อ่านยอด/วันที่/ชื่อ+เลขบัญชีปลายทาง/เลขที่รายการจากรูปสลิปธนาคารไทย — best-effort เสมอ (ไม่ throw)
 *  อ่านไม่ได้ก็คืนค่า null ทุกช่อง */
export async function extractSlipDetails(
  slipPublicUrl: string,
  actor: { userId: string; orgId: string },
): Promise<SlipOcrDetails> {
  if (!slipPublicUrl || !isAllowedPhotoUrl(slipPublicUrl)) return EMPTY;
  if (!process.env.GEMINI_API_KEY) return EMPTY;

  try {
    const img = await fetchImageAsBase64(slipPublicUrl);
    if (!img) return EMPTY;

    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            { text: SLIP_DETAILS_PROMPT },
            { inlineData: { mimeType: img.mediaType, data: img.base64 } },
          ],
        },
      ],
      config: {
        temperature: 0,
        maxOutputTokens: 500,
        responseMimeType: "application/json",
        // ⚠️ ห้ามลบ — gemini-2.5-flash เผื่อ token ให้ "คิด" ก่อนตอบโดย default. ถ้าไม่ปิด
        // จะกิน maxOutputTokens จนตอบ JSON ไม่ครบ (finishReason: MAX_TOKENS, ขาดกลางคัน)
        // → คืนค่า null ทุกช่องเงียบ ๆ โดยไม่มี error เลย (บั๊กที่เคยทำให้ ChairOps ใช้งาน
        // ไม่ได้เลยสักใบตั้งแต่ deploy จนกว่าจะมีคนสงสัยแล้วไปสืบ — ดู memory chairops-reconcile-ledger-push).
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    try {
      await recordAiUsage({
        userId: actor.userId,
        orgId: actor.orgId,
        endpoint: "clawfleet.slip-ocr-details",
        provider: "gemini-flash",
        moduleName: "clawfleet",
        inputTokens: 1290,
        outputTokens: 100,
      });
    } catch {
      /* metering ต้องไม่ทำให้การอ่านสลิปพัง */
    }

    const text = (response.text ?? "").trim();
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return EMPTY;

    let parsed: {
      amount?: unknown;
      date?: unknown;
      accountName?: unknown;
      refNo?: unknown;
      accountNumber?: unknown;
    };
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
      typeof parsed.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : null;

    const accountName =
      typeof parsed.accountName === "string" && parsed.accountName.trim().length > 0
        ? parsed.accountName.trim().slice(0, 200)
        : null;

    const refNo =
      typeof parsed.refNo === "string" && parsed.refNo.trim().length > 0
        ? parsed.refNo.trim().slice(0, 100)
        : null;

    const accountNumber =
      typeof parsed.accountNumber === "string" && parsed.accountNumber.trim().length > 0
        ? parsed.accountNumber.trim().slice(0, 100)
        : null;

    return { amount, date, accountName, refNo, accountNumber };
  } catch (e) {
    console.error("[clawfleet] extractSlipDetails failed (non-fatal)", e);
    return EMPTY;
  }
}

export type SlipFraudCheck = { flagged: boolean; reason: string | null };

// เทียบเฉพาะตัวเลข — ตัด "-", "x", "*", ช่องว่างทิ้ง (บางสลิปปิดบังหลักกลางด้วย x/*).
const normalizeAcctNo = (s: string) => s.replace(/[^0-9]/g, "");

/**
 * ตรวจสลิปซ้ำ + บัญชีปลายทางไม่ตรงกับที่สาขาตั้งค่าไว้ — ผลนี้ใช้ตั้ง approvalStatus="PENDING"
 * (reuse สถานะเดิมที่ pushBranchDepositsToLedger กันออกจาก ledger push อยู่แล้ว ไม่ต้องเพิ่ม
 * enum ใหม่) พร้อมเหตุผลให้ office เห็นทันทีในหน้า review ที่มีอยู่แล้ว.
 *
 * เวิร์กช็อป 2026-08-29 ปรับ scope ให้กว้างกว่า ChairOps เดิม (ที่จำกัดแค่สาขาเดียวกัน):
 *  (1) เลขที่รายการตรงกัน → เช็ค "ทั้งองค์กร" (ไม่จำกัดสาขา) — เลขที่รายการธนาคารไม่ซ้ำกันข้าม
 *      ธุรกรรมจริงอยู่แล้ว ไม่มีต้นทุนเพิ่มจากการเช็คกว้างขึ้น แต่ปิดช่องโหว่พนักงานย้ายสาขาได้
 *  (2) ไม่มีเลขที่รายการอ่านได้ → fallback วันที่+ยอด สโคปตาม "กลุ่มสาขาที่ใช้บัญชีธนาคารเดียวกัน"
 *      (ผ่าน CfBranchReconcileConfig.bankAccountId) แม่นกว่า scope แค่สาขาเดียว เพราะสลิปซ้ำที่ใช้
 *      ได้จริงต้องเป็นบัญชีเดียวกัน ไม่ใช่สาขาเดียวกัน — ถ้าสาขานี้ยังไม่ผูกบัญชี fallback เป็น
 *      สาขาเดียวกันเหมือนเดิม (ปลอดภัยกว่าไม่เช็คเลย)
 */
export async function checkSlipFraud(args: {
  orgId: string;
  branchId: string;
  depositId: string;
  ocr: SlipOcrDetails;
  configuredAccountNumber: string | null;
}): Promise<SlipFraudCheck> {
  const { orgId, branchId, depositId, ocr, configuredAccountNumber } = args;

  if (ocr.refNo) {
    const dupRef = await prisma.cfCashDeposit.findFirst({
      where: { orgId, id: { not: depositId }, ocrRefNo: ocr.refNo },
      select: { id: true, depositedByName: true, branchId: true },
    });
    if (dupRef) {
      const sameBranch = dupRef.branchId === branchId;
      return {
        flagged: true,
        reason: `สลิปนี้มีเลขที่รายการตรงกับใบฝากอื่น${sameBranch ? "ในสาขาเดียวกัน" : "ต่างสาขา"} (โดย ${dupRef.depositedByName}) เป๊ะ — สงสัยเอาสลิปเดิมมาส่งซ้ำ กรุณาตรวจสอบ`,
      };
    }
  } else if (ocr.amount != null && ocr.date != null) {
    // fallback: สโคปตามกลุ่มสาขาที่ใช้บัญชีธนาคารเดียวกัน (แม่นกว่าสโคปแค่สาขาเดียว) —
    // ถ้าสาขานี้ยังไม่ผูกบัญชี fallback เป็นสาขาเดียวกันเหมือน ChairOps เดิม (ปลอดภัยกว่าไม่เช็คเลย)
    let scopeBranchIds: string[] = [branchId];
    try {
      const myConfig = await prisma.cfBranchReconcileConfig.findUnique({
        where: { branchId },
        select: { bankAccountId: true },
      });
      if (myConfig?.bankAccountId) {
        const siblings = await prisma.cfBranchReconcileConfig.findMany({
          where: { orgId, bankAccountId: myConfig.bankAccountId },
          select: { branchId: true },
        });
        if (siblings.length > 0) scopeBranchIds = siblings.map((s) => s.branchId);
      }
    } catch {
      // graceful: ยังไม่ผูกบัญชี/query ล้ม → คงสโคปสาขาเดียวเดิม
    }

    const dup = await prisma.cfCashDeposit.findFirst({
      where: {
        orgId,
        id: { not: depositId },
        branchId: { in: scopeBranchIds },
        ocrAmountCents: Math.round(ocr.amount * 100),
        ocrDate: new Date(`${ocr.date}T00:00:00.000Z`),
      },
      select: { id: true, depositedByName: true },
    });
    if (dup) {
      return {
        flagged: true,
        reason: `สลิปนี้วันที่+ยอดตรงกับใบฝากอื่น (โดย ${dup.depositedByName}) ในกลุ่มสาขาที่ใช้บัญชีเดียวกัน — กรุณาตรวจสอบว่าไม่ใช่สลิปเดิมที่เอามาส่งซ้ำ`,
      };
    }
  }

  // เทียบ "เลขบัญชี" เท่านั้น — ห้ามเทียบชื่อบัญชี (บทเรียน ChairOps 2026-08-29: เทียบชื่อติดธงเท็จ
  // 72/75 ใบ เพราะชื่อนิติบุคคลเต็มบนสลิปกับชื่อย่อที่ตั้งค่าไว้เขียนคนละรูปแบบกันเสมอ)
  if (configuredAccountNumber && ocr.accountNumber) {
    const a = normalizeAcctNo(configuredAccountNumber);
    const b = normalizeAcctNo(ocr.accountNumber);
    const matches = a.length >= 4 && b.length >= 4 && (a === b || a.endsWith(b) || b.endsWith(a));
    if (!matches) {
      return {
        flagged: true,
        reason: `เลขบัญชีปลายทางบนสลิป ("${ocr.accountNumber}") ดูไม่ตรงกับบัญชีที่ตั้งค่าไว้ ("${configuredAccountNumber}") — กรุณาตรวจสอบว่าเงินเข้าบัญชีถูกต้อง`,
      };
    }
  }

  return { flagged: false, reason: null };
}

/** อ่านเลขบัญชี (account_no) ที่ตั้งค่าไว้ให้สาขานี้ผ่าน CfBranchReconcileConfig → ledger_bank_account.
 *  ledger_bank_account ไม่มี Prisma model (ตารางของ LedgerLine อีกโปรแกรม) — อ่านผ่าน Supabase
 *  admin client ตรง ๆ (mirror app/(admin)/chairops/collect/actions.ts). graceful: ไม่ได้ผูกบัญชี/
 *  query ล้ม → null (checkSlipFraud ข้ามการเช็คนี้แบบไม่บล็อก ไม่ธง). */
export async function getConfiguredAccountNumber(branchId: string): Promise<string | null> {
  try {
    const config = await prisma.cfBranchReconcileConfig.findUnique({
      where: { branchId },
      select: { bankAccountId: true },
    });
    if (!config?.bankAccountId) return null;
    const admin = adminClient();
    const { data: acc } = await admin
      .from("ledger_bank_account")
      .select("account_no")
      .eq("id", config.bankAccountId)
      .maybeSingle();
    return (acc?.account_no as string | undefined) ?? null;
  } catch {
    return null;
  }
}
