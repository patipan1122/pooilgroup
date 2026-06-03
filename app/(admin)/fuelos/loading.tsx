// Skeleton กลางของโมดูล fuelos — แสดงทันทีตอนเปลี่ยนหน้า (Next ใช้กับทุกหน้าใน /fuelos
// ที่ไม่มี loading.tsx ของตัวเอง เช่น inbox มีของตัวเอง). กัน "จอขาว" ระหว่าง RSC ดึงข้อมูล.
export default function FuelosLoading() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="flex items-center gap-3">
        <div className="size-9 rounded-xl bg-zinc-100" />
        <div className="h-6 w-44 rounded-lg bg-zinc-100" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-2xl border border-zinc-200 bg-zinc-50" />
        ))}
      </div>
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-14 rounded-xl border border-zinc-200 bg-zinc-50" />
        ))}
      </div>
    </div>
  );
}
