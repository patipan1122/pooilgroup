"use server";

// =============================================================
// F1 · CSV import maid collections (audit MISS-04 · 2026-06-02)
// =============================================================
// CEO+ADMIN-only. Office assistants paste a CSV exported from Excel/Sheets
// to back-fill a day of maid collection rounds without each maid having to
// re-log everything via the LIFF.
//
// Locked CSV header (case-sensitive · 6 columns · last 3 optional):
//   branchSlug,collectedAt,countedAmount,maidPhone,notes,slipUrl
//
// Per memory [[pool-csv-import-must-diff-before-write]] the flow is
// preview → confirm commit (no silent writes). Per [[wave-migration-written-not-applied-trap]]
// migration is committed but NOT applied · this code tolerates the un-applied
// state for compile but the runtime requires the migration before commit.
//
// Source column (chairops."CollectionSource") provenance:
//   MAID_MANUAL  · maid taps the LIFF (default · still requires photo+hash)
//   CSV_IMPORT   · this flow (photo+hash nullable)
//   OFFICE_PROXY · office desk types it in on behalf of the maid (future)
//
// Dedup window: 60 s on (branchId, collectedAt±60s, countedAmount). Same row
// pasted twice = single insert. Per CEO decision 2026-06-02.
//
// We do NOT touch ChairopsCashDeposit here · CSV_IMPORT rows arrive AFTER the
// office desk has already posted the bank slip · the deposit lives in its own
// flow. If `slipUrl` is set on a row it's recorded on the collection row so the
// LedgerTab can show "ยังไม่มีสลิป" properly.

import { createHmac, timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/chairops/auth/session";
import { writeAudit } from "@/lib/chairops/audit/log";
import { isAllowedPhotoUrl } from "@/lib/chairops/utils/url-guard";
// CSV header constant + types live in ./types so this "use server" file only
// exports async functions. Vercel build blocked otherwise:
//   "A 'use server' file can only export async functions, found object"
// (deploy f2g76l7iu @ 2026-06-02 10:41:33 UTC · for /chairops/import/maid-collections).
import {
  CSV_HEADER,
  HEADER_LINE,
  BRANCH_COL_ALIASES,
  type RowKind,
  type PreviewRow,
  type PreviewResult,
  type PreviewResponse,
  type CommitResult,
  type CommitResponse,
} from "./types";

// ---------- branch-name normalization --------------------------------------
// 2026-06-16 · the สาขา column now accepts the REAL Thai branch name OR the
// slug, so the CEO no longer has to look up the slug. Normalize aggressively
// before comparing — Excel/Sheets love to inject zero-width / NBSP / BOM
// characters and inconsistent spacing (same class of bug as
// [[csv-header-invisible-char-match-2026-06-16]]).
function normalizeBranchKey(raw: string): string {
  return raw
    .normalize("NFC")
    // NBSP \u00A0 -> plain space first so the \\s+ collapse below catches it
    .replace(/\u00A0/g, " ")
    // strip BOM + zero-width + bidi marks + word-joiner (escaped per
    // [[csv-header-invisible-char-match-2026-06-16]] - never paste raw invisibles)
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// "แอดมิน" / "admin" / "-" in the maidPhone column = the admin collected the
// cash themselves (OFFICE_PROXY) instead of a maid. 2026-06-16 · CEO decision.
function isAdminCollectMarker(raw: string): boolean {
  const k = normalizeBranchKey(raw);
  return (
    k === "แอดมิน" ||
    k === "แอดมินเก็บเอง" ||
    k === "แอดมินเก็บแทน" ||
    k === "admin" ||
    k === "office" ||
    k === "สำนักงาน" ||
    k === "-"
  );
}

// ---------- xlsx → string[][] converter -------------------------------------
// Reads the first sheet of an xlsx workbook and returns rows as string arrays,
// same shape as parseCsv(). raw:false converts numbers/dates to strings.
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
  return raw.map((row) =>
    row.map((cell) => (cell == null ? "" : String(cell).trim())),
  );
}

// ---------- minimal CSV parser ----------------------------------------------
// Matches the same conventions as pos-ingest/actions.ts but stripped down:
// supports CRLF · quoted cells · escaped quotes · BOM. NO type-coercion here ·
// every field comes out as a trimmed string.

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
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(cell);
        cell = "";
      } else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(cell);
        cell = "";
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = [];
      } else {
        cell += ch;
      }
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }
  return rows;
}

