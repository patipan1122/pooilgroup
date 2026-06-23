// FuelOS — ดึงตำแหน่งรถจาก xsense เก็บลง DB (heartbeat fallback)
// หมายเหตุ: ไม่ได้ตั้ง schedule ใน vercel.json (เต็มโควต้า cron ของแพลน) — เรียกเอง/trigger ภายหลังได้
// หน้าแผนที่ดึงสดจาก xsense ทุกครั้งที่เปิด/refresh อยู่แล้ว จึงไม่จำเป็นต้องมี cron
// Auth: CRON_SECRET env (Vercel cron injects in header)
import { NextResponse, type NextRequest } from "next/server";
import { refreshFleet } from "@/lib/fuelos/gps/fleet-data";

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
  const r = await refreshFleet();
  // unconfigured (ยังไม่ใส่กุญแจ) ไม่ถือเป็น error → 200 กัน cron แจ้งเตือนลวง
  return NextResponse.json(r, { status: r.ok || r.unconfigured ? 200 : 502 });
}
