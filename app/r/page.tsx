// /r — Public landing for ระบบแจ้งซ่อม
import Link from "next/link";
import { Plus, Search, ShieldCheck, Clock } from "lucide-react";

export default function RepairPublicLanding() {
  return (
    <div className="space-y-8">
      <div className="text-center pt-4">
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-zinc-900">
          แจ้งซ่อมง่าย ๆ ใน 30 วินาที
        </h1>
        <p className="mt-3 text-zinc-600 max-w-xl mx-auto">
          ถ่ายรูป → กรอก ชื่อ + เบอร์ → ส่ง · ได้เลขที่ใบทันที · เก็บลิ้งค์ไว้ติดตามได้ตลอด
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <Link
          href="/r/new"
          className="group rounded-2xl border-2 border-[var(--color-brand-200)] bg-[var(--color-brand-50)] p-6 hover:border-[var(--color-brand-400)] hover:shadow-lg transition-all"
        >
          <div className="size-12 rounded-xl bg-[var(--color-brand-600)] text-white grid place-items-center">
            <Plus className="size-6" />
          </div>
          <h2 className="mt-4 text-xl font-extrabold text-zinc-900">แจ้งซ่อมใหม่</h2>
          <p className="mt-1 text-sm text-zinc-700">
            เปิดใบใหม่ — ไม่ต้องสมัครสมาชิก · ใช้เวลา 30 วินาที
          </p>
          <p className="mt-3 text-sm font-bold text-[var(--color-brand-700)]">
            เริ่มเปิดใบ →
          </p>
        </Link>

        <Link
          href="/r/track"
          className="group rounded-2xl border-2 border-zinc-200 bg-white p-6 hover:border-zinc-400 hover:shadow-lg transition-all"
        >
          <div className="size-12 rounded-xl bg-zinc-900 text-white grid place-items-center">
            <Search className="size-6" />
          </div>
          <h2 className="mt-4 text-xl font-extrabold text-zinc-900">ติดตามใบของฉัน</h2>
          <p className="mt-1 text-sm text-zinc-700">
            มีเลขที่ใบ + เบอร์ที่กรอกตอนแจ้ง → ดูสถานะ + รูป + ช่างได้
          </p>
          <p className="mt-3 text-sm font-bold text-zinc-900">เปิดดู →</p>
        </Link>
      </div>

      <div className="rounded-2xl bg-zinc-50 border border-zinc-200 p-5 sm:p-6">
        <h3 className="font-extrabold text-zinc-900 text-lg">หลังจากกดส่ง</h3>
        <ul className="mt-3 space-y-3">
          <li className="flex gap-3">
            <span className="size-8 rounded-lg bg-white border border-zinc-200 grid place-items-center text-[var(--color-brand-700)] flex-shrink-0">
              <ShieldCheck className="size-4" />
            </span>
            <div>
              <p className="font-bold text-zinc-900">ได้เลขที่ใบทันที</p>
              <p className="text-sm text-zinc-600">เก็บไว้ตามงาน · เช่น RP-2569-0001</p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="size-8 rounded-lg bg-white border border-zinc-200 grid place-items-center text-[var(--color-brand-700)] flex-shrink-0">
              <Clock className="size-4" />
            </span>
            <div>
              <p className="font-bold text-zinc-900">ทีมงานเห็นทันที</p>
              <p className="text-sm text-zinc-600">
                ด่วนมาก = ตอบใน 4 ชม · ปานกลาง = ตอบใน 24 ชม · ไม่เร่งด่วน = ตอบใน 3 วัน
              </p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="size-8 rounded-lg bg-white border border-zinc-200 grid place-items-center text-[var(--color-brand-700)] flex-shrink-0">
              <Search className="size-4" />
            </span>
            <div>
              <p className="font-bold text-zinc-900">ติดตามได้ตลอด</p>
              <p className="text-sm text-zinc-600">
                เปิดลิ้งค์ /r/track + เลขที่ใบ + เบอร์ของคุณ
              </p>
            </div>
          </li>
        </ul>
      </div>
    </div>
  );
}
