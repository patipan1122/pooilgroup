/**
 * โครงหน้ากลาง (skeleton) ของ RentSpace — โผล่ทันทีระหว่างโหลดทุกหน้า
 * (App Router ใช้ loading.tsx ของกลุ่มนี้กับทุกหน้าลูกที่ไม่มี loading.tsx ของตัวเอง:
 *  สัญญา · บิล · ผู้เช่า · ห้อง · เงินประกัน · รับชำระ · ตามเก็บ · ตาราง · วิเคราะห์ ฯลฯ).
 *
 * เดิมทุกหน้ายกเว้น /meters คลิกแล้วจอค้าง/ขาวจนกว่า server จะโหลดข้อมูลเสร็จ. ไฟล์นี้ทำให้
 * "คลิกปุ๊บเห็นโครงหน้าปั๊บ" (perceived speed) แล้วข้อมูลจริงค่อยแทนที่.
 * เป็นแค่การแสดงผล — ไม่แตะเงิน/ข้อมูล/สิทธิ์เลย.
 *
 * (upspeed 2026-07-22 เคยเพิ่มไฟล์นี้ไปแล้วครั้งหนึ่ง — commit อยู่บน branch ที่ไม่เคย merge
 * เข้า setup เลย จึงหายไปจากโค้ดจริง กู้กลับมาใหม่ที่ /upspeed 2026-09-22)
 */
function Bar({ w = "100%", h = 14, r = 6 }: { w?: string | number; h?: number; r?: number }) {
  return (
    <div
      className="animate-pulse"
      style={{ width: w, height: h, borderRadius: r, background: "var(--rs-bg-3, #EBEEF3)" }}
    />
  );
}

export default function RentSpaceLoading() {
  return (
    <div className="px-4 py-4 sm:px-8 sm:py-6 max-w-[1180px] mx-auto space-y-4">
      {/* header */}
      <div className="space-y-2">
        <Bar w={120} h={11} />
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-2 min-w-0">
            <Bar w={200} h={22} />
            <Bar w={150} h={12} />
          </div>
          <Bar w={128} h={40} r={12} />
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="rounded-2xl bg-white p-4 space-y-2.5"
            style={{ border: "1px solid var(--rs-border, #E9EBEF)" }}
          >
            <Bar w={100} h={11} />
            <Bar w={80} h={22} />
            <Bar w={120} h={10} />
          </div>
        ))}
      </div>

      {/* main list/table card */}
      <div
        className="rounded-2xl bg-white overflow-hidden"
        style={{ border: "1px solid var(--rs-border, #E9EBEF)" }}
      >
        <div className="px-5 py-3.5 border-b" style={{ borderColor: "var(--rs-border, #E9EBEF)" }}>
          <Bar w="45%" h={13} />
        </div>
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 px-5 py-3.5 border-b"
            style={{ borderColor: "var(--rs-border, #EEF0F3)" }}
          >
            <div className="flex-1 space-y-1.5 min-w-0">
              <Bar w={140} h={13} />
              <Bar w={90} h={10} />
            </div>
            <Bar w={70} h={24} r={999} />
            <div className="hidden sm:block">
              <Bar w={80} h={14} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
