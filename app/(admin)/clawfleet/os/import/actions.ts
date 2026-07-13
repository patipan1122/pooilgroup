"use server";

// =============================================================
// ClawFleet · นำเข้าข้อมูลเก็บเงิน/เติมตุ๊กตา จาก Excel — PREVIEW (เฟส 1)
// =============================================================
// เฉพาะแอดมิน ClawFleet. อ่านไฟล์ .xlsx/.csv → จับคู่สาขา+ตู้ → ตรวจเลข →
// แยก "ตั้งค่าครั้งแรก" vs "เก็บปกติ" → กันซ้ำ (ตู้+วันเดียวกัน) → เซ็น HMAC.
// ยังไม่เขียนลง DB (เฟส 2 = commit). Flow: preview → ยืนยัน → commit (no silent write)
// ตาม memory [[pool-csv-import-must-diff-before-write]] + [[money-feature-client-preview-must-match-server]].
//
// อ้างตู้ด้วยรหัส (CfMachine.code · unique ต่อ org) · อ้างสาขาด้วยชื่อไทยหรือรหัสสาขา.
// เงินกรอกเป็น "บาท" ในไฟล์ → แปลงเป็น cents ตอน commit. ไม่ต้องระบุ SKU.

import { createHmac, timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { assertCfAdmin } from "@/lib/clawfleet/role-guard";
import {
  IMPORT_COLUMNS,
  HEADER_LINE,
  type ColumnKey,
  type PreviewRow,
  type PreviewResult,
  type PreviewResponse,
  type CommitResult,
  type CommitResponse,
  type ImportBatchSummary,
} from "./types";

// ── normalize key (สาขา/รหัส/หัวตาราง) — กัน zero-width / NBSP / ช่องว่างเกิน ──
function normKey(raw: string): string {
  return raw
    .normalize("NFC")
    // NBSP -> ช่องว่างปกติ ก่อนยุบ whitespace (escaped ตาม memory csv-header-invisible-char)
    .replace(/\u00A0/g, " ")
    // ตัด BOM + zero-width + bidi marks + word-joiner
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// header จับด้วย label แบบตัดช่องว่างทั้งหมด (เผื่อ "เงินที่เก็บ (บาท)" มีเว้นวรรค).
function normHeader(raw: string): string {
  return normKey(raw).replace(/\s+/g, "");
}

function isExampleRow(rawBranch: string): boolean {
  const k = normKey(rawBranch);
  return k.startsWith("ตัวอย่าง") || k.startsWith("example");
}

// ── xlsx / csv → string[][] ─────────────────────────────────────────────────
function parseXlsx(buf: Buffer): string[][] {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: false });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const ws = wb.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json<unknown[]>(ws!, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: false,
  }) as unknown[][];
  return raw.map((row) => row.map((cell) => (cell == null ? "" : String(cell).trim())));
}

function parseCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") {
        row.push(cell);
        cell = "";
      } else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(cell);
        cell = "";
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = [];
      } else cell += ch;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }
  return rows;
}

// ── field parsers ───────────────────────────────────────────────────────────
// วันที่ "YYYY-MM-DD" หรือ "YYYY-MM-DD HH:mm" → คืน "YYYY-MM-DD" (day granularity).
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T]\d{2}:\d{2})?$/;
function parseDate(raw: string): string | null {
  const m = raw.trim().match(DATE_RE);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  // ตรวจว่าเป็นวันจริง (เช่น 2026-02-30 ไม่ผ่าน)
  const test = new Date(Date.UTC(y, mo - 1, d));
  if (test.getUTCFullYear() !== y || test.getUTCMonth() !== mo - 1 || test.getUTCDate() !== d) {
    return null;
  }
  return `${m[1]}-${m[2]}-${m[3]}`;
}

// จำนวนเต็ม ≥ 0 (มิเตอร์/สต๊อก/เติม) · คืน null ถ้าว่าง · undefined ถ้ารูปแบบผิด.
function parseNonNegInt(raw: string): number | null | undefined {
  const cleaned = raw.replace(/[,\s฿]/g, "").trim();
  if (cleaned === "") return null;
  if (!/^\d+$/.test(cleaned)) return undefined;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.round(n);
}

// เงิน (บาท) — จำนวนเต็มบวก (> 0). คืน null ถ้าว่าง · undefined ถ้าผิด.
function parsePosInt(raw: string): number | null | undefined {
  const cleaned = raw.replace(/[,\s฿]/g, "").trim();
  if (cleaned === "") return null;
  if (!/^\d+$/.test(cleaned)) return undefined;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.round(n);
}

// ── HMAC (กันแก้ตัวเลขระหว่าง preview → commit) — namespaced ต่อโปรแกรม (RULE J) ─
const HMAC_KEY =
  process.env.CLAWFLEET_IMPORT_PAYLOAD_SECRET ??
  process.env.NEXTAUTH_SECRET ??
  "clawfleet-import-payload-dev-key";

