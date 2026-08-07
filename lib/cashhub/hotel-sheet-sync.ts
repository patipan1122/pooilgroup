// CashHub Hotel — ซิงค์ยอดขายจาก "ชีต Google สาธารณะ" อัตโนมัติ (แทนการอัปโหลด xlsx มือ)
//
// CEO 2026-08-06: อยากให้หน้าโรงแรมดึงชีตสด ๆ เอง ไม่ต้องกด "นำเข้าจากชีต".
//
// วิธี (ใช้ของเดิมทั้งหมด · Ladder):
//   ดึงชีตทั้งเล่มเป็น xlsx (endpoint export ของ Google · ชีตเปิด public → ไม่ต้อง credential)
//   → เลือกแท็บของเดือน (ชื่อมีตัวย่อเดือนไทย เช่น "เม.ย.69") → parseHotelSheet เดิม
//   → upsert ลง cashhub_hotel_daily ด้วย source='sheet_import' + onConflict 4 ช่อง
//     (branch,date,shift,source) = unique key จริงบน prod → อัปเดตทับแถวชีตเดิม ไม่สร้างซ้ำ
//     และไม่แตะแถว IV (source='trcloud_iv' คนละ key).
//
// เงินไม่เกี่ยว: แค่สะท้อน ชีต → DB → หน้าจอ. reconcile/บัญชี ยังทำมือแยกเหมือนเดิม.
// ฟังก์ชันนี้ "ไม่ throw" — คืน status เสมอ เพื่อให้หน้าเว็บไม่พังถ้าชีตล่ม/คอลัมน์เพี้ยน.

import * as XLSX from "xlsx";
import type { adminClient } from "@/lib/db/server";
import { parseHotelSheet, type HotelParsedRow } from "@/lib/cashhub/hotel-parse";
import {
  TH_MONTHS,
  groupByDay,
  summarize,
  type HotelShiftRow,
} from "@/lib/cashhub/hotel";

/** กันดึงชีตถี่เกิน — อย่างน้อย 90 วินาที/รอบ (throttle ทำที่หน้า page ด้วย last_synced_at) */
export const HOTEL_SYNC_TTL_MS = 90_000;

/** timeout การดึงชีต — กันหน้าเว็บค้างถ้า Google ช้า/ไม่ตอบ */
const FETCH_TIMEOUT_MS = 8_000;

type AdminDb = ReturnType<typeof adminClient>;

export type HotelSyncStatus = "ok" | "warn" | "error";

export type HotelSyncResult = {
  ok: boolean;
  status: HotelSyncStatus;
  message: string;
  rows: number;
  warnings: string[];
  sheetName?: string;
};

