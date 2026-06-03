"use client";

// Error boundary ของโมดูล fuelos — กันทั้งหน้าขาว/แอปล่มถ้า server component หรือ action พัง
// ปุ่ม "ลองใหม่" เรียก reset() ของ Next เพื่อ re-render segment
export default function FuelosError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="grid place-items-center min-h-[50vh] p-6">
      <div className="text-center max-w-sm">
        <div className="text-4xl mb-3">⚠️</div>
        <h2 className="text-lg font-bold text-zinc-900">เกิดข้อผิดพลาด</h2>
        <p className="text-sm text-zinc-500 mt-1">
          ระบบขายน้ำมันมีปัญหาชั่วคราว · ลองใหม่อีกครั้ง ถ้ายังไม่หายแจ้งผู้ดูแล
        </p>
        <button
          onClick={() => reset()}
          className="mt-4 h-10 px-5 rounded-xl bg-[var(--color-brand-600)] text-white font-medium hover:bg-[var(--color-brand-700)]"
        >
          ลองใหม่
        </button>
      </div>
    </div>
  );
}
