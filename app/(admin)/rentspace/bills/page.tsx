import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { isAdminTier, isSuperAdmin } from "@/lib/auth/role-guards";
import { userIsModuleAdmin } from "@/lib/auth/module-access";
import { RsPage, RsEmpty, RsBackLink } from "@/components/rentspace/ui";
import {
  formatBaht,
  toNum,
  tenantDisplayName,
  periodLabel,
  currentPeriod,
  BILL_STATUS,
} from "@/lib/rentspace/format";
import { listBills, getPrimaryProject, listContracts } from "@/lib/rentspace/data";
import { BillsActions } from "./_components/bills-actions";
import { BillsTable, MonthPicker, type BillRow } from "./_components/bills-list-client";

export const dynamic = "force-dynamic";

const OUTSTANDING_STATUSES = ["issued", "partial", "overdue"];

function outstandingOf(b: { totalAmount: unknown; paidAmount: unknown; status: string }): number {
  return Math.max(0, toNum(b.totalAmount) - toNum(b.paidAmount));
}

function isOverdue(b: { status: string; dueDate: Date | null }): boolean {
  if (b.status === "overdue") return true;
  if (!b.dueDate) return false;
  if (!OUTSTANDING_STATUSES.includes(b.status)) return false;
  return new Date(b.dueDate).getTime() < Date.now();
}

