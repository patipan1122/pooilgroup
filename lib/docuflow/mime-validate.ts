// DocuFlow MIME / magic-byte validator
// ────────────────────────────────────────────────────────────────────
// 2026-05-26 — added in response to /bigsolvebug Quick run finding B9:
// upload routes trusted client-provided `file.type` and could accept
// `.exe` renamed to `.pdf`. Server now sniffs magic bytes + enforces
// a whitelist before writing to R2 or DB.
// ────────────────────────────────────────────────────────────────────

// Accepted document MIME whitelist. Keep aligned with the client
// `<input accept="...">` in components/docuflow/upload-form.tsx.
export const DOCUFLOW_MIME_WHITELIST = new Set<string>([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/msword", // .doc
  "application/zip",
  "application/x-zip-compressed",
  "application/octet-stream", // browsers sometimes report this for .docx/.heic
]);

// Returns true if the magic bytes match a known doc/image/zip format.
// We accept octet-stream as long as the extension is in the safe-ext list.
export function sniffMagicBytes(buf: Buffer | Uint8Array): string | null {
  const u = buf instanceof Buffer ? buf : Buffer.from(buf);
  if (u.length < 4) return null;
  const b0 = u[0],
    b1 = u[1],
    b2 = u[2],
    b3 = u[3];

  // PDF: %PDF
  if (b0 === 0x25 && b1 === 0x50 && b2 === 0x44 && b3 === 0x46)
    return "application/pdf";
  // PNG
  if (b0 === 0x89 && b1 === 0x50 && b2 === 0x4e && b3 === 0x47)
    return "image/png";
  // JPEG: FF D8 FF
  if (b0 === 0xff && b1 === 0xd8 && b2 === 0xff) return "image/jpeg";
  // GIF87a / GIF89a
  if (b0 === 0x47 && b1 === 0x49 && b2 === 0x46) return "image/gif";
  // WebP: RIFF....WEBP
  if (
    b0 === 0x52 &&
    b1 === 0x49 &&
    b2 === 0x46 &&
    b3 === 0x46 &&
    u.length >= 12 &&
    u[8] === 0x57 &&
    u[9] === 0x45 &&
    u[10] === 0x42 &&
    u[11] === 0x50
  )
    return "image/webp";
  // HEIC/HEIF: ftypheic / ftypheix / ftypmif1 (Apple iPhone photos)
  if (
    u.length >= 12 &&
    u[4] === 0x66 &&
    u[5] === 0x74 &&
    u[6] === 0x79 &&
    u[7] === 0x70
  ) {
    return "image/heic";
  }
  // ZIP / DOCX / XLSX (DOCX is zip)
  if (b0 === 0x50 && b1 === 0x4b && (b2 === 0x03 || b2 === 0x05 || b2 === 0x07))
    return "application/zip";
  // OLE compound (legacy .doc)
  if (b0 === 0xd0 && b1 === 0xcf && b2 === 0x11 && b3 === 0xe0)
    return "application/msword";

  return null;
}

const SAFE_EXTENSIONS = new Set([
  ".pdf",
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".heic",
  ".heif",
  ".doc",
  ".docx",
  ".zip",
]);

export function extensionOf(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx === -1 ? "" : filename.slice(idx).toLowerCase();
}

export interface MimeValidationInput {
  filename: string;
  mimeType: string;
  buffer?: Buffer | Uint8Array; // present in proxy upload, absent in presigned flow
}

export interface MimeValidationResult {
  ok: boolean;
  reason?: string;
  effectiveMime?: string;
}

// Server-side validation. Two modes:
//   (a) buffer present (proxy upload) → magic-byte sniff is authoritative
//   (b) buffer absent (presigned flow) → fall back to MIME whitelist + extension allow-list
//
// Defense in depth: extension MUST be in SAFE_EXTENSIONS regardless of MIME.
export function validateDocumentMime(
  input: MimeValidationInput,
): MimeValidationResult {
  const ext = extensionOf(input.filename);
  if (!SAFE_EXTENSIONS.has(ext)) {
    return {
      ok: false,
      reason: `นามสกุล "${ext || "(ไม่ระบุ)"}" ไม่อยู่ในรายการที่อนุญาต (.pdf, .jpg, .png, .docx, .zip ฯลฯ)`,
    };
  }

  if (input.buffer) {
    const sniffed = sniffMagicBytes(input.buffer);
    if (!sniffed) {
      return {
        ok: false,
        reason: "ไฟล์ไม่ใช่ PDF / รูป / DOCX / ZIP ที่ระบบรองรับ",
      };
    }
    return { ok: true, effectiveMime: sniffed };
  }

  if (!DOCUFLOW_MIME_WHITELIST.has(input.mimeType)) {
    return {
      ok: false,
      reason: `ประเภทไฟล์ "${input.mimeType}" ไม่อยู่ในรายการที่อนุญาต`,
    };
  }

  return { ok: true, effectiveMime: input.mimeType };
}
