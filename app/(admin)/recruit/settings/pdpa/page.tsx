// /recruit/settings/pdpa — PDPA / Privacy compliance dashboard
// Per Recruit Redesign canvas screen 13B (PDPASettings)
//
// Phase 1 = read-only compliance dashboard (no new schema).
// Phase 2 (later) = configurable retention + right-to-erasure form.

import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { requireRecruitAdmin } from "@/lib/recruit/role-guard";
import { prisma } from "@/lib/prisma";
import { Section } from "@/components/ui/section";
import {
  Shield,
  Check,
  AlertTriangle,
  Calendar,
  FileText,
  Lock,
  ClipboardList,
} from "lucide-react";

export const dynamic = "force-dynamic";

export default async function PDPASettingsPage() {
  const session = await requireSession();
  requireRecruitAdmin(session.user.role);

  const orgId = session.user.org_id;

  // Stats
  const [totalApplicants, totalApplications, rejectedOld, blacklistTotal] =
    await Promise.all([
      prisma.recruitApplicant.count({ where: { orgId } }),
      prisma.recruitApplication.count({ where: { orgId, draft: false } }),
      prisma.recruitApplication.count({
        where: {
          orgId,
          status: "REJECTED",
          createdAt: { lt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) },
        },
      }),
      prisma.recruitBlacklist.count({ where: { orgId, removedAt: null } }),
    ]);

  // Recent audit entries (recruit-related)
  const auditEntries = await prisma.auditLog.findMany({
    where: {
      orgId,
      action: { startsWith: "RECRUIT_" },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { user: { select: { name: true } } },
  });

  // Compliance checklist
  const compliance = [
    {
      label: "Audit log enabled",
      ok: true,
      desc: "ทุก action ของ HR ถูกบันทึกที่ audit_log",
    },
    {
      label: "RLS (Row Level Security)",
      ok: true,
      desc: "ข้อมูลแต่ละ org แยกชั้นที่ database",
    },
    {
      label: "No national ID at apply",
      ok: true,
      desc: "ตอนสมัครเก็บแค่เบอร์ + อีเมล · ไม่มีเลขบัตร (CEO ขั้น Q5)",
    },
    {
      label: "Data retention (manual)",
      ok: false,
      desc: "ยังไม่มี auto-purge · HR ต้องลบเอง",
    },
    {
      label: "Right to erasure flow",
      ok: false,
      desc: "ยังไม่มีฟอร์มขอลบจาก candidate (Phase 2)",
    },
    {
      label: "Consent at submit",
      ok: true,
      desc: "Public form มี checkbox ยินยอม PDPA ก่อนส่ง",
    },
  ];

  const compliantCount = compliance.filter((c) => c.ok).length;

  return (
    <div className="p-5 sm:p-8 max-w-6xl mx-auto">
      <Section
        number="13"
        label="PDPA · ความปลอดภัย"
        title="ข้อมูลส่วนบุคคล"
        description="ตามกฎหมาย PDPA · ตรวจสุขภาพการเก็บข้อมูล · ดูล่าสุดที่ใครเข้าถึงข้อมูลใคร"
      >
        {/* Score banner */}
        <div className="rounded-2xl bg-gradient-to-br from-green-50 to-white border border-green-200 p-5 mb-6 flex items-center gap-4">
          <div className="size-14 rounded-2xl bg-green-100 text-green-700 flex items-center justify-center shrink-0">
            <Shield className="size-7" />
          </div>
          <div className="flex-1">
            <p className="text-xs font-bold text-green-800 uppercase tracking-wide">
              คะแนน Compliance
            </p>
            <p className="text-3xl font-extrabold font-display text-green-700 leading-tight mt-1">
              {compliantCount}/{compliance.length}
            </p>
            <p className="text-sm text-zinc-700 mt-1">
              ผ่านเกณฑ์ PDPA หลัก · ยังมี {compliance.length - compliantCount} ข้อต้องเพิ่มเติม
            </p>
          </div>
        </div>

        {/* Data stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <StatCard label="คนใน DB" value={totalApplicants} Icon={ClipboardList} />
          <StatCard label="ใบสมัครรวม" value={totalApplications} Icon={FileText} />
          <StatCard
            label="คนที่ไม่ผ่าน >60d"
            value={rejectedOld}
            Icon={Calendar}
            hint="แนะนำให้พิจารณาลบ"
          />
          <StatCard label="Blacklist" value={blacklistTotal} Icon={Lock} />
        </div>

        {/* Compliance checklist */}
        <div className="rounded-2xl border border-zinc-200 bg-white overflow-hidden mb-6">
          <div className="p-4 border-b border-zinc-200 bg-zinc-50/60">
            <h2 className="text-sm font-bold text-zinc-900">รายการตรวจสอบ</h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              สิ่งที่ระบบทำให้แล้ว · สิ่งที่ต้องทำเพิ่ม
            </p>
          </div>
          <div className="divide-y divide-zinc-100">
            {compliance.map((c) => (
              <div key={c.label} className="p-4 flex items-start gap-3">
                <div
                  className={`size-7 rounded-full flex items-center justify-center shrink-0 ${
                    c.ok ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
                  }`}
                >
                  {c.ok ? <Check className="size-4" /> : <AlertTriangle className="size-4" />}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-bold text-zinc-900">{c.label}</p>
                  <p className="text-xs text-zinc-600 mt-1">{c.desc}</p>
                </div>
                <span
                  className={`text-[11px] font-bold px-2 py-1 rounded-full shrink-0 ${
                    c.ok ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"
                  }`}
                >
                  {c.ok ? "ครอบคลุม" : "ขาด"}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Retention recommendations */}
        {rejectedOld > 0 && (
          <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 mb-6 flex items-start gap-3">
            <AlertTriangle className="size-5 text-amber-700 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-bold text-amber-900">
                แนะนำลบข้อมูลเก่า · {rejectedOld} ใบสมัคร
              </p>
              <p className="text-xs text-zinc-700 mt-1 leading-relaxed">
                ใบสมัครที่ไม่ผ่านมากกว่า 60 วัน — ตามแนวปฏิบัติ PDPA ควรลบหรือ
                anonymize · ขณะนี้ HR ต้องลบเอง (Phase 2 จะมี auto-purge)
              </p>
            </div>
            <Link
              href="/recruit?status=REJECTED"
              className="h-9 px-3 inline-flex items-center text-xs font-bold rounded-lg bg-amber-700 text-white hover:bg-amber-800"
            >
              ดูรายการ
            </Link>
          </div>
        )}

        {/* Audit log */}
        <div className="rounded-2xl border border-zinc-200 bg-white overflow-hidden">
          <div className="p-4 border-b border-zinc-200 bg-zinc-50/60 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-zinc-900">Audit Log · 20 รายการล่าสุด</h2>
              <p className="text-xs text-zinc-500 mt-0.5">
                ทุก action ที่เปลี่ยน/อ่านข้อมูลผู้สมัคร
              </p>
            </div>
            <Link
              href="/audit-log?module=recruit"
              className="text-xs font-bold text-[var(--color-brand-700)] hover:underline"
            >
              ดูทั้งหมด →
            </Link>
          </div>
          {auditEntries.length === 0 ? (
            <p className="p-6 text-center text-sm text-zinc-400">
              ยังไม่มี audit log
            </p>
          ) : (
            <div className="divide-y divide-zinc-100 max-h-[400px] overflow-y-auto">
              {auditEntries.map((e) => (
                <div
                  key={e.id}
                  className="px-4 py-2.5 flex items-center gap-3 text-xs"
                >
                  <span className="font-mono text-[10px] text-zinc-400 w-32 shrink-0">
                    {new Date(e.createdAt).toLocaleString("th-TH", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <span className="font-mono text-[10px] text-zinc-700 w-44 truncate shrink-0">
                    {e.action.replace(/^RECRUIT_/, "")}
                  </span>
                  <span className="text-zinc-900 flex-1 truncate">
                    {e.user?.name ?? "(public submission)"}
                  </span>
                  <span className="text-zinc-400 font-mono text-[10px] truncate">
                    {e.resourceId?.slice(-8) ?? "—"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Phase 2 note */}
        <div className="mt-6 p-4 rounded-2xl bg-zinc-50 border border-dashed border-zinc-300 text-xs text-zinc-600 leading-relaxed">
          <p className="font-bold text-zinc-800 mb-2">
            🚧 ฟีเจอร์ที่จะเพิ่ม (Phase 2):
          </p>
          <ul className="space-y-1 pl-4 list-disc">
            <li>Auto-purge applicants ที่ไม่ผ่าน &gt; 60 วัน</li>
            <li>Right to erasure — ฟอร์มขอลบจาก candidate ผ่าน /my/[refId]</li>
            <li>Data export — applicant ดาวน์โหลดข้อมูลตัวเองได้</li>
            <li>Consent log — ติดตามว่ายินยอม PDPA เมื่อไหร่</li>
            <li>Anonymization — แทน fullName ด้วย hash หลัง 1 ปี</li>
          </ul>
        </div>
      </Section>
    </div>
  );
}

function StatCard({
  label,
  value,
  Icon,
  hint,
}: {
  label: string;
  value: number;
  Icon: React.ComponentType<{ className?: string }>;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-zinc-400" />
        <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide">
          {label}
        </p>
      </div>
      <p className="text-3xl font-extrabold font-display text-zinc-900 tabular-num mt-2">
        {value}
      </p>
      {hint && <p className="text-[10px] text-zinc-400 mt-1">{hint}</p>}
    </div>
  );
}
