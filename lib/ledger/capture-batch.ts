// LedgerLine — multi-image capture batching.
//
// When a staffer sends 4-5 receipt photos in one burst (album), LINE delivers
// each as a SEPARATE webhook event (often in separate POSTs, each with its own
// replyToken). We want ONE summary card (a swipeable carousel) instead of 5
// separate cards. This module is the debounce buffer:
//
//   1. each image → openOrAppendBatch(): find the OPEN batch for this
//      group/user (created in the last few seconds) or start a new one; bump
//      count + lastEventAt + store the freshest replyToken.
//   2. each image's webhook then calls flushBatchAfterQuiet() in after():
//      sleep ~3.3s, re-read; if no NEWER image arrived (lastEventAt didn't move)
//      and the batch is still open, atomically flip open→sent (exactly-once)
//      and deliver the carousel of every draft in the batch.
//
// Reply (free, unlimited) is preferred at flush time — the freshest replyToken
// is only ~3-7s old, well within LINE's validity. Push is the fallback when the
// token is missing/expired. A single-photo batch is still delivered as a
// 1-bubble carousel by the same path (consistent UX, no special-casing).

import { prisma } from "@/lib/prisma";
import {
  buildLineConfirmCarousel,
  type LedgerConfirmCardInput,
  type LineFlexMessage,
} from "@/components/ledger/LineConfirmCard";

const BATCH_WINDOW_MS = 12_000; // append to an open batch created within this window
const QUIET_MS = 3_300; // flush after this much silence (no new photo)
// P1#1 — dedup window: ถ้า user สร้าง batch ซ้อนกันใน 2 นาที ให้ reuse batch เดิม
const DEDUP_WINDOW_MS = 2 * 60 * 1000; // 2 minutes

export interface OpenBatchInput {
  orgId: string;
  companyId: string;
  channelRowId: string;
  groupKey: string; // groupId (group) or userId (1:1) — where to push
  sourceType: "group" | "user";
  replyToken: string | null;
  /** P1#1 — userId ของผู้ส่งรูป ใช้ dedup batch ภายใน 2 นาที */
  createdBy?: string | null;
}

/**
 * Attach the current image to an OPEN batch for this conversation, or start a
 * new one. Returns { batchId, isFirst }. isFirst=true means THIS image created
 * the batch (the webhook replies inline with a single card for fast feedback;
 * the carousel push only fires if more photos join). Best-effort: a rare race
 * (two images creating two batches at once) just produces two cards — harmless.
 */
