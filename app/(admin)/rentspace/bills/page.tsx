import Link from "next/link";
import { Receipt } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { RsPage, RsHeader, RsKpi, RsBadge, RsEmpty, RsCard, RsBackLink } from "@/components/rentspace/ui";
import {
  formatBaht,
  thaiDateLong,
  toNum,
  tenantDisplayName,
  periodLabel,
  currentPeriod,
  BILL_STATUS,
} from "@/lib/rentspace/format";
import { listBills, getPrimaryProject, listContracts } from "@/lib/rentspace/data";
import { BillsActions } from "./_components/bills-actions";

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
  const [bills, contracts] = await Promise.all([
    listBills(orgId, { projectId: project?.id, status: statusFilter, period: periodFilter }),
    project ? listContracts(orgId, project.id) : Promise.resolve([]),
  ]);

  // KPIs computed over the *unfiltered* picture would need a 2nd query; instead
  // compute over the returned set (filter chips are additive, so KPI reflects view).
  // To keep KPIs stable regardless of filter, fetch the full project list once.
  const allBills =
    statusFilter || periodFilter ? await listBills(orgId, { projectId: project?.id }) : bills;

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
      <RsHeader
        title="ใบแจ้งหนี้ / บิล"
        subtitle={project?.name ?? undefined}
        action={
          project ? (
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
          ) : null
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <RsKpi
          label="บิลค้างจ่าย"
          value={formatBaht(outstandingAmount)}
          hint={`${outstandingCount} ใบ`}
          tone={outstandingAmount > 0 ? "pending" : "ok"}
        />
        <RsKpi label="เกินกำหนด" value={overdueCount} tone={overdueCount ? "danger" : undefined} hint="ใบ" />
        <RsKpi label={`ออกบิลเดือนนี้ (${periodLabel(thisPeriod)})`} value={formatBaht(thisMonthBilled)} />
      </div>

      {/* filter chips */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterChip href={chipHref({ status: undefined, period: periodFilter })} active={!statusFilter} label="ทุกสถานะ" reset={!statusFilter ? undefined : `/rentspace/bills${periodFilter ? `?period=${periodFilter}` : ""}`} />
        {Object.entries(BILL_STATUS)
          .filter(([k]) => k !== "draft")
          .map(([k, v]) => (
            <FilterChip key={k} href={chipHref({ status: k })} active={statusFilter === k} label={v.label} />
          ))}
        {periods.length > 0 && <span className="mx-1 h-4 w-px" style={{ background: "var(--rs-border)" }} />}
        <FilterChip href={chipHref({ period: undefined, status: statusFilter })} active={!periodFilter} label="ทุกเดือน" />
        {periods.map((p) => (
          <FilterChip key={p} href={chipHref({ period: p })} active={periodFilter === p} label={periodLabel(p)} />
        ))}
      </div>

      {bills.length === 0 ? (
        <RsEmpty
          icon="🧾"
          title="ยังไม่มีบิล"
          hint="กดออกบิลทั้งโครงการสำหรับเดือนนี้ หรือออกบิลทีละห้องจากสัญญาที่ใช้งานอยู่"
        />
      ) : (
        <RsCard className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="rs-table w-full text-sm">
              <thead>
                <tr style={{ color: "var(--rs-text-2)" }} className="text-left text-[12.5px]">
                  <th className="px-4 py-2.5 font-semibold">เลขที่บิล</th>
                  <th className="px-4 py-2.5 font-semibold">ห้อง / ผู้เช่า</th>
                  <th className="px-4 py-2.5 font-semibold">งวด</th>
                  <th className="px-4 py-2.5 font-semibold text-right">ยอดรวม</th>
                  <th className="px-4 py-2.5 font-semibold text-right">จ่ายแล้ว</th>
                  <th className="px-4 py-2.5 font-semibold text-right">คงเหลือ</th>
                  <th className="px-4 py-2.5 font-semibold">ครบกำหนด</th>
                  <th className="px-4 py-2.5 font-semibold">สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {bills.map((b) => {
                  const remaining = outstandingOf(b);
                  const overdue = isOverdue(b);
                  return (
                    <tr
                      key={b.id}
                      className="border-t hover:bg-[var(--rs-bg-2)] transition"
                      style={{ borderColor: "var(--rs-border)" }}
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/rentspace/bills/${b.id}`}
                          className="font-semibold inline-flex items-center gap-1.5"
                          style={{ color: "var(--rs-brand)" }}
                        >
                          <Receipt className="h-3.5 w-3.5" /> {b.billNo}
                        </Link>
                      </td>
                      <td className="px-4 py-3" style={{ color: "var(--rs-text)" }}>
                        {b.unit.code}
                        <span style={{ color: "var(--rs-text-3)" }}>
                          {" · "}
                          {tenantDisplayName(b.tenant)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[12.5px]" style={{ color: "var(--rs-text-2)" }}>
                        {periodLabel(b.period)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums" style={{ color: "var(--rs-text)" }}>
                        {formatBaht(toNum(b.totalAmount))}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums" style={{ color: "var(--rs-text-2)" }}>
                        {formatBaht(toNum(b.paidAmount))}
                      </td>
                      <td
                        className="px-4 py-3 text-right tabular-nums font-semibold"
                        style={{ color: remaining > 0 ? "var(--rs-danger)" : "var(--rs-text-3)" }}
                      >
                        {formatBaht(remaining)}
                      </td>
                      <td
                        className="px-4 py-3 text-[12.5px]"
                        style={{ color: overdue ? "var(--rs-danger)" : "var(--rs-text-2)" }}
                      >
                        {b.dueDate ? thaiDateLong(b.dueDate) : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <RsBadge kind="bill" status={overdue && b.status !== "void" ? "overdue" : b.status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </RsCard>
      )}
    </RsPage>
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
