// StarThing POS EVENT dedup + validation preview + ingest (Plan B)
//
// CEO #1 requirement: ROW-LEVEL DEDUP + validation preview. The CEO re-uploads
// overlapping date ranges and must NOT double-count. We classify every parsed
// row as new / duplicate (in-DB) / intra-file-duplicate (same rowHash twice in
// the uploaded file), then surface continuity + completeness warnings, and on
// ingest insert ONLY new rows (createMany skipDuplicates as a unique-index safety net).
//
// All queries are orgId-scoped (multi-tenant — per the cross-org leaks fixed
// this session). Branch resolution = exact-match `ChairopsBranch.name` · NEVER
// auto-create (per `[[pool-csv-import-must-diff-before-write]]`).

import type { PrismaClient, Prisma } from "@/lib/generated/prisma/client";
import type { EventKind, ParsedEventRow } from "./starthing-events";

// ---------------------------------------------------------------------------
// Types — the diff-summary shape the UI is built against
// ---------------------------------------------------------------------------

export interface PerBranchEventSummary {
  /** raw storeName from the file */
  storeName: string;
  /** resolved ChairopsBranch.id · null if unmatched */
  branchId: string | null;
  /** ChairopsBranch.name · null if unmatched */
  branchName: string | null;
  newCount: number;
  dupCount: number;
  intraDupCount: number;
  /** ISO of the earliest event for this branch in the file */
  firstEventAt: string | null;
  /** ISO of the latest event for this branch in the file */
  lastEventAt: string | null;
  /** ISO of the latest event already in DB for this branch (before this file) */
  lastExistingEventAt: string | null;
  /** true when there is a > 24h gap between DB's last event and this file's first */
  gapWarning: boolean;
}

export interface EventDiffSummary {
  kind: EventKind;
  totalRows: number;
  newCount: number;
  dupCount: number;
  intraDupCount: number;
  unmatchedBranchCount: number;
  /** rows dropped during parse (bad/missing timestamp etc) — passed through from parser */
  badRowCount: number;
  dateRange: { from: string; to: string } | null;
  perBranch: PerBranchEventSummary[];
  /** false when ANY branch has a gapWarning */
  continuityOk: boolean;
  /** storeName values not matching any ChairopsBranch.name */
  unmatchedBranches: string[];
}

/** One row tagged with its dedup bucket + resolved branch — what ingestEvents consumes. */
export interface ClassifiedEventRow extends ParsedEventRow {
  bucket: "new" | "duplicate" | "intra-duplicate";
  branchId: string | null;
}

export interface EventDiffResult {
  summary: EventDiffSummary;
  /** every parsed row, classified — UI may show a sample; ingest filters to bucket==="new" */
  rows: ClassifiedEventRow[];
}

const GAP_THRESHOLD_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// computeEventDiff — read DB, bucket each parsed row
// ---------------------------------------------------------------------------

/**
 * Classify parsed event rows against the DB + within the file itself.
 *
 * @param prisma      Prisma client (or tx client)
 * @param orgId       tenant — applied to EVERY query
 * @param parsedRows  output of parseCashEvents / parseCoinEvents `.parsedRows`
 * @param kind        "cash" | "coin" → selects the right table
 * @param badRowCount parser-reported error rows (for the completeness summary)
 */
