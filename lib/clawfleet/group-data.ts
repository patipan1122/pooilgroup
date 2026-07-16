// ClawFleet v2 — GROUP-scoped collection data (anti-fraud core · 2026-05-31).
//
// Loads the staff's accessible claw branches → their GROUPS → each group's
// EXCHANGER (Type B) + CLAW machines. This restores the Branch > Group > Machine
// model that the flat v2 collect flow dropped, so the existing Postgres
// cross-check trigger (token: exchanger coins-out == Σ claw coins-in) can fire.
//
// The group-aware collect UI uses THIS loader. (The old flat-branch loader
// v2-collect-data.ts was deleted 2026-06-01 once the group flow superseded it.)

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { userBranchIds } from "./role-guard";

export type GroupMachine = {
  id: string;
  code: string;
  name: string;
  kind: "CLAW" | "EXCHANGER";
  lastCoinMeter: number;
  lastDollMeter: number;
  lastDollStock: number;
  qrToken: string;
  // ราคาขายตุ๊กตาต่อตู้ (สตางค์ · ตั้งในหน้าตั้งค่าตู้) — โชว์ "ขาย ฿" ในหน้าเปลี่ยนตุ๊กตา (mockup)
  sellPriceCents: number | null;
};

export type CollectGroup = {
  id: string;
  name: string;
  /** TOKEN when the group has an exchanger, CASH otherwise (Type A vs B). */
  type: "TOKEN" | "CASH";
  exchanger: GroupMachine | null;
  claws: GroupMachine[];
  toleranceBps: number;
};

export type GroupCollectBranch = {
  id: string;
  name: string;
  code: string;
  area: string;
  groups: CollectGroup[];
  openSessionId: string | null;
  openSessionCode: string | null;
  /** group ids that already have an OPEN session in this branch */
  openByGroupId: Record<string, { sessionId: string; code: string; collectedMachineIds: string[] }>;
};

export type CollectSku = { id: string; sku: string; name: string };

function toMachine(m: {
  id: string;
  code: string;
  nickname: string | null;
  kind: "CLAW" | "EXCHANGER";
  lastCoinMeter: number;
  lastDollMeter: number;
  lastDollStock: number;
  qrToken: string;
  sellPriceCents: number | null;
}): GroupMachine {
  return {
    id: m.id,
    code: m.code,
    name: m.nickname ?? m.code,
    kind: m.kind,
    lastCoinMeter: m.lastCoinMeter,
    lastDollMeter: m.lastDollMeter,
    lastDollStock: m.lastDollStock,
    qrToken: m.qrToken,
    sellPriceCents: m.sellPriceCents,
  };
}

