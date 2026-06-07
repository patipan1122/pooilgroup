#!/usr/bin/env node
/**
 * Seed / upsert 21 LedgerLine expense categories for JP Sync (company code = JPSYNC).
 *
 * Finds the company by code so it works on any env (local / prod Supabase).
 * Safe to re-run — uses upsert on (orgId, companyId, name).
 *
 * Usage:
 *   node scripts/seed-ledger-categories-jps.mjs
 *
 * Env required: DATABASE_URL (Supabase direct-connection URL with pooler 6543)
 */

import pkg from "@prisma/client";
const { PrismaClient } = pkg;

const prisma = new PrismaClient();

// Confirmed by CFO workshop 2026-06-06 / LEDGERLINE_TRCLOUD_REFERENCE.md
const CATEGORIES = [
  { name: "ค่าโทรศัพท์",          accCode: "5220010", sku: "JPS-101", vat: true  },
  { name: "ค่าอินเทอร์เน็ต",       accCode: "5220021", sku: "JPS-101", vat: true  },
  { name: "ค่าไฟฟ้า",              accCode: "5220020", sku: "JPS-101", vat: true  },
  { name: "ค่าน้ำประปา",           accCode: "5220030", sku: "JPS-101", vat: true  },
  { name: "ค่าน้ำมันยานพาหนะ",     accCode: "5210470", sku: "JPS-101", vat: true  }, // ⚠️ conditional
  { name: "ค่าเดินทาง",            accCode: "5210070", sku: "JPS-101", vat: true  },
  { name: "ค่าโฆษณา/การตลาด",      accCode: "5200500", sku: "JPS-101", vat: true  },
  { name: "ค่าเช่าสำนักงาน",       accCode: "5210360", sku: "JPS-101", vat: false }, // มักไม่มี VAT
  { name: "ค่าเช่ายานพาหนะ",       accCode: "5210365", sku: "JPS-101", vat: true  },
  { name: "ค่าซ่อมบำรุง",          accCode: "5210330", sku: "JPS-101", vat: true  },
  { name: "วัสดุสิ้นเปลือง",        accCode: "5210310", sku: "JPS-100", vat: true  },
  { name: "เครื่องเขียน/อุปกรณ์สำนักงาน", accCode: "5210320", sku: "JPS-100", vat: true },
  { name: "วัสดุก่อสร้าง",          accCode: "5210350", sku: "JPS-103", vat: true  },
  { name: "ค่าจ้าง/บริการทั่วไป",   accCode: "5210430", sku: "JPS-101", vat: true  },
  { name: "ค่าทำบัญชี",            accCode: "5210180", sku: "JPS-101", vat: true  },
  { name: "ค่าสอบบัญชี",           accCode: "5210190", sku: "JPS-101", vat: true  },
  { name: "ค่าที่ปรึกษา",           accCode: "5210290", sku: "JPS-101", vat: true  },
  { name: "ค่าธรรมเนียมธนาคาร",    accCode: "5210220", sku: "JPS-101", vat: false }, // ไม่มี VAT
  { name: "ภาษีป้าย",              accCode: "5210270", sku: "JPS-101", vat: false }, // ไม่มี VAT
  { name: "ค่ารับรอง",             accCode: "5901200", sku: "JPS-101", vat: false }, // ห้ามขอคืน VAT
  { name: "ค่าใช้จ่ายเบ็ดเตล็ด",   accCode: "5210450", sku: "JPS-101", vat: true  }, // ⚠️ conditional
];

async function main() {
  // Find the JP Sync company — works across envs
  const company = await prisma.company.findFirst({
    where: { code: "JPSYNC" },
    select: { id: true, orgId: true, name: true },
  });

  if (!company) {
    console.error("❌  Company JPSYNC not found — run on the correct database.");
    process.exit(1);
  }

  console.log(`✅  Found company: ${company.name} (${company.id})`);

  // Get current max sort to append after existing categories
  const agg = await prisma.ledgerCategory.aggregate({
    where: { orgId: company.orgId, companyId: company.id },
    _max: { sort: true },
  });
  let sort = (agg._max.sort ?? 0) + 1;

  let created = 0;
  let updated = 0;

  for (const cat of CATEGORIES) {
    const existing = await prisma.ledgerCategory.findFirst({
      where: { orgId: company.orgId, companyId: company.id, name: cat.name },
      select: { id: true },
    });

    if (existing) {
      await prisma.ledgerCategory.update({
        where: { id: existing.id },
        data: {
          trcloudAccCode: cat.accCode,
          trcloudProductCode: cat.sku,
          vatClaimable: cat.vat,
          active: true,
        },
      });
      updated++;
      console.log(`  🔄  updated: ${cat.name}  →  GL=${cat.accCode}  SKU=${cat.sku}  VAT=${cat.vat}`);
    } else {
      await prisma.ledgerCategory.create({
        data: {
          orgId: company.orgId,
          companyId: company.id,
          name: cat.name,
          trcloudAccCode: cat.accCode,
          trcloudProductCode: cat.sku,
          vatClaimable: cat.vat,
          sort: sort++,
          active: true,
        },
      });
      created++;
      console.log(`  ✨  created: ${cat.name}  →  GL=${cat.accCode}  SKU=${cat.sku}  VAT=${cat.vat}`);
    }
  }

  console.log(`\n🎉  Done — ${created} created, ${updated} updated`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
