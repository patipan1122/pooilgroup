// Plan B · multi-file timestamped-event upload page (cash + coin).
// Daily summary keeps using the existing single-file uploader at /pos-ingest/new.

import Link from "next/link";
import { requireRole } from "@/lib/chairops/auth/session";
import { Card, CardBody } from "@/components/ui/card";
import { UploadMultiClient } from "./upload-multi-client";

export const dynamic = "force-dynamic";

export default async function PosIngestUploadPage() {
  await requireRole("OFFICE");

  return (
    <div className="chairops-scope mx-auto max-w-4xl p-4 sm:p-6">
      <div className="mb-6">
        <Link href="/chairops/pos-ingest" className="text-sm text-muted-foreground hover:underline">
          ← กลับรายการ import
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">
          อัปโหลดไฟล์ POS แบบมีเวลา (เงินสด + เหรียญ)
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          ลากไฟล์ StarThing ที่มี <strong>เวลาแต่ละรายการ</strong> · ระบบจะ
          <strong> เช็คซ้ำทีละแถว</strong> (อ้างอิงเวลา + เครื่อง) ให้ก่อนบันทึก —
          อัปทับช่วงเดิมได้ ไม่นับซ้ำ
        </p>
      </div>

      <Card className="p-6">
        <UploadMultiClient />
      </Card>

      <Card className="mt-6 bg-muted/40 p-4 text-xs text-muted-foreground">
        <p className="mb-1 font-semibold text-foreground">ไฟล์ยอดรวม + เงินโอน (รายวัน)?</p>
        <p>
          ไฟล์สรุปรายวัน (เต็มจำนวน · ชำระออนไลน์ · จ่ายเงินสด) อัปที่{" "}
          <Link href="/chairops/pos-ingest/new" className="font-medium text-foreground underline">
            หน้าอัปโหลดรายวัน
          </Link>{" "}
          เหมือนเดิม · 2 ไฟล์ด้านบนนี้คือ log ระดับรายการที่ใช้ทำ reconcile ตามเวลาที่แม่บ้านเก็บเงิน
        </p>
      </Card>
    </div>
  );
}
