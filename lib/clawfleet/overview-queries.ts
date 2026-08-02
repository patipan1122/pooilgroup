// ClawFleet · "ภาพรวมทุกสาขา" (all-branches overview) — server-only query layer.
//
// การ์ด 1 ใบ = 1 สาขา · แต่ละใบบอก: ตู้ทั้งหมด · เก็บวันนี้ · ขาด · เงิน · ปัญหา.
// 2 โหมด:
//   - date   : ระบุวัน (default = วันนี้ เวลาไทย) → เลขของ "วันนั้น" ต่อสาขา
//   - latest : ดูล่าสุด → แต่ละสาขาโชว์เลขของ "วันเก็บล่าสุด" ของสาขานั้น (สาขาต่างวันได้)
//
// เงิน (cash) คิดเหมือน getDaySummaries เป๊ะ: Σ cashCountedCents ของ event COLLECTION / 100.
// "เก็บ" = ตู้คีบที่ยัง active และมี COLLECTION วันนั้น (distinct) · "ขาด" = totalActive − collected (clamp ≥ 0).
//
// READ-ONLY · org + branch scope ทุก query (RLS-safe เหมือน queries.ts) · ไม่มี migration ไม่แตะเงิน.

import { prisma } from "@/lib/prisma";
import { requireSession, type Session } from "@/lib/auth/session";
import { userBranchIds } from "./role-guard";
import { listRepairTickets } from "./repair-queries";

/** scope org + สาขาที่ user เห็นได้ (mirror ของ scope() ใน queries.ts) */
async function scope(session: Session): Promise<{ orgId: string; branchIds: string[] | "ALL" }> {
  const branchIds = await userBranchIds(session);
  return { orgId: session.user.org_id, branchIds };
}

/** วันไทย "YYYY-MM-DD" จาก Date ใด ๆ (Asia/Bangkok) — เหมือน ISO_FMT ใน raw-readings-queries */
const ISO_DAY_FMT = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Bangkok",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
function bangkokDay(d: Date): string {
  return ISO_DAY_FMT.format(d);
}

/** ช่วงเวลาของ "1 วันไทย" (isoDay) → [ต้นวัน, ต้นวันถัดไป) */
function dayRange(isoDay: string): { gte: Date; lt: Date } {
  const gte = new Date(`${isoDay}T00:00:00+07:00`);
  return { gte, lt: new Date(gte.getTime() + 86_400_000) };
}

export type BranchOverviewRow = {
  branchId: string;
  branchName: string;
  branchCode: string;
  totalMachines: number;
  collected: number;
  missing: number;
  cashBaht: number;
  baseline: number;
  broken: number;
  mismatch: number;
  problems: number;
  /** วันไทยที่การ์ดนี้สะท้อน (latest = วันล่าสุดของสาขานั้น · date = วันที่เลือก · null = ไม่มีข้อมูล) */
  dayIso: string | null;
};

export type BranchOverview = {
  mode: "date" | "latest";
  /** วันอ้างอิง (date = วันที่เลือก · latest = วันนี้) */
  isoDay: string;
  rows: BranchOverviewRow[];
  totals: {
    branches: number;
    machines: number;
    collected: number;
    missing: number;
    cashBaht: number;
    problems: number;
  };
};

type Agg = {
  collected: Set<string>; // machineId ที่มี COLLECTION (ในวันเป้าหมาย)
  baseline: Set<string>; // machineId ที่มี INITIAL (ในวันเป้าหมาย)
  cashCents: number;
};
function emptyAgg(): Agg {
  return { collected: new Set(), baseline: new Set(), cashCents: 0 };
}

/**
 * ภาพรวมทุกสาขา — 1 การ์ด/สาขา.
 * @param opts.mode   "date" = ระบุวัน · "latest" = วันเก็บล่าสุดต่อสาขา
 * @param opts.isoDay วันอ้างอิง "YYYY-MM-DD" (date = วันที่เลือก · latest = วันนี้)
 */
