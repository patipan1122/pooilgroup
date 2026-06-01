"use server";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { revalidatePath } from "next/cache";

// Multi-file POS upload (Plan B) — accepts up to 3 StarThing files in one go:
//   • daily  (ยอดรวม + เงินโอน)   → reuses the proven previewImport/commitImport flow
//   • cash   (เงินสด · timestamped) → new event pipeline w/ row-level dedup
//   • coin   (เหรียญ · timestamped) → new event pipeline w/ row-level dedup
//
// Design: files stay in the browser between preview and commit, so we re-parse
// on commit instead of persisting parsed rows. Dedup is idempotent (rowHash +
// skipDuplicates), so a re-upload of overlapping ranges is a no-op.
// Per [[pool-csv-import-must-diff-before-write]] — every file shows new/dup
// buckets BEFORE writing. Per the cross-org leaks fixed this session — orgId
// scopes every query + write.

import { createHash } from "crypto";
import type { Prisma } from "@/lib/generated/prisma/client";
import { requireRole } from "@/lib/chairops/auth/session";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/chairops/audit/log";
import { recomputeAllDrifts } from "@/lib/chairops/reconcile/drift-engine";
import { evaluateAndEmitAlerts } from "@/lib/chairops/reconcile/alerts";
import {
  detectFileType,
  readHeaders,
  parseCashEvents,
  parseCoinEvents,
  type EventKind,
} from "@/lib/chairops/pos-ingest/starthing-events";
import {
  computeEventDiff,
  ingestEvents,
  type EventDiffSummary,
} from "@/lib/chairops/pos-ingest/event-diff";

const MAX_BYTES = 10 * 1024 * 1024;

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

async function readFile(
  fd: FormData,
  field: string,
): Promise<{ name: string; buf: Buffer } | null> {
  const f = fd.get(field);
  if (!(f instanceof File) || f.size === 0) return null;
  if (f.size > MAX_BYTES) throw new Error(`ไฟล์ ${f.name} ใหญ่เกิน 10MB`);
  return { name: f.name, buf: Buffer.from(await f.arrayBuffer()) };
}

export interface MultiPreviewResult {
  cash: (EventDiffSummary & { fileName: string }) | null;
  coin: (EventDiffSummary & { fileName: string }) | null;
  /** detected-type warnings (file dropped in wrong slot) */
  warnings: string[];
  errors: string[];
}

// ---------------------------------------------------------------------------
// Preview — parse cash/coin, compute dedup diff. No DB writes.
// ---------------------------------------------------------------------------
export async function previewMultiImport(
  formData: FormData,
): Promise<MultiPreviewResult> {
  const session = await requireRole("OFFICE");
  const orgId = session.user.orgId;
  const warnings: string[] = [];
  const errors: string[] = [];

  const out: MultiPreviewResult = { cash: null, coin: null, warnings, errors };

  for (const [field, kind] of [
    ["cashFile", "cash"],
    ["coinFile", "coin"],
  ] as const) {
    let file: { name: string; buf: Buffer } | null;
    try {
      file = await readFile(formData, field);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
      continue;
    }
    if (!file) continue;

    // Verify the file actually matches its slot.
    const detected = detectFileType(readHeaders(file.buf).headers);
    if (detected !== kind) {
      warnings.push(
        `ไฟล์ "${file.name}" ดูเหมือนเป็น "${detected}" แต่วางในช่อง "${kind}" — ระบบจะอ่านตามชนิดจริง (${detected})`,
      );
    }

    try {
      const parsed = kind === "cash" ? parseCashEvents(file.buf) : parseCoinEvents(file.buf);
      const diff = await computeEventDiff(
        prisma,
        orgId,
        parsed.parsedRows,
        kind as EventKind,
        parsed.errors.length,
      );
      out[kind] = { ...diff.summary, fileName: file.name };
    } catch (e) {
      errors.push(`อ่านไฟล์ ${file.name} ไม่สำเร็จ · ${e instanceof Error ? e.message : ""}`);
    }
  }

  return out;
}

