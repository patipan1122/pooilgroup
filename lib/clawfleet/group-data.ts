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
  // CEO 2026-08-01 · "ส่วนต่างคงที่" ของ 2 มิเตอร์ (เฟือง−ดิจิตอล) — 2 หน้าปัดคนละฐาน (ค่าไม่เท่ากัน)
  //   แต่ห่างกันเท่าเดิมทุกรอบ. เช็ค anti-fraud: (เฟืองรอบนี้ − ดิจิตอลรอบนี้) ต้อง = ค่านี้. ดึงจาก event
  //   ล่าสุดที่กรอกเฟือง+ดิจิตอลครบ (รวม INITIAL/baseline = เลขจริงที่พนักงานกรอกตอนตั้งตู้). null = ยังเทียบไม่ได้.
  coinMeterOffset: number | null;
  dollMeterOffset: number | null;
  // CEO 2026-08-01 · เลขจริงต่อหน้าปัดจาก event ล่าสุดที่กรอกครบ (รวม baseline/ตั้งค่าตู้) — placeholder อ้างอิงในช่องกรอก
  //   (เลขที่พนักงานกรอกจริง · ครบ 4 ตัว แต่ละหน้าปัด). null = ไม่เคยมีเลขครบเลย → ช่องว่าง.
  prevCoinGear: number | null; prevCoinDigi: number | null;
  prevDollGear: number | null; prevDollDigi: number | null;
  qrToken: string;
  // ราคาขายตุ๊กตาต่อตู้ (สตางค์ · ตั้งในหน้าตั้งค่าตู้) — โชว์ "ขาย ฿" ในหน้าเปลี่ยนตุ๊กตา (mockup)
  sellPriceCents: number | null;
  // ค่าเล่นต่อครั้ง (เหรียญ · loadout ที่ active · 1 เหรียญ = ฿10) — client ใช้คิดเงินคาด preview ให้ตรง server (เดิม hardcode ฿10)
  pricePerPlayCoins: number;
  // CEO 2026-07-19 · รอบก่อน (โชว์ตอนเริ่มเก็บ) — วันไทยพร้อมโชว์ (คิดที่ server กัน tz)
  lastCollectedAt: string | null; // เก็บ/มีevent ล่าสุด (จาก lastEventAt · รวม baseline)
  lastRefillAt: string | null; // เติมตุ๊กตาล่าสุด (LOAD_TO_MACHINE)
};

