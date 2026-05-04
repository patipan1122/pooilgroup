// Pool Group ERP — Database Seed
// Idempotent: re-run = no duplicate. Uses upsert pattern.
// Run: npx tsx prisma/seed.ts (or `npm run db:seed`)

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client.js";
import { BUSINESS_TYPE_LIST } from "../constants/business-types.js";

const connectionString =
  process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "";
if (!connectionString) {
  throw new Error("DIRECT_URL or DATABASE_URL must be set");
}
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const POOL_GROUP_ORG_ID = "00000000-0000-0000-0000-000000000001";
const SUPER_ADMIN_USER_ID = "00000000-0000-0000-0000-000000000002";

async function seedOrganization() {
  const org = await prisma.organization.upsert({
    where: { id: POOL_GROUP_ORG_ID },
    update: {},
    create: {
      id: POOL_GROUP_ORG_ID,
      name: "Pool Group",
      slug: "poolgroup",
      settings: {
        timezone: "Asia/Bangkok",
        fiscalYearStart: 1,
        currency: "THB",
        reconcileMode: "binary", // ตาม CASHHUB §13
        spikeAlertThreshold: 1.5,
      },
    },
  });
  console.log(`✓ Organization: ${org.name} (${org.id})`);
  return org;
}

async function seedSuperAdmin(orgId: string) {
  const owner = await prisma.user.upsert({
    where: { id: SUPER_ADMIN_USER_ID },
    update: {},
    create: {
      id: SUPER_ADMIN_USER_ID,
      orgId,
      email: "owner@poolgroup.com",
      name: "Pool Group Owner",
      role: "super_admin",
      mustChangePassword: false, // Owner sets via Supabase Auth flow
      isActive: true,
    },
  });
  console.log(`✓ Super Admin: ${owner.name}`);
  return owner;
}

async function seedReportTemplates(orgId: string) {
  for (const config of BUSINESS_TYPE_LIST) {
    await prisma.reportTemplate.upsert({
      where: { businessType: config.type },
      update: {
        hasShifts: config.hasShifts,
        shifts: config.shifts,
        hasReconcile: config.hasReconcile,
        fields: JSON.parse(JSON.stringify(config.fields)),
        reconcileFormula: config.reconcileFormula || null,
      },
      create: {
        orgId,
        businessType: config.type,
        hasShifts: config.hasShifts,
        shifts: config.shifts,
        hasReconcile: config.hasReconcile,
        fields: JSON.parse(JSON.stringify(config.fields)),
        reconcileFormula: config.reconcileFormula || null,
      },
    });
    console.log(`✓ Template: ${config.emoji} ${config.label}`);
  }
}

// Sample 5 branches representing different business types — Owner adds the rest via CSV import on Day 14
async function seedSampleBranches(orgId: string) {
  const samples = [
    {
      code: "KKN-001",
      name: "ปั๊มน้ำมัน KKN-001",
      businessType: "fuel_station" as const,
      province: "ขอนแก่น",
      region: "อีสาน",
    },
    {
      code: "KKN-002",
      name: "ร้านก๊าซ KKN-002",
      businessType: "lpg_station" as const,
      province: "ขอนแก่น",
      region: "อีสาน",
    },
    {
      code: "KKN-003",
      name: "โรงบรรจุก๊าซ KKN-003",
      businessType: "bottling_plant" as const,
      province: "ขอนแก่น",
      region: "อีสาน",
    },
    {
      code: "KKN-HOT",
      name: "Hotel Pool KKN",
      businessType: "hotel" as const,
      province: "ขอนแก่น",
      region: "อีสาน",
    },
    {
      code: "KKN-CAFE",
      name: "Café Amazon KKN",
      businessType: "cafe" as const,
      province: "ขอนแก่น",
      region: "อีสาน",
    },
  ];

  for (const branch of samples) {
    await prisma.branch.upsert({
      where: { orgId_code: { orgId, code: branch.code } },
      update: {},
      create: { ...branch, orgId },
    });
    console.log(`✓ Branch: ${branch.code} ${branch.name}`);
  }
}

async function main() {
  console.log("🌱 Seeding Pool Group database...\n");
  const org = await seedOrganization();
  await seedSuperAdmin(org.id);
  await seedReportTemplates(org.id);
  await seedSampleBranches(org.id);
  console.log("\n✅ Seed complete.");
  console.log("   Next: configure Owner password via Supabase Auth dashboard");
  console.log("   Or import full branches/users CSV on Day 14");
}

main()
  .catch((err) => {
    console.error("❌ Seed failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