export interface MultiCommitResult {
  ok: boolean;
  cashInserted: number;
  cashSkipped: number;
  coinInserted: number;
  coinSkipped: number;
  /** 2026-06-01 · only set when the caller passed skipOverflowingCoinRows
   *  and at least one coin row exceeded the int4 ceiling. CEO needs to see
   *  this to know they're losing data until the migration runs. */
  coinOverflowingSkipped?: number;
  /** Latest bizDate (YYYY-MM-DD) now covered across the uploaded files — so the
   * operator knows "data is now up to date X" (CEO ask 2026-05-28). */
  coverageThrough: string | null;
  error?: string;
}

// ---------------------------------------------------------------------------
// Commit — re-parse, create one import per event file, ingest NEW rows only.
// ---------------------------------------------------------------------------
export async function commitMultiImport(
  formData: FormData,
): Promise<MultiCommitResult> {
  const session = await requireRole("OFFICE");
  const orgId = session.user.orgId;
  const notes = typeof formData.get("notes") === "string" ? (formData.get("notes") as string) : null;
  // 2026-06-01: optional flag for the "commit without migration" fallback.
  const skipOverflowingCoinRows =
    formData.get("skipOverflowingCoinRows") === "1";

  const result: MultiCommitResult = {
    ok: true,
    cashInserted: 0,
    cashSkipped: 0,
    coinInserted: 0,
    coinSkipped: 0,
    coverageThrough: null,
  };

  try {
    for (const [field, kind] of [
      ["cashFile", "cash"],
      ["coinFile", "coin"],
    ] as const) {
      const file = await readFile(formData, field);
      if (!file) continue;

      const parsed = kind === "cash" ? parseCashEvents(file.buf) : parseCoinEvents(file.buf);
      const diff = await computeEventDiff(prisma, orgId, parsed.parsedRows, kind, parsed.errors.length);

      // Track the latest date this upload covers (max across files).
      if (diff.summary.dateRange?.to) {
        if (!result.coverageThrough || diff.summary.dateRange.to > result.coverageThrough) {
          result.coverageThrough = diff.summary.dateRange.to;
        }
      }

      // One import row per event file (fileHash dedup · unique per org).
      const fileHash = sha256(file.buf);
      const existing = await prisma.chairopsPosImport.findUnique({
        where: { orgId_fileHash: { orgId, fileHash } },
      });
      const imp =
        existing ??
        (await prisma.chairopsPosImport.create({
          data: {
            orgId,
            filename: file.name,
            uploadedById: session.user.id,
            fileHash,
            rowCount: parsed.totalRows,
            diffSummary: {
              kind,
              newCount: diff.summary.newCount,
              dupCount: diff.summary.dupCount,
              dateRange: diff.summary.dateRange,
            },
            committed: true,
            committedAt: new Date(),
            notes,
          },
        }));

      const ing = await ingestEvents(prisma, orgId, imp.id, kind, diff.rows, {
        skipOverflowingCoinRows,
      });
      if (kind === "cash") {
        result.cashInserted = ing.insertedCount;
        result.cashSkipped = ing.skippedCount + diff.summary.dupCount;
      } else {
        result.coinInserted = ing.insertedCount;
        result.coinSkipped = ing.skippedCount + diff.summary.dupCount;
        if (ing.overflowingSkippedCount) {
          result.coinOverflowingSkipped =
            (result.coinOverflowingSkipped ?? 0) + ing.overflowingSkippedCount;
        }
      }

      await writeAudit({
        userId: session.user.id,
        action: "pos.ingest_events",
        entity: "ChairopsPosImport",
        entityId: imp.id,
        metadata: {
          kind,
          inserted: ing.insertedCount,
          duplicatesSkipped: diff.summary.dupCount,
          dateRange: diff.summary.dateRange,
        },
      });
    }

    // Refresh drift + alerts for this org only (org-scoped per session fix).
    if (result.cashInserted > 0 || result.coinInserted > 0) {
      await recomputeAllDrifts(orgId);
      await evaluateAndEmitAlerts(orgId);
    }
  } catch (e) {
    return { ...result, ok: false, error: e instanceof Error ? e.message : "commit failed" };
  }

  return result;
}

