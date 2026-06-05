// ChairOps · Gmail auto-ingest: StarThing XLSX → ChairopsBranchDailyRevenue
//
// Called by the cron route `/api/chairops/cron/gmail-import`.
// Session-free: uses orgId directly. Actor is "gmail-auto-import" sentinel.
//
// Flow per org:
//   1. Get Gmail access token from ChairopsGmailConnection.
//   2. Search for messages from notify@starthing.com with XLSX attachments
//      (last 7 days — cron runs daily, 7-day window handles missed runs).
//   3. For each XLSX found:
//      a. Download bytes → sha256 hash → check ChairopsPosImport.fileHash dedup.
//      b. Parse StarThing format → aggregateToBranchDaily.
//      c. Resolve storeName → ChairopsBranch.name matches.
//      d. If any unknown branches → skip file + log (don't auto-import ambiguous data).
//      e. Upsert ChairopsBranchDailyRevenue rows.
//      f. Create ChairopsPosImport record (committed=true, uploadedById="gmail-auto-import").
//   4. Recompute drifts + evaluate alerts for the org.
//   5. Update ChairopsGmailConnection.lastSyncAt/Status/Count.

import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import {
  parseStarThingXlsx,
  aggregateToBranchDaily,
  type AggregatedDailyRow,
} from "@/lib/chairops/pos-ingest/starthing-xlsx";
import { recomputeAllDrifts } from "@/lib/chairops/reconcile/drift-engine";
import { evaluateAndEmitAlerts } from "@/lib/chairops/reconcile/alerts";
import {
  getAccessToken,
  searchMessages,
  getMessage,
  downloadAttachment,
  findXlsxAttachments,
} from "./gmail";

const GMAIL_ACTOR = "gmail-auto-import";
const SENDER_FILTER = "notify@starthing.com";
const SEARCH_WINDOW_DAYS = 7;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

export interface AutoIngestFileResult {
  filename: string;
  messageId: string;
  status:
    | "skipped_duplicate"
    | "skipped_unknown_branches"
    | "skipped_parse_error"
    | "skipped_too_large"
    | "committed"
    | "error";
  message?: string;
  rowsImported?: number;
  unknownBranches?: string[];
}

export interface AutoIngestOrgResult {
  orgId: string;
  files: AutoIngestFileResult[];
  totalCommitted: number;
  error?: string;
}

/** Run auto-ingest for all orgs that have a GmailConnection configured. */
export async function autoIngestAllOrgs(): Promise<AutoIngestOrgResult[]> {
  const connections = await prisma.chairopsGmailConnection.findMany({
    select: { orgId: true },
  });
  const results = await Promise.allSettled(
    connections.map((c) => autoIngestOrg(c.orgId)),
  );
  return results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    return {
      orgId: connections[i]!.orgId,
      files: [],
      totalCommitted: 0,
      error: r.reason instanceof Error ? r.reason.message : String(r.reason),
    };
  });
}

