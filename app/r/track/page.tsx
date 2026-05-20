// /r/track — entry form to look up ticket by code + phone
import { TrackForm } from "@/components/repair/track-form";

export const dynamic = "force-dynamic";

interface Search { code?: string; error?: string }

export default async function RepairTrackEntryPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const p = await searchParams;
  return (
    <div className="space-y-5 max-w-md mx-auto">
      <header>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-zinc-900">
          ติดตามใบแจ้งซ่อม
        </h1>
        <p className="mt-1 text-zinc-600 text-sm">
          กรอกเลขที่ใบ + เบอร์โทรที่ใช้ตอนแจ้ง · ระบบจะแสดงสถานะปัจจุบัน
        </p>
      </header>
      <TrackForm initialCode={p.code ?? ""} initialError={p.error ?? null} />
    </div>
  );
}