// วันไทยแบบสั้น "19 ก.ค. 69" (server-side · client ไม่มี tz formatter)
function thaiShortDate(d: Date | null | undefined): string | null {
  if (!d) return null;
  return new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "2-digit", timeZone: "Asia/Bangkok" }).format(d);
}

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
  loadouts: { pricePerPlayCoins: number }[];
  lastEventAt: Date | null;
}, lastRefillAt: Date | null, offset: { coin: number | null; doll: number | null } | null,
   prevRead: { cGear: number | null; cDigi: number | null; dGear: number | null; dDigi: number | null } | null): GroupMachine {
  return {
    id: m.id,
    code: m.code,
    name: m.nickname ?? m.code,
    kind: m.kind,
    lastCoinMeter: m.lastCoinMeter,
    lastDollMeter: m.lastDollMeter,
    lastDollStock: m.lastDollStock,
    coinMeterOffset: offset?.coin ?? null,
    dollMeterOffset: offset?.doll ?? null,
    prevCoinGear: prevRead?.cGear ?? null, prevCoinDigi: prevRead?.cDigi ?? null,
    prevDollGear: prevRead?.dGear ?? null, prevDollDigi: prevRead?.dDigi ?? null,
    qrToken: m.qrToken,
    sellPriceCents: m.sellPriceCents,
    // active loadout = effectiveTo:null (เหมือน actions.ts) · ไม่มี → default 1 เหรียญ (฿10)
    pricePerPlayCoins: m.loadouts[0]?.pricePerPlayCoins ?? 1,
    lastCollectedAt: thaiShortDate(m.lastEventAt),
    lastRefillAt: thaiShortDate(lastRefillAt),
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
        // ค่าเล่นต่อครั้ง (loadout ที่ active) — เหมือน actions.ts เป๊ะ → client คิดเงินคาดตรง server
        loadouts: { where: { effectiveTo: null }, take: 1, orderBy: { effectiveFrom: "desc" }, select: { pricePerPlayCoins: true } },
        lastEventAt: true, // CEO 2026-07-19 · "เก็บล่าสุด" รอบก่อน
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

  // CEO 2026-07-19 · "เติมล่าสุด" ต่อตู้ — max(occurredAt) ของ movement เติมเข้าตู้ (standalone + ในรอบเก็บ)
  //   (lastEventAt มิเรอร์ให้แล้ว = เก็บล่าสุด · เติมไม่มิเรอร์ → groupBy เพิ่ม 1 query · index occurredAt)
  const lastRefillByMachine = new Map<string, Date>();
  try {
    const machineIds = machines.map((m) => m.id);
    if (machineIds.length > 0) {
      const refillAgg = await prisma.cfStockMovement.groupBy({
        by: ["machineId"],
        where: { orgId, machineId: { in: machineIds }, type: "LOAD_TO_MACHINE", refTable: { in: ["cf_refill_dolls", "cf_collection_events"] } },
        _max: { occurredAt: true },
      });
      for (const r of refillAgg) {
        if (r.machineId && r._max.occurredAt) lastRefillByMachine.set(r.machineId, r._max.occurredAt);
      }
    }
  } catch {
    // graceful: query ล้ม → ไม่มี "เติมล่าสุด" (โชว์ "ยังไม่เคยเติม")
  }

  // CEO 2026-08-02 · กฎถาวร: มิเตอร์ บน(Top)=ดิจิตอล · ล่าง(Bottom)=เฟือง เสมอ. แต่ write path เก็บ "สลับ":
  //   INITIAL/baseline เก็บถูก (meterMoneyTop=ดิจิตอล · meterMoneyBottom=เฟือง)
  //   COLLECTION เก็บกลับหัว (submit `coinMeterTop: coinGear` → meterMoneyTop=เฟือง · meterMoneyBottom=ดิจิตอล)
  //   → อ่านต้อง normalize ตาม eventType ก่อนใช้ ไม่งั้น offset เครื่องหมายกลับ + placeholder สลับช่อง (ตู้ baseline).
  //   ดิจิตอลเชื่อ coin/doll_meter_after ได้เสมอ (ทุก event = ดิจิตอล). เฟืองต้องดู eventType.
  //   ใช้ทำ (1) offset=เฟือง−ดิจิตอล (anti-fraud "ขยับเท่ากัน") (2) placeholder เลขจริง 4 หน้าปัด.
  const offsetByMachine = new Map<string, { coin: number | null; doll: number | null }>();
  const prevReadByMachine = new Map<string, { cGear: number | null; cDigi: number | null; dGear: number | null; dDigi: number | null }>();
  const blankPrev = () => ({ cGear: null as number | null, cDigi: null as number | null, dGear: null as number | null, dDigi: null as number | null });
  // แยก เฟือง/ดิจิตอล จาก top/bottom ตามกฎถาวร (COLLECTION เก็บกลับหัว · INITIAL/อื่น ๆ = ตรงกฎ บน=ดิจิตอล)
  const dialsOf = (evType: string, top: number, bottom: number) =>
    evType === "COLLECTION" ? { gear: top, digital: bottom } : { gear: bottom, digital: top };
  try {
    const machineIds = machines.map((m) => m.id);
    if (machineIds.length > 0) {
      // (A) event ล่าสุดที่กรอกครบทั้งคู่ → offset (เฟือง−ดิจิตอล) + prevRead หลัก (normalize ตาม eventType)
      const coinRows = await prisma.cfCollectionEvent.findMany({
        where: { orgId, machineId: { in: machineIds }, meterMoneyTop: { not: null }, meterMoneyBottom: { not: null } },
        orderBy: { collectedAt: "desc" },
        distinct: ["machineId"],
        select: { machineId: true, eventType: true, meterMoneyTop: true, meterMoneyBottom: true },
      });
      const dollRows = await prisma.cfCollectionEvent.findMany({
        where: { orgId, machineId: { in: machineIds }, meterDollTop: { not: null }, meterDollBottom: { not: null } },
        orderBy: { collectedAt: "desc" },
        distinct: ["machineId"],
        select: { machineId: true, eventType: true, meterDollTop: true, meterDollBottom: true },
      });
      for (const r of coinRows) {
        const { gear, digital } = dialsOf(r.eventType, r.meterMoneyTop as number, r.meterMoneyBottom as number);
        const off = offsetByMachine.get(r.machineId) ?? { coin: null, doll: null };
        off.coin = gear - digital;
        offsetByMachine.set(r.machineId, off);
        const pr = prevReadByMachine.get(r.machineId) ?? blankPrev();
        pr.cGear = gear; pr.cDigi = digital;
        prevReadByMachine.set(r.machineId, pr);
      }
      for (const r of dollRows) {
        const { gear, digital } = dialsOf(r.eventType, r.meterDollTop as number, r.meterDollBottom as number);
        const off = offsetByMachine.get(r.machineId) ?? { coin: null, doll: null };
        off.doll = gear - digital;
        offsetByMachine.set(r.machineId, off);
        const pr = prevReadByMachine.get(r.machineId) ?? blankPrev();
        pr.dGear = gear; pr.dDigi = digital;
        prevReadByMachine.set(r.machineId, pr);
      }
      // (B) เติมทีละหน้าปัด (รอบก่อนกรอกไม่ครบคู่) — fill เฉพาะช่องที่ยัง null (ไม่ทับ (A) = ไม่ regress)
      const fillPrev = (machineId: string, patch: Partial<{ cGear: number; cDigi: number; dGear: number; dDigi: number }>) => {
        const pr = prevReadByMachine.get(machineId) ?? blankPrev();
        if (patch.cGear != null && pr.cGear == null) pr.cGear = patch.cGear;
        if (patch.cDigi != null && pr.cDigi == null) pr.cDigi = patch.cDigi;
        if (patch.dGear != null && pr.dGear == null) pr.dGear = patch.dGear;
        if (patch.dDigi != null && pr.dDigi == null) pr.dDigi = patch.dDigi;
        prevReadByMachine.set(machineId, pr);
      };
      // ดิจิตอล = coin/doll_meter_after (ดิจิตอลเสมอ ทุก event type · coin มีทุกรอบเก็บ · doll nullable)
      const coinDigiRows = await prisma.cfCollectionEvent.findMany({
        where: { orgId, machineId: { in: machineIds } },
        orderBy: { collectedAt: "desc" }, distinct: ["machineId"],
        select: { machineId: true, coinMeterAfter: true },
      });
      const dollDigiRows = await prisma.cfCollectionEvent.findMany({
        where: { orgId, machineId: { in: machineIds }, dollMeterAfter: { not: null } },
        orderBy: { collectedAt: "desc" }, distinct: ["machineId"],
        select: { machineId: true, dollMeterAfter: true },
      });
      // เฟือง = event ล่าสุดที่ "มีเฟือง" · เฟืองอยู่ top เมื่อ COLLECTION · อยู่ bottom เมื่อ INITIAL (กฎถาวร)
      const coinGearRows = await prisma.cfCollectionEvent.findMany({
        where: { orgId, machineId: { in: machineIds }, OR: [
          { eventType: "COLLECTION", meterMoneyTop: { not: null } },
          { eventType: { not: "COLLECTION" }, meterMoneyBottom: { not: null } },
        ] },
        orderBy: { collectedAt: "desc" }, distinct: ["machineId"],
        select: { machineId: true, eventType: true, meterMoneyTop: true, meterMoneyBottom: true },
      });
      const dollGearRows = await prisma.cfCollectionEvent.findMany({
        where: { orgId, machineId: { in: machineIds }, OR: [
          { eventType: "COLLECTION", meterDollTop: { not: null } },
          { eventType: { not: "COLLECTION" }, meterDollBottom: { not: null } },
        ] },
        orderBy: { collectedAt: "desc" }, distinct: ["machineId"],
        select: { machineId: true, eventType: true, meterDollTop: true, meterDollBottom: true },
      });
      for (const r of coinDigiRows) fillPrev(r.machineId, { cDigi: r.coinMeterAfter });
      for (const r of dollDigiRows) fillPrev(r.machineId, { dDigi: r.dollMeterAfter ?? undefined });
      for (const r of coinGearRows) {
        const g = r.eventType === "COLLECTION" ? r.meterMoneyTop : r.meterMoneyBottom;
        fillPrev(r.machineId, { cGear: g ?? undefined });
      }
      for (const r of dollGearRows) {
        const g = r.eventType === "COLLECTION" ? r.meterDollTop : r.meterDollBottom;
        fillPrev(r.machineId, { dGear: g ?? undefined });
      }
    }
  } catch {
    // graceful: query ล้ม → ไม่มี offset/เลขอ้างอิง (ข้าม cross-check + ช่องว่าง · ไม่พัง)
  }

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
      list.push(toMachine(m, lastRefillByMachine.get(m.id) ?? null, offsetByMachine.get(m.id) ?? null, prevReadByMachine.get(m.id) ?? null));
      machinesByGroup.set(m.groupId, list);
    } else if (m.kind === "CLAW") {
      const list = ungroupedClawByBranch.get(m.branchId) ?? [];
      list.push(toMachine(m, lastRefillByMachine.get(m.id) ?? null, offsetByMachine.get(m.id) ?? null, prevReadByMachine.get(m.id) ?? null));
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