function sheetExportUrl(sheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(
    sheetId,
  )}/export?format=xlsx`;
}

/** เลือกแท็บของเดือนจากชื่อ (เช่น "เม.ย.69") — ไม่เจอ → ใช้แผ่นแรก + ธง matched=false */
function pickSheetName(
  names: string[],
  month: number,
): { name: string; matched: boolean } {
  const abbr = TH_MONTHS[month - 1];
  const found = names.find((n) => n.includes(abbr));
  return found ? { name: found, matched: true } : { name: names[0]!, matched: false };
}

/**
 * ดึงชีต → parse เดือนที่ระบุ → upsert ลง cashhub_hotel_daily.
 * ปลอดภัย: mirror การนำเข้ามือ (source='xlsx_import', onConflict branch/date/shift).
 */
export async function syncHotelSheet(opts: {
  admin: AdminDb;
  orgId: string;
  companyId: string;
  branchId: string;
  sheetId: string;
  year: number;
  month: number;
  userId?: string | null;
}): Promise<HotelSyncResult> {
  const { admin, orgId, companyId, branchId, sheetId, year, month, userId } = opts;
  const fail = (message: string): HotelSyncResult => ({
    ok: false,
    status: "error",
    message,
    rows: 0,
    warnings: [],
  });

  // 1) ดึงไฟล์ xlsx จากชีตสาธารณะ (มี timeout กันค้าง)
  let buf: Buffer;
  try {
    const res = await fetch(sheetExportUrl(sheetId), {
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        Accept:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/octet-stream",
      },
    });
    if (!res.ok)
      return fail(`ดึงชีตไม่ได้ (HTTP ${res.status}) — ชีตอาจไม่เปิดสาธารณะแล้ว`);
    // ถ้าได้ HTML (หน้า login) แทน xlsx = ชีตไม่เปิดสาธารณะ
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("text/html"))
      return fail("ชีตไม่เปิดสาธารณะ (ได้หน้า login แทนไฟล์) — เปิดแชร์ 'ผู้ที่มีลิงก์' ก่อน");
    buf = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return fail(`ดึงชีตล้มเหลว: ${msg}`);
  }

  // 2) อ่าน workbook → เลือกแท็บเดือน → matrix (เหมือน hotel-import route)
  let matrix: (string | number | null)[][];
  let sheetName: string;
  const warnings: string[] = [];
  try {
    const wb = XLSX.read(buf, { type: "buffer" });
    if (wb.SheetNames.length === 0) return fail("ชีตว่าง (ไม่มีแท็บ)");
    const picked = pickSheetName(wb.SheetNames, month);
    sheetName = picked.name;
    // ⚠️ ไม่มีแท็บของเดือนนี้ → ห้าม fallback ไปแท็บแรก (จะเขียนข้อมูลผิดเดือน)
    //    คืน warn เฉย ๆ ไม่ upsert — ปลอดภัยกว่า
    if (!picked.matched)
      return {
        ok: false,
        status: "warn",
        message: `ยังไม่มีแท็บเดือน "${TH_MONTHS[month - 1]}" ในชีต — ยังไม่ซิงค์ (กันเขียนผิดเดือน)`,
        rows: 0,
        warnings: [`ไม่พบแท็บเดือน "${TH_MONTHS[month - 1]}" ในชีต`],
        sheetName,
      };
    const ws = wb.Sheets[sheetName];
    matrix = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      raw: true,
      defval: null,
    }) as (string | number | null)[][];
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return fail(`อ่านไฟล์ชีตไม่ได้: ${msg}`);
  }

  // 3) parse เดือนนี้ (ตัวอ่านเดิม)
  const parsed = parseHotelSheet(matrix, year, month);
  warnings.push(...parsed.warnings);
  if (parsed.rows.length === 0)
    return {
      ok: false,
      status: "error",
      message: `แท็บ "${sheetName}" ไม่มีแถวข้อมูลของเดือนนี้`,
      rows: 0,
      warnings,
      sheetName,
    };

  // 4) upsert ลง DB — mirror การนำเข้ามือ 100% (idempotent)
  const now = new Date().toISOString();
  const payloads = parsed.rows.map((r: HotelParsedRow) => ({
    org_id: orgId,
    company_id: companyId,
    branch_id: branchId,
    sales_date: r.sales_date,
    shift: r.shift,
    rooms: r.rooms,
    room_revenue: r.room_revenue,
    fine: r.fine,
    tip: r.tip,
    goods_sales: r.goods_sales,
    total_sales: r.total_sales,
    cash_to_remit: r.cash_to_remit,
    cash_pool: r.cash_pool,
    cash_deposited: r.cash_deposited,
    cash_diff: r.cash_diff,
    advance: r.advance,
    qr_morning: r.qr_morning,
    qr_after2330: r.qr_after2330,
    qr_total: r.qr_total,
    qr_banked: r.qr_banked,
    qr_diff: r.qr_diff,
    ota_agoda: r.ota_agoda,
    ota_agoda_banked: r.ota_agoda_banked,
    ota_expedia: r.ota_expedia,
    ota_expedia_banked: r.ota_expedia_banked,
    ota_booking: r.ota_booking,
    ota_booking_banked: r.ota_booking_banked,
    staff_name: r.staff_name,
    note: r.note,
    over_short: r.over_short,
    source: "sheet_import",
    imported_by: userId ?? null,
    imported_at: now,
    updated_at: now,
  }));

  // unique key จริงบน prod = (branch,date,shift,source) → อัปเดตทับแถว sheet_import เดิม
  const { error } = await admin
    .from("cashhub_hotel_daily")
    .upsert(payloads, { onConflict: "branch_id,sales_date,shift,source" });
  if (error) return fail(`บันทึกลงระบบไม่สำเร็จ: ${error.message}`);

  const hasWarn = warnings.length > 0;
  return {
    ok: true,
    status: hasWarn ? "warn" : "ok",
    message: hasWarn
      ? `ซิงค์แล้ว ${parsed.rows.length} แถว · มีข้อควรระวัง: ${warnings.join(" · ")}`
      : `ซิงค์จากชีตสำเร็จ (${parsed.rows.length} แถว)`,
    rows: parsed.rows.length,
    warnings,
    sheetName,
  };
}

export type HotelSyncDisplay = {
  status: HotelSyncStatus;
  message: string;
  syncedAt: string | null;
};

/**
 * ตัวช่วยเรียกจาก Server Component: อ่าน config → เช็ก throttle → ซิงค์ถ้าเก่าเกิน TTL →
 * อัปเดตสถานะล่าสุด. คืน null ถ้าสาขานี้ยังไม่ได้ผูกชีต/ปิด auto_sync.
 * (แยกออกจากหน้า page เพื่อไม่เรียก Date.now ในตัว render — กฎ purity ของโปรเจกต์)
 */
export async function maybeSyncHotelSheet(opts: {
  admin: AdminDb;
  branchId: string;
  year: number;
  month: number;
  userId?: string | null;
}): Promise<HotelSyncDisplay | null> {
  const { admin, branchId, year, month, userId } = opts;

  const { data: cfgRaw } = await admin
    .from("cashhub_hotel_sheet_config")
    .select(
      "sheet_id, org_id, company_id, auto_sync, last_synced_at, last_status, last_message",
    )
    .eq("branch_id", branchId)
    .maybeSingle();
  const cfg = cfgRaw as {
    sheet_id: string;
    org_id: string;
    company_id: string;
    auto_sync: boolean;
    last_synced_at: string | null;
    last_status: HotelSyncStatus | null;
    last_message: string | null;
  } | null;

  if (!cfg?.sheet_id || cfg.auto_sync === false) return null;

  const stale =
    !cfg.last_synced_at ||
    Date.now() - Date.parse(cfg.last_synced_at) > HOTEL_SYNC_TTL_MS;
  if (!stale) {
    return {
      status: cfg.last_status ?? "ok",
      message: cfg.last_message ?? "ซิงค์อัตโนมัติ",
      syncedAt: cfg.last_synced_at,
    };
  }

  const res = await syncHotelSheet({
    admin,
    orgId: cfg.org_id,
    companyId: cfg.company_id,
    branchId,
    sheetId: cfg.sheet_id,
    year,
    month,
    userId,
  });
  const nowIso = new Date().toISOString();
  await admin
    .from("cashhub_hotel_sheet_config")
    .update({
      last_synced_at: nowIso,
      last_status: res.status,
      last_message: res.message,
      updated_at: nowIso,
    })
    .eq("branch_id", branchId);

  return { status: res.status, message: res.message, syncedAt: nowIso };
}

/** ปี/เดือนปัจจุบันตามเวลาไทย (ลิบ · ไม่อยู่ใน render → ใช้ new Date ได้) */
function currentBkkYearMonth(): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  return { year, month };
}

export type HotelCardSummary = {
  branchId: string;
  branchName: string;
  monthLabel: string; // "เม.ย. 2569"
  monthHref: string; // ลิงก์ไปหน้าโรงแรมของเดือนนั้น
  totalSales: number;
  cashDeposited: number;
  qrBanked: number;
  qrFlagCount: number;
  syncStatus: HotelSyncStatus | null;
};

/**
 * สรุปโรงแรมสำหรับ "การ์ดในหน้าภาพรวม" — ซิงค์เดือนปัจจุบัน (throttle·ปลอดภัย) แล้วโชว์
 * เดือนล่าสุดที่มีข้อมูลจริง (กันการ์ดว่างถ้าเดือนนี้ยังไม่มียอด). คืน null ถ้าไม่มีสาขา/ข้อมูล.
 */
export async function loadHotelCardSummary(
  admin: AdminDb,
  orgId: string,
): Promise<HotelCardSummary | null> {
  const { data: br } = await admin
    .from("branches")
    .select("id, name")
    .eq("org_id", orgId)
    .eq("business_type", "hotel")
    .eq("is_active", true)
    .order("name")
    .limit(1)
    .maybeSingle();
  const branch = br as { id: string; name: string } | null;
  if (!branch) return null;

  // ซิงค์เดือนปัจจุบัน (ถ้ามีแท็บ) — throttle กันถี่ · ไม่พังถ้า error
  const { year, month } = currentBkkYearMonth();
  let syncStatus: HotelSyncStatus | null = null;
  try {
    const s = await maybeSyncHotelSheet({ admin, branchId: branch.id, year, month });
    syncStatus = s?.status ?? null;
  } catch {
    syncStatus = null;
  }

  // เดือนล่าสุดที่มีข้อมูล (ไม่รวม IV)
  const { data: latest } = await admin
    .from("cashhub_hotel_daily")
    .select("sales_date")
    .eq("branch_id", branch.id)
    .neq("source", "trcloud_iv")
    .order("sales_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  const latestDate = (latest as { sales_date: string } | null)?.sales_date;
  if (!latestDate) return null;
  const [ly, lm] = latestDate.split("-").map((x) => Number.parseInt(x, 10));

  const from = `${ly}-${String(lm).padStart(2, "0")}-01`;
  const to = `${ly}-${String(lm).padStart(2, "0")}-${String(
    new Date(ly, lm, 0).getDate(),
  ).padStart(2, "0")}`;
  const { data } = await admin
    .from("cashhub_hotel_daily")
    .select("*")
    .eq("branch_id", branch.id)
    .neq("source", "trcloud_iv")
    .gte("sales_date", from)
    .lte("sales_date", to)
    .order("sales_date");
  const s = summarize(groupByDay((data ?? []) as HotelShiftRow[]));

  const monthStr = `${ly}-${String(lm).padStart(2, "0")}`;
  return {
    branchId: branch.id,
    branchName: branch.name,
    monthLabel: `${TH_MONTHS[lm - 1]} ${ly + 543}`,
    monthHref: `/cashhub/hotel?branchId=${branch.id}&month=${monthStr}`,
    totalSales: s.totalSales,
    cashDeposited: s.cashDeposited,
    qrBanked: s.qrBanked,
    qrFlagCount: s.qrFlagCount,
    syncStatus,
  };
}

/**
 * Cron รายวัน (ตัวสำรอง): ดึงชีตของทุกสาขาที่ผูกไว้ (auto_sync) → เดือนปัจจุบัน → ลงฐาน
 * บังคับดึง (ข้าม throttle) เพราะเป็นการันตีรายวันแม้ไม่มีใครเปิดหน้า. ไม่ throw รายตัว.
 */
export async function runHotelDailyCron(
  admin: AdminDb,
): Promise<{
  synced: number;
  results: Array<{ branchId: string; status: HotelSyncStatus; message: string }>;
}> {
  const { data: cfgs } = await admin
    .from("cashhub_hotel_sheet_config")
    .select("branch_id, org_id, company_id, sheet_id, auto_sync");
  const configs = (cfgs ?? []) as Array<{
    branch_id: string;
    org_id: string;
    company_id: string;
    sheet_id: string;
    auto_sync: boolean;
  }>;

  const { year, month } = currentBkkYearMonth();
  const results: Array<{
    branchId: string;
    status: HotelSyncStatus;
    message: string;
  }> = [];

  for (const c of configs) {
    if (c.auto_sync === false) continue;
    const res = await syncHotelSheet({
      admin,
      orgId: c.org_id,
      companyId: c.company_id,
      branchId: c.branch_id,
      sheetId: c.sheet_id,
      year,
      month,
    });
    const nowIso = new Date().toISOString();
    await admin
      .from("cashhub_hotel_sheet_config")
      .update({
        last_synced_at: nowIso,
        last_status: res.status,
        last_message: res.message,
        updated_at: nowIso,
      })
      .eq("branch_id", c.branch_id);
    results.push({ branchId: c.branch_id, status: res.status, message: res.message });
  }

  return { synced: results.length, results };
}
