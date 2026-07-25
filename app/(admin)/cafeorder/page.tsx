// CafeOrder · ภาพรวมวันนี้ (M30 dashboard) — Wave 1 placeholder.
//   ออเดอร์สด/ยอดวันนี้ ต่อเมื่อ orders มา (wave หลัง) — ตอนนี้เป็นทางเข้าหลังบ้าน.
import Link from "next/link";

export const dynamic = "force-dynamic";

const CARDS = [
  { href: "/cafeorder/office/menu", title: "จัดการเมนู", desc: "เพิ่ม/แก้ เมนู รูป ราคา ขนาด ตัวเลือก · นำเข้าทีเดียวหลายรายการ" },
  { href: "/cafeorder/office/shops", title: "ร้าน/สาขา + ลิงก์", desc: "ลิงก์ร้านค้าแยกต่อสาขา · ตั้งค่าเปิด-ปิดรับ ค่าส่ง พร้อมเพย์" },
  { href: "/cafeorder/office/settings/points", title: "กติกาแต้ม", desc: "1 แก้ว = 1 แต้ม · 10 แต้ม = แก้วฟรี · วันหมดอายุ" },
];

export default function CafeOrderHome() {
  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-zinc-900">CafeOrder ☕</h1>
        <p className="mt-1 text-sm text-zinc-500">
          สั่งกาแฟ ส่งถึงที่ + สมาชิกสะสมแต้ม · หลังบ้านร้าน
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {CARDS.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm transition hover:border-zinc-300 hover:shadow"
          >
            <div className="font-bold text-zinc-900">{c.title}</div>
            <div className="mt-1 text-sm text-zinc-500">{c.desc}</div>
          </Link>
        ))}
      </div>
      <p className="mt-6 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
        อยู่ระหว่างสร้าง (Wave 1: หลังบ้านจัดการเมนู) · หน้าลูกค้า/จอบาร์/ไรเดอร์ มาเวฟถัดไป
      </p>
    </div>
  );
}
