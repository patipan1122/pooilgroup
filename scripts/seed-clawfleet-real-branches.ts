/**
 * ClawFleet — REAL branch + machine setup (CEO data 2026-05-28 · รอบ 61)
 *
 * Creates the actual claw-machine branches with their real machine counts and
 * sets INITIAL meters (เริ่มต้นนับจาก 0). NOT demo data.
 *
 * Source: CEO's Google Sheet "รวมงานสิ้นเดือนส่วนตู้คีบ" → tab "รวมงานตู้คีบ".
 * Machines are created as kind=CLAW with no group (v2 branch model · groupId null).
 * Each machine gets an INITIAL event marking its starting meter.
 *
 * IDEMPOTENT: upserts branch by (orgId, code); machines by (orgId, code).
 * Re-running updates counts without duplicating.
 *
 * ⚠️ DB WRITE — must be run by CEO (or with a granted Bash permission):
 *   npx tsx -r dotenv/config scripts/seed-clawfleet-real-branches.ts dotenv_config_path=.env.local
 *
 * REVIEW THE DATA BELOW before running. Two values were unreadable from the
 * screenshot — marked CONFIRM. Fix them, then run.
 */

import { prisma } from "@/lib/prisma";

// ── EDIT HERE: real branches · code is stable id · name + area + machine count ──
// initialCoinMeter / initialDollMeter default 0 (เริ่มนับจาก 0). If a machine
// already has a real meter reading, set startMeter per branch.
const BRANCHES: Array<{
  code: string; name: string; area: string; machines: number; startMeter?: number;
}> = [
  // CONFIRM: branch "1." was scrolled off-screen above row 5 — add it if it exists.
  { code: "CW-KAENDONG",   name: "แคนดง",            area: "นครราชสีมา", machines: 11 },
  { code: "CW-CHUMPHUANG", name: "ชุมพวง",           area: "นครราชสีมา", machines: 10 },
  { code: "CW-NONDAENG",   name: "โนนแดง",           area: "นครราชสีมา", machines: 5 },
  { code: "CW-LAMTHAMEN",  name: "ลำทะเมนชัย",       area: "นครราชสีมา", machines: 8 },
  { code: "CW-PRATHAI",    name: "ประทาย",           area: "นครราชสีมา", machines: 6 },
  { code: "CW-MUEANGYANG", name: "เมืองยาง",         area: "นครราชสีมา", machines: 5 },
  { code: "CW-KHONKAEN",   name: "ขอนแก่น",          area: "ขอนแก่น",    machines: 17 },
  { code: "CW-TALADKHAE",  name: "ตลาดแค",           area: "นครราชสีมา", machines: 7 },
  { code: "CW-RANGKAYAI",  name: "รังกาใหญ่",        area: "นครราชสีมา", machines: 5 }, // CONFIRM count
  { code: "CW-PHIMAI",     name: "พิมาย-วังหิน",     area: "นครราชสีมา", machines: 4 },
  { code: "CW-7SEVEN",     name: "ข้างเซเว่นเซน",    area: "นครราชสีมา", machines: 1 },
  { code: "CW-BANKO",      name: "บ้านเกาะ",         area: "นครราชสีมา", machines: 2 },
  { code: "CW-BKK12",      name: "กทม12",            area: "กรุงเทพฯ",   machines: 2 },
  { code: "CW-DONKHWANG2", name: "ดอนขวง2",          area: "นครราชสีมา", machines: 2 },
];

const TAG = "[REAL]"; // distinguishes from [DEMO] rows · not a hide flag

async function main() {
  console.log(`\n=== ClawFleet REAL branch setup · ${new Date().toISOString().slice(0, 10)} ===\n`);
  const org = await prisma.organization.findFirst({ where: { isActive: true } });
  if (!org) throw new Error("no active organization");
  const company = await prisma.company.findFirst({ where: { orgId: org.id } });
  if (!company) throw new Error("no company");
  const admin = await prisma.user.findFirst({ where: { orgId: org.id, role: "super_admin", isActive: true } });
  if (!admin) throw new Error("no super_admin");
  console.log(`org=${org.name} · company=${company.name} · admin=${admin.name}`);

  let branchN = 0, machineN = 0, initialN = 0;

  for (const b of BRANCHES) {
    // upsert branch
    const branch = await prisma.branch.upsert({
      where: { orgId_code: { orgId: org.id, code: b.code } },
      create: {
        orgId: org.id, companyId: company.id, code: b.code, name: b.name,
        businessType: "claw_machine", province: b.area, isActive: true,
      },
      update: { name: b.name, province: b.area, isActive: true },
    });
    branchN++;

    // machines CW-XXX-01..NN
    for (let i = 1; i <= b.machines; i++) {
      const code = `${b.code}-${String(i).padStart(2, "0")}`;
      const start = b.startMeter ?? 0;
      const existing = await prisma.cfMachine.findFirst({ where: { orgId: org.id, code } });
      if (existing) {
        await prisma.cfMachine.update({ where: { id: existing.id }, data: { branchId: branch.id, isActive: true } });
      } else {
        const mc = await prisma.cfMachine.create({
          data: {
            orgId: org.id, branchId: branch.id, code, nickname: `ตู้ ${String(i).padStart(2, "0")}`,
            kind: "CLAW", qrToken: `qr-${code.toLowerCase()}`,
            initialCoinMeter: start, lastCoinMeter: start,
            initialDollMeter: 0, lastDollMeter: 0, lastDollStock: 0,
            installedAt: new Date(), notes: `${TAG} real machine`,
          },
        });
        machineN++;
        // INITIAL event marks the starting meter
        await prisma.cfCollectionEvent.create({
          data: {
            orgId: org.id, sessionId: null, machineId: mc.id, eventType: "INITIAL",
            collectedAt: new Date(), collectedById: admin.id,
            coinMeterBefore: start, coinMeterAfter: start, cashCountedCents: 0,
            dollMeterBefore: 0, dollMeterAfter: 0, stockBefore: 0, stockAfter: 0,
            notes: `${TAG} initial meter`,
          },
        });
        initialN++;
      }
    }
    console.log(`✅ ${b.name} (${b.code}) · ${b.machines} ตู้`);
  }

  const totalMachines = BRANCHES.reduce((a, b) => a + b.machines, 0);
  console.log(`\n=== done · branches=${branchN} · machines created=${machineN} (target ${totalMachines}) · INITIAL events=${initialN} ===`);
  console.log("Visit /clawfleet/v2/hub — real branches now appear.\n");
  process.exit(0);
}
main().catch((e) => { console.error("❌ FAILED:", e); process.exit(1); });