// ไม่ export (ไฟล์ "use server" export ได้เฉพาะ async) · ใช้ภายในไฟล์เท่านั้น.
function signImportPayload(payload: string, userId: string, orgId: string): string {
  return createHmac("sha256", HMAC_KEY).update(`${orgId}|${userId}|${payload}`).digest("hex");
}

function verifyImportPayloadSig(payload: string, userId: string, orgId: string, sig: string): boolean {
  const expected = Buffer.from(signImportPayload(payload, userId, orgId), "hex");
  let given: Buffer;
  try {
    given = Buffer.from(sig, "hex");
  } catch {
    return false;
  }
  if (expected.length !== given.length) return false;
  return timingSafeEqual(expected, given);
}

// prefix marker ใน CfCollectionEvent.notes → ใช้จับกลุ่ม "ชุดนำเข้า" สำหรับ undo/ประวัติ.
// รูปแบบ: "[IMP:<batchId>]" (batchId = uuid). ไม่ต้อง migration เพิ่มคอลัมน์.
const IMPORT_NOTE_PREFIX = "[IMP:";
function importNote(batchId: string): string {
  return `${IMPORT_NOTE_PREFIX}${batchId}]`;
}
function parseBatchId(notes: string | null): string | null {
  if (!notes || !notes.startsWith(IMPORT_NOTE_PREFIX)) return null;
  const end = notes.indexOf("]", IMPORT_NOTE_PREFIX.length);
  if (end < 0) return null;
  return notes.slice(IMPORT_NOTE_PREFIX.length, end);
}

