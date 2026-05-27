// Seed 30 branches from CEO's Google Sheet tab names
// Source: WebFetch 2026-05-21 · 1 tab = 1 branch (CEO confirmed)
// Multi-floor pairs are SEPARATE branches per CEO rule.
//
// W0: every chairops table now requires orgId. Seed targets the default
// Pooilgroup org (matches prisma/seed.ts POOILGROUP_ORG_ID). If we ever
// onboard a second tenant, parameterize via env or CLI arg.

import { prisma } from "@/lib/prisma";
import { ChairopsUserRole } from "@/lib/generated/prisma/enums";

const POOILGROUP_ORG_ID =
  process.env.CHAIROPS_SEED_ORG_ID ?? "00000000-0000-0000-0000-000000000001";

interface SeedBranch {
  slug: string;
  name: string;
  tabName: string;
  parenNumber?: number;
  city?: string;
  region?: string;
  mallGroup?: string;
  floor?: string;
}

// Parse pattern: "robinsonกาญ (900)" → name=robinsonกาญ paren=900
const BRANCHES: SeedBranch[] = [
  { slug: "mpark", tabName: "mpark(150)", name: "mpark", parenNumber: 150, mallGroup: "mpark" },
  { slug: "central-korat-thos", tabName: "centralโคราช(ธอส)(870)", name: "centralโคราช(ธอส)", parenNumber: 870, city: "นครราชสีมา", region: "อีสาน", mallGroup: "central" },
  { slug: "central-korat-blood", tabName: "centralโคราช(บริจาคเลือด)(550)", name: "centralโคราช(บริจาคเลือด)", parenNumber: 550, city: "นครราชสีมา", region: "อีสาน", mallGroup: "central" },
  { slug: "central-ayutthaya", tabName: "Centralอยุธยา", name: "Centralอยุธยา", city: "พระนครศรีอยุธยา", region: "กลาง", mallGroup: "central" },
  { slug: "robinson-prachin", tabName: "robinsonปราจีน(550)", name: "robinsonปราจีน", parenNumber: 550, city: "ปราจีนบุรี", region: "ตะวันออก", mallGroup: "robinson" },
  { slug: "robinson-kanchanaburi", tabName: "robinsonกาญ (900)", name: "robinsonกาญ", parenNumber: 900, city: "กาญจนบุรี", region: "ตะวันตก", mallGroup: "robinson" },
  { slug: "robinson-buriram", tabName: "robinsonบุรีรัมย์(700)", name: "robinsonบุรีรัมย์", parenNumber: 700, city: "บุรีรัมย์", region: "อีสาน", mallGroup: "robinson" },
  { slug: "lotus-ayutthaya", tabName: "lotusอยุธยา(300)", name: "lotusอยุธยา", parenNumber: 300, city: "พระนครศรีอยุธยา", region: "กลาง", mallGroup: "lotus" },
  { slug: "robinson-roiet", tabName: "robinson ร้อยเอ็ด(1300)", name: "robinson ร้อยเอ็ด", parenNumber: 1300, city: "ร้อยเอ็ด", region: "อีสาน", mallGroup: "robinson" },
  { slug: "top-nonghan", tabName: "TOPหนองหาน", name: "TOPหนองหาน", city: "อุดรธานี", region: "อีสาน", mallGroup: "top" },
  { slug: "wishko-huathale", tabName: "วิชโก้หัวทะเล", name: "วิชโก้หัวทะเล", city: "นครราชสีมา", region: "อีสาน" },
  { slug: "index-bangna", tabName: "INDEX บางนา", name: "INDEX บางนา", city: "กรุงเทพ", region: "กลาง", mallGroup: "index" },
  { slug: "huamak-center", tabName: "หัวหมาก เซ็นเตอร์", name: "หัวหมาก เซ็นเตอร์", city: "กรุงเทพ", region: "กลาง" },
  { slug: "condo-suparai-9", tabName: "Condo suparai 9 (200)", name: "Condo suparai 9", parenNumber: 200, city: "กรุงเทพ", region: "กลาง" },
  { slug: "central-sriracha", tabName: "เซนทรัล ศาีราชา (350)", name: "เซนทรัล ศรีราชา", parenNumber: 350, city: "ชลบุรี", region: "ตะวันออก", mallGroup: "central" },
  { slug: "ck-plaza", tabName: "Ck plaza (200)", name: "Ck plaza", parenNumber: 200 },
  { slug: "lotus-chonburi", tabName: "โลตัสชลบุรี (200)", name: "โลตัสชลบุรี", parenNumber: 200, city: "ชลบุรี", region: "ตะวันออก", mallGroup: "lotus" },
  { slug: "lotus-rama-2", tabName: "lotus พระราม 2", name: "lotus พระราม 2", city: "กรุงเทพ", region: "กลาง", mallGroup: "lotus" },
  { slug: "pantip-ngamwong", tabName: "พันธ์ุทิพย์ งามวงศ์วาน", name: "พันธ์ุทิพย์ งามวงศ์วาน", city: "นนทบุรี", region: "กลาง" },
  { slug: "royal-garden-khonkaen", tabName: "Royal gardenขอนแก่น (700)", name: "Royal garden ขอนแก่น", parenNumber: 700, city: "ขอนแก่น", region: "อีสาน" },
  { slug: "itsquare-floor-2", tabName: "ไอทีแสควร์ ชั้น2", name: "ไอทีแสควร์", floor: "ชั้น 2", city: "กรุงเทพ", region: "กลาง", mallGroup: "itsquare" },
  { slug: "itsquare-floor-3", tabName: "ไอทีแสควร์ ชั้น3", name: "ไอทีแสควร์", floor: "ชั้น 3", city: "กรุงเทพ", region: "กลาง", mallGroup: "itsquare" },
  { slug: "central-khonkaen", tabName: "Central ขอนแก่น", name: "Central ขอนแก่น", city: "ขอนแก่น", region: "อีสาน", mallGroup: "central" },
  { slug: "passion-rayong-1", tabName: "แพชชั่น ระยอง ชั้น1", name: "แพชชั่น ระยอง", floor: "ชั้น 1", city: "ระยอง", region: "ตะวันออก", mallGroup: "passion" },
  { slug: "passion-rayong-2", tabName: "แพชชั่น ระยอง ชั้น2", name: "แพชชั่น ระยอง", floor: "ชั้น 2", city: "ระยอง", region: "ตะวันออก", mallGroup: "passion" },
  { slug: "lotus-pathum", tabName: "โลตัสปทุม", name: "โลตัสปทุม", city: "ปทุมธานี", region: "กลาง", mallGroup: "lotus" },
  { slug: "lamplaimat", tabName: "ลำปลายมาศ", name: "ลำปลายมาศ", city: "บุรีรัมย์", region: "อีสาน" },
  { slug: "lotus-chaiyaphum", tabName: "lotus ชัยภูมิ(250)", name: "lotus ชัยภูมิ", parenNumber: 250, city: "ชัยภูมิ", region: "อีสาน", mallGroup: "lotus" },
  { slug: "phoenix-pratunam", tabName: "ฟินิกซ์ ประตูน้ำ", name: "ฟินิกซ์ ประตูน้ำ", city: "กรุงเทพ", region: "กลาง" },
  { slug: "robinson-sakon", tabName: "robinsonสกลนคร", name: "robinsonสกลนคร", city: "สกลนคร", region: "อีสาน", mallGroup: "robinson" },
];

