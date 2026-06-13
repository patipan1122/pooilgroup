import { requireSession } from "@/lib/auth/session";
import { getPrimaryProject } from "@/lib/rentspace/data";
import { RsPage, RsHeader, RsCard } from "@/components/rentspace/ui";
import { FileSpreadsheet } from "lucide-react";
import TenantImportShell from "./_components/tenant-import-shell";

export const dynamic = "force-dynamic";

export default async function RentSpaceImportPage() {
  const session = await requireSession();
  const project = await getPrimaryProject(session.user.org_id);

  return (
    <RsPage>
      <RsHeader
        title="นำเข้าผู้เช่า"
        subtitle="นำเข้ารายชื่อร้านค้า/ผู้เช่าจำนวนมากจากไฟล์ CSV ครั้งเดียว"
      />

      <RsCard className="p-5">
        <div className="flex items-start gap-3">
          <FileSpreadsheet className="h-5 w-5 mt-0.5 shrink-0" style={{ color: "var(--rs-brand)" }} />
          <div className="text-sm space-y-2" style={{ color: "var(--rs-text-2)" }}>
            <p className="font-semibold" style={{ color: "var(--rs-text)" }}>
              นำเข้าอย่างไร
            </p>
            <ol className="list-decimal list-inside space-y-1">
              <li>
                เตรียมไฟล์ CSV ที่มีหัวตารางภาษาไทย — คอลัมน์แรกคือ <b>ชื่อห้อง</b> (เช่น “A1 SHABU
                ZEED”) ตามด้วย ชื่อ-นามสกุล/ชื่อร้าน, เบอร์โทร, วันเกิด, สัญชาติ, เลขบัตรประชาชน, ที่อยู่,
                อีเมล, line id, วันที่เข้าทำสัญญา, วันสิ้นสุดสัญญา
              </li>
              <li>วางข้อความ CSV หรืออัปโหลดไฟล์ .csv ด้านล่าง</li>
              <li>
                กด <b>ตรวจสอบก่อนนำเข้า</b> เพื่อดูสรุป — ระบบจะบอกว่าแถวไหน <b>เพิ่มใหม่</b> /{" "}
                <b>อัปเดต</b> / <b>มีปัญหา</b> โดยยังไม่บันทึก
              </li>
              <li>
                เมื่อตรวจแล้วถูกต้อง กด <b>ยืนยันนำเข้า</b> ระบบจะบันทึกให้ — นำเข้าซ้ำได้ ไม่เกิดข้อมูลซ้ำ
                (จับคู่จากเลขบัตร/ชื่อ+เบอร์)
              </li>
            </ol>
            {!project && (
              <p className="text-[12.5px]" style={{ color: "var(--rs-text-3)" }}>
                ยังไม่มีโครงการ — ระบบจะสร้างโครงการเริ่มต้น “โครงการทะเลทาวน์” ให้อัตโนมัติเมื่อยืนยันนำเข้าครั้งแรก
              </p>
            )}
          </div>
        </div>
      </RsCard>

      <TenantImportShell />
    </RsPage>
  );
}
