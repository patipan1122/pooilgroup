import {
  Fuel,
  Sparkles,
  Calculator,
  Users as UsersIcon,
  Truck,
  Zap,
} from "lucide-react";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { userHasModuleAccess, isAdminTier } from "@/lib/auth/module-access";
import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { thaiDateLong } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

const FEATURES = [
  {
    Icon: Calculator,
    title: "Price Engine",
    desc: "ตั้งราคาคลังรายวัน + Zone Margin + คำนวณ Margin ลูกค้าอัตโนมัติ",
  },
  {
    Icon: UsersIcon,
    title: "CRM 1,400 ลูกค้า",
    desc: "Multi-entity · Margin Analytics · Loyalty Score · Win/Loss Tracker",
  },
  {
    Icon: Sparkles,
    title: "Sales Workspace",
    desc: "Priority List ลูกค้าที่น่าจะหมด · 1-click Copy ราคา ส่ง LINE",
  },
  {
    Icon: Truck,
    title: "Driver App",
    desc: "PWA สำหรับคนขับ · GPS Track · ถ่ายรูปมิเตอร์ · Invoice อัตโนมัติ",
  },
  {
    Icon: Zap,
    title: "Flash Sale",
    desc: "ขายน้ำมันเหลือ Broadcast LINE OA · First-come-first-served",
  },
];

export default async function FuelOSPage() {
  const session = await requireSession();
  // Block users without FuelOS membership — admin tier bypasses.
  if (!isAdminTier(session.user.role)) {
    const ok = await userHasModuleAccess(session.user, "fuelos");
    if (!ok) redirect("/403");
  }

  return (
    <div className="p-4 sm:p-6 lg:p-10 max-w-6xl mx-auto">
      <header className="mb-8 animate-fade-up">
        <p className="text-xs uppercase tracking-[0.18em] text-[var(--color-brand-600)] font-bold">
          ⛽ FuelOS · {thaiDateLong(new Date())}
        </p>
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight font-display mt-2">
          ระบบ <span className="accent">ขายส่งน้ำมัน B2B</span>
        </h1>
        <p className="text-zinc-600 mt-2 max-w-2xl">
          เซลล์ 14 คน · ลูกค้า 1,400 ราย · รถ 100 คัน · 3 คลัง (PTT / Shell / Dao)
        </p>
      </header>

      {/* Hero status banner */}
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
              <Fuel className="size-3" />
              อยู่ระหว่างพัฒนา · Sprint 6-7
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight font-display">
              FuelOS เปิดให้ใช้งาน
              <br />
              เร็ว ๆ นี้
            </h2>
            <p className="text-base text-white/85 leading-relaxed">
              ระบบขายส่งน้ำมัน B2B ครบวงจร — Price Engine, CRM, Driver App, Flash Sale
              <br />
              ออกแบบสำหรับเซลล์ 14 คน ลูกค้า 1,400 ราย และรถขนส่ง 100 คัน
            </p>
          </div>
        </CardBody>
      </Card>

      <Section
        number="01"
        label="FEATURES"
        title="ฟีเจอร์ที่จะมี"
        description="วางแผนตามสเปคใน FUELOS.md — รองรับการทำงานจริงของ Pooilgroup"
        className="mb-8 animate-fade-up delay-200"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

      {/* "WHILE YOU WAIT" section removed — Sidebar now has CashHub +
          หน้าหลัก always visible, so this duplicate row is no longer needed. */}
    </div>
  );
}
