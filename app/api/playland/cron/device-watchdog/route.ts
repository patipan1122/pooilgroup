// Playland · Cron-callable device-offline watchdog
// Schedule via Vercel cron (vercel.json) every 5 minutes
// เช็ค PlaylandDevice.lastSeenAt ทุกเครื่อง (ไม่รวม DISABLED) — เงียบเกิน 10 นาที → สร้าง
// alert + ส่ง LINE แจ้งพนักงาน/CEO ทันที แทนที่จะรอให้ลูกค้ามาเจอ "รอนานเกินไป" ที่หน้าจอก่อน
// (เดียวกับที่เคยเกิดจริง 2026-09-30 — ดู postmortems/playland-wave2-facescan-shipping-session-2026-09-30.md)

import { NextRequest, NextResponse } from "next/server";
import { runDeviceOfflineWatchdog } from "@/lib/playland/alerts/device-offline";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const result = await runDeviceOfflineWatchdog();
  return NextResponse.json({ ok: true, ...result, ranAt: new Date().toISOString() });
}
