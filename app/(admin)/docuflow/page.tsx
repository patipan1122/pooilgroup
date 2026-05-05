import Link from "next/link";
import {
  FileText,
  CalendarClock,
  Tags,
  PenTool,
  Sparkles,
  GitCompare,
  ArrowRight,
} from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { thaiDateLong } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

const FEATURES = [
  {
    Icon: CalendarClock,
    title: "Expiry Dashboard",
    desc: "ติดตาม ~1,100 เอกสาร · แจ้งเตือนล่วงหน้า 90/30/7 วัน · ทะเบียนรถ/ใบขับขี่/ใบอนุญาต",
  },
  {
    Icon: Tags,
    title: "Tag System",
    desc: "เอกสารชิ้นเดียวใช้กับหลายสาขา/บริษัท · ค้นหาแบบหลายมุม",
  },
  {
    Icon: PenTool,
    title: "Signature Placement",
    desc: "ลาก Box วางจุดเซ็นบน PDF · External Sign (OTP) ไม่ต้องสมัคร",
  },
  {
    Icon: Sparkles,
    title: "AI วิเคราะห์เอกสาร",
    desc: "อ่านสัญญาก่อนเซ็น · ระบุข้อกังวล · ระดับความเสี่ยง",
  },
  {
    Icon: GitCompare,
    title: "Renewal Comparison",
    desc: "เปรียบเทียบของเดิม vs ของใหม่ · ดูว่าราคาขึ้น/เงื่อนไขเปลี่ยน",
  },
  {
    Icon: FileText,
    title: "Vehicle + Driver Tracking",
    desc: "100 คันรถ × 5 เอกสาร + 100 คนขับ × 3 เอกสาร = 500+ ไฟล์",
  },
];

export default async function DocuFlowPage() {
  await requireSession();

  return (
    <div className="p-4 sm:p-6 lg:p-10 max-w-6xl mx-auto">
      <header className="mb-8 animate-fade-up">
        <p className="text-xs uppercase tracking-[0.18em] text-[var(--color-brand-600)] font-bold">
          📄 DocuFlow · {thaiDateLong(new Date())}
        </p>
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight font-display mt-2">
          ระบบ <span className="accent">จัดการเอกสาร</span>
        </h1>
        <p className="text-zinc-600 mt-2 max-w-2xl">
          5 บริษัท · 9 ประเภทธุรกิจ · 30+ สาขา · เอกสาร 1,100+ รายการ
        </p>
      </header>

      <Card
        className="mb-8 overflow-hidden relative border-0 shadow-blue animate-fade-up delay-100"
        style={{
          background:
            "linear-gradient(135deg, oklch(0.45 0.24 264) 0%, oklch(0.50 0.28 263) 50%, oklch(0.42 0.21 264) 100%)",
        }}
      >
        <div className="absolute inset-0 bg-grid-dots-on-blue pointer-events-none opacity-60" />
        <div
          className="absolute -top-24 -right-24 w-96 h-96 rounded-full opacity-30 blur-3xl"
          style={{
            background:
              "radial-gradient(circle, oklch(0.70 0.22 250) 0%, transparent 70%)",
          }}
        />
        <CardBody className="relative text-white p-6 sm:p-10">
          <div className="flex flex-col items-start gap-4 max-w-2xl">
            <Badge tone="warning" className="!bg-amber-100 !text-amber-900">
              <FileText className="size-3" />
              อยู่ระหว่างพัฒนา · Sprint 8
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight font-display">
              DocuFlow เปิดให้ใช้งาน
              <br />
              เร็ว ๆ นี้
            </h2>
            <p className="text-base text-white/85 leading-relaxed">
              ระบบจัดการเอกสารและลายเซ็นดิจิทัล — ติดตามวันหมดอายุ, AI วิเคราะห์, External Sign
              <br />
              จัดการเอกสาร ~1,100 ไฟล์ของ 5 บริษัทในกลุ่ม Pooilgroup
            </p>
          </div>
        </CardBody>
      </Card>

      <Section
        number="01"
        label="FEATURES"
        title="ฟีเจอร์ที่จะมี"
        description="ตามสเปคใน DOCUFLOW.md — Deep Research ครอบคลุม 10 ประเภทธุรกิจ"
        className="mb-8 animate-fade-up delay-200"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map((f) => (
            <Card key={f.title} className="hover-lift">
              <CardBody className="flex items-start gap-3">
                <div className="size-10 shrink-0 rounded-xl bg-[var(--color-brand-50)] border-2 border-[var(--color-brand-100)] flex items-center justify-center text-[var(--color-brand-700)]">
                  <f.Icon className="size-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold tracking-tight">{f.title}</h3>
                  <p className="text-sm text-zinc-600 mt-1 leading-relaxed">
                    {f.desc}
                  </p>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      </Section>

      <Section
        number="02"
        label="WHILE YOU WAIT"
        title="ระหว่างรอ"
        className="animate-fade-up delay-300"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Link
            href="/cashhub/dashboard"
            className="flex items-center justify-between gap-3 px-5 py-4 rounded-2xl border-2 border-zinc-200 bg-white hover:border-[var(--color-brand-300)] hover:bg-[var(--color-brand-50)]/30 transition-all hover-lift"
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-2xl">💰</span>
              <div className="min-w-0">
                <div className="font-semibold">CashHub</div>
                <div className="text-xs text-zinc-500">ยอดสาขารายวัน</div>
              </div>
            </div>
            <ArrowRight className="size-4 text-zinc-400 shrink-0" />
          </Link>
          <Link
            href="/home"
            className="flex items-center justify-between gap-3 px-5 py-4 rounded-2xl border-2 border-zinc-200 bg-white hover:border-[var(--color-brand-300)] hover:bg-[var(--color-brand-50)]/30 transition-all hover-lift"
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-2xl">🏠</span>
              <div className="min-w-0">
                <div className="font-semibold">หน้าหลัก</div>
                <div className="text-xs text-zinc-500">ภาพรวมทุกโปรแกรม</div>
              </div>
            </div>
            <ArrowRight className="size-4 text-zinc-400 shrink-0" />
          </Link>
        </div>
      </Section>
    </div>
  );
}
