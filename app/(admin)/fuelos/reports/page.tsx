import Link from "next/link";
import { requireUser, atLeast } from "@/lib/fuelos/auth";
import { redirect } from "next/navigation";
import {
  getKpiSummary,
  getOverdueCustomers,
  getPnlReport,
} from "@/lib/fuelos/reports-data";
import { PageHeader } from "@/components/fuelos/ui/page-header";
import { formatBaht, formatNumber, bkkRelative } from "@/lib/fuelos/utils/format";
import { cn } from "@/lib/fuelos/utils/cn";
import {
  Clock,
  MessageSquareWarning,
  TrendingUp,
  Download,
  AlertTriangle,
  Trophy,
} from "lucide-react";

export const dynamic = "force-dynamic";

function fmtMinutes(min: number | null): string {
  if (min == null) return "—";
  if (min < 60) return `${formatNumber(min)} นาที`;
  const hr = Math.floor(min / 60);
  const rem = min % 60;
  return rem > 0 ? `${hr} ชม. ${rem} นาที` : `${hr} ชม.`;
}

function fmtPct(rate: number | null): string {
  if (rate == null) return "—";
  return `${Math.round(rate * 100)}%`;
}

const num = "tabular-nums font-[family-name:var(--font-plex-mono)]";

export default async function ReportsPage() {
  const user = await requireUser();
  // ดูได้เฉพาะหัวหน้าขายขึ้นไป (SALES_HEAD / ADMIN / OWNER)
  if (!atLeast(user.role, "SALES_HEAD")) redirect("/dashboard");

  const [kpi, anomalies, pnl] = await Promise.all([
    getKpiSummary(user.orgId),
    getOverdueCustomers(user.orgId),
    getPnlReport(user.orgId),
  ]);

  return (
    <div className="space-y-8">
      <PageHeader
        title="รายงาน"
        subtitle="สรุปผลงานทีมขาย · กำไร/ยอดขาย · ลูกค้าที่ควรตามต่อ"
        actions={
          <a
            href="/reports/export"
            className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 transition-colors"
          >
            <Download className="size-4" /> ดาวน์โหลด Excel/CSV
          </a>
        }
      />

      {/* ============ F3 — KPI ทีมขาย ============ */}
      <section>
        <h2 className="text-sm font-semibold text-zinc-500 mb-3">
          ตัวชี้วัดทีมขาย (เดือนนี้)
        </h2>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            icon={Clock}
            accent="brand"
            label="เวลาตอบลูกค้าครั้งแรก (เฉลี่ย)"
            value={fmtMinutes(kpi.avgFirstResponseMinutes)}
            hint={
              kpi.respondedConvCount > 0
                ? `จาก ${formatNumber(kpi.respondedConvCount)} แชท`
                : "ยังไม่มีข้อมูล"
            }
          />
          <KpiCard
            icon={MessageSquareWarning}
            accent={kpi.unansweredCount > 0 ? "danger" : "zinc"}
            label="แชทค้างตอบตอนนี้"
            value={formatNumber(kpi.unansweredCount)}
            hint={kpi.unansweredCount > 0 ? "ควรรีบตอบ" : "ตอบครบแล้ว"}
          />
          <KpiCard
            icon={TrendingUp}
            accent="leaf"
            label="ยอดขายเดือนนี้"
            value={formatBaht(pnl.month.sales)}
            hint={`กำไร ${formatBaht(pnl.month.profit)}`}
          />
          <KpiCard
            icon={Trophy}
            accent="brand"
            label="ออเดอร์เดือนนี้"
            value={formatNumber(pnl.month.ordersCount)}
            hint={`เซลล์มีผลงาน ${formatNumber(kpi.perSales.length)} คน`}
          />
        </div>

        {/* ตารางต่อเซลล์ */}
        <div className="mt-3 rounded-2xl border border-border bg-surface overflow-hidden">
          <div className="px-4 py-3 border-b border-border text-sm font-semibold">
            ผลงานรายคน (เดือนนี้)
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="text-left text-xs text-zinc-500 border-b border-border">
                  <th className="px-4 py-2.5 font-medium">เซลล์</th>
                  <th className="px-4 py-2.5 font-medium text-right">ออเดอร์</th>
                  <th className="px-4 py-2.5 font-medium text-right">ยอดขาย</th>
                  <th className="px-4 py-2.5 font-medium text-right">กำไร</th>
                  <th className="px-4 py-2.5 font-medium text-right">
                    ปิดดีล (WON/ปิดผล)
                  </th>
                  <th className="px-4 py-2.5 font-medium text-right">Win-rate</th>
                </tr>
              </thead>
              <tbody>
                {kpi.perSales.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-8 text-center text-zinc-400"
                    >
                      ยังไม่มีผลงานเดือนนี้
                    </td>
                  </tr>
                )}
                {kpi.perSales.map((s) => (
                  <tr
                    key={s.salesId}
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-4 py-2.5 font-medium">{s.name}</td>
                    <td className={cn("px-4 py-2.5 text-right", num)}>
                      {formatNumber(s.ordersCount)}
                    </td>
                    <td className={cn("px-4 py-2.5 text-right", num)}>
                      {formatBaht(s.totalSales)}
                    </td>
                    <td
                      className={cn(
                        "px-4 py-2.5 text-right text-leaf-700",
                        num,
                      )}
                    >
                      {formatBaht(s.totalProfit)}
                    </td>
                    <td className={cn("px-4 py-2.5 text-right", num)}>
                      {formatNumber(s.quotesWon)}/{formatNumber(s.quotesTotal)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span
                        className={cn(
                          "inline-flex items-center text-[11px] px-1.5 py-0.5 rounded-full",
                          s.winRate == null
                            ? "bg-surface-2 text-zinc-500"
                            : s.winRate >= 0.5
                              ? "bg-leaf-500/10 text-leaf-700"
                              : "bg-warning/15 text-warning",
                          num,
                        )}
                      >
                        {fmtPct(s.winRate)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ============ ลูกค้าผิดปกติ — เกินรอบซื้อ ============ */}
      <section>
        <h2 className="text-sm font-semibold text-zinc-500 mb-3 flex items-center gap-2">
          <AlertTriangle className="size-4 text-warning" />
          ลูกค้าเกินรอบซื้อ
          <span className="text-zinc-400 font-normal">
            ({formatNumber(anomalies.length)} ราย)
          </span>
        </h2>

        {anomalies.length === 0 ? (
          <div className="rounded-2xl border border-border bg-surface p-6 text-center text-sm text-zinc-400">
            ไม่มีลูกค้าเกินรอบซื้อ
          </div>
        ) : (
          <div className="rounded-2xl border border-border bg-surface overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[560px]">
                <thead>
                  <tr className="text-left text-xs text-zinc-500 border-b border-border">
                    <th className="px-4 py-2.5 font-medium">ลูกค้า</th>
                    <th className="px-4 py-2.5 font-medium">เจ้าของ</th>
                    <th className="px-4 py-2.5 font-medium text-right">
                      ห่างหายไป
                    </th>
                    <th className="px-4 py-2.5 font-medium text-right">
                      รอบปกติ
                    </th>
                    <th className="px-4 py-2.5 font-medium text-right">
                      ซื้อล่าสุด
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {anomalies.map((a) => (
                    <tr
                      key={a.id}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/customers/${a.id}`}
                          className="font-medium hover:text-brand-700"
                        >
                          {a.name}
                        </Link>
                        {a.zone && (
                          <span className="text-xs text-zinc-400 ml-2">
                            โซน {a.zone}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-zinc-600">
                        {a.owner ?? "—"}
                      </td>
                      <td
                        className={cn(
                          "px-4 py-2.5 text-right text-warning font-medium",
                          num,
                        )}
                      >
                        {a.daysSince != null
                          ? `${formatNumber(a.daysSince)} วัน`
                          : "—"}
                      </td>
                      <td
                        className={cn("px-4 py-2.5 text-right text-zinc-500", num)}
                      >
                        {a.normalCadence != null
                          ? `${formatNumber(a.normalCadence)} วัน`
                          : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right text-zinc-500">
                        {a.lastOrderAt ? bkkRelative(a.lastOrderAt) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* ============ F11 — กำไร/ขาดทุน (P&L) ============ */}
      <section>
        <h2 className="text-sm font-semibold text-zinc-500 mb-3">
          กำไร / ยอดขาย (P&amp;L)
        </h2>

        <div className="grid sm:grid-cols-2 gap-3">
          <PnlBlock title="วันนี้" totals={pnl.today} />
          <PnlBlock title="เดือนนี้" totals={pnl.month} />
        </div>

        {/* แยกตามชนิดน้ำมัน */}
        <BreakdownTable
          className="mt-3"
          title="แยกตามชนิดน้ำมัน (เดือนนี้)"
          firstCol="ชนิดน้ำมัน"
          rows={pnl.byProduct.map((p) => ({
            key: p.productType,
            name: p.label,
            extra: `${formatNumber(Math.round(p.liters))} ล.`,
            sales: p.sales,
            profit: p.profit,
          }))}
          extraHeader="ปริมาณ"
        />

        <div className="grid lg:grid-cols-2 gap-3 mt-3">
          <BreakdownTable
            title="ลูกค้าทำกำไรสูงสุด (Top 10)"
            firstCol="ลูกค้า"
            rows={pnl.topCustomers.map((c) => ({
              key: c.customerId,
              name: c.name,
              extra: c.zone ?? "—",
              sales: c.sales,
              profit: c.profit,
              href: `/customers/${c.customerId}`,
            }))}
            extraHeader="โซน"
          />
          <BreakdownTable
            title="แยกตามเซลล์ (เดือนนี้)"
            firstCol="เซลล์"
            rows={pnl.bySales.map((s) => ({
              key: s.key,
              name: s.name,
              sales: s.sales,
              profit: s.profit,
            }))}
          />
        </div>

        <BreakdownTable
          className="mt-3"
          title="แยกตามโซน (เดือนนี้)"
          firstCol="โซน"
          rows={pnl.byZone.map((z) => ({
            key: z.key,
            name: z.name,
            sales: z.sales,
            profit: z.profit,
          }))}
        />
      </section>
    </div>
  );
}

// ---------- ชิ้นส่วน UI ----------

function KpiCard({
  icon: Icon,
  accent,
  label,
  value,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  accent: "brand" | "leaf" | "danger" | "zinc";
  label: string;
  value: string;
  hint?: string;
}) {
  const accentClass: Record<string, string> = {
    brand: "bg-brand-50 text-brand-700",
    leaf: "bg-leaf-500/10 text-leaf-700",
    danger: "bg-danger/10 text-danger",
    zinc: "bg-surface-2 text-zinc-500",
  };
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div
        className={cn(
          "size-9 rounded-xl grid place-items-center mb-3",
          accentClass[accent],
        )}
      >
        <Icon className="size-[18px]" />
      </div>
      <div className={cn("text-xl font-bold", num)}>{value}</div>
      <div className="text-xs text-zinc-500 mt-0.5">{label}</div>
      {hint && <div className="text-[11px] text-zinc-400 mt-0.5">{hint}</div>}
    </div>
  );
}

function PnlBlock({
  title,
  totals,
}: {
  title: string;
  totals: { sales: number; cost: number; profit: number; ordersCount: number };
}) {
  const marginPct =
    totals.sales > 0 ? Math.round((totals.profit / totals.sales) * 100) : null;
  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex items-center justify-between">
        <span className="text-sm text-zinc-500">{title}</span>
        <span className="text-xs text-zinc-400">
          {formatNumber(totals.ordersCount)} ออเดอร์
        </span>
      </div>
      <div className={cn("text-3xl font-bold mt-2", num)}>
        {formatBaht(totals.sales)}
      </div>
      <div className="grid grid-cols-2 gap-2 mt-3 text-sm">
        <div>
          <div className="text-xs text-zinc-400">ต้นทุน</div>
          <div className={cn("font-medium text-zinc-600", num)}>
            {formatBaht(totals.cost)}
          </div>
        </div>
        <div>
          <div className="text-xs text-zinc-400">
            กำไร{marginPct != null ? ` (${marginPct}%)` : ""}
          </div>
          <div className={cn("font-semibold text-leaf-700", num)}>
            {formatBaht(totals.profit)}
          </div>
        </div>
      </div>
    </div>
  );
}

type BreakdownRow = {
  key: string;
  name: string;
  extra?: string;
  sales: number;
  profit: number;
  href?: string;
};

function BreakdownTable({
  title,
  firstCol,
  rows,
  extraHeader,
  className,
}: {
  title: string;
  firstCol: string;
  rows: BreakdownRow[];
  extraHeader?: string;
  className?: string;
}) {
  const minW = extraHeader ? "min-w-[520px]" : "min-w-[420px]";
  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-surface overflow-hidden",
        className,
      )}
    >
      <div className="px-4 py-3 border-b border-border text-sm font-semibold">
        {title}
      </div>
      <div className="overflow-x-auto">
        <table className={cn("w-full text-sm", minW)}>
          <thead>
            <tr className="text-left text-xs text-zinc-500 border-b border-border">
              <th className="px-4 py-2.5 font-medium">{firstCol}</th>
              {extraHeader && (
                <th className="px-4 py-2.5 font-medium text-right">
                  {extraHeader}
                </th>
              )}
              <th className="px-4 py-2.5 font-medium text-right">ยอดขาย</th>
              <th className="px-4 py-2.5 font-medium text-right">กำไร</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={extraHeader ? 4 : 3}
                  className="px-4 py-8 text-center text-zinc-400"
                >
                  ยังไม่มีข้อมูล
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-border last:border-0">
                <td className="px-4 py-2.5 font-medium">
                  {r.href ? (
                    <Link href={r.href} className="hover:text-brand-700">
                      {r.name}
                    </Link>
                  ) : (
                    r.name
                  )}
                </td>
                {extraHeader && (
                  <td className={cn("px-4 py-2.5 text-right text-zinc-500", num)}>
                    {r.extra ?? "—"}
                  </td>
                )}
                <td className={cn("px-4 py-2.5 text-right", num)}>
                  {formatBaht(r.sales)}
                </td>
                <td
                  className={cn("px-4 py-2.5 text-right text-leaf-700", num)}
                >
                  {formatBaht(r.profit)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
