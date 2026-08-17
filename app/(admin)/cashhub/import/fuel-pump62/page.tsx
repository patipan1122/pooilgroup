import { notFound } from "next/navigation";
import Link from "next/link";
import { ExternalLink, Fuel, BarChart3 } from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { BackButton } from "@/components/ui/back-button";
import { cashhubFuelV1 } from "@/lib/cashhub/flags";
import { FUEL_SHEET_VIEW_URL } from "@/lib/cashhub/fuel-fetch";
import { FuelImportView } from "./fuel-import-view";

export const dynamic = "force-dynamic";

export default async function FuelImportPage() {
  await requireRole("super_admin", "org_admin", "admin", "program_admin");
  if (!cashhubFuelV1()) notFound();

  return (
    <div className="ch-scope p-3 sm:p-6 lg:p-8 max-w-4xl mx-auto">
      <BackButton label="ศูนย์นำเข้าข้อมูล" fallbackHref="/cashhub/import" />

      <header className="mb-5 animate-fade-up">
        <p className="text-xs uppercase tracking-widest text-[var(--ch-brand)] font-semibold flex items-center gap-1.5">
          <Fuel className="size-3.5" />
          FUEL STATION · ปั๊ม 62 หัวทะเล
        </p>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight mt-2">
          ⛽ นำเข้ายอด <span className="text-[var(--ch-brand)]">ปั๊มน้ำมัน 62</span>
        </h1>
        <p className="text-[var(--ch-text-2)] mt-2 text-sm max-w-2xl">
          ดึงยอดขาย + การกระทบเงินสด/ธนาคารรายวัน (กะเช้า/ค่ำ) จากชีต Google ของปั๊ม
          (บริษัทวายเอ็มพลัส) เข้าระบบโดยตรง · ระบบจะตรวจและชี้จุดที่ตัวเลขในชีตไม่ลงตัวให้
        </p>
      </header>

      <div className="rounded-2xl border border-[var(--ch-border)] bg-[var(--ch-bg-2)] p-4 text-sm text-[var(--ch-text-2)] mb-5 animate-fade-up delay-75 flex flex-col sm:flex-row sm:items-start gap-3">
        <div className="flex-1">
          <p className="font-semibold text-[var(--ch-text)] mb-1">
            ที่มาของข้อมูล
          </p>
          กดปุ่ม “ดึงข้อมูลล่าสุด” เพื่อโหลดจากชีตอัตโนมัติ (ไม่ต้องล็อกอิน Google) ·
          ถ้าลิงก์มีปัญหา ให้ดาวน์โหลดไฟล์ .xlsx แล้วอัปเองได้
          <div className="mt-2">
            <Link
              href={FUEL_SHEET_VIEW_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 underline font-medium text-[var(--ch-brand)]"
            >
              เปิดชีตต้นทาง <ExternalLink className="size-3" />
            </Link>
          </div>
        </div>
        <Link
          href="/cashhub/fuel-pump62"
          className="shrink-0 inline-flex items-center justify-center gap-1.5 rounded-xl border border-[var(--ch-border)] bg-white px-3 py-2 min-h-[44px] text-xs font-semibold text-[var(--ch-text)] hover:border-[var(--ch-brand)]"
        >
          <BarChart3 className="size-3.5" />
          หน้าบริหารยอดขาย
        </Link>
      </div>

      <FuelImportView />
    </div>
  );
}
