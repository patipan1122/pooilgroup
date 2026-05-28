/**
 * ClawFleet — Demo data seed (CEO request 2026-05-27)
 *
 * Populates the ClawFleet module with realistic data so CEO can navigate
 * /clawfleet/hub · /operations · /insights · /setup and SEE every feature work.
 *
 * What it creates:
 *  - 2 new claw_machine branches (DM-BR-01 · DM-BR-02) on top of any existing
 *  - 4 token-exchange groups · 4 exchanger + 16 claw machines (20 total)
 *  - Active loadouts for every machine (1 product/CLAW · base rate + promo for EX)
 *  - Initial INITIAL events to set starting meters
 *  - 14 days of history per group:
 *      ~5-7 CLOSED healthy sessions/group (cross-check passes)
 *      1 ANOMALY_REVIEW session (cross-check fails · variance > 5%)
 *      1 OPEN session today (mid-collection · for Hub action card)
 *  - Stock movements: RECEIVE (warehouse) + LOAD_TO_MACHINE per claw
 *
 * Idempotent: deletes existing rows where code/name has [DEMO] tag or DM- prefix.
 *
 * Cleanup (one-shot SQL):
 *   DELETE FROM cf_collection_events WHERE notes LIKE '[DEMO]%';
 *   DELETE FROM cf_collection_sessions WHERE review_note LIKE '[DEMO]%' OR opened_by_id = '<demo user>';
 *   DELETE FROM cf_stock_movements WHERE reason LIKE '[DEMO]%';
 *   DELETE FROM cf_machine_loadouts WHERE notes LIKE '[DEMO]%';
 *   DELETE FROM cf_exchanger_loadouts WHERE notes LIKE '[DEMO]%';
 *   DELETE FROM cf_machine_groups WHERE name LIKE '[DEMO]%';
 *   DELETE FROM cf_machines WHERE code LIKE 'DM-%';
 *   DELETE FROM branches WHERE code LIKE 'DM-BR-%';
 *
 * Run:
 *   npx tsx -r dotenv/config scripts/seed-clawfleet-demo.ts dotenv_config_path=.env.local
 */

import { prisma } from "@/lib/prisma";

const DEMO_TAG = "[DEMO]";
const STAMP = new Date().toISOString().slice(0, 10);

type Step = { label: string; count?: number };
const log: Step[] = [];
const tick = (label: string, count?: number) => {
  log.push({ label, count });
  console.log(`✅ ${label}${count !== undefined ? ` (${count})` : ""}`);
};

// ---- helpers ----
const daysAgo = (d: number) => {
  const dt = new Date();
  dt.setUTCHours(10, 0, 0, 0); // 10am UTC = 5pm ICT typical collection time
  dt.setUTCDate(dt.getUTCDate() - d);
  return dt;
};
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);
const rand = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;
const choice = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]!;

