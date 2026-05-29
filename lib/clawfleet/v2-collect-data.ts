// ClawFleet v2 — server data for the staff branch-collection flow.
// Loads the staff's accessible claw branches + their CLAW machines (with mirror
// counters for prefill) + the SKU list for the refill picker + any OPEN round.

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { userBranchIds } from "./role-guard";

export type CollectMachine = {
  id: string;
  code: string;
  name: string;
  lastCoinMeter: number;
  lastDollMeter: number;
  lastDollStock: number;
  qrToken: string;
};

export type CollectSku = { id: string; sku: string; name: string };

export type CollectBranch = {
  id: string;
  name: string;
  code: string;
  area: string;
  machines: CollectMachine[];
  openSessionId: string | null;
  openSessionCode: string | null;
  collectedMachineIds: string[];
};

export async function getCollectData(): Promise<{
  orgId: string;
  userId: string;
  branches: CollectBranch[];
  skus: CollectSku[];
}> {
  const session = await requireSession();
  const orgId = session.user.org_id;
  const allowed = await userBranchIds(session);

  const branches = await prisma.branch.findMany({
    where: {
      orgId,
      businessType: "claw_machine",
      isActive: true,
      ...(allowed === "ALL" ? {} : { id: { in: allowed } }),
    },
    select: { id: true, name: true, code: true, province: true, region: true },
    orderBy: { code: "asc" },
  });
  const branchIds = branches.map((b) => b.id);

  if (branchIds.length === 0) {
    return { orgId, userId: session.user.id, branches: [], skus: [] };
  }

  const [machines, openSessions, products] = await Promise.all([
    prisma.cfMachine.findMany({
      where: { orgId, branchId: { in: branchIds }, kind: "CLAW", isActive: true },
      select: {
        id: true, code: true, nickname: true, branchId: true,
        lastCoinMeter: true, lastDollMeter: true, lastDollStock: true, qrToken: true,
      },
      orderBy: { code: "asc" },
    }),
    prisma.cfCollectionSession.findMany({
      where: { orgId, status: "OPEN", branchId: { in: branchIds } },
      select: {
        id: true, sessionCode: true, branchId: true,
        events: { where: { eventType: "COLLECTION" }, select: { machineId: true } },
      },
      orderBy: { openedAt: "desc" },
    }),
    prisma.cfProduct.findMany({
      where: { orgId, isActive: true },
      select: { id: true, sku: true, name: true },
      orderBy: { sku: "asc" },
    }),
  ]);

  const machinesByBranch = new Map<string, CollectMachine[]>();
  for (const m of machines) {
    const list = machinesByBranch.get(m.branchId) ?? [];
    list.push({
      id: m.id,
      code: m.code,
      name: m.nickname ?? m.code,
      lastCoinMeter: m.lastCoinMeter,
      lastDollMeter: m.lastDollMeter,
      lastDollStock: m.lastDollStock,
      qrToken: m.qrToken,
    });
    machinesByBranch.set(m.branchId, list);
  }

  // first OPEN session per branch
  const openByBranch = new Map<string, { id: string; code: string; collected: string[] }>();
  for (const s of openSessions) {
    if (!s.branchId || openByBranch.has(s.branchId)) continue;
    openByBranch.set(s.branchId, {
      id: s.id,
      code: s.sessionCode,
      collected: s.events.map((e) => e.machineId),
    });
  }

  return {
    orgId,
    userId: session.user.id,
    branches: branches.map((b) => {
      const open = openByBranch.get(b.id) ?? null;
      return {
        id: b.id,
        name: b.name,
        code: b.code,
        area: b.province ?? b.region ?? "—",
        machines: machinesByBranch.get(b.id) ?? [],
        openSessionId: open?.id ?? null,
        openSessionCode: open?.code ?? null,
        collectedMachineIds: open?.collected ?? [],
      };
    }),
    skus: products.map((p) => ({ id: p.id, sku: p.sku, name: p.name })),
  };
}
