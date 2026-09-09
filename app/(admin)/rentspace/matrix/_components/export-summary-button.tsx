import { FileDown } from "lucide-react";

/**
 * เลือกช่วงเดือน → เปิดรายงานสรุปค่าเช่า (ได้มา/ค้างชำระ ต่อเจ้า) แท็บใหม่.
 * Native <details>+<form method="get"> ล้วน — ไม่ต้องพึ่ง client state.
 */
export function ExportSummaryButton({ projectId }: { projectId: string }) {
  const y = new Date().getFullYear();
  const defaultFrom = `${y}-01`;
  const defaultTo = `${y}-12`;
  const monthInputStyle = {
    border: "1.5px solid var(--rs-border)",
    outline: "none",
    color: "var(--rs-text)",
  } as const;

  return (
    <details className="relative">
      <summary
        className="rs-chip shrink-0 !h-11 sm:!h-7 list-none cursor-pointer"
        style={{ listStyle: "none" }}
      >
        <FileDown className="mr-1 inline h-3.5 w-3.5" /> Export รายงานสรุป
      </summary>
      <form
        method="get"
        action="/rentspace/matrix/summary"
        target="_blank"
        className="rs-card absolute right-0 z-20 mt-2 w-72 max-w-[calc(100vw-2rem)] space-y-2.5 p-3.5"
      >
        <input type="hidden" name="projectId" value={projectId} />
        <div className="text-[11px] font-semibold" style={{ color: "var(--rs-text-3)" }}>
          เลือกช่วงเดือนที่จะสรุปยอด
        </div>
        <div className="flex items-center gap-2">
          <input
            type="month"
            name="from"
            defaultValue={defaultFrom}
            required
            aria-label="จากเดือน"
            className="h-10 min-w-0 flex-1 rounded-lg px-2 text-[13px]"
            style={monthInputStyle}
          />
          <span className="shrink-0 text-[12px]" style={{ color: "var(--rs-text-3)" }}>
            ถึง
          </span>
          <input
            type="month"
            name="to"
            defaultValue={defaultTo}
            required
            aria-label="ถึงเดือน"
            className="h-10 min-w-0 flex-1 rounded-lg px-2 text-[13px]"
            style={monthInputStyle}
          />
        </div>
        <button type="submit" className="rs-btn w-full !h-10 text-sm">
          ออกรายงาน
        </button>
      </form>
    </details>
  );
}
