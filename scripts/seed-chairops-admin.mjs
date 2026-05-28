// Seed a ChairOps ADMIN row for a Pool user (idempotent · one-shot).
//
// Why: Wave-0 fix removed auto-bootstrap (audit Phase-1 AUD/BE/SA flagged it as
// "any Pool admin becomes ChairOps ADMIN without approval"). Now a Pool user
// needs an explicit ChairopsUser row to enter /chairops/*. This script seeds
// the row for a specific email. Usually called once per environment to bootstrap
// the first admin · subsequent users go through /chairops/users/pending approval.
//
// Usage:
//   node scripts/seed-chairops-admin.mjs patipan@jpsyncgroup.com
//   node scripts/seed-chairops-admin.mjs admin@pooilgroup.test "Admin Display"

import { config as loadEnv } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

// Load Prisma client from generated path (per schema.prisma generator output)
const { PrismaClient } = await import("../lib/generated/prisma/client.js");

const EMAIL = process.argv[2];
const DISPLAY_NAME_ARG = process.argv[3];

if (!EMAIL) {
  console.error("✗ Usage: node scripts/seed-chairops-admin.mjs <email> [displayName]");
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("✗ DATABASE_URL not set");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log(`▶ Looking up Pool user: ${EMAIL}`);
  const poolUser = await prisma.user.findFirst({
    where: { email: EMAIL },
    select: { id: true, email: true, name: true, role: true },
  });

  if (!poolUser) {
    console.error(`✗ No Pool user with email=${EMAIL}`);
    console.error(`  Tip: user must log in to Pool at least once before seeding ChairOps`);
    process.exit(1);
  }
  console.log(`  ✓ Pool user found: id=${poolUser.id} name=${poolUser.name} poolRole=${poolUser.role}`);

  console.log(`▶ Checking for existing ChairopsUser`);
  const existing = await prisma.chairopsUser.findFirst({
    where: { authUserId: poolUser.id },
  });

  if (existing) {
    console.log(`  ✓ Already seeded: id=${existing.id} role=${existing.role} isActive=${existing.isActive}`);
    if (!existing.isActive) {
      console.log(`▶ Reactivating (was inactive)`);
      const reactivated = await prisma.chairopsUser.update({
        where: { id: existing.id },
        data: { isActive: true, role: "ADMIN" },
      });
      console.log(`  ✓ Reactivated: role=${reactivated.role}`);
    } else if (existing.role !== "ADMIN") {
      console.log(`▶ Promoting to ADMIN (was ${existing.role})`);
      const promoted = await prisma.chairopsUser.update({
        where: { id: existing.id },
        data: { role: "ADMIN" },
      });
      console.log(`  ✓ Promoted: role=${promoted.role}`);
    }
    return;
  }

  const displayName = DISPLAY_NAME_ARG ?? poolUser.name ?? EMAIL.split("@")[0];

  console.log(`▶ Creating ChairopsUser (ADMIN)`);
  const created = await prisma.chairopsUser.create({
    data: {
      authUserId: poolUser.id,
      email: EMAIL,
      displayName,
      role: "ADMIN",
      isActive: true,
      primaryBranchId: null,
    },
  });

  console.log(`  ✓ Created`);
  console.log(`     id              = ${created.id}`);
  console.log(`     authUserId      = ${created.authUserId}`);
  console.log(`     email           = ${created.email}`);
  console.log(`     displayName     = ${created.displayName}`);
  console.log(`     role            = ${created.role}`);
  console.log(`     isActive        = ${created.isActive}`);

  console.log(`\n▶ Writing audit log entry`);
  await prisma.chairopsAuditLog.create({
    data: {
      userId: created.id,
      action: "access.granted_seed_script",
      entity: "ChairopsUser",
      entityId: created.id,
      metadata: {
        email: EMAIL,
        seededBy: "scripts/seed-chairops-admin.mjs",
        note: "Bootstrap admin via seed script (Wave-0 fix removed auto-bootstrap)",
      },
    },
  });
  console.log(`  ✓ Audit log written`);

  console.log(`\n✅ Done. ${EMAIL} can now access /chairops/*`);
}

main()
  .catch((err) => {
    console.error(`✗ Seed failed:`, err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