export async function computeEventDiff(
  prisma: PrismaClient,
  orgId: string,
  parsedRows: ParsedEventRow[],
  kind: EventKind,
  badRowCount = 0,
): Promise<EventDiffResult> {
  // 1) Resolve storeName → branchId via exact-match ChairopsBranch.name (never auto-create).
  const uniqueStores = Array.from(new Set(parsedRows.map((r) => r.storeName)));
  const branches = uniqueStores.length
    ? await prisma.chairopsBranch.findMany({
        where: { orgId, name: { in: uniqueStores } },
        select: { id: true, name: true },
      })
    : [];
  const branchIdByName = new Map<string, string>();
  const branchNameById = new Map<string, string>();
  for (const b of branches) {
    branchIdByName.set(b.name, b.id);
    branchNameById.set(b.id, b.name);
  }

  // 2) Existing rowHashes for this org (batched IN query so we don't pull the whole table).
  const allHashes = Array.from(new Set(parsedRows.map((r) => r.rowHash)));
  const existingHashes = await fetchExistingHashes(prisma, orgId, kind, allHashes);

  // 3) Last existing eventAt per branch (for continuity gap detection).
  const matchedBranchIds = Array.from(branchNameById.keys());
  const lastExistingByBranch = await fetchLastExistingEventAt(
    prisma,
    orgId,
    kind,
    matchedBranchIds,
  );

  // 4) Bucket each row: duplicate (in DB) > intra-duplicate (seen earlier in file) > new.
  const seenInFile = new Set<string>();
  const rows: ClassifiedEventRow[] = [];
  for (const r of parsedRows) {
    const branchId = branchIdByName.get(r.storeName) ?? null;
    let bucket: ClassifiedEventRow["bucket"];
    if (existingHashes.has(r.rowHash)) {
      bucket = "duplicate";
    } else if (seenInFile.has(r.rowHash)) {
      bucket = "intra-duplicate";
    } else {
      bucket = "new";
      seenInFile.add(r.rowHash);
    }
    rows.push({ ...r, bucket, branchId });
  }

  // 5) Aggregate per-branch + global counters.
  const perBranchMap = new Map<string, PerBranchEventSummary>();
  let newCount = 0;
  let dupCount = 0;
  let intraDupCount = 0;
  let unmatchedBranchCount = 0;
  let minDate: string | null = null;
  let maxDate: string | null = null;

  for (const r of rows) {
    if (r.bucket === "new") newCount++;
    else if (r.bucket === "duplicate") dupCount++;
    else intraDupCount++;
    if (r.branchId === null) unmatchedBranchCount++;

    const d = r.eventAtISO.slice(0, 10);
    if (minDate === null || d < minDate) minDate = d;
    if (maxDate === null || d > maxDate) maxDate = d;

    let pb = perBranchMap.get(r.storeName);
    if (!pb) {
      pb = {
        storeName: r.storeName,
        branchId: r.branchId,
        branchName: r.branchId ? (branchNameById.get(r.branchId) ?? null) : null,
        newCount: 0,
        dupCount: 0,
        intraDupCount: 0,
        firstEventAt: null,
        lastEventAt: null,
        lastExistingEventAt: r.branchId
          ? (lastExistingByBranch.get(r.branchId) ?? null)
          : null,
        gapWarning: false,
      };
      perBranchMap.set(r.storeName, pb);
    }
    if (r.bucket === "new") pb.newCount++;
    else if (r.bucket === "duplicate") pb.dupCount++;
    else pb.intraDupCount++;
    if (pb.firstEventAt === null || r.eventAtISO < pb.firstEventAt) pb.firstEventAt = r.eventAtISO;
    if (pb.lastEventAt === null || r.eventAtISO > pb.lastEventAt) pb.lastEventAt = r.eventAtISO;
  }

  // 6) Continuity: per branch, if DB already has events and the file's first event
  //    starts > 24h after the DB's last known event → flag a gap.
  let continuityOk = true;
  for (const pb of perBranchMap.values()) {
    if (pb.lastExistingEventAt && pb.firstEventAt) {
      const gapMs =
        new Date(pb.firstEventAt).getTime() - new Date(pb.lastExistingEventAt).getTime();
      if (gapMs > GAP_THRESHOLD_MS) {
        pb.gapWarning = true;
        continuityOk = false;
      }
    }
  }

  const perBranch = Array.from(perBranchMap.values()).sort((a, b) =>
    a.storeName < b.storeName ? -1 : a.storeName > b.storeName ? 1 : 0,
  );
  const unmatchedBranches = uniqueStores.filter((s) => !branchIdByName.has(s));

  const summary: EventDiffSummary = {
    kind,
    totalRows: parsedRows.length,
    newCount,
    dupCount,
    intraDupCount,
    unmatchedBranchCount,
    badRowCount,
    dateRange: minDate && maxDate ? { from: minDate, to: maxDate } : null,
    perBranch,
    continuityOk,
    unmatchedBranches,
  };

  return { summary, rows };
}

// ---------------------------------------------------------------------------
// ingestEvents — insert ONLY new rows (skipDuplicates safety net on unique index)
// ---------------------------------------------------------------------------

