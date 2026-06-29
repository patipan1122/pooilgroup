/**
 * ClawFleet · ตู้คีบ OS — Demo seed สำหรับ "คำขอตั้งค่าตู้" (cf_config_requests)
 *
 * ใส่ ~5 คำขอตัวอย่าง (PENDING/APPROVED/REJECTED ผสมกัน) บนสาขา demo (code DM-BR-*)
 * โดยใช้รหัสตู้จริงจากสาขานั้น + ชื่อสินค้าจริง (ตุ๊กตาหมี/แมว/โมเดล/...).
 *
 * Idempotent: ลบแถวเดิมของตัวเองก่อน (reason ขึ้นต้น "[DEMO]") แล้วใส่ใหม่.
 *
 * ⚠️ ต้องรัน AFTER migration prisma/migrations/manual/20260629_cf_config_requests.sql
 *    ถูก apply บน DB แล้วเท่านั้น (table cf_config_requests ต้องมีอยู่).
 *
 * Run:
 *   npx tsx -r dotenv/config scripts/seed-clawfleet-config-requests.ts dotenv_config_path=.env.local
 */

import { prisma } from "@/lib/prisma";

const DEMO_TAG = "[DEMO]";

async function main() {
  console.log(`\n=== ClawFleet Config-Request Seed · ${new Date().toISOString().slice(0, 10)} ===\n`);

  // ---- 0. org · super_admin submitter ----
  const org = await prisma.organization.findFirst({ where: { isActive: true }, orderBy: { createdAt: "asc" } });
  if (!org) throw new Error("no active organization");
  const submitter = await prisma.user.findFirst({
    where: { orgId: org.id, role: "super_admin", isActive: true },
  });
  if (!submitter) throw new Error("no super_admin user");
  console.log(`✅ org=${org.name} · submitter=${submitter.name}`);

  // ---- 1. demo branches (DM-BR-*) + their machines ----
  const branches = await prisma.branch.findMany({
    where: { orgId: org.id, code: { startsWith: "DM-BR-" }, businessType: "claw_machine" },
    select: { id: true, name: true, code: true },
    orderBy: { code: "asc" },
  });
  if (branches.length === 0) {
    throw new Error("ไม่พบสาขา demo (DM-BR-*) — รัน seed-clawfleet-demo.ts ก่อน");
  }

  const machines = await prisma.cfMachine.findMany({
    where: { orgId: org.id, branchId: { in: branches.map((b) => b.id) }, kind: "CLAW" },
    select: { id: true, code: true, branchId: true },
    orderBy: { code: "asc" },
  });
  if (machines.length === 0) {
    throw new Error("ไม่พบตู้คีบใน demo branches — รัน seed-clawfleet-demo.ts ก่อน");
  }
  const machineByBranch = new Map<string, { id: string; code: string }[]>();
  for (const m of machines) {
    const list = machineByBranch.get(m.branchId) ?? [];
    list.push({ id: m.id, code: m.code });
    machineByBranch.set(m.branchId, list);
  }

  // ---- 2. idempotent cleanup (เฉพาะแถว demo ของ org นี้) ----
  const del = await prisma.cfConfigRequest.deleteMany({
    where: { orgId: org.id, reason: { startsWith: DEMO_TAG } },
  });
  console.log(`✅ cleared ${del.count} existing demo request(s)`);

  // ---- 3. build ~5 requests across demo branches ----
  const PRODUCTS = ["ตุ๊กตาหมี", "ตุ๊กตาแมว", "โมเดล", "ของเล่นรวม", "ขนมรวม"];
  type Spec = {
    status: "PENDING" | "APPROVED" | "REJECTED";
    clawFrom: number; clawTo: number; priceBaht: number;
    reason: string; daysAgo: number; reviewNote?: string;
  };
  const SPECS: Spec[] = [
    { status: "PENDING", clawFrom: 55, clawTo: 70, priceBaht: 250, daysAgo: 0,
      reason: `${DEMO_TAG} ตู้ออกง่ายเกินไป ลูกค้าคีบได้ทุกครั้ง ต้นทุนตุ๊กตาต่ำกว่าราคาขายมาก ขอเพิ่มความแรงให้สมดุล` },
    { status: "PENDING", clawFrom: 80, clawTo: 65, priceBaht: 200, daysAgo: 0,
      reason: `${DEMO_TAG} ตู้ยากเกินไป ไม่มีตุ๊กตาออก 3 วัน ลูกค้าเริ่มบ่น ขอลดความแรงเพื่อให้คีบได้บ้าง` },
    { status: "PENDING", clawFrom: 60, clawTo: 72, priceBaht: 300, daysAgo: 1,
      reason: `${DEMO_TAG} เปลี่ยนตุ๊กตาใหม่ราคาต้นทุนสูงขึ้น ขอปรับความแรงและราคาขายให้คุ้มทุน` },
    { status: "APPROVED", clawFrom: 50, clawTo: 68, priceBaht: 250, daysAgo: 2,
      reason: `${DEMO_TAG} อัตราตุ๊กตาออกสูงผิดปกติ ปรับความแรงตามรอบที่แล้ว เจ้าของอนุมัติ`,
      reviewNote: `${DEMO_TAG} ตรงตามเกณฑ์ อนุมัติ` },
    { status: "REJECTED", clawFrom: 75, clawTo: 90, priceBaht: 200, daysAgo: 3,
      reason: `${DEMO_TAG} ขอเพิ่มความแรงสูงเกินเกณฑ์ เสี่ยงตู้ยากเกินจนลูกค้าเลิกเล่น`,
      reviewNote: `${DEMO_TAG} เกินเกณฑ์ ตั้งไม่เกิน 75 เท่านั้น` },
  ];

  const now = Date.now();
  let created = 0;
  for (let i = 0; i < SPECS.length; i++) {
    const spec = SPECS[i]!;
    const branch = branches[i % branches.length]!;
    const branchMachines = machineByBranch.get(branch.id) ?? [];
    if (branchMachines.length === 0) continue;
    const machine = branchMachines[i % branchMachines.length]!;
    const product = PRODUCTS[i % PRODUCTS.length]!;
    const submittedAt = new Date(now - spec.daysAgo * 86_400_000 - i * 3_600_000);
    const reviewed = spec.status !== "PENDING";

    await prisma.cfConfigRequest.create({
      data: {
        orgId: org.id,
        branchId: branch.id,
        machineId: machine.id,
        machineCode: machine.code,
        branchName: branch.name,
        productName: product,
        clawFrom: spec.clawFrom,
        clawTo: spec.clawTo,
        priceBaht: spec.priceBaht,
        reason: spec.reason,
        status: spec.status,
        submittedById: submitter.id,
        submittedByName: submitter.name,
        submittedAt,
        reviewedById: reviewed ? submitter.id : null,
        reviewedByName: reviewed ? submitter.name : null,
        reviewedAt: reviewed ? new Date(submittedAt.getTime() + 2 * 3_600_000) : null,
        reviewNote: reviewed ? spec.reviewNote ?? null : null,
      },
    });
    created++;
  }
  console.log(`✅ created ${created} demo config request(s)`);
  console.log("\n=== Done ===\n");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌ seed failed:", e);
    process.exit(1);
  });
