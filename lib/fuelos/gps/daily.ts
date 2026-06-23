import "server-only";

import { formatInTimeZone } from "date-fns-tz";
import { prisma } from "@/lib/prisma";
import { getXsenseCreds } from "./creds";
import { fetchXsenseVehicleFuel, fetchXsenseHistory } from "./xsense";

const TZ = process.env.NEXT_PUBLIC_APP_TIMEZONE || "Asia/Bangkok";

// "yesterday" ตามปฏิทินไทย → Date ระบุวัน (UTC midnight marker, ใช้กับ @db.Date)
export function bkkYesterday(): Date {
  const ds = formatInTimeZone(new Date(Date.now() - 24 * 60 * 60 * 1000), TZ, "yyyy-MM-dd");
  return new Date(`${ds}T00:00:00Z`);
}

// (A) เติมค่าน้ำมัน/เลขไมล์ลง fuel_gps_vehicle (จาก /openapi/vehicle)
export async function refreshFuelDetails(): Promise<{ updated: number }> {
  const fuel = await fetchXsenseVehicleFuel();
  let updated = 0;
  for (const [name, f] of fuel) {
    const res = await prisma.fuelGpsVehicle.updateMany({
      where: { xsenseName: name },
      data: {
        deviceId: f.deviceId ?? undefined,
        fuelPct: f.fuelPct ?? undefined,
        fuelRawAdc3: f.fuelRawAdc3 ?? undefined,
        odometerKm: f.odometerKm ?? undefined,
      },
    });
    if (res.count > 0) updated++;
  }
  return { updated };
}

// (B) สรุป กม./idle/วิ่ง/จอด ของ "วัน statDate" ลง gps_daily_stats (จาก /openapi/next/history)
export async function syncDailyStats(statDate: Date): Promise<{ vehicles: number; ok: number; failed: number }> {
  const creds = await getXsenseCreds();
  if (!creds) return { vehicles: 0, ok: 0, failed: 0 };

  const ds = statDate.toISOString().slice(0, 10);
  const start = new Date(`${ds}T00:00:00+07:00`);
  const end = new Date(`${ds}T23:59:59+07:00`);

  const vehicles = await prisma.fuelGpsVehicle.findMany({ select: { xsenseName: true } });
  let ok = 0;
  let failed = 0;
  const BATCH = 8;

  for (let i = 0; i < vehicles.length; i += BATCH) {
    const chunk = vehicles.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      chunk.map(async (veh) => {
        const h = await fetchXsenseHistory(creds, veh.xsenseName, start, end);
        if (!h.ok) throw new Error(h.error ?? "history failed");
        const b = { move: 0, idle: 0, stop: 0, noSignal: 0 };
        for (const seg of h.statusTime) {
          if (seg.status === "m") b.move += seg.seconds;
          else if (seg.status === "i") b.idle += seg.seconds;
          else if (seg.status === "s") b.stop += seg.seconds;
          else if (seg.status === "n") b.noSignal += seg.seconds;
        }
        const data = {
          distanceKm: h.totalDistance,
          moveSeconds: b.move,
          idleSeconds: b.idle,
          stopSeconds: b.stop,
          noSignalSeconds: b.noSignal,
          pointCount: h.pointCount,
          fuelStartPct: h.fuelStart,
          fuelEndPct: h.fuelEnd,
        };
        await prisma.fuelGpsDailyStat.upsert({
          where: { xsenseName_statDate: { xsenseName: veh.xsenseName, statDate } },
          create: { xsenseName: veh.xsenseName, statDate, ...data },
          update: data,
        });
      }),
    );
    for (const r of results) {
      if (r.status === "fulfilled") ok++;
      else failed++;
    }
  }
  return { vehicles: vehicles.length, ok, failed };
}
