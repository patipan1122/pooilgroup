import { requireSession } from "@/lib/auth/session";
import { isSuperAdmin } from "@/lib/auth/role-guards";
import { prisma } from "@/lib/prisma";
import { getPrimaryProject, meterBoard } from "@/lib/rentspace/data";
import {
  formatBaht,
  currentPeriod,
  prevPeriod,
  periodLabel,
  toNum,
  tenantDisplayName,
} from "@/lib/rentspace/format";
import { RsPage, RsHeader, RsKpi, RsEmpty } from "@/components/rentspace/ui";
import MeterBoard, { type BoardUnit, type BoardSide } from "./_components/meter-board";
import SelectiveBillPanel, { type BillRoom } from "./_components/selective-bill-panel";

export const dynamic = "force-dynamic";

type MeterRow = {
  id: string;
  kind: "electric" | "water";
  initialReading?: unknown; // เลขตั้งต้นของมิเตอร์ (ฐานเดือนแรก ถ้า >0)
  readings: {
    prevReading?: unknown;
    currReading?: unknown;
    usage?: unknown;
    amountThb?: unknown;
    photoUrl?: string | null;
    isReset?: boolean | null;
    oldMeterFinal?: unknown;
  }[];
};

/** Build the serializable side (electric/water) data for one unit. */
function buildSide(meters: MeterRow[], kind: "electric" | "water"): BoardSide {
  const meter = meters.find((m) => m.kind === kind);
  const reading = meter?.readings?.[0];
  if (!reading) {
    return {
      prevReading: null,
      currReading: null,
      usage: null,
      amount: null,
      photoUrl: null,
      isReset: false,
      oldMeterFinal: null,
      prevUsage: null, // หน่วยเดือนก่อน (เติมทีหลังจาก prevUsageMap)
      needsBaseline: false, // เติมทีหลังใน withCarry (ห้องใหม่ที่ไม่มีประวัติ)
    };
  }
  return {
    prevReading: toNum(reading.prevReading),
    currReading: reading.currReading == null ? null : toNum(reading.currReading),
    usage: reading.usage == null ? null : toNum(reading.usage),
    amount: reading.amountThb == null ? null : toNum(reading.amountThb),
    photoUrl: reading.photoUrl ?? null,
    isReset: !!reading.isReset,
    oldMeterFinal: reading.oldMeterFinal == null ? null : toNum(reading.oldMeterFinal),
    prevUsage: null, // หน่วยเดือนก่อน (เติมทีหลังจาก prevUsageMap)
    needsBaseline: false,
  };
}

