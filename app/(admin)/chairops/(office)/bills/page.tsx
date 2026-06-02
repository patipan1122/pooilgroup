// ChairOps · บิล/ค่าใช้จ่าย (F2 · audit MISS-01)
// Matrix view: rows = branch · cols = month · default 6 months window.
// CEO + ADMIN: edit cells. MANAGER + OFFICE: read-only same view.

import Link from "next/link";
import { Settings2, AlertTriangle, BadgeCheck, Clock3 } from "lucide-react";

import { requireRole } from "@/lib/chairops/auth/session";
import { prisma } from "@/lib/prisma";
import { rankOf } from "@/lib/chairops/auth/role-guards";
import { ChairopsUserRole } from "@/lib/generated/prisma/enums";
import {
  getBillMatrix,
  getCategoryList,
  getPendingBillsTotal,
} from "@/lib/chairops/queries/vendor-bills";
import { baht } from "@/lib/chairops/utils/format";

import {
  BillsMatrixTable,
  type MatrixMonth,
  type MatrixRow,
} from "./_components/matrix-table";
import { NewBillButton } from "./_components/new-bill-button";

export const dynamic = "force-dynamic";

const THAI_MONTH = [
  "ม.ค.",
  "ก.พ.",
  "มี.ค.",
  "เม.ย.",
  "พ.ค.",
  "มิ.ย.",
  "ก.ค.",
  "ส.ค.",
  "ก.ย.",
  "ต.ค.",
  "พ.ย.",
  "ธ.ค.",
];

function formatMonth(d: Date): string {
  const m = THAI_MONTH[d.getUTCMonth()];
  const yy = String(d.getUTCFullYear() + 543).slice(-2); // พ.ศ. last 2
  return `${m} ${yy}`;
}

type SearchParams = {
  months?: string;
  branch?: string;
  month?: string;
  status?: string;
};

