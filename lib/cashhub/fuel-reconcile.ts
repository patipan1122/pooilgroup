// CashHub ⛽ ปั๊ม 62 — สะพานส่งยอด "เงินเข้าจริง" → ledger_revenue_entry (กระทบยอด)
// mirror lib/cashhub/hotel-settlement-data.ts (compute → send → read-back ขึ้นเขียว).
//
// ต่างจากโรงแรม: ปั๊ม "ยึดคอลัมน์ในชีต" ตามที่ CEO กำหนด (ดู fuel-channels.ts) — อ่านจาก
// ตารางเต็มที่เก็บไว้ (cashhub_fuel_sheet_month · header-driven · ถูกทุกผัง) จับคอลัมน์ด้วย
// ชื่อหัวตาราง แล้วรวมต่อวัน (เช้า+ค่ำ) เป็น 1 ยอด/ช่อง/วัน. ไม่ re-fetch · ไม่แตะ schema.
import type { adminClient } from "@/lib/db/server";
import { prisma } from "@/lib/prisma";
import { PUMP_KEY } from "./fuel-import-core";
import {
  FUEL_CHANNELS,
  FUEL_CHANNEL_CODE,
  type FuelChannelCode,
  type FuelChannelConfig,
  type FuelSourceCol,
} from "./fuel-channels";

type Admin = ReturnType<typeof adminClient>;

const strip = (s: string) => s.replace(/\s+/g, "");
function num(x: number | string | null | undefined): number | null {
  if (x === "" || x == null) return null;
  const n = typeof x === "number" ? x : parseFloat(String(x).replace(/,/g, ""));
  return Number.isNaN(n) ? null : n;
}

export interface StoredHeader {
  c: number;
  group: string;
  name: string;
}
export interface StoredRow {
  date: string;
  day: number;
  shift: string;
  cells: (number | string | null)[];
}

/** จับคอลัมน์เดียวจากชื่อหัวตาราง — คืน index ใน headers (อ่าน cells[index]) · -1 = ไม่เจอ */
function matchCol(headers: StoredHeader[], pred: FuelSourceCol): number {
  return headers.findIndex((h) => {
    if (pred.group !== undefined) {
      if (pred.group === "") {
        if (h.group !== "") return false;
      } else if (!strip(h.group).includes(strip(pred.group))) return false;
    }
    if (!strip(h.name).includes(strip(pred.nameIncludes))) return false;
    if (pred.nameExcludes?.some((ex) => strip(h.name).includes(strip(ex)))) return false;
    return true;
  });
}

export type ResolvedChannel = { indices: number[]; headerNames: string[] };
export type ResolvedMap = Record<FuelChannelCode, ResolvedChannel>;

/** หาว่าแต่ละช่อง (cash/qr_kplus/card/aem) ดึงจากคอลัมน์ไหนของเดือนนี้ (โชว์ในพรีวิว) */
export function resolveFuelSourceColumns(headers: StoredHeader[]): ResolvedMap {
  const out = {} as ResolvedMap;
  for (const def of FUEL_CHANNELS) {
    const indices: number[] = [];
    const headerNames: string[] = [];
    for (const pred of def.sourceCols) {
      const idx = matchCol(headers, pred);
      if (idx >= 0 && !indices.includes(idx)) {
        indices.push(idx);
        headerNames.push(headers[idx]!.name);
      }
    }
    out[def.code] = { indices, headerNames };
  }
  return out;
}

export type FuelDeposit = {
  date: string;
} & Record<FuelChannelCode, number>;

