// Cron — 08:00 BKK: ดึงยอดขายโรงแรมจากชีต Google ลงฐาน (ตัวสำรองรายวัน)
//   เสริมการซิงค์ "สดเมื่อเปิดหน้า" — การันตีข้อมูลลงฐานทุกวันแม้ไม่มีใครเปิดดู
//   (สำคัญตอนเอาไปกระทบยอดบัญชี). Auth: Bearer ${CRON_SECRET}
import { NextResponse, type NextRequest } from "next/server";
import { adminClient } from "@/lib/db/server";
import { runWithMonitor } from "@/lib/cron/runner";
import { runHotelDailyCron } from "@/lib/cashhub/hotel-sheet-sync";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return runWithMonitor("cashhub-hotel-sheet-sync", () => run(), { req });
}

export async function POST(req: NextRequest) {
  return GET(req);
}

async function run() {
  const admin = adminClient();
  const res = await runHotelDailyCron(admin);
  return NextResponse.json({ ok: true, ...res });
}
