// Playland · agent หน้าร้านถามคิวพิมพ์ — "มีสายรัดให้พิมพ์ไหม?"
//
// เครื่อง K2 ต่อ USB กับเครื่องหน้าร้าน (Vercel ไปถึงไม่ได้) → agent ถามคิวเป็นระยะ ตัวที่ถามถือเป็น heartbeat ของเครื่องพิมพ์ด้วย
// รับงานทีละ 1 ใบ (เครื่องพิมพ์ทีละใบอยู่แล้ว) · claim แบบ atomic (FOR UPDATE SKIP LOCKED) กัน agent 2 ตัวรับงานซ้ำ
// งานที่ค้างสถานะ PRINTING เกิน LEASE → คืนคิว (สูงสุด 3 ครั้ง แล้วถือว่าล้มเหลว) กัน agent ดับกลางทางแล้วงานหายเงียบ

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticatePrinter } from "@/lib/playland/printer-agent-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LEASE_SECONDS = 120; // พิมพ์จริง ~45 วิ · เผื่อไว้ 2.5 เท่า
const MAX_ATTEMPTS = 3;
const HOUSEKEEPING_MS = 10_000; // ความถี่เขียน heartbeat/คืนงานค้าง (หน้าต่างออนไลน์ฝั่งแคชเชียร์ = 45 วิ)

interface ClaimedRow {
  id: string;
  kind: string;
  bitmap_base64: string;
  meta: unknown;
  attempts: number;
}

export async function GET(req: NextRequest) {
  const auth = await authenticatePrinter(req);
  if ("error" in auth) return auth.error;
  const { printer } = auth;

  // agent ถามคิวทุก ~1 วิ → เขียน DB (heartbeat + ตรวจงานค้าง) ทุก 10 วิพอ ส่วนการรับงานเป็น query เดียวที่เบา
  const stale = !printer.lastSeenAt || Date.now() - printer.lastSeenAt.getTime() > HOUSEKEEPING_MS;
  if (stale) {
    await prisma.playlandPrinter.update({ where: { id: printer.id }, data: { lastSeenAt: new Date() } });
    await prisma.$executeRaw`
      UPDATE playland.print_jobs
      SET status = (CASE WHEN attempts >= ${MAX_ATTEMPTS} THEN 'FAILED' ELSE 'PENDING' END)::playland."PlaylandPrintJobStatus",
          error_message = CASE WHEN attempts >= ${MAX_ATTEMPTS} THEN 'agent หยุดตอบระหว่างพิมพ์' ELSE error_message END,
          updated_at = now()
      WHERE printer_id = ${printer.id}::uuid
        AND status = 'PRINTING'::playland."PlaylandPrintJobStatus"
        AND last_attempt_at < now() - make_interval(secs => ${LEASE_SECONDS})`;
  }

  // ?heartbeat=1 = แค่บอกว่ายังออนไลน์ (agent กำลังพิมพ์อยู่ ห้ามรับงานเพิ่ม)
  if (req.nextUrl.searchParams.get("heartbeat")) return NextResponse.json({ ok: true, job: null });

  const rows = await prisma.$queryRaw<ClaimedRow[]>`
    UPDATE playland.print_jobs
    SET status = 'PRINTING'::playland."PlaylandPrintJobStatus",
        attempts = attempts + 1,
        last_attempt_at = now(),
        updated_at = now()
    WHERE id = (
      SELECT id FROM playland.print_jobs
      WHERE printer_id = ${printer.id}::uuid AND status = 'PENDING'::playland."PlaylandPrintJobStatus"
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, kind, bitmap_base64, meta, attempts`;

  const job = rows[0];
  if (!job) return NextResponse.json({ ok: true, job: null });
  return NextResponse.json({
    ok: true,
    job: { jobId: job.id, kind: job.kind, bitmapBase64: job.bitmap_base64, meta: job.meta, attempt: job.attempts },
  });
}
