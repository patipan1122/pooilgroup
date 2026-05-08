// DocuFlow · AI metadata extraction (Capability J support)
// ────────────────────────────────────────────────────────────────────
// Spec: ดีเทลv1/DOCUFLOW.md §14 — เปรียบเทียบของเดิม vs ใหม่
//
// Pulls structured numerical fields out of insurance / rental /
// registration / general docs using Claude Haiku. Result cached in
// `document_analyses` (analysisType='metadata') keyed by fileKey, so
// the same file is only ever analysed once.
//
// Why Haiku: cheap (≈$0.80 / $4 per Mtok), fast (~1-3s), more than
// good enough for "lift this number out of the PDF" tasks.
// ────────────────────────────────────────────────────────────────────

import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getSignedDownloadUrl } from "./r2";
import { extractPdfText } from "./pdf-extract";

/* ============================================================
   Types
   ============================================================ */

export type MetadataKind =
  | "insurance"
  | "rental"
  | "registration"
  | "auto";

export interface InsuranceMetadata {
  kind: "insurance";
  premium?: number; // เบี้ยประกัน (THB)
  deductible?: number; // ค่าเสียหายส่วนแรก (THB)
  sumInsured?: number; // ทุนประกัน (THB)
  periodMonths?: number; // ระยะเวลาคุ้มครอง (เดือน)
  insurer?: string; // บริษัทประกัน
}

export interface RentalMetadata {
  kind: "rental";
  monthlyRent?: number; // ค่าเช่า / เดือน (THB)
  deposit?: number; // เงินมัดจำ (THB)
  periodMonths?: number; // ระยะเวลาเช่า (เดือน)
  terminationNoticeMonths?: number; // บอกเลิกล่วงหน้า (เดือน)
  renewalIncrease?: number; // % ขึ้นค่าเช่าเมื่อต่อ
}

export interface RegistrationMetadata {
  kind: "registration";
  tax?: number; // ภาษีรถ (THB)
  periodMonths?: number; // อายุทะเบียน
}

export interface UnknownMetadata {
  kind: "unknown";
  notes?: string;
}

export type ExtractedMetadata =
  | InsuranceMetadata
  | RentalMetadata
  | RegistrationMetadata
  | UnknownMetadata;

export interface ExtractResult {
  documentId: string;
  fileKey: string;
  metadata: ExtractedMetadata;
  modelUsed: string | null;
  tokensUsed: number | null;
  analyzedAt: Date;
  cached: boolean;
}

/* ============================================================
   Public API
   ============================================================ */

/**
 * Extract structured metadata for a document. Caches result in
 * `document_analyses` table keyed by `(documentId, fileKey, 'metadata')`.
 * Returns the cached row if it exists and matches the current fileKey
 * (i.e. the underlying file hasn't been replaced).
 *
 * @throws when ANTHROPIC_API_KEY is missing or the model call fails.
 */
export async function extractDocumentMetadata(
  documentId: string,
  orgId: string,
  kind: MetadataKind = "auto",
): Promise<ExtractResult> {
  // Resolve doc + check ownership (org scope)
  const doc = await prisma.document.findFirst({
    where: { id: documentId, orgId },
    select: {
      id: true,
      name: true,
      fileKey: true,
      mimeType: true,
      isActive: true,
    },
  });
  if (!doc) throw new Error("ไม่พบเอกสาร");
  if (!doc.isActive) throw new Error("เอกสารถูกลบแล้ว");

  // Cache lookup
  const cached = await prisma.documentAnalysis.findFirst({
    where: {
      documentId,
      orgId,
      analysisType: "metadata",
      fileKey: doc.fileKey,
    },
  });
  if (cached) {
    return {
      documentId,
      fileKey: doc.fileKey,
      metadata: (cached.metadataJson as unknown as ExtractedMetadata) ?? {
        kind: "unknown",
      },
      modelUsed: cached.modelUsed,
      tokensUsed: cached.tokensUsed,
      analyzedAt: cached.analyzedAt,
      cached: true,
    };
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "AI metadata extraction ยังไม่ได้ตั้งค่า — ใส่ ANTHROPIC_API_KEY ใน .env",
    );
  }

  // Decide kind heuristically from filename if 'auto'
  const resolvedKind = kind === "auto" ? guessKindFromName(doc.name) : kind;

  // Pull file text
  const text = await fetchDocumentText(doc.fileKey, doc.mimeType);
  if (!text || text.length < 30) {
    // Empty / unreadable — store an unknown marker (still a valid cache)
    const meta: UnknownMetadata = {
      kind: "unknown",
      notes: "อ่านเนื้อเอกสารไม่ได้ (อาจเป็นไฟล์รูปภาพ scan)",
    };
    return saveAndReturn(documentId, orgId, doc.fileKey, meta, null, null);
  }

  // Run Claude Haiku
  const { metadata, modelUsed, tokensUsed } = await callClaude(
    text,
    resolvedKind,
    doc.name,
  );

  return saveAndReturn(
    documentId,
    orgId,
    doc.fileKey,
    metadata,
    modelUsed,
    tokensUsed,
  );
}

