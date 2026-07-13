// =============================================================
// ClawFleet · นำเข้าเก็บเงิน/เติมตุ๊กตา จาก Excel (หน้า · เฟส 1)
// =============================================================
// แอดมิน ClawFleet เท่านั้น. โหลด template → กรอกหลายตู้/หลายวัน → อัปโหลด → พรีวิว.
// การ parse/ตรวจ/กันซ้ำ อยู่ใน ./actions.ts. หน้านี้เป็น server shell · พรีวิวรันฝั่ง client.

import { assertCfAdmin } from "@/lib/clawfleet/role-guard";
import { Card, CardBody } from "@/components/ui/card";
import { ClawImportShell } from "./import-shell";
import { ImportHistory } from "./import-history";
import { listRecentImportBatches } from "./actions";
import { IMPORT_HEADER_LABELS } from "./types";

export const dynamic = "force-dynamic";

export default async function ClawImportPage() {
  await assertCfAdmin();
  const batches = await listRecentImportBatches(10);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
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

      <Card>
        <CardBody className="space-y-2 p-4">
          <div className="text-sm font-semibold text-zinc-800">ประวัติการนำเข้า</div>
          <p className="text-xs text-zinc-500">
            แต่ละชุด = 1 ครั้งที่กดยืนยัน · กด “ยกเลิกทั้งชุด” เพื่อลบข้อมูลที่นำเข้าและคืนสถานะตู้ให้เหมือนเดิม
          </p>
          <ImportHistory batches={batches} />
        </CardBody>
      </Card>
    </div>
  );
}