export default async function BillsMatrixPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireRole("OFFICE");
  const sp = await searchParams;
  const orgId = session.user.orgId;

  // Default window: 6 months. CEO can ?months=12 to widen.
  const monthsBack = Math.max(
    3,
    Math.min(12, Number(sp.months) || 6),
  );

  // CEO+ADMIN edit · MANAGER+OFFICE view-only (per locked decision).
  const canEdit =
    rankOf(session.user.role) >= rankOf(ChairopsUserRole.CEO);

  const [matrix, categories, branches, pending] = await Promise.all([
    getBillMatrix({ orgId, monthsBack }),
    getCategoryList({ orgId }),
    prisma.chairopsBranch.findMany({
      where: { orgId, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    getPendingBillsTotal({ orgId }),
  ]);

  // Shape the matrix for the client component (Map → plain object for
  // serialization across the RSC boundary).
  const months: MatrixMonth[] = matrix.months.map((m) => ({
    monthKey: m.monthKey,
    label: formatMonth(m.firstOfMonth),
  }));
  const rows: MatrixRow[] = matrix.branches.map((b) => {
    const cells: MatrixRow["cells"] = {};
    for (const m of matrix.months) {
      const cell = b.cellsByMonth.get(m.monthKey);
      if (!cell) {
        cells[m.monthKey] = {
          total: 0,
          paidTotal: 0,
          pendingTotal: 0,
          overdueTotal: 0,
          worstStatus: null,
          bills: [],
        };
        continue;
      }
      cells[m.monthKey] = {
        total: cell.total,
        paidTotal: cell.paidTotal,
        pendingTotal: cell.pendingTotal,
        overdueTotal: cell.overdueTotal,
        worstStatus: cell.worstStatus,
        bills: cell.bills.map((bill) => ({
          id: bill.id,
          categoryId: bill.categoryId,
          categoryLabel: bill.categoryLabel,
          amount: bill.amount,
          status: bill.status,
        })),
      };
    }
    return {
      branchId: b.branchId,
      branchName: b.branchName,
      rowTotal: b.rowTotal,
      cells,
    };
  });
  const totalsByMonth: Record<string, number> = {};
  matrix.totalsByMonth.forEach((v, k) => {
    totalsByMonth[k] = v;
  });

  // Pre-fill values when user clicked a cell ?branch=&month=
  const presetBranchId = sp.branch ?? null;
  const presetMonth = sp.month ?? null;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            การเงิน
          </p>
          <h1 className="text-2xl font-semibold text-zinc-900">
            บิล / ค่าใช้จ่ายรายเดือน
          </h1>
          <p className="mt-1 text-sm text-zinc-600">
            ตาราง {monthsBack} เดือนล่าสุด · แตะแถวสาขาเพื่อดูแยกหมวด
            {!canEdit ? " · คุณอยู่โหมดดูอย่างเดียว" : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/chairops/bills?months=6"
            className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
            aria-current={monthsBack === 6 ? "page" : undefined}
          >
            6 เดือน
          </Link>
          <Link
            href="/chairops/bills?months=12"
            className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
            aria-current={monthsBack === 12 ? "page" : undefined}
          >
            12 เดือน
          </Link>
          {canEdit ? (
            <>
              <Link
                href="/chairops/bills/categories"
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
              >
                <Settings2 className="size-3.5" aria-hidden="true" />
                จัดการหมวด
              </Link>
              <NewBillButton
                branches={branches}
                categories={categories}
                presetBranchId={presetBranchId}
                presetMonth={presetMonth}
              />
            </>
          ) : null}
        </div>
      </header>

      {/* Summary tiles */}
      <section
        className="grid gap-3"
        style={{
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        }}
        aria-label="สรุปบิลค้างจ่าย"
      >
        <SummaryTile
          tone="amber"
          icon={<Clock3 className="size-4" aria-hidden="true" />}
          label="บิลรอจ่าย"
          value={`${pending.count - pending.overdueCount} ใบ`}
          subtitle={baht(pending.pendingAmount - pending.overdueAmount)}
        />
        <SummaryTile
          tone="rose"
          icon={<AlertTriangle className="size-4" aria-hidden="true" />}
          label="เกินกำหนด"
          value={`${pending.overdueCount} ใบ`}
          subtitle={baht(pending.overdueAmount)}
        />
        <SummaryTile
          tone="emerald"
          icon={<BadgeCheck className="size-4" aria-hidden="true" />}
          label="รวมทั้งหมดในช่วง"
          value={baht(matrix.grandTotal)}
          subtitle={`${monthsBack} เดือน · ทุกสาขา`}
        />
      </section>

      <BillsMatrixTable
        rows={rows}
        months={months}
        totalsByMonth={totalsByMonth}
        grandTotal={matrix.grandTotal}
        canEdit={canEdit}
      />

      <p className="text-xs text-zinc-500">
        สีเขียว = จ่ายแล้ว · เหลือง = รอจ่าย · แดง = เกินกำหนด (อัตโนมัติเมื่อพ้นวันครบกำหนด)
      </p>
    </div>
  );
}

function SummaryTile({
  tone,
  icon,
  label,
  value,
  subtitle,
}: {
  tone: "amber" | "rose" | "emerald";
  icon: React.ReactNode;
  label: string;
  value: string;
  subtitle: string;
}) {
  const TONE_RING: Record<typeof tone, string> = {
    amber: "ring-amber-200 bg-amber-50/40",
    rose: "ring-rose-200 bg-rose-50/40",
    emerald: "ring-emerald-200 bg-emerald-50/40",
  };
  const TONE_ICON: Record<typeof tone, string> = {
    amber: "bg-amber-100 text-amber-700",
    rose: "bg-rose-100 text-rose-700",
    emerald: "bg-emerald-100 text-emerald-700",
  };
  return (
    <div className={`rounded-lg p-4 ring-1 ${TONE_RING[tone]}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-zinc-600">{label}</p>
          <p className="mt-1 text-xl font-semibold text-zinc-900">{value}</p>
          <p className="mt-0.5 text-xs text-zinc-500">{subtitle}</p>
        </div>
        <span className={`inline-flex size-8 items-center justify-center rounded-md ${TONE_ICON[tone]}`}>
          {icon}
        </span>
      </div>
    </div>
  );
}
