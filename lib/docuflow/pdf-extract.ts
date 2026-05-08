// DocuFlow — PDF text extractor for Capability H (AI Risk Analysis)
// ────────────────────────────────────────────────────────────────────
// Wraps `pdf-parse` v2 (PDFParse class) and returns a normalised plain-
// text string capped at MAX_CHARS. Used by `analyzeDocument` to feed
// Claude Haiku with a bounded context window.
//
// Cost guard: hard-cap at 10k characters — Haiku context + cost stays
// predictable per analysis (~3-4k tokens of input).
// ────────────────────────────────────────────────────────────────────

import { PDFParse } from "pdf-parse";

/** Hard cap on characters sent downstream (Claude). ~3-4k tokens. */
export const MAX_PDF_TEXT_CHARS = 10_000;

export interface ExtractResult {
  /** Plain-text content, normalised, truncated to MAX_PDF_TEXT_CHARS. */
  text: string;
  /** Whether truncation occurred. */
  truncated: boolean;
  /** Total pages in the source PDF (best-effort). */
  totalPages: number;
  /** Original (pre-truncation) character count. */
  originalChars: number;
}

/**
 * Extract plain text from a PDF buffer.
 *
 * Returns a graceful error message string instead of throwing for
 * invalid / encrypted / unparsable PDFs. The caller can detect this by
 * checking `text.startsWith("ไม่สามารถอ่านไฟล์")`.
 */
export async function extractPdfText(buffer: Buffer): Promise<ExtractResult> {
  try {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const result = await parser.getText();
      const raw = (result?.text ?? "").trim();
      // Collapse excessive whitespace — preserves paragraph breaks but
      // drops multi-blank-line runs that just inflate token count.
      const normalised = raw
        .replace(/\r\n/g, "\n")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

      const originalChars = normalised.length;
      const truncated = originalChars > MAX_PDF_TEXT_CHARS;
      const text = truncated
        ? `${normalised.slice(0, MAX_PDF_TEXT_CHARS)}\n\n[... ตัดข้อความที่เหลือ ...]`
        : normalised;

      return {
        text,
        truncated,
        totalPages: result?.total ?? 0,
        originalChars,
      };
    } finally {
      // Always free worker resources
      try {
        await parser.destroy();
      } catch {
        /* ignore */
      }
    }
  } catch (err) {
    console.error("[extractPdfText] failed", err);
    return {
      text: "ไม่สามารถอ่านไฟล์ PDF ได้ (ไฟล์อาจเสียหรือมีรหัสผ่าน)",
      truncated: false,
      totalPages: 0,
      originalChars: 0,
    };
  }
}