export interface IngestEventsResult {
  insertedCount: number;
  skippedCount: number;
}

/**
 * Insert classified event rows. Only bucket==="new" rows are written; the unique
 * index (orgId, rowHash) + skipDuplicates is the final safety net against
 * double-counting (e.g. if two concurrent imports race). All rows carry orgId +
 * sourceImportId + resolved branchId. Wrapped in a transaction.
 *
 * @param prisma   Prisma client
 * @param orgId    tenant
 * @param importId ChairopsPosImport.id — stamped as sourceImportId
 * @param kind     "cash" | "coin"
 * @param rows     classified rows (from computeEventDiff); non-"new" are ignored
 */
export async function ingestEvents(
  prisma: PrismaClient,
  orgId: string,
  importId: string,
  kind: EventKind,
  rows: ClassifiedEventRow[],
): Promise<IngestEventsResult> {
  const toInsert = rows.filter((r) => r.bucket === "new");
  if (toInsert.length === 0) return { insertedCount: 0, skippedCount: 0 };

  const inserted = await prisma.$transaction(async (tx) => {
    if (kind === "cash") {
      const data: Prisma.ChairopsPosCashEventCreateManyInput[] = toInsert.map((r) => ({
        orgId,
        branchId: r.branchId,
        chairDeviceId: r.chairDeviceId,
        chairNumber: r.chairNumber,
        storeName: r.storeName,
        eventAt: r.eventAt,
        cashAdded: r.amount,
        cashMeter: r.meter,
        rowHash: r.rowHash,
        sourceImportId: importId,
      }));
      const res = await tx.chairopsPosCashEvent.createMany({ data, skipDuplicates: true });
      return res.count;
    } else {
      const data: Prisma.ChairopsPosCoinEventCreateManyInput[] = toInsert.map((r) => ({
        orgId,
        branchId: r.branchId,
        chairDeviceId: r.chairDeviceId,
        chairNumber: r.chairNumber,
        storeName: r.storeName,
        eventAt: r.eventAt,
        coinAdded: Math.round(r.amount),
        coinMeter: Math.round(r.meter),
        rowHash: r.rowHash,
        sourceImportId: importId,
      }));
      const res = await tx.chairopsPosCoinEvent.createMany({ data, skipDuplicates: true });
      return res.count;
    }
  });

  return { insertedCount: inserted, skippedCount: toInsert.length - inserted };
}

// ---------------------------------------------------------------------------
// Helpers — batched existence/aggregate queries (orgId-scoped)
// ---------------------------------------------------------------------------

const HASH_BATCH = 1000;

async function fetchExistingHashes(
  prisma: PrismaClient,
  orgId: string,
  kind: EventKind,
  hashes: string[],
): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < hashes.length; i += HASH_BATCH) {
    const batch = hashes.slice(i, i + HASH_BATCH);
    if (kind === "cash") {
      const rows = await prisma.chairopsPosCashEvent.findMany({
        where: { orgId, rowHash: { in: batch } },
        select: { rowHash: true },
      });
      for (const r of rows) found.add(r.rowHash);
    } else {
      const rows = await prisma.chairopsPosCoinEvent.findMany({
        where: { orgId, rowHash: { in: batch } },
        select: { rowHash: true },
      });
      for (const r of rows) found.add(r.rowHash);
    }
  }
  return found;
}

async function fetchLastExistingEventAt(
  prisma: PrismaClient,
  orgId: string,
  kind: EventKind,
  branchIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (branchIds.length === 0) return out;
  if (kind === "cash") {
    const grouped = await prisma.chairopsPosCashEvent.groupBy({
      by: ["branchId"],
      where: { orgId, branchId: { in: branchIds } },
      _max: { eventAt: true },
    });
    for (const g of grouped) {
      if (g.branchId && g._max.eventAt) out.set(g.branchId, g._max.eventAt.toISOString());
    }
  } else {
    const grouped = await prisma.chairopsPosCoinEvent.groupBy({
      by: ["branchId"],
      where: { orgId, branchId: { in: branchIds } },
      _max: { eventAt: true },
    });
    for (const g of grouped) {
      if (g.branchId && g._max.eventAt) out.set(g.branchId, g._max.eventAt.toISOString());
    }
  }
  return out;
}