// Chair codes seen in source Sheet (91 chairs verified by Sheet Analyst)
// Only G031xxxx 57 chairs from initial batch at robinsonกาญ are confirmed mapped.
// Other chair-to-branch mappings unknown until CEO provides master.
const KNOWN_CHAIR_CODES_AT_ROBINSON_KAN = [
  "G0310370","G0310371","G0310372","G0310373","G0310374","G0310375","G0310376","G0310377","G0310378",
  "G0310380","G0310381","G0310382","G0310383","G0310384","G0310385","G0310386","G0310387","G0310388","G0310389",
  "G0310390","G0310391","G0310392","G0310393","G0310394","G0310395","G0310396","G0310397","G0310398","G0310399",
  "G0310400","G0310401","G0310402","G0310403","G0310404","G0310405","G0310406","G0310407","G0310408","G0310409",
  "G0310410","G0310411","G0310412","G0310413","G0310414","G0310415","G0310416","G0310417","G0310418","G0310419",
  "G0310420","G0310421","G0310422","G0310423","G0310424","G0310425","G0310426","G0310429",
];

async function main() {
  console.log("Seeding ChairOps...");

  // Branches
  for (const b of BRANCHES) {
    await prisma.chairopsBranch.upsert({
      where: { orgId_slug: { orgId: POOILGROUP_ORG_ID, slug: b.slug } },
      update: {
        name: b.name,
        tabName: b.tabName,
        parenNumber: b.parenNumber,
        city: b.city,
        region: b.region,
        mallGroup: b.mallGroup,
        floor: b.floor,
      },
      create: { ...b, orgId: POOILGROUP_ORG_ID, isActive: true },
    });
  }
  console.log(`✅ Upserted ${BRANCHES.length} branches`);

  // Seed CEO + Admin (auth links will be added when they login)
  await prisma.chairopsUser.upsert({
    where: {
      orgId_email: { orgId: POOILGROUP_ORG_ID, email: "patipan@jpsyncgroup.com" },
    },
    update: {},
    create: {
      orgId: POOILGROUP_ORG_ID,
      email: "patipan@jpsyncgroup.com",
      displayName: "Pattipan (CEO)",
      role: ChairopsUserRole.CEO,
    },
  });

  // Seed chair codes at robinsonกาญ (only branch confirmed in source data)
  const kan = await prisma.chairopsBranch.findUnique({
    where: {
      orgId_slug: { orgId: POOILGROUP_ORG_ID, slug: "robinson-kanchanaburi" },
    },
  });
  if (kan) {
    for (const code of KNOWN_CHAIR_CODES_AT_ROBINSON_KAN) {
      await prisma.chairopsChair.upsert({
        where: {
          orgId_chairCode: { orgId: POOILGROUP_ORG_ID, chairCode: code },
        },
        update: { branchId: kan.id },
        create: {
          orgId: POOILGROUP_ORG_ID,
          chairCode: code,
          branchId: kan.id,
          generation: code.startsWith("G0310") ? "G0310" :
                      code.startsWith("G0318") ? "G0318" :
                      code.startsWith("G0321") ? "G0321" :
                      code.startsWith("FC") ? "FC" : "UNKNOWN",
          isOnline: !code.startsWith("FC"),
        },
      });
    }
    console.log(`✅ Seeded ${KNOWN_CHAIR_CODES_AT_ROBINSON_KAN.length} chairs at robinsonกาญ`);
  }

  // Seed default spare parts categories (from common chair repair domain)
  const PARTS = [
    { partCode: "ROLLER-S", name: "ลูกกลิ้งเล็ก", category: "มอเตอร์", unitPrice: 250 },
    { partCode: "ROLLER-L", name: "ลูกกลิ้งใหญ่", category: "มอเตอร์", unitPrice: 450 },
    { partCode: "MOTOR-A", name: "มอเตอร์หลัก", category: "มอเตอร์", unitPrice: 3500 },
    { partCode: "BELT", name: "สายพาน", category: "ขับเคลื่อน", unitPrice: 350 },
    { partCode: "FABRIC", name: "เบาะ", category: "ภายนอก", unitPrice: 1200 },
    { partCode: "REMOTE", name: "รีโมท", category: "อิเล็กทรอนิกส์", unitPrice: 850 },
    { partCode: "QR-MOD", name: "โมดูล QR Code", category: "อิเล็กทรอนิกส์", unitPrice: 1500 },
    { partCode: "COIN-MECH", name: "กลไกหยอดเหรียญ", category: "อิเล็กทรอนิกส์", unitPrice: 800 },
  ];
  for (const p of PARTS) {
    await prisma.chairopsSparePart.upsert({
      where: {
        orgId_partCode: { orgId: POOILGROUP_ORG_ID, partCode: p.partCode },
      },
      update: {},
      create: { ...p, orgId: POOILGROUP_ORG_ID, stockOnHand: 0, reorderLevel: 2 },
    });
  }
  console.log(`✅ Seeded ${PARTS.length} spare parts`);

  // Seed drift rows for each branch (start zeros)
  const allBranches = await prisma.chairopsBranch.findMany({
    where: { orgId: POOILGROUP_ORG_ID },
  });
  for (const b of allBranches) {
    await prisma.chairopsDrift.upsert({
      where: { orgId_branchId: { orgId: POOILGROUP_ORG_ID, branchId: b.id } },
      update: {},
      create: {
        orgId: POOILGROUP_ORG_ID,
        branchId: b.id,
        posTotal: 0,
        depositTotal: 0,
        driftAmount: 0,
      },
    });
  }
  console.log(`✅ Initialized drift rows for ${allBranches.length} branches`);

  console.log("Done.");
}

main()
  .then(async () => await prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
