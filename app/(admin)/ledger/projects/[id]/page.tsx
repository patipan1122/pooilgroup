// Ledger · โครงการ [id] — รายงานต้นทุน (F2) + งวดงาน (F3).
//   พาดหัว = ต้นทุนสุทธิ (netTotal · confirmed+locked) · ลิ้นชักภาษี (VAT/WHT) · แถบเทียบงบ vs จ่ายจริง ·
//   บรรทัด "รอตรวจ" (draft) แยก · timeline งวด (จัดกลุ่มผู้รับเหมา).
// มุมมองบริหาร — ไม่ใช่บัญชีตามงบ (CEO 2026-07-09). company-scoped เสมอ (resolveScope).
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { resolveLedgerActor, ledgerWebCan } from "@/lib/ledger/liff-auth";
import { getLedgerProject } from "@/lib/ledger/projects";
import { projectCostSummary } from "@/lib/ledger/dashboard";
import { listLedgerInstallments } from "@/lib/ledger/installments";
import { thaiDateLong } from "@/lib/utils/format";
import { ArrowLeft, CalendarDays, ClipboardList } from "lucide-react";
import { resolveScope } from "../../_scope";
import { LedgerHeader, NoCompanyState } from "../../_components/LedgerHeader";
import { TaxDetailDrawer } from "@/components/ledger/projects/TaxDetailDrawer";
import { InstallmentTimeline } from "@/components/ledger/projects/InstallmentTimeline";
import { ProjectFormDialog } from "@/components/ledger/projects/ProjectFormDialog";
import { ArchiveProjectButton } from "@/components/ledger/projects/ArchiveProjectButton";

export const dynamic = "force-dynamic";

function baht(n: number) {
  return `${Math.round(n).toLocaleString("en-US")} ฿`;
}