// ── preview action ──────────────────────────────────────────────────────────
export async function previewCollectionsFile(formData: FormData): Promise<PreviewResponse> {
  const session = await assertCfAdmin();
  const orgId = session.user.org_id;

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "ยังไม่ได้เลือกไฟล์" };
  if (file.size === 0) return { ok: false, error: "ไฟล์ว่าง" };
  if (file.size > 5 * 1024 * 1024) return { ok: false, error: "ไฟล์ใหญ่เกิน 5MB" };

  const isXlsx =
    file.name.toLowerCase().endsWith(".xlsx") ||
    file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  let grid: string[][];
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    grid = isXlsx ? parseXlsx(buf) : parseCsv(buf.toString("utf-8"));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "อ่านไฟล์ไม่ออก";
    return { ok: false, error: `อ่านไฟล์ไม่สำเร็จ · ${msg}` };
  }
  if (grid.length < 2) {
    return { ok: false, error: `ไฟล์ต้องมีหัวตาราง + อย่างน้อย 1 แถว · หัวตาราง: ${HEADER_LINE}` };
  }

  // header → column index map (จับด้วย label · ยอมสลับลำดับ/ตัดคอลัมน์ท้ายที่ไม่ใช้).
  const headerCells = grid[0].map((s) => normHeader(s));
  const colIndex = {} as Record<ColumnKey, number>;
  for (const col of IMPORT_COLUMNS) {
    colIndex[col.key] = headerCells.indexOf(normHeader(col.label));
  }
  // คอลัมน์บังคับต้องเจอในหัวตาราง.
  const missingRequired = IMPORT_COLUMNS.filter(
    (c) => c.required && colIndex[c.key] < 0,
  ).map((c) => c.label);
  if (missingRequired.length > 0) {
    return {
      ok: false,
      error: `หัวตารางขาดคอลัมน์: ${missingRequired.join(", ")} · หัวตารางที่ต้องใช้: ${HEADER_LINE}`,
    };
  }

  // preload สาขา + ตู้คีบของ org.
  const branches = await prisma.branch.findMany({
    where: { orgId, isActive: true },
    select: { id: true, name: true, code: true },
  });
  const branchByKey = new Map<string, (typeof branches)[number]>();
  for (const b of branches) {
    branchByKey.set(normKey(b.name), b);
    if (b.code) branchByKey.set(normKey(b.code), b);
  }

  const machines = await prisma.cfMachine.findMany({
    where: { orgId, kind: "CLAW", isActive: true },
    select: {
      id: true,
      code: true,
      nickname: true,
      branchId: true,
      isFirstBaselineLocked: true,
      lastCoinMeter: true,
    },
  });
  const machineByCode = new Map<string, (typeof machines)[number]>();
  for (const m of machines) machineByCode.set(normKey(m.code), m);

  const cell = (r: string[], key: ColumnKey): string => {
    const idx = colIndex[key];
    return idx >= 0 && idx < r.length ? (r[idx] ?? "").trim() : "";
  };

  // Pass 1 · parse + validate ทุกแถว.
  const draft: PreviewRow[] = [];
  for (let i = 1; i < grid.length; i++) {
    const r = grid[i];
    if (r.every((c) => c.trim() === "")) continue; // แถวว่าง

    const branchRaw = cell(r, "branch");
    const machineRaw = cell(r, "machine");
    const dateRaw = cell(r, "date");
    const cashRaw = cell(r, "cash");

    // แถวตัวอย่าง (ขึ้นต้น "ตัวอย่าง") → ข้ามเงียบ.
    if (isExampleRow(branchRaw)) continue;
    // แถว skeleton (เติมสาขา+รหัสให้ แต่ยังไม่กรอกวันที่+เงิน) → ข้ามเงียบ.
    if (!dateRaw && !cashRaw) continue;

    const errors: string[] = [];
    const warnings: string[] = [];

    // สาขา
    const branch = branchRaw ? branchByKey.get(normKey(branchRaw)) ?? null : null;
    if (!branchRaw) errors.push("ไม่มีสาขา");
    else if (!branch) errors.push(`ไม่พบสาขา "${branchRaw}"`);

    // ตู้ (จับด้วยรหัส · unique ต่อ org)
    const machine = machineRaw ? machineByCode.get(normKey(machineRaw)) ?? null : null;
    if (!machineRaw) errors.push("ไม่มีรหัสตู้");
    else if (!machine) errors.push(`ไม่พบตู้รหัส "${machineRaw}" (ดูรายชื่อในแท็บ 'รายชื่อสาขา+ตู้')`);
    // ตู้ต้องอยู่สาขาที่กรอก (กันพิมพ์สลับ)
    if (machine && branch && machine.branchId !== branch.id) {
      errors.push(`ตู้ "${machineRaw}" ไม่ได้อยู่สาขา "${branchRaw}" — เช็ครหัสตู้/สาขาให้ตรง`);
    }

    // วันที่
    let date: string | null = null;
    if (!dateRaw) errors.push("ไม่มีวันที่");
    else {
      date = parseDate(dateRaw);
      if (!date) errors.push(`วันที่รูปแบบผิด (ต้องเป็น YYYY-MM-DD) ได้: "${dateRaw}"`);
    }

    // เงินที่เก็บ (บังคับ · บวก)
    let cashBaht: number | null = null;
    if (!cashRaw) errors.push("ไม่มีเงินที่เก็บ");
    else {
      const v = parsePosInt(cashRaw);
      if (v === undefined) errors.push(`เงินที่เก็บต้องเป็นจำนวนเต็มบวก ได้: "${cashRaw}"`);
      else cashBaht = v;
    }

    // ตัวเลขที่ไม่บังคับ (มิเตอร์/สต๊อก/เติม) — ≥ 0
    const nums: Record<string, number | null> = {};
    for (const key of [
      "coinMeterTop",
      "coinMeterBottom",
      "dollMeterTop",
      "dollMeterBottom",
      "stockBefore",
      "refillQty",
      "stockAfter",
    ] as const) {
      const raw = cell(r, key);
      const v = parseNonNegInt(raw);
      if (v === undefined) {
        const label = IMPORT_COLUMNS.find((c) => c.key === key)!.label;
        errors.push(`${label} ต้องเป็นจำนวนเต็ม ≥ 0 ได้: "${raw}"`);
        nums[key] = null;
      } else {
        nums[key] = v;
      }
    }

    // มิเตอร์เงิน — ต้องมีอย่างน้อย 1 ด้าน (anchor · ตรงกับ server top ?? bottom)
    const coinMeterUsed = nums.coinMeterTop ?? nums.coinMeterBottom ?? null;
    if (coinMeterUsed === null) {
      errors.push("มิเตอร์เงิน ยังไม่กรอก — กรอกอย่างน้อย 1 ด้าน (บนหรือล่าง)");
    }
    const dollMeterUsed = nums.dollMeterTop ?? nums.dollMeterBottom ?? null;

    // ตรวจความสมเหตุสมผลตุ๊กตา (เตือน ไม่บล็อก)
    if (
      nums.stockBefore !== null &&
      nums.refillQty !== null &&
      nums.stockAfter !== null &&
      nums.stockBefore + nums.refillQty !== nums.stockAfter
    ) {
      warnings.push(
        `ตุ๊กตาหลังเติม (${nums.stockAfter}) ≠ ก่อนเติม (${nums.stockBefore}) + เติม (${nums.refillQty})`,
      );
    }

    draft.push({
      rowIndex: i,
      branchInput: branchRaw,
      machineInput: machineRaw,
      dateInput: dateRaw,
      branchId: branch?.id ?? null,
      branchName: branch?.name ?? null,
      machineId: machine?.id ?? null,
      machineCode: machine?.code ?? null,
      machineNickname: machine?.nickname ?? null,
      date,
      coinMeterTop: nums.coinMeterTop,
      coinMeterBottom: nums.coinMeterBottom,
      dollMeterTop: nums.dollMeterTop,
      dollMeterBottom: nums.dollMeterBottom,
      cashBaht,
      stockBefore: nums.stockBefore,
      refillQty: nums.refillQty,
      stockAfter: nums.stockAfter,
      coinMeterUsed,
      dollMeterUsed,
      entryType: "COLLECTION", // แก้ทีหลังใน pass baseline
      errors,
      warnings,
      kind: errors.length > 0 ? "invalid" : "ready",
    });
  }

  // Pass 2 · กันซ้ำภายในไฟล์ (ตู้ + วันเดียวกัน).
  const seenInFile = new Map<string, PreviewRow>();
  for (const row of draft) {
    if (row.kind !== "ready" || !row.machineId || !row.date) continue;
    const k = `${row.machineId}|${row.date}`;
    const prev = seenInFile.get(k);
    if (prev) {
      row.kind = "dedup";
      row.errors.push(`ซ้ำกับแถวที่ ${prev.rowIndex} ในไฟล์ (ตู้เดียวกัน วันเดียวกัน)`);
    } else {
      seenInFile.set(k, row);
    }
  }

  // Pass 3 · กันซ้ำกับ DB (ตู้ + วันเดียวกันมี event อยู่แล้ว · ไม่นับ VOID).
  const readyRows = draft.filter((r) => r.kind === "ready" && r.machineId && r.date);
  if (readyRows.length > 0) {
    const machineIds = [...new Set(readyRows.map((r) => r.machineId!))];
    const dates = readyRows.map((r) => r.date!).sort();
    // ดึงกว้าง ±1 วันรอบช่วง แล้วเทียบวัน (เวลาไทย) ใน JS.
    const gte = new Date(`${dates[0]}T00:00:00+07:00`);
    gte.setUTCDate(gte.getUTCDate() - 1);
    const lte = new Date(`${dates[dates.length - 1]}T00:00:00+07:00`);
    lte.setUTCDate(lte.getUTCDate() + 2);
    const existing = await prisma.cfCollectionEvent.findMany({
      where: {
        orgId,
        machineId: { in: machineIds },
        eventType: { not: "VOID" },
        collectedAt: { gte, lte },
      },
      select: { id: true, machineId: true, collectedAt: true },
    });
    const existingByKey = new Map<string, string>();
    for (const e of existing) {
      const day = bangkokDay(e.collectedAt);
      existingByKey.set(`${e.machineId}|${day}`, e.id);
    }
    for (const row of readyRows) {
      const hit = existingByKey.get(`${row.machineId}|${row.date}`);
      if (hit) {
        row.kind = "dedup";
        row.dedupEventId = hit;
        row.errors.push("ตู้นี้มีข้อมูลของวันนี้ในระบบแล้ว");
      }
    }
  }

  // Pass 4 · แยก "ตั้งค่าครั้งแรก" vs "เก็บปกติ" + เตือนมิเตอร์ถอยหลังภายในไฟล์.
  // ตู้ที่ยังไม่ล็อก baseline → แถวแรกสุด (วันเก่าสุด) = INITIAL. ตู้ที่ล็อกแล้ว → COLLECTION ทั้งหมด.
  const readyForType = draft
    .filter((r) => r.kind === "ready" && r.machineId && r.date)
    .sort((a, b) =>
      a.machineId! < b.machineId!
        ? -1
        : a.machineId! > b.machineId!
          ? 1
          : a.date! < b.date!
            ? -1
            : a.date! > b.date!
              ? 1
              : a.rowIndex - b.rowIndex,
    );
  let curMachine = "";
  let prevMeter: number | null = null;
  let assignedBaseline = false;
  for (const row of readyForType) {
    if (row.machineId !== curMachine) {
      curMachine = row.machineId!;
      const m = machines.find((x) => x.id === curMachine);
      assignedBaseline = false;
      prevMeter = m && m.isFirstBaselineLocked ? m.lastCoinMeter : null;
    }
    const m = machines.find((x) => x.id === row.machineId);
    if (m && !m.isFirstBaselineLocked && !assignedBaseline) {
      row.entryType = "INITIAL";
      assignedBaseline = true;
    } else {
      row.entryType = "COLLECTION";
    }
    if (prevMeter !== null && row.coinMeterUsed !== null && row.coinMeterUsed < prevMeter) {
      row.warnings.push(`มิเตอร์เงิน (${row.coinMeterUsed}) น้อยกว่ารอบก่อน (${prevMeter}) — เช็คเลข`);
    }
    if (row.coinMeterUsed !== null) prevMeter = row.coinMeterUsed;
  }

  // นับสรุป
  const counts = {
    ready: 0,
    dedup: 0,
    invalid: 0,
    total: draft.length,
    initial: 0,
    collection: 0,
    machines: 0,
    days: 0,
  };
  const machineSet = new Set<string>();
  const daySet = new Set<string>();
  for (const r of draft) {
    if (r.kind === "ready") {
      counts.ready += 1;
      if (r.entryType === "INITIAL") counts.initial += 1;
      else counts.collection += 1;
      if (r.machineId) machineSet.add(r.machineId);
      if (r.date) daySet.add(r.date);
    } else if (r.kind === "dedup") counts.dedup += 1;
    else counts.invalid += 1;
  }
  counts.machines = machineSet.size;
  counts.days = daySet.size;

  const payload = JSON.stringify(draft.filter((r) => r.kind === "ready"));
  const payloadSig = signImportPayload(payload, session.user.id, orgId);

  const result: PreviewResult = { ok: true, rows: draft, counts, payload, payloadSig };
  return result;
}

