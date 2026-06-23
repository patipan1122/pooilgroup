// FuelOS — บันทึก snapshot ราคาหน้าปั๊มอ้างอิงรายวัน (ไว้ดูย้อนหลัง)
// Schedule via vercel.json:
//   { "path": "/api/cron/fuelos-pump-price-snapshot", "schedule": "0 1 * * *" }  // 08:00 ICT
// Auth: CRON_SECRET env (Vercel cron injects in header)
import { NextResponse, type NextRequest } from "next/server";
import { snapshotPumpPrices } from "@/lib/fuelos/pump-price-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorizedCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // dev mode
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  return req.nextUrl.searchParams.get("secret") === secret;
}

export async function GET(req: NextRequest) {
  return handle(req);
}
export async function POST(req: NextRequest) {
  return handle(req);
}

async function handle(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await snapshotPumpPrices();
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
