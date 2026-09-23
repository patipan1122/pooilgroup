/**
 * โครงหน้า (skeleton) ของตารางค่าเช่า (มุมมอง Excel) — หน้าที่ใช้งานบ่อยที่สุดของ
 * RentSpace (จอทำงานประจำวันหลัก). ตารางจริงเป็นแบบ sticky คอลัมน์ซ้าย + sticky
 * หัวตารางบน แถวสูง เลื่อนแนวนอน — โครงหน้าเดิม (group-root loading.tsx) เป็น
 * รูปทรงลิสต์ธรรมดา ไม่เหมือนตารางจริงเลย ทำให้เห็นการกระโดดตอนข้อมูลมาแทนที่
 * (upspeed 2026-09-22).
 */
function Bar({ w = "100%", h = 12, r = 6 }: { w?: string | number; h?: number; r?: number }) {
  return (
    <div
      className="animate-pulse"
      style={{ width: w, height: h, borderRadius: r, background: "var(--rs-bg-3, #EBEEF3)" }}
    />
  );
}

export default function MatrixLoading() {
  const months = Array.from({ length: 6 });
  const rows = Array.from({ length: 10 });
  return (
    <div className="px-4 py-4 sm:px-8 sm:py-6 max-w-[1400px] mx-auto space-y-4">
      {/* header */}
      <div className="space-y-2">
        <Bar w={140} h={11} />
        <Bar w={260} h={22} />
        <Bar w={200} h={12} />
      </div>

      {/* toolbar */}
      <div className="flex items-center gap-2">
        <Bar w={110} h={34} r={10} />
        <Bar w={90} h={34} r={10} />
        <Bar w={90} h={34} r={10} />
      </div>

      {/* grid: sticky room column + scrolling month columns */}
      <div className="rounded-2xl bg-white overflow-hidden" style={{ border: "1px solid var(--rs-border, #E9EBEF)" }}>
        <div className="flex">
          {/* sticky left column header + cells */}
          <div className="shrink-0 border-r" style={{ borderColor: "var(--rs-border, #E9EBEF)", width: 160 }}>
            <div className="px-3 py-3 border-b" style={{ borderColor: "var(--rs-border, #EEF0F3)" }}>
              <Bar w="70%" h={11} />
            </div>
            {rows.map((_, i) => (
              <div key={i} className="px-3 py-3 border-b space-y-1.5" style={{ borderColor: "var(--rs-border, #EEF0F3)" }}>
                <Bar w="85%" h={12} />
                <Bar w="55%" h={9} />
              </div>
            ))}
          </div>
          {/* scrolling month columns */}
          <div className="flex-1 overflow-hidden">
            <div className="flex">
              {months.map((_, m) => (
                <div key={m} className="shrink-0" style={{ width: 96 }}>
                  <div className="px-2 py-3 border-b border-l" style={{ borderColor: "var(--rs-border, #EEF0F3)" }}>
                    <Bar w="60%" h={11} />
                  </div>
                  {rows.map((_, i) => (
                    <div key={i} className="px-2 py-3 border-b border-l" style={{ borderColor: "var(--rs-border, #EEF0F3)" }}>
                      <Bar w="75%" h={12} />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