// ── helper: วันที่แบบไทย "YYYY-MM-DD" จาก timestamp ─────────────────────────
function bangkokDay(d: Date): string {
  const ms = d.getTime() + 7 * 3600_000;
  const u = new Date(ms);
  const Y = u.getUTCFullYear();
  const M = String(u.getUTCMonth() + 1).padStart(2, "0");
  const D = String(u.getUTCDate()).padStart(2, "0");
  return `${Y}-${M}-${D}`;
}

// วันที่ "YYYY-MM-DD" → Date เที่ยงวันเวลาไทย (กันปัญหาขอบวัน).
function dayToDate(day: string): Date {
  return new Date(`${day}T12:00:00+07:00`);
}

// ============================================================
// COMMIT (เฟส 2) — เขียนจริงหลังผู้ใช้ยืนยันพรีวิว
// ============================================================
// - verify HMAC (กัน client แก้ตัวเลขระหว่างพรีวิว→ยืนยัน)
// - re-check ownership ตู้ (org + CLAW) + สถานะ baseline ปัจจุบัน
// - เรียงต่อตู้ วันเก่า→ใหม่ · chain มิเตอร์ "ก่อน" จาก timeline รวม (event เดิม + ไฟล์)
// - dedup TOCTOU (ตู้+วันเดิมใน DB) ในทรานแซกชัน
// - INITIAL/COLLECTION · session bucket ต่อ (สาขา,วัน,ชนิด) · CLOSED ตรง ๆ (ไม่ยิง crosscheck)
// - mirror last_coin_meter อัปเดตโดย DB trigger (เฉพาะ event ใหม่กว่า) → backfill ปลอดภัย
// - ทุก event ติด marker notes "[IMP:<batchId>]" ไว้ทำ undo/ประวัติ
export async function commitCollectionsImport(
  payload: string,
  payloadSig: string,
): Promise<CommitResponse> {
  const session = await assertCfAdmin();
  const orgId = session.user.org_id;
  const userId = session.user.id;

  if (!payloadSig || !verifyImportPayloadSig(payload, userId, orgId, payloadSig)) {
    return { ok: false, error: "ลายเซ็นข้อมูลไม่ถูกต้อง · กรุณาอ่านไฟล์ใหม่ (พรีวิว) แล้วยืนยันอีกครั้ง" };
  }

  let rows: PreviewRow[];
  try {
    const parsed: unknown = JSON.parse(payload);
    if (!Array.isArray(parsed)) throw new Error("not array");
    rows = parsed as PreviewRow[];
  } catch {
    return { ok: false, error: "ข้อมูลเสีย · กรุณาอ่านไฟล์ใหม่" };
  }
  rows = rows.filter(
    (r) => r.machineId && r.branchId && r.date && r.cashBaht != null && r.coinMeterUsed != null,
  );
  if (rows.length === 0) return { ok: false, error: "ไม่มีแถวที่จะบันทึก" };

  // re-check ownership · ตู้ต้องเป็น CLAW ของ org นี้ (กัน payload ปลอมข้ามองค์กร)
  const machineIds = [...new Set(rows.map((r) => r.machineId!))];
  const machines = await prisma.cfMachine.findMany({
    where: { orgId, kind: "CLAW", id: { in: machineIds } },
    select: {
      id: true,
      branchId: true,
      isFirstBaselineLocked: true,
      lastCoinMeter: true,
      lastDollMeter: true,
    },
  });
  const machineById = new Map(machines.map((m) => [m.id, m]));

  const batchId = globalThis.crypto.randomUUID();
  const note = importNote(batchId);

  const outcome = await prisma.$transaction(async (tx) => {
    // serialize การนำเข้าต่อ org (import เป็นงานแอดมินนาน ๆ ครั้ง) — กันกดยืนยัน
    // พร้อมกัน 2 แท็บ แล้ว dedup ต่างมองไม่เห็นกัน → เขียนซ้ำ (ไม่มี DB unique บน ตู้+วัน).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cf_import_${orgId}`}))`;

    // event เดิมของทุกตู้ (ไม่ VOID) → chain มิเตอร์ + dedup TOCTOU
    const existing = await tx.cfCollectionEvent.findMany({
      where: { orgId, machineId: { in: machineIds }, eventType: { not: "VOID" } },
      select: {
        machineId: true,
        collectedAt: true,
        coinMeterAfter: true,
        dollMeterAfter: true,
        eventType: true,
      },
    });
    const existingByMachine = new Map<string, typeof existing>();
    for (const e of existing) {
      const arr = existingByMachine.get(e.machineId) ?? [];
      arr.push(e);
      existingByMachine.set(e.machineId, arr);
    }

    const rowsByMachine = new Map<string, PreviewRow[]>();
    for (const r of rows) {
      const arr = rowsByMachine.get(r.machineId!) ?? [];
      arr.push(r);
      rowsByMachine.set(r.machineId!, arr);
    }

    let sessionSeq = 0;
    const sessionByKey = new Map<string, string>();
    const sessionCash = new Map<string, number>();
    const baselineMachines = new Map<string, Date>();
    let committedCount = 0;
    let skipped = 0;

    for (const [mid, mrows] of rowsByMachine) {
      const machine = machineById.get(mid);
      if (!machine) {
        skipped += mrows.length;
        continue;
      }
      const exList = existingByMachine.get(mid) ?? [];
      const existingDays = new Set(exList.map((e) => bangkokDay(e.collectedAt)));

      // เรียงวันเก่า→ใหม่ + dedup (วันซ้ำใน DB / ในกลุ่มเอง)
      const sorted = mrows
        .filter((r) => r.date)
        .sort((a, b) => (a.date! < b.date! ? -1 : a.date! > b.date! ? 1 : a.rowIndex - b.rowIndex));
      const seenDay = new Set<string>();
      const toWrite: PreviewRow[] = [];
      for (const r of sorted) {
        if (existingDays.has(r.date!) || seenDay.has(r.date!)) {
          skipped += 1;
          continue;
        }
        seenDay.add(r.date!);
        toWrite.push(r);
      }
      if (toWrite.length === 0) continue;

      // timeline รวม (event เดิม + แถวใหม่) เรียงวัน → chain coinBefore/dollBefore + แยก INITIAL
      type TL = { day: string; kind: "db" | "batch"; coinAfter: number; dollAfter: number | null; row?: PreviewRow };
      const tl: TL[] = [
        ...exList.map((e) => ({
          day: bangkokDay(e.collectedAt),
          kind: "db" as const,
          coinAfter: e.coinMeterAfter,
          dollAfter: e.dollMeterAfter,
        })),
        ...toWrite.map((r) => ({
          day: r.date!,
          kind: "batch" as const,
          coinAfter: r.coinMeterUsed!,
          dollAfter: r.dollMeterUsed,
          row: r,
        })),
      ].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.kind === "db" ? -1 : 1));

      // #6 (money-review): เช็ค "ล็อก baseline แล้ว" จากทั้ง flag (อาจ stale ถ้ามี commit
      // อื่นเพิ่งล็อก) และ INITIAL ที่มีอยู่จริงใน DB (อ่านในทรานแซกชันหลัง advisory lock)
      // → กันตู้ได้ INITIAL ซ้ำเมื่อสองชุดนำเข้าชนกัน.
      const hasExistingInitial = exList.some((e) => e.eventType === "INITIAL");
      const machineLocked = machine.isFirstBaselineLocked || hasExistingInitial;

      const entryByRow = new Map<number, "INITIAL" | "COLLECTION">();
      const beforeByRow = new Map<number, { coin: number; doll: number | null }>();
      // #2 (money-review): ตู้ที่ล็อกแล้วแต่ไม่มี event ใน DB (เช่นถูก void หมด) → seed
      // มิเตอร์จาก mirror ล่าสุด ไม่งั้น COLLECTION แรก before=after → delta 0 บังรายได้.
      // ตู้ที่มี event เดิม → timeline seed เอง (null). ตู้ใหม่ (ยังไม่ล็อก) → null → INITIAL before=0.
      const seedFromMirror = exList.length === 0 && machineLocked;
      let runCoin: number | null = seedFromMirror ? machine.lastCoinMeter : null;
      let runDoll: number | null = seedFromMirror ? machine.lastDollMeter : null;
      let assignedInitial = machineLocked; // locked แล้ว = ไม่ตั้ง INITIAL
      for (const t of tl) {
        if (t.kind === "db") {
          runCoin = t.coinAfter;
          if (t.dollAfter != null) runDoll = t.dollAfter;
          continue;
        }
        const r = t.row!;
        const isInitial = !assignedInitial;
        if (isInitial) assignedInitial = true;
        entryByRow.set(r.rowIndex, isInitial ? "INITIAL" : "COLLECTION");
        const coinBefore = runCoin !== null ? runCoin : isInitial ? 0 : r.coinMeterUsed!;
        beforeByRow.set(r.rowIndex, { coin: coinBefore, doll: runDoll });
        runCoin = r.coinMeterUsed!;
        if (r.dollMeterUsed != null) runDoll = r.dollMeterUsed;
      }

      // เขียน event (เรียงวันเก่า→ใหม่ ให้ mirror trigger เดินหน้าถูก)
      for (const r of toWrite) {
        const et = entryByRow.get(r.rowIndex)!;
        const before = beforeByRow.get(r.rowIndex)!;
        const collectedAt = dayToDate(r.date!);
        const cashCents = r.cashBaht! * 100;
        const isBaseline = et === "INITIAL";
        // ใช้สาขาจากตู้ที่ยืนยัน org แล้ว (ไม่เชื่อ branchId ใน payload)
        const machineBranchId = machine.branchId;
        const key = `${machineBranchId}|${r.date}|${isBaseline ? "B" : "C"}`;
        let sessionId = sessionByKey.get(key);
        if (!sessionId) {
          sessionSeq += 1;
          const s = await tx.cfCollectionSession.create({
            data: {
              orgId,
              branchId: machineBranchId,
              sessionCode: `IMP-${batchId.slice(0, 8)}-${String(sessionSeq).padStart(3, "0")}`,
              isBaseline,
              status: "CLOSED",
              openedById: userId,
              closedById: userId,
              openedAt: collectedAt,
              closedAt: collectedAt,
              totalCashCents: 0,
            },
            select: { id: true },
          });
          sessionId = s.id;
          sessionByKey.set(key, sessionId);
        }
        sessionCash.set(sessionId, (sessionCash.get(sessionId) ?? 0) + cashCents);

        await tx.cfCollectionEvent.create({
          data: {
            orgId,
            sessionId,
            machineId: mid,
            eventType: isBaseline ? "INITIAL" : "COLLECTION",
            collectedAt,
            collectedById: userId,
            coinMeterBefore: before.coin,
            coinMeterAfter: r.coinMeterUsed!,
            cashCountedCents: cashCents,
            dollMeterBefore: before.doll,
            dollMeterAfter: r.dollMeterUsed,
            stockBefore: r.stockBefore,
            stockAfter: r.stockAfter,
            refillQty: r.refillQty,
            // baseline: เก็บ 4 มิเตอร์กายภาพ (ตรงกับ submitFirstBaseline)
            meterMoneyTop: isBaseline ? r.coinMeterTop : null,
            meterMoneyBottom: isBaseline ? r.coinMeterBottom : null,
            meterDollTop: isBaseline ? r.dollMeterTop : null,
            meterDollBottom: isBaseline ? r.dollMeterBottom : null,
            notes: note,
          },
        });
        committedCount += 1;
        if (isBaseline && !baselineMachines.has(mid)) baselineMachines.set(mid, collectedAt);
      }
    }

    // ยอดเงินรวมต่อ session
    for (const [sid, cents] of sessionCash) {
      await tx.cfCollectionSession.update({ where: { id: sid }, data: { totalCashCents: cents } });
    }
    // lock ตู้ที่เพิ่งได้ baseline จากการนำเข้า (trigger ไม่ทำให้ · ตรงกับ submitFirstBaseline)
    for (const [mid, appliedAt] of baselineMachines) {
      await tx.cfMachine.update({
        where: { id: mid },
        data: { isFirstBaselineLocked: true, firstBaselineAppliedAt: appliedAt },
      });
    }

    return { committedCount, skipped };
  });

  if (outcome.committedCount === 0) {
    return { ok: false, error: "ไม่ได้บันทึกแถวใด (ทุกแถวซ้ำกับข้อมูลเดิม)" };
  }

  await prisma.auditLog
    .create({
      data: {
        orgId,
        userId,
        action: "CF_COLLECTIONS_IMPORT_COMMIT",
        resourceType: "CF_IMPORT_BATCH",
        resourceId: batchId,
        diff: { committed: outcome.committedCount, skipped: outcome.skipped, machines: machineIds.length },
      },
    })
    .catch(() => {});

  revalidatePath("/clawfleet/os/import");
  revalidatePath("/clawfleet/os/collections");
  revalidatePath("/clawfleet/os/reports");
  revalidatePath("/clawfleet/os/dashboard");

  const result: CommitResult = {
    ok: true,
    committed: outcome.committedCount,
    dedup: outcome.skipped,
    skippedAtCommit: outcome.skipped,
    importBatchId: batchId,
  };
  return result;
}

