/**
 * ClawFleet E2E Round 3 — Multi-group regression (P0 fix #2 verification)
 *
 * QA flagged: cross-check trigger filters by group_id was COVERED only with 1 group.
 * Now we prove the FILTER actually isolates when 2 groups exist in same session sequence.
 *
 * Test:
 *   Group A: 1 EX_A + 2 CLAW_A
 *   Group B: 1 EX_B + 2 CLAW_B (separate · different exchanger)
 *   Run session for Group A · close · verify variance uses ONLY Group A machines
 *   even though Group B has events in same DB.
 *
 * Run: npx tsx -r dotenv/config scripts/e2e-clawfleet-multigroup.ts dotenv_config_path=.env.local
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
  console.log(`=== Multi-group regression test · stamp ${STAMP} ===`);

  const orgRow = await prisma.organization.findFirst({ where: { isActive: true } });
  if (!orgRow) throw new Error("no org");
  const userRow = await prisma.user.findFirst({ where: { orgId: orgRow.id, role: "super_admin" } });
  if (!userRow) throw new Error("no super_admin");
  const branchRow = await prisma.branch.findFirst({ where: { orgId: orgRow.id, businessType: "claw_machine", isActive: true } });
  if (!branchRow) throw new Error("no claw_machine branch");
  const productRow = await prisma.cfProduct.findFirst({ where: { orgId: orgRow.id, sku: "PLUSH-BEAR" } });
  if (!productRow) throw new Error("no PLUSH-BEAR");
  const org = orgRow;
  const user = userRow;
  const branch = branchRow;
  const product = productRow;

  const created = {
    machines: [] as string[],
    loadouts: [] as string[],
    exchLoadouts: [] as string[],
    groups: [] as string[],
    sessions: [] as string[],
    events: [] as string[],
  };

  try {
    // ============================================================
    // Build 2 groups: A and B
    // ============================================================
    async function makeGroup(suffix: string): Promise<{ groupId: string; exId: string; clawIds: string[] }> {
      const ex = await prisma.cfMachine.create({
        data: {
          orgId: org.id, branchId: branch.id,
          code: `E2E3-${suffix}-EX-${STAMP}`, kind: "EXCHANGER",
          qrToken: `qr-${suffix}-ex-${STAMP}`,
          initialCoinMeter: 0, lastCoinMeter: 0,
        },
      });
      created.machines.push(ex.id);
      const clawIds: string[] = [];
      for (let i = 1; i <= 2; i++) {
        const c = await prisma.cfMachine.create({
          data: {
            orgId: org.id, branchId: branch.id,
            code: `E2E3-${suffix}-CW${i}-${STAMP}`, kind: "CLAW",
            qrToken: `qr-${suffix}-cw${i}-${STAMP}`,
            initialCoinMeter: 0, initialDollMeter: 0,
            lastCoinMeter: 0, lastDollMeter: 0, lastDollStock: 30,
          },
        });
        created.machines.push(c.id);
        clawIds.push(c.id);
      }
      const g = await prisma.cfMachineGroup.create({
        data: {
          orgId: org.id, branchId: branch.id,
          name: `E2E3 Group ${suffix} ${STAMP}`,
          exchangerId: ex.id, toleranceBps: 500,
        },
      });
      created.groups.push(g.id);
      await prisma.cfMachine.updateMany({
        where: { id: { in: [ex.id, ...clawIds] } },
        data: { groupId: g.id },
      });
      for (const id of clawIds) {
        const l = await prisma.cfMachineLoadout.create({
          data: { orgId: org.id, machineId: id, productId: product.id, pricePerPlayCoins: 1, setById: user.id },
        });
        created.loadouts.push(l.id);
      }
      const exL = await prisma.cfExchangerLoadout.create({
        data: { orgId: org.id, machineId: ex.id, baseCoinPerBaht: 1.0, promoTiers: [], setById: user.id },
      });
      created.exchLoadouts.push(exL.id);
      return { groupId: g.id, exId: ex.id, clawIds };
    }

    const A = await makeGroup("A");
    const B = await makeGroup("B");
    record("1. Build 2 groups (A · B) with separate EX + 2 CLAW each", true);

    // ============================================================
    // Run session for Group A
    //   EX_A dispenses 100 · CLAW_A receive 50 + 48 = 98 (variance -2%, within tolerance)
    // Meanwhile create stray events for Group B machines with HUGE coin deltas
    //   (these MUST NOT pollute Group A cross-check)
    // ============================================================
    const codeRowA = await prisma.$queryRaw<{ code: string }[]>`SELECT public.cf_next_session_code(${org.id}::uuid)::text as code`;
    const sessionA = await prisma.cfCollectionSession.create({
      data: { orgId: org.id, groupId: A.groupId, sessionCode: codeRowA[0].code, openedById: user.id, status: "OPEN" },
    });
    created.sessions.push(sessionA.id);

    // events for group A
    const evExA = await prisma.cfCollectionEvent.create({
      data: {
        orgId: org.id, sessionId: sessionA.id, machineId: A.exId, eventType: "COLLECTION",
        collectedAt: new Date(), collectedById: user.id,
        coinMeterBefore: 0, coinMeterAfter: 100, cashCountedCents: 100000,
      },
    });
    created.events.push(evExA.id);

    const deltasA = [50, 48];
    for (let i = 0; i < A.clawIds.length; i++) {
      const ev = await prisma.cfCollectionEvent.create({
        data: {
          orgId: org.id, sessionId: sessionA.id, machineId: A.clawIds[i], eventType: "COLLECTION",
          collectedAt: new Date(), collectedById: user.id,
          coinMeterBefore: 0, coinMeterAfter: deltasA[i], cashCountedCents: deltasA[i] * 1000,
          dollMeterBefore: 0, dollMeterAfter: 1,
          stockBefore: 30, stockAfter: 29, refillQty: 0,
        },
      });
      created.events.push(ev.id);
    }

    // Group B sessions — create separate session for B with WILD numbers to test isolation
    const codeRowB = await prisma.$queryRaw<{ code: string }[]>`SELECT public.cf_next_session_code(${org.id}::uuid)::text as code`;
    const sessionB = await prisma.cfCollectionSession.create({
      data: { orgId: org.id, groupId: B.groupId, sessionCode: codeRowB[0].code, openedById: user.id, status: "OPEN" },
    });
    created.sessions.push(sessionB.id);

    const evExB = await prisma.cfCollectionEvent.create({
      data: {
        orgId: org.id, sessionId: sessionB.id, machineId: B.exId, eventType: "COLLECTION",
        collectedAt: new Date(), collectedById: user.id,
        coinMeterBefore: 0, coinMeterAfter: 9999, cashCountedCents: 9999000,
      },
    });
    created.events.push(evExB.id);
    for (let i = 0; i < B.clawIds.length; i++) {
      const ev = await prisma.cfCollectionEvent.create({
        data: {
          orgId: org.id, sessionId: sessionB.id, machineId: B.clawIds[i], eventType: "COLLECTION",
          collectedAt: new Date(), collectedById: user.id,
          coinMeterBefore: 0, coinMeterAfter: 5000, cashCountedCents: 5000000,
          dollMeterBefore: 0, dollMeterAfter: 200,
          stockBefore: 30, stockAfter: 30, refillQty: 200,
        },
      });
      created.events.push(ev.id);
    }
    record("2. Create wild Group B session (9999 + 5000+5000 coins) to test isolation", true);

    // ============================================================
    // Close session A · verify cross-check uses ONLY Group A's machines
    // ============================================================
    await prisma.cfCollectionSession.update({
      where: { id: sessionA.id },
      data: { status: "CLOSED", closedById: user.id },
    });
    const closedA = await prisma.cfCollectionSession.findUnique({ where: { id: sessionA.id } });

    // Expected for A only: out=100, in=98, var=-200bps
    const ok =
      closedA?.exchangerCoinsOut === 100 &&
      closedA?.clawCoinsIn === 98 &&
      closedA?.coinVarianceBps === -200 &&
      closedA?.status === "CLOSED" &&
      (closedA?.anomalyFlags ?? []).length === 0;
    record(
      "3. Cross-check ISOLATES to Group A (out=100, in=98, var=-200bps)",
      ok,
      `out=${closedA?.exchangerCoinsOut} in=${closedA?.clawCoinsIn} var=${closedA?.coinVarianceBps} status=${closedA?.status}`,
    );

    // If filter broken (P0-5 regression): in would include Group B's 10000 → in=10098 · var=+9998%
    const bug_in_would_be = 98 + 5000 + 5000; // 10098 if filter missing
    const proof_filter_working = closedA?.clawCoinsIn !== bug_in_would_be;
    record(
      "4. Group B's 10,000 coins NOT leaked into Group A cross-check (P0-5 fix verified)",
      proof_filter_working,
      `if bug: in would be ${bug_in_would_be} · got ${closedA?.clawCoinsIn}`,
    );

    // ============================================================
    // Now close B · should show massive variance (its own anomaly)
    // ============================================================
    await prisma.cfCollectionSession.update({
      where: { id: sessionB.id },
      data: { status: "CLOSED", closedById: user.id },
    });
    const closedB = await prisma.cfCollectionSession.findUnique({ where: { id: sessionB.id } });
    // Expected B: out=9999, in=10000, var = (10000-9999)/9999 * 10000 ≈ +1bps · within tolerance
    const okB =
      closedB?.exchangerCoinsOut === 9999 &&
      closedB?.clawCoinsIn === 10000 &&
      closedB?.status === "CLOSED";
    record(
      "5. Group B has its own cross-check (out=9999, in=10000)",
      okB,
      `out=${closedB?.exchangerCoinsOut} in=${closedB?.clawCoinsIn}`,
    );
  } finally {
    console.log("\n=== Cleanup ===");
    if (created.events.length) {
      await prisma.cfCollectionEvent.deleteMany({ where: { id: { in: created.events } } });
    }
    if (created.sessions.length) {
      await prisma.cfCollectionSession.deleteMany({ where: { id: { in: created.sessions } } });
    }
    if (created.loadouts.length) {
      await prisma.cfMachineLoadout.deleteMany({ where: { id: { in: created.loadouts } } });
    }
    if (created.exchLoadouts.length) {
      await prisma.cfExchangerLoadout.deleteMany({ where: { id: { in: created.exchLoadouts } } });
    }
    if (created.machines.length) {
      await prisma.cfMachine.updateMany({ where: { id: { in: created.machines } }, data: { groupId: null } });
    }
    for (const gid of created.groups) {
      await prisma.cfMachineGroup.update({ where: { id: gid }, data: { exchangerId: null } });
      await prisma.cfMachineGroup.delete({ where: { id: gid } });
    }
    if (created.machines.length) {
      await prisma.cfCollectionEvent.deleteMany({
        where: { machineId: { in: created.machines }, eventType: "INITIAL" },
      });
      await prisma.cfMachine.deleteMany({ where: { id: { in: created.machines } } });
    }
    console.log("✅ Cleanup done");
  }

  console.log("\n=== Multi-group Summary ===");
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
