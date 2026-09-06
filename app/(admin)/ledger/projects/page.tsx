// Ledger · โครงการ (job-costing · F2) — HUB. รายการโครงการของบริษัท + filter กำลังทำ/ปิดแล้ว.
// การ์ด: ชื่อ · งบ · ช่วงเวลา → ลิงก์เข้าหน้ารายงานต้นทุนต่อโครงการ. สร้างโครงการ = project.manage.
// ยอดใช้จ่ายจริงอยู่หน้า detail (คิวรีต่อโครงการแพง — HUB โชว์แค่งบ + ลิงก์ ให้เบา).
// company-scoped เสมอ (Pooil ≠ JPS · resolveScope).
import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { resolveLedgerActor, ledgerWebCan } from "@/lib/ledger/liff-auth";
import { listLedgerProjects } from "@/lib/ledger/projects";
import { thaiDateLong } from "@/lib/utils/format";
import { FolderKanban, ArrowRight, Wallet } from "lucide-react";
import { resolveScope } from "../_scope";
import { LedgerHeader, NoCompanyState } from "../_components/LedgerHeader";
import { LedgerEmptyState } from "@/components/ledger/Brand";
import { ProjectFormDialog } from "@/components/ledger/projects/ProjectFormDialog";

export const dynamic = "force-dynamic";

function baht(n: number) {
  return `${Math.round(n).toLocaleString("en-US")} ฿`;
}

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string; branch?: string; view?: string }>;
}) {
  const session = await requireRole(
    "super_admin",
    "org_admin",
    "admin",
    "area_manager",
    "viewer",
    "program_admin",
  );
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

  // แท็บ: active(กำลังทำ · ค่าตั้งต้น) | archived(ปิดแล้ว)
  const view = sp.view === "archived" ? "archived" : "active";
  const includeArchived = view === "archived";

  const [projects, actor] = await Promise.all([
    listLedgerProjects(scope.orgId, scope.companyId, { includeArchived: true }),
    resolveLedgerActor(),
  ]);
  const canManage = actor ? await ledgerWebCan(actor, "project.manage") : false;

  const active = projects.filter((p) => p.status === "active");
  const archived = projects.filter((p) => p.status === "archived");
  const shown = includeArchived ? archived : active;

  // คงพารามิเตอร์ scope ตอนสลับแท็บ + เข้ารายละเอียด
  const scopeQs = new URLSearchParams();
  if (sp.company) scopeQs.set("company", sp.company);
  if (sp.branch) scopeQs.set("branch", sp.branch);
  const scopeStr = scopeQs.toString();
  const withScope = (extra?: string) =>
    [scopeStr, extra].filter(Boolean).join("&");

  const pill = (key: "active" | "archived", label: string, count: number) => {
    const on = view === key;
    const href =
      key === "active"
        ? `/ledger/projects${scopeStr ? `?${scopeStr}` : ""}`
        : `/ledger/projects?${withScope("view=archived")}`;
    return (
      <Link
        href={href}
        className={`press inline-flex min-h-[40px] items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors ${
          on
            ? "border-[var(--color-brand-200)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]"
            : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
        }`}
      >
        {label}
        <span className="tabular-nums text-xs text-zinc-400">{count}</span>
      </Link>
    );
  };

  return (
    <div className="p-4 sm:p-6">
      <LedgerHeader
        title="โครงการ"
        subtitle="ต้นทุนงานแบบมองข้าม (job-costing)"
        scope={scope}
        right={
          canManage ? <ProjectFormDialog companyId={scope.companyId} mode="create" /> : undefined
        }
      />

      {/* filter-pills */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {pill("active", "กำลังทำ", active.length)}
        {pill("archived", "ปิดแล้ว", archived.length)}
      </div>

      {shown.length === 0 ? (
        <div className="rounded-2xl border border-zinc-200 bg-white">
          <LedgerEmptyState
            className="min-h-[40vh]"
            pose="explain"
            title={
              includeArchived ? "ยังไม่มีโครงการที่ปิด" : "ยังไม่มีโครงการ"
            }
            hint={
              includeArchived
                ? "โครงการที่ปิดแล้วจะมาอยู่ตรงนี้ (ยังเปิดดูรายงานย้อนหลังได้)"
                : canManage
                  ? "สร้างโครงการเพื่อรวมค่าใช้จ่ายหลายบิลเป็นงานเดียว แล้วดูต้นทุนรวม + วางแผนงวดจ่าย"
                  : "ยังไม่มีการสร้างโครงการในบริษัทนี้"
            }
            action={
              canManage && !includeArchived ? (
                <ProjectFormDialog companyId={scope.companyId} mode="create" />
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {shown.map((p) => (
            <Link
              key={p.id}
              href={`/ledger/projects/${p.id}${scopeStr ? `?${scopeStr}` : ""}`}
              className="group animate-fade-up flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm transition-colors hover:border-[var(--color-brand-200)] hover:bg-zinc-50/60"
            >
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[var(--color-brand-50)] text-[var(--color-brand-600)]">
                <FolderKanban className="size-5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-zinc-900">{p.name}</p>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-zinc-500">
                  {p.budgetTotal != null ? (
                    <span className="inline-flex items-center gap-1 tabular-nums">
                      <Wallet className="size-3.5 text-zinc-400" aria-hidden />
                      งบ {baht(p.budgetTotal)}
                    </span>
                  ) : (
                    <span className="text-zinc-400">ไม่ได้ตั้งงบ</span>
                  )}
                  {p.startedAt && (
                    <span className="tabular-nums">
                      เริ่ม {thaiDateLong(p.startedAt)}
                    </span>
                  )}
                  {p.status === "archived" && (
                    <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-500">
                      ปิดแล้ว
                    </span>
                  )}
                </div>
              </div>
              <ArrowRight
                className="size-4 shrink-0 text-zinc-300 transition-colors group-hover:text-[var(--color-brand-500)]"
                aria-hidden
              />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
