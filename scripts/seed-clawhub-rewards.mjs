// ClawHub (JOLLY PLAY) — sample reward catalog seed (idempotent).
// Usage: node scripts/seed-clawhub-rewards.mjs
// Inserts ~4 sample ClawhubReward rows for the Pooilgroup org IF the org has none yet.
// Safe to re-run: skips entirely once any reward exists for the org.
// Cleanup: DELETE FROM public.clawhub_rewards WHERE org_id = '<orgId>';

import { PrismaClient } from "../lib/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const url = new URL(process.env.DIRECT_URL ?? process.env.DATABASE_URL);
url.searchParams.delete("sslmode");
const pool = new pg.Pool({
  connectionString: url.toString(),
  ssl: { rejectUnauthorized: false },
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

// Resolve the Pooilgroup org (slug "pooilgroup"), fallback to first org.
let org = await prisma.organization.findUnique({
  where: { slug: "pooilgroup" },
  select: { id: true, name: true, slug: true },
});
if (!org) {
  org = await prisma.organization.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, slug: true },
  });
}
if (!org) {
  console.error("[clawhub-rewards-seed] no Organization found — nothing to seed.");
  await pool.end();
  process.exit(1);
}
console.log(`[clawhub-rewards-seed] org: ${org.name} (${org.slug} · ${org.id})`);

// Idempotency guard: skip if rewards already exist for this org.
const existing = await prisma.clawhubReward.count({ where: { orgId: org.id } });
if (existing > 0) {
  console.log(
    `[clawhub-rewards-seed] org already has ${existing} reward(s) — skipping (safe re-run).`,
  );
  await pool.end();
  process.exit(0);
}

const rewards = [
  { name: "ตุ๊กตาหมีจัมโบ้", pointsPrice: 25, sortOrder: 1 },
  { name: "ตุ๊กตาแมวน้อย", pointsPrice: 20, sortOrder: 2 },
  { name: "พวงกุญแจ", pointsPrice: 10, sortOrder: 3 },
  { name: "กล่องสุ่ม", pointsPrice: 30, sortOrder: 4 },
];

let created = 0;
for (const r of rewards) {
  const row = await prisma.clawhubReward.create({
    data: {
      orgId: org.id,
      name: r.name,
      imageUrl: "/clawhub/logo.jpg",
      pointsPrice: r.pointsPrice,
      stock: null, // null = unlimited
      isActive: true,
      sortOrder: r.sortOrder,
    },
  });
  created += 1;
  console.log(
    `[clawhub-rewards-seed] + ${row.name} — ${row.pointsPrice} แต้ม (${row.id})`,
  );
}

console.log(`[clawhub-rewards-seed] done — created ${created} reward(s).`);
await pool.end();
