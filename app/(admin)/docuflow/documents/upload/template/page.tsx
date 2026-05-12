// DocuFlow — Upload Wizard (3 step scope-narrowing)
// ────────────────────────────────────────────────────────────────────
// Phase 3 redesign 2026-05-12 — ตัด template-specific step ออก
//
//   Step 1 (no query):       ⏰ มีหมดอายุ  /  ∞ ไม่มี  /  กรอกเอง
//   Step 2 (?expiry=...):    🏢 Pooil Oil  /  🏢 JP Sync  /  ทั้ง 2  /  🌐 ทั้งกลุ่ม
//   Step 3 (?expiry=...&companies=...):
//                            ⛽ ปั๊ม  /  🏪 7-11  /  ...  /  ทุกธุรกิจ
//   → redirect to /docuflow/documents/upload?wizExpiry=...&wizCompanies=...&wizTypes=...
//
// URL is stateful — refreshable + back-button works
// "ทั้งกลุ่ม" → ข้าม Step 3 (เอกสารระดับ group ไม่ผูกธุรกิจ)
// ────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Clock,
  Infinity as InfinityIcon,
  Edit3,
  ArrowLeft,
  Building2,
  Globe2,
} from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { requireAdminTier } from "@/lib/auth/role-guards";
import { prisma } from "@/lib/prisma";
import { Section } from "@/components/ui/section";
import { thaiDateLong } from "@/lib/utils/format";
import { BUSINESS_TYPE_LIST } from "@/constants/business-types";

export const dynamic = "force-dynamic";

interface SearchParams {
  expiry?: string; // "yes" | "no"
  companies?: string; // "group" | "POIL" | "POIL,JPS" (codes)
}

const TYPE_EMOJI: Record<string, string> = {
  fuel_station: "⛽",
  lpg_station: "🔵",
  lpg_retail: "🛢️",
  bottling_plant: "🏭",
  hotel: "🏨",
  convenience_store: "🏪",
  ev_station: "⚡",
  cafe: "☕",
  cafe_punthai: "🍵",
  massage_chair: "💺",
  claw_machine: "🎰",
  training_center: "🎓",
  transport: "🚛",
  gas_fleet: "🛻",
};

export default async function UploadWizardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireSession();
  requireAdminTier(session.user.role);
  const orgId = session.user.org_id;

  const params = await searchParams;
  const expiry = params.expiry;
  const companiesParam = params.companies;

  // ─── Step 1: no params yet ───
  if (!expiry) return <Step1 />;

  // Load companies once (used in Step 2 + Step 3)
  const companies = await prisma.company.findMany({
    where: { orgId, isActive: true },
    select: { id: true, code: true, name: true },
    orderBy: { name: "asc" },
  });

  // ─── Step 2: pick company / group ───
  if (!companiesParam) return <Step2 expiry={expiry} companies={companies} />;

  // "ทั้งกลุ่ม" → skip Step 3 → form directly
  if (companiesParam === "group") {
    const dest = `/docuflow/documents/upload?wizExpiry=${expiry}&wizGroup=1`;
    redirect(dest);
  }

  // Parse selected company codes
  const selectedCodes = companiesParam.split(",").filter(Boolean);
  const selectedCompanies = companies.filter((c) =>
    selectedCodes.includes(c.code),
  );
  if (selectedCompanies.length === 0) {
    // Bad URL — restart
    redirect("/docuflow/documents/upload/template");
  }

  // ─── Step 3: pick business types (filtered to what selected companies actually operate) ───
  const branches = await prisma.branch.findMany({
    where: {
      orgId,
      isActive: true,
      companyId: { in: selectedCompanies.map((c) => c.id) },
    },
    select: { businessType: true },
    distinct: ["businessType"],
  });
  const bizTypesAvailable = new Set(branches.map((b) => b.businessType));

  const availableBizTypes = BUSINESS_TYPE_LIST.filter((b) =>
    bizTypesAvailable.has(b.type),
  );

  return (
    <Step3
      expiry={expiry}
      companiesParam={companiesParam}
      selectedCompanies={selectedCompanies}
      availableBizTypes={availableBizTypes}
    />
  );
}

/* ============================================================
   STEP 1 — Has expiry?
   ============================================================ */

