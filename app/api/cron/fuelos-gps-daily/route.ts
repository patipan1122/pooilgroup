// FuelOS GPS · daily — เติมค่าน้ำมัน/เลขไมล์ + สรุป กม./idle ของ "เมื่อวาน" (Thai)
// ลง gps_daily_stats (ฐานรายงานกระทบยอดน้ำมัน). idempotent (upsert ต่อ xsenseName+วัน).
import { NextResponse, type NextRequest } from "next/server";
import { refreshFleet } from "@/lib/fuelos/gps/fleet-data";
import { refreshFuelDetails, syncDailyStats, bkkYesterday } from "@/lib/fuelos/gps/daily";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function isAuthorizedCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // dev
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  return req.nextUrl.searchParams.get("secret") === secret;
}

async function handle(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const fleet = await refreshFleet(); // เติม/อัปเดตรายชื่อรถก่อน (เผื่อไม่มีใครเปิดแผนที่)
    const detail = await refreshFuelDetails();
    const statDate = bkkYesterday();
    const daily = await syncDailyStats(statDate);
    return NextResponse.json({ ok: true, statDate: statDate.toISOString().slice(0, 10), fleet, detail, daily });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}
export async function POST(req: NextRequest) {
  return handle(req);
}
