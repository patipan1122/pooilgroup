// /repairs/settings — placeholder settings (currently informational)
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { requireRepairAdmin } from "@/lib/repair/role-guard";
import { Settings, Wrench, ListChecks, ExternalLink } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function RepairSettingsPage() {
  const session = await requireSession();
  requireRepairAdmin(session.user.role);

  return (
    <div className="p-3 sm:p-6 max-w-3xl mx-auto">
      <header className="mb-5">
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-zinc-900 flex items-center gap-2">
          <Settings className="size-6" />
          ตั้งค่าระบบแจ้งซ่อม
        </h1>
      </header>

      <div className="space-y-3">
        <Link
          href="/repairs/technicians"
          className="block bg-white rounded-2xl border-2 border-zinc-200 p-4 hover:border-zinc-400"
        >
          <div className="flex items-start gap-3">
            <div className="size-10 rounded-xl bg-blue-100 text-blue-700 grid place-items-center">
              <Wrench className="size-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-extrabold text-zinc-900">จัดการช่าง</p>
              <p className="text-sm text-zinc-500">
                เพิ่ม / เปิด-ปิด ช่างใน + ช่างนอก (vendor)
              </p>
            </div>
          </div>
        </Link>

        <Link
          href="/repairs/categories"
          className="block bg-white rounded-2xl border-2 border-zinc-200 p-4 hover:border-zinc-400"
        >
          <div className="flex items-start gap-3">
            <div className="size-10 rounded-xl bg-amber-100 text-amber-700 grid place-items-center">
              <ListChecks className="size-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-extrabold text-zinc-900">หมวดงานซ่อม</p>
              <p className="text-sm text-zinc-500">
                ใช้แยกประเภทงาน · ผู้แจ้งเลือกได้
              </p>
            </div>
          </div>
        </Link>

        <div className="rounded-2xl border-2 border-dashed border-zinc-200 p-4">
          <p className="font-bold text-zinc-900 mb-1">ลิ้งค์ฟอร์มสาธารณะ</p>
          <p className="text-sm text-zinc-500 mb-2">
            ใช้แปะหน้าร้าน · LINE · QR code · ใครก็แจ้งซ่อมได้
          </p>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/r"
              target="_blank"
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-zinc-900 text-white font-bold text-sm hover:bg-zinc-700"
            >
              <ExternalLink className="size-3.5" />
              เปิดหน้าหลัก /r
            </Link>
            <Link
              href="/r/new"
              target="_blank"
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-white border-2 border-zinc-200 text-zinc-800 font-bold text-sm hover:bg-zinc-50"
            >
              <ExternalLink className="size-3.5" />
              ฟอร์มแจ้งซ่อม /r/new
            </Link>
            <Link
              href="/r/track"
              target="_blank"
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-white border-2 border-zinc-200 text-zinc-800 font-bold text-sm hover:bg-zinc-50"
            >
              <ExternalLink className="size-3.5" />
              หน้าติดตาม /r/track
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
