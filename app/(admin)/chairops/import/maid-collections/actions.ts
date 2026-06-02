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

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/chairops/auth/session";
import { writeAudit } from "@/lib/chairops/audit/log";

// ---------- CSV header contract ---------------------------------------------

export const CSV_HEADER = [
  "branchSlug",
  "collectedAt",
  "countedAmount",
  "maidPhone",
  "notes",
  "slipUrl",
] as const;

const HEADER_LINE = CSV_HEADER.join(",");

// ---------- types -----------------------------------------------------------

export type RowKind =
  | "ready" // will insert
  | "dedup" // exact-ish match exists → skip
  | "invalid"; // parse / validation failed

export interface PreviewRow {
  rowIndex: number; // 1-based after header
  branchSlug: string;
  collectedAt: string | null; // ISO "YYYY-MM-DD HH:mm"
  countedAmount: number | null;
  maidPhone: string | null;
  notes: string | null;
  slipUrl: string | null;
  branchId: string | null;
  branchName: string | null;
  maidId: string | null;
  maidLabel: string | null;
  /** Why this row is invalid · empty when kind != "invalid". */
  errors: string[];
  kind: RowKind;
  /** Set when kind === "dedup". */
  dedupCollectionId?: string;
}

export interface PreviewResult {
  ok: true;
  rows: PreviewRow[];
  counts: { ready: number; dedup: number; invalid: number; total: number };
  /** Serialized rows, ready to POST back to commitMaidCsv. */
  payload: string;
}

export type PreviewResponse = PreviewResult | { ok: false; error: string };

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
    return { ok: false, error: "ยังไม่ได้เลือกไฟล์ CSV" };
  }
  if (file.size === 0) return { ok: false, error: "ไฟล์ว่าง" };
  if (file.size > 5 * 1024 * 1024) {
    return { ok: false, error: "ไฟล์ใหญ่เกิน 5MB" };
  }

  let text: string;
  try {
    text = Buffer.from(await file.arrayBuffer()).toString("utf-8");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "อ่านไฟล์ไม่ออก";
    return { ok: false, error: `อ่านไฟล์ไม่สำเร็จ · ${msg}` };
  }

  const grid = parseCsv(text);
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
    const [slug, dateRaw, amtRaw, phoneRaw, notesRaw, slipRaw] = cells.map((c) =>
      c.trim(),
    );

    if (!slug) errors.push("ไม่มี branchSlug");
    const branch = slug ? branchBySlug.get(slug) ?? null : null;
    if (slug && !branch) errors.push(`ไม่พบสาขา slug="${slug}"`);

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

    // Maid resolution — phone first, then sole active assignment for the
    // branch, then primaryBranchId fallback.
    let maidId: string | null = null;
    let maidLabel: string | null = null;
    if (branch) {
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
          "หาแม่บ้านไม่เจอ · ใส่ maidPhone ที่ตรงในไฟล์ หรือผูกแม่บ้านกับสาขานี้เพียงคนเดียว",
        );
      }
    }

    draftRows.push({
      rowIndex: i,
      branchSlug: slug,
      collectedAt: collectedAt ? formatLocalIso(collectedAt) : null,
      countedAmount,
      maidPhone: phoneRaw || null,
      notes: notesRaw || null,
      slipUrl: slipRaw || null,
      branchId: branch?.id ?? null,
      branchName: branch?.name ?? null,
      maidId,
      maidLabel,
      errors,
      kind: errors.length > 0 ? "invalid" : "ready",
    });
  }

  // Pass 2 · dedup within the batch and against existing rows. Two rows match
  // when (branchId, |collectedAt diff| ≤ 60s, countedAmount) all align. We
  // resolve in two steps:
  //  (a) collapse intra-batch dupes — second occurrence flagged as dedup.
  //  (b) check DB for any existing collection within ±60s of the row's stamp.
  const readyForDb: PreviewRow[] = [];
  const seen = new Map<string, number>(); // key→rowIndex of first occurrence
  for (const r of draftRows) {
    if (r.kind !== "ready" || !r.branchId || !r.collectedAt || r.countedAmount == null) {
      continue;
    }
    const key = `${r.branchId}|${r.countedAmount}|${Math.floor(
      new Date(r.collectedAt + "+07:00").getTime() / 60000,
    )}`;
    const first = seen.get(key);
    if (first !== undefined) {
      r.kind = "dedup";
      r.errors.push(`ซ้ำกับแถวที่ ${first} ในไฟล์เดียวกัน`);
      continue;
    }
    seen.set(key, r.rowIndex);
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

  return {
    ok: true,
    rows: draftRows,
    counts,
    payload,
  };
}

// ---------- commit action ---------------------------------------------------

export interface CommitResult {
  ok: true;
  committed: number;
  dedup: number;
}

export type CommitResponse = CommitResult | { ok: false; error: string };

/**
 * Server action consumed by the preview UI. Receives the `payload` string from
 * `previewMaidCsv` (only "ready" rows) and the original dedup count for the
 * audit log. We re-validate the payload defensively before writing.
 */
export async function commitMaidCsv(
  payload: string,
  dedupSeen: number,
): Promise<CommitResponse> {
  const session = await requireRole("CEO");
  const orgId = session.user.orgId;

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
  const [branches, maids] = await Promise.all([
    prisma.chairopsBranch.findMany({
      where: { orgId, id: { in: branchIds } },
      select: { id: true },
    }),
    prisma.chairopsUser.findMany({
      where: { orgId, role: "MAID", id: { in: maidIds } },
      select: { id: true },
    }),
  ]);
  const validBranch = new Set(branches.map((b) => b.id));
  const validMaid = new Set(maids.map((m) => m.id));

  const rowsToWrite = rows.filter(
    (r) =>
      r.branchId &&
      r.maidId &&
      r.collectedAt &&
      r.countedAmount != null &&
      validBranch.has(r.branchId) &&
      validMaid.has(r.maidId),
  );
  if (rowsToWrite.length === 0) {
    return { ok: false, error: "ทุกแถวอ้างถึงสาขา/แม่บ้านที่ไม่อยู่ในองค์กรนี้" };
  }

  const data = rowsToWrite.map((r) => ({
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
    source: "CSV_IMPORT" as const,
    importedById: session.user.id,
  }));

  // No multi-row write needs to be atomic with anything else here · drift /
  // alerts run separately on the reconcile cron. createMany is enough.
  const result = await prisma.chairopsCashCollection.createMany({
    data,
    skipDuplicates: false,
  });

  await writeAudit({
    userId: session.user.id,
    action: "cash_collection.csv_import_commit",
    entity: "CashCollection",
    entityId: "batch",
    orgId,
    newValue: {
      committed: result.count,
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
    committed: result.count,
    dedup: dedupSeen,
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
