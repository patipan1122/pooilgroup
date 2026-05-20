import Link from "next/link";
import { ExternalLink, Zap } from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { BackButton } from "@/components/ui/back-button";
import { EvImportView } from "./ev-import-view";

export const dynamic = "force-dynamic";

const REPORT_ID = "9d875e89-7730-412f-a633-73fb5881cd9a";
const PAGE_ID = "m0ViF";
const OPEN_URL = `https://lookerstudio.google.com/reporting/${REPORT_ID}/page/${PAGE_ID}`;

export default async function EvImportPage() {
  await requireRole("super_admin", "org_admin", "admin");

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
      <BackButton label="ภาพรวม" fallbackHref="/cashhub/dashboard" />

      <header className="mb-5 animate-fade-up">
        <p className="text-xs uppercase tracking-widest text-[var(--color-brand-600)] font-semibold flex items-center gap-1.5">
          <Zap className="size-3.5" />
          EV CHARGING · CONNEXT IMPORT
        </p>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight font-display mt-2">
          📥 นำเข้ายอด <span className="accent">EV จาก CONNEXT</span>
        </h1>
        <p className="text-zinc-600 mt-2 text-sm max-w-2xl">
          อัปโหลด CSV ที่ดาวน์โหลดจาก Looker Studio dashboard ของ PEA →
          ระบบจะกระจายเป็นรายงานรายวันต่อสาขา · ใช้ดูในหน้า "ภาพรวม / รายงาน / Leaderboard"
          ได้ปกติเหมือนธุรกิจอื่น
        </p>
      </header>

      <div className="rounded-2xl border-2 border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 mb-5 animate-fade-up delay-75">
        <p className="font-bold mb-2">ขั้นตอนดาวน์โหลด CSV จาก Looker Studio</p>
        <ol className="list-decimal pl-5 space-y-1">
          <li>
            เปิด{" "}
            <Link
              href={OPEN_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 underline font-medium"
            >
              CONNEXT Dashboard <ExternalLink className="size-3" />
            </Link>
          </li>
          <li>เลือกช่วงเวลาที่ต้องการ (ฟิลเตอร์รายเดือนมุมขวาบน)</li>
          <li>คลิกขวาที่ตารางรายการชาร์จ → Export → CSV</li>
          <li>อัปโหลดไฟล์ในช่องด้านล่าง</li>
        </ol>
      </div>

      <EvImportView />
    </div>
  );
}