export default async function BillsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; period?: string }>;
}) {
  const sp = await searchParams;
  const session = await requireSession();
  const orgId = session.user.org_id;

  const statusFilter = sp.status && BILL_STATUS[sp.status] ? sp.status : undefined;
  const periodFilter = sp.period && /^\d{4}-\d{2}$/.test(sp.period) ? sp.period : undefined;

  const project = await getPrimaryProject(orgId);
  // super_admin ทำได้เสมอ · คนอื่นเมื่อ super เปิดสวิตช์ในหน้าตั้งค่า
  const isSuper = isSuperAdmin(session.user.role);
  const moduleAdmin =
    isAdminTier(session.user.role) || (await userIsModuleAdmin(session.user, "rentspace"));
  const canIssue = isSuper || (!!project?.billIssueUnlocked && moduleAdmin); // ออกบิล (เปิด default)
  const canDelete = isSuper || (!!project?.billDeleteUnlocked && moduleAdmin); // ลบบิล (ปิด default)
  // "เกินกำหนด" (overdue) is a *derived* status — a bill stays stored as
  // issued/partial with a past due date; the DB column is almost never literally
  // "overdue". So we must NOT push it to the query (that returns ~0 rows and the
  // chip looks broken); fetch the outstanding set and filter by isOverdue() here.
  const wantOverdue = statusFilter === "overdue";
  const [fetchedBills, contracts] = await Promise.all([
    listBills(orgId, {
      projectId: project?.id,
      status: wantOverdue ? undefined : statusFilter,
      period: periodFilter,
    }),
    project ? listContracts(orgId, project.id) : Promise.resolve([]),
  ]);
  const bills = wantOverdue ? fetchedBills.filter((b) => isOverdue(b)) : fetchedBills;

  // KPIs computed over the *unfiltered* picture would need a 2nd query; instead
  // compute over the returned set (filter chips are additive, so KPI reflects view).
  // To keep KPIs stable regardless of filter, fetch the full project list once.
  const allBills =
    statusFilter || periodFilter ? await listBills(orgId, { projectId: project?.id }) : fetchedBills;

  const thisPeriod = currentPeriod();
  const outstandingBills = allBills.filter((b) => OUTSTANDING_STATUSES.includes(b.status));
  const outstandingCount = outstandingBills.length;
  const outstandingAmount = outstandingBills.reduce((s, b) => s + outstandingOf(b), 0);
  const overdueCount = allBills.filter((b) => isOverdue(b)).length;
  const thisMonthBilled = allBills
    .filter((b) => b.period === thisPeriod && b.status !== "void")
    .reduce((s, b) => s + toNum(b.totalAmount), 0);

  // period chips — distinct periods present (most recent 6)
  const periods = Array.from(new Set(allBills.map((b) => b.period)))
    .sort()
    .reverse()
    .slice(0, 6);

  const activeContracts = contracts.filter((c) => c.status === "active" || c.status === "expiring");

  // floor grouping key for "เลือกทั้งชั้น": building + numeric floor when present.
  function floorKeyOf(u: { building: string | null; floor: number | null }): string {
    const b = u.building?.trim();
    const f = u.floor != null ? `ชั้น ${u.floor}` : null;
    if (b && f) return `${b} · ${f}`;
    if (f) return f;
    if (b) return `อาคาร ${b}`;
    return "ไม่ระบุชั้น";
  }

  const billRows: BillRow[] = bills.map((b) => {
    const remaining = outstandingOf(b);
    const overdue = isOverdue(b);
    return {
      id: b.id,
      billNo: b.billNo,
      period: b.period,
      unitCode: b.unit.code,
      unitName: b.unit.name,
      floorKey: floorKeyOf(b.unit),
      tenantName: tenantDisplayName(b.tenant),
      total: toNum(b.totalAmount),
      paid: toNum(b.paidAmount),
      remaining,
      dueDateISO: b.dueDate ? new Date(b.dueDate).toISOString() : null,
      displayStatus: overdue && b.status !== "void" ? "overdue" : b.status,
    };
  });

  function chipHref(next: { status?: string; period?: string }) {
    const params = new URLSearchParams();
    const s = next.status ?? statusFilter;
    const p = next.period ?? periodFilter;
    if (s) params.set("status", s);
    if (p) params.set("period", p);
    const qs = params.toString();
    return qs ? `/rentspace/bills?${qs}` : "/rentspace/bills";
  }

  return (
    <RsPage>
      <RsBackLink href="/rentspace" label="กลับหน้าหลัก" />

      {/* compact header — title + actions share one row to save vertical space */}
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex items-baseline gap-2 min-w-0">
          <h1 className="text-xl font-bold tracking-tight" style={{ color: "var(--rs-text)" }}>
            ใบแจ้งหนี้ / บิล
          </h1>
          {project?.name && (
            <span className="text-[13px] truncate" style={{ color: "var(--rs-text-2)" }}>
              · {project.name}
            </span>
          )}
        </div>
        {project && canIssue ? (
          <BillsActions
            projectId={project.id}
            period={thisPeriod}
            contracts={activeContracts.map((c) => ({
              id: c.id,
              contractNo: c.contractNo,
              unitCode: c.unit.code,
              tenantName: tenantDisplayName(c.tenant),
            }))}
          />
        ) : null}
      </header>

      {/* compact KPI strip — one thin row instead of three tall cards */}
      <div className="rs-card flex flex-wrap items-center gap-x-5 gap-y-1.5 px-4 py-2.5">
        <KpiInline
          label="บิลค้างจ่าย"
          value={formatBaht(outstandingAmount)}
          hint={`${outstandingCount} ใบ`}
          tone={outstandingAmount > 0 ? "pending" : "ok"}
        />
        <KpiDivider />
        <KpiInline label="เกินกำหนด" value={`${overdueCount} ใบ`} tone={overdueCount ? "danger" : undefined} />
        <KpiDivider />
        <KpiInline label={`ออกบิลเดือนนี้ (${periodLabel(thisPeriod)})`} value={formatBaht(thisMonthBilled)} />
      </div>

      {/* filter chips + month picker */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterChip href={chipHref({ status: undefined, period: periodFilter })} active={!statusFilter} label="ทุกสถานะ" reset={!statusFilter ? undefined : `/rentspace/bills${periodFilter ? `?period=${periodFilter}` : ""}`} />
        {Object.entries(BILL_STATUS)
          .filter(([k]) => k !== "draft")
          .map(([k, v]) => (
            <FilterChip key={k} href={chipHref({ status: k })} active={statusFilter === k} label={v.label} />
          ))}
        <span className="mx-1 h-4 w-px" style={{ background: "var(--rs-border)" }} />
        <FilterChip href={chipHref({ period: undefined, status: statusFilter })} active={!periodFilter} label="ทุกเดือน" />
        {periods.map((p) => (
          <FilterChip key={p} href={chipHref({ period: p })} active={periodFilter === p} label={periodLabel(p)} />
        ))}
        <MonthPicker value={periodFilter ?? ""} statusQS={statusFilter} />
      </div>

      {bills.length === 0 ? (
        <RsEmpty
          icon="🧾"
          title={statusFilter || periodFilter ? "ไม่มีบิลตามตัวกรองนี้" : "ยังไม่มีบิล"}
          hint={
            statusFilter || periodFilter
              ? "ลองล้างตัวกรอง (ทุกสถานะ / ทุกเดือน) เพื่อดูบิลทั้งหมด"
              : "กดออกบิลทั้งโครงการสำหรับเดือนนี้ หรือออกบิลทีละห้องจากสัญญาที่ใช้งานอยู่"
          }
        />
      ) : project ? (
        <BillsTable projectId={project.id} period={periodFilter ?? thisPeriod} rows={billRows} canDelete={canDelete} />
      ) : null}
    </RsPage>
  );
}

function KpiDivider() {
  return <span className="hidden sm:block h-7 w-px shrink-0" style={{ background: "var(--rs-border)" }} />;
}

function KpiInline({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: "ok" | "danger" | "pending";
}) {
  const color =
    tone === "danger" ? "var(--rs-danger)" : tone === "pending" ? "var(--rs-pending)" : tone === "ok" ? "var(--rs-ok)" : "var(--rs-text)";
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[12.5px] font-medium" style={{ color: "var(--rs-text-2)" }}>{label}</span>
      <span className="text-lg font-bold tabular-nums" style={{ color }}>{value}</span>
      {hint && <span className="text-[11.5px]" style={{ color: "var(--rs-text-3)" }}>{hint}</span>}
    </div>
  );
}

function FilterChip({ href, active, label, reset }: { href: string; active: boolean; label: string; reset?: string }) {
  return (
    <Link
      href={reset && active ? reset : href}
      className="rounded-full px-3 py-1.5 text-[12.5px] font-medium transition"
      style={
        active
          ? { background: "var(--rs-brand)", color: "#fff" }
          : { background: "var(--rs-bg-2)", color: "var(--rs-text-2)", border: "1px solid var(--rs-border)" }
      }
    >
      {label}
    </Link>
  );
}
