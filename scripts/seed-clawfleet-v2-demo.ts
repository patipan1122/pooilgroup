/**
 * ClawFleet v2 — branch-shape demo seed (รอบ 61 · 2026-05-28)
 *
 * Populates the BRANCH-based model the v2 redesign reads (lib/clawfleet/v2-queries.ts):
 *   - branch-level sessions (branchId set, groupId null) with cross-check snapshot
 *     columns filled (expectedCashCents / actualCashCents / prize meter vs counted)
 *   - per-machine collection events (coin meter · prize sensor meter · stock · cash · 5 photos)
 *   - a mix of CLOSED (healthy) + ANOMALY_REVIEW (cash short >5%) + OPEN-today sessions
 *   - cf_deliveries rows (central-warehouse shipments)
 *   - sets branch province (area) + manager so v2 cards render area/manager
 *
 * REQUIRES migration 20260528000001_clawfleet_v2_branch_model applied first.
 *
 * Sessions are inserted DIRECTLY at their final status (not OPEN→UPDATE) so the
 * legacy group cross-check trigger (BEFORE UPDATE, group-scoped) never fires on
 * these branch-level rows.
 *
 * Idempotent: deletes prior [DEMO-V2] rows first. Cleanup tag = review_note /
 * reason / note prefixed "[DEMO-V2]", machine code prefix "V2-".
 *
 * Run (AFTER migration applied):
 *   npx tsx -r dotenv/config scripts/seed-clawfleet-v2-demo.ts dotenv_config_path=.env.local
 */

import { prisma } from "@/lib/prisma";

const TAG = "[DEMO-V2]";

const rand = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const daysAgo = (d: number, hour = 17) => {
  const dt = new Date();
  dt.setHours(hour, rand(0, 50), 0, 0);
  dt.setDate(dt.getDate() - d);
  return dt;
};
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

// branch area + manager labels to apply to the demo branches (Thai)
const BRANCH_META = [
  { area: "นครราชสีมา", manager: "น้องเอ" },
  { area: "กรุงเทพฯ", manager: "พี่หนึ่ง" },
  { area: "นนทบุรี", manager: "พี่สอง" },
];