function Step1() {
  return (
    <PageShell back="/docuflow" subtitle="เริ่มจากคำถามใหญ่ที่สุด — เอกสารนี้มีวันหมดอายุไหม?">
      <Section
        number="01"
        label="STEP 1 / 3"
        title="เอกสารแบบไหน?"
        description="2 แบบ — เลือกแบบที่ตรงเอกสารในมือ"
        className="mb-10 animate-fade-up delay-100"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <BigChoice
            href="/docuflow/documents/upload/template?expiry=yes"
            icon={<Clock className="size-7" />}
            title="มีวันหมดอายุ"
            subtitle="ต้องต่ออายุเป็นรอบ"
            examples="ใบอนุญาต · ใบรับรอง · ใบขับขี่ · ฝึกอบรม"
            accent="brand"
          />
          <BigChoice
            href="/docuflow/documents/upload/template?expiry=no"
            icon={<InfinityIcon className="size-7" />}
            title="ไม่มีวันหมดอายุ"
            subtitle="ใช้ตลอด / ตามสัญญา"
            examples="สัญญาเช่า · โฉนด · แบบแปลน · นโยบาย"
            accent="neutral"
          />
        </div>

        <Link
          href="/docuflow/documents/upload"
          className="mt-6 rounded-2xl border-2 border-dashed border-zinc-200 p-5 flex items-center gap-4 hover:border-zinc-300 hover:bg-zinc-50/40 transition-colors group"
        >
          <div className="size-12 rounded-xl bg-zinc-100 flex items-center justify-center text-zinc-600 shrink-0">
            <Edit3 className="size-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-zinc-900">
              ข้ามตัวช่วย — กรอกข้อมูลเอง
            </p>
            <p className="text-xs text-zinc-500 mt-0.5">
              ผู้ใช้ประจำที่รู้ว่าจะเลือกอะไรอยู่แล้ว
            </p>
          </div>
          <span className="text-sm font-medium text-zinc-400 group-hover:text-zinc-700">
            →
          </span>
        </Link>
      </Section>
    </PageShell>
  );
}

/* ============================================================
   STEP 2 — Pick company / group
   ============================================================ */

function Step2({
  expiry,
  companies,
}: {
  expiry: string;
  companies: Array<{ id: string; code: string; name: string }>;
}) {
  const allCodes = companies.map((c) => c.code).join(",");
  return (
    <PageShell
      back="/docuflow/documents/upload/template"
      subtitle="เอกสารใช้ที่บริษัทไหน?"
      crumb={expiry === "yes" ? "⏰ มีวันหมดอายุ" : "∞ ไม่มีวันหมดอายุ"}
    >
      <Section
        number="02"
        label="STEP 2 / 3"
        title="บริษัทไหน?"
        description="ระบุขอบเขตหลัก — เลือกเฉพาะที่ใช้ / ทั้ง 2 / ใช้ทั้งกลุ่ม"
        className="mb-10 animate-fade-up delay-100"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {companies.map((c) => (
            <BigChoice
              key={c.id}
              href={`/docuflow/documents/upload/template?expiry=${expiry}&companies=${c.code}`}
              icon={<Building2 className="size-7" />}
              title={c.name}
              subtitle={c.code}
              examples="ใช้เฉพาะบริษัทนี้"
              accent="brand"
            />
          ))}

          {companies.length >= 2 && (
            <BigChoice
              href={`/docuflow/documents/upload/template?expiry=${expiry}&companies=${allCodes}`}
              icon={<Building2 className="size-7" />}
              title={`ทั้ง ${companies.length} บริษัท`}
              subtitle="Pooil Oil + JP Sync Group"
              examples="ใช้ในทั้ง 2 บริษัทพร้อมกัน"
              accent="neutral"
            />
          )}

          <BigChoice
            href={`/docuflow/documents/upload/template?expiry=${expiry}&companies=group`}
            icon={<Globe2 className="size-7" />}
            title="ทั้งกลุ่ม"
            subtitle="Pooilgroup-wide"
            examples="นโยบาย ESG · จรรยาบรรณ · มาตรฐานกลาง"
            accent="neutral"
          />
        </div>
      </Section>
    </PageShell>
  );
}

/* ============================================================
   STEP 3 — Pick business types (within the chosen company scope)
   ============================================================ */

