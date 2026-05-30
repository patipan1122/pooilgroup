// Bulk-import StarThing "Store Equipment List" XLSX.
// CEO 2026-05-30 sent a CoS signed URL — paste it here, click import, server
// fetches the file, creates missing branches, inserts chairs. Idempotent.

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireRole } from "@/lib/chairops/auth/session";
import { Card, CardBody } from "@/components/ui/card";
import { ImportEquipmentForm } from "./form";

export const dynamic = "force-dynamic";

export default async function ImportEquipmentPage() {
  await requireRole("OFFICE");

  return (
    <div className="chairops-scope max-w-2xl space-y-4 p-4">
      <Link
        href="/chairops/branch-collect"
        className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-zinc-600 hover:text-zinc-900"
      >
        <ChevronLeft className="h-5 w-5" aria-hidden /> กลับเลือกสาขา
      </Link>

      <header className="space-y-1">
        <p className="text-xs font-semibold text-zinc-500">
          จัดการสาขา · นำเข้าข้อมูล
        </p>
        <h1 className="text-xl font-bold text-zinc-900">
          นำเข้าจาก StarThing (Store Equipment List)
        </h1>
        <p className="text-sm text-zinc-500">
          วาง URL ของไฟล์ XLSX ที่ดาวน์โหลดจาก StarThing portal · ระบบจะอ่าน
          Device Code + Store Name แล้ว sync เข้า ChairopsBranch + ChairopsChair
          อัตโนมัติ
        </p>
      </header>

      <Card>
        <CardBody className="space-y-2 p-4 text-sm">
          <div className="font-semibold text-zinc-800">วิธีใช้</div>
          <ol className="ml-5 list-decimal space-y-1 text-zinc-700">
            <li>เปิด StarThing portal → Equipment List → กด Export</li>
            <li>ลิงก์ดาวน์โหลดเป็น signed URL — copy URL ออกมา</li>
            <li>วาง URL ในกล่องด้านล่าง → กดนำเข้า</li>
            <li>
              ระบบจะสร้างสาขาที่ยังไม่มี + เพิ่มเก้าอี้ตามที่ไฟล์บอก ·
              ถ้าเก้าอี้/สาขามีอยู่แล้วจะไม่ทับ
            </li>
          </ol>
          <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
            ⚠ Signed URL หมดอายุไวมาก (ปกติ 7 วัน) · ถ้านำเข้าไม่สำเร็จเพราะ
            URL expired → ดาวน์โหลด export ใหม่
          </div>
        </CardBody>
      </Card>

      <ImportEquipmentForm />
    </div>
  );
}
