import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { ledgerRevenueGlV1 } from "./flags";
import {
  normalizeChannel,
  loadRevenueChannelGl,
  resolveRevenueGlFromConfig,
  resolveRevenueGl,
  type RevenueGlConfig,
  type RevenueChannelCode,
} from "./revenue-channel";

// LedgerLine — TRCloud IV (Invoice) sync for revenue reconciliation.
// Pulls IV documents from TRCloud API by date range and upserts them as
// ledger_revenue_entry rows so the auto-match engine can join against them.
//
// TRCloud direction: PULL (we query TRCloud) not PUSH (TRCloud doesn't webhook natively).
// The generic inbound webhook in app/api/ledger/webhooks/revenue/ handles the push path
// for any system that CAN webhook to us (custom TRCloud config, POS systems, etc).

const BASE       = process.env.TRCLOUD_BASE          ?? "https://pooil.trcloud.co/application/api-connector2/end-point";
const COMPANY_ID = process.env.TRCLOUD_JPS_COMPANY_ID ?? "";
const PASSKEY    = process.env.TRCLOUD_JPS_PASSKEY    ?? "";
const ENCRYPT_HEAD = process.env.TRCLOUD_JPS_ENCRYPT_HEAD ?? "";

export function trcloudRevenueSyncConfigured(): boolean {
  return !!(COMPANY_ID && PASSKEY && ENCRYPT_HEAD);
}

function authFields() {
  const timestamp = Math.floor(Date.now() / 1000);
  const securekey = createHash("md5").update(`${ENCRYPT_HEAD}t${timestamp}`).digest("hex");
  return { company_id: COMPANY_ID, passkey: PASSKEY, timestamp, securekey };
}

