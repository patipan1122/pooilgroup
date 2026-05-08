// DocuFlow — Capability H · AI Risk Analysis ("น่ากลัวไหม?")
// ────────────────────────────────────────────────────────────────────
// Spec: ดีเทลv1/DOCUFLOW.md §13
//
// Flow:
//   1. Read CanonicalDocument (name + fileKey + fileSize)
//   2. Check `document_analyses` cache by (documentId, fileKey, "risk")
//      → cache HIT  → return cached row
//      → cache MISS → continue
//   3. Reject docs > 50MB (R2 download timeout / cost guard)
//   4. Download object body from R2 → Buffer
//   5. Extract text (PDF only — fall back to "no extractor" notice)
//   6. Call Claude Haiku 4.5 with structured-JSON system prompt
//   7. Parse JSON → upsert into `document_analyses`
//   8. Return shaped DocumentAnalysisResult
//
// Cost guard:
//   - 10k chars max sent to Claude (pdf-extract.ts truncates)
//   - 50MB max download
//   - Cache by (documentId × fileKey × analysisType) — re-run only when
//     the file is replaced (renew workflow uploads to a new R2 key, so
//     the cache auto-invalidates).
// ────────────────────────────────────────────────────────────────────

import { GetObjectCommand } from "@aws-sdk/client-s3";
import { R2_BUCKET, r2 } from "@/lib/r2/client";
import { prisma } from "@/lib/prisma";
import { loadDocumentById } from "./data";
import { extractPdfText } from "./pdf-extract";

/* ============================================================
   Types
   ============================================================ */

export type RiskLevel = "green" | "yellow" | "red";

/** Shape persisted in document_analyses + returned over the wire. */
export interface DocumentAnalysisResult {
  id: string;
  documentId: string;
  fileKey: string;
  analysisType: "risk";
  riskLevel: RiskLevel;
  /** Short Thai summary (one or two lines). */
  summary: string;
  /** Structured metadata (docType, duration, amount, etc.). Strings only. */
  metadata: {
    docType?: string;
    duration?: string;
    amount?: string;
    [key: string]: string | undefined;
  };
  /** Headline list of "ควรระวัง" points. */
  watchOuts: string[];
  /** Headline list of "ปกติดี" points. */
  normalPoints: string[];
  modelUsed: string | null;
  tokensUsed: number | null;
  analyzedAt: Date;
  /** True when result came from cache (no Claude call this round). */
  fromCache: boolean;
}

export interface AnalyzeOpts {
  /** Force a fresh Claude call even if cache matches. */
  force?: boolean;
}

/* ============================================================
   Constants
   ============================================================ */

const ANALYSIS_TYPE = "risk" as const;
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB hard cap
const CLAUDE_MODEL = "claude-haiku-4-5-20251001";

/* ============================================================
   Public: analyzeDocument
   ============================================================ */

export async function analyzeDocument(
  documentId: string,
  orgId: string,
  opts: AnalyzeOpts = {},
): Promise<DocumentAnalysisResult> {
  const doc = await loadDocumentById(orgId, documentId);
  if (!doc || !doc.isActive) {
    throw new Error("ไม่พบเอกสาร");
  }

  // Cache lookup — keyed on (documentId, fileKey, type). When the doc
  // is renewed (new file uploaded → new fileKey), this auto-misses.
  if (!opts.force) {
    const cached = await prisma.documentAnalysis.findUnique({
      where: {
        documentId_fileKey_analysisType: {
          documentId,
          fileKey: doc.fileKey,
          analysisType: ANALYSIS_TYPE,
        },
      },
    });
    if (cached) return rowToResult(cached, true);
  }

  // Cost guard — bail before touching R2 if file is suspiciously large
  if (doc.fileSize && doc.fileSize > MAX_FILE_SIZE) {
    throw new Error(
      "ไฟล์ใหญ่เกินกำหนด (>50MB) — ขอเล็กกว่านี้ก่อนวิเคราะห์",
    );
  }

  // Download object body
  const buffer = await downloadFromR2(doc.fileKey);

  // Extract text — currently PDF only (most policy/contract docs are PDF)
  let extractedText: string;
  if (doc.mimeType === "application/pdf") {
    const ex = await extractPdfText(buffer);
    extractedText = ex.text;
  } else {
    extractedText =
      "[ไฟล์ที่อัปโหลดไม่ใช่ PDF — ไม่สามารถดึงข้อความได้]";
  }

  // Claude Haiku call
  const ai = await callClaudeRiskAnalysis({
    docName: doc.name,
    docDescription: doc.description ?? null,
    text: extractedText,
  });

  // Upsert into cache
  const upserted = await prisma.documentAnalysis.upsert({
    where: {
      documentId_fileKey_analysisType: {
        documentId,
        fileKey: doc.fileKey,
        analysisType: ANALYSIS_TYPE,
      },
    },
    create: {
      orgId,
      documentId,
      fileKey: doc.fileKey,
      analysisType: ANALYSIS_TYPE,
      riskLevel: ai.riskLevel,
      summaryText: ai.summary,
      watchOutPoints: ai.watchOuts,
      normalPoints: ai.normalPoints,
      metadataJson: ai.metadata,
      modelUsed: CLAUDE_MODEL,
      tokensUsed: ai.tokensUsed,
    },
    update: {
      riskLevel: ai.riskLevel,
      summaryText: ai.summary,
      watchOutPoints: ai.watchOuts,
      normalPoints: ai.normalPoints,
      metadataJson: ai.metadata,
      modelUsed: CLAUDE_MODEL,
      tokensUsed: ai.tokensUsed,
      analyzedAt: new Date(),
    },
  });

  return rowToResult(upserted, false);
}

