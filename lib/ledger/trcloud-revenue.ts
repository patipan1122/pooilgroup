import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";

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

export async function syncTrcloudRevenue(params: {
  orgId: string;
  companyId: string;
  periodStart: string; // YYYY-MM-DD
  periodEnd: string;   // YYYY-MM-DD
}): Promise<{ inserted: number; skipped: number; error?: string }> {
  if (!trcloudRevenueSyncConfigured()) {
    return { inserted: 0, skipped: 0, error: "TRCloud ยังไม่ได้ตั้งค่า (TRCLOUD_JPS_* env)" };
  }

  let rows: TrcloudIvRow[] = [];
  try {
    const data = await trcloudPost("iv/search.php", {
      date_from: params.periodStart,
      date_to: params.periodEnd,
      limit: 500,
      page: 1,
    });
    // TRCloud returns data in data.data[], data.list[], or the root array — handle all shapes
    const list =
      Array.isArray(data.data)   ? data.data :
      Array.isArray(data.list)   ? data.list :
      Array.isArray(data.result) ? data.result :
      [];
    rows = list as TrcloudIvRow[];
  } catch (err) {
    const msg = err instanceof Error ? err.message : "TRCloud fetch error";
    return { inserted: 0, skipped: 0, error: msg };
  }

  let inserted = 0, skipped = 0;

  for (const row of rows) {
    const entryDate = parseIsoDate(row.doc_date);
    const amountSatang = parseAmount(row.total);
    if (!entryDate || amountSatang <= 0 || !row.doc_no) {
      skipped++;
      continue;
    }

    const existing = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM ledger_revenue_entry
      WHERE org_id = ${params.orgId}::uuid
        AND company_id = ${params.companyId}::uuid
        AND source_type = 'TRCLOUD_IV'
        AND source_ref = ${row.doc_no}
      LIMIT 1
    `;
    if (existing.length) { skipped++; continue; }

    await prisma.$executeRaw`
      INSERT INTO ledger_revenue_entry
        (org_id, company_id, entry_date, amount_satang, source_type, source_ref,
         description, customer_name, payment_channel, raw_json)
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
        ${JSON.stringify({ doc_id: row.doc_id, doc_no: row.doc_no, total: row.total })}::jsonb
      )
    `;
    inserted++;
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

  const result = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO ledger_revenue_entry
      (org_id, company_id, entry_date, amount_satang, source_type, source_ref,
       description, customer_name, payment_channel, raw_json)
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
