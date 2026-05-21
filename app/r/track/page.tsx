// /r/track — entry form to look up ticket by code + phone (Pooil App redesign)
import Link from "next/link";
import { TrackForm } from "@/components/repair/track-form";
import { Search, ChevronLeft, Plus } from "lucide-react";

export const dynamic = "force-dynamic";

interface Search { code?: string; error?: string }

export default async function RepairTrackEntryPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const p = await searchParams;
  return (
    <div className="max-w-md mx-auto">
      <Link
        href="/r"
        className="inline-flex items-center gap-1 text-[12px] text-blue-700 font-semibold hover:text-blue-900 mb-3"
      >
        <ChevronLeft className="size-3.5" />
        กลับหน้าหลัก
      </Link>

      <div className="bg-white border border-zinc-200 rounded-3xl p-6 sm:p-7 text-center mb-3">
        <div className="size-12 mx-auto rounded-2xl bg-blue-50 text-blue-700 grid place-items-center mb-3">
          <Search className="size-6" />
        </div>
        <h1 className="text-2xl font-extrabold tracking-tight text-zinc-900">
          ติดตามใบแจ้งซ่อม
        </h1>
        <p className="mt-2 text-[13.5px] text-zinc-600 leading-relaxed">
          กรอกเลขที่ใบ + เบอร์โทรที่ใช้ตอนแจ้ง
          <br />
          ระบบจะแสดงสถานะปัจจุบัน + รูปงาน + ช่างที่ดูแล
        </p>
      </div>

      <TrackForm initialCode={p.code ?? ""} initialError={p.error ?? null} />

      <div className="bg-zinc-50 border border-zinc-200 rounded-2xl p-4 mt-3 text-[12px] text-zinc-600 leading-relaxed">
        <p>
          <b className="text-zinc-900">หมายเหตุ:</b> ระบบจำกัดจำนวนครั้งที่ค้นต่อ IP
          (anti-bruteforce) · ถ้าค้นบ่อยเกินไปจะถูกบล็อก 10 นาที
        </p>
        <p className="mt-2">
          ลืมเลขที่ใบ? · ดู SMS ที่เคยได้รับ หรือ
          <Link
            href="/r/new"
            className="font-semibold text-blue-700 hover:text-blue-900 ml-1 inline-flex items-center gap-0.5"
          >
            <Plus className="size-3" />
            แจ้งใบใหม่
          </Link>
        </p>
      </div>
    </div>
  );
}
