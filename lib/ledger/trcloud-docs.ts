import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";

// LedgerLine · ดึง PO/AP จาก TRCloud มาเก็บ snapshot (อ่านอย่างเดียว · company 45 JPS GROUP).
//
// TRCloud gotchas (ยืนยันด้วย live probe 2026-07-25):
//  - ap/search.php & po/search.php: envelope = { result:[...], HTTP, message, success }
//  - cap ~100 แถว/เรียกเสมอ (ขอ limit=200 ก็ได้ 100) เรียง create_dt ใหม่→เก่า
//  - date_from/date_to/issue_date_* + page= ถูก "เมิน" ทั้งหมด → เลื่อนหน้าได้เฉพาะ start= (offset)
//  - rate-limit ~8-10 call/burst → 429 → หน่วงเวลา + จำกัดจำนวนหน้า/รอบ
// จึง: เลื่อน start=0,100,200... จนเจอหน้าที่รู้จักหมด (incremental) หรือชนเพดานหน้า, upsert ลง DB.

const BASE         = process.env.TRCLOUD_BASE         ?? "https://pooil.trcloud.co/application/api-connector2/end-point";
const ORIGIN       = process.env.TRCLOUD_JPS_ORIGIN   ?? "https://pooil.trcloud.co";
const COMPANY_ID   = process.env.TRCLOUD_JPS_COMPANY_ID  ?? "";
const PASSKEY      = process.env.TRCLOUD_JPS_PASSKEY      ?? "";
const ENCRYPT_HEAD = process.env.TRCLOUD_JPS_ENCRYPT_HEAD ?? "";

const PAGE_SIZE = 100;          // เพดานแข็งของ TRCloud
const THROTTLE_MS = 1800;       // หน่วงระหว่างหน้า กัน 429
const DEFAULT_MAX_PAGES = 5;    // ต่อชนิด (PO/AP) ต่อรอบ refresh — ~10 call ทั้งคู่, ปลอดภัยใต้ burst limit

export function trcloudDocsConfigured(): boolean {
  return !!(COMPANY_ID && PASSKEY && ENCRYPT_HEAD);
}

// ── low-level signed POST (read-only endpoints เท่านั้น) ─────────────────────
type Json = Record<string, unknown>;

function authFields(): Json {
  const timestamp = Math.floor(Date.now() / 1000);
  const securekey = createHash("md5").update(`${ENCRYPT_HEAD}t${timestamp}`).digest("hex");
  return { company_id: COMPANY_ID, passkey: PASSKEY, timestamp, securekey };
}