/** Run auto-ingest for one org. */
export async function autoIngestOrg(orgId: string): Promise<AutoIngestOrgResult> {
  const files: AutoIngestFileResult[] = [];

  try {
    const accessToken = await getAccessToken(orgId);
    if (!accessToken) {
      await updateSyncStatus(orgId, "error: no access token", 0);
      return { orgId, files, totalCommitted: 0, error: "no access token" };
    }

    // Load branches for name resolution
    const branches = await prisma.chairopsBranch.findMany({
      where: { orgId, isActive: true },
      select: { id: true, name: true, slug: true },
    });
    const branchByName = new Map(branches.map((b) => [b.name.toLowerCase().trim(), b]));
    const branchBySlug = new Map(branches.map((b) => [b.slug.toLowerCase().trim(), b]));

    // Search Gmail for recent StarThing emails
    const afterDate = new Date();
    afterDate.setDate(afterDate.getDate() - SEARCH_WINDOW_DAYS);
    const afterUnix = Math.floor(afterDate.getTime() / 1000);
    const query = `from:${SENDER_FILTER} has:attachment filename:.xlsx after:${afterUnix}`;

    const messages = await searchMessages(accessToken, query, 20);

    for (const { id: messageId } of messages) {
      const msg = await getMessage(accessToken, messageId);
      if (!msg) continue;

      const attachments = findXlsxAttachments(msg);
      for (const att of attachments) {
        const result = await processAttachment({
          orgId,
          accessToken,
          messageId,
          filename: att.filename,
          attachmentId: att.attachmentId,
          sizeBytes: att.sizeBytes,
          branchByName,
          branchBySlug,
        });
        files.push(result);
      }
    }

    const totalCommitted = files.filter((f) => f.status === "committed").reduce(
      (s, f) => s + (f.rowsImported ?? 0),
      0,
    );

    // Recompute drifts + alerts after all imports
    if (files.some((f) => f.status === "committed")) {
      await Promise.allSettled([
        recomputeAllDrifts(orgId),
        evaluateAndEmitAlerts(orgId),
      ]);
    }

    await updateSyncStatus(
      orgId,
      files.some((f) => f.status === "error") ? "partial" : "ok",
      totalCommitted,
    );

    return { orgId, files, totalCommitted };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateSyncStatus(orgId, `error: ${msg}`, 0).catch(() => {});
    return { orgId, files, totalCommitted: 0, error: msg };
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface ProcessAttachmentArgs {
  orgId: string;
  accessToken: string;
  messageId: string;
  filename: string;
  attachmentId: string;
  sizeBytes: number;
  branchByName: Map<string, { id: string; name: string; slug: string }>;
  branchBySlug: Map<string, { id: string; name: string; slug: string }>;
}

async function processAttachment(args: ProcessAttachmentArgs): Promise<AutoIngestFileResult> {
  const { orgId, accessToken, messageId, filename, attachmentId, sizeBytes, branchByName, branchBySlug } = args;

  if (sizeBytes > MAX_FILE_BYTES) {
    return { filename, messageId, status: "skipped_too_large", message: `${Math.round(sizeBytes / 1024)} KB > 10 MB` };
  }

  const buf = await downloadAttachment(accessToken, messageId, attachmentId);
  if (!buf) {
    return { filename, messageId, status: "error", message: "download failed" };
  }

  // Dedup by hash
  const fileHash = createHash("sha256").update(buf).digest("hex");
  const existing = await prisma.chairopsPosImport.findUnique({
    where: { orgId_fileHash: { orgId, fileHash } },
  });
  if (existing) {
    return { filename, messageId, status: "skipped_duplicate", message: `already imported (${existing.id})` };
  }

  // Parse StarThing XLSX
  let parseResult;
  try {
    parseResult = parseStarThingXlsx(buf);
  } catch (err) {
    return {
      filename,
      messageId,
      status: "skipped_parse_error",
      message: err instanceof Error ? err.message : "parse failed",
    };
  }

  if (parseResult.parsedRows.length === 0) {
    return { filename, messageId, status: "skipped_parse_error", message: "no rows parsed" };
  }

  // Resolve store names to branch IDs
  const unknownBranches: string[] = [];
  const resolvedBranches = new Map<string, string>(); // storeName → branchId

  for (const storeName of parseResult.branchNames) {
    const key = storeName.toLowerCase().trim();
    const branch = branchByName.get(key) ?? branchBySlug.get(key);
    if (branch) {
      resolvedBranches.set(storeName, branch.id);
    } else {
      unknownBranches.push(storeName);
    }
  }

  if (unknownBranches.length > 0) {
    return {
      filename,
      messageId,
      status: "skipped_unknown_branches",
      unknownBranches,
      message: `${unknownBranches.length} branch(es) unresolved — skipped`,
    };
  }

  // Aggregate to branch × date
  const aggregated = aggregateToBranchDaily(parseResult.parsedRows);

  // Build BranchDailyRevenue upserts
  const rowsToWrite = aggregated
    .map((a) => {
      const branchId = resolvedBranches.get(a.storeName);
      if (!branchId) return null;
      return { ...a, branchId };
    })
    .filter((r): r is AggregatedDailyRow & { branchId: string } => r !== null);

  if (rowsToWrite.length === 0) {
    return { filename, messageId, status: "skipped_parse_error", message: "no resolvable rows after aggregation" };
  }

  // Create PosImport record first (for the FK on BranchDailyRevenue)
  const posImport = await prisma.chairopsPosImport.create({
    data: {
      orgId,
      filename,
      uploadedById: GMAIL_ACTOR,
      fileHash,
      rowCount: parseResult.parsedRows.length,
      diffSummary: {
        source: "gmail-auto-import",
        messageId,
        counts: { new: rowsToWrite.length, same: 0, changed: 0, error: 0, total: rowsToWrite.length },
        rows: [],
      },
      committed: false, // will flip to true after writes succeed
    },
  });

  try {
    // Preload existing BranchDailyRevenue for dedup
    const bizDates = [...new Set(rowsToWrite.map((r) => r.bizDate))].map(
      (d) => new Date(d + "T00:00:00.000Z"),
    );
    const branchIds = [...new Set(rowsToWrite.map((r) => r.branchId))];

    const existing = await prisma.chairopsBranchDailyRevenue.findMany({
      where: {
        orgId,
        branchId: { in: branchIds },
        bizDate: { in: bizDates },
      },
      select: { id: true, branchId: true, bizDate: true },
    });

    const existingMap = new Map(
      existing.map((e) => [`${e.branchId}|${e.bizDate.toISOString().slice(0, 10)}`, e.id]),
    );

    const creates: import("@/lib/generated/prisma/client").Prisma.ChairopsBranchDailyRevenueCreateManyInput[] = [];
    const updates: Array<{ id: string; data: Record<string, unknown> }> = [];

    for (const r of rowsToWrite) {
      const bizDate = new Date(r.bizDate + "T00:00:00.000Z");
      const key = `${r.branchId}|${r.bizDate}`;
      const payload = {
        cashTotal: r.cashTotal,
        onlineTotal: r.onlineTotal,
        otherTotal: r.otherTotal,
        grossTotal: r.grossTotal,
        paymentCount: r.paymentCount,
        coinInsertCount: r.coinInsertCount,
        roundCount: r.roundCount,
        sourceImportId: posImport.id,
      };
      const existingId = existingMap.get(key);
      if (existingId) {
        updates.push({ id: existingId, data: payload });
      } else {
        creates.push({ orgId, branchId: r.branchId, bizDate, ...payload });
      }
    }

    await prisma.$transaction(
      async (tx) => {
        if (creates.length > 0) {
          await tx.chairopsBranchDailyRevenue.createMany({ data: creates });
        }
        for (const u of updates) {
          await tx.chairopsBranchDailyRevenue.update({ where: { id: u.id }, data: u.data });
        }
        await tx.chairopsPosImport.update({
          where: { id: posImport.id },
          data: { committed: true, committedAt: new Date() },
        });
      },
      { maxWait: 30_000, timeout: 60_000 },
    );

    return {
      filename,
      messageId,
      status: "committed",
      rowsImported: rowsToWrite.length,
    };
  } catch (err) {
    // Clean up the pending import record so the file can be retried next run
    await prisma.chairopsPosImport.delete({ where: { id: posImport.id } }).catch(() => {});
    const msg = err instanceof Error ? err.message : String(err);
    return { filename, messageId, status: "error", message: msg };
  }
}

async function updateSyncStatus(orgId: string, status: string, count: number) {
  await prisma.chairopsGmailConnection.update({
    where: { orgId },
    data: {
      lastSyncAt: new Date(),
      lastSyncStatus: status,
      lastSyncCount: count,
    },
  });
}
