// OCR สลิปโอน → Gemini Flash 2.5 Vision → JSON
// CEO 2026-05-20: เลือก Gemini Flash 2.5 เพราะถูกสุด · ~$3-27/เดือนตาม volume
//
// Input: FormData { file: image (jpeg/png/heic) }
// Output: { amount, bank, refNo, datetime, slipUrl } + null fields ถ้าอ่านไม่ออก
//
// Flow:
// 1. Auth + rate limit + budget check
// 2. Upload รูป → R2
// 3. ส่ง R2 URL ไป Gemini Vision
// 4. Parse JSON → return + record AI usage + audit

import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { putObject } from "@/lib/r2/upload";
import { checkAiBudget, recordAiUsage } from "@/lib/ai/cost-cap";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { audit } from "@/lib/audit/log";
import { getRequestMeta } from "@/lib/audit/request-meta";

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"];

interface OcrResult {
  amount: number | null;
  bank: string | null;
  refNo: string | null;
  datetime: string | null;
  raw: string;
}

export async function POST(req: NextRequest) {
  const session = await requireSession();
  const meta = getRequestMeta(req);

  if (!can(session.user, "cashhub.create")) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์" }, { status: 403 });
  }

  // Rate limit: 30 OCR / 5 min per user (staff ถ่ายหลายสลิปต่อครั้งได้)
  const rl = await checkRateLimit({
    bucket: `ocr-slip:${session.user.id}`,
    max: 30,
    windowSec: 300,
  });
  if (rl.limited) {
    return NextResponse.json(
      { error: `ส่งสลิปถี่เกินไป · ลองใหม่อีก ${rl.retryAfterSec} วินาที` },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }
  // IP cap กัน automation
  const ip = getClientIp(req);
  const rlIp = await checkRateLimit({
    bucket: `ocr-slip-ip:${ip}`,
    max: 60,
    windowSec: 300,
  });
  if (rlIp.limited) {
    return NextResponse.json(
      { error: "ระบบกำลังคึกคัก · ลองใหม่อีกสักครู่" },
      { status: 429 },
    );
  }

  const budget = await checkAiBudget({
    userId: session.user.id,
    orgId: session.user.org_id,
    endpoint: "cashhub.ocr-slip",
  });
  if (!budget.allowed) {
    return NextResponse.json({ error: budget.reason }, { status: 429 });
  }

  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      { error: "OCR ยังไม่ได้ตั้งค่า · ติดต่อ admin" },
      { status: 503 },
    );
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "ต้องแนบรูป" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `รูปใหญ่เกิน 8 MB (${(file.size / 1024 / 1024).toFixed(1)} MB)` },
      { status: 413 },
    );
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: `รูปแบบไฟล์ไม่รองรับ (${file.type})` },
      { status: 415 },
    );
  }

  // Upload to R2
  const ext = file.type.split("/")[1] || "jpg";
  const key = `cashhub/slips/${session.user.org_id}/${new Date().toISOString().slice(0, 10)}/${session.user.id}-${Date.now()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  let slipUrl: string;
  try {
    slipUrl = await putObject(key, buffer, file.type);
  } catch (err) {
    console.error("[ocr-slip] R2 upload failed", err);
    return NextResponse.json(
      { error: "อัปโหลดรูปไม่สำเร็จ ลองใหม่" },
      { status: 500 },
    );
  }

  // Call Gemini Vision
  let result: OcrResult;
  try {
    result = await parseSlipWithGemini(buffer, file.type);
  } catch (err) {
    console.error("[ocr-slip] gemini failed", err);
    return NextResponse.json(
      {
        // ยังคืน slipUrl ให้ form ใช้รูปได้แม้ OCR ล่ม
        amount: null,
        bank: null,
        refNo: null,
        datetime: null,
        slipUrl,
        error: "อ่านสลิปไม่ออก · กรอกยอดเอง",
      },
      { status: 200 },
    );
  }

  // Track usage (Gemini Flash 2.5 vision · ประมาณ 1290 input tokens/รูป + 100 output)
  await recordAiUsage({
    userId: session.user.id,
    orgId: session.user.org_id,
    endpoint: "cashhub.ocr-slip",
    provider: "gemini-flash",
    inputTokens: 1290,
    outputTokens: 100,
  });

  // Audit (slipUrl เก็บไว้ตามคำขอของ Accountant)
  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "DOCUFLOW_ANALYZE", // re-use existing AI vision audit type
    resourceType: "cashhub_slip_ocr",
    diff: {
      new: {
        slipUrl,
        parsedAmount: result.amount,
        bank: result.bank,
      },
    },
    ...meta,
  });

  return NextResponse.json({
    amount: result.amount,
    bank: result.bank,
    refNo: result.refNo,
    datetime: result.datetime,
    slipUrl,
  });
}

const OCR_PROMPT = `คุณเป็น OCR specialist อ่านสลิปโอนเงินภาษาไทย (K-Plus, SCB Easy, KMA, TTB Touch, Bualuang mBanking, ฯลฯ)

จากรูปสลิป ดึงข้อมูลเป็น JSON เท่านั้น (ไม่มีคำอธิบาย ไม่มี markdown ไม่มี code fence):

{
  "amount": <จำนวนเงิน เป็น number ไม่ใช้คอมม่า>,
  "bank": "<ชื่อย่อธนาคาร เช่น SCB, KBank, KTB, BBL, TTB, KMA, K-Plus, GSB, BAAC, UOB, CIMB, TISCO, KKP, LH>",
  "refNo": "<เลขอ้างอิงโอน 8-20 หลัก>",
  "datetime": "<วันเวลาในรูปแบบ YYYY-MM-DD HH:mm หรือ null ถ้าอ่านไม่เจอ>"
}

กฎ:
- ถ้าฟิลด์ไหนอ่านไม่ออก ให้คืน null ห้ามเดา
- amount ต้องไม่มีคอมม่า · ไม่มี ฿ · เป็น number ตรง ๆ
- bank ใช้ชื่อย่อภาษาอังกฤษเท่านั้น
- ถ้ารูปไม่ใช่สลิปโอนเงิน → คืน {"amount":null,"bank":null,"refNo":null,"datetime":null}`;

async function parseSlipWithGemini(
  buffer: Buffer,
  mimeType: string,
): Promise<OcrResult> {
  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

  const base64 = buffer.toString("base64");
  const result = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      {
        role: "user",
        parts: [
          { text: OCR_PROMPT },
          { inlineData: { mimeType, data: base64 } },
        ],
      },
    ],
    config: {
      temperature: 0,
      maxOutputTokens: 400,
      responseMimeType: "application/json",
    },
  });

  const raw = result.text ?? "";
  let parsed: {
    amount?: number | null;
    bank?: string | null;
    refNo?: string | null;
    datetime?: string | null;
  } = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    // model returned non-JSON; try to find {...} chunk
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        parsed = JSON.parse(m[0]);
      } catch {
        /* leave parsed empty */
      }
    }
  }

  return {
    amount: typeof parsed.amount === "number" && parsed.amount > 0 ? parsed.amount : null,
    bank: parsed.bank ?? null,
    refNo: parsed.refNo ?? null,
    datetime: parsed.datetime ?? null,
    raw,
  };
}
