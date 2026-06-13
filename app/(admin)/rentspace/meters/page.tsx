import { requireSession } from "@/lib/auth/session";
import { getPrimaryProject, meterBoard } from "@/lib/rentspace/data";
import {
  formatBaht,
  currentPeriod,
  periodLabel,
  toNum,
  tenantDisplayName,
} from "@/lib/rentspace/format";
import { RsPage, RsHeader, RsKpi, RsEmpty } from "@/components/rentspace/ui";
import MeterBoard, { type BoardUnit, type BoardSide } from "./_components/meter-board";

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
  }[];
};

/** Build the serializable side (electric/water) data for one unit. */
function buildSide(meters: MeterRow[], kind: "electric" | "water"): BoardSide {
  const meter = meters.find((m) => m.kind === kind);
  const reading = meter?.readings?.[0];
  if (!reading) {
    return { prevReading: null, currReading: null, usage: null, amount: null, photoUrl: null };
  }
  return {
    prevReading: toNum(reading.prevReading),
    currReading: reading.currReading == null ? null : toNum(reading.currReading),
    usage: reading.usage == null ? null : toNum(reading.usage),
    amount: reading.amountThb == null ? null : toNum(reading.amountThb),
    photoUrl: reading.photoUrl ?? null,
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

  const units: BoardUnit[] = rawUnits.map((u) => {
    const meters = (u.meters ?? []) as unknown as MeterRow[];
    const contract = u.contracts?.[0];
    const tenant = contract?.tenant ? tenantDisplayName(contract.tenant) : null;
    return {
      id: u.id,
      code: u.code,
      name: u.name ?? null,
      building: u.building ?? null,
      tenant,
      electric: buildSide(meters, "electric"),
      water: buildSide(meters, "water"),
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
        <MeterBoard units={units} period={period} />
      )}
    </RsPage>
  );
}