/** Read-only cache lookup — used by GET /api/docuflow/[id]/analyze. */
export async function getCachedAnalysis(
  documentId: string,
  orgId: string,
): Promise<DocumentAnalysisResult | null> {
  // Need fileKey to scope cache row properly
  const doc = await prisma.document.findFirst({
    where: { id: documentId, orgId },
    select: { fileKey: true, isActive: true },
  });
  if (!doc || !doc.isActive) return null;

  const row = await prisma.documentAnalysis.findUnique({
    where: {
      documentId_fileKey_analysisType: {
        documentId,
        fileKey: doc.fileKey,
        analysisType: ANALYSIS_TYPE,
      },
    },
  });
  if (!row) return null;
  return rowToResult(row, true);
}

/* ============================================================
   Internal: Claude call + JSON parser
   ============================================================ */

interface ClaudeAnalysis {
  riskLevel: RiskLevel;
  summary: string;
  metadata: Record<string, string>;
  watchOuts: string[];
  normalPoints: string[];
  tokensUsed: number | null;
}

const SYSTEM_PROMPT = `คุณคือผู้ช่วยทนายความและผู้บริหาร Pooilgroup ที่อ่านเอกสารธุรกิจ (สัญญาเช่า, ประกันภัย, ใบอนุญาต, ฯลฯ) และสรุปให้เจ้าของอ่านเข้าใจง่ายก่อนเซ็น

หน้าที่:
1. อ่านเอกสารที่ส่งให้
2. ระบุประเภท (สัญญาเช่า / ประกัน / ใบอนุญาต / ฯลฯ)
3. ดึงตัวเลข/ระยะเวลา/วงเงินสำคัญ
4. หาข้อที่ "ควรระวัง" (เงื่อนไขผิดปกติ ค่าปรับสูง ภาระผู้เช่า ฯลฯ)
5. ระบุข้อที่ "ปกติดี" เพื่อความสบายใจ
6. ให้ระดับความเสี่ยง 1 ใน 3 ระดับ:
   - "green" = ปลอดภัย เอกสารมาตรฐาน
   - "yellow" = ควรระวัง มีบางข้อต้องอ่านดี
   - "red" = น่ากังวล มีเงื่อนไขผิดปกติ ควรปรึกษาก่อน

ตอบกลับเป็น JSON เท่านั้น (ไม่มีข้อความนอก JSON · ไม่ใช้ markdown code fence) ตาม schema:
{
  "docType": "string (ประเภทเอกสารภาษาไทย เช่น 'สัญญาเช่า')",
  "riskLevel": "green" | "yellow" | "red",
  "summary": "string (1-2 ประโยคภาษาไทย สรุปประเด็นหลัก)",
  "metadata": {
    "duration": "string (ระยะเวลา ถ้ามี เช่น '3 ปี')",
    "amount": "string (ค่าเช่า/เบี้ย/วงเงิน ถ้ามี)",
    "parties": "string (คู่สัญญา ถ้ามี)"
  },
  "watchOuts": ["ข้อความสั้นๆ ภาษาไทย", "..."],
  "normalPoints": ["ข้อความสั้นๆ ภาษาไทย", "..."]
}

กฎ:
- ภาษาไทยทั้งหมด ใช้คำง่ายๆ ไม่ใช้ศัพท์กฎหมายเยอะ
- watchOuts: 0-6 ข้อ (เน้นข้อสำคัญที่สุด)
- normalPoints: 0-4 ข้อ
- ห้ามแต่งข้อมูลที่ไม่ได้อยู่ในเอกสาร — ถ้าไม่มีให้เว้น metadata field นั้น
- ถ้าเอกสารไม่ใช่เอกสารธุรกิจ/อ่านไม่ออก → riskLevel="yellow", summary บอกตรงๆ ว่า "อ่านเนื้อหาไม่ได้ ให้ตรวจด้วยตนเอง"`;