// ============================================================
// UNDO — ยกเลิกทั้งชุดนำเข้า (ลบ event + session ว่าง + recompute mirror/baseline)
// ============================================================
export async function undoImportBatch(
  batchId: string,
): Promise<{ ok: true; deleted: number } | { ok: false; error: string }> {
  const session = await assertCfAdmin();
  const orgId = session.user.org_id;
  const userId = session.user.id;
  if (!batchId || !/^[0-9a-fA-F-]{8,40}$/.test(batchId)) {
    return { ok: false, error: "รหัสชุดนำเข้าไม่ถูกต้อง" };
  }
  const note = importNote(batchId);

  const result = await prisma.$transaction(async (tx) => {
    const events = await tx.cfCollectionEvent.findMany({
      where: { orgId, notes: note },
      select: { id: true, machineId: true, sessionId: true },
    });
    if (events.length === 0) return { deleted: 0 };

    const eventIds = events.map((e) => e.id);
    const machineIds = [...new Set(events.map((e) => e.machineId))];
    const sessionIds = [...new Set(events.map((e) => e.sessionId).filter((s): s is string => !!s))];

    await tx.cfCollectionEvent.deleteMany({ where: { id: { in: eventIds } } });

    // ลบ session ของชุดนำเข้าที่กลายเป็นว่าง (IMP- เท่านั้น)
    if (sessionIds.length > 0) {
      const stillUsed = await tx.cfCollectionEvent.groupBy({
        by: ["sessionId"],
        where: { sessionId: { in: sessionIds } },
        _count: { _all: true },
      });
      const usedSet = new Set(stillUsed.map((r) => r.sessionId));
      const empty = sessionIds.filter((s) => !usedSet.has(s));
      if (empty.length > 0) {
        await tx.cfCollectionSession.deleteMany({
          where: { id: { in: empty }, orgId, sessionCode: { startsWith: "IMP-" } },
        });
      }
    }

    // ค่าตั้งต้นตู้ (ตอนสร้าง) — ใช้เป็น fallback ของ mirror เมื่อไม่มี event เหลือ
    // (#3 money-review: ตู้ที่ initial seed ไม่ใช่ 0 จะได้ไม่ถูกรีเซ็ตเป็น 0)
    const seeds = await tx.cfMachine.findMany({
      where: { orgId, id: { in: machineIds } },
      select: { id: true, initialCoinMeter: true, initialDollMeter: true },
    });
    const seedById = new Map(seeds.map((s) => [s.id, s]));

    // recompute mirror + baseline lock ต่อตู้ (trigger ไม่ยิงตอน DELETE)
    for (const mid of machineIds) {
      const latest = await tx.cfCollectionEvent.findFirst({
        where: { orgId, machineId: mid, eventType: { not: "VOID" } },
        orderBy: { collectedAt: "desc" },
        select: { collectedAt: true, coinMeterAfter: true },
      });
      const latestDoll = await tx.cfCollectionEvent.findFirst({
        where: { orgId, machineId: mid, eventType: { not: "VOID" }, dollMeterAfter: { not: null } },
        orderBy: { collectedAt: "desc" },
        select: { dollMeterAfter: true },
      });
      const latestStock = await tx.cfCollectionEvent.findFirst({
        where: { orgId, machineId: mid, eventType: { not: "VOID" }, stockAfter: { not: null } },
        orderBy: { collectedAt: "desc" },
        select: { stockAfter: true },
      });
      const initial = await tx.cfCollectionEvent.findFirst({
        where: { orgId, machineId: mid, eventType: "INITIAL" },
        orderBy: { collectedAt: "asc" },
        select: { collectedAt: true },
      });
      const seed = seedById.get(mid);
      await tx.cfMachine.update({
        where: { id: mid },
        data: {
          lastCoinMeter: latest?.coinMeterAfter ?? seed?.initialCoinMeter ?? 0,
          lastDollMeter: latestDoll?.dollMeterAfter ?? seed?.initialDollMeter ?? 0,
          lastDollStock: latestStock?.stockAfter ?? 0,
          lastEventAt: latest?.collectedAt ?? null,
          isFirstBaselineLocked: !!initial,
          firstBaselineAppliedAt: initial?.collectedAt ?? null,
        },
      });
    }

    return { deleted: eventIds.length };
  });

  if (result.deleted === 0) {
    return { ok: false, error: "ไม่พบชุดนำเข้านี้ (อาจถูกลบไปแล้ว)" };
  }

  await prisma.auditLog
    .create({
      data: {
        orgId,
        userId,
        action: "CF_COLLECTIONS_IMPORT_UNDO",
        resourceType: "CF_IMPORT_BATCH",
        resourceId: batchId,
        diff: { deleted: result.deleted },
      },
    })
    .catch(() => {});

  revalidatePath("/clawfleet/os/import");
  revalidatePath("/clawfleet/os/collections");
  revalidatePath("/clawfleet/os/reports");
  revalidatePath("/clawfleet/os/dashboard");
  return { ok: true, deleted: result.deleted };
}