export default async function MetersPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const session = await requireSession();
  const orgId = session.user.org_id;
  const sp = await searchParams;
  const period = /^\d{4}-\d{2}$/.test(sp.period ?? "") ? sp.period! : currentPeriod();

  const project = await getPrimaryProject(orgId);

  if (!project) {
    return (
      <RsPage>
        <RsHeader title="จดมิเตอร์น้ำ-ไฟ" subtitle="บันทึกเลขมิเตอร์ประจำเดือน" />
        <RsEmpty
          icon="🏗️"
          title="ยังไม่มีโครงการ"
          hint="ตั้งค่าโครงการเช่าก่อนในหน้า ตั้งค่า เพื่อเริ่มจดมิเตอร์"
        />
      </RsPage>
    );
  }

  // upspeed: ยิงพร้อมกัน — meterBoard (ห้อง+มิเตอร์งวดนี้) กับ "ห้องที่ออกบิลแล้ว"
  // ไม่พึ่งกัน (billedUnitRows ใช้แค่ projectId+period) → Promise.all ลด wall-clock.
  const [rawUnits, billedUnitRows] = await Promise.all([
    meterBoard(orgId, project.id, period),
    prisma.rentalBill.findMany({
      where: { orgId, projectId: project.id, period, status: { not: "void" } },
      select: { unitId: true },
    }),
  ]);
  const billedUnitIds = new Set(billedUnitRows.map((b) => b.unitId));

  // #1b — 2 อย่าง: (1) หน่วยใช้ "เดือนก่อนพอดี" ไว้โชว์ % เทียบ · (2) "เลขล่าสุดก่อนงวดนี้"
  //   = "ครั้งก่อน" ที่ carry-forward มา. **ครั้งก่อน ต้องใช้ reading ล่าสุดที่ period < งวดนี้
  //   (ไม่ใช่เดือนก่อนพอดี)** เพื่อให้ตรงกับที่ server (actSaveMeterReading.prevRow) คิดจริง —
  //   ถ้ามีเดือนข้าม (ห้องว่าง 1 เดือน) จอกับบิลจะได้ไม่เพี้ยน (กัน P0 จ่ายเกิน/ขาด).
  const ids = rawUnits.map((u) => u.id);
  const prev = prevPeriod(period);
  const [prevMonthRows, priorLatestRows] = await Promise.all([
    prisma.rentalMeterReading.findMany({
      where: { orgId, unitId: { in: ids }, period: prev },
      select: { unitId: true, kind: true, usage: true },
    }),
    prisma.rentalMeterReading.findMany({
      // currReading เป็นคอลัมน์ non-nullable (default 0) → กรอง { not: null } ไม่ได้
      // (Prisma 7 โยน ValidationError ทำหน้าล่มทั้งหน้า) และไม่มีความหมายเพราะไม่มีแถวว่าง
      where: { orgId, unitId: { in: ids }, period: { lt: period } },
      orderBy: [{ unitId: "asc" }, { kind: "asc" }, { period: "desc" }],
      distinct: ["unitId", "kind"],
      select: { unitId: true, kind: true, currReading: true },
    }),
  ]);
  const prevUsageMap = new Map<string, { electric: number | null; water: number | null }>();
  for (const r of prevMonthRows) {
    const usage = r.usage == null ? null : toNum(r.usage);
    const m = prevUsageMap.get(r.unitId) ?? { electric: null, water: null };
    if (r.kind === "electric") m.electric = usage;
    else if (r.kind === "water") m.water = usage;
    prevUsageMap.set(r.unitId, m);
  }
  const prevCurrMap = new Map<string, { electric: number | null; water: number | null }>();
  for (const r of priorLatestRows) {
    const curr = r.currReading == null ? null : toNum(r.currReading);
    const m = prevCurrMap.get(r.unitId) ?? { electric: null, water: null };
    if (r.kind === "electric") m.electric = curr;
    else if (r.kind === "water") m.water = curr;
    prevCurrMap.set(r.unitId, m);
  }

  const units: BoardUnit[] = rawUnits.map((u) => {
    const meters = (u.meters ?? []) as unknown as MeterRow[];
    const contract = u.contracts?.[0];
    const tenant = contract?.tenant ? tenantDisplayName(contract.tenant) : null;
    const pu = prevUsageMap.get(u.id);
    const pc = prevCurrMap.get(u.id);

    // เติม "ครั้งก่อน" อัตโนมัติเมื่อยังไม่จดงวดนี้:
    //   1) เลขล่าสุดเดือนก่อน (carry-forward)  2) ถ้าไม่มี → initialReading (ตั้งต้นห้อง)
    //   3) ถ้าไม่มีทั้งคู่ → needsBaseline = true (ห้องใหม่ ต้องกรอกเลขตั้งต้นเอง)
    const withCarry = (kind: "electric" | "water"): BoardSide => {
      const side = buildSide(meters, kind);
      const meter = meters.find((m) => m.kind === kind);
      const initial = meter?.initialReading != null ? toNum(meter.initialReading) : 0;
      const carry = (kind === "electric" ? pc?.electric : pc?.water) ?? (initial > 0 ? initial : null);
      const notYetRecorded = side.currReading == null;
      const prevReading = notYetRecorded ? (side.prevReading ?? carry) : side.prevReading;
      return {
        ...side,
        prevReading,
        needsBaseline: notYetRecorded && prevReading == null,
        prevUsage: (kind === "electric" ? pu?.electric : pu?.water) ?? null,
      };
    };

    return {
      id: u.id,
      code: u.code,
      name: u.name ?? null,
      building: u.building ?? null,
      tenant,
      electric: withCarry("electric"),
      water: withCarry("water"),
    };
  });

  // KPI: how many rooms recorded (electric+water each count once per side)
  const totalSides = units.length * 2;
  const recordedSides = units.reduce(
    (s, u) =>
      s + (u.electric.currReading != null ? 1 : 0) + (u.water.currReading != null ? 1 : 0),
    0,
  );
  const totalElectric = units.reduce((s, u) => s + (u.electric.amount ?? 0), 0);
  const totalWater = units.reduce((s, u) => s + (u.water.amount ?? 0), 0);

  // #9d — ห้องที่ออกบิลได้ (มีสัญญาใช้งาน) + สถานะมิเตอร์ + ออกบิลงวดนี้แล้วหรือยัง
  // (billedUnitIds คำนวณไว้ด้านบนแล้ว — ใช้ทั้งล็อกมิเตอร์และแผงออกบิล)
  const sideDone = new Map(units.map((u) => [u.id, u.electric.currReading != null && u.water.currReading != null]));
  const billRooms: BillRoom[] = rawUnits
    .filter((u) => (u.contracts?.length ?? 0) > 0)
    .map((u) => ({
      unitId: u.id,
      code: u.code,
      tenant: u.contracts?.[0]?.tenant ? tenantDisplayName(u.contracts[0].tenant) : null,
      metersDone: sideDone.get(u.id) ?? false,
      alreadyBilled: billedUnitIds.has(u.id),
    }));

  return (
    <RsPage>
      <RsHeader
        title="จดมิเตอร์น้ำ-ไฟ"
        subtitle={`${project.name} · ${periodLabel(period)}`}
      />

      {/* บนมือถือ: โชว์เฉพาะความคืบหน้า (KPI เดียว เต็มแถว) เพื่อให้การ์ดห้องแรก
          โผล่ในช่วงบน ~⅓ ของจอ · ยอดเงินรวมเก็บไว้ฝั่ง desktop */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <RsKpi
          label="ห้องที่จดแล้ว"
          value={`${recordedSides}/${totalSides}`}
          hint="นับแยกไฟ + น้ำ"
          tone={totalSides > 0 && recordedSides === totalSides ? "ok" : undefined}
        />
        <div className="hidden lg:block">
          <RsKpi label="ยอดค่าไฟรวมเดือนนี้" value={formatBaht(totalElectric)} tone="pending" />
        </div>
        <div className="hidden lg:block">
          <RsKpi label="ยอดค่าน้ำรวมเดือนนี้" value={formatBaht(totalWater)} tone="ok" />
        </div>
      </div>

      {units.length === 0 ? (
        <RsEmpty
          icon="🚪"
          title="ยังไม่มีห้อง"
          hint="เพิ่มห้องในหน้า ห้องเช่า ก่อน จึงจะจดมิเตอร์ได้"
        />
      ) : (
        <>
          {/* key={period} → รีเซ็ต state ของตาราง/แผงเลือกห้องเมื่อเปลี่ยนเดือน
              (กันบั๊กตัวเลขค้างเดือนเดิม #1a) */}
          <MeterBoard
            key={period}
            units={units}
            period={period}
            billedUnitIds={Array.from(billedUnitIds)}
            isSuper={isSuperAdmin(session.user.role)}
          />
          <SelectiveBillPanel key={period} projectId={project.id} period={period} rooms={billRooms} />
        </>
      )}
    </RsPage>
  );
}
