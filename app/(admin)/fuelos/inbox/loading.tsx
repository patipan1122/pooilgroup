// Skeleton ของกล่องแชท — โครง 2 คอลัมน์ (รายการ + ห้องแชท) แสดงทันทีตอนเปิด/สลับแชท
export default function InboxLoading() {
  return (
    <div className="lg:h-[calc(100dvh-3rem)] -m-4 sm:-m-6 lg:m-0">
      <div className="lg:grid lg:grid-cols-[360px_1fr] lg:h-full animate-pulse">
        {/* list */}
        <div className="lg:border-r border-border bg-surface">
          <div className="border-b border-border p-3 space-y-2">
            <div className="h-5 w-28 rounded bg-surface-2" />
            <div className="flex gap-1.5">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-8 w-20 rounded-lg bg-surface-2" />
              ))}
            </div>
          </div>
          <div className="divide-y divide-border">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex gap-3 p-3">
                <div className="size-10 rounded-full bg-surface-2 shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-2/3 rounded bg-surface-2" />
                  <div className="h-3 w-1/2 rounded bg-surface-2" />
                </div>
              </div>
            ))}
          </div>
        </div>
        {/* detail */}
        <div className="hidden lg:block bg-surface-2" />
      </div>
    </div>
  );
}
