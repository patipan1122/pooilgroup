// Verify the v2 legacy loaders return non-empty REAL data for hub / insights /
// stock (so the deployed pages don't render blank). Replicates the core queries.
import { prisma } from "@/lib/prisma";

async function main() {
  const org = await prisma.organization.findFirst({ where: { isActive: true } });
  if (!org) throw new Error("no org");
  const since = new Date(); since.setDate(since.getDate() - 7);

  // HUB: closed sessions last 7 days
  const closed = await prisma.cfCollectionSession.findMany({
    where: { orgId: org.id, status: { in: ["CLOSED", "ANOMALY_REVIEW", "LOCKED"] }, closedAt: { gte: since } },
    select: { totalCashCents: true, status: true, group: { select: { branchId: true } } },
  });
  const open = await prisma.cfCollectionSession.count({ where: { orgId: org.id, status: "OPEN" } });
  const revenue = closed.reduce((a, r) => a + r.totalCashCents, 0) / 100;

  // INSIGHTS: sessions last 7 days
  const insights = closed.length;

  // STOCK: first branch
  const branch = await prisma.branch.findFirst({ where: { orgId: org.id, businessType: "claw_machine", isActive: true }, select: { id: true, name: true } });
  const stockMoves = branch ? await prisma.cfStockMovement.count({ where: { orgId: org.id, branchId: branch.id } }) : 0;
  const products = await prisma.cfProduct.count({ where: { orgId: org.id, isActive: true } });

  console.log("=== v2 page data check (legacy real-data) ===");
  console.log(`HUB     · closed(7d)=${closed.length} · open=${open} · revenue=฿${revenue.toLocaleString()} · branches w/ activity=${new Set(closed.map(c => c.group?.branchId)).size}`);
  console.log(`INSIGHTS· rows(7d)=${insights}`);
  console.log(`STOCK   · branch="${branch?.name}" · stockMoves=${stockMoves} · products=${products}`);
  const ok = closed.length > 0 && insights > 0 && products > 0;
  console.log(ok ? "\n✅ all v2 pages will render real data" : "\n⚠️ some page may be empty");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
