import { CheckCircle2 } from "lucide-react";

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
          <div className="mt-5 inline-block px-4 py-2 rounded-xl bg-zinc-100">
            <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 font-bold">
              เลขที่ใบสมัคร
            </p>
            <p className="font-mono text-sm font-bold text-zinc-900 mt-1">{ref}</p>
          </div>
        )}
        <p className="text-xs text-zinc-500 mt-6">
          ปิดหน้านี้ได้เลย · หากมีคำถามติดต่อ HR ที่บริษัท
        </p>
      </div>
    </div>
  );
}