async function trcloudPost(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  // TRCloud API-Connector2 format: x-www-form-urlencoded with json= parameter (same as ap/create.php)
  const payload = new URLSearchParams({ json: JSON.stringify({ ...authFields(), ...body }) });
  const res = await fetch(`${BASE}/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: process.env.TRCLOUD_JPS_ORIGIN ?? "https://pooil.trcloud.co",
    },
    body: payload.toString(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`TRCloud ${path} HTTP ${res.status}`);
  const text = await res.text();
  try { return JSON.parse(text) as Record<string, unknown>; }
  catch { throw new Error(`TRCloud ${path} non-JSON: ${text.slice(0, 200)}`); }
}

interface TrcloudIvRow {
  doc_id: string;
  doc_no: string;
  doc_date: string; // YYYY-MM-DD or DD/MM/YYYY depending on TRCloud config
  total: string | number;
  customer_name?: string;
  payment_method?: string;
  status?: string;
}

function parseAmount(v: string | number): number {
  if (typeof v === "number") return Math.round(v * 100);
  const n = parseFloat(v.replace(/[^0-9.-]/g, ""));
  return isNaN(n) ? 0 : Math.round(n * 100);
}

function parseIsoDate(raw: string): string | null {
  if (!raw) return null;
  // Handle YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  // Handle DD/MM/YYYY or D/M/YYYY
  const parts = raw.split("/");
  if (parts.length === 3) {
    const [d, m, y] = parts.map(Number);
    if (y > 2000 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }
  return null;
}

// Fetch IV rows from TRCloud for a date range (no DB write). Shared by preview + sync.
async function fetchTrcloudIvRows(
  periodStart: string,
  periodEnd: string,
): Promise<{ rows: TrcloudIvRow[]; error?: string }> {
  try {
    const data = await trcloudPost("iv/search.php", {
      date_from: periodStart,
      date_to: periodEnd,
      limit: 500,
      page: 1,
    });
    // TRCloud returns data in data.data[], data.list[], or the root array — handle all shapes
    const list =
      Array.isArray(data.data)   ? data.data :
      Array.isArray(data.list)   ? data.list :
      Array.isArray(data.result) ? data.result :
      [];
    return { rows: list as TrcloudIvRow[] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "TRCloud fetch error";
    return { rows: [], error: msg };
  }
}

export interface TrcloudRevenuePreviewRow {
  docNo: string;
  docDate: string | null;     // normalized YYYY-MM-DD (null = unparseable → invalid)
  amountSatang: number;
  customerName: string | null;
  paymentMethod: string | null;
  channelCode: RevenueChannelCode | null; // normalized channel (preview the tag)
  isNew: boolean;   // false = already imported (will be skipped on sync)
  valid: boolean;   // false = bad date/amount/doc_no (will be skipped on sync)
}

// PREVIEW: fetch what TRCloud would pull for the range and mark new-vs-existing,
// WITHOUT writing anything. Lets the accountant "เลือกดึงให้ถูก" before committing
// (diff-before-write, per the CSV-import rule). The sync then takes selectedDocNos.
export async function previewTrcloudRevenue(params: {
  orgId: string;
  companyId: string;
  periodStart: string;
  periodEnd: string;
}): Promise<{ rows?: TrcloudRevenuePreviewRow[]; error?: string }> {
  if (!trcloudRevenueSyncConfigured()) {
    return { error: "TRCloud ยังไม่ได้ตั้งค่า (TRCLOUD_JPS_* env)" };
  }
  const fetched = await fetchTrcloudIvRows(params.periodStart, params.periodEnd);
  if (fetched.error) return { error: fetched.error };

  const docNos = fetched.rows.map((r) => r.doc_no).filter(Boolean);
  // Which doc_nos already exist? (company-scoped — AG-6)
  const existing = docNos.length
    ? await prisma.$queryRaw<{ sourceRef: string }[]>`
        SELECT source_ref as "sourceRef" FROM ledger_revenue_entry
        WHERE org_id = ${params.orgId}::uuid
          AND company_id = ${params.companyId}::uuid
          AND source_type = 'TRCLOUD_IV'
          AND source_ref = ANY(${docNos})
      `
    : [];
  const existingSet = new Set(existing.map((e) => e.sourceRef));

  const rows: TrcloudRevenuePreviewRow[] = fetched.rows.map((r) => {
    const docDate = parseIsoDate(r.doc_date);
    const amountSatang = parseAmount(r.total);
    const valid = !!(docDate && amountSatang > 0 && r.doc_no);
    return {
      docNo: r.doc_no,
      docDate,
      amountSatang,
      customerName: r.customer_name ?? null,
      paymentMethod: r.payment_method ?? null,
      channelCode: normalizeChannel(r.payment_method),
      isNew: !!r.doc_no && !existingSet.has(r.doc_no),
      valid,
    };
  });
  return { rows };
}

export async function syncTrcloudRevenue(params: {
  orgId: string;
  companyId: string;
  periodStart: string; // YYYY-MM-DD
  periodEnd: string;   // YYYY-MM-DD
  selectedDocNos?: string[]; // if provided, only import these doc_nos (เลือกดึงให้ถูก)
}): Promise<{ inserted: number; skipped: number; error?: string }> {
  if (!trcloudRevenueSyncConfigured()) {
    return { inserted: 0, skipped: 0, error: "TRCloud ยังไม่ได้ตั้งค่า (TRCLOUD_JPS_* env)" };
  }

  const fetched = await fetchTrcloudIvRows(params.periodStart, params.periodEnd);
  if (fetched.error) return { inserted: 0, skipped: 0, error: fetched.error };

  // Honor the accountant's selection — only import the chosen docs.
  const selected = params.selectedDocNos ? new Set(params.selectedDocNos) : null;
  const rows: TrcloudIvRow[] = selected
    ? fetched.rows.filter((r) => r.doc_no && selected.has(r.doc_no))
    : fetched.rows;

  // Channel→GL stamping is gated on LEDGER_REVENUE_GL_V1 (OFF = byte-equivalent,
  // new columns stay NULL). Load the ≤7-row config ONCE before the loop (AG-6:
  // company-scoped — Prisma bypasses RLS).
  const glOn = ledgerRevenueGlV1();
  const channelConfig: Map<RevenueChannelCode, RevenueGlConfig> | null = glOn
    ? await loadRevenueChannelGl({ orgId: params.orgId, companyId: params.companyId })
    : null;

  let inserted = 0, skipped = 0;

  for (const row of rows) {
    const entryDate = parseIsoDate(row.doc_date);
    const amountSatang = parseAmount(row.total);
    if (!entryDate || amountSatang <= 0 || !row.doc_no) {
      skipped++;
      continue;
    }

    // Normalize the raw TRCloud payment_method into the canonical channel + resolve
    // the GL snapshot (flag-gated; NULL when OFF).
    const channelCode = glOn ? normalizeChannel(row.payment_method) : null;
    let glAccount: string | null = null;
    let glState: string | null = null;
    let categoryId: string | null = null;
    if (glOn && channelConfig) {
      const r = resolveRevenueGlFromConfig(channelCode, channelConfig);
      glAccount = r.glAccount;
      glState = r.glState;
      categoryId = r.categoryId;
    }

    // AG-2: ON CONFLICT DO NOTHING instead of SELECT-then-INSERT — idempotent +
    // race-safe (two concurrent syncs no longer throw an uncaught dup-key 500).
    const result = await prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO ledger_revenue_entry
        (org_id, company_id, entry_date, amount_satang, source_type, source_ref,
         description, customer_name, payment_channel,
         channel_code, gl_account, gl_state, category_id, raw_json)
      VALUES (
        ${params.orgId}::uuid,
        ${params.companyId}::uuid,
        ${entryDate}::date,
        ${amountSatang},
        'TRCLOUD_IV',
        ${row.doc_no},
        ${"IV " + row.doc_no},
        ${row.customer_name ?? null},
        ${row.payment_method ?? null},
        ${channelCode},
        ${glAccount},
        ${glState},
        ${categoryId}::uuid,
        ${JSON.stringify({ doc_id: row.doc_id, doc_no: row.doc_no, total: row.total })}::jsonb
      )
      ON CONFLICT (org_id, company_id, source_type, source_ref)
        WHERE source_ref IS NOT NULL
      DO NOTHING
      RETURNING id
    `;
    if (result.length) inserted++; else skipped++;
  }

  return { inserted, skipped };
}