// ---------- field parsers ---------------------------------------------------

// "YYYY-MM-DD HH:mm" (locked format) · returns Date in Asia/Bangkok-local UTC
// (we treat the input as a wall-clock string anchored to the maid's timezone).
const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})\s(\d{2}):(\d{2})$/;
function parseCollectedAt(raw: string): Date | null {
  const m = raw.trim().match(DATETIME_RE);
  if (!m) return null;
  // Bangkok is UTC+7 · CEO desk types the maid's local wall-clock · subtract
  // 7h so the resulting Date prints back to the same wall-clock when shown via
  // toLocaleString in Asia/Bangkok. Matches how thaiDateTime() renders.
  const utc = Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]) - 7,
    Number(m[5]),
    0,
  );
  const d = new Date(utc);
  return Number.isFinite(d.getTime()) ? d : null;
}

function parseIntStrict(raw: string): number | null {
  const cleaned = raw.replace(/[,\s฿]/g, "").trim();
  if (cleaned === "") return null;
  if (!/^-?\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

// DEVIL-01 (2026-06-03) · payload is HMAC-signed at preview time and verified
// at commit so the browser cannot mutate countedAmount/collectedAt between
// the two calls. Keys are pinned to the calling user+org so leaking one
// payload can't be replayed for another tenant.
const HMAC_KEY =
  process.env.CHAIROPS_CSV_PAYLOAD_SECRET ??
  process.env.NEXTAUTH_SECRET ??
  // Last-resort dev fallback · production REQUIRES the real env to be set.
  "chairops-csv-payload-dev-key";

function signPayload(payload: string, userId: string, orgId: string): string {
  return createHmac("sha256", HMAC_KEY)
    .update(`${orgId}|${userId}|${payload}`)
    .digest("hex");
}

function verifyPayloadSig(
  payload: string,
  userId: string,
  orgId: string,
  sig: string,
): boolean {
  const expected = Buffer.from(signPayload(payload, userId, orgId), "hex");
  let given: Buffer;
  try {
    given = Buffer.from(sig, "hex");
  } catch {
    return false;
  }
  if (expected.length !== given.length) return false;
  return timingSafeEqual(expected, given);
}

// SEC-02 (2026-06-03) · per-row hardening. notes <= 2000 chars, phone <= 20.
// slipUrl must come from the R2 allowlist — the LIFF uploader writes there;
// nothing legitimate ever stores `javascript:` or `data:` URIs.
function sanitizeNotes(raw: string | null): { value: string | null; error?: string } {
  if (!raw) return { value: null };
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { value: null };
  if (trimmed.length > 2000) return { value: null, error: "notes ยาวเกิน 2000 ตัวอักษร" };
  return { value: trimmed };
}
function sanitizePhone(raw: string | null): { value: string | null; error?: string } {
  if (!raw) return { value: null };
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { value: null };
  if (trimmed.length > 20) return { value: null, error: "maidPhone ยาวเกิน 20 ตัวอักษร" };
  return { value: trimmed };
}
function sanitizeSlipUrl(raw: string | null): { value: string | null; error?: string } {
  if (!raw) return { value: null };
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { value: null };
  if (!isAllowedPhotoUrl(trimmed)) {
    return { value: null, error: "slipUrl ต้องเป็นลิงก์รูปจากระบบ (R2)" };
  }
  return { value: trimmed };
}

/** Normalize Thai phone numbers: keep digits only · strip leading 0/+66 · 9 or 10 digits. */
function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 0) return null;
  // 0X-XXXXXXXX (10 digits) or 66X-XXXXXXXX (cc=66 + 9 digits)
  if (digits.length === 10 && digits.startsWith("0")) return digits;
  if (digits.length === 11 && digits.startsWith("66")) return "0" + digits.slice(2);
  if (digits.length === 9) return "0" + digits; // already-stripped 0
  return digits; // keep as-is for fuzzy compare
}

// ---------- preview action --------------------------------------------------

