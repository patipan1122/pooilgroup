// /r — Public landing for ระบบแจ้งซ่อม (Pooil App redesign · public face)
import Link from "next/link";
import {
  Plus,
  Search,
  ShieldCheck,
  Clock,
  Camera,
  MessageCircle,
  ChevronRight,
  Sparkles,
} from "lucide-react";

export default function RepairPublicLanding() {
  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="bg-gradient-to-br from-blue-600 to-blue-900 text-white rounded-3xl p-8 sm:p-10 text-center">
        <div className="size-12 mx-auto rounded-2xl bg-white/20 backdrop-blur grid place-items-center font-extrabold text-xl mb-3">
          P
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight leading-tight">
          แจ้งซ่อมง่าย ๆ ใน 30 วินาที
        </h1>
        <p className="mt-3 text-sm sm:text-base opacity-85 max-w-md mx-auto leading-relaxed">
          ถ่ายรูป → กรอก ชื่อ + เบอร์ → ส่ง · ได้เลขที่ใบทันที
          <br />
          เก็บลิ้งค์ติดตามสถานะได้ตลอด
        </p>
      </div>

      {/* Primary actions */}
      <div className="grid sm:grid-cols-2 gap-3">
        <Link
          href="/r/new"
          className="group rounded-2xl border-2 border-blue-200 bg-blue-50 p-6 hover:border-blue-400 hover:shadow-md transition-all"
        >
          <div className="size-12 rounded-xl bg-blue-600 text-white grid place-items-center">
            <Plus className="size-6" />
          </div>
          <h2 className="mt-4 text-xl font-extrabold text-zinc-900">แจ้งซ่อมใหม่</h2>
          <p className="mt-1 text-sm text-zinc-700">
            เปิดใบใหม่ · ไม่ต้องสมัครสมาชิก · ใช้เวลา 30 วินาที
          </p>
          <p className="mt-3 text-sm font-bold text-blue-700 inline-flex items-center gap-1">
            เริ่มเปิดใบ <ChevronRight className="size-4" />
          </p>
        </Link>

        <Link
          href="/r/track"
          className="group rounded-2xl border-2 border-zinc-200 bg-white p-6 hover:border-zinc-400 hover:shadow-md transition-all"
        >
          <div className="size-12 rounded-xl bg-zinc-900 text-white grid place-items-center">
            <Search className="size-6" />
          </div>
          <h2 className="mt-4 text-xl font-extrabold text-zinc-900">ติดตามใบของฉัน</h2>
          <p className="mt-1 text-sm text-zinc-700">
            มีเลขที่ใบ + เบอร์ที่กรอกตอนแจ้ง · ดูสถานะ + รูป + ช่างได้
          </p>
          <p className="mt-3 text-sm font-bold text-zinc-900 inline-flex items-center gap-1">
            เปิดดู <ChevronRight className="size-4" />
          </p>
        </Link>
      </div>

      {/* Quick how-it-works */}
      <div className="bg-white border border-zinc-200 rounded-2xl p-5 sm:p-6">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="size-4 text-blue-600" />
          <h3 className="font-bold text-zinc-900 text-base">หลังจากกดส่ง</h3>
        </div>
        <ul className="space-y-3">
          <Step icon={<ShieldCheck className="size-4" />}
            title="ได้เลขที่ใบทันที"
            sub="เก็บไว้ตามงาน · เช่น RP-2569-0001"
          />
          <Step icon={<Clock className="size-4" />}
            title="ทีมงานเห็นทันที"
            sub="ด่วนมาก ตอบใน 4 ชม. · ปานกลาง 24 ชม. · ไม่เร่ง 3 วัน"
          />
          <Step icon={<Camera className="size-4" />}
            title="รูปก่อน/หลัง"
            sub="ทุกขั้นตอนจะมีรูปยืนยันงาน"
          />
          <Step icon={<MessageCircle className="size-4" />}
            title="ติดตามได้ตลอด"
            sub="เปิดลิ้งค์ /r/track + เลขที่ใบ + เบอร์ของคุณ"
          />
        </ul>
      </div>

      {/* Footer tip */}
      <div className="text-center text-[12px] text-zinc-500">
        ลิงก์นี้สามารถแชร์ทาง LINE / แปะที่ร้านได้
      </div>
    </div>
  );
}

function Step({
  icon,
  title,
  sub,
}: {
  icon: React.ReactNode;
  title: string;
  sub: string;
}) {
  return (
    <li className="flex gap-3 items-start">
      <span className="size-8 rounded-lg bg-blue-50 text-blue-700 grid place-items-center shrink-0">
        {icon}
      </span>
      <div>
        <p className="font-bold text-zinc-900 text-[13.5px]">{title}</p>
        <p className="text-[12.5px] text-zinc-600">{sub}</p>
      </div>
    </li>
  );
}
