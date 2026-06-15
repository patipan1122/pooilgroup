// lib/ledger/scb-zip.ts
// Decrypt a password-protected ZIP. SCB Business Anywhere emails the "Historical
// Statement" (รายการเดินบัญชีย้อนหลัง) as a ZIP locked with the company's
// tax-registration number (เลขทะเบียนนิติบุคคล). Inside are one or more CSV files.
//
// Pure JS via @zip.js/zip.js — covers both legacy ZipCrypto and AES, runs on the
// Vercel Node runtime (no native 7z binary). Each inner file is returned as UTF-8 text.

import { ZipReader, Uint8ArrayReader, TextWriter, configure } from "@zip.js/zip.js";

// Node has no Web Workers by default — run inline so it works in serverless/cron.
configure({ useWebWorkers: false });

export type ZipTextEntry = { filename: string; content: string };

/** Thrown when an entry cannot be decrypted (wrong password) or is corrupt. */
export class ZipDecryptError extends Error {}

/**
 * Decrypt every (non-directory) entry of a password-protected ZIP into UTF-8 text.
 * @param zipBytes raw ZIP bytes
 * @param password ZIP password (SCB = company tax-registration number)
 * @param opts.filter keep only filenames the predicate accepts (e.g. /\.csv$/i)
 */
export async function decryptZipToTextFiles(
  zipBytes: Uint8Array,
  password: string,
  opts?: { filter?: (filename: string) => boolean },
): Promise<ZipTextEntry[]> {
  if (!password) throw new ZipDecryptError("ไม่มีรหัสผ่านสำหรับถอด ZIP");

  const reader = new ZipReader(new Uint8ArrayReader(zipBytes), { password });
  try {
    const entries = await reader.getEntries();
    const files: ZipTextEntry[] = [];

    for (const entry of entries) {
      if (entry.directory || typeof entry.getData !== "function") continue;
      if (opts?.filter && !opts.filter(entry.filename)) continue;

      let content: string;
      try {
        content = await entry.getData(new TextWriter("utf-8"), { password });
      } catch {
        // Wrong password / corrupt entry surfaces here as a thrown error.
        throw new ZipDecryptError(
          `ถอดรหัสไฟล์ "${entry.filename}" ไม่สำเร็จ — รหัสผ่านผิดหรือไฟล์เสีย`,
        );
      }
      files.push({ filename: entry.filename, content });
    }

    return files;
  } finally {
    await reader.close();
  }
}