async function post(path: string, payload: Json): Promise<{ status: number; data: Json | null; raw: string }> {
  const body = new URLSearchParams({ json: JSON.stringify({ ...authFields(), ...payload }) });
  let res: Response;
  try {
    res = await fetch(`${BASE}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: ORIGIN },
      body: body.toString(),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    const msg =
      e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")
        ? "TRCloud ไม่ตอบสนองภายใน 20 วินาที"
        : `TRCloud network error: ${e instanceof Error ? e.message : String(e)}`;
    return { status: 0, data: null, raw: msg };
  }
  const raw = await res.text();
  let data: Json | null = null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) data = parsed as Json;
  } catch { /* html/404 */ }
  return { status: res.status, data, raw };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isRateLimited(r: { status: number; raw: string }): boolean {
  return r.status === 429 || /\b429\b|too many|rate limit/i.test(r.raw);
}

function rowsOf(d: Json | null): Json[] {
  if (!d) return [];
  const v = d.result ?? d.data ?? d.body ?? d.list;
  return Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Json[]) : [];
}

// ── field helpers ────────────────────────────────────────────────────────────
function str(o: Json, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (v != null && (typeof v === "string" || typeof v === "number")) {
      const s = String(v).trim();
      if (s) return s;
    }
  }
  return null;
}
// numeric → string ให้ Prisma Decimal (คงความแม่น ไม่ผ่าน float), "" → null
function dec(o: Json, ...keys: string[]): string | null {
  const s = str(o, ...keys);
  if (s == null) return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? s.replace(/,/g, "") : null;
}
// "2026-07-25" หรือ "2026-07-25 11:44:15" → Date, ค่าว่าง/0000-00-00 → null
function dt(o: Json, ...keys: string[]): Date | null {
  const s = str(o, ...keys);
  if (!s || s.startsWith("0000")) return null;
  const iso = s.includes(" ") ? s.replace(" ", "T") : s;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

type DocKind = "PO" | "AP";

function mapRow(kind: DocKind, o: Json) {
  const trcloudId =
    kind === "PO"
      ? str(o, "po_id", "id", "document_id")
      : str(o, "expense_id", "id", "document_id");
  if (!trcloudId) return null;
  return {
    kind,
    trcloudId,
    trcloudCompanyId: str(o, "company_id"),
    companyFormat: str(o, "company_format"),
    docNumber: kind === "PO" ? str(o, "document_number", "no") : str(o, "invoice_number", "document_number", "no"),
    refNo: str(o, "ref_no", "reference_doc"),
    issueDate: dt(o, "issue_date", "doc_date", "date"),
    vendorName: str(o, "name", "organization"),
    organization: str(o, "organization"),
    taxId: str(o, "tax_id"),
    department: str(o, "department"),
    project: str(o, "project"),
    status: str(o, "status"),
    statusAp: kind === "PO" ? str(o, "status_ap") : null,
    total: dec(o, "total"),
    grandTotal: dec(o, "grand_total", "grandtotal"),
    tax: dec(o, "tax"),
    wht: dec(o, "wht", "wht_amount"),
    discount: dec(o, "discount"),
    payment: dec(o, "payment"),
    staff: str(o, "staff"),
    invoiceNote: str(o, "invoice_note"),
    taxOption: str(o, "tax_option"),
    pdfUrl: str(o, "url"),
    prNo: kind === "PO" ? str(o, "pr") : null,
    trcloudCreatedAt: dt(o, "create_dt"),
    trcloudUpdatedAt: dt(o, "update_dt"),
    raw: o as unknown as Prisma.InputJsonValue,
  };
}

export type TrcloudDocSyncResult = {
  ok: boolean;
  po: number;
  ap: number;
  pagesPo: number;
  pagesAp: number;
  cappedPo: boolean;   // ยังมีของเก่ากว่านี้ที่ยังไม่ดึง (ชนเพดานหน้า)
  cappedAp: boolean;
  rateLimited: boolean;
  error?: string;
};

// sync ชนิดเดียว: เลื่อน start= จากใหม่→เก่า, upsert, หยุดเมื่อเจอหน้าที่รู้จักครบ (incremental)
// หรือชนเพดานหน้า/ได้ <100 แถว/โดน 429.
async function syncKind(
  orgId: string,
  kind: DocKind,
  path: string,
  maxPages: number,
): Promise<{ count: number; pages: number; capped: boolean; rateLimited: boolean; error?: string }> {
  let count = 0;
  let pages = 0;
  for (let start = 0; pages < maxPages; start += PAGE_SIZE) {
    if (pages > 0) await sleep(THROTTLE_MS);
    const r = await post(path, { keyword: "", limit: String(PAGE_SIZE), start: String(start) });
    if (isRateLimited(r)) return { count, pages, capped: true, rateLimited: true };
    const rows = rowsOf(r.data);
    pages += 1;
    if (rows.length === 0) return { count, pages, capped: false, rateLimited: false };

    // มีของในหน้านี้ใหม่/ต้องอัปเดตไหม → นับ known เพื่อตัดจบเมื่อหน้าเต็มไปด้วยของเดิม
    const mapped = rows.map((o) => mapRow(kind, o)).filter((m): m is NonNullable<typeof m> => m != null);
    const ids = mapped.map((m) => m.trcloudId);
    const existing = await prisma.ledgerTrcloudDoc.findMany({
      where: { orgId, kind, trcloudId: { in: ids } },
      select: { trcloudId: true },
    });
    const known = new Set(existing.map((e) => e.trcloudId));

    const now = new Date();
    for (const m of mapped) {
      await prisma.ledgerTrcloudDoc.upsert({
        where: { orgId_kind_trcloudId: { orgId, kind, trcloudId: m.trcloudId } },
        create: { orgId, ...m, syncedAt: now },
        update: { ...m, syncedAt: now },
      });
      count += 1;
    }

    // หน้านี้รู้จักครบ + เป็นหน้าเต็ม (100) → ของเก่ากว่านี้เคย sync แล้ว, จบแบบ incremental
    if (known.size === mapped.length && rows.length === PAGE_SIZE) {
      return { count, pages, capped: false, rateLimited: false };
    }
    // หน้าไม่เต็ม = ถึงท้ายประวัติแล้ว
    if (rows.length < PAGE_SIZE) return { count, pages, capped: false, rateLimited: false };
  }
  // ออกจาก loop เพราะชนเพดานหน้า → ยังมีของเก่ากว่านี้
  return { count, pages, capped: true, rateLimited: false };
}

export async function syncTrcloudDocs(
  orgId: string,
  opts?: { maxPages?: number },
): Promise<TrcloudDocSyncResult> {
  if (!trcloudDocsConfigured()) {
    return { ok: false, po: 0, ap: 0, pagesPo: 0, pagesAp: 0, cappedPo: false, cappedAp: false, rateLimited: false, error: "ยังไม่ได้ตั้งค่ากุญแจ TRCloud (TRCLOUD_JPS_*)" };
  }
  const maxPages = opts?.maxPages ?? DEFAULT_MAX_PAGES;
  try {
    const ap = await syncKind(orgId, "AP", "ap/search.php", maxPages);
    await sleep(THROTTLE_MS);
    const po = ap.rateLimited
      ? { count: 0, pages: 0, capped: false, rateLimited: true }
      : await syncKind(orgId, "PO", "po/search.php", maxPages);
    return {
      ok: true,
      ap: ap.count,
      po: po.count,
      pagesAp: ap.pages,
      pagesPo: po.pages,
      cappedAp: ap.capped,
      cappedPo: po.capped,
      rateLimited: ap.rateLimited || po.rateLimited,
    };
  } catch (e) {
    return {
      ok: false, po: 0, ap: 0, pagesPo: 0, pagesAp: 0, cappedPo: false, cappedAp: false, rateLimited: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