function Step3({
  expiry,
  companiesParam,
  selectedCompanies,
  availableBizTypes,
}: {
  expiry: string;
  companiesParam: string;
  selectedCompanies: Array<{ id: string; code: string; name: string }>;
  availableBizTypes: Array<{ type: string; label: string; emoji: string }>;
}) {
  const companyLabel = selectedCompanies.map((c) => c.name).join(" + ");
  const baseHref = `/docuflow/documents/upload?wizExpiry=${expiry}&wizCompanies=${companiesParam}`;

  return (
    <PageShell
      back={`/docuflow/documents/upload/template?expiry=${expiry}`}
      subtitle={`บริษัท: ${companyLabel} — เลือกประเภทธุรกิจ`}
      crumb={`${expiry === "yes" ? "⏰" : "∞"} · 🏢 ${companyLabel}`}
    >
      <Section
        number="03"
        label="STEP 3 / 3"
        title="ประเภทธุรกิจ?"
        description="เลือกธุรกิจที่เอกสารเกี่ยวข้อง — หรือเลือก 'ทุกธุรกิจ' ถ้าใช้ข้ามทุกประเภท"
        className="mb-10 animate-fade-up delay-100"
      >
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {availableBizTypes.map((b) => (
            <Link
              key={b.type}
              href={`${baseHref}&wizTypes=${b.type}`}
              className="rounded-2xl border-2 border-zinc-200 bg-white p-5 hover:border-[var(--color-brand-400)] hover:shadow-soft transition-all hover-lift-premium group"
            >
              <div className="size-12 rounded-xl bg-zinc-100 group-hover:bg-[var(--color-brand-50)] flex items-center justify-center text-2xl mb-3 transition-colors">
                {TYPE_EMOJI[b.type] ?? "📁"}
              </div>
              <p className="font-bold text-zinc-900 text-sm">{b.label}</p>
            </Link>
          ))}
        </div>

        <div className="mt-6">
          <Link
            href={baseHref}
            className="rounded-2xl border-2 border-dashed border-[var(--color-brand-300)] p-5 flex items-center gap-4 bg-[var(--color-brand-50)]/30 hover:border-[var(--color-brand-500)] hover:bg-[var(--color-brand-50)]/60 transition-colors group"
          >
            <div className="size-12 rounded-xl bg-[var(--color-brand-100)] flex items-center justify-center text-[var(--color-brand-700)] shrink-0">
              <Globe2 className="size-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-zinc-900">
                ทุกธุรกิจ (ไม่จำเพาะ)
              </p>
              <p className="text-xs text-zinc-500 mt-0.5">
                เอกสารระดับบริษัทใช้ข้ามทุกประเภทธุรกิจ
              </p>
            </div>
            <span className="text-sm font-bold text-[var(--color-brand-700)] group-hover:translate-x-0.5 transition-transform">
              →
            </span>
          </Link>
        </div>
      </Section>
    </PageShell>
  );
}

/* ============================================================
   Shared page shell + choice card
   ============================================================ */

function PageShell({
  back,
  subtitle,
  crumb,
  children,
}: {
  back: string;
  subtitle: string;
  crumb?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="p-3 sm:p-6 lg:p-10 max-w-4xl mx-auto pb-24">
      <header className="mb-6 animate-fade-up">
        <Link
          href={back}
          className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 transition-colors"
        >
          <ArrowLeft className="size-4" />
          กลับ
        </Link>
        <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-brand-600)] font-bold mt-3">
          📄 DocuFlow · {thaiDateLong(new Date())}
        </p>
        {crumb && (
          <p className="text-xs text-zinc-500 mt-2">
            <span className="font-mono">{crumb}</span>
          </p>
        )}
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-[-0.04em] font-display mt-3 leading-[1.05]">
          อัปโหลด <span className="text-gradient-blue">เอกสารใหม่</span>
        </h1>
        <p className="text-zinc-600 mt-1.5 text-sm">{subtitle}</p>
      </header>

      {children}
    </div>
  );
}

function BigChoice({
  href,
  icon,
  title,
  subtitle,
  examples,
  accent,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  examples: string;
  accent: "brand" | "neutral";
}) {
  const cardClass =
    accent === "brand"
      ? "border-[var(--color-brand-200)] bg-[var(--color-brand-50)]/40 hover:border-[var(--color-brand-400)] hover:bg-[var(--color-brand-50)]"
      : "border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50/40";

  const iconClass =
    accent === "brand"
      ? "bg-[var(--color-brand-100)] text-[var(--color-brand-700)] border-[var(--color-brand-200)]"
      : "bg-zinc-100 text-zinc-700 border-zinc-200";

  return (
    <Link
      href={href}
      className={`rounded-3xl border-2 p-6 transition-all hover-lift-premium group ${cardClass}`}
    >
      <div
        className={`size-16 rounded-2xl border-2 flex items-center justify-center mb-4 ${iconClass}`}
      >
        {icon}
      </div>
      <h3 className="text-xl font-extrabold tracking-tight text-zinc-900 mb-1">
        {title}
      </h3>
      <p className="text-sm text-zinc-600 font-medium">{subtitle}</p>
      <div className="mt-4 pt-4 border-t border-zinc-100">
        <p className="text-xs text-zinc-500">เช่น</p>
        <p className="text-sm text-zinc-700 mt-1">{examples}</p>
      </div>
      <div className="mt-3 flex items-center justify-end">
        <span className="text-[var(--color-brand-600)] font-bold text-sm group-hover:translate-x-0.5 transition-transform">
          เลือก →
        </span>
      </div>
    </Link>
  );
}
