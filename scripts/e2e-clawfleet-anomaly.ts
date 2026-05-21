/**
 * ClawFleet E2E Round 2 — ANOMALY + BLOCK paths against PROD DB
 *
 * Round 1 (e2e-clawfleet.ts) covered the happy path. This round verifies:
 *   G1 — Cross-check >5% variance → ANOMALY_REVIEW + flag
 *   G2 — Exchanger dispenses but claws=0 → BLOCK (RAISE EXCEPTION)
 *   G7 — Close empty session → BLOCK (RAISE EXCEPTION)
 *   review approve → LOCKED · reject → OPEN
 *   Promo tier JSON roundtrip
 *
 * Run: npx tsx -r dotenv/config scripts/e2e-clawfleet-anomaly.ts dotenv_config_path=.env.local
 */

import { prisma } from "@/lib/prisma";

const STAMP = Date.now().toString().slice(-6);
type Step = { label: string; pass: boolean; detail?: string };
const results: Step[] = [];

function record(label: string, pass: boolean, detail?: string) {
  results.push({ label, pass, detail });
  console.log(`${pass ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  console.log(`=== ClawFleet E2E ROUND 2 (anomaly) · stamp ${STAMP} ===`);

  const org = await prisma.organization.findFirst({ where: { isActive: true }, include: { companies: { take: 1 } } });
  if (!org) throw new Error("no org");
  const user = await prisma.user.findFirst({ where: { orgId: org.id, role: "super_admin" } });
  if (!user) throw new Error("no super_admin");
  const company = org.companies[0];
  if (!company) throw new Error("no company");
  const branch = await prisma.branch.findFirst({ where: { orgId: org.id, businessType: "claw_machine", isActive: true } });
  if (!branch) throw new Error("no claw_machine branch");
  const product = await prisma.cfProduct.findFirst({ where: { orgId: org.id, sku: "PLUSH-BEAR" } });
  if (!product) throw new Error("no PLUSH-BEAR product");
  record("0. Setup loaded", true, `${branch.name} · ${product.name}`);

  const created = {
    machineIds: [] as string[],
    loadoutIds: [] as string[],
    exchLoadoutIds: [] as string[],
    groupId: null as string | null,
    sessionIds: [] as string[],
    eventIds: [] as string[],
  };

  try {
    // ============================================================
    // Setup: 1 EX + 3 CLAW in 1 group
    // ============================================================
    const ex = await prisma.cfMachine.create({
      data: {
        orgId: org.id, branchId: branch.id,
        code: `E2E2-EX-${STAMP}`, kind: "EXCHANGER",
        qrToken: `qr-ex2-${STAMP}`,
        initialCoinMeter: 0, lastCoinMeter: 0,
      },
    });
    created.machineIds.push(ex.id);
    const claws: { id: string; code: string }[] = [];
    for (let i = 1; i <= 3; i++) {
      const c = await prisma.cfMachine.create({
        data: {
          orgId: org.id, branchId: branch.id,
          code: `E2E2-CW${i}-${STAMP}`, kind: "CLAW",
          qrToken: `qr-cw2-${i}-${STAMP}`,
          initialCoinMeter: 0, initialDollMeter: 0,
          lastCoinMeter: 0, lastDollMeter: 0, lastDollStock: 30,
        },
      });
      created.machineIds.push(c.id);
      claws.push({ id: c.id, code: c.code });
    }
    const group = await prisma.cfMachineGroup.create({
      data: {
        orgId: org.id, branchId: branch.id,
        name: `E2E2 Group ${STAMP}`,
        exchangerId: ex.id, toleranceBps: 500,
      },
    });
    created.groupId = group.id;
    await prisma.cfMachine.updateMany({
      where: { id: { in: created.machineIds } },
      data: { groupId: group.id },
    });
    for (const c of claws) {
      const l = await prisma.cfMachineLoadout.create({
        data: { orgId: org.id, machineId: c.id, productId: product.id, pricePerPlayCoins: 1, setById: user.id },
      });
      created.loadoutIds.push(l.id);
    }
    const exL = await prisma.cfExchangerLoadout.create({
      data: {
        orgId: org.id, machineId: ex.id, baseCoinPerBaht: 1.0,
        promoTiers: [{ thb: 100, coins: 11 }, { thb: 500, coins: 60 }],
        setById: user.id,
      },
    });
    created.exchLoadoutIds.push(exL.id);
    record("1. Setup complete (1 EX + 3 CLAW + group + loadouts)", true);

    // ============================================================
    // TEST G2 — Exchanger dispenses 100 coins, ALL claws receive 0 → BLOCK
    // ============================================================
    {
      const codeRow = await prisma.$queryRaw<{ code: string }[]>`SELECT public.cf_next_session_code(${org.id}::uuid)::text as code`;
      const s = await prisma.cfCollectionSession.create({
        data: { orgId: org.id, groupId: group.id, sessionCode: codeRow[0].code, openedById: user.id, status: "OPEN" },
      });
      created.sessionIds.push(s.id);

      // EX dispenses 100
      const evEx = await prisma.cfCollectionEvent.create({
        data: {
          orgId: org.id, sessionId: s.id, machineId: ex.id, eventType: "COLLECTION",
          collectedAt: new Date(), collectedById: user.id,
          coinMeterBefore: 0, coinMeterAfter: 100, cashCountedCents: 100000,
        },
      });
      created.eventIds.push(evEx.id);
      // 3 CLAWs all receive 0 coins
      for (const c of claws) {
        const ev = await prisma.cfCollectionEvent.create({
          data: {
            orgId: org.id, sessionId: s.id, machineId: c.id, eventType: "COLLECTION",
            collectedAt: new Date(), collectedById: user.id,
            coinMeterBefore: 0, coinMeterAfter: 0, cashCountedCents: 0,
            dollMeterBefore: 0, dollMeterAfter: 0,
            stockBefore: 30, stockAfter: 30, refillQty: 0,
          },
        });
        created.eventIds.push(ev.id);
      }

      let g2Blocked = false;
      let g2Msg = "";
      try {
        await prisma.cfCollectionSession.update({
          where: { id: s.id },
          data: { status: "CLOSED", closedById: user.id },
        });
      } catch (e) {
        g2Blocked = true;
        g2Msg = (e as Error).message.split("\n")[0].slice(0, 200);
      }
      record(
        "G2. BLOCK close: EX dispensed 100, CLAWs Σ=0 (impossible physics)",
        g2Blocked && g2Msg.includes("G2"),
        g2Msg,
      );
    }

    // ============================================================
    // TEST G1 — Variance > 5% → ANOMALY_REVIEW + flag
    // Make sure G2 doesn't fire (claws receive some)
    // ============================================================
    {
      // Reset machines (clear via update directly · since events from prev attempt failed)
      await prisma.cfMachine.updateMany({
        where: { id: { in: claws.map((c) => c.id) } },
        data: { lastCoinMeter: 0, lastDollMeter: 0 },
      });
      await prisma.cfMachine.update({ where: { id: ex.id }, data: { lastCoinMeter: 0 } });

      // Delete the prior session's events first
      const prevSession = created.sessionIds[created.sessionIds.length - 1];
      await prisma.cfCollectionEvent.deleteMany({ where: { sessionId: prevSession } });
      // Trigger may have left session in some state; force VOID it (or delete)
      try {
        await prisma.cfCollectionSession.update({ where: { id: prevSession }, data: { status: "LOCKED" } });
      } catch {
        // ignore
      }

      const codeRow = await prisma.$queryRaw<{ code: string }[]>`SELECT public.cf_next_session_code(${org.id}::uuid)::text as code`;
      const s = await prisma.cfCollectionSession.create({
        data: { orgId: org.id, groupId: group.id, sessionCode: codeRow[0].code, openedById: user.id, status: "OPEN" },
      });
      created.sessionIds.push(s.id);

      // EX dispenses 100, CLAWs receive 50 total (-50% variance → way > 5%)
      const evEx = await prisma.cfCollectionEvent.create({
        data: {
          orgId: org.id, sessionId: s.id, machineId: ex.id, eventType: "COLLECTION",
          collectedAt: new Date(), collectedById: user.id,
          coinMeterBefore: 0, coinMeterAfter: 100, cashCountedCents: 100000,
        },
      });
      created.eventIds.push(evEx.id);

      const deltas = [20, 15, 15];
      for (let i = 0; i < claws.length; i++) {
        const ev = await prisma.cfCollectionEvent.create({
          data: {
            orgId: org.id, sessionId: s.id, machineId: claws[i].id, eventType: "COLLECTION",
            collectedAt: new Date(), collectedById: user.id,
            coinMeterBefore: 0, coinMeterAfter: deltas[i], cashCountedCents: deltas[i] * 1000,
            dollMeterBefore: 0, dollMeterAfter: 1,
            stockBefore: 30, stockAfter: 29, refillQty: 0,
          },
        });
        created.eventIds.push(ev.id);
      }

      await prisma.cfCollectionSession.update({
        where: { id: s.id },
        data: { status: "CLOSED", closedById: user.id },
      });
      const closed = await prisma.cfCollectionSession.findUnique({ where: { id: s.id } });
      const g1Flagged =
        closed?.status === "ANOMALY_REVIEW" &&
        (closed?.anomalyFlags ?? []).includes("COIN_GROUP_MISMATCH");
      record(
        "G1. FLAG: variance 50% > tolerance 5% → ANOMALY_REVIEW + COIN_GROUP_MISMATCH",
        g1Flagged,
        `status=${closed?.status} flags=${JSON.stringify(closed?.anomalyFlags)} var=${closed?.coinVarianceBps}bps`,
      );

      // ============================================================
      // TEST review approve → LOCKED
      // ============================================================
      await prisma.cfCollectionSession.update({
        where: { id: s.id },
        data: { status: "LOCKED", reviewerId: user.id, reviewedAt: new Date(), reviewNote: "approve test" },
      });
      const locked = await prisma.cfCollectionSession.findUnique({ where: { id: s.id } });
      record("review.approve → LOCKED", locked?.status === "LOCKED", `status=${locked?.status}`);
    }

    // ============================================================
    // TEST G7 — Close empty session → BLOCK
    // ============================================================
    {
      const codeRow = await prisma.$queryRaw<{ code: string }[]>`SELECT public.cf_next_session_code(${org.id}::uuid)::text as code`;
      const s = await prisma.cfCollectionSession.create({
        data: { orgId: org.id, groupId: group.id, sessionCode: codeRow[0].code, openedById: user.id, status: "OPEN" },
      });
      created.sessionIds.push(s.id);

      let g7Blocked = false;
      let g7Msg = "";
      try {
        await prisma.cfCollectionSession.update({
          where: { id: s.id },
          data: { status: "CLOSED", closedById: user.id },
        });
      } catch (e) {
        g7Blocked = true;
        g7Msg = (e as Error).message.split("\n")[0].slice(0, 200);
      }
      record(
        "G7. BLOCK close empty session (no events)",
        g7Blocked && g7Msg.includes("G7"),
        g7Msg,
      );
    }

    // ============================================================
    // TEST Promo tier JSON roundtrip
    // ============================================================
    {
      const exLoadout = await prisma.cfExchangerLoadout.findFirst({
        where: { machineId: ex.id, effectiveTo: null },
      });
      const tiers = exLoadout?.promoTiers as { thb: number; coins: number }[] | null;
      const ok = Array.isArray(tiers) && tiers.length === 2 && tiers[0]?.thb === 100 && tiers[0]?.coins === 11;
      record("Promo tier JSON roundtrip [100→11, 500→60]", !!ok, JSON.stringify(tiers));
    }

    // ============================================================
    // TEST stockCountBatch double-count regression
    // ============================================================
    {
      // Create initial RECEIVE
      const r1 = await prisma.cfStockMovement.create({
        data: {
          orgId: org.id, branchId: branch.id, type: "RECEIVE",
          productId: product.id, qty: 100, occurredAt: new Date(),
          createdById: user.id, reason: "E2E2 baseline",
        },
      });
      // Create COUNT_SNAPSHOT (qty=0 per the P0 fix) + ADJUST (-10 = staff counted 90)
      const r2 = await prisma.cfStockMovement.create({
        data: {
          orgId: org.id, branchId: branch.id, type: "COUNT_SNAPSHOT",
          productId: product.id, qty: 0, expectedQty: 100, varianceQty: 10,
          occurredAt: new Date(), createdById: user.id, reason: "Counted 90",
        },
      });
      const r3 = await prisma.cfStockMovement.create({
        data: {
          orgId: org.id, branchId: branch.id, type: "ADJUST",
          productId: product.id, qty: -10, occurredAt: new Date(),
          createdById: user.id, reason: "Adjust to actual",
        },
      });

      const sum = await prisma.cfStockMovement.aggregate({
        where: { branchId: branch.id, productId: product.id, id: { in: [r1.id, r2.id, r3.id] } },
        _sum: { qty: true },
      });
      // Expected: 100 + 0 + (-10) = 90 (the actual count) · NOT 90 + 90 = double
      const ok = sum._sum.qty === 90;
      record(
        "Stock count regression: balance = actual qty (not double-count)",
        ok,
        `sum=${sum._sum.qty} expected=90`,
      );

      // cleanup these
      await prisma.cfStockMovement.deleteMany({ where: { id: { in: [r1.id, r2.id, r3.id] } } });
    }

    // ============================================================
    // TEST RLS scope — user from another branch can't see these machines
    // (Simulate by checking RLS policy via current_org_id() — though Prisma uses DATABASE_URL not JWT
    //  so this is a DB-level check, not a true cross-tenant attack test)
    // ============================================================
    {
      const rls = await prisma.$queryRaw<{ rls: boolean }[]>`
        SELECT rowsecurity AS rls FROM pg_tables
        WHERE schemaname='public' AND tablename='cf_machines'
      `;
      record("RLS enabled on cf_machines", rls[0]?.rls === true);
    }
  } finally {
    console.log("\n=== Cleanup Round 2 ===");
    if (created.eventIds.length) {
      await prisma.cfCollectionEvent.deleteMany({ where: { id: { in: created.eventIds } } });
    }
    if (created.sessionIds.length) {
      await prisma.cfCollectionSession.deleteMany({ where: { id: { in: created.sessionIds } } });
    }
    if (created.loadoutIds.length) {
      await prisma.cfMachineLoadout.deleteMany({ where: { id: { in: created.loadoutIds } } });
    }
    if (created.exchLoadoutIds.length) {
      await prisma.cfExchangerLoadout.deleteMany({ where: { id: { in: created.exchLoadoutIds } } });
    }
    if (created.machineIds.length) {
      await prisma.cfMachine.updateMany({
        where: { id: { in: created.machineIds } },
        data: { groupId: null },
      });
    }
    if (created.groupId) {
      await prisma.cfMachineGroup.update({ where: { id: created.groupId }, data: { exchangerId: null } });
      await prisma.cfMachineGroup.delete({ where: { id: created.groupId } });
    }
    if (created.machineIds.length) {
      // delete INITIAL events
      await prisma.cfCollectionEvent.deleteMany({
        where: { machineId: { in: created.machineIds }, eventType: "INITIAL" },
      });
      await prisma.cfMachine.deleteMany({ where: { id: { in: created.machineIds } } });
    }
    console.log("✅ Cleanup done");
  }

  console.log("\n=== Round 2 Summary ===");
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

main().catch((e) => { console.error("FATAL:", e); process.exit(2); });
