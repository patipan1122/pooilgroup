import Link from "next/link";
import { CheckCircle2, ArrowRight } from "lucide-react";

export default async function SuccessPage({
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ ref?: string }>;
}) {
  const { ref } = await searchParams;

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-zinc-50">
      <div className="max-w-md w-full bg-white rounded-3xl border-2 border-[var(--color-brand-200)] p-8 text-center">
        <div className="size-16 mx-auto rounded-2xl bg-green-50 border-2 border-green-200 flex items-center justify-center text-green-700">
          <CheckCircle2 className="size-8" />
        </div>
        <h1 className="mt-5 text-2xl sm:text-3xl font-extrabold text-zinc-900 font-display">
          ส่งใบสมัครเรียบร้อย
        </h1>
        <p className="text-sm text-zinc-600 mt-3 leading-relaxed">
          ขอบคุณที่ส่งใบสมัครเข้ามา · ทีม HR จะพิจารณาและติดต่อกลับโดยเร็ว
        </p>
        {ref && (
          <>
            <div className="mt-5 inline-block px-4 py-3 rounded-xl bg-zinc-100">
              <p className="text-xs text-zinc-600 font-bold">
                เลขที่ใบสมัคร · ใช้แจ้ง HR เมื่อสอบถาม
              </p>
              <p className="font-mono text-base font-bold text-zinc-900 mt-1.5 tabular-num">
                {ref}
              </p>
            </div>
            <div className="mt-5">
              <Link
                href={`/my/${ref}`}
                className="inline-flex items-center gap-2 rounded-xl bg-[var(--color-brand-600)] text-white px-5 h-12 font-bold hover:bg-[var(--color-brand-700)] transition-colors"
              >
                ดูสถานะใบสมัครของฉัน
                <ArrowRight className="size-4" />
              </Link>
              <p className="text-[11px] text-zinc-400 mt-2">
                บันทึกลิ้งค์นี้ไว้ · กดดูสถานะได้ตลอดเวลา
              </p>
            </div>
          </>
        )}
        <p className="text-xs text-zinc-500 mt-6">
          ปิดหน้านี้ได้เลย · หากมีคำถามติดต่อ HR ที่บริษัท
        </p>
      </div>
    </div>
  );
}
