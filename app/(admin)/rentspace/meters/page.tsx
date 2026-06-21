import { requireSession } from "@/lib/auth/session";
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

  const rawUnits = await meterBoard(orgId, project.id, period);

  // #1b — หน่วยใช้เดือนก่อน (ไว้โชว์ % เทียบในตาราง). อ่านอย่างเดียว 1 query.
  const prev = prevPeriod(period);
  const prevReadings = await prisma.rentalMeterReading.findMany({
    where: { orgId, unitId: { in: rawUnits.map((u) => u.id) }, period: prev },
    select: { unitId: true, kind: true, usage: true },
  });
  const prevUsageMap = new Map<string, { electric: number | null; water: number | null }>();
  for (const r of prevReadings) {
    const cur = prevUsageMap.get(r.unitId) ?? { electric: null, water: null };
    const usage = r.usage == null ? null : toNum(r.usage);
    if (r.kind === "electric") cur.electric = usage;
    else if (r.kind === "water") cur.water = usage;
    prevUsageMap.set(r.unitId, cur);
  }

  const units: BoardUnit[] = rawUnits.map((u) => {
    const meters = (u.meters ?? []) as unknown as MeterRow[];
    const contract = u.contracts?.[0];
    const tenant = contract?.tenant ? tenantDisplayName(contract.tenant) : null;
    const pu = prevUsageMap.get(u.id);
    return {
      id: u.id,
      code: u.code,
      name: u.name ?? null,
      building: u.building ?? null,
      tenant,
      electric: { ...buildSide(meters, "electric"), prevUsage: pu?.electric ?? null },
      water: { ...buildSide(meters, "water"), prevUsage: pu?.water ?? null },
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
  const billedUnitRows = await prisma.rentalBill.findMany({
    where: { orgId, projectId: project.id, period, status: { not: "void" } },
    select: { unitId: true },
  });
  const billedUnitIds = new Set(billedUnitRows.map((b) => b.unitId));
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

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <RsKpi
          label="ห้องที่จดแล้ว"
          value={`${recordedSides}/${totalSides}`}
          hint="นับแยกไฟ + น้ำ"
          tone={totalSides > 0 && recordedSides === totalSides ? "ok" : undefined}
        />
        <RsKpi label="ยอดค่าไฟรวมเดือนนี้" value={formatBaht(totalElectric)} tone="pending" />
        <RsKpi label="ยอดค่าน้ำรวมเดือนนี้" value={formatBaht(totalWater)} tone="ok" />
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
          <MeterBoard key={period} units={units} period={period} />
          <SelectiveBillPanel key={period} projectId={project.id} period={period} rooms={billRooms} />
        </>
      )}
    </RsPage>
  );
}