export async function openOrAppendBatch(
  input: OpenBatchInput,
): Promise<{ batchId: string; isFirst: boolean }> {
  // P1#1 — BATCH DEDUP: ถ้ามี OPEN batch ของ user+org+company คนเดียวกัน
  // ที่สร้างภายใน 2 นาที → reuse แทนสร้างใหม่ (ป้องกัน double-tap / webhook retry)
  //
  // MIGRATION REQUIRED: เพิ่มคอลัมน์ created_by บน ledger_capture_batch:
  //   ALTER TABLE ledger_capture_batch ADD COLUMN created_by TEXT;
  //   CREATE INDEX ON ledger_capture_batch (org_id, company_id, created_by, status, created_at)
  //     WHERE status = 'open';
  // จนกว่า migration จะ apply → dedup block นี้จะ skip (input.createdBy guard)
  if (input.createdBy) {
    const dedupSince = new Date(Date.now() - DEDUP_WINDOW_MS);
    const dedupBatch = await (prisma.ledgerCaptureBatch as unknown as {
      findFirst: (args: unknown) => Promise<{ id: string } | null>
    }).findFirst({
      where: {
        orgId: input.orgId,
        companyId: input.companyId,
        // createdBy field requires migration (see note above)
        createdBy: input.createdBy,
        status: "open",
        createdAt: { gte: dedupSince },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (dedupBatch) {
      await prisma.ledgerCaptureBatch.update({
        where: { id: dedupBatch.id },
        data: {
          lastEventAt: new Date(),
          count: { increment: 1 },
          replyToken: input.replyToken ?? undefined,
        },
      });
      return { batchId: dedupBatch.id, isFirst: false };
    }
  }

  const since = new Date(Date.now() - BATCH_WINDOW_MS);
  const existing = await prisma.ledgerCaptureBatch.findFirst({
    where: {
      channelRowId: input.channelRowId,
      groupKey: input.groupKey,
      status: "open",
      lastEventAt: { gte: since },
    },
    orderBy: { lastEventAt: "desc" },
    select: { id: true },
  });

  if (existing) {
    await prisma.ledgerCaptureBatch.update({
      where: { id: existing.id },
      data: {
        lastEventAt: new Date(),
        count: { increment: 1 },
        // keep the freshest reply token (so flush can reply for free)
        replyToken: input.replyToken ?? undefined,
      },
    });
    return { batchId: existing.id, isFirst: false };
  }

  // P1#1 — include createdBy in the create payload so the dedup query works after migration.
  // Cast via unknown to avoid TS error until schema is updated (see migration note above).
  const createData = {
    orgId: input.orgId,
    companyId: input.companyId,
    channelRowId: input.channelRowId,
    groupKey: input.groupKey,
    sourceType: input.sourceType,
    replyToken: input.replyToken,
    status: "open" as const,
    count: 1,
    lastEventAt: new Date(),
    ...(input.createdBy ? { createdBy: input.createdBy } : {}),
  };
  const created = await (prisma.ledgerCaptureBatch.create as (args: unknown) => Promise<{ id: string }>)({
    data: createData,
    select: { id: true },
  });
  return { batchId: created.id, isFirst: true };
}

export interface FlushDeps {
  baseUrl: string;
  liffId?: string;
  /** Reply with a flex message using a (still-valid) replyToken. Returns true on success. */
  replyFlex: (replyToken: string, msg: LineFlexMessage) => Promise<boolean>;
  /** Push a flex message to a group/user (fallback when reply token is gone). */
  pushFlex: (to: string, msg: LineFlexMessage) => Promise<boolean>;
}

/**
 * Debounce + flush. Sleeps QUIET_MS, then — if no newer image arrived and the
 * batch is still open — atomically claims it and delivers ONE carousel of every
 * draft in the batch. Safe to call once per image event; only the claim winner
 * sends. Never throws (best-effort; logs and returns).
 */
export async function flushBatchAfterQuiet(
  batchId: string,
  deps: FlushDeps,
): Promise<void> {
  try {
    await sleep(QUIET_MS);

    const batch = await prisma.ledgerCaptureBatch.findUnique({
      where: { id: batchId },
      select: { id: true, status: true, lastEventAt: true, replyToken: true, groupKey: true, companyId: true },
    });
    if (!batch || batch.status !== "open") return; // already flushed by a sibling

    // A newer image landed within the quiet window → let the later invocation flush.
    if (Date.now() - batch.lastEventAt.getTime() < QUIET_MS - 200) return;

    // Atomically claim the batch (exactly-once across concurrent invocations).
    const claim = await prisma.ledgerCaptureBatch.updateMany({
      where: { id: batchId, status: "open" },
      data: { status: "sent", sentAt: new Date() },
    });
    if (claim.count !== 1) return; // a sibling won the claim

    // Load every draft in the batch (oldest → newest = capture order).
    const rows = await prisma.ledgerExpense.findMany({
      where: { captureBatchId: batchId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        companyId: true,
        docCode: true,
        vendor: true,
        docType: true,
        vendorDocNumber: true,
        vendorAddress: true,
        docDate: true,
        createdAt: true,
        total: true,
        discount: true,
        vat: true,
        note: true,
        paymentMethod: true,
        ocrConfidence: true,
        ocrModel: true,
        needsReview: true,
        category: { select: { name: true } },
        branch: { select: { name: true } },
        items: { select: { description: true, qty: true, amount: true } },
      },
    });
    // A single-photo batch was already answered inline by the webhook (fast
    // path) — don't double-send. Only ≥2 photos get the consolidated carousel.
    if (rows.length <= 1) return;

    const cards: LedgerConfirmCardInput[] = rows.map((r) => ({
      expenseId: r.id,
      companyId: r.companyId,
      docCode: r.docCode,
      vendor: r.vendor,
      docType: r.docType as LedgerConfirmCardInput["docType"],
      vendorDocNumber: r.vendorDocNumber,
      vendorAddress: r.vendorAddress,
      docDate: r.docDate ? r.docDate.toISOString().slice(0, 10) : null,
      recordedDate: r.createdAt.toISOString().slice(0, 10),
      total: Number(r.total),
      discount: r.discount != null ? Number(r.discount) : null,
      vat: r.vat != null ? Number(r.vat) : null,
      note: r.note,
      items: r.items.map((it) => ({
        description: it.description,
        qty: Number(it.qty),
        amount: Number(it.amount),
      })),
      categoryName: r.category?.name ?? null,
      branchName: r.branch?.name ?? null,
      paymentMethod: r.paymentMethod,
      confidence: (r.ocrConfidence as Record<string, number> | null) ?? null,
      // ocrFailed = hard failure (Gemini never ran → no ocrModel) OR blank parse
      // (Gemini ran but returned all nulls = unreadable image).
      ocrFailed: r.ocrModel === null || (r.vendor === null && r.docDate === null && Number(r.total) === 0),
      needsReview: !!(r.needsReview && r.ocrModel !== null && (r.vendor !== null || Number(r.total) !== 0)),
      baseUrl: deps.baseUrl,
      liffId: deps.liffId,
    }));

    // The FIRST photo of the burst already got an inline single-card reply (fast
    // feedback), so omit its per-receipt bubble here — the summary still counts all.
    const carousel = buildLineConfirmCarousel(cards, { skipFirstBubble: true });

    // Prefer a free reply (token only seconds old); fall back to push.
    let delivered = false;
    if (batch.replyToken) {
      delivered = await deps.replyFlex(batch.replyToken, carousel).catch(() => false);
    }
    if (!delivered) {
      await deps.pushFlex(batch.groupKey, carousel).catch(() => false);
    }
  } catch (e) {
    console.error("[ledger:capture-batch] flush failed", e);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