// ---------------------------------------------------------------------------
// Smart batch — CEO 2026-06-01: ONE dropzone for ALL 3 StarThing files.
// Server auto-detects type per file and routes accordingly:
//   - daily  → reuses previewImport (creates a ChairopsPosImport row)
//   - cash   → reuses event preview path (in-memory diff, no row yet)
//   - coin   → same
// Returns a per-file result so the UI can render each row independently.
// ---------------------------------------------------------------------------

export type BatchPreviewItem =
  | {
      ok: true;
      fileName: string;
      kind: "daily";
      importId: string;
    }
  | {
      ok: true;
      fileName: string;
      kind: "cash" | "coin";
      preview: EventDiffSummary;
    }
  | {
      ok: false;
      fileName: string;
      kind: "daily" | "cash" | "coin" | "unknown";
      error: string;
    };

export interface BatchPreviewResult {
  items: BatchPreviewItem[];
}

export async function previewBatchSmart(
  formData: FormData,
): Promise<BatchPreviewResult> {
  // Auth only · the underlying previewImport / previewMultiImport calls each
  // scope by their own session.user.orgId, so we don't need to thread it here.
  await requireRole("OFFICE");

  // Collect all files from the form (any field key starting with "file").
  const files: Array<{ name: string; buf: Buffer }> = [];
  for (const [key, val] of formData.entries()) {
    if (!key.startsWith("file")) continue;
    if (!(val instanceof File) || val.size === 0) continue;
    if (val.size > MAX_BYTES) {
      // Push as error item rather than throwing — other files still try.
      files.push({ name: val.name, buf: Buffer.alloc(0) });
      continue;
    }
    files.push({ name: val.name, buf: Buffer.from(await val.arrayBuffer()) });
  }

  const items: BatchPreviewItem[] = [];

  // Pre-detect each file's kind from headers · in parallel where possible.
  // Also remember the raw header row · we surface it in the error message for
  // "unknown" files so the operator (or the next dev) can see exactly what
  // StarThing exported instead of guessing.
  type Pre = {
    name: string;
    buf: Buffer;
    kind: "daily" | "cash" | "coin" | "unknown";
    rawHeaders: string[];
  };
  const pre: Pre[] = files.map((f) => {
    if (f.buf.length === 0) {
      return { name: f.name, buf: f.buf, kind: "unknown" as const, rawHeaders: [] };
    }
    try {
      const { headers } = readHeaders(f.buf);
      const detected = detectFileType(headers);
      return { name: f.name, buf: f.buf, kind: detected, rawHeaders: headers };
    } catch {
      return { name: f.name, buf: f.buf, kind: "unknown" as const, rawHeaders: [] };
    }
  });

  // Process cash + coin together via the proven multi-preview path so dedup
  // diff shares the same code path the existing UI uses on commit.
  const cashFile = pre.find((p) => p.kind === "cash");
  const coinFile = pre.find((p) => p.kind === "coin");
  if (cashFile || coinFile) {
    const fd = new FormData();
    // Buffer wrap: Node Buffer reports its underlying buffer as
    // ArrayBufferLike (potentially SharedArrayBuffer) which Blob/File reject.
    // Copying through a fresh Uint8Array guarantees a plain ArrayBuffer.
    if (cashFile)
      fd.set("cashFile", new File([new Uint8Array(cashFile.buf)], cashFile.name));
    if (coinFile)
      fd.set("coinFile", new File([new Uint8Array(coinFile.buf)], coinFile.name));
    const r = await previewMultiImport(fd);
    if (cashFile) {
      if (r.cash) {
        items.push({ ok: true, fileName: cashFile.name, kind: "cash", preview: r.cash });
      } else {
        items.push({
          ok: false,
          fileName: cashFile.name,
          kind: "cash",
          error: r.errors[0] ?? "อ่านไฟล์ cash ไม่สำเร็จ",
        });
      }
    }
    if (coinFile) {
      if (r.coin) {
        items.push({ ok: true, fileName: coinFile.name, kind: "coin", preview: r.coin });
      } else {
        items.push({
          ok: false,
          fileName: coinFile.name,
          kind: "coin",
          error: r.errors[0] ?? "อ่านไฟล์ coin ไม่สำเร็จ",
        });
      }
    }
  }

  // Daily files go through previewImport one-by-one. We do them sequentially
  // because each writes a ChairopsPosImport row and the dedup-by-hash unique
  // index would race on identical files. Different files = no contention.
  // Import previewImport lazily to avoid a hard cycle with actions.ts.
  const { previewImport } = await import("./actions");
  for (const p of pre) {
    if (p.kind !== "daily") continue;
    const fd = new FormData();
    fd.set("file", new File([new Uint8Array(p.buf)], p.name));
    const r = await previewImport(fd);
    if (r.ok) {
      items.push({ ok: true, fileName: p.name, kind: "daily", importId: r.importId });
    } else {
      items.push({ ok: false, fileName: p.name, kind: "daily", error: r.error });
    }
  }

  // Report unknown files last so the user sees the successes first.
  for (const p of pre) {
    if (p.kind !== "unknown") continue;
    const headerPreview =
      p.rawHeaders.length > 0
        ? ` · headers ที่อ่าน: ${p.rawHeaders
            .filter((h) => h && h.trim())
            .slice(0, 12)
            .join(", ")}`
        : "";
    items.push({
      ok: false,
      fileName: p.name,
      kind: "unknown",
      error:
        p.buf.length === 0
          ? "ไฟล์ว่างหรือใหญ่เกิน 10MB"
          : `ไม่รู้จักชนิดไฟล์ · ต้องเป็น StarThing daily / cash / coin XLSX${headerPreview}`,
    });
  }

  return { items };
}