async function callClaudeRiskAnalysis(input: {
  docName: string;
  docDescription: string | null;
  text: string;
}): Promise<ClaudeAnalysis> {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

  const userBody = [
    `ชื่อเอกสาร: ${input.docName}`,
    input.docDescription ? `คำอธิบาย: ${input.docDescription}` : null,
    "",
    "เนื้อหาเอกสาร:",
    "---",
    input.text || "(ไม่มีเนื้อหา)",
    "---",
    "",
    "ตอบกลับเป็น JSON ตาม schema เท่านั้น",
  ]
    .filter(Boolean)
    .join("\n");

  const result = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1500,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userBody }],
  });

  const rawText = result.content
    .filter((c) => c.type === "text")
    .map((c) => (c as { text: string }).text)
    .join("\n")
    .trim();

  const parsed = safeParseJson(rawText);
  const tokensUsed =
    (result.usage?.input_tokens ?? 0) + (result.usage?.output_tokens ?? 0) ||
    null;

  return {
    riskLevel: normaliseRiskLevel(parsed.riskLevel),
    summary:
      typeof parsed.summary === "string" && parsed.summary.trim().length > 0
        ? parsed.summary.trim()
        : "ไม่สามารถสรุปได้ — ตรวจด้วยตนเอง",
    metadata: normaliseMetadata(parsed),
    watchOuts: normaliseList(parsed.watchOuts),
    normalPoints: normaliseList(parsed.normalPoints),
    tokensUsed,
  };
}

/* ============================================================
   Internal helpers
   ============================================================ */

function safeParseJson(raw: string): Record<string, unknown> {
  // Tolerate accidental code fences or trailing prose
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
  }
  // If the model emitted prose around JSON, extract the first {...} block
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function normaliseRiskLevel(value: unknown): RiskLevel {
  if (value === "green" || value === "yellow" || value === "red") return value;
  return "yellow";
}

function normaliseList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
    .slice(0, 8);
}

function normaliseMetadata(
  parsed: Record<string, unknown>,
): Record<string, string> {
  const out: Record<string, string> = {};
  const docType = parsed.docType;
  if (typeof docType === "string" && docType.trim()) out.docType = docType.trim();

  const meta = parsed.metadata;
  if (meta && typeof meta === "object") {
    for (const [k, v] of Object.entries(meta as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim().length > 0) {
        out[k] = v.trim();
      }
    }
  }
  return out;
}

async function downloadFromR2(fileKey: string): Promise<Buffer> {
  const cmd = new GetObjectCommand({ Bucket: R2_BUCKET, Key: fileKey });
  const res = await r2.send(cmd);
  if (!res.Body) {
    throw new Error("ไม่สามารถดาวน์โหลดไฟล์จาก R2 ได้");
  }
  // AWS SDK v3 in Node returns a Readable stream; convert to Buffer.
  // Use the convenience method if present, fall back to manual read.
  const body = res.Body as {
    transformToByteArray?: () => Promise<Uint8Array>;
  };
  if (typeof body.transformToByteArray === "function") {
    const bytes = await body.transformToByteArray();
    return Buffer.from(bytes);
  }
  // Fallback for unusual stream shapes
  const stream = res.Body as AsyncIterable<Uint8Array>;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/* ============================================================
   DB row → DocumentAnalysisResult
   ============================================================ */

interface DocumentAnalysisRow {
  id: string;
  documentId: string;
  fileKey: string;
  analysisType: string;
  riskLevel: string | null;
  summaryText: string | null;
  watchOutPoints: unknown;
  normalPoints: unknown;
  metadataJson: unknown;
  modelUsed: string | null;
  tokensUsed: number | null;
  analyzedAt: Date;
}

function rowToResult(
  row: DocumentAnalysisRow,
  fromCache: boolean,
): DocumentAnalysisResult {
  const metadata: Record<string, string> = {};
  if (row.metadataJson && typeof row.metadataJson === "object") {
    for (const [k, v] of Object.entries(
      row.metadataJson as Record<string, unknown>,
    )) {
      if (typeof v === "string") metadata[k] = v;
    }
  }
  return {
    id: row.id,
    documentId: row.documentId,
    fileKey: row.fileKey,
    analysisType: ANALYSIS_TYPE,
    riskLevel: normaliseRiskLevel(row.riskLevel),
    summary: row.summaryText ?? "",
    metadata,
    watchOuts: normaliseList(row.watchOutPoints),
    normalPoints: normaliseList(row.normalPoints),
    modelUsed: row.modelUsed,
    tokensUsed: row.tokensUsed,
    analyzedAt: row.analyzedAt,
    fromCache,
  };
}