async function main() {
  console.log(`\n=== ClawFleet Demo Seed · ${STAMP} ===\n`);

  // ---- 0. Find org · user · company ----
  const org = await prisma.organization.findFirst({ where: { isActive: true } });
  if (!org) throw new Error("no active organization");
  const company = await prisma.company.findFirst({ where: { orgId: org.id } });
  if (!company) throw new Error("no company");
  const admin = await prisma.user.findFirst({
    where: { orgId: org.id, role: "super_admin", isActive: true },
  });
  if (!admin) throw new Error("no super_admin");
  tick(`org=${org.name} · user=${admin.name} · company=${company.name}`);

  // ---- 1. Idempotent cleanup ----
  await prisma.cfStockMovement.deleteMany({
    where: { orgId: org.id, reason: { startsWith: DEMO_TAG } },
  });
  await prisma.cfCollectionEvent.deleteMany({
    where: { orgId: org.id, notes: { startsWith: DEMO_TAG } },
  });
  await prisma.cfCollectionSession.deleteMany({
    where: { orgId: org.id, reviewNote: { startsWith: DEMO_TAG } },
  });
  await prisma.cfMachineLoadout.deleteMany({
    where: { orgId: org.id, notes: { startsWith: DEMO_TAG } },
  });
  await prisma.cfExchangerLoadout.deleteMany({
    where: { orgId: org.id, notes: { startsWith: DEMO_TAG } },
  });
  // detach machines from groups first so we can drop both
  await prisma.cfMachineGroup.updateMany({
    where: { orgId: org.id, name: { startsWith: DEMO_TAG } },
    data: { exchangerId: null },
  });
  await prisma.cfMachine.updateMany({
    where: { orgId: org.id, code: { startsWith: "DM-" } },
    data: { groupId: null },
  });
  await prisma.cfMachineGroup.deleteMany({
    where: { orgId: org.id, name: { startsWith: DEMO_TAG } },
  });
  await prisma.cfMachine.deleteMany({
    where: { orgId: org.id, code: { startsWith: "DM-" } },
  });
  await prisma.branch.deleteMany({
    where: { orgId: org.id, code: { startsWith: "DM-BR-" } },
  });
  tick("Cleaned previous demo rows");

  // ---- 2. Branches (2 new demo + reuse 1 existing) ----
  const existingBranch = await prisma.branch.findFirst({
    where: { orgId: org.id, businessType: "claw_machine", isActive: true },
  });
  const branchA =
    existingBranch ??
    (await prisma.branch.create({
      data: {
        orgId: org.id,
        companyId: company.id,
        code: "DM-BR-00",
        name: `${DEMO_TAG} ตู้คีบ สาขาแรก (auto)`,
        businessType: "claw_machine",
      },
    }));
  const branchB = await prisma.branch.create({
    data: {
      orgId: org.id,
      companyId: company.id,
      code: "DM-BR-01",
      name: `${DEMO_TAG} ตู้คีบ เซ็นทรัลปิ่นเกล้า`,
      businessType: "claw_machine",
    },
  });
  const branchC = await prisma.branch.create({
    data: {
      orgId: org.id,
      companyId: company.id,
      code: "DM-BR-02",
      name: `${DEMO_TAG} ตู้คีบ ตลาดบางใหญ่`,
      businessType: "claw_machine",
    },
  });
  tick(`Branches ready: ${branchA.name}, ${branchB.name}, ${branchC.name}`);

  // ---- 3. Reuse existing products ----
  const products = await prisma.cfProduct.findMany({
    where: { orgId: org.id, isActive: true },
  });
  if (products.length < 4) throw new Error("need at least 4 seeded products");
  tick(`Loaded ${products.length} products`);

  // ---- 4. Machines (1 EX + N CLAW per group) ----
  type MachinePlan = {
    branchId: string;
    branchName: string;
    groupName: string;
    exchangerCode: string;
    clawCodes: string[];
    initialCoinMeterEx: number;
    initialCoinMeterClaws: number[];
    initialDollMeterClaws: number[];
  };
  const plans: MachinePlan[] = [
    {
      branchId: branchA.id,
      branchName: branchA.name,
      groupName: "โซน A · หน้าทางเข้า",
      exchangerCode: "DM-EX-A1",
      clawCodes: ["DM-CW-A101", "DM-CW-A102", "DM-CW-A103", "DM-CW-A104", "DM-CW-A105"],
      initialCoinMeterEx: 12_400,
      initialCoinMeterClaws: [2_310, 2_180, 1_960, 1_820, 2_050],
      initialDollMeterClaws: [185, 168, 142, 130, 155],
    },
    {
      branchId: branchB.id,
      branchName: branchB.name,
      groupName: "โซน B · ข้างฟู้ดคอร์ท",
      exchangerCode: "DM-EX-B1",
      clawCodes: ["DM-CW-B101", "DM-CW-B102", "DM-CW-B103", "DM-CW-B104"],
      initialCoinMeterEx: 8_900,
      initialCoinMeterClaws: [1_540, 1_420, 1_330, 1_280],
      initialDollMeterClaws: [120, 105, 98, 92],
    },
    {
      branchId: branchC.id,
      branchName: branchC.name,
      groupName: "โซน C · ชั้น G",
      exchangerCode: "DM-EX-C1",
      clawCodes: ["DM-CW-C101", "DM-CW-C102", "DM-CW-C103", "DM-CW-C104"],
      initialCoinMeterEx: 9_700,
      initialCoinMeterClaws: [1_680, 1_590, 1_410, 1_450],
      initialDollMeterClaws: [134, 122, 110, 115],
    },
    {
      branchId: branchC.id,
      branchName: branchC.name,
      groupName: "โซน D · ชั้น 2 มุมเด็ก",
      exchangerCode: "DM-EX-C2",
      clawCodes: ["DM-CW-C201", "DM-CW-C202", "DM-CW-C203"],
      initialCoinMeterEx: 6_200,
      initialCoinMeterClaws: [980, 1_050, 920],
      initialDollMeterClaws: [78, 84, 71],
    },
  ];

  type CreatedGroup = {
    groupId: string;
    exchangerId: string;
    branchId: string;
    branchName: string;
    name: string;
    clawIds: string[];
    clawCodes: string[];
    clawProductIds: string[];
    clawPriceCoins: number[];
  };
  const groups: CreatedGroup[] = [];

  for (const p of plans) {
    // create EX machine
    const ex = await prisma.cfMachine.create({
      data: {
        orgId: org.id,
        branchId: p.branchId,
        code: p.exchangerCode,
        nickname: `${DEMO_TAG} EX ${p.groupName}`,
        kind: "EXCHANGER",
        qrToken: `qr-${p.exchangerCode.toLowerCase()}`,
        initialCoinMeter: p.initialCoinMeterEx,
        lastCoinMeter: p.initialCoinMeterEx,
        installedAt: daysAgo(45),
        notes: `${DEMO_TAG} demo exchanger`,
      },
    });

    // create CLAW machines
    const clawIds: string[] = [];
    for (let i = 0; i < p.clawCodes.length; i++) {
      const claw = await prisma.cfMachine.create({
        data: {
          orgId: org.id,
          branchId: p.branchId,
          code: p.clawCodes[i]!,
          nickname: `${DEMO_TAG} CLAW ${i + 1}`,
          kind: "CLAW",
          qrToken: `qr-${p.clawCodes[i]!.toLowerCase()}`,
          initialCoinMeter: p.initialCoinMeterClaws[i]!,
          lastCoinMeter: p.initialCoinMeterClaws[i]!,
          initialDollMeter: p.initialDollMeterClaws[i]!,
          lastDollMeter: p.initialDollMeterClaws[i]!,
          lastDollStock: rand(8, 18),
          installedAt: daysAgo(45),
          notes: `${DEMO_TAG} demo claw`,
        },
      });
      clawIds.push(claw.id);
    }

    // create group · attach EX
    const group = await prisma.cfMachineGroup.create({
      data: {
        orgId: org.id,
        branchId: p.branchId,
        name: `${DEMO_TAG} ${p.groupName}`,
        exchangerId: ex.id,
        toleranceBps: 500, // 5%
      },
    });

    // attach claws to group
    await prisma.cfMachine.updateMany({
      where: { id: { in: clawIds } },
      data: { groupId: group.id },
    });

    // EX loadout · base rate 1฿=1coin + promo tiers
    await prisma.cfExchangerLoadout.create({
      data: {
        orgId: org.id,
        machineId: ex.id,
        baseCoinPerBaht: 1.0,
        promoTiers: [
          { thb: 100, coins: 12 },
          { thb: 500, coins: 65 },
          { thb: 1000, coins: 140 },
        ],
        setById: admin.id,
        notes: `${DEMO_TAG} initial loadout`,
      },
    });

    // CLAW loadouts · assign product + price
    const clawProductIds: string[] = [];
    const clawPriceCoins: number[] = [];
    for (let i = 0; i < clawIds.length; i++) {
      const product = products[i % products.length]!;
      const price = product.defaultPriceCoins;
      await prisma.cfMachineLoadout.create({
        data: {
          orgId: org.id,
          machineId: clawIds[i]!,
          productId: product.id,
          pricePerPlayCoins: price,
          setById: admin.id,
          notes: `${DEMO_TAG} initial loadout`,
        },
      });
      clawProductIds.push(product.id);
      clawPriceCoins.push(price);
    }

    groups.push({
      groupId: group.id,
      exchangerId: ex.id,
      branchId: p.branchId,
      branchName: p.branchName,
      name: group.name,
      clawIds,
      clawCodes: p.clawCodes,
      clawProductIds,
      clawPriceCoins,
    });
    tick(`Group built: ${group.name} (1 EX + ${clawIds.length} CLAW)`);
  }

  // ---- 5. INITIAL events (mark starting meter · so reports have origin) ----
  let initialCount = 0;
  for (const g of groups) {
    for (let i = 0; i < g.clawIds.length; i++) {
      await prisma.cfCollectionEvent.create({
        data: {
          orgId: org.id,
          sessionId: null,
          machineId: g.clawIds[i]!,
          eventType: "INITIAL",
          collectedAt: daysAgo(30),
          collectedById: admin.id,
          coinMeterBefore: 0,
          coinMeterAfter: 0, // INITIAL just marks origin · no movement
          cashCountedCents: 0,
          dollMeterBefore: 0,
          dollMeterAfter: 0,
          stockBefore: 0,
          stockAfter: 12,
          notes: `${DEMO_TAG} initial install`,
        },
      });
      initialCount++;
    }
  }
  tick("INITIAL events", initialCount);

  // ---- 6. Stock movements: RECEIVE warehouse + LOAD per claw ----
  let stockCount = 0;
  for (const g of groups) {
    // RECEIVE each product (last 14 days, 1 per product)
    for (const product of products.slice(0, 4)) {
      await prisma.cfStockMovement.create({
        data: {
          orgId: org.id,
          branchId: g.branchId,
          type: "RECEIVE",
          productId: product.id,
          machineId: null,
          qty: rand(50, 120),
          unitCostCents: product.unitCostCents,
          occurredAt: daysAgo(rand(10, 14)),
          createdById: admin.id,
          reason: `${DEMO_TAG} stock receive from supplier`,
        },
      });
      stockCount++;
    }
    // LOAD initial fill per claw
    for (let i = 0; i < g.clawIds.length; i++) {
      await prisma.cfStockMovement.create({
        data: {
          orgId: org.id,
          branchId: g.branchId,
          type: "LOAD_TO_MACHINE",
          productId: g.clawProductIds[i]!,
          machineId: g.clawIds[i]!,
          qty: -12, // moving 12 out of warehouse into machine
          occurredAt: daysAgo(28),
          createdById: admin.id,
          reason: `${DEMO_TAG} initial machine load`,
        },
      });
      stockCount++;
    }
  }
  tick("Stock movements", stockCount);

  // ---- 7. Historical sessions · CLOSED healthy ----
  let sessionCount = 0;
  let eventCount = 0;
  let anomalyCount = 0;
  let openCount = 0;

  for (const g of groups) {
    // Track running meter state per machine
    const exMeter = { v: 0 };
    const clawMeters = g.clawIds.map(() => ({ coin: 0, doll: 0 }));

    // 6 closed sessions over last 14 days
    for (let s = 0; s < 6; s++) {
      const sessionAt = daysAgo(14 - s * 2);
      const closedAt = new Date(sessionAt.getTime() + 45 * 60_000); // 45min later

      // generate session_code via RPC
      const codeRows = await prisma.$queryRaw<{ code: string }[]>`
        SELECT public.cf_next_session_code(${org.id}::uuid)::text as code
      `;
      const sessionCode = codeRows[0]?.code ?? `CFS-DEMO-${Date.now()}`;

      // Decide if this session has anomaly (1 out of 6 per group)
      const isAnomaly = s === 3; // 4th session = anomalous

      // EX dispensed coins this session
      const exCoinsOut = rand(450, 750);

      // Distribute coins across claws (with small natural variance ±3%)
      let totalClawCoinsIn = 0;
      const clawCoinsIn: number[] = [];
      for (let i = 0; i < g.clawIds.length; i++) {
        const share = Math.floor(exCoinsOut / g.clawIds.length);
        const jitter = rand(-Math.floor(share * 0.05), Math.floor(share * 0.05));
        const coins = Math.max(50, share + jitter);
        clawCoinsIn.push(coins);
        totalClawCoinsIn += coins;
      }
      // For anomaly: make claws receive WAY LESS than EX dispensed (10-15% variance)
      if (isAnomaly) {
        for (let i = 0; i < clawCoinsIn.length; i++) {
          clawCoinsIn[i] = Math.floor(clawCoinsIn[i]! * 0.85);
        }
        totalClawCoinsIn = clawCoinsIn.reduce((a, b) => a + b, 0);
      }

      // Open session as OPEN first
      const session = await prisma.cfCollectionSession.create({
        data: {
          orgId: org.id,
          groupId: g.groupId,
          sessionCode,
          openedAt: sessionAt,
          openedById: admin.id,
          status: "OPEN",
          reviewNote: `${DEMO_TAG} demo session ${s + 1}`,
        },
      });

      // EX event
      exMeter.v += exCoinsOut;
      const exBefore = exMeter.v - exCoinsOut;
      await prisma.cfCollectionEvent.create({
        data: {
          orgId: org.id,
          sessionId: session.id,
          machineId: g.exchangerId,
          eventType: "COLLECTION",
          collectedAt: new Date(sessionAt.getTime() + 5 * 60_000),
          collectedById: admin.id,
          coinMeterBefore: exBefore,
          coinMeterAfter: exMeter.v,
          cashCountedCents: exCoinsOut * 10_00, // ฿10/coin baseline
          promoCoinsDispensed: Math.floor(exCoinsOut * 0.08),
          notes: `${DEMO_TAG} EX collection`,
        },
      });
      eventCount++;

      // CLAW events
      let sessionCashTotal = exCoinsOut * 10_00;
      for (let i = 0; i < g.clawIds.length; i++) {
        const coinIn = clawCoinsIn[i]!;
        const before = clawMeters[i]!.coin;
        clawMeters[i]!.coin += coinIn;
        const after = clawMeters[i]!.coin;

        // dolls dispensed = coinIn / pricePerPlay / chance-of-win (15-25%)
        const plays = Math.floor(coinIn / g.clawPriceCoins[i]!);
        const winRate = rand(15, 25) / 100;
        const dolls = Math.max(1, Math.floor(plays * winRate));
        const dollBefore = clawMeters[i]!.doll;
        clawMeters[i]!.doll += dolls;
        const dollAfter = clawMeters[i]!.doll;

        const stockBefore = rand(8, 14);
        const stockAfter = Math.max(2, stockBefore - dolls);
        const refillQty = stockAfter < 5 ? rand(8, 12) : 0;

        await prisma.cfCollectionEvent.create({
          data: {
            orgId: org.id,
            sessionId: session.id,
            machineId: g.clawIds[i]!,
            eventType: "COLLECTION",
            collectedAt: new Date(sessionAt.getTime() + (10 + i * 5) * 60_000),
            collectedById: admin.id,
            coinMeterBefore: before,
            coinMeterAfter: after,
            cashCountedCents: 0, // claws don't take cash directly · only coins
            dollMeterBefore: dollBefore,
            dollMeterAfter: dollAfter,
            stockBefore,
            stockAfter: stockAfter + refillQty,
            refillQty: refillQty || null,
            notes: `${DEMO_TAG} CLAW collection`,
          },
        });
        eventCount++;
      }

      // Close the session → trigger fires and computes variance + status
      await prisma.cfCollectionSession.update({
        where: { id: session.id },
        data: {
          status: "CLOSED", // trigger may rewrite to ANOMALY_REVIEW
          closedAt,
          closedById: admin.id,
          totalCashCents: sessionCashTotal,
        },
      });

      if (isAnomaly) anomalyCount++;
      sessionCount++;
    }

    // ---- 7b. ONE OPEN session today (mid-collection · for Hub action card) ----
    const todayCodeRows = await prisma.$queryRaw<{ code: string }[]>`
      SELECT public.cf_next_session_code(${org.id}::uuid)::text as code
    `;
    const todayCode = todayCodeRows[0]?.code ?? `CFS-DEMO-OPEN-${Date.now()}`;
    const openSession = await prisma.cfCollectionSession.create({
      data: {
        orgId: org.id,
        groupId: g.groupId,
        sessionCode: todayCode,
        openedAt: hoursAgo(rand(1, 3)),
        openedById: admin.id,
        status: "OPEN",
        reviewNote: `${DEMO_TAG} in-progress demo`,
      },
    });

    // Only EX event submitted so far · claws pending
    const openExOut = rand(380, 520);
    exMeter.v += openExOut;
    await prisma.cfCollectionEvent.create({
      data: {
        orgId: org.id,
        sessionId: openSession.id,
        machineId: g.exchangerId,
        eventType: "COLLECTION",
        collectedAt: hoursAgo(1),
        collectedById: admin.id,
        coinMeterBefore: exMeter.v - openExOut,
        coinMeterAfter: exMeter.v,
        cashCountedCents: openExOut * 10_00,
        promoCoinsDispensed: Math.floor(openExOut * 0.08),
        notes: `${DEMO_TAG} EX collection in-progress`,
      },
    });
    eventCount++;
    openCount++;
    sessionCount++;
  }
  tick("Historical sessions", sessionCount);
  tick("  - of which ANOMALY_REVIEW", anomalyCount);
  tick("  - of which OPEN today", openCount);
  tick("Collection events total", eventCount);

  // ---- 8. Summary ----
  const final = {
    branches: await prisma.branch.count({
      where: { orgId: org.id, businessType: "claw_machine" },
    }),
    machines: await prisma.cfMachine.count({ where: { orgId: org.id } }),
    groups: await prisma.cfMachineGroup.count({ where: { orgId: org.id } }),
    sessions: await prisma.cfCollectionSession.count({ where: { orgId: org.id } }),
    events: await prisma.cfCollectionEvent.count({ where: { orgId: org.id } }),
    stockMoves: await prisma.cfStockMovement.count({ where: { orgId: org.id } }),
    sessionsByStatus: await prisma.cfCollectionSession.groupBy({
      by: ["status"],
      where: { orgId: org.id },
      _count: { _all: true },
    }),
  };

  console.log("\n=== Final DB state ===");
  console.log(JSON.stringify(final, null, 2));
  console.log("\n=== Visit ===");
  console.log("  /clawfleet/hub        (morning launcher)");
  console.log("  /clawfleet/operations (sessions + anomalies)");
  console.log("  /clawfleet/insights   (7-view explorer)");
  console.log("  /clawfleet/setup      (machines · products · users)");
  console.log("");
  process.exit(0);
}

main().catch((e) => {
  console.error("\n❌ SEED FAILED:", e);
  process.exit(1);
});
