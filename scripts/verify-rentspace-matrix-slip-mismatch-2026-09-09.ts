// Read-only verification for the NEW getSlipMismatchBillIds() (CEO 2026-09-09, part C —
// grid-level red-ring indicator). Calls the ACTUAL exported production function against
// real DB data for "โครงการทะเลทาวน์ หัวทะเล" — no writes, no new AI calls (this function
// must never call getOrRunRentSpacePaymentSlipCheck by design).
//
// Cross-checks the function's output two ways:
//   (a) independently, by hand, walking every bill's already-cached ocrAmount/ocrReadAt
//       and applying the exact same ±1-baht rule evaluateBillSlipGate uses
//   (b) against the known symptom CEO reported today (unit A3/5: recorded 85.37 vs
//       AI-read 8,366 — should show up as mismatched)
import { prisma } from "@/lib/prisma";
import { toNum } from "@/lib/rentspace/format";
import { getSlipMismatchBillIds } from "@/lib/rentspace/ledger-push";

async function main() {
  const project = await prisma.rentalProject.findFirst({
    where: { name: { contains: "ทะเลทาวน์" } },
    select: { id: true, orgId: true, name: true },
  });
  if (!project) {
    console.log("Project 'ทะเลทาวน์' not found — aborting.");
    return;
  }
  console.log("Project:", project.name, project.id, "org:", project.orgId);
  console.log("");

  const bills = await prisma.rentalBill.findMany({
    where: { orgId: project.orgId, projectId: project.id, status: { notIn: ["void", "draft"] } },
    select: {
      id: true,
      period: true,
      status: true,
      unit: { select: { code: true } },
      payments: {
        where: { status: "confirmed" },
        select: { id: true, paidOn: true, slipUrl: true, amountThb: true, ocrAmount: true, ocrReadAt: true },
      },
    },
  });
  const billIds = bills.map((b) => b.id);
  console.log(`Bills (non-void/draft) for this project: ${bills.length}`);

  // ── independent hand-computed reference set (does NOT call getSlipMismatchBillIds) ──
  const expectedMismatch = new Set<string>();
  for (const b of bills) {
    const readSlipPayments = b.payments.filter((p) => p.slipUrl && p.ocrReadAt);
    if (readSlipPayments.length === 0) continue;
    let mismatched = false;
    for (const p of readSlipPayments) {
      const recorded = toNum(p.amountThb);
      if (p.ocrAmount == null || Math.abs(p.ocrAmount - recorded) > 1) mismatched = true;
    }
    if (mismatched) expectedMismatch.add(b.id);
  }

  // ── the actual production function under test ──
  const actualMismatch = await getSlipMismatchBillIds(project.orgId, billIds);

  console.log(`Hand-computed expected mismatched bills: ${expectedMismatch.size}`);
  console.log(`getSlipMismatchBillIds() returned:        ${actualMismatch.size}`);
  console.log("");

  const missing = [...expectedMismatch].filter((id) => !actualMismatch.has(id));
  const extra = [...actualMismatch].filter((id) => !expectedMismatch.has(id));
  console.log(`Match exactly (expected == actual)?  ${missing.length === 0 && extra.length === 0 ? "YES" : "NO"}`);
  if (missing.length) console.log("  MISSING from actual (expected but not flagged):", missing);
  if (extra.length) console.log("  EXTRA in actual (flagged but not expected):", extra);
  console.log("");

  console.log("Flagged bill detail:");
  for (const b of bills) {
    if (!actualMismatch.has(b.id)) continue;
    const readSlipPayments = b.payments.filter((p) => p.slipUrl && p.ocrReadAt);
    console.log(`  Bill ${b.id} · unit ${b.unit.code} · period ${b.period} · status ${b.status}`);
    for (const p of readSlipPayments) {
      const recorded = toNum(p.amountThb);
      const diff = p.ocrAmount == null ? "N/A (unreadable)" : Math.abs(p.ocrAmount - recorded);
      console.log(`     payment ${p.id}: recorded=${recorded} ocrAmount=${p.ocrAmount ?? "null"} diff=${diff}`);
    }
  }
  console.log("");

  // ── stats on why the rest were NOT flagged (unread / matched / no slip) ──
  let noSlipAtAll = 0;
  let hasSlipNoneReadYet = 0;
  let readAndAllMatch = 0;
  for (const b of bills) {
    if (actualMismatch.has(b.id)) continue;
    const slipPayments = b.payments.filter((p) => p.slipUrl);
    if (slipPayments.length === 0) {
      noSlipAtAll++;
    } else if (slipPayments.every((p) => !p.ocrReadAt)) {
      hasSlipNoneReadYet++;
    } else {
      readAndAllMatch++;
    }
  }
  console.log(`Not flagged, no slip on any payment: ${noSlipAtAll}`);
  console.log(`Not flagged, has slip but none read yet (correctly NOT a false-positive): ${hasSlipNoneReadYet}`);
  console.log(`Not flagged, read and all within ±1 baht (correctly passed): ${readAndAllMatch}`);
  console.log("");
  console.log("(Read-only — no writes, no AI calls made by this script or by getSlipMismatchBillIds.)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
