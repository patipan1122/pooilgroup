import "server-only";

import { formatInTimeZone } from "date-fns-tz";
import { prisma } from "@/lib/prisma";
import { fetchPumpPrices } from "@/lib/fuelos/pump-price";
import { bkkStartOfToday } from "@/lib/fuelos/utils/format";

const TZ = process.env.NEXT_PUBLIC_APP_TIMEZONE || "Asia/Bangkok";

// บันทึก snapshot ราคาหน้าปั๊มของ "วันนี้" (เวลาไทย) — idempotent: รันซ้ำวันเดิม = upsert ทับ
// เรียกจาก cron รายวัน + ปุ่ม "บันทึกราคาวันนี้" ในหน้าประวัติ (กันต้องรอ cron รอบแรก)
export async function snapshotPumpPrices(): Promise<{ ok: boolean; saved: number; error?: string }> {
  const result = await fetchPumpPrices();
  if (!result.ok) return { ok: false, saved: 0, error: result.error };

  const date = bkkStartOfToday();
  let saved = 0;
  for (const s of result.stations) {
    for (const p of s.products) {
      const price = parseFloat(p.price);
      if (!Number.isFinite(price)) continue; // ข้ามค่าที่ไม่ใช่ตัวเลข (เช่น "-")
      await prisma.fuelPumpPriceSnapshot.upsert({
        where: {
          date_stationKey_productName: { date, stationKey: s.key, productName: p.name },
        },
        create: {
          date,
          sourceDate: result.date || null,
          stationKey: s.key,
          stationLabel: s.label,
          productName: p.name,
          price,
        },
        update: { price, stationLabel: s.label, sourceDate: result.date || null },
      });
      saved += 1;
    }
  }
  return { ok: true, saved };
}

export type PumpHistoryRow = { key: string; date: Date; prices: Record<string, number> };
export type PumpHistory = {
  stations: { key: string; label: string }[];
  station: string | null;
  products: string[];
  rows: PumpHistoryRow[]; // วันใหม่สุดอยู่บน
};

// ดึงราคาย้อนหลังของปั๊มที่เลือก → pivot เป็นตาราง (แถว=วัน · คอลัมน์=ผลิตภัณฑ์)
export async function getPumpPriceHistory(stationKey?: string, days = 60): Promise<PumpHistory> {
  const since = new Date(bkkStartOfToday().getTime() - days * 86_400_000);

  const stationRows = await prisma.fuelPumpPriceSnapshot.findMany({
    distinct: ["stationKey"],
    select: { stationKey: true, stationLabel: true },
    orderBy: { stationKey: "asc" },
  });
  const stations = stationRows.map((r) => ({ key: r.stationKey, label: r.stationLabel }));
  if (stations.length === 0) return { stations, station: null, products: [], rows: [] };

  const station = stationKey && stations.some((s) => s.key === stationKey) ? stationKey : stations[0].key;

  const snaps = await prisma.fuelPumpPriceSnapshot.findMany({
    where: { stationKey: station, date: { gte: since } },
    orderBy: { date: "desc" },
  });

  const byDate = new Map<string, { date: Date; prices: Record<string, number> }>();
  const productSet = new Set<string>();
  for (const s of snaps) {
    const key = formatInTimeZone(s.date, TZ, "yyyy-MM-dd");
    if (!byDate.has(key)) byDate.set(key, { date: s.date, prices: {} });
    byDate.get(key)!.prices[s.productName] = Number(s.price);
    productSet.add(s.productName);
  }

  const rows: PumpHistoryRow[] = [...byDate.entries()].map(([key, v]) => ({
    key,
    date: v.date,
    prices: v.prices,
  }));

  return { stations, station, products: [...productSet], rows };
}