// ============================================================
// ประวัติชุดนำเข้าล่าสุด (สำหรับ undo บนหน้า) · ImportBatchSummary อยู่ใน ./types
// ============================================================
export async function listRecentImportBatches(limit = 10): Promise<ImportBatchSummary[]> {
  const session = await assertCfAdmin();
  const orgId = session.user.org_id;
  const events = await prisma.cfCollectionEvent.findMany({
    where: { orgId, notes: { startsWith: IMPORT_NOTE_PREFIX } },
    select: { notes: true, machineId: true, cashCountedCents: true, createdAt: true, collectedAt: true },
    orderBy: { createdAt: "desc" },
    take: 3000,
  });
  type Acc = {
    count: number;
    machines: Set<string>;
    totalCents: number;
    days: string[];
    createdAt: Date;
  };
  const byBatch = new Map<string, Acc>();
  for (const e of events) {
    const bid = parseBatchId(e.notes);
    if (!bid) continue;
    const acc = byBatch.get(bid) ?? {
      count: 0,
      machines: new Set<string>(),
      totalCents: 0,
      days: [],
      createdAt: e.createdAt,
    };
    acc.count += 1;
    acc.machines.add(e.machineId);
    acc.totalCents += e.cashCountedCents;
    acc.days.push(bangkokDay(e.collectedAt));
    if (e.createdAt > acc.createdAt) acc.createdAt = e.createdAt;
    byBatch.set(bid, acc);
  }
  const out: ImportBatchSummary[] = [...byBatch.entries()].map(([batchId, a]) => {
    const days = a.days.sort();
    return {
      batchId,
      count: a.count,
      machines: a.machines.size,
      totalBaht: Math.round(a.totalCents / 100),
      firstDay: days[0] ?? null,
      lastDay: days[days.length - 1] ?? null,
      createdAt: a.createdAt.toISOString(),
    };
  });
  out.sort((x, y) => (x.createdAt < y.createdAt ? 1 : -1));
  return out.slice(0, limit);
}
