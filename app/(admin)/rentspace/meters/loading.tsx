import { RsPage, RsHeader } from "@/components/rentspace/ui";

/**
 * โครงหน้าจดมิเตอร์ (skeleton) — โผล่ทันทีระหว่างโหลด/สลับเดือน แทนจอขาวค้าง.
 * ทำให้ "สลับรอบเดือน" รู้สึกเร็ว (perceived speed) เพราะเห็นโครงหน้าก่อน
 * แล้วข้อมูลจริงค่อย stream ตามมา.
 */
function Bar({ w = "100%", h = 16 }: { w?: string | number; h?: number }) {
  return (
    <div
      className="animate-pulse rounded-md"
      style={{ width: w, height: h, background: "var(--rs-bg-3)" }}
    />
  );
}

export default function MetersLoading() {
  return (
    <RsPage>
      <RsHeader title="จดมิเตอร์น้ำ-ไฟ" subtitle="กำลังโหลดรอบเดือน…" />

      {/* KPI cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rs-card p-4 space-y-2">
            <Bar w={110} h={12} />
            <Bar w={90} h={22} />
          </div>
        ))}
      </div>

      {/* period selector row */}
      <div className="flex items-center justify-between gap-3">
        <Bar w={180} h={40} />
        <Bar w={140} h={40} />
      </div>

      {/* table skeleton */}
      <div className="rs-card p-0 overflow-hidden">
        <div className="px-3 py-2.5 border-b" style={{ borderColor: "var(--rs-border)" }}>
          <Bar w="60%" h={12} />
        </div>
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 px-3 py-3 border-b"
            style={{ borderColor: "var(--rs-border)" }}
          >
            <div className="flex-1 space-y-1.5">
              <Bar w={70} h={13} />
              <Bar w={130} h={10} />
            </div>
            <Bar w={80} h={36} />
            <Bar w={80} h={36} />
            <div className="hidden sm:block">
              <Bar w={60} h={36} />
            </div>
          </div>
        ))}
      </div>
    </RsPage>
  );
}