export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ company?: string; branch?: string }>;
}) {
  const session = await requireRole(
    "super_admin",
    "org_admin",
    "admin",
    "area_manager",
    "viewer",
  );
  const { id } = await params;
  const sp = await searchParams;
  const scope = await resolveScope(session.user.org_id, sp);

  if (!scope.companyId) {
    return (
      <div className="p-4 sm:p-6">
        <LedgerHeader title="โครงการ" scope={scope} />
        <NoCompanyState />
      </div>
    );
  }

  const project = await getLedgerProject(scope.orgId, scope.companyId, id);
  if (!project) notFound();

  const [cost, installments, actor] = await Promise.all([
    projectCostSummary({ orgId: scope.orgId, companyId: scope.companyId, projectId: id }),
    listLedgerInstallments(scope.orgId, scope.companyId, id),
    resolveLedgerActor(),
  ]);
  const canManage = actor ? await ledgerWebCan(actor, "project.manage") : false;

  const scopeQs = new URLSearchParams();
  if (sp.company) scopeQs.set("company", sp.company);
  if (sp.branch) scopeQs.set("branch", sp.branch);
  const scopeStr = scopeQs.toString();

  // แถบเทียบงบ vs ยอดจ่ายจริง (cashOut = gross − wht)
  const hasBudget = project.budgetTotal != null && project.budgetTotal > 0;
  const budgetPct = hasBudget ? (cost.cashOut / project.budgetTotal!) * 100 : 0;
  const overBudget = hasBudget && cost.cashOut > project.budgetTotal!;
  const nearBudget = hasBudget && !overBudget && budgetPct >= 90;
  const barColor = overBudget
    ? "bg-rose-500"
    : nearBudget
      ? "bg-amber-500"
      : "bg-[var(--color-brand-500)]";

  return (
    <div className="p-4 sm:p-6">
      {/* กลับ HUB */}
      <Link
        href={`/ledger/projects${scopeStr ? `?${scopeStr}` : ""}`}
        className="press mb-2 inline-flex min-h-[36px] items-center gap-1 text-sm font-medium text-[var(--color-brand-600)] transition-colors hover:text-[var(--color-brand-700)]"
      >
        <ArrowLeft className="size-4" aria-hidden /> โครงการทั้งหมด
      </Link>

      <LedgerHeader
        title={project.name}
        subtitle={project.status === "archived" ? "ปิดแล้ว" : undefined}
        scope={scope}
        right={
          canManage ? (
            <>
              <ProjectFormDialog
                companyId={scope.companyId}
                mode="edit"
                initial={{
                  id: project.id,
                  name: project.name,
                  budgetTotal: project.budgetTotal,
                  startedAt: project.startedAt,
                  endedAt: project.endedAt,
                  note: project.note,
                }}
              />
              <ArchiveProjectButton
                projectId={project.id}
                archived={project.status === "archived"}
              />
            </>
          ) : undefined
        }
      />

      {/* meta: ช่วงเวลา + โน้ต */}
      {(project.startedAt || project.endedAt || project.note) && (
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
          {(project.startedAt || project.endedAt) && (
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="size-3.5 text-zinc-400" aria-hidden />
              {project.startedAt ? thaiDateLong(project.startedAt) : "—"}
              {" – "}
              {project.endedAt ? thaiDateLong(project.endedAt) : "ยังไม่จบ"}
            </span>
          )}
          {project.note && <span className="truncate">{project.note}</span>}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        {/* ซ้าย — รายงานต้นทุน */}
        <div className="space-y-4">
          <div className="animate-fade-up rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            {/* พาดหัวต้นทุนสุทธิ */}
            <p className="text-xs text-zinc-500">ต้นทุนสุทธิ</p>
            <p className="mt-0.5 text-3xl font-semibold tabular-nums text-zinc-900">
              {baht(cost.netTotal)}
            </p>
            <p className="mt-1 text-xs text-zinc-400">
              มุมมองบริหาร — ไม่ใช่บัญชีตามงบ · จาก {cost.count} บิลที่ยืนยันแล้ว
            </p>

            {/* ลิ้นชักภาษี */}
            <TaxDetailDrawer vatTotal={cost.vatTotal} whtTotal={cost.whtTotal} />

            {/* แถบเทียบงบ vs จ่ายจริง */}
            {hasBudget && (
              <div className="mt-4">
                <div className="mb-1.5 flex items-baseline justify-between gap-2">
                  <span className="text-xs font-medium text-zinc-600">
                    เทียบยอดจ่ายจริง (เงินออกจริง)
                  </span>
                  <span
                    className={`text-xs font-semibold tabular-nums ${
                      overBudget ? "text-rose-700" : nearBudget ? "text-amber-700" : "text-zinc-500"
                    }`}
                  >
                    {Math.round(budgetPct)}%
                  </span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-zinc-100">
                  <div
                    className={`h-full rounded-full ${barColor} transition-[width]`}
                    style={{ width: `${Math.min(100, budgetPct)}%` }}
                  />
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-2 text-xs">
                  <span className="tabular-nums text-zinc-500">
                    จ่ายจริง {baht(cost.cashOut)} / งบ {baht(project.budgetTotal!)}
                  </span>
                  {overBudget && (
                    <span className="rounded-full bg-rose-50 px-1.5 py-0.5 text-[11px] font-semibold text-rose-700">
                      เกินงบ
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* รอตรวจ (draft) — แยกจากยอดหลัก */}
            {cost.pendingCount > 0 && (
              <Link
                href={`/ledger/expenses?${scopeStr ? `${scopeStr}&` : ""}status=draft`}
                className="press mt-4 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 transition-colors hover:bg-amber-100"
              >
                <ClipboardList className="size-4 shrink-0" aria-hidden />
                <span className="flex-1">
                  รอตรวจ {cost.pendingCount} รายการ
                  <span className="ml-1 tabular-nums text-amber-700">({baht(cost.pendingTotal)})</span>
                </span>
              </Link>
            )}
          </div>
        </div>

        {/* ขวา — งวดงาน */}
        <div className="animate-fade-up delay-100">
          <InstallmentTimeline
            summary={installments}
            projectId={project.id}
            companyId={scope.companyId}
            canManage={canManage}
          />
        </div>
      </div>
    </div>
  );
}
