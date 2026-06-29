/**
 * ClawFleet · ตู้คีบ OS — ใส่ "รูปตัวอย่าง" ให้รอบเก็บเงินเดโม
 *
 * event เดโมที่ seed-clawfleet-demo สร้างไม่มีรูป (photo columns = null) → หน้าตรวจรอบเก็บเงิน
 * โชว์ "ไม่มีรูป". สคริปต์นี้เติมรูป placeholder (SVG data-URI · ไม่ต้อง host · มี label ตามชนิด)
 * ลง 5 ช่องรูปของทุก CLAW collection event ในสาขาเดโม (DM-BR-*) เพื่อให้ CEO เห็น gallery ทำงาน.
 *
 * ปลอดภัย: อัปเดตเฉพาะ event ของสาขาเดโม · idempotent (รันซ้ำได้) · ไม่แตะข้อมูลจริง.
 * Run: npx tsx -r dotenv/config scripts/seed-clawfleet-demo-photos.ts dotenv_config_path=.env.local
 */
import { prisma } from "@/lib/prisma";

// สร้างรูป placeholder เป็น SVG data-URI (โหลดได้ใน <img> ทุกที่ · ไม่ต้อง config domain)
function svgPhoto(label: string, bg: string): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='400' height='300'>` +
    `<rect width='400' height='300' fill='${bg}'/>` +
    `<rect x='12' y='12' width='376' height='276' fill='none' stroke='#ffffff' stroke-opacity='0.5' stroke-width='2' rx='10'/>` +
    `<text x='200' y='140' font-family='sans-serif' font-size='26' font-weight='700' fill='#ffffff' text-anchor='middle'>${label}</text>` +
    `<text x='200' y='176' font-family='sans-serif' font-size='15' fill='#ffffff' fill-opacity='0.85' text-anchor='middle'>รูปตัวอย่าง (เดโม)</text>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// mapping ตรงกับ write-side (lib/clawfleet/actions.ts) — คอลัมน์ : เนื้อหาจริง
const PHOTOS = {
  photoMeterAfterUrl: svgPhoto("มิเตอร์เหรียญ", "#4F46E5"),
  photoPrizeMeterUrl: svgPhoto("มิเตอร์ตุ๊กตา", "#0EA5E9"),
  photoStockUrl: svgPhoto("สต็อกก่อนเติม", "#059669"),
  photoMeterBeforeUrl: svgPhoto("สต็อกหลังเติม", "#D97706"),
  photoCashUrl: svgPhoto("เงินสด", "#DC2626"),
};

async function main() {
  console.log("\n=== ClawFleet Demo Photos Seed ===\n");
  const org = await prisma.organization.findFirst({ where: { isActive: true } });
  if (!org) throw new Error("no active organization");

  const demoBranches = await prisma.branch.findMany({
    where: { orgId: org.id, code: { startsWith: "DM-BR-" } },
    select: { id: true },
  });
  const demoBranchIds = demoBranches.map((b) => b.id);
  if (demoBranchIds.length === 0) {
    console.log("⚠️  ไม่พบสาขาเดโม (DM-BR-*) — รัน seed-clawfleet-demo.ts ก่อน");
    return;
  }

  // CLAW collection events ในสาขาเดโม (ตู้คีบ มีรูปครบ 5 · EX/exchanger ไม่ต้อง)
  const events = await prisma.cfCollectionEvent.findMany({
    where: {
      orgId: org.id,
      eventType: "COLLECTION",
      machine: { branchId: { in: demoBranchIds }, kind: "CLAW" },
    },
    select: { id: true },
  });
  console.log(`พบ ${events.length} CLAW collection events ในสาขาเดโม`);

  let updated = 0;
  for (const ev of events) {
    await prisma.cfCollectionEvent.update({
      where: { id: ev.id },
      data: PHOTOS,
    });
    updated++;
  }
  console.log(`✅ เติมรูปตัวอย่างให้ ${updated} events (5 รูป/event)\n`);
}

main()
  .catch((e) => {
    console.error("❌ FAILED:", e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
