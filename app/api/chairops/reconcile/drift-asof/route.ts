// Drift "as of date X" — powers the write-off "ตั้งต้นใหม่" auto-fill.
//
//   GET /api/chairops/reconcile/drift-asof?branchId=<id>&date=YYYY-MM-DD
//   → { residual, amount, direction }
//
// `residual` = drift accumulated UP TO `date` (Bangkok day), computed by the
// SAME formula the engine persists (computeDriftMoneyAsOf) so the suggested
// write-off zeroes the drift the CEO actually sees. Positive = ขาด (SHORT),
// negative = เกิน (OVER). requireRole("OFFICE") · org-scoped (no cross-tenant).

import { requireRole } from "@/lib/chairops/auth/session";
import { prisma } from "@/lib/prisma";
import { computeDriftMoneyAsOf } from "@/lib/chairops/reconcile/drift-engine";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
  const session = await requireRole("OFFICE");
  const orgId = session.poolUser.org_id;

  const url = new URL(req.url);
  const branchId = url.searchParams.get("branchId") ?? "";
  const date = url.searchParams.get("date") ?? "";

  if (!branchId) {
    return Response.json({ error: "missing branchId" }, { status: 400 });
  }
  if (!DATE_RE.test(date)) {
    return Response.json({ error: "bad date" }, { status: 400 });
  }
  // No future-dated baselines — you can't "ตั้งต้น" past data you don't have.
  const today = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
  if (date > today) {
    return Response.json({ error: "future date" }, { status: 400 });
  }

  // Org scope — a forged branchId from another tenant must not leak its drift.
  const branch = await prisma.chairopsBranch.findFirst({
    where: { id: branchId, orgId },
    select: { id: true },
  });
  if (!branch) {
    return Response.json({ error: "ไม่พบสาขา" }, { status: 404 });
  }

  const { driftAmount } = await computeDriftMoneyAsOf(branchId, orgId, date);
  const residual = Math.round(driftAmount);
  const direction = residual >= 0 ? "SHORT" : "OVER";
  const amount = Math.abs(residual);

  return Response.json({ residual, amount, direction });
}
