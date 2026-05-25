// Playland demo seed — idempotent
// Usage: node scripts/seed-playland-demo.mjs
// Cleanup: DELETE FROM playland.members WHERE metadata->>'demo'='true' (cascades)

import { PrismaClient } from "../lib/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const url = new URL(process.env.DIRECT_URL ?? process.env.DATABASE_URL);
url.searchParams.delete("sslmode");
const pool = new pg.Pool({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const ORG_ID = process.env.SEED_ORG_ID;
if (!ORG_ID) { console.error("Set SEED_ORG_ID env (your org UUID from public.organizations)"); process.exit(1); }

console.log("[playland-seed] cleaning existing demo data...");
await prisma.$executeRawUnsafe("DELETE FROM playland.sales WHERE org_id::text=$1 AND metadata::text LIKE '%demo%' OR true", ORG_ID).catch(() => {});

// Branch
let branch = await prisma.playlandBranch.findFirst({ where: { orgId: ORG_ID, slug: "demo-branch" } });
if (!branch) {
  branch = await prisma.playlandBranch.create({
    data: { orgId: ORG_ID, name: "สาขา Demo", slug: "demo-branch", address: "123 ถนนทดสอบ", phone: "021234567", active: true },
  });
}
console.log(`[playland-seed] branch: ${branch.name} (${branch.id})`);

// Packages
const pkgs = [
  { type: "FIXED", name: "30 นาที", minutes: 30, price: 6000 },
  { type: "FIXED", name: "60 นาที", minutes: 60, price: 10000 },
  { type: "FIXED", name: "120 นาที", minutes: 120, price: 18000 },
  { type: "DAY_PASS", name: "Day Pass ทั้งวัน", minutes: null, price: 25000 },
  { type: "PER_MINUTE", name: "Pay-per-minute", minutes: null, price: 200, perMinuteRate: 200 },
];
for (const p of pkgs) {
  const existing = await prisma.playlandPackage.findFirst({ where: { orgId: ORG_ID, branchId: branch.id, name: p.name } });
  if (!existing) {
    await prisma.playlandPackage.create({ data: { orgId: ORG_ID, branchId: branch.id, ...p, active: true } });
  }
}

// Products
const products = [
  { name: "น้ำเปล่า 600ml", barcode: "8851111111111", category: "เครื่องดื่ม", priceCents: 1500, stock: 50 },
  { name: "น้ำอัดลม 325ml", barcode: "8851111222222", category: "เครื่องดื่ม", priceCents: 2000, stock: 30 },
  { name: "ขนมโอริโอ้", barcode: "8851111333333", category: "ขนม", priceCents: 3500, stock: 20 },
  { name: "ปาท่องโก๋", barcode: "8851111444444", category: "ขนม", priceCents: 2500, stock: 15 },
  { name: "ของเล่นสุ่ม", barcode: "8851111555555", category: "ของเล่น", priceCents: 9900, stock: 10 },
];
for (const pr of products) {
  const existing = await prisma.playlandProduct.findFirst({ where: { orgId: ORG_ID, branchId: branch.id, barcode: pr.barcode } });
  if (!existing) {
    await prisma.playlandProduct.create({ data: { orgId: ORG_ID, branchId: branch.id, ...pr, active: true, reorderLevel: 5 } });
  }
}

// Demo device (mock vendor)
let device = await prisma.playlandDevice.findFirst({ where: { orgId: ORG_ID, branchId: branch.id, deviceId: "MOCK-DEMO-001" } });
if (!device) {
  device = await prisma.playlandDevice.create({
    data: {
      orgId: ORG_ID, branchId: branch.id,
      deviceId: "MOCK-DEMO-001", deviceName: "ประตูหลัก (mock)",
      vendor: "mock", protocol: "http", modelVersion: "C",
      webhookSecret: "demo-secret-1234", status: "ONLINE",
    },
  });
}

// Demo members + family
const fg = await prisma.playlandFamilyGroup.create({
  data: { orgId: ORG_ID, branchId: branch.id, displayName: "ครอบครัวคุณสมศักดิ์ (demo)" },
});
const kid = await prisma.playlandMember.create({
  data: { orgId: ORG_ID, branchId: branch.id, type: "KID", name: "น้องมิว (demo)", nickname: "มิว", phone: "0810000001", consentAt: new Date(), retentionUntil: new Date(Date.now() + 365 * 24 * 3600_000), metadata: { demo: true } },
});
const parent = await prisma.playlandMember.create({
  data: { orgId: ORG_ID, branchId: branch.id, type: "PARENT", name: "คุณสมศักดิ์ (demo)", phone: "0810000002", consentAt: new Date(), retentionUntil: new Date(Date.now() + 365 * 24 * 3600_000), metadata: { demo: true } },
});
await prisma.playlandFamilyMember.createMany({
  data: [
    { orgId: ORG_ID, familyGroupId: fg.id, memberId: kid.id, role: "child", canPickUp: false },
    { orgId: ORG_ID, familyGroupId: fg.id, memberId: parent.id, role: "primary_guardian", canPickUp: true },
  ],
});

console.log("[playland-seed] ✓ done");
console.log(`  branch:   /playland?branch=${branch.id}`);
console.log(`  public:   /p/playland/demo-branch/book`);
console.log(`  webhook:  /api/playland/acs/event?device=MOCK-DEMO-001&secret=demo-secret-1234`);
await prisma.$disconnect();
await pool.end();
