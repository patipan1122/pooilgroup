/**
 * ClawFleet — minimal A/B test seed (2026-06-02 · go-live test data)
 *
 * Creates ONE claw_machine branch with BOTH group types so the CEO can test the
 * unified collect flow + 3-way cross-check on prod:
 *   - Group A (CASH): 3 claw machines that take cash directly (2-way check)
 *   - Group B (TOKEN): 1 exchanger (ตู้แลก) + 3 token claws (3-way check)
 *
 * Safe order (avoids the exchangerId↔groupId chicken-egg FK): create group with
 * exchangerId=null → create machines with groupId → update group.exchangerId.
 *
 * Idempotent: deletes prior [ABTEST] rows / AB- coded machines / AB-BR branch.
 * Cleanup: DELETE the AB-* machines, [ABTEST] groups, AB-BR branch.
 *
 * Run: npx tsx -r dotenv/config scripts/seed-clawfleet-ab-test.ts dotenv_config_path=.env.local
 */
import { prisma } from "@/lib/prisma";

const TAG = "[ABTEST]";

async function main() {
  const org = await prisma.organization.findFirst({ where: { isActive: true } });
  if (!org) throw new Error("no active organization");
  const company = await prisma.company.findFirst({ where: { orgId: org.id } });
  if (!company) throw new Error("no company");
  console.log(`org=${org.name} · company=${company.name}`);

  // ---- cleanup prior ABTEST rows (FK-safe order) ----
  const oldGroups = await prisma.cfMachineGroup.findMany({
    where: { orgId: org.id, name: { startsWith: TAG } },
    select: { id: true },
  });
  const oldGroupIds = oldGroups.map((g) => g.id);
  if (oldGroupIds.length) {
    await prisma.cfMachineGroup.updateMany({ where: { id: { in: oldGroupIds } }, data: { exchangerId: null } });
  }
  await prisma.cfCollectionEvent.deleteMany({ where: { orgId: org.id, machine: { code: { startsWith: "AB-" } } } });
  await prisma.cfCollectionSession.deleteMany({ where: { orgId: org.id, group: { name: { startsWith: TAG } } } });
  await prisma.cfMachine.deleteMany({ where: { orgId: org.id, code: { startsWith: "AB-" } } });
  await prisma.cfMachineGroup.deleteMany({ where: { orgId: org.id, name: { startsWith: TAG } } });
  await prisma.branch.deleteMany({ where: { orgId: org.id, code: "AB-BR-01" } });
  console.log("cleaned prior ABTEST rows");

  // ---- branch ----
  const branch = await prisma.branch.create({
    data: {
      orgId: org.id,
      companyId: company.id,
      code: "AB-BR-01",
      name: `${TAG} ตู้คีบ สาขาทดสอบ`,
      businessType: "claw_machine",
    },
  });
  console.log(`branch=${branch.name}`);

  const mkMachine = (code: string, kind: "CLAW" | "EXCHANGER", groupId: string, coin: number, doll: number) =>
    prisma.cfMachine.create({
      data: {
        orgId: org.id,
        branchId: branch.id,
        groupId,
        code,
        kind,
        qrToken: `abtest-${code}`,
        lastCoinMeter: coin,
        lastDollMeter: doll,
        lastDollStock: kind === "CLAW" ? 24 : 0,
      },
      select: { id: true, code: true },
    });

  // ---- Group A (CASH · no exchanger) ----
  const groupA = await prisma.cfMachineGroup.create({
    data: { orgId: org.id, branchId: branch.id, name: `${TAG} กลุ่ม A เงินสด`, toleranceBps: 500 },
    select: { id: true },
  });
  for (let i = 1; i <= 3; i++) await mkMachine(`AB-A-CW${i}`, "CLAW", groupA.id, 12000 + i * 100, 1000 + i * 50);
  console.log("Group A (CASH): 3 claws");

  // ---- Group B (TOKEN · exchanger + token claws) ----
  const groupB = await prisma.cfMachineGroup.create({
    data: { orgId: org.id, branchId: branch.id, name: `${TAG} กลุ่ม B ตู้แลก`, toleranceBps: 500 },
    select: { id: true },
  });
  const ex = await mkMachine("AB-B-EX", "EXCHANGER", groupB.id, 50000, 0);
  for (let i = 1; i <= 3; i++) await mkMachine(`AB-B-CW${i}`, "CLAW", groupB.id, 8000 + i * 100, 800 + i * 40);
  await prisma.cfMachineGroup.update({ where: { id: groupB.id }, data: { exchangerId: ex.id } });
  console.log("Group B (TOKEN): 1 exchanger + 3 token claws");

  console.log("\n✅ A/B test seed done. Branch 'สาขาทดสอบ' has Group A (cash) + Group B (ตู้แลก).");
  console.log("   Test: /clawfleet/v2/collect → pick สาขาทดสอบ → pick a group → collect → close → cross-check.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("SEED FAILED:", e);
    process.exit(1);
  });
