// Setup Wizard — Super Admin paste-and-go
// Paste branch list (CSV) or use simple form → create everything in one shot.

import Link from "next/link";
import {} from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Section } from "@/components/ui/section";
import { SetupWizardForm } from "./wizard-form";
import { BackButton } from "@/components/ui/back-button";

export const dynamic = "force-dynamic";

export default async function SetupWizardPage() {
  const session = await requireRole("super_admin");
  const admin = adminClient();
  let companies: Array<{ id: string; code: string; name: string }> = [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await (admin.from as any)("companies")
      .select("id, code, name")
      .eq("org_id", session.user.org_id)
      .eq("is_active", true)
      .order("code");
    if (r.data) companies = r.data;
  } catch {
    /* ignore */
  }

  return (
    <div className="p-3 sm:p-6 lg:p-10 max-w-4xl mx-auto pb-24">
      <BackButton label="กลับ" fallbackHref="/home" />
      <header className="mt-3 mb-6">
        <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-brand-600)] font-bold">
          ✨ SETUP WIZARD
        </p>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight font-display mt-1">
          ตั้งค่า <span className="accent">เริ่มต้น</span>
        </h1>
        <p className="text-zinc-600 mt-1 text-sm">
          วาง CSV หรือกรอกรายการสาขาทีเดียว — ระบบจะสร้างสาขา + invite ผจก. ให้
        </p>
      </header>

      <Section
        number="01"
        label="WIZARD"
        title="กรอกข้อมูลครั้งเดียว"
        className="mb-6"
      >
        <Card>
          <CardHeader>
            <CardTitle>สาขา + ผจก. + เป้าหมาย</CardTitle>
          </CardHeader>
          <CardBody>
            <SetupWizardForm companies={companies} />
          </CardBody>
        </Card>
      </Section>

      <Section number="02" label="HELP" title="ช่วยเหลือ">
        <Card>
          <CardBody className="space-y-2 text-sm text-zinc-700">
            <p>
              <b>วิธีใช้แบบเร็ว:</b>
            </p>
            <ol className="list-decimal list-inside space-y-1.5">
              <li>เลือกบริษัท (Pooil Oil หรือ JP Sync) จาก dropdown</li>
              <li>วาง CSV ของสาขา 1 บรรทัด/สาขา</li>
              <li>(ออปชัน) เพิ่มชื่อ/เบอร์ ผจก. — ระบบจะสร้าง invite link ให้</li>
              <li>กด "สร้างทั้งหมด"</li>
            </ol>
            <p className="text-zinc-500 text-xs mt-3">
              ประเภทธุรกิจที่ใช้ได้: fuel_station, lpg_station, lpg_retail, bottling_plant, hotel, convenience_store, ev_station, cafe, cafe_punthai, massage_chair, claw_machine, training_center
            </p>
          </CardBody>
        </Card>
      </Section>
    </div>
  );
}