export async function previewMaidCsv(
  formData: FormData,
): Promise<PreviewResponse> {
  // CEO+ADMIN only (rank CEO=4, ADMIN=5). requireRole("CEO") admits both.
  const session = await requireRole("CEO");

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { ok: false, error: "ยังไม่ได้เลือกไฟล์" };
  }
  if (file.size === 0) return { ok: false, error: "ไฟล์ว่าง" };
  if (file.size > 5 * 1024 * 1024) {
    return { ok: false, error: "ไฟล์ใหญ่เกิน 5MB" };
  }

  const isXlsx =
    file.name.toLowerCase().endsWith(".xlsx") ||
    file.type ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  let grid: string[][];
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    if (isXlsx) {
      grid = parseXlsx(buf);
    } else {
      grid = parseCsv(buf.toString("utf-8"));
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "อ่านไฟล์ไม่ออก";
    return { ok: false, error: `อ่านไฟล์ไม่สำเร็จ · ${msg}` };
  }
  if (grid.length < 2) {
    return {
      ok: false,
      error: `ไฟล์ต้องมี header + อย่างน้อย 1 แถว · header ที่ต้องใช้: ${HEADER_LINE}`,
    };
  }

  // Strict header check — CEO-locked schema · refuse otherwise so a stray
  // column order doesn't silently mis-write data.
  const header = grid[0].map((s) => s.trim());
  if (header.length !== CSV_HEADER.length) {
    return {
      ok: false,
      error: `header ผิด · ต้องเป็น ${CSV_HEADER.length} คอลัมน์ ตามนี้: ${HEADER_LINE}`,
    };
  }
  for (let i = 0; i < CSV_HEADER.length; i++) {
    // Column 1 (สาขา) accepts a few labels so files made from the OLD template
    // (header "branchSlug") still upload. Columns 2-6 stay strict.
    if (i === 0) {
      const ok = BRANCH_COL_ALIASES.includes(
        normalizeBranchKey(header[0]) as (typeof BRANCH_COL_ALIASES)[number],
      );
      if (!ok) {
        return {
          ok: false,
          error: `header column 1 ต้องเป็น "${CSV_HEADER[0]}" (เจอ "${header[0]}") · header ที่ต้องใช้: ${HEADER_LINE}`,
        };
      }
      continue;
    }
    if (header[i] !== CSV_HEADER[i]) {
      return {
        ok: false,
        error: `header column ${i + 1} ต้องเป็น "${CSV_HEADER[i]}" (เจอ "${header[i]}") · header ที่ต้องใช้: ${HEADER_LINE}`,
      };
    }
  }

  const orgId = session.user.orgId;

  // Preload branches (slug → branch).
  const branches = await prisma.chairopsBranch.findMany({
    where: { orgId, isActive: true },
    select: {
      id: true,
      name: true,
      slug: true,
    },
  });
  const branchBySlug = new Map(branches.map((b) => [b.slug, b]));
  // 2026-06-16 · resolve the สาขา column by NAME too (normalized), so the CEO
  // can type "เซ็นทรัล ขอนแก่น" instead of looking up "central-khonkaen".
  // Also index slugs under their normalized key so a pasted slug with stray
  // casing/whitespace still matches.
  const branchByNameKey = new Map<string, typeof branches>();
  const branchBySlugKey = new Map<string, (typeof branches)[number]>();
  for (const b of branches) {
    branchBySlugKey.set(normalizeBranchKey(b.slug), b);
    const nameKey = normalizeBranchKey(b.name);
    const list = branchByNameKey.get(nameKey) ?? [];
    list.push(b);
    branchByNameKey.set(nameKey, list);
  }
  // resolveBranch: exact slug → normalized slug → unique normalized name.
  // Returns { branch } or { error } (ambiguous name → ask for the slug).
  function resolveBranch(
    rawValue: string,
  ): { branch: (typeof branches)[number] | null; error?: string } {
    const exact = branchBySlug.get(rawValue);
    if (exact) return { branch: exact };
    const key = normalizeBranchKey(rawValue);
    const bySlug = branchBySlugKey.get(key);
    if (bySlug) return { branch: bySlug };
    const byName = branchByNameKey.get(key) ?? [];
    if (byName.length === 1) return { branch: byName[0] };
    if (byName.length > 1) {
      return {
        branch: null,
        error: `ชื่อสาขา "${rawValue}" ซ้ำกัน ${byName.length} สาขา · ใส่รหัส slug แทนชื่อ`,
      };
    }
    return { branch: null };
  }

  // Preload active maids and their branch assignments. We resolve maid in
  // priority order: phone-match → branch.primaryMaidId equivalent (single
  // active ChairopsMaidAssignment for the branch) → maid.primaryBranchId.
  // The ChairopsMaidAssignment table is the per-branch source of truth · the
  // legacy ChairopsBranch.primaryMaidId column doesn't exist.
  const maids = await prisma.chairopsUser.findMany({
    where: { orgId, role: "MAID", isActive: true },
    select: {
      id: true,
      displayName: true,
      phone: true,
      primaryBranchId: true,
    },
  });
  const assignments = await prisma.chairopsMaidAssignment.findMany({
    where: { orgId, isActive: true },
    select: { branchId: true, userId: true },
  });
  const maidById = new Map(maids.map((m) => [m.id, m]));
  const maidByPhone = new Map<string, (typeof maids)[number]>();
  for (const m of maids) {
    if (!m.phone) continue;
    const k = normalizePhone(m.phone);
    if (k) maidByPhone.set(k, m);
  }
  // Active assignments grouped by branch · used to pick the (sole) maid of a
  // branch when phone match misses. We exclude the maid's own primaryBranchId
  // fallback (covered below) so we never double-count.
  const assignedMaidsByBranch = new Map<string, string[]>();
  for (const a of assignments) {
    const list = assignedMaidsByBranch.get(a.branchId) ?? [];
    list.push(a.userId);
    assignedMaidsByBranch.set(a.branchId, list);
  }
  // primaryBranchId fallback · map branchId → maids whose primaryBranchId is it.
  const maidsByPrimaryBranch = new Map<string, typeof maids>();
  for (const m of maids) {
    if (!m.primaryBranchId) continue;
    const list = maidsByPrimaryBranch.get(m.primaryBranchId) ?? [];
    list.push(m);
    maidsByPrimaryBranch.set(m.primaryBranchId, list);
  }

  // Pass 1 · parse + validate every row.
  const draftRows: PreviewRow[] = [];
  for (let i = 1; i < grid.length; i++) {
    const r = grid[i];
    if (r.every((c) => c.trim() === "")) continue; // skip blank lines

    const errors: string[] = [];
    const cells = [...r];
    while (cells.length < CSV_HEADER.length) cells.push("");
    const [branchRaw, dateRaw, amtRaw, phoneRaw, notesRaw, slipRaw] = cells.map(
      (c) => c.trim(),
    );

    // Pre-filled template ships one row per branch (name only). A row the CEO
    // never touched has no amount AND no time → treat it as blank skeleton and
    // skip silently (don't flag the whole branch list as errors). 2026-06-16.
    if (!amtRaw && !dateRaw) continue;

    // สาขา column resolves by real Thai name OR slug. 2026-06-16.
    if (!branchRaw) errors.push("ไม่มีสาขา");
    const resolved = branchRaw
      ? resolveBranch(branchRaw)
      : { branch: null as (typeof branches)[number] | null };
    const branch = resolved.branch;
    if (branchRaw && !branch) {
      errors.push(resolved.error ?? `ไม่พบสาขา "${branchRaw}"`);
    }

    // "แอดมิน" / "-" in the maidPhone column = the admin collected the cash
    // themselves → attribute to the importing admin, source OFFICE_PROXY. The
    // value is NOT a real phone, so we clear it from the phone field.
    const isAdminProxy = isAdminCollectMarker(phoneRaw);
    const source: PreviewRow["source"] = isAdminProxy
      ? "OFFICE_PROXY"
      : "CSV_IMPORT";
    const phoneInput = isAdminProxy ? "" : phoneRaw;

    let collectedAt: Date | null = null;
    if (!dateRaw) {
      errors.push("ไม่มี collectedAt");
    } else {
      collectedAt = parseCollectedAt(dateRaw);
      if (!collectedAt) {
        errors.push(`collectedAt รูปแบบผิด (ต้องเป็น YYYY-MM-DD HH:mm) ได้: "${dateRaw}"`);
      }
    }

    let countedAmount: number | null = null;
    if (!amtRaw) {
      errors.push("ไม่มี countedAmount");
    } else {
      countedAmount = parseIntStrict(amtRaw);
      if (countedAmount == null) {
        errors.push(`countedAmount ต้องเป็นจำนวนเต็มบวก ได้: "${amtRaw}"`);
      }
    }

    // Maid resolution.
    //   OFFICE_PROXY → the cash belongs to the importing admin · no maid lookup.
    //   CSV_IMPORT   → phone first, then sole active assignment for the branch,
    //                  then primaryBranchId fallback.
    let maidId: string | null = null;
    let maidLabel: string | null = null;
    if (isAdminProxy) {
      maidId = session.user.id;
      maidLabel = "แอดมินเก็บแทน";
    } else if (branch) {
      const phoneKey = phoneRaw ? normalizePhone(phoneRaw) : null;
      const hit = phoneKey ? maidByPhone.get(phoneKey) ?? null : null;
      if (hit) {
        maidId = hit.id;
        maidLabel = `${hit.displayName} (เบอร์)`;
      } else {
        const assignedIds = assignedMaidsByBranch.get(branch.id) ?? [];
        if (assignedIds.length === 1) {
          const m = maidById.get(assignedIds[0]);
          if (m) {
            maidId = m.id;
            maidLabel = `${m.displayName} (assignment สาขา)`;
          }
        } else if (assignedIds.length === 0) {
          const primaryList = maidsByPrimaryBranch.get(branch.id) ?? [];
          if (primaryList.length === 1) {
            maidId = primaryList[0].id;
            maidLabel = `${primaryList[0].displayName} (สาขาหลักของแม่บ้าน)`;
          }
        }
      }
      if (!maidId) {
        errors.push(
          'หาแม่บ้านไม่เจอ · ใส่เบอร์แม่บ้านที่ตรง · ผูกแม่บ้านกับสาขานี้คนเดียว · หรือพิมพ์ "แอดมิน" ถ้าแอดมินเก็บเอง',
        );
      }
    }

    // SEC-02 (2026-06-03) · validate per-row free-text BEFORE writing.
    const phoneOut = sanitizePhone(phoneInput || null);
    if (phoneOut.error) errors.push(phoneOut.error);
    const notesOut = sanitizeNotes(notesRaw || null);
    if (notesOut.error) errors.push(notesOut.error);
    const slipOut = sanitizeSlipUrl(slipRaw || null);
    if (slipOut.error) errors.push(slipOut.error);

    draftRows.push({
      rowIndex: i,
      // Echo the canonical slug when resolved so the preview is unambiguous
      // even if the CEO typed the Thai name.
      branchSlug: branch?.slug ?? branchRaw,
      collectedAt: collectedAt ? formatLocalIso(collectedAt) : null,
      countedAmount,
      maidPhone: phoneOut.value,
      notes: notesOut.value,
      slipUrl: slipOut.value,
      branchId: branch?.id ?? null,
      branchName: branch?.name ?? null,
      maidId,
      maidLabel,
      source,
      errors,
      kind: errors.length > 0 ? "invalid" : "ready",
    });
  }

  // Pass 2 · dedup within the batch and against existing rows. Two rows match
  // when (branchId, |collectedAt diff| ≤ 60s, countedAmount) all align.
  //
  // BA-02 (2026-06-03) · the original implementation keyed dedup by
  // Math.floor(ts/60000) — a minute INDEX — so two rows at 12:00:45 and
  // 12:01:15 (30 s apart) landed in different buckets and BOTH survived.
  // Switch to true ±60 s windowed compare on sorted neighbours.
  const readyForDb: PreviewRow[] = [];
  type DedupEntry = { row: PreviewRow; ts: number };
  const byBranchAmount = new Map<string, DedupEntry[]>();
  for (const r of draftRows) {
    if (r.kind !== "ready" || !r.branchId || !r.collectedAt || r.countedAmount == null) {
      continue;
    }
    const ts = new Date(r.collectedAt + "+07:00").getTime();
    const k = `${r.branchId}|${r.countedAmount}`;
    const arr = byBranchAmount.get(k) ?? [];
    const dupe = arr.find((e) => Math.abs(e.ts - ts) <= 60_000);
    if (dupe) {
      r.kind = "dedup";
      r.errors.push(`ซ้ำกับแถวที่ ${dupe.row.rowIndex} ในไฟล์เดียวกัน (±60 วินาที)`);
      continue;
    }
    arr.push({ row: r, ts });
    byBranchAmount.set(k, arr);
    readyForDb.push(r);
  }

  if (readyForDb.length > 0) {
    const branchIds = [...new Set(readyForDb.map((r) => r.branchId!))];
    // 60-second dedup window · widen the SQL fetch by ±2 min to cover edge
    // cases (DST · clock skew) then compare exactly in JS.
    const allTs = readyForDb
      .map((r) => new Date(r.collectedAt! + "+07:00").getTime())
      .sort((a, b) => a - b);
    const minTs = allTs[0] - 2 * 60_000;
    const maxTs = allTs[allTs.length - 1] + 2 * 60_000;
    const candidates = await prisma.chairopsCashCollection.findMany({
      where: {
        orgId,
        branchId: { in: branchIds },
        collectedAt: { gte: new Date(minTs), lte: new Date(maxTs) },
      },
      select: {
        id: true,
        branchId: true,
        collectedAt: true,
        countedAmount: true,
      },
    });
    const buckets = new Map<string, typeof candidates>();
    for (const c of candidates) {
      const list = buckets.get(c.branchId) ?? [];
      list.push(c);
      buckets.set(c.branchId, list);
    }
    for (const r of readyForDb) {
      const list = buckets.get(r.branchId!) ?? [];
      const target = new Date(r.collectedAt! + "+07:00").getTime();
      const hit = list.find(
        (c) =>
          Math.abs(c.collectedAt.getTime() - target) <= 60_000 &&
          c.countedAmount === r.countedAmount,
      );
      if (hit) {
        r.kind = "dedup";
        r.dedupCollectionId = hit.id;
        r.errors.push(
          `มีรายการเก็บเงินสาขานี้เวลาเดียวกัน (${hit.collectedAt.toISOString().slice(0, 16).replace("T", " ")}) อยู่แล้ว`,
        );
      }
    }
  }

  const counts = {
    ready: 0,
    dedup: 0,
    invalid: 0,
    total: draftRows.length,
  };
  for (const r of draftRows) {
    if (r.kind === "ready") counts.ready += 1;
    else if (r.kind === "dedup") counts.dedup += 1;
    else counts.invalid += 1;
  }

  // We don't persist the preview in a DB row · the commit path will re-read
  // the payload from the client. Payload = JSON of preview rows (only the
  // "ready" subset is consumed by the commit; everything else is informational).
  const payload = JSON.stringify(
    draftRows.filter((r) => r.kind === "ready"),
  );
  // DEVIL-01 (2026-06-03) · HMAC over (orgId|userId|payload) so the client
  // cannot mutate amounts/timestamps between preview and commit.
  const payloadSig = signPayload(payload, session.user.id, orgId);

  return {
    ok: true,
    rows: draftRows,
    counts,
    payload,
    payloadSig,
  };
}

