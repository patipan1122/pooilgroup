// CafeOrder · ภาพรวมวันนี้ (M30 dashboard) — Wave 1 landing.
import Link from "next/link";

export const dynamic = "force-dynamic";

const CARDS = [
  { href: "/cafeorder/office/menu", emoji: "📋", title: "จัดการเมนู", desc: "เพิ่ม/แก้ เมนู รูป ราคา ขนาด ตัวเลือก · นำเข้าทีเดียวหลายรายการ", tint: "#1f6f3f" },
  { href: "/cafeorder/office/shops", emoji: "🏬", title: "ร้าน/สาขา + ลิงก์", desc: "ลิงก์ร้านค้าแยกต่อสาขา · เปิด-ปิดรับ ค่าส่ง พร้อมเพย์", tint: "#a4552b" },
  { href: "/cafeorder/office/settings/points", emoji: "🎫", title: "กติกาแต้ม", desc: "1 แก้ว = 1 แต้ม · 10 แต้ม = แก้วฟรี · วันหมดอายุ", tint: "#2563eb" },
];

export default function CafeOrderHome() {
  return (
    <div className="min-h-screen bg-[#faf7f2]">
      <div className="mx-auto max-w-2xl px-5 py-8">
        <header className="mb-7">
          <div className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-semibold text-zinc-500 shadow-sm ring-1 ring-black/5">
            ☕ CafeOrder
          </div>
          <h1 className="mt-3 text-2xl font-extrabold text-zinc-900">สั่งกาแฟ ส่งถึงที่ + สะสมแต้ม</h1>
          <p className="mt-1 text-sm text-zinc-500">หลังบ้านร้าน — จัดการเมนู ร้าน และกติกาแต้ม</p>
        </header>

        <div className="grid gap-3.5 sm:grid-cols-2">
          {CARDS.map((c) => (
            <Link
              key={c.href}
              href={c.href}
              className="group flex items-start gap-3.5 rounded-3xl bg-white p-4 shadow-[0_2px_12px_rgba(0,0,0,0.05)] ring-1 ring-black/[0.04] transition hover:-translate-y-0.5 hover:shadow-[0_6px_20px_rgba(0,0,0,0.08)]"
            >
              <span
                className="grid size-11 shrink-0 place-items-center rounded-2xl text-xl"
                style={{ background: `color-mix(in srgb, ${c.tint} 12%, #fff)` }}
              >
                {c.emoji}
              </span>
              <span className="min-w-0">
                <span className="block font-bold text-zinc-900">{c.title}</span>
                <span className="mt-0.5 block text-sm leading-snug text-zinc-500">{c.desc}</span>
              </span>
            </Link>
          ))}
        </div>

        <div className="mt-6 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-100">
          🚧 กำลังสร้าง (Wave 1: หลังบ้านจัดการเมนู) · หน้าลูกค้าสั่ง / จอบาร์ / ไรเดอร์ มาเวฟถัดไป
        </div>
      </div>
    </div>
  );
}
