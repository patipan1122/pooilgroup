// DocuFlow · AI Search "ภาษาคน" — Capability G
// ────────────────────────────────────────────────────────────────────
// Server page · executive role guard. Renders client SearchInterface.
// Spec: ดีเทลv1/DOCUFLOW.md §7
// ────────────────────────────────────────────────────────────────────

import { Sparkles } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { requireExecutiveRole } from "@/lib/auth/role-guards";
import { thaiDateLong } from "@/lib/utils/format";
import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { SearchInterface } from "@/components/docuflow/search-interface";

export const dynamic = "force-dynamic";

const EXAMPLE_QUERIES = [
  "ใบอนุญาตสถานีบริการน้ำมัน KKN ยังไม่หมดอายุไหม?",
  "รถคันไหนทะเบียนหมดเดือนนี้บ้าง?",
  "โรงบรรจุก๊าซต้องมีใบอนุญาตอะไรบ้าง?",
  "ใบขับขี่คนขับที่หมดแล้วมีใครบ้าง?",
  "เอกสารอะไรที่ใช้กับทุกสาขาปั๊มน้ำมัน?",
];

export default async function DocuFlowSearchPage() {
  const session = await requireSession();
  requireExecutiveRole(session.user.role);

  return (
    <div className="p-3 sm:p-6 lg:p-10 max-w-5xl mx-auto pb-24">
      <header className="mb-6 animate-fade-up">
        <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-brand-600)] font-bold">
          📄 DocuFlow · {thaiDateLong(new Date())}
        </p>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-[-0.04em] font-display mt-4 leading-[0.95]">
          ค้นหา <span className="text-gradient-blue">ภาษาคน</span>
        </h1>
        <p className="text-zinc-600 mt-1.5 text-sm">
          ถามเป็นภาษาไทย เช่น &ldquo;ใบอนุญาตสถานี KKN ใกล้หมดไหม&rdquo; — ระบบ AI จะค้น + สรุปให้
        </p>
      </header>

      <Section
        number="01"
        label="ASK"
        title="พิมพ์คำถามของคุณ"
        className="animate-fade-up delay-100"
      >
        <Card>
          <CardBody className="p-4 sm:p-6">
            <SearchInterface examples={EXAMPLE_QUERIES} />
          </CardBody>
        </Card>
      </Section>

      <Section
        number="02"
        label="HINTS"
        title="เคล็ดลับการถาม"
        className="mt-6 animate-fade-up delay-200"
      >
        <Card>
          <CardBody className="p-4 sm:p-6 space-y-2 text-sm text-zinc-700">
            <p className="flex items-start gap-2">
              <Sparkles className="size-4 mt-0.5 text-[var(--color-brand-600)] shrink-0" />
              <span>
                ระบุชื่อ/รหัสสาขา เช่น &ldquo;สาขา KKN&rdquo; เพื่อจำกัดคำตอบ
              </span>
            </p>
            <p className="flex items-start gap-2">
              <Sparkles className="size-4 mt-0.5 text-[var(--color-brand-600)] shrink-0" />
              <span>
                ระบุช่วงเวลา เช่น &ldquo;หมดใน 30 วัน&rdquo; / &ldquo;หมดเดือนนี้&rdquo;
              </span>
            </p>
            <p className="flex items-start gap-2">
              <Sparkles className="size-4 mt-0.5 text-[var(--color-brand-600)] shrink-0" />
              <span>
                ถามเรื่อง รถ → จะค้นจากทะเบียน/พ.ร.บ./ตรวจสภาพ · ถามเรื่อง คนขับ → ใบขับขี่/ใบรับรอง
              </span>
            </p>
            <p className="flex items-start gap-2">
              <Sparkles className="size-4 mt-0.5 text-[var(--color-brand-600)] shrink-0" />
              <span>
                คำตอบ cache 1 ชั่วโมง — ถ้าพึ่งอัปเดตเอกสาร อาจต้องรอสักครู่
              </span>
            </p>
          </CardBody>
        </Card>
      </Section>
    </div>
  );
}