export async function getGroupCollectData(): Promise<{
  orgId: string;
  userId: string;
  branches: GroupCollectBranch[];
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

  const [groups, machines, openSessions, products] = await Promise.all([
    prisma.cfMachineGroup.findMany({
      where: { orgId, branchId: { in: branchIds }, isActive: true },
      select: { id: true, name: true, branchId: true, exchangerId: true, toleranceBps: true },
      orderBy: { name: "asc" },
    }),
    prisma.cfMachine.findMany({
      where: { orgId, branchId: { in: branchIds }, isActive: true },
      select: {
        id: true, code: true, nickname: true, kind: true, branchId: true, groupId: true,
        lastCoinMeter: true, lastDollMeter: true, lastDollStock: true, qrToken: true, sellPriceCents: true,
      },
      orderBy: { code: "asc" },
    }),
    prisma.cfCollectionSession.findMany({
      where: { orgId, status: "OPEN", branchId: { in: branchIds } },
      select: {
        id: true, sessionCode: true, branchId: true, groupId: true,
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

  // index machines by group + the exchanger lookup
  const machinesByGroup = new Map<string, GroupMachine[]>();
  // ตู้คีบที่ยังไม่ถูกจัดเข้ากลุ่ม (เช่น import เข้ามาใหม่ · groupId ว่าง) → รวมเป็นกลุ่ม
  // แสดงผล "ตู้ในสาขา" ต่อสาขา เพื่อให้พนักงานเห็น+เก็บเงินได้ (แทนที่จะขึ้นหน้าตัวอย่าง).
  // เก็บเป็น session ระดับสาขา (groupId null) → ไม่ผูก FK กลุ่ม · reconcile แบบ CASH ปกติ.
  const ungroupedClawByBranch = new Map<string, GroupMachine[]>();
  const machineById = new Map<string, (typeof machines)[number]>();
  for (const m of machines) {
    machineById.set(m.id, m);
    if (m.groupId) {
      const list = machinesByGroup.get(m.groupId) ?? [];
      list.push(toMachine(m));
      machinesByGroup.set(m.groupId, list);
    } else if (m.kind === "CLAW") {
      const list = ungroupedClawByBranch.get(m.branchId) ?? [];
      list.push(toMachine(m));
      ungroupedClawByBranch.set(m.branchId, list);
    }
  }

  // index OPEN sessions by group + branch
  const openByGroup = new Map<string, { sessionId: string; code: string; collected: string[] }>();
  const firstOpenByBranch = new Map<string, { id: string; code: string }>();
  // รอบระดับสาขา (groupId ว่าง) → ใช้กับกลุ่ม "ตู้ในสาขา" (ตู้ที่ยังไม่จัดกลุ่ม)
  const collectedByBranch = new Map<string, { sessionId: string; code: string; collected: string[] }>();
  for (const s of openSessions) {
    if (s.groupId && !openByGroup.has(s.groupId)) {
      openByGroup.set(s.groupId, {
        sessionId: s.id,
        code: s.sessionCode,
        collected: s.events.map((e) => e.machineId),
      });
    }
    if (s.branchId && !firstOpenByBranch.has(s.branchId)) {
      firstOpenByBranch.set(s.branchId, { id: s.id, code: s.sessionCode });
    }
    if (!s.groupId && s.branchId && !collectedByBranch.has(s.branchId)) {
      collectedByBranch.set(s.branchId, {
        sessionId: s.id,
        code: s.sessionCode,
        collected: s.events.map((e) => e.machineId),
      });
    }
  }

  const groupsByBranch = new Map<string, CollectGroup[]>();
  for (const g of groups) {
    const all = machinesByGroup.get(g.id) ?? [];
    const exchanger =
      (g.exchangerId ? all.find((m) => m.id === g.exchangerId) : null) ??
      all.find((m) => m.kind === "EXCHANGER") ??
      null;
    const claws = all.filter((m) => m.kind === "CLAW");
    const list = groupsByBranch.get(g.branchId) ?? [];
    list.push({
      id: g.id,
      name: g.name,
      type: exchanger ? "TOKEN" : "CASH",
      exchanger,
      claws,
      toleranceBps: g.toleranceBps,
    });
    groupsByBranch.set(g.branchId, list);
  }

  return {
    orgId,
    userId: session.user.id,
    branches: branches.map((b) => {
      const first = firstOpenByBranch.get(b.id) ?? null;
      const branchGroups = [...(groupsByBranch.get(b.id) ?? [])];
      // ต่อท้ายกลุ่ม "ตู้ในสาขา" (ตู้คีบที่ยังไม่ได้จัดกลุ่ม) ถ้ามี → พนักงานเห็น+เก็บได้
      const ungrouped = ungroupedClawByBranch.get(b.id) ?? [];
      if (ungrouped.length > 0) {
        branchGroups.push({
          id: `ungrouped-${b.id}`,
          name: "ตู้ในสาขา",
          type: "CASH",
          exchanger: null,
          claws: ungrouped,
          toleranceBps: 0,
        });
      }
      const openByGroupId: GroupCollectBranch["openByGroupId"] = {};
      for (const g of branchGroups) {
        const open = openByGroup.get(g.id);
        if (open) {
          openByGroupId[g.id] = {
            sessionId: open.sessionId,
            code: open.code,
            collectedMachineIds: open.collected,
          };
        }
      }
      // กลุ่ม "ตู้ในสาขา" ใช้รอบระดับสาขา (groupId null) → ผูกกับ session สาขาที่เปิดอยู่
      const bc = collectedByBranch.get(b.id);
      if (ungrouped.length > 0 && bc) {
        openByGroupId[`ungrouped-${b.id}`] = {
          sessionId: bc.sessionId,
          code: bc.code,
          collectedMachineIds: bc.collected,
        };
      }
      return {
        id: b.id,
        name: b.name,
        code: b.code,
        area: b.province ?? b.region ?? "—",
        groups: branchGroups,
        openSessionId: first?.id ?? null,
        openSessionCode: first?.code ?? null,
        openByGroupId,
      };
    }),
    skus: products.map((p) => ({ id: p.id, sku: p.sku, name: p.name })),
  };
}