/** รวมยอดต่อวัน (เช้า+ค่ำ) ของ 1 เดือน ตามคอลัมน์ที่จับได้ */
export function aggregateFuelDeposits(
  headers: StoredHeader[],
  rows: StoredRow[],
): FuelDeposit[] {
  const resolved = resolveFuelSourceColumns(headers);
  const byDate = new Map<string, FuelDeposit>();
  for (const r of rows) {
    if (r.shift !== "เช้า" && r.shift !== "ค่ำ") continue; // กะปกติเท่านั้น (กันกะสิ้นเดือน/ดึกซ้ำ)
    const acc =
      byDate.get(r.date) ?? ({ date: r.date, cash: 0, qr_kplus: 0, card: 0, aem: 0 } as FuelDeposit);
    for (const def of FUEL_CHANNELS) {
      let sum = 0;
      let any = false;
      for (const idx of resolved[def.code].indices) {
        const v = num(r.cells[idx]);
        if (v != null) {
          sum += v; // "ถ้าไม่มีช่องใดช่อง 1 ก็เงินเข้าตามที่มี" — รวมเฉพาะคอลัมน์ที่มีค่า
          any = true;
        }
      }
      if (any) acc[def.code] += sum;
    }
    byDate.set(r.date, acc);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** โหลดยอดเข้าจริงของเดือนที่เลือก (จาก cashhub_fuel_sheet_month) → deposit รายวัน/ช่อง */
export async function computeFuelDeposits(
  admin: Admin,
  orgId: string,
  periodKeys: string[],
): Promise<FuelDeposit[]> {
  const keys = periodKeys.filter((k) => /^\d{4}-\d{2}$/.test(k));
  if (keys.length === 0) return [];
  const { data } = await admin
    .from("cashhub_fuel_sheet_month")
    .select("period_key, headers, rows")
    .eq("org_id", orgId)
    .eq("pump_key", PUMP_KEY)
    .in("period_key", keys);
  const all: FuelDeposit[] = [];
  for (const m of (data ?? []) as Record<string, unknown>[]) {
    const headers = (m.headers ?? []) as StoredHeader[];
    const rows = (m.rows ?? []) as StoredRow[];
    all.push(...aggregateFuelDeposits(headers, rows));
  }
  return all.sort((a, b) => a.date.localeCompare(b.date));
}

const amountByFuelChannel = (d: FuelDeposit, code: FuelChannelCode): number => d[code] ?? 0;

/** ส่งยอดเข้าจริงต่อวัน/ช่องทาง → ledger_revenue_entry (idempotent + race-safe + transaction) */
export async function sendFuelDaysToReconcile(
  orgId: string,
  deposits: FuelDeposit[],
  configs: FuelChannelConfig[],
): Promise<{ inserted: number; skippedNoConfig: number; error?: string }> {
  const settleConfigs = configs.filter((c) => c.isSettle);
  type Row = {
    companyId: string;
    entryDate: string;
    amountSatang: number;
    sourceRef: string;
    channelCode: string;
    bankAccountId: string;
    label: string;
  };
  const rows: Row[] = [];
  let skippedNoConfig = 0;
  for (const d of deposits) {
    for (const c of settleConfigs) {
      const amt = amountByFuelChannel(d, c.code);
      if (!(amt > 0)) continue; // ไม่มียอดเข้าช่องนี้วันนี้
      if (!c.companyId || !c.bankAccountId) {
        skippedNoConfig++; // ยังไม่ตั้งบริษัท/บัญชี → ข้าม
        continue;
      }
      rows.push({
        companyId: c.companyId,
        entryDate: d.date,
        amountSatang: Math.round(amt * 100),
        sourceRef: `fuel:${PUMP_KEY}:${d.date}:${c.code}`,
        channelCode: FUEL_CHANNEL_CODE[c.code] ?? "other",
        bankAccountId: c.bankAccountId,
        label: c.label,
      });
    }
  }
  if (rows.length === 0) return { inserted: 0, skippedNoConfig };

  let inserted = 0;
  try {
    await prisma.$transaction(async (tx) => {
      for (const r of rows) {
        const res = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO ledger_revenue_entry
          (org_id, company_id, entry_date, amount_satang, source_type, source_ref,
           description, customer_name, payment_channel, channel_code, match_state,
           expected_bank_account_id)
        VALUES (
          ${orgId}::uuid, ${r.companyId}::uuid, ${r.entryDate}::date, ${r.amountSatang},
          'CASHHUB_FUEL', ${r.sourceRef}, ${`ปั๊ม 62 หัวทะเล · ${r.label} · ${r.entryDate}`},
          ${"ปั๊ม 62 หัวทะเล"}, ${r.label}, ${r.channelCode}, 'unmatched',
          ${r.bankAccountId}::uuid
        )
        ON CONFLICT (org_id, company_id, source_type, source_ref)
          WHERE source_ref IS NOT NULL
        -- ส่งซ้ำ = อัปเดตยอด + บัญชีปลายทาง · แตะเฉพาะรายการที่ยัง "ไม่กระทบ" (ปลอดภัยกับที่ปิดงวดแล้ว)
        DO UPDATE SET amount_satang = EXCLUDED.amount_satang,
                      expected_bank_account_id = EXCLUDED.expected_bank_account_id,
                      payment_channel = EXCLUDED.payment_channel,
                      channel_code = EXCLUDED.channel_code,
                      updated_at = now()
          WHERE ledger_revenue_entry.match_state = 'unmatched'
            AND (ledger_revenue_entry.amount_satang IS DISTINCT FROM EXCLUDED.amount_satang
                 OR ledger_revenue_entry.expected_bank_account_id IS DISTINCT FROM EXCLUDED.expected_bank_account_id)
        RETURNING id`;
        if (res.length) inserted++;
      }
    });
  } catch (e) {
    return {
      inserted: 0,
      skippedNoConfig,
      error: e instanceof Error ? e.message : "insert error",
    };
  }
  return { inserted, skippedNoConfig };
}

export type FuelReconcileCell = { sent: boolean; reconciled: boolean; amount: number };

/** อ่านสถานะกลับ (วัน×ช่อง) — key = `${date}:${code}` · reconciled=true เมื่อกระทบ statement ยืนยันแล้ว */
export async function readFuelReconcileStatus(
  orgId: string,
  from: string,
  to: string,
): Promise<Map<string, FuelReconcileCell>> {
  const prefix = `fuel:${PUMP_KEY}:`;
  const rows = await prisma.$queryRaw<
    { source_ref: string; amount_satang: bigint; reconciled: boolean }[]
  >`
    SELECT r.source_ref, r.amount_satang,
      (r.match_state='matched' OR EXISTS(
        SELECT 1 FROM ledger_bank_match_item mi
        JOIN ledger_bank_match_group g ON g.id=mi.group_id
        WHERE mi.book_type='revenue' AND mi.book_id=r.id
          AND g.status='confirmed')) as reconciled
    FROM ledger_revenue_entry r
    WHERE r.org_id=${orgId}::uuid
      AND r.source_type='CASHHUB_FUEL'
      AND r.source_ref LIKE ${prefix + "%"}
      AND r.entry_date BETWEEN ${from}::date AND ${to}::date`;
  const out = new Map<string, FuelReconcileCell>();
  for (const r of rows) {
    const parts = r.source_ref.split(":");
    const code = parts[parts.length - 1]!;
    const date = parts[parts.length - 2]!;
    out.set(`${date}:${code}`, {
      sent: true,
      reconciled: Boolean(r.reconciled),
      amount: Number(r.amount_satang) / 100,
    });
  }
  return out;
}
