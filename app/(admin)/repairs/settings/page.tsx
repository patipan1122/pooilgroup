// /repairs/settings — admin entry point to all setup tasks (Pooil App redesign)
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { requireRepairAdmin } from "@/lib/repair/role-guard";
import {
  listCategories,
  listTechnicians,
  listCompanies,
} from "@/lib/repair/queries";
import { prisma } from "@/lib/prisma";
import {
  Settings,
  Wrench,
  ListChecks,
  ExternalLink,
  Copy,
  Globe,
  Building2,
  Link as LinkIcon,
  QrCode,
} from "lucide-react";
import { RepairSubHeader } from "@/components/repair/sub-header";

export const dynamic = "force-dynamic";

export default async function RepairSettingsPage() {
  const session = await requireSession();
  requireRepairAdmin(session.user.role);
  const orgId = session.user.org_id;

  const [cats, techs, companies, branchCount] = await Promise.all([
    listCategories(orgId),
    listTechnicians(orgId, false),
    listCompanies(orgId),
    prisma.branch.count({ where: { orgId, isActive: true } }),
  ]);
  const activeTechs = techs.filter((t) => t.isActive).length;

  return (
    <>
      <RepairSubHeader
        icon={Settings}
        eyebrow="Setup · Configuration"
        title="ตั้งค่าระบบแจ้งซ่อม"
        subtitle="หมวดงาน · ช่าง · ลิงก์สาธารณะ · พรีวิวฟอร์มต่าง ๆ"
        stats={[
          { label: "หมวดงาน", value: cats.length },
          { label: "ช่าง active", value: activeTechs, tone: "success" },
          { label: "สาขา active", value: branchCount },
          { label: "บริษัท", value: companies.length },
        ]}
      />

      <div className="p-3 sm:p-5 lg:p-6 max-w-4xl mx-auto space-y-4">
        {/* Resource management */}
        <section>
          <h2 className="text-[11px] uppercase tracking-wide font-bold text-zinc-500 mb-2">
            จัดการทรัพยากร
          </h2>
          <div className="grid sm:grid-cols-2 gap-3">
            <SettingCard
              href="/repairs/technicians"
              icon={<Wrench className="size-5" />}
              tone="blue"
              title="จัดการช่าง"
              subtitle={`${activeTechs} active · ${techs.length} ทั้งหมด`}
              cta="เปิดหน้า Technicians"
            />
            <SettingCard
              href="/repairs/categories"
              icon={<ListChecks className="size-5" />}
              tone="amber"
              title="หมวดงานซ่อม"
              subtitle={`${cats.length} หมวด · ผู้แจ้งเลือกได้`}
              cta="เปิดหน้า Categories"
            />
          </div>
        </section>

        {/* Public link */}
        <section className="bg-white border border-zinc-200 rounded-2xl p-5">
          <div className="flex items-start gap-3">
            <div className="size-10 rounded-xl bg-emerald-50 text-emerald-700 grid place-items-center shrink-0">
              <LinkIcon className="size-5" />
            </div>
            <div className="flex-1">
              <h3 className="font-bold text-zinc-900">ลิงก์ฟอร์มสาธารณะ</h3>
              <p className="text-[12.5px] text-zinc-500 mt-0.5">
                ใช้แปะหน้าร้าน · LINE · QR code · ใครก็แจ้งซ่อมได้
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link
                  href="/r"
                  target="_blank"
                  className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-zinc-900 text-white font-semibold text-[12px] hover:bg-zinc-700"
                >
                  <Globe className="size-3.5" />
                  หน้าหลัก /r
                  <ExternalLink className="size-3" />
                </Link>
                <Link
                  href="/r/new"
                  target="_blank"
                  className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-blue-600 text-white font-semibold text-[12px] hover:bg-blue-700"
                >
                  <ExternalLink className="size-3.5" />
                  ฟอร์มแจ้งซ่อม /r/new
                </Link>
                <Link
                  href="/r/track"
                  target="_blank"
                  className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-white border border-zinc-200 text-zinc-700 font-semibold text-[12px] hover:bg-zinc-50"
                >
                  <ExternalLink className="size-3.5" />
                  หน้าติดตาม /r/track
                </Link>
              </div>
              <div className="mt-3 inline-flex items-center gap-2 px-3 h-8 bg-zinc-50 border border-zinc-200 rounded-md text-[12px] text-zinc-700 font-mono">
                <Copy className="size-3 text-zinc-400" />
                /r/new
                <span className="text-zinc-400">·</span>
                <QrCode className="size-3 text-zinc-400" />
                แชร์ลิงก์นี้ในกรุ๊ปไลน์สาขา
              </div>
            </div>
          </div>
        </section>

        {/* Company list snapshot */}
        {companies.length > 0 && (
          <section className="bg-white border border-zinc-200 rounded-2xl p-5">
            <h3 className="font-bold text-zinc-900 flex items-center gap-2">
              <Building2 className="size-4 text-zinc-500" />
              บริษัทในระบบ
            </h3>
            <p className="text-[12.5px] text-zinc-500 mt-0.5">
              ใช้แยก ticket ตามบริษัท · biz tab ในหน้าภาพรวม / Triage / Kanban / ตาราง
              จะกรองตามบริษัทนี้
            </p>
            <ul className="mt-3 divide-y divide-zinc-100">
              {companies.map((c) => (
                <li key={c.id} className="flex items-center py-2 text-[13px]">
                  <span className="size-7 rounded-full bg-blue-50 text-blue-700 grid place-items-center font-bold mr-3">
                    {c.code.charAt(0)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-zinc-900">{c.name}</div>
                    <div className="text-[11px] text-zinc-500 font-mono">{c.code}</div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* SLA reference card */}
        <section className="bg-zinc-50 border border-zinc-200 rounded-2xl p-5">
          <h3 className="font-bold text-zinc-900">SLA เริ่มต้น</h3>
          <p className="text-[12.5px] text-zinc-500 mt-0.5">
            ระยะเวลาที่ระบบใช้ในการตั้งวันต้องเสร็จ (อ้างอิงจาก urgency ที่ผู้แจ้งเลือก)
          </p>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <SlaTile label="ด่วนมาก" response="4 ชม." resolve="24 ชม." tone="red" />
            <SlaTile label="ปานกลาง" response="24 ชม." resolve="72 ชม." tone="amber" />
            <SlaTile label="ไม่เร่งด่วน" response="72 ชม." resolve="7 วัน" tone="zinc" />
          </div>
        </section>
      </div>
    </>
  );
}

function SettingCard({
  href,
  icon,
  tone,
  title,
  subtitle,
  cta,
}: {
  href: string;
  icon: React.ReactNode;
  tone: "blue" | "amber" | "violet" | "emerald";
  title: string;
  subtitle: string;
  cta: string;
}) {
  const toneClass: Record<typeof tone, string> = {
    blue: "bg-blue-50 text-blue-700",
    amber: "bg-amber-50 text-amber-700",
    violet: "bg-violet-50 text-violet-700",
    emerald: "bg-emerald-50 text-emerald-700",
  };
  return (
    <Link
      href={href}
      className="block bg-white rounded-2xl border border-zinc-200 p-4 hover:border-zinc-300 hover:shadow-sm transition-all"
    >
      <div className="flex items-start gap-3">
        <div className={`size-10 rounded-xl grid place-items-center shrink-0 ${toneClass[tone]}`}>
          {icon}
        </div>
        <div className="flex-1">
          <p className="font-bold text-zinc-900">{title}</p>
          <p className="text-[12.5px] text-zinc-500 mt-0.5">{subtitle}</p>
          <p className="mt-2 text-[12px] font-semibold text-blue-700">{cta} →</p>
        </div>
      </div>
    </Link>
  );
}

function SlaTile({
  label,
  response,
  resolve,
  tone,
}: {
  label: string;
  response: string;
  resolve: string;
  tone: "red" | "amber" | "zinc";
}) {
  const toneClass: Record<typeof tone, string> = {
    red: "bg-red-50 text-red-700 border-red-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    zinc: "bg-white text-zinc-700 border-zinc-200",
  };
  return (
    <div className={`rounded-xl border p-3 ${toneClass[tone]}`}>
      <div className="text-[11px] font-bold uppercase tracking-wide">{label}</div>
      <div className="mt-1.5 text-[11px] flex flex-col gap-0.5">
        <div className="tabular-nums">
          <b className="font-bold">ตอบ:</b> {response}
        </div>
        <div className="tabular-nums">
          <b className="font-bold">ปิด:</b> {resolve}
        </div>
      </div>
    </div>
  );
}
