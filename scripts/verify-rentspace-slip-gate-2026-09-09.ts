// Read-only verification for the RentSpace matrix "send to ledger" slip-amount
// pre-send gate (CEO 2026-09-09). Calls the ACTUAL exported functions —
// getOrRunRentSpacePaymentSlipCheck() (same one the matrix popup uses to read
// slips — cache-first, safe to call) and evaluateBillSlipGate() (the exact
// comparison pushProjectBillsToLedger() now runs before inserting into
// ledger_revenue_entry) — against real data. Prints results only. Does NOT
// call pushProjectBillsToLedger() itself, so nothing is written into the
// shared ledger_revenue_entry table by this script.
import { prisma } from "@/lib/prisma";
import { toNum } from "@/lib/rentspace/format";
import { getOrRunRentSpacePaymentSlipCheck } from "@/lib/rentspace/slip-check";
import { evaluateBillSlipGate } from "@/lib/rentspace/ledger-push";

async function main() {
  const project = await prisma.rentalProject.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true, orgId: true, name: true, companyId: true, reconcileBankAccountId: true },
  });
  if (!project) {
    console.log("No RentalProject found — nothing to verify.");
    return;
  }
  console.log("Project:", project.name, project.id);
  console.log("companyId:", project.companyId ?? "(not set)");
  console.log("reconcileBankAccountId:", project.reconcileBankAccountId ?? "(not set)");
  console.log("configured:", Boolean(project.companyId && project.reconcileBankAccountId));
  console.log("");

  const bills = await prisma.rentalBill.findMany({
    where: { orgId: project.orgId, projectId: project.id, status: "paid" },
    select: {
      id: true,
      period: true,
      totalAmount: true,
      unit: { select: { code: true } },
      tenant: { select: { bizName: true, prefix: true, firstName: true, lastName: true, nickname: true } },
      payments: {
        where: { status: "confirmed" },
        orderBy: { paidOn: "desc" },
        select: {
          id: true,
          paidOn: true,
          method: true,
          slipUrl: true,
          amountThb: true,
          ocrAmount: true,
          ocrReadAt: true,
        },
      },
    },
  });

  console.log(`"paid" bills for this project: ${bills.length}`);
  const slipPayments = bills.flatMap((b) => b.payments).filter((p) => p.slipUrl);
  console.log(`confirmed payments with a slip across those bills: ${slipPayments.length}`);
  console.log(`  · already OCR-read (ocrReadAt set): ${slipPayments.filter((p) => p.ocrReadAt).length}`);
  console.log(`  · not yet read: ${slipPayments.filter((p) => !p.ocrReadAt).length}`);
  console.log("");

  if (bills.length === 0) {
    console.log("No paid bills at all for this project — nothing further to verify against real data.");
    return;
  }

  // Find a fake actor for recordAiUsage's FK — use an existing admin/user of this org so the
  // (best-effort, non-fatal) usage log points at a real row instead of a bogus id.
  const anyUser = await prisma.user.findFirst({ where: { orgId: project.orgId }, select: { id: true } });
  const actorUserId = anyUser?.id ?? "00000000-0000-0000-0000-000000000000";

  const ocrAmountByPaymentId = new Map<string, number | null>();
  for (const p of slipPayments) {
    if (p.ocrReadAt) {
      ocrAmountByPaymentId.set(p.id, p.ocrAmount);
      continue;
    }
    // Real call to the exact production function (cache-first) — same one the matrix popup
    // triggers when a staff member opens a payment row for the first time.
    console.log(`  reading slip for payment ${p.id} (paidOn ${p.paidOn.toISOString().slice(0, 10)})…`);
    const verdict = await getOrRunRentSpacePaymentSlipCheck({
      orgId: project.orgId,
      paymentId: p.id,
      actor: { userId: actorUserId, orgId: project.orgId },
    });
    ocrAmountByPaymentId.set(p.id, verdict?.ocrAmount ?? null);
  }
  console.log("");

  let wouldSend = 0;
  let wouldSkip = 0;
  for (const b of bills) {
    const tenantName =
      b.tenant.bizName ||
      [b.tenant.prefix, b.tenant.firstName, b.tenant.lastName].filter(Boolean).join(" ").trim() ||
      b.tenant.nickname ||
      "(no tenant name)";
    const reasons = evaluateBillSlipGate(b, ocrAmountByPaymentId);
    const hasSlipPayments = b.payments.some((p) => p.slipUrl);
    console.log(
      `Bill ${b.id} · ${b.unit.code} · ${tenantName} · ${b.period} · total ${toNum(b.totalAmount)} baht · ${b.payments.length} confirmed payment(s), ${b.payments.filter((p) => p.slipUrl).length} with slip`,
    );
    if (!hasSlipPayments) {
      console.log("  -> no slip-bearing payments, gate not applicable, would send normally.");
      wouldSend++;
    } else if (reasons.length === 0) {
      console.log("  -> PASS (all slip amounts match within 1 baht) — would send.");
      wouldSend++;
    } else {
      console.log("  -> SKIPPED FOR SLIP MISMATCH:");
      for (const r of reasons) console.log("     - " + r);
      wouldSkip++;
    }
  }
  console.log("");
  console.log(`Summary: ${wouldSend} bill(s) would send, ${wouldSkip} bill(s) would be skipped for slip mismatch.`);
  console.log("(This script did not write anything to ledger_revenue_entry.)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