// ---------------------------------------------------------------------------
// Latest-data sniff for the 3 type cards on /pos-ingest landing.
// "Latest data" = newest timestamp INSIDE the data · "Last upload" = newest
// uploadedAt of the import row that ingested into the same bucket.
// ---------------------------------------------------------------------------

export interface LatestPerType {
  daily: {
    latestDate: string | null;   // YYYY-MM-DD inside data
    lastUploadAt: Date | null;   // when an admin pushed a daily file
    lastUploadName: string | null;
  };
  cash: {
    latestEventAt: Date | null;  // newest cash event timestamp
    lastUploadAt: Date | null;
    lastUploadName: string | null;
  };
  coin: {
    latestEventAt: Date | null;
    lastUploadAt: Date | null;
    lastUploadName: string | null;
  };
}

export async function getStarThingLatest(orgId: string): Promise<LatestPerType> {
  const [dailyRow, cashRow, coinRow, dailyImport, cashImport, coinImport] =
    await Promise.all([
      prisma.chairopsBranchDailyRevenue.findFirst({
        where: { orgId },
        orderBy: { bizDate: "desc" },
        select: { bizDate: true },
      }),
      prisma.chairopsPosCashEvent.findFirst({
        where: { orgId },
        orderBy: { eventAt: "desc" },
        select: { eventAt: true },
      }),
      prisma.chairopsPosCoinEvent.findFirst({
        where: { orgId },
        orderBy: { eventAt: "desc" },
        select: { eventAt: true },
      }),
      // Daily uploads: import rows whose diffSummary has starThing (sources
      // ChairopsBranchDailyRevenue · only daily-summary files produce that).
      prisma.chairopsPosImport.findFirst({
        where: {
          orgId,
          committed: true,
          dailyRevenue: { some: {} },
        },
        orderBy: { uploadedAt: "desc" },
        select: { filename: true, uploadedAt: true },
      }),
      // Cash uploads: kind="cash" stored in diffSummary by commitMultiImport.
      prisma.chairopsPosImport.findFirst({
        where: { orgId, committed: true, cashEvents: { some: {} } },
        orderBy: { uploadedAt: "desc" },
        select: { filename: true, uploadedAt: true },
      }),
      prisma.chairopsPosImport.findFirst({
        where: { orgId, committed: true, coinEvents: { some: {} } },
        orderBy: { uploadedAt: "desc" },
        select: { filename: true, uploadedAt: true },
      }),
    ]);

  return {
    daily: {
      latestDate: dailyRow ? dailyRow.bizDate.toISOString().slice(0, 10) : null,
      lastUploadAt: dailyImport?.uploadedAt ?? null,
      lastUploadName: dailyImport?.filename ?? null,
    },
    cash: {
      latestEventAt: cashRow?.eventAt ?? null,
      lastUploadAt: cashImport?.uploadedAt ?? null,
      lastUploadName: cashImport?.filename ?? null,
    },
    coin: {
      latestEventAt: coinRow?.eventAt ?? null,
      lastUploadAt: coinImport?.uploadedAt ?? null,
      lastUploadName: coinImport?.filename ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// One-click migration runner — CEO 2026-06-01
//
// Mirror of scripts/apply-clawfleet-v2-migration.ts but triggered from the
// in-page rose banner. Lets the CEO unblock the BIGINT migration without
// leaving the browser. STRICT whitelist by filename — only migrations the
// product has shipped can be run; no arbitrary SQL execution.
//
// Auth: OFFICE+ (same gate as commit). Role-tier guard matches the rest of
// pos-ingest write actions.
// ---------------------------------------------------------------------------

const RUNNABLE_MIGRATIONS: Record<string, { description: string }> = {
  "20260601_coin_event_bigint": {
    description: "coin event counters Int → BigInt (4.29B overflow fix)",
  },
};

export interface RunMigrationResult {
  ok: boolean;
  migrationName: string;
  description?: string;
  error?: string;
}

export async function runPosIngestMigration(
  migrationName: string,
): Promise<RunMigrationResult> {
  await requireRole("OFFICE");

  const meta = RUNNABLE_MIGRATIONS[migrationName];
  if (!meta) {
    return {
      ok: false,
      migrationName,
      error: `migration ${migrationName} ไม่อยู่ใน whitelist · ห้ามรัน`,
    };
  }

  let sql: string;
  try {
    sql = readFileSync(
      join(process.cwd(), "prisma", "migrations", `${migrationName}.sql`),
      "utf8",
    );
  } catch (e) {
    return {
      ok: false,
      migrationName,
      error: `อ่านไฟล์ migration ไม่สำเร็จ · ${
        e instanceof Error ? e.message : String(e)
      }`,
    };
  }

  try {
    // Strip line comments + split on `;` so we can call executeRawUnsafe
    // statement-by-statement (Prisma rejects multi-statement strings).
    const stripped = sql
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    const statements = stripped
      .split(/;\s*(?:\n|$)/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const stmt of statements) {
      await prisma.$executeRawUnsafe(stmt);
    }

    // 2026-06-01 · verify the effect, not just "no exception thrown". For
    // the BIGINT migration we look up coinMeter's actual column type after
    // running the ALTER; if it didn't flip we surface that to the caller.
    let verification: string | undefined;
    if (migrationName === "20260601_coin_event_bigint") {
      const rows = await prisma.$queryRaw<Array<{ data_type: string }>>`
        SELECT data_type
        FROM information_schema.columns
        WHERE table_schema = 'chairops'
          AND table_name = 'chairops_pos_coin_event'
          AND column_name = 'coinMeter'
        LIMIT 1
      `;
      const dt = (rows[0]?.data_type ?? "unknown").toLowerCase();
      if (dt !== "bigint") {
        return {
          ok: false,
          migrationName,
          error: `ALTER ran without throwing, but coinMeter is still ${dt} (expected bigint). ` +
            `กรุณา paste SQL ทำมือใน Supabase SQL Editor.`,
        };
      }
      verification = `coinMeter is now ${dt}`;
    }

    return {
      ok: true,
      migrationName,
      description:
        meta.description + (verification ? ` · verified: ${verification}` : ""),
    };
  } catch (e) {
    return {
      ok: false,
      migrationName,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ---------------------------------------------------------------------------
// addBranchFromStarThing — CEO 2026-06-01
//
// One-click branch creation from a storeName that appeared in a StarThing
// upload but doesn't yet exist as ChairopsBranch. Used by the preview page
// to resolve "ระบุสาขาไม่ได้" rows without leaving the import context.
//
// Per `[[pool-csv-import-must-diff-before-write]]` we still NEVER auto-create
// branches as a side-effect of an upload — this is an explicit, audited,
// CEO-confirmed action. After creating the branch the caller re-runs preview
// (revalidatePath) and rows that match the new storeName flip from "bad" to
// "new" naturally on the next render.
// ---------------------------------------------------------------------------

function toBranchSlug(name: string): string {
  // Latin-letter + digit slug · keep Thai chars by URI-encoding them, then
  // strip the percent signs · 30 char cap to stay readable.
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[\s฀-๿]+/g, "-")
    .replace(/[^a-z0-9-]+/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (base.length > 0) return base.slice(0, 30);
  // Pure-Thai names → hash the name into a stable short id.
  return (
    "br-" +
    Array.from(name)
      .reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)
      .toString(36)
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 8)
  );
}

export interface AddBranchFromStarThingResult {
  ok: boolean;
  branch?: { id: string; name: string; slug: string };
  error?: string;
}

export async function addBranchFromStarThing(
  storeName: string,
): Promise<AddBranchFromStarThingResult> {
  const session = await requireRole("OFFICE");
  const orgId = session.user.orgId;
  const trimmed = storeName.trim();
  if (!trimmed) return { ok: false, error: "storeName ว่าง" };
  if (trimmed.length > 100)
    return { ok: false, error: "ชื่อสาขายาวเกิน 100 ตัวอักษร" };

  // Idempotent: if a branch with this exact name already exists, return it.
  const existing = await prisma.chairopsBranch.findFirst({
    where: { orgId, name: trimmed },
    select: { id: true, name: true, slug: true },
  });
  if (existing) return { ok: true, branch: existing };

  let slug = toBranchSlug(trimmed);
  // Suffix-collide on slug if needed (org-scoped).
  for (let i = 0; i < 20; i++) {
    const collision = await prisma.chairopsBranch.findFirst({
      where: { orgId, slug },
      select: { id: true },
    });
    if (!collision) break;
    slug = `${toBranchSlug(trimmed)}-${i + 2}`;
  }

  const branch = await prisma.chairopsBranch.create({
    data: {
      orgId,
      slug,
      name: trimmed,
      tabName: trimmed,
      isActive: true,
    },
    select: { id: true, name: true, slug: true },
  });

  await writeAudit({
    userId: session.user.id,
    action: "branch.create_from_starthing",
    entity: "ChairopsBranch",
    entityId: branch.id,
    newValue: { name: branch.name, slug: branch.slug, source: "pos-ingest" },
  });

  // 2026-06-01 follow-up · CEO reported "กดเพิ่มสาขาแล้ว error ไม่หาย".
  // Root cause: each ChairopsPosImport row holds its parse + diff snapshot
  // in diffSummary JSON at upload time. Creating the branch fixes the
  // ChairopsBranch table but never re-runs row resolution, so the preview
  // still shows the old "ระบุสาขาไม่ได้" rows.
  //
  // Fix: walk pending (uncommitted) imports for this org whose diffSummary
  // flags this storeName as unknown, and patch the JSON in place:
  //   • each row with shopName === trimmed → status flips from "error" →
  //     "new", branchId = branch.id, branchName = branch.name, the
  //     "ระบุสาขาไม่ได้" error message gets stripped from row.errors
  //   • counts adjust: error -= N, new += N
  //   • starThing.knownBranchEntries gains the new entry; storeName
  //     removed from starThing.unknownBranches
  //   • if any row that DID parse a valid bizDate, the daily-summary
  //     aggregate (per branch × date) gets resolved via storeName lookup
  //     at commit time — nothing extra to do here.
  type PartialDiffRow = {
    status: string;
    shopName?: string | null;
    branchId?: string | null;
    branchName?: string | null;
    errors?: string[];
  };
  type PartialDiff = {
    rows?: PartialDiffRow[];
    counts?: { new?: number; same?: number; changed?: number; error?: number };
    starThing?: {
      unknownBranches?: string[];
      knownBranchEntries?: Array<[string, string]>;
    } | null;
  };

  const pendingImports = await prisma.chairopsPosImport.findMany({
    where: { orgId, committed: false },
    select: { id: true, diffSummary: true },
  });

  let touchedImports = 0;
  let touchedRows = 0;
  for (const imp of pendingImports) {
    const diff = imp.diffSummary as unknown as PartialDiff | null;
    if (!diff || !Array.isArray(diff.rows)) continue;

    // Quick skip — only patch imports that actually flagged THIS storeName.
    const flagsThis =
      diff.starThing?.unknownBranches?.includes(trimmed) ??
      diff.rows.some(
        (r) =>
          r.status === "error" &&
          (r.shopName ?? "").trim() === trimmed,
      );
    if (!flagsThis) continue;

    let rowsPatched = 0;
    for (const r of diff.rows) {
      if (r.status !== "error") continue;
      if ((r.shopName ?? "").trim() !== trimmed) continue;
      r.status = "new";
      r.branchId = branch.id;
      r.branchName = branch.name;
      if (Array.isArray(r.errors)) {
        r.errors = r.errors.filter((e) => !/สาขา|ระบุสาขา/.test(e));
      }
      rowsPatched += 1;
    }
    if (rowsPatched === 0) continue;

    if (diff.counts) {
      diff.counts.error = Math.max(0, (diff.counts.error ?? 0) - rowsPatched);
      diff.counts.new = (diff.counts.new ?? 0) + rowsPatched;
    }
    if (diff.starThing) {
      if (Array.isArray(diff.starThing.unknownBranches)) {
        diff.starThing.unknownBranches = diff.starThing.unknownBranches.filter(
          (n) => n !== trimmed,
        );
      }
      if (Array.isArray(diff.starThing.knownBranchEntries)) {
        diff.starThing.knownBranchEntries.push([trimmed, branch.id]);
      } else {
        diff.starThing.knownBranchEntries = [[trimmed, branch.id]];
      }
    }

    await prisma.chairopsPosImport.update({
      where: { id: imp.id },
      data: { diffSummary: diff as unknown as Prisma.InputJsonValue },
    });
    touchedImports += 1;
    touchedRows += rowsPatched;
  }

  if (touchedImports > 0) {
    await writeAudit({
      userId: session.user.id,
      action: "pos_import.reresolve_after_branch_create",
      entity: "ChairopsBranch",
      entityId: branch.id,
      metadata: {
        storeName: trimmed,
        touchedImports,
        touchedRows,
      },
    });
  }

  revalidatePath("/chairops/pos-ingest");
  revalidatePath(`/chairops/branches`);
  return { ok: true, branch };
}