export async function getBranchOverview(opts: {
  mode: "date" | "latest";
  isoDay: string;
}): Promise<BranchOverview> {
  const { mode, isoDay } = opts;
  const session = await requireSession();
  const { orgId, branchIds } = await scope(session);
  const branchFilter = branchIds === "ALL" ? {} : { branchId: { in: branchIds } };

  // สาขาคีบทั้งหมดในขอบเขต — เป็น source of truth ของ "แถว" (โชว์ทุกสาขาแม้วันนั้นไม่มีกิจกรรม)
  const branches = await prisma.branch.findMany({
    where: {
      orgId,
      businessType: "claw_machine",
      isActive: true,
      ...(branchIds !== "ALL" ? { id: { in: branchIds } } : {}),
    },
    select: { id: true, name: true, code: true },
    orderBy: { code: "asc" },
  });

  // ตู้คีบ active ต่อสาขา
  const machines = await prisma.cfMachine.findMany({
    where: { orgId, kind: "CLAW", isActive: true, ...branchFilter },
    select: { id: true, branchId: true },
  });
  const activeByBranch = new Map<string, Set<string>>();
  for (const m of machines) {
    let s = activeByBranch.get(m.branchId);
    if (!s) { s = new Set(); activeByBranch.set(m.branchId, s); }
    s.add(m.id);
  }

  // ── รวมกิจกรรมต่อสาขา + วันที่การ์ดสะท้อน ──────────────────────────────────
  const aggByBranch = new Map<string, Agg>();
  const dayByBranch = new Map<string, string>(); // วันที่การ์ดสาขานี้สะท้อน (มีข้อมูลเท่านั้น)
  const getAgg = (bid: string): Agg => {
    let a = aggByBranch.get(bid);
    if (!a) { a = emptyAgg(); aggByBranch.set(bid, a); }
    return a;
  };

  if (mode === "date") {
    const range = dayRange(isoDay);
    const events = await prisma.cfCollectionEvent.findMany({
      where: {
        orgId,
        collectedAt: { gte: range.gte, lt: range.lt },
        eventType: { in: ["COLLECTION", "INITIAL"] },
        machine: { kind: "CLAW", ...branchFilter },
      },
      select: {
        machineId: true,
        eventType: true,
        cashCountedCents: true,
        machine: { select: { branchId: true } },
      },
    });
    for (const e of events) {
      const bid = e.machine.branchId;
      const a = getAgg(bid);
      if (e.eventType === "COLLECTION") {
        a.collected.add(e.machineId);
        a.cashCents += e.cashCountedCents;
      } else {
        a.baseline.add(e.machineId);
      }
      dayByBranch.set(bid, isoDay); // date mode → การ์ดสะท้อนวันที่เลือกเสมอ (เมื่อมีข้อมูล)
    }
  } else {
    // latest — ดึง 60 วันย้อนหลัง (bounded) → หาวันเก็บ (COLLECTION) ล่าสุดต่อสาขา → รวมเฉพาะวันนั้น
    const since = new Date(Date.now() - 60 * 86_400_000);
    const events = await prisma.cfCollectionEvent.findMany({
      where: {
        orgId,
        collectedAt: { gte: since },
        eventType: { in: ["COLLECTION", "INITIAL"] },
        machine: { kind: "CLAW", ...branchFilter },
      },
      select: {
        machineId: true,
        eventType: true,
        cashCountedCents: true,
        collectedAt: true,
        machine: { select: { branchId: true } },
      },
    });
    // รอบแรก: วันเก็บ (COLLECTION) ล่าสุดต่อสาขา
    for (const e of events) {
      if (e.eventType !== "COLLECTION") continue;
      const bid = e.machine.branchId;
      const d = bangkokDay(e.collectedAt);
      const cur = dayByBranch.get(bid);
      if (!cur || d > cur) dayByBranch.set(bid, d);
    }
    // รอบสอง: รวมเฉพาะ event ที่อยู่ในวันล่าสุดของสาขานั้น
    for (const e of events) {
      const bid = e.machine.branchId;
      const latest = dayByBranch.get(bid);
      if (!latest) continue; // สาขาไม่มี COLLECTION ใน 60 วัน → ไม่มีวันล่าสุด
      if (bangkokDay(e.collectedAt) !== latest) continue;
      const a = getAgg(bid);
      if (e.eventType === "COLLECTION") {
        a.collected.add(e.machineId);
        a.cashCents += e.cashCountedCents;
      } else {
        a.baseline.add(e.machineId);
      }
    }
  }

  // ── ปัญหา: ตู้เสีย (repair OPEN/IN_PROGRESS) + รอบไม่ตรง (anomalyFlags) ──────
  const [openTix, inProgTix] = await Promise.all([
    listRepairTickets({ status: "OPEN" }),
    listRepairTickets({ status: "IN_PROGRESS" }),
  ]);
  const brokenByBranch = new Map<string, Set<string>>(); // branchId → distinct machineId ที่เสีย
  for (const t of [...openTix, ...inProgTix]) {
    let s = brokenByBranch.get(t.branchId);
    if (!s) { s = new Set(); brokenByBranch.set(t.branchId, s); }
    s.add(t.machineId);
  }

  const mismatchByBranch = new Map<string, number>(); // branchId → จำนวนรอบที่มีธงไม่ตรง (วันเป้าหมาย)
  const bumpMismatch = (bid: string) => mismatchByBranch.set(bid, (mismatchByBranch.get(bid) ?? 0) + 1);

  if (mode === "date") {
    const range = dayRange(isoDay);
    const sessions = await prisma.cfCollectionSession.findMany({
      where: {
        orgId,
        ...branchFilter,
        OR: [{ closedAt: range }, { status: "OPEN" as const, openedAt: range }],
      },
      select: { branchId: true, anomalyFlags: true },
    });
    for (const s of sessions) {
      if (!s.branchId) continue;
      if (s.anomalyFlags.length > 0) bumpMismatch(s.branchId);
    }
  } else {
    // latest — ดึงรอบ 60 วัน แล้วนับเฉพาะรอบที่ตรงกับวันล่าสุดของแต่ละสาขา
    const since = new Date(Date.now() - 60 * 86_400_000);
    const sessions = await prisma.cfCollectionSession.findMany({
      where: {
        orgId,
        ...branchFilter,
        OR: [{ closedAt: { gte: since } }, { status: "OPEN" as const, openedAt: { gte: since } }],
      },
      select: { branchId: true, anomalyFlags: true, closedAt: true, openedAt: true },
    });
    for (const s of sessions) {
      if (!s.branchId) continue;
      if (s.anomalyFlags.length === 0) continue;
      const latest = dayByBranch.get(s.branchId);
      if (!latest) continue;
      // วันของรอบ = วันปิด (ถ้าปิดแล้ว) · ไม่งั้นใช้วันเปิด (รอบ OPEN)
      const dayOf = bangkokDay(s.closedAt ?? s.openedAt);
      if (dayOf === latest) bumpMismatch(s.branchId);
    }
  }

  // ── ประกอบแถว (ทุกสาขาในขอบเขต · เรียง ปัญหา desc → เงิน desc) ─────────────
  const rows: BranchOverviewRow[] = branches.map((b) => {
    const active = activeByBranch.get(b.id);
    const totalMachines = active?.size ?? 0;
    const a = aggByBranch.get(b.id);

    // นับ "เก็บแล้ว" เฉพาะตู้ที่ยัง active (กัน missing ติดลบ · เหมือน getDaySummaries)
    let collected = 0;
    if (a && active) for (const id of a.collected) if (active.has(id)) collected++;

    const cashBaht = a ? Math.round(a.cashCents / 100) : 0;
    const baseline = a?.baseline.size ?? 0;
    const broken = brokenByBranch.get(b.id)?.size ?? 0;
    const mismatch = mismatchByBranch.get(b.id) ?? 0;

    return {
      branchId: b.id,
      branchName: b.name,
      branchCode: b.code,
      totalMachines,
      collected,
      missing: Math.max(0, totalMachines - collected),
      cashBaht,
      baseline,
      broken,
      mismatch,
      problems: broken + mismatch,
      dayIso: mode === "date" ? isoDay : (dayByBranch.get(b.id) ?? null),
    };
  });

  rows.sort((x, y) => (y.problems - x.problems) || (y.cashBaht - x.cashBaht));

  const totals = rows.reduce(
    (t, r) => {
      t.machines += r.totalMachines;
      t.collected += r.collected;
      t.missing += r.missing;
      t.cashBaht += r.cashBaht;
      t.problems += r.problems;
      return t;
    },
    { branches: rows.length, machines: 0, collected: 0, missing: 0, cashBaht: 0, problems: 0 },
  );

  return { mode, isoDay, rows, totals };
}