async function main() {
  console.log(`\n=== ClawFleet v2 branch-shape seed · ${new Date().toISOString().slice(0, 10)} ===\n`);

  const org = await prisma.organization.findFirst({ where: { isActive: true } });
  if (!org) throw new Error("no active organization");
  const admin = await prisma.user.findFirst({
    where: { orgId: org.id, role: "super_admin", isActive: true },
  });
  if (!admin) throw new Error("no super_admin");

  let branches = await prisma.branch.findMany({
    where: { orgId: org.id, businessType: "claw_machine", isActive: true },
    orderBy: { code: "asc" },
    take: 3,
  });
  if (branches.length === 0) throw new Error("no claw_machine branch — run seed-clawfleet-demo first or create one");
  console.log(`✅ org=${org.name} · user=${admin.name} · ${branches.length} branches`);

  // ---- idempotent cleanup ----
  await prisma.cfCollectionEvent.deleteMany({ where: { orgId: org.id, notes: { startsWith: TAG } } });
  await prisma.cfCollectionSession.deleteMany({ where: { orgId: org.id, reviewNote: { startsWith: TAG } } });
  await prisma.cfDelivery.deleteMany({ where: { orgId: org.id, note: { startsWith: TAG } } });
  await prisma.cfMachine.deleteMany({ where: { orgId: org.id, code: { startsWith: "V2-" } } });
  console.log("✅ cleaned previous [DEMO-V2] rows");

  // ---- set branch area + manager ----
  for (let i = 0; i < branches.length; i++) {
    const meta = BRANCH_META[i % BRANCH_META.length]!;
    await prisma.branch.update({
      where: { id: branches[i]!.id },
      data: { province: branches[i]!.province ?? meta.area },
    });
  }
  branches = await prisma.branch.findMany({
    where: { id: { in: branches.map((b) => b.id) } },
    orderBy: { code: "asc" },
  });

  let machineCount = 0;
  let sessionCount = 0;
  let eventCount = 0;
  let anomalyCount = 0;
  let openCount = 0;
  let deliveryCount = 0;

  const products = await prisma.cfProduct.findMany({ where: { orgId: org.id, isActive: true }, take: 6 });
  if (products.length < 2) throw new Error("need ≥2 cf_products (run seed-clawfleet-demo first)");

  // photo placeholder url helper (5 photos/machine)
  const photo = (code: string, kind: string) => `demo://v2/${code}/${kind}.webp`;

  for (let bi = 0; bi < branches.length; bi++) {
    const branch = branches[bi]!;
    const nMachines = rand(5, 6);

    // ---- machines (CLAW only · v2 model) ----
    const machines: { id: string; code: string; coin: number; doll: number }[] = [];
    for (let m = 0; m < nMachines; m++) {
      const code = `V2-${branch.code.slice(0, 6)}-${String(m + 1).padStart(2, "0")}`;
      const coin0 = rand(9000, 16000);
      const doll0 = rand(900, 1500);
      const mc = await prisma.cfMachine.create({
        data: {
          orgId: org.id,
          branchId: branch.id,
          code,
          nickname: `${TAG} ตู้ ${String(m + 1).padStart(2, "0")}`,
          kind: "CLAW",
          qrToken: `qr-${code.toLowerCase()}`,
          initialCoinMeter: coin0,
          lastCoinMeter: coin0,
          initialDollMeter: doll0,
          lastDollMeter: doll0,
          lastDollStock: rand(10, 22),
          installedAt: daysAgo(40),
          notes: `${TAG} demo claw`,
        },
      });
      machines.push({ id: mc.id, code, coin: coin0, doll: doll0 });
      machineCount++;
    }

    // ---- 5 historical sessions over 7 days + 1 open today ----
    for (let s = 0; s < 6; s++) {
      const isOpen = s === 5;
      const isAnomaly = s === 2; // 3rd session anomalous (cash short)
      const openedAt = isOpen ? hoursAgo(rand(1, 3)) : daysAgo(6 - s);
      const closedAt = isOpen ? null : new Date(openedAt.getTime() + 45 * 60_000);

      const codeRows = await prisma.$queryRaw<{ code: string }[]>`
        SELECT public.cf_next_session_code(${org.id}::uuid)::text as code`;
      const sessionCode = codeRows[0]?.code ?? `CFS-V2-${Date.now()}-${s}`;

      // per-machine numbers → roll up
      let expectedCash = 0;
      let actualCash = 0;
      let prizeMeterOut = 0;
      let prizeCountedOut = 0;
      const events: {
        machineId: string;
        coinBefore: number; coinAfter: number; cashCents: number;
        dollBefore: number; dollAfter: number; stockBefore: number; stockAfter: number;
        refill: number; flag: boolean; note: string | null;
      }[] = [];

      for (let mi = 0; mi < machines.length; mi++) {
        const mc = machines[mi]!;
        const coinDelta = rand(40, 160); // coin ticks this round
        const coinBefore = mc.coin;
        const coinAfter = coinBefore + coinDelta;
        mc.coin = coinAfter;
        const expCents = coinDelta * 10 * 100; // ฿10/tick
        // healthy: cash ≈ expected (±2%). anomaly: cash short 8-15% on some machines
        let cashCents = expCents;
        let flag = false;
        let note: string | null = null;
        if (isOpen && mi > 0) {
          // open session: only first machine collected so far → skip the rest
          continue;
        }
        if (isAnomaly && mi % 2 === 0) {
          cashCents = Math.round(expCents * (1 - rand(8, 15) / 100));
          flag = true;
          note = `${TAG} เงินน้อยกว่ามิเตอร์`;
        } else {
          cashCents = Math.round(expCents * (1 + rand(-2, 2) / 100));
        }
        // prize sensor delta vs physical
        const dollDelta = rand(4, 12);
        const dollBefore = mc.doll;
        const dollAfter = dollBefore + dollDelta;
        mc.doll = dollAfter;
        const physicalLoss = isAnomaly && mi === 0 ? dollDelta - rand(2, 4) : dollDelta; // prize mismatch on anomaly
        const stockBefore = rand(8, 18);
        const refill = stockBefore - physicalLoss < 5 ? rand(8, 12) : 0;
        const stockAfter = stockBefore - physicalLoss + refill;

        expectedCash += expCents;
        actualCash += cashCents;
        prizeMeterOut += dollDelta;
        prizeCountedOut += physicalLoss;

        events.push({
          machineId: mc.id,
          coinBefore, coinAfter, cashCents,
          dollBefore, dollAfter, stockBefore, stockAfter, refill, flag, note,
        });
      }

      const cashVarianceBps = expectedCash > 0
        ? Math.round(((expectedCash - actualCash) / expectedCash) * 10000)
        : 0;
      const prizeVariance = prizeMeterOut - prizeCountedOut;
      const status = isOpen ? "OPEN" : isAnomaly ? "ANOMALY_REVIEW" : "CLOSED";

      const sess = await prisma.cfCollectionSession.create({
        data: {
          orgId: org.id,
          branchId: branch.id,
          groupId: null,
          sessionCode,
          openedAt,
          openedById: admin.id,
          closedAt,
          closedById: closedAt ? admin.id : null,
          status,
          expectedCashCents: isOpen ? null : expectedCash,
          actualCashCents: isOpen ? null : actualCash,
          cashVarianceBps: isOpen ? null : cashVarianceBps,
          prizeMeterOut: isOpen ? null : prizeMeterOut,
          prizeCountedOut: isOpen ? null : prizeCountedOut,
          prizeVariance: isOpen ? null : prizeVariance,
          totalCashCents: actualCash,
          anomalyFlags: isAnomaly ? ["CASH_SHORT"] : [],
          reviewNote: `${TAG} session ${s + 1}`,
        },
      });
      sessionCount++;
      if (isAnomaly) anomalyCount++;
      if (isOpen) openCount++;

      for (const e of events) {
        await prisma.cfCollectionEvent.create({
          data: {
            orgId: org.id,
            sessionId: sess.id,
            machineId: e.machineId,
            eventType: "COLLECTION",
            collectedAt: new Date(openedAt.getTime() + rand(5, 40) * 60_000),
            collectedById: admin.id,
            coinMeterBefore: e.coinBefore,
            coinMeterAfter: e.coinAfter,
            cashCountedCents: e.cashCents,
            dollMeterBefore: e.dollBefore,
            dollMeterAfter: e.dollAfter,
            stockBefore: e.stockBefore,
            stockAfter: e.stockAfter,
            refillQty: e.refill || null,
            photoMeterBeforeUrl: photo(e.machineId, "coin-before"),
            photoPrizeMeterUrl: photo(e.machineId, "prize-meter"),
            photoCashUrl: photo(e.machineId, "cash"),
            photoMeterAfterUrl: photo(e.machineId, "coin-after"),
            photoStockUrl: photo(e.machineId, "stock"),
            anomalyFlags: e.flag ? ["PRIZE_MISMATCH"] : [],
            notes: e.note ?? `${TAG} collection`,
          },
        });
        eventCount++;
      }
    }

    // ---- deliveries ----
    for (let d = 0; d < rand(1, 2); d++) {
      await prisma.cfDelivery.create({
        data: {
          orgId: org.id,
          branchId: branch.id,
          status: d === 0 ? "IN_TRANSIT" : "SCHEDULED",
          fromLocation: "คลังกลาง บางนา",
          eta: new Date(Date.now() + (d + 1) * 86_400_000),
          itemsCount: rand(4, 8),
          unitsCount: rand(120, 320),
          note: `${TAG} delivery`,
          createdById: admin.id,
        },
      });
      deliveryCount++;
    }
  }

  console.log(`✅ machines ${machineCount} · sessions ${sessionCount} (anomaly ${anomalyCount} · open ${openCount}) · events ${eventCount} · deliveries ${deliveryCount}`);
  console.log("\nVisit /clawfleet/v2/hub — should now show REAL branch data.\n");
  process.exit(0);
}

main().catch((e) => {
  console.error("❌ SEED FAILED:", e);
  process.exit(1);
});
