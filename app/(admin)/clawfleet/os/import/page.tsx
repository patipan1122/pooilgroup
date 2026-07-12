// =============================================================
// ClawFleet · นำเข้าเก็บเงิน/เติมตุ๊กตา จาก Excel (หน้า · เฟส 1)
// =============================================================
// แอดมิน ClawFleet เท่านั้น. โหลด template → กรอกหลายตู้/หลายวัน → อัปโหลด → พรีวิว.
// การ parse/ตรวจ/กันซ้ำ อยู่ใน ./actions.ts. หน้านี้เป็น server shell · พรีวิวรันฝั่ง client.

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { assertCfAdmin } from "@/lib/clawfleet/role-guard";
import { Card, CardBody } from "@/components/ui/card";
import { ClawImportShell } from "./import-shell";
import { IMPORT_HEADER_LABELS } from "./types";

export const dynamic = "force-dynamic";

export default async function ClawImportPage() {
  await assertCfAdmin();

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <Link
        href="/clawfleet/os/dashboard"
        className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-zinc-600 hover:text-zinc-900"
      >
        <ChevronLeft className="h-5 w-5" aria-hidden="true" /> กลับภาพรวม
      </Link>

      <header className="space-y-1">
        <p className="text-xs font-semibold text-zinc-500">นำเข้า · ตู้คีบ OS</p>
        <h1 className="text-xl font-bold text-zinc-900">นำเข้าข้อมูลเก็บเงิน / เติมตุ๊กตา (Excel)</h1>
        <p className="text-sm text-zinc-500">
          กรอกลง Excel ทีเดียวหลายตู้ + หลายวัน แล้วอัปโหลดเข้ามา · มีหน้าพรีวิวให้ตรวจก่อนบันทึกจริง ·
          รองรับ .xlsx และ .csv · ไม่ต้องระบุ SKU/ชื่อตุ๊กตา
        </p>
      </header>

      <Card>
        <CardBody className="space-y-2 p-4 text-sm">
          <div className="font-semibold text-zinc-800">วิธีใช้</div>
          <ol className="ml-5 list-decimal space-y-1 text-zinc-700">
            <li>
              ดาวน์โหลด template ด้านล่าง · <strong>ในไฟล์เติมชื่อสาขา + รหัสตู้ให้แล้วทุกตู้</strong> —
              ดูรายชื่อได้ในแท็บ “รายชื่อสาขา+ตู้”
            </li>
            <li>
              กรอก <strong>วันที่ · มิเตอร์เงิน · เงินที่เก็บ · จำนวนตุ๊กตา</strong> ข้างตู้ที่เก็บ ·
              วันที่ใช้รูปแบบ <code className="rounded bg-zinc-100 px-1">YYYY-MM-DD</code> ·
              กรอกได้หลายตู้หลายวัน (1 แถว = 1 ตู้ 1 วัน)
            </li>
            <li>
              ตู้ที่ไม่ได้กรอก ระบบข้ามให้ (ไม่ต้องลบแถว) · ตู้ที่ยังไม่เคยมีข้อมูล วันเก่าสุด =
              <strong> “ตั้งค่าครั้งแรก”</strong> อัตโนมัติ
            </li>
            <li>
              อัปโหลด → ระบบเช็คซ้ำ (ตู้+วันเดียวกัน) + ตรวจเลข → ดูพรีวิว → กดยืนยัน (บันทึกจริงเปิดในเฟสถัดไป)
            </li>
          </ol>
          <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
            ⚠ การนำเข้าเป็นข้อมูลย้อนหลังโดยแอดมิน · ระบบไม่บังคับถ่ายรูปหลักฐานเหมือนพนักงานกรอกในแอป —
            แต่ตัวเลขเงินจะถูกคิดเหมือนกันทุกประการ
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="space-y-2 p-4">
          <div className="text-sm font-semibold text-zinc-800">คอลัมน์ในไฟล์ (ตามลำดับนี้)</div>
          <pre className="overflow-x-auto rounded-md bg-zinc-50 p-3 text-xs text-zinc-700">
            <code>{IMPORT_HEADER_LABELS.join(" · ")}</code>
          </pre>
          <div className="flex flex-wrap gap-2">
            <a
              href="/api/clawfleet/import/collections/template"
              className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
            >
              ⬇ ดาวน์โหลด template (.xlsx) — เติมสาขา+ตู้ให้แล้ว
            </a>
          </div>
        </CardBody>
      </Card>

      <ClawImportShell />
    </div>
  );
}
