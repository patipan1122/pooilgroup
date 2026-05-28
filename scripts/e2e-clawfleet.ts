/**
 * ClawFleet — End-to-End Integration Test against PRODUCTION DB
 *
 * Exercises every critical path:
 *   1. Create claw_machine branch (if missing)
 *   2. Create exchanger + 3 claw machines
 *   3. Create group · attach exchanger + claws
 *   4. Set loadouts (CLAW: product+price · EX: rate+promo)
 *   5. Start session
 *   6. Submit 4 collection events (1 EX + 3 CLAW)
 *   7. Close session → verify cross-check trigger fires
 *   8. Submit stock-receive movement
 *   9. Cleanup: delete everything created
 *
 * Run: npx tsx -r dotenv/config scripts/e2e-clawfleet.ts dotenv_config_path=.env.local
 */

import { prisma } from "@/lib/prisma";

const STAMP = Date.now().toString().slice(-6);

type Step = { label: string; pass: boolean; detail?: string };
const results: Step[] = [];

function record(label: string, pass: boolean, detail?: string) {
  results.push({ label, pass, detail });
  const icon = pass ? "✅" : "❌";
  console.log(`${icon} ${label}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  console.log("=== ClawFleet E2E test on PROD DB ===");
  console.log(`stamp: ${STAMP}`);

  // ---- 0. Find existing org + user + company ----
  const org = await prisma.organization.findFirst({
    where: { isActive: true },
    include: { companies: { take: 1 } },
  });
  if (!org) throw new Error("no active organization");
  const user = await prisma.user.findFirst({
    where: { orgId: org.id, isActive: true, role: "super_admin" },
  });
  if (!user) throw new Error("no super_admin user");
  const company = org.companies[0];
  if (!company) throw new Error("no company");
  record("0. Find org/user/company", true, `${org.name} · ${user.name}`);

  // ---- 1. Find or create claw_machine branch ----
  let branch = await prisma.branch.findFirst({
    where: { orgId: org.id, businessType: "claw_machine", isActive: true },
  });
  let createdBranch = false;
  if (!branch) {
    branch = await prisma.branch.create({
      data: {
        orgId: org.id,
        companyId: company.id,
        code: `E2E-CW-${STAMP}`,
        name: `E2E ClawFleet Test ${STAMP}`,
        businessType: "claw_machine",
      },
    });
    createdBranch = true;
    record("1. Create test claw_machine branch", true, branch.code);
  } else {
    record("1. Use existing claw_machine branch", true, branch.code);
  }

  const createdMachineIds: string[] = [];
  const createdLoadoutIds: string[] = [];
  const createdExchLoadoutIds: string[] = [];
  let createdGroupId: string | null = null;
  let createdSessionId: string | null = null;
  const createdEventIds: string[] = [];
  const createdStockMoveIds: string[] = [];

  try {
    // ---- 2. Get a product (use seeded) ----
    const product = await prisma.cfProduct.findFirst({
      where: { orgId: org.id, isActive: true, sku: "PLUSH-BEAR" },
    });
    if (!product) throw new Error("no seeded product PLUSH-BEAR");
    record("2. Use seeded product PLUSH-BEAR", true, product.name);

    // ---- 3. Create 1 EX + 3 CLAW machines ----
    const ex = await prisma.cfMachine.create({
      data: {
        orgId: org.id,
        branchId: branch.id,
        code: `E2E-EX-${STAMP}`,
        kind: "EXCHANGER",
        qrToken: `qr-ex-${STAMP}`,
        initialCoinMeter: 1000,
        lastCoinMeter: 1000,
      },
    });
    createdMachineIds.push(ex.id);

    const claws: { id: string; code: string; lastCoinMeter: number; lastDollMeter: number }[] = [];
    for (let i = 1; i <= 3; i++) {
      const c = await prisma.cfMachine.create({
        data: {
          orgId: org.id,
          branchId: branch.id,
          code: `E2E-CW${i}-${STAMP}`,
          kind: "CLAW",
          qrToken: `qr-cw${i}-${STAMP}`,
          initialCoinMeter: 500 * i,
          initialDollMeter: 100 * i,
          lastCoinMeter: 500 * i,
          lastDollMeter: 100 * i,
          lastDollStock: 30,
        },
      });
      createdMachineIds.push(c.id);
      claws.push({ id: c.id, code: c.code, lastCoinMeter: c.lastCoinMeter, lastDollMeter: c.lastDollMeter });
    }
    record("3. Create 1 EXCHANGER + 3 CLAW machines", true, `${createdMachineIds.length} total`);

    // ---- 4. Verify partial-unique constraint on QR token works ----
    let dupRejected = false;
    try {
      await prisma.cfMachine.create({
        data: {
          orgId: org.id,
          branchId: branch.id,
          code: `E2E-DUP-${STAMP}`,
          kind: "CLAW",
          qrToken: `qr-ex-${STAMP}`, // duplicate
          initialCoinMeter: 0,
          lastCoinMeter: 0,
        },
      });
    } catch {
      dupRejected = true;
    }
    record("4. Reject duplicate qrToken (unique constraint)", dupRejected);

    // ---- 5. Create group + link exchanger ----
    const group = await prisma.cfMachineGroup.create({
      data: {
        orgId: org.id,
        branchId: branch.id,
        name: `E2E Group ${STAMP}`,
        exchangerId: ex.id,
        toleranceBps: 500,
      },
    });
    createdGroupId = group.id;
    // Attach all machines to group
    await prisma.cfMachine.updateMany({
      where: { id: { in: createdMachineIds } },
      data: { groupId: group.id },
    });
    record("5. Create group + attach 4 machines", true, group.name);

    // ---- 6. Set loadouts ----
    for (const c of claws) {
      const l = await prisma.cfMachineLoadout.create({
        data: {
          orgId: org.id,
          machineId: c.id,
          productId: product.id,
          pricePerPlayCoins: 1,
          setById: user.id,
        },
      });
      createdLoadoutIds.push(l.id);
    }
    const exLoadout = await prisma.cfExchangerLoadout.create({
      data: {
        orgId: org.id,
        machineId: ex.id,
        baseCoinPerBaht: 1.0,
        promoTiers: [{ thb: 100, coins: 11 }],
        setById: user.id,
      },
    });
    createdExchLoadoutIds.push(exLoadout.id);
    record("6. Set loadouts (3 CLAW + 1 EX with promo)", true);

    // ---- 7. Verify partial-unique: cannot have 2 active loadouts per machine ----
    let loadoutDupRejected = false;
    try {
      await prisma.cfMachineLoadout.create({
        data: {
          orgId: org.id,
          machineId: claws[0].id,
          productId: product.id,
          pricePerPlayCoins: 2,
          setById: user.id,
        },
      });
    } catch {
      loadoutDupRejected = true;
    }
    record("7. Reject 2nd active loadout per machine (partial unique)", loadoutDupRejected);

    // ---- 8. Start session via RPC ----
    const sessionCodeRow = await prisma.$queryRaw<{ code: string }[]>`
      SELECT public.cf_next_session_code(${org.id}::uuid)::text as code
    `;
    const session = await prisma.cfCollectionSession.create({
      data: {
        orgId: org.id,
        groupId: group.id,
        sessionCode: sessionCodeRow[0].code,
        openedById: user.id,
        status: "OPEN",
      },
    });
    createdSessionId = session.id;
    record("8. Start session", true, session.sessionCode);

    // ---- 9. Reject opening 2nd OPEN session for same group ----
    let raceRejected = false;
    try {
      await prisma.cfCollectionSession.create({
        data: {
          orgId: org.id,
          groupId: group.id,
          sessionCode: `${session.sessionCode}-dup`,
          openedById: user.id,
          status: "OPEN",
        },
      });
    } catch {
      raceRejected = true;
    }
    record("9. Reject 2nd OPEN session per group (race protection)", raceRejected);

    // ---- 10. Submit 4 collection events ----
    // EX dispenses 100 coins (1000 → 1100), receives ฿1000 in cash
    const evEx = await prisma.cfCollectionEvent.create({
      data: {
        orgId: org.id,
        sessionId: session.id,
        machineId: ex.id,
        eventType: "COLLECTION",
        collectedAt: new Date(),
        collectedById: user.id,
        coinMeterBefore: ex.lastCoinMeter,
        coinMeterAfter: ex.lastCoinMeter + 100,
        cashCountedCents: 100000, // ฿1000
        photoMeterBeforeUrl: "https://test/meter1.webp",
        photoCashUrl: "https://test/cash.webp",
        photoMeterAfterUrl: "https://test/meter2.webp",
      },
    });
    createdEventIds.push(evEx.id);

    // 3 CLAW receive 30+35+33 = 98 coins total (close to 100 = within 5% tolerance)
    const clawCoinDeltas = [30, 35, 33];
    for (let i = 0; i < claws.length; i++) {
      const c = claws[i];
      const delta = clawCoinDeltas[i];
      const ev = await prisma.cfCollectionEvent.create({
        data: {
          orgId: org.id,
          sessionId: session.id,
          machineId: c.id,
          eventType: "COLLECTION",
          collectedAt: new Date(),
          collectedById: user.id,
          coinMeterBefore: c.lastCoinMeter,
          coinMeterAfter: c.lastCoinMeter + delta,
          cashCountedCents: delta * 1000, // ฿10/เหรียญ
          dollMeterBefore: c.lastDollMeter,
          dollMeterAfter: c.lastDollMeter + 3,
          stockBefore: 30,
          stockAfter: 27,
          refillQty: 0,
          photoMeterBeforeUrl: `https://test/c${i}m1.webp`,
          photoCashUrl: `https://test/c${i}cash.webp`,
          photoMeterAfterUrl: `https://test/c${i}m2.webp`,
          photoStockUrl: `https://test/c${i}stock.webp`,
        },
      });
      createdEventIds.push(ev.id);
    }
    record("10. Submit 4 events (1 EX + 3 CLAW)", true, `${createdEventIds.length} events`);

    // ---- 11. Verify generated columns computed ----
    const evRow = await prisma.$queryRaw<{ coins_delta: number; dolls_delta: number; doll_variance: number }[]>`
      SELECT coins_delta, dolls_delta, doll_variance FROM cf_collection_events WHERE id = ${createdEventIds[1]}::uuid
    `;
    const ok11 = evRow[0].coins_delta === 30 && evRow[0].dolls_delta === 3;
    record("11. Generated columns computed (coins_delta=30, dolls_delta=3)", ok11, JSON.stringify(evRow[0]));

    // ---- 12. Reject duplicate event for same (session, machine) ----
    let evDupRejected = false;
    try {
      await prisma.cfCollectionEvent.create({
        data: {
          orgId: org.id,
          sessionId: session.id,
          machineId: claws[0].id, // already collected
          eventType: "COLLECTION",
          collectedAt: new Date(),
          collectedById: user.id,
          coinMeterBefore: 0,
          coinMeterAfter: 0,
          cashCountedCents: 0,
        },
      });
    } catch {
      evDupRejected = true;
    }
    record("12. Reject duplicate event (session, machine) [partial unique]", evDupRejected);

    // ---- 13. Verify machine mirror updated by AFTER INSERT trigger ----
    const claw1 = await prisma.cfMachine.findUnique({ where: { id: claws[0].id } });
    const ok13 =
      claw1?.lastCoinMeter === claws[0].lastCoinMeter + 30 &&
      claw1?.lastDollMeter === claws[0].lastDollMeter + 3;
    record(
      "13. Machine mirror updated by trigger (lastCoinMeter+30, lastDollMeter+3)",
      ok13,
      `last_coin=${claw1?.lastCoinMeter} last_doll=${claw1?.lastDollMeter}`,
    );

    // ---- 14. Close session → trigger cross-check fires ----
    await prisma.cfCollectionSession.update({
      where: { id: session.id },
      data: { status: "CLOSED", closedById: user.id },
    });
    const closed = await prisma.cfCollectionSession.findUnique({ where: { id: session.id } });
    const expectedOut = 100; // EX dispensed
    const expectedIn = 30 + 35 + 33; // 98
    const expectedVarianceBps = Math.round(((expectedIn - expectedOut) * 10000) / expectedOut); // -200
    const ok14 =
      closed?.status === "CLOSED" || closed?.status === "ANOMALY_REVIEW";
    record(
      "14. Close session → trigger fires",
      ok14,
      `status=${closed?.status} out=${closed?.exchangerCoinsOut} in=${closed?.clawCoinsIn} variance_bps=${closed?.coinVarianceBps}`,
    );
    const ok14b =
      closed?.exchangerCoinsOut === expectedOut &&
      closed?.clawCoinsIn === expectedIn &&
      closed?.coinVarianceBps === expectedVarianceBps;
    record("14b. Cross-check math correct (out=100, in=98, var=-200bps=-2%)", ok14b);

    // Since |200| < 500 tolerance → status should be CLOSED, no flag
    const ok14c = closed?.status === "CLOSED" && (closed?.anomalyFlags ?? []).length === 0;
    record("14c. Within tolerance (2% < 5%) → CLOSED, no flags", ok14c);

    // ---- 15. Stock movement (RECEIVE) ----
    const move = await prisma.cfStockMovement.create({
      data: {
        orgId: org.id,
        branchId: branch.id,
        type: "RECEIVE",
        productId: product.id,
        qty: 100,
        unitCostCents: 4500,
        occurredAt: new Date(),
        createdById: user.id,
        reason: "E2E test receive",
      },
    });
    createdStockMoveIds.push(move.id);
    record("15. Stock movement RECEIVE qty=100", true);

    // ---- 16. RLS sanity: superadmin can see all rows ----
    const cnt = await prisma.cfMachine.count({ where: { orgId: org.id } });
    record("16. RLS allows super_admin to count machines", cnt > 0, `count=${cnt}`);

    // ---- 17. Total cash sum from generated columns ----
    const cashSum = await prisma.$queryRaw<{ total: number | null }[]>`
      SELECT COALESCE(SUM(cash_counted_cents), 0)::int as total
      FROM cf_collection_events WHERE session_id = ${session.id}::uuid
    `;
    const expectedCash = 100000 + 30000 + 35000 + 33000; // 198,000
    const ok17 = cashSum[0].total === expectedCash;
    record(
      "17. Total cash sum correct (฿1,980)",
      ok17,
      `got=${cashSum[0].total} expected=${expectedCash}`,
    );

    // Final session totalCashCents from trigger
    const ok18 = closed?.totalCashCents === expectedCash;
    record(
      "18. Session totalCashCents populated by trigger",
      ok18,
      `got=${closed?.totalCashCents}`,
    );
  } finally {
    // ---- CLEANUP ----
    console.log("\n=== Cleanup ===");
    if (createdStockMoveIds.length) {
      await prisma.cfStockMovement.deleteMany({ where: { id: { in: createdStockMoveIds } } });
    }
    if (createdEventIds.length) {
      await prisma.cfCollectionEvent.deleteMany({ where: { id: { in: createdEventIds } } });
    }
    if (createdSessionId) {
      await prisma.cfCollectionSession.delete({ where: { id: createdSessionId } });
    }
    if (createdLoadoutIds.length) {
      await prisma.cfMachineLoadout.deleteMany({ where: { id: { in: createdLoadoutIds } } });
    }
    if (createdExchLoadoutIds.length) {
      await prisma.cfExchangerLoadout.deleteMany({ where: { id: { in: createdExchLoadoutIds } } });
    }
    // Detach machines from group first
    if (createdMachineIds.length) {
      await prisma.cfMachine.updateMany({
        where: { id: { in: createdMachineIds } },
        data: { groupId: null },
      });
    }
    if (createdGroupId) {
      // Also clear the exchangerId pointer so we can delete
      await prisma.cfMachineGroup.update({
        where: { id: createdGroupId },
        data: { exchangerId: null },
      });
      await prisma.cfMachineGroup.delete({ where: { id: createdGroupId } });
    }
    if (createdMachineIds.length) {
      // delete INITIAL events first (FK cascade should handle but be safe)
      await prisma.cfCollectionEvent.deleteMany({
        where: { machineId: { in: createdMachineIds }, eventType: "INITIAL" },
      });
      await prisma.cfMachine.deleteMany({ where: { id: { in: createdMachineIds } } });
    }
    if (createdBranch && branch) {
      await prisma.branch.delete({ where: { id: branch.id } });
    }
    console.log("✅ Cleanup done");
  }

  // ---- Summary ----
  console.log("\n=== Summary ===");
  const pass = results.filter((r) => r.pass).length;
  const fail = results.filter((r) => !r.pass).length;
  console.log(`PASS: ${pass} · FAIL: ${fail} · TOTAL: ${results.length}`);
  if (fail > 0) {
    console.log("\nFailures:");
    results.filter((r) => !r.pass).forEach((r) => console.log(`  ❌ ${r.label} — ${r.detail ?? ""}`));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(2);
});