// ---------- commit action ---------------------------------------------------
// CommitResult / CommitResponse moved to ./types · see header.

/**
 * Server action consumed by the preview UI. Receives the `payload` string from
 * `previewMaidCsv` (only "ready" rows) and its HMAC signature. We refuse to
 * commit a payload whose signature doesn't verify against this user+org so
 * the client cannot mutate countedAmount / collectedAt / slipUrl in transit
 * (DEVIL-01 fix · 2026-06-03).
 */
export async function commitMaidCsv(
  payload: string,
  dedupSeen: number,
  payloadSig: string,
): Promise<CommitResponse> {
  const session = await requireRole("CEO");
  const orgId = session.user.orgId;

  // DEVIL-01 · refuse tampered payloads.
  if (!payloadSig || !verifyPayloadSig(payload, session.user.id, orgId, payloadSig)) {
    return {
      ok: false,
      error: "payload signature ไม่ถูกต้อง · กรุณาอ่านไฟล์ใหม่อีกครั้ง",
    };
  }

  let rows: PreviewRow[];
  try {
    const parsed: unknown = JSON.parse(payload);
    if (!Array.isArray(parsed)) throw new Error("payload not array");
    rows = parsed as PreviewRow[];
  } catch {
    return { ok: false, error: "payload เสีย · กรุณาอ่านไฟล์ใหม่" };
  }
  if (rows.length === 0) {
    return { ok: false, error: "ไม่มีแถวที่จะ commit (ทุกแถวเป็น dedup หรือ error)" };
  }

  // Re-validate ownership · every branchId + maidId must belong to this org.
  // Stops a forged payload from writing into another tenant's tables.
  const branchIds = [...new Set(rows.map((r) => r.branchId).filter((s): s is string => !!s))];
  const maidIds = [...new Set(rows.map((r) => r.maidId).filter((s): s is string => !!s))];
  // BA-04 (2026-06-03) · also rebuild the (branchId → assigned maid set) map
  // so we can refuse cross-branch attribution. The preview path resolves
  // branch+maid in three steps (phone → sole assignment → primaryBranchId);
  // commit must verify the final pair is internally consistent with the
  // CURRENT assignment table, not just same-org.
  const [branches, maids, assignments] = await Promise.all([
    prisma.chairopsBranch.findMany({
      where: { orgId, id: { in: branchIds } },
      select: { id: true },
    }),
    prisma.chairopsUser.findMany({
      where: { orgId, role: "MAID", id: { in: maidIds } },
      select: { id: true, primaryBranchId: true },
    }),
    prisma.chairopsMaidAssignment.findMany({
      where: { orgId, isActive: true, branchId: { in: branchIds } },
      select: { branchId: true, userId: true },
    }),
  ]);
  const validBranch = new Set(branches.map((b) => b.id));
  const validMaid = new Map(maids.map((m) => [m.id, m]));
  const assignedByBranch = new Map<string, Set<string>>();
  for (const a of assignments) {
    const s = assignedByBranch.get(a.branchId) ?? new Set();
    s.add(a.userId);
    assignedByBranch.set(a.branchId, s);
  }

  // SEC-02 · defense-in-depth · the payload was preview-validated but we
  // re-check slip URLs in case the JSON was tampered (sig also catches this).
  const rowsToWrite = rows.filter((r) => {
    if (
      !r.branchId ||
      !r.maidId ||
      !r.collectedAt ||
      r.countedAmount == null ||
      !validBranch.has(r.branchId)
    ) {
      return false;
    }
    if (r.slipUrl && !isAllowedPhotoUrl(r.slipUrl)) return false;
    // OFFICE_PROXY · the admin collected the cash themselves. maidId MUST be
    // the importing admin (sig already pins this, re-checked here) · no maid
    // assignment to verify. 2026-06-16.
    if (r.source === "OFFICE_PROXY") {
      return r.maidId === session.user.id;
    }
    // CSV_IMPORT · maid must be a real MAID of this org …
    if (!validMaid.has(r.maidId)) return false;
    // BA-04 · … AND assignment-consistent · either in this branch's active
    // assignment set OR have it as their primaryBranchId.
    const assigned = assignedByBranch.get(r.branchId);
    if (assigned && assigned.has(r.maidId)) return true;
    const maid = validMaid.get(r.maidId);
    if (maid?.primaryBranchId === r.branchId) return true;
    return false;
  });
  if (rowsToWrite.length === 0) {
    return {
      ok: false,
      error:
        "ทุกแถวไม่ผ่านการตรวจสอบ · เช็คว่าแม่บ้านผูกกับสาขาในไฟล์จริงหรือไม่ แล้ว preview อีกครั้ง",
    };
  }

  // BA-01 / QA-02 / DEVIL-01 (2026-06-03) · TOCTOU re-check.
  // Between preview and commit, another tab/admin could have inserted rows
  // that collide. Run the same ±60 s window query INSIDE the transaction
  // and filter out anything that already exists. Also let the DB partial
  // unique index (migration 20260603000000) catch any final race via
  // skipDuplicates: true.
  const committed = await prisma.$transaction(async (tx) => {
    const allTs = rowsToWrite
      .map((r) => new Date(r.collectedAt! + "+07:00").getTime())
      .sort((a, b) => a - b);
    const minTs = allTs[0] - 2 * 60_000;
    const maxTs = allTs[allTs.length - 1] + 2 * 60_000;
    const branchSet = [...new Set(rowsToWrite.map((r) => r.branchId!))];
    const collisions = await tx.chairopsCashCollection.findMany({
      where: {
        orgId,
        branchId: { in: branchSet },
        collectedAt: { gte: new Date(minTs), lte: new Date(maxTs) },
      },
      select: { branchId: true, collectedAt: true, countedAmount: true },
    });
    const collisionsByBranch = new Map<string, typeof collisions>();
    for (const c of collisions) {
      const arr = collisionsByBranch.get(c.branchId) ?? [];
      arr.push(c);
      collisionsByBranch.set(c.branchId, arr);
    }
    const finalRows = rowsToWrite.filter((r) => {
      const target = new Date(r.collectedAt! + "+07:00").getTime();
      const arr = collisionsByBranch.get(r.branchId!) ?? [];
      return !arr.some(
        (c) =>
          Math.abs(c.collectedAt.getTime() - target) <= 60_000 &&
          c.countedAmount === r.countedAmount,
      );
    });

    if (finalRows.length === 0) {
      return { count: 0, attempted: rowsToWrite.length };
    }

    const data = finalRows.map((r) => ({
      orgId,
      branchId: r.branchId!,
      maidId: r.maidId!,
      collectedAt: new Date(r.collectedAt! + "+07:00"),
      countedAmount: r.countedAmount!,
      depositedAmount: 0, // deposits live on ChairopsCashDeposit · this is legacy column
      // F1 (audit MISS-04) · CSV_IMPORT rows have no maid photo · DB CHECK
      // constraint enforces nullability of these two only when source != MAID_MANUAL.
      evidencePhotoUrl: null,
      imageHash: null,
      slipPhotoUrl: r.slipUrl ?? null,
      notes: r.notes ?? null,
      // Per-row provenance · OFFICE_PROXY when the admin collected it himself
      // (maidId = admin), CSV_IMPORT for a normal maid back-fill. 2026-06-16.
      source: r.source === "OFFICE_PROXY" ? ("OFFICE_PROXY" as const) : ("CSV_IMPORT" as const),
      importedById: session.user.id,
    }));

    // skipDuplicates:true so the DB partial unique index (migration
    // 20260603000000_chairops_csv_fk_and_dedup_index.sql) silently absorbs
    // any race that slipped past the in-transaction findMany above.
    const result = await tx.chairopsCashCollection.createMany({
      data,
      skipDuplicates: true,
    });
    return { count: result.count, attempted: rowsToWrite.length };
  });

  const skippedAtCommit = committed.attempted - committed.count;

  await writeAudit({
    userId: session.user.id,
    action: "cash_collection.csv_import_commit",
    entity: "CashCollection",
    entityId: "batch",
    orgId,
    newValue: {
      committed: committed.count,
      attempted: committed.attempted,
      skippedAtCommit,
      dedupSeen,
      branchIds,
      maidIds,
    },
    metadata: { route: "/chairops/import/maid-collections" },
  });

  revalidatePath("/chairops/import/maid-collections");
  revalidatePath("/chairops/collections");
  revalidatePath("/chairops/reconcile");
  revalidatePath("/chairops/write-offs");

  return {
    ok: true,
    committed: committed.count,
    dedup: dedupSeen,
    skippedAtCommit,
  };
}

// ---------- helpers ---------------------------------------------------------

function formatLocalIso(d: Date): string {
  // Return as "YYYY-MM-DD HH:mm" in Asia/Bangkok wall-clock to mirror input.
  const ms = d.getTime() + 7 * 3600_000;
  const utc = new Date(ms);
  const Y = utc.getUTCFullYear();
  const M = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const D = String(utc.getUTCDate()).padStart(2, "0");
  const h = String(utc.getUTCHours()).padStart(2, "0");
  const m = String(utc.getUTCMinutes()).padStart(2, "0");
  return `${Y}-${M}-${D} ${h}:${m}`;
}