// Ingest a single revenue entry from webhook payload (generic source).
// Called by app/api/ledger/webhooks/revenue/route.ts.
export async function ingestWebhookRevenue(params: {
  orgId: string;
  companyId: string;
  sourceType: "TRCLOUD_IV" | "CHAIROPS" | "CLAWFLEET" | "FUELOS" | "WEBHOOK" | "MANUAL";
  sourceRef: string | null;
  entryDate: string;    // YYYY-MM-DD
  amountSatang: number; // positive satang
  description?: string;
  customerName?: string;
  paymentChannel?: string;
  rawJson?: Record<string, unknown>;
}): Promise<{ id: string } | { error: string }> {
  if (params.amountSatang <= 0) return { error: "amount must be > 0" };

  // Dedup by source_ref (if provided)
  if (params.sourceRef) {
    const existing = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM ledger_revenue_entry
      WHERE org_id = ${params.orgId}::uuid
        AND company_id = ${params.companyId}::uuid
        AND source_type = ${params.sourceType}
        AND source_ref = ${params.sourceRef}
      LIMIT 1
    `;
    if (existing.length) return { id: existing[0].id };
  }

  // Normalize channel + resolve GL snapshot (flag-gated; NULL when OFF).
  const glOn = ledgerRevenueGlV1();
  const channelCode = glOn ? normalizeChannel(params.paymentChannel) : null;
  let glAccount: string | null = null;
  let glState: string | null = null;
  let categoryId: string | null = null;
  if (glOn) {
    const r = await resolveRevenueGl({
      orgId: params.orgId,
      companyId: params.companyId,
      channel: channelCode,
    });
    glAccount = r.glAccount;
    glState = r.glState;
    categoryId = r.categoryId;
  }

  const result = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO ledger_revenue_entry
      (org_id, company_id, entry_date, amount_satang, source_type, source_ref,
       description, customer_name, payment_channel,
       channel_code, gl_account, gl_state, category_id, raw_json)
    VALUES (
      ${params.orgId}::uuid,
      ${params.companyId}::uuid,
      ${params.entryDate}::date,
      ${params.amountSatang},
      ${params.sourceType},
      ${params.sourceRef ?? null},
      ${params.description ?? null},
      ${params.customerName ?? null},
      ${params.paymentChannel ?? null},
      ${channelCode},
      ${glAccount},
      ${glState},
      ${categoryId}::uuid,
      ${params.rawJson ? JSON.stringify(params.rawJson) : null}::jsonb
    )
    RETURNING id
  `;
  return { id: result[0].id };
}

// Load revenue entries for display in the match panel (right side)
export async function listRevenueEntriesForPeriod(params: {
  orgId: string;
  companyId: string;
  periodStart: string; // YYYY-MM-DD
  periodEnd: string;
}): Promise<{
  id: string;
  entryDate: string;
  amountSatang: number;
  sourceType: string;
  sourceRef: string | null;
  description: string | null;
  customerName: string | null;
  paymentChannel: string | null;
  matchState: string;
  bankTxnId: string | null;
}[]> {
  return prisma.$queryRaw`
    SELECT
      id,
      entry_date::text as "entryDate",
      amount_satang as "amountSatang",
      source_type as "sourceType",
      source_ref as "sourceRef",
      description,
      customer_name as "customerName",
      payment_channel as "paymentChannel",
      match_state as "matchState",
      bank_txn_id as "bankTxnId"
    FROM ledger_revenue_entry
    WHERE org_id = ${params.orgId}::uuid
      AND company_id = ${params.companyId}::uuid
      AND entry_date BETWEEN ${params.periodStart}::date AND ${params.periodEnd}::date
    ORDER BY entry_date, amount_satang DESC
    LIMIT 500
  `;
}
