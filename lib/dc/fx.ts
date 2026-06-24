// DC · อัตราแลกเปลี่ยนรายวัน (CNY→THB) — ดึงจาก fawazahmed0/currency-api
// (โฮสต์ GitHub/jsDelivr · ฟรี · ไม่ต้องคีย์ · อัปเดตรายวัน) แล้ว cache ใน DcFxRate
// วันละครั้ง. PO หน้าสั่งจีนเรียก getTodayFxRate() เพื่อเติมเรตอัตโนมัติ (แก้ทับได้).

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";

const PRIMARY = (base: string) =>
  `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${base}.json`;
const FALLBACK = (base: string) =>
  `https://latest.currency-api.pages.dev/v1/currencies/${base}.json`;

export type FxRate = {
  base: string;
  quote: string;
  rate: number; // 1 base = rate quote (เช่น 1 CNY = 4.9 THB)
  date: string; // yyyy-mm-dd
  source: string;
  cached: boolean;
};

function todayUtcDate(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

/** ยิง API จริง (primary → fallback). คืน {rate, date} หรือ null ถ้าล้มทั้งคู่. */
async function fetchFromApi(
  base: string,
  quote: string,
): Promise<{ rate: number; date: string } | null> {
  const b = base.toLowerCase();
  const q = quote.toLowerCase();
  for (const url of [PRIMARY(b), FALLBACK(b)]) {
    try {
      const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const json = (await res.json()) as Record<string, unknown>;
      const date = typeof json.date === "string" ? json.date : new Date().toISOString().slice(0, 10);
      const table = json[b] as Record<string, number> | undefined;
      const rate = table?.[q];
      if (typeof rate === "number" && Number.isFinite(rate) && rate > 0) {
        return { rate, date };
      }
    } catch {
      /* ลองตัวถัดไป */
    }
  }
  return null;
}

/**
 * เรตวันนี้ (cache ใน DB วันละครั้ง). ถ้ามีของวันนี้แล้ว → คืนเลย; ถ้าไม่มี → ยิง API + บันทึก.
 * ถ้า API ล่ม → คืนเรตล่าสุดที่เคยเก็บ (ถ้ามี) · ถ้าไม่เคยมีเลย → null.
 */
export async function getTodayFxRate(base = "CNY", quote = "THB"): Promise<FxRate | null> {
  const baseCcy = base.toUpperCase();
  const quoteCcy = quote.toUpperCase();
  const rateDate = todayUtcDate();

  const existing = await prisma.dcFxRate.findUnique({
    where: { rateDate_baseCcy_quoteCcy: { rateDate, baseCcy, quoteCcy } },
    select: { rate: true, rateDate: true, source: true },
  });
  if (existing) {
    return {
      base: baseCcy,
      quote: quoteCcy,
      rate: Number(existing.rate),
      date: existing.rateDate.toISOString().slice(0, 10),
      source: existing.source ?? "cache",
      cached: true,
    };
  }

  const fetched = await fetchFromApi(baseCcy, quoteCcy);
  if (fetched) {
    try {
      await prisma.dcFxRate.upsert({
        where: { rateDate_baseCcy_quoteCcy: { rateDate, baseCcy, quoteCcy } },
        create: { rateDate, baseCcy, quoteCcy, rate: new Prisma.Decimal(fetched.rate), source: "fawazahmed0/currency-api" },
        update: { rate: new Prisma.Decimal(fetched.rate), fetchedAt: new Date() },
      });
    } catch {
      /* บันทึกพลาด (เช่น แข่งกัน) ไม่เป็นไร — ยังคืนเรตได้ */
    }
    return { base: baseCcy, quote: quoteCcy, rate: fetched.rate, date: fetched.date, source: "fawazahmed0/currency-api", cached: false };
  }

  // API ล่ม → เรตล่าสุดที่เคยเก็บ
  const last = await prisma.dcFxRate.findFirst({
    where: { baseCcy, quoteCcy },
    orderBy: { rateDate: "desc" },
    select: { rate: true, rateDate: true, source: true },
  });
  if (last) {
    return {
      base: baseCcy,
      quote: quoteCcy,
      rate: Number(last.rate),
      date: last.rateDate.toISOString().slice(0, 10),
      source: `${last.source ?? "cache"} (ล่าสุด)`,
      cached: true,
    };
  }
  return null;
}

/** บังคับดึงเรตใหม่ (ปุ่ม "รีเฟรชเรต"). */
export async function refreshFxRate(base = "CNY", quote = "THB"): Promise<FxRate | null> {
  const baseCcy = base.toUpperCase();
  const quoteCcy = quote.toUpperCase();
  const fetched = await fetchFromApi(baseCcy, quoteCcy);
  if (!fetched) return getTodayFxRate(base, quote);
  const rateDate = todayUtcDate();
  try {
    await prisma.dcFxRate.upsert({
      where: { rateDate_baseCcy_quoteCcy: { rateDate, baseCcy, quoteCcy } },
      create: { rateDate, baseCcy, quoteCcy, rate: new Prisma.Decimal(fetched.rate), source: "fawazahmed0/currency-api" },
      update: { rate: new Prisma.Decimal(fetched.rate), fetchedAt: new Date() },
    });
  } catch { /* ignore */ }
  return { base: baseCcy, quote: quoteCcy, rate: fetched.rate, date: fetched.date, source: "fawazahmed0/currency-api", cached: false };
}
