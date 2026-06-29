/**
 * ClawFleet · ตู้คีบ OS — ใบกระจายสินค้าตัวอย่าง (คลังกลาง → สาขา)
 *
 * สร้าง CfDelivery + CfDeliveryLine ให้สาขาเดโม (DM-BR-*) เพื่อให้แท็บ "การกระจาย"
 * มีใบให้กดตรวจรับจริง. รันหลัง migration 20260629_cf_delivery_lines.sql แล้วเท่านั้น.
 *
 * idempotent: ลบใบเดโมเดิม (note ขึ้นต้น [DEMO]) ก่อนสร้างใหม่.
 * Run: npx tsx -r dotenv/config scripts/seed-clawfleet-shipments.ts dotenv_config_path=.env.local
 */
import { prisma } from "@/lib/prisma";

const DEMO_TAG = "[DEMO]";

async function main() {
  console.log("\n=== ClawFleet Shipments Seed ===\n");
  const org = await prisma.organization.findFirst({ where: { isActive: true } });
  if (!org) throw new Error("no active organization");
  const admin = await prisma.user.findFirst({
    where: { orgId: org.id, role: "super_admin", isActive: true },
  });
  if (!admin) throw new Error("no super_admin");

  const branches = await prisma.branch.findMany({
    where: { orgId: org.id, code: { startsWith: "DM-BR-" } },
    select: { id: true, name: true },
  });
  if (branches.length === 0) {
    console.log("⚠️  ไม่พบสาขาเดโม (DM-BR-*) — รัน seed-clawfleet-demo.ts ก่อน");
    return;
  }
  const products = await prisma.cfProduct.findMany({
    where: { orgId: org.id, isActive: true },
    take: 4,
    select: { id: true, name: true },
  });
  if (products.length < 2) throw new Error("need ≥2 products");

  // cleanup demo deliveries (lines cascade)
  const old = await prisma.cfDelivery.findMany({
    where: { orgId: org.id, note: { startsWith: DEMO_TAG } },
    select: { id: true },
  });
  if (old.length > 0) {
    await prisma.cfDelivery.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
  }
  console.log(`cleaned ${old.length} old demo deliveries`);

  const statuses = ["SCHEDULED", "IN_TRANSIT", "IN_TRANSIT", "DELIVERED"] as const;
  let made = 0;
  for (let i = 0; i < Math.min(branches.length * 2, 5); i++) {
    const branch = branches[i % branches.length]!;
    const status = statuses[i % statuses.length]!;
    const lineProducts = products.slice(0, 2 + (i % 2)); // 2-3 lines
    const lines = lineProducts.map((p) => {
      const qty = 20 + ((i + 1) * 7) % 40;
      return {
        orgId: org.id,
        productId: p.id,
        productName: p.name,
        qty,
        receivedQty: status === "DELIVERED" ? qty : 0,
      };
    });
    const unitsCount = lines.reduce((s, l) => s + l.qty, 0);
    const etaDays = status === "DELIVERED" ? -1 : (i % 3) + 1;
    const eta = new Date();
    eta.setUTCDate(eta.getUTCDate() + etaDays);

    await prisma.cfDelivery.create({
      data: {
        orgId: org.id,
        branchId: branch.id,
        status,
        fromLocation: "คลังกลาง บางนา",
        eta,
        itemsCount: lines.length,
        unitsCount,
        note: `${DEMO_TAG} ใบกระจายตัวอย่าง → ${branch.name}`,
        createdById: admin.id,
        lines: { create: lines },
      },
    });
    made++;
  }
  console.log(`✅ created ${made} demo deliveries (มีใบให้กดตรวจรับในแท็บการกระจาย)\n`);
}

main()
  .catch((e) => {
    console.error("❌ FAILED:", e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