/* ============================================================
   Helpers
   ============================================================ */

function guessKindFromName(name: string): MetadataKind {
  const lower = name.toLowerCase();
  if (
    lower.includes("ประกัน") ||
    lower.includes("insurance") ||
    lower.includes("กรมธรรม์")
  ) {
    return "insurance";
  }
  if (
    lower.includes("เช่า") ||
    lower.includes("rental") ||
    lower.includes("lease") ||
    lower.includes("สัญญาเช่า")
  ) {
    return "rental";
  }
  if (
    lower.includes("ทะเบียน") ||
    lower.includes("ภาษี") ||
    lower.includes("registration")
  ) {
    return "registration";
  }
  return "auto";
}

async function fetchDocumentText(
  fileKey: string,
  mimeType: string | null,
): Promise<string> {
  // Pull a fresh signed URL & download bytes server-side
  const url = await getSignedDownloadUrl(fileKey, 600);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ดาวน์โหลดเอกสารไม่ได้ (HTTP ${res.status})`);

  if (mimeType === "application/pdf" || fileKey.toLowerCase().endsWith(".pdf")) {
    const buf = Buffer.from(await res.arrayBuffer());
    // Reuse the capability-H helper (caps at 10k chars, normalises whitespace)
    const out = await extractPdfText(buf);
    if (out.text.startsWith("ไม่สามารถอ่านไฟล์")) return "";
    return out.text;
  }

  if (mimeType?.startsWith("text/")) {
    return (await res.text()).slice(0, 60_000);
  }

  // Images / unsupported → empty string (caller stores 'unknown')
  return "";
}

interface ClaudeResult {
  metadata: ExtractedMetadata;
  modelUsed: string;
  tokensUsed: number | null;
}

async function callClaude(
  text: string,
  kind: MetadataKind,
  docName: string,
): Promise<ClaudeResult> {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

  const SYSTEM_PROMPT = `คุณคือผู้ช่วยดึงข้อมูลตัวเลขจากเอกสารธุรกิจของ Pooilgroup
หน้าที่: อ่านเนื้อเอกสาร แล้วคืนค่า JSON อย่างเดียว ห้ามใส่คำอธิบาย/markdown
ทุกค่าที่หาไม่เจอ ห้ามเดา → ละ field นั้นไป
ตัวเลขเงินเป็น number บาท (ห้ามใส่หน่วย/comma) เช่น 21200 ไม่ใช่ "฿21,200"`;

  const targetSchema = SCHEMAS[kind === "auto" ? "auto" : kind];

  const userPrompt = `ชื่อเอกสาร: ${docName}
ประเภทที่คาดว่า: ${kind}

ดึงข้อมูลตาม schema นี้ (เป็น JSON เท่านั้น):
${targetSchema}

เนื้อเอกสาร:
"""
${text.slice(0, 10_000)}
"""

ตอบเป็น JSON object อย่างเดียว:`;

  const result = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 600,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userPrompt }],
  });

  const raw = result.content
    .filter((c) => c.type === "text")
    .map((c) => (c as { text: string }).text)
    .join("\n");

  const metadata = parseLooseJson(raw, kind);
  const tokensUsed =
    (result.usage?.input_tokens ?? 0) + (result.usage?.output_tokens ?? 0) ||
    null;

  return {
    metadata,
    modelUsed: "claude-haiku-4-5-20251001",
    tokensUsed,
  };
}

const SCHEMAS: Record<"insurance" | "rental" | "registration" | "auto", string> = {
  insurance: `{
  "kind": "insurance",
  "premium": number?         // เบี้ยประกัน (บาท)
  "deductible": number?      // ค่าเสียหายส่วนแรก (บาท)
  "sumInsured": number?      // ทุนประกัน (บาท)
  "periodMonths": number?    // ระยะเวลาคุ้มครอง เป็นเดือน
  "insurer": string?         // ชื่อบริษัทประกัน
}`,
  rental: `{
  "kind": "rental",
  "monthlyRent": number?              // ค่าเช่า/เดือน (บาท)
  "deposit": number?                  // เงินมัดจำ (บาท)
  "periodMonths": number?             // ระยะเวลาเช่า เป็นเดือน
  "terminationNoticeMonths": number?  // บอกเลิกล่วงหน้า เป็นเดือน
  "renewalIncrease": number?          // % ขึ้นค่าเช่าเมื่อต่อ
}`,
  registration: `{
  "kind": "registration",
  "tax": number?           // ภาษีรถ (บาท)
  "periodMonths": number?  // อายุทะเบียน เป็นเดือน
}`,
  auto: `{
  "kind": "insurance" | "rental" | "registration" | "unknown",
  // จากนั้นใส่ field ตามชนิดที่เลือก เช่นถ้าเป็น insurance ให้ใส่ premium, deductible, sumInsured, periodMonths, insurer
}`,
};

function parseLooseJson(raw: string, kind: MetadataKind): ExtractedMetadata {
  // Strip markdown fences if Claude added any despite the system prompt
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try {
    const obj = JSON.parse(cleaned) as Record<string, unknown>;
    if (
      typeof obj.kind === "string" &&
      ["insurance", "rental", "registration", "unknown"].includes(obj.kind)
    ) {
      return obj as unknown as ExtractedMetadata;
    }
    // Coerce by requested kind
    if (kind !== "auto") {
      return { ...(obj as object), kind } as ExtractedMetadata;
    }
    return { kind: "unknown", notes: "AI ระบุประเภทไม่ได้" };
  } catch {
    return { kind: "unknown", notes: "AI ตอบไม่เป็น JSON" };
  }
}

async function saveAndReturn(
  documentId: string,
  orgId: string,
  fileKey: string,
  metadata: ExtractedMetadata,
  modelUsed: string | null,
  tokensUsed: number | null,
): Promise<ExtractResult> {
  const row = await prisma.documentAnalysis.upsert({
    where: {
      documentId_fileKey_analysisType: {
        documentId,
        fileKey,
        analysisType: "metadata",
      },
    },
    create: {
      orgId,
      documentId,
      fileKey,
      analysisType: "metadata",
      metadataJson: metadata as unknown as Prisma.InputJsonValue,
      modelUsed,
      tokensUsed,
    },
    update: {
      metadataJson: metadata as unknown as Prisma.InputJsonValue,
      modelUsed,
      tokensUsed,
      analyzedAt: new Date(),
    },
  });

  return {
    documentId,
    fileKey,
    metadata,
    modelUsed: row.modelUsed,
    tokensUsed: row.tokensUsed,
    analyzedAt: row.analyzedAt,
    cached: false,
  };
}

/* ============================================================
   Bulk loader — for the chain view (read-only, never triggers AI)
   ============================================================ */

/** Get cached metadata for many documents at once. No AI call. */
export async function loadCachedMetadataMap(
  orgId: string,
  documentIds: string[],
): Promise<Map<string, ExtractedMetadata>> {
  if (documentIds.length === 0) return new Map();
  const rows = await prisma.documentAnalysis.findMany({
    where: {
      orgId,
      analysisType: "metadata",
      documentId: { in: documentIds },
    },
    select: { documentId: true, fileKey: true, metadataJson: true },
  });
  // If the doc's current fileKey doesn't match the cached one, the cache
  // is stale (file got replaced). The chain view doesn't have the current
  // fileKey here, so we trust the most recent row per documentId.
  const latest = new Map<string, ExtractedMetadata>();
  for (const r of rows) {
    const meta = r.metadataJson as unknown as ExtractedMetadata | null;
    if (meta) latest.set(r.documentId, meta);
  }
  return latest;
}
