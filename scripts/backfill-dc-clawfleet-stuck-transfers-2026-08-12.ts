// One-shot backfill (2026-08-12): revert DC→ClawFleet (MODULE dest) transfers that the
// old 48h auto-promote cron wrongly flipped to AUTO_UNVERIFIED, back to IN_TRANSIT, so
// staff can actually press "receive" on them (paired with the autoPromoteStaleTransfers
// fix in lib/dc/transfer-actions.ts that stops this from happening again).
//
// The cron did two things per stuck transfer that this script must both undo:
//   1) status IN_TRANSIT -> AUTO_UNVERIFIED  (undo: -> IN_TRANSIT, clear confirmedAt)
//   2) decrementSourceInTransit per line      (undo: increment qtyInTransit back, same math)
// Physical qtyOnHand at the source was NEVER touched by the cron for MODULE dest — only
// the in-transit counter — so this script only ever touches qtyInTransit + transfer status,
// never qtyOnHand. Skips (does not touch) anything not exactly matching the bug signature.
//
// Run: npx tsx -r dotenv/config scripts/backfill-dc-clawfleet-stuck-transfers-2026-08-12.ts dotenv_config_path=.env.local
import { prisma } from "@/lib/prisma";
import { DcTransferStatus, DcTransferDestType } from "@/lib/generated/prisma/enums";

async function main() {
  const stuck = await prisma.dcTransfer.findMany({
    where: {
      destType: DcTransferDestType.MODULE,
      toModule: "clawfleet",
      status: DcTransferStatus.AUTO_UNVERIFIED,
    },
    select: {
      id: true,
      transferCode: true,
      fromWarehouseId: true,
      toBranchId: true,
      lines: { select: { id: true, productId: true, qty: true, qtyReceived: true } },
    },
    orderBy: { dispatchedAt: "asc" },
  });

  console.log(`Found ${stuck.length} AUTO_UNVERIFIED MODULE-dest(clawfleet) transfers.\n`);

  let reverted = 0;
  let skipped = 0;

  for (const t of stuck) {
    if (t.lines.some((l) => l.qtyReceived != null)) {
      console.log(`SKIP  ${t.transferCode} (${t.id}) — a line already has qtyReceived set, needs manual look.`);
      skipped += 1;
      continue;
    }

    const before: Record<string, number | null> = {};
    for (const line of t.lines) {
      const bal = await prisma.dcStockBalance.findUnique({
        where: { warehouseId_productId: { warehouseId: t.fromWarehouseId, productId: line.productId } },
        select: { qtyInTransit: true },
      });
      before[line.productId] = bal?.qtyInTransit ?? null;
    }

    const result = await prisma.$transaction(async (tx) => {
      const claim = await tx.dcTransfer.updateMany({
        where: { id: t.id, status: DcTransferStatus.AUTO_UNVERIFIED },
        data: { status: DcTransferStatus.IN_TRANSIT, confirmedAt: null },
      });
      if (claim.count === 0) return "raced";

      for (const line of t.lines) {
        try {
          await tx.dcStockBalance.update({
            where: { warehouseId_productId: { warehouseId: t.fromWarehouseId, productId: line.productId } },
            data: { qtyInTransit: { increment: line.qty } },
          });
        } catch (e) {
          if ((e as { code?: string } | null)?.code !== "P2025") throw e;
          // no balance row at source anymore (e.g. product/warehouse pruned) — leave it,
          // status revert is still valid (source-side counter is best-effort bookkeeping).
        }
      }
      return "reverted";
    });

    if (result === "raced") {
      console.log(`SKIP  ${t.transferCode} (${t.id}) — status changed under us mid-run, left alone.`);
      skipped += 1;
      continue;
    }

    for (const line of t.lines) {
      const bal = await prisma.dcStockBalance.findUnique({
        where: { warehouseId_productId: { warehouseId: t.fromWarehouseId, productId: line.productId } },
        select: { qtyInTransit: true },
      });
      console.log(
        `  ${t.transferCode} product=${line.productId} qtyInTransit ${before[line.productId] ?? "(none)"} -> ${bal?.qtyInTransit ?? "(none)"} (+${line.qty})`,
      );
    }
    console.log(`OK    ${t.transferCode} (${t.id}) branch=${t.toBranchId} -> IN_TRANSIT\n`);
    reverted += 1;
  }

  console.log(`\nDone. reverted=${reverted} skipped=${skipped} total=${stuck.length}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
