"use server";

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

      const ing = await ingestEvents(prisma, orgId, imp.id, kind, diff.rows);
      if (kind === "cash") {
        result.cashInserted = ing.insertedCount;
        result.cashSkipped = ing.skippedCount + diff.summary.dupCount;
      } else {
        result.coinInserted = ing.insertedCount;
        result.coinSkipped = ing.skippedCount + diff.summary.dupCount;
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
