// CashHub ⛽ ปั๊มน้ำมัน 62 — connection module.
//
// The source is a PUBLIC ("anyone with the link") .xlsx on Google Drive — verified to
// download zero-credential via the uc?export=download endpoint (HTTP 200, PK zip header,
// ~10.5MB). NO service account, NO Sheets API (the file is .xlsx, not a native Sheet).
//
// A revoked "anyone-with-link" file still returns HTTP 200 but with an HTML "request
// access" interstitial — so HTTP status is NOT enough. We assert the PK (zip) magic
// bytes before handing the buffer to the parser. The upload fallback must always work
// so a dead link never blocks the bookkeeper.

export const FUEL_SHEET_FILE_ID = "1PAkGVNDnGAnY9qSjCug5iXq0g_xEE1i9";
export const FUEL_SHEET_VIEW_URL = `https://drive.google.com/file/d/${FUEL_SHEET_FILE_ID}/view`;
const DOWNLOAD_URL = `https://drive.google.com/uc?export=download&id=${FUEL_SHEET_FILE_ID}`;
const FETCH_TIMEOUT_MS = 30_000;

export type FuelFetchResult =
  | { ok: true; buf: Buffer; fetchedAt: string; bytes: number }
  | { ok: false; reason: string };

function looksLikeXlsx(buf: Buffer): boolean {
  // .xlsx is a zip → first two bytes are "PK" (0x50 0x4B).
  return buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b;
}

/** Download the public gas-station workbook. Server-side only (CORS + keeps URL out of the bundle). */
export async function fetchFuelWorkbook(): Promise<FuelFetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(DOWNLOAD_URL, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "user-agent": "PoolERP-CashHub/1.0" },
      cache: "no-store",
    });
    if (!res.ok) {
      return { ok: false, reason: `ดึงไฟล์ไม่สำเร็จ (HTTP ${res.status})` };
    }
    const ab = await res.arrayBuffer();
    const buf = Buffer.from(ab);
    if (!looksLikeXlsx(buf)) {
      return {
        ok: false,
        reason:
          "ลิงก์ไม่คืนไฟล์ Excel (อาจถูกปิดการแชร์ หรือเจ้าของเปลี่ยนสิทธิ์) — ลองอัปไฟล์เองแทน",
      };
    }
    return {
      ok: true,
      buf,
      bytes: buf.length,
      fetchedAt: new Date().toISOString(),
    };
  } catch (e) {
    const msg =
      (e as Error).name === "AbortError"
        ? "ดึงไฟล์นานเกินไป (timeout) — ลองใหม่อีกครั้ง หรืออัปไฟล์เอง"
        : `ดึงไฟล์ผิดพลาด: ${(e as Error).message}`;
    return { ok: false, reason: msg };
  } finally {
    clearTimeout(timer);
  }
}

/** Validate an uploaded buffer (the fallback path) the same way. */
export function validateUploadedXlsx(buf: Buffer): { ok: boolean; reason?: string } {
  if (!looksLikeXlsx(buf)) {
    return { ok: false, reason: "ไฟล์ที่อัปไม่ใช่ Excel (.xlsx)" };
  }
  return { ok: true };
}
