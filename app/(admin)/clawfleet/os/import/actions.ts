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

import { createHmac } from "node:crypto";
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
