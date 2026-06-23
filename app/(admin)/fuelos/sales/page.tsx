import Link from "next/link";
import { requireUser } from "@/lib/fuelos/auth";
import { getSalesData, type PaymentState } from "@/lib/fuelos/sales-data";
import { salesSyncConfigured } from "@/lib/fuelos/trcloud-sales";
import { PageHeader } from "@/components/fuelos/ui/page-header";
import { KpiTile } from "@/components/fuelos/ui/kpi-tile";
import { StatusPill } from "@/components/fuelos/ui/status-pill";
import { formatBaht, formatNumber, bkkRelative, bkkDate } from "@/lib/fuelos/utils/format";
import { cn } from "@/lib/fuelos/utils/cn";
import { Receipt, Wallet, Clock, AlertTriangle, Search, Users, FileText, Database } from "lucide-react";
import { SyncButton } from "./_components/sync-button";
import { AutoRefresh } from "./_components/auto-refresh";

export const dynamic = "force-dynamic";

type SP = { range?: string; view?: string; state?: string; q?: string };

const RANGES = [
  { key: "month", label: "เดือนนี้" },
  { key: "90d", label: "90 วัน" },
  { key: "year", label: "ปีนี้" },
  { key: "all", label: "ทั้งหมด" },
];
const STATES = [
  { key: "ALL", label: "ทั้งหมด" },
  { key: "UNPAID", label: "ค้างจ่าย" },
  { key: "PARTIAL", label: "จ่ายบางส่วน" },
  { key: "PAID", label: "จ่ายแล้ว" },
  { key: "OVERDUE", label: "เกินกำหนด" },
];

function rangeToDates(range: string): { from: Date; to: Date } {
  const now = new Date();
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59));
  let from: Date;
  if (range === "month") from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  else if (range === "90d") { from = new Date(now); from.setUTCDate(from.getUTCDate() - 90); }
  else if (range === "all") from = new Date(Date.UTC(2000, 0, 1));
  else from = new Date(Date.UTC(now.getUTCFullYear(), 0, 1)); // year
  return { from, to };
}

function stateLabel(s: PaymentState): { tone: "success" | "warning" | "neutral"; text: string } {
  if (s === "PAID") return { tone: "success", text: "จ่ายแล้ว" };
  if (s === "PARTIAL") return { tone: "warning", text: "จ่ายบางส่วน" };
  return { tone: "neutral", text: "ค้างจ่าย" };
}

export default async function SalesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const range = RANGES.some((r) => r.key === sp.range) ? sp.range! : "year";
  const view = sp.view === "invoices" ? "invoices" : "customers";
  const state = (["ALL", "UNPAID", "PARTIAL", "PAID", "OVERDUE"].includes(sp.state ?? "") ? sp.state : "ALL") as
    | PaymentState | "OVERDUE" | "ALL";
  const q = sp.q ?? "";

  const { from, to } = rangeToDates(range);
  const data = await getSalesData(user.orgId, { from, to, state, q });
  const { overview, byCustomer, invoices, lastSyncedAt } = data;

  const configured = salesSyncConfigured();
  const hasData = lastSyncedAt != null;
  const stale = hasData && Date.now() - new Date(lastSyncedAt).getTime() > 6 * 60 * 60 * 1000;

  // สร้าง href คงค่าอื่นไว้
  const qs = (patch: Partial<SP>) => {
    const merged = { range, view, state, q, ...patch };
    const p = new URLSearchParams();
    if (merged.range && merged.range !== "year") p.set("range", merged.range);
    if (merged.view && merged.view !== "customers") p.set("view", merged.view);
    if (merged.state && merged.state !== "ALL") p.set("state", merged.state);
    if (merged.q) p.set("q", merged.q);
    const s = p.toString();
    return `/fuelos/sales${s ? `?${s}` : ""}`;
  };

  return (
    <div>
      <PageHeader
        title="ยอดขาย / ลูกหนี้"
        subtitle={
          hasData
            ? `อัปเดตล่าสุด ${bkkRelative(lastSyncedAt!)} · ขายส่งน้ำมัน (TRCloud)`
            : "ดึงยอดขายจริงจาก TRCloud มาดูยอดขาย + ใครค้างจ่าย"
        }
        actions={
          <div className="flex items-center gap-2">
            <AutoRefresh stale={stale} />
            <SyncButton />
          </div>
        }
      />

      {!configured && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="size-4 mt-0.5 shrink-0" />
          <div>
            ยังไม่ได้ตั้งค่ากุญแจ TRCloud บริษัท 44 บนเซิร์ฟเวอร์ — ต้องใส่ env{" "}
            <code className="text-xs">FUELOS_TRCLOUD_SALES_COMPANY_ID / PASSKEY / ENCRYPT_HEAD</code> ใน Vercel ก่อนถึงจะดึงข้อมูลได้
          </div>
        </div>
      )}

      {!hasData ? (
        <div className="rounded-2xl border border-border bg-surface px-6 py-12 text-center">
          <Database className="size-8 mx-auto text-zinc-300" />
          <p className="mt-3 text-base font-medium text-zinc-700">ยังไม่มีข้อมูลยอดขาย</p>
          <p className="mt-1 text-sm text-zinc-500">กดดึงครั้งแรกเพื่อนำใบกำกับภาษีจาก TRCloud (ขายส่งน้ำมัน) เข้ามา</p>
          <div className="mt-5 flex justify-center">
            <SyncButton label="ดึงข้อมูลครั้งแรก" />
          </div>
        </div>
      ) : (
        <>
          {/* KPI */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            <KpiTile icon={<Receipt className="size-4" />} label="ยอดขายรวม" value={formatBaht(overview.totalSales)} accent="brand" isMoney
              sub={`${formatNumber(overview.invoiceCount)} ใบ · ${formatNumber(overview.customerCount)} ราย`} />
            <KpiTile icon={<Wallet className="size-4" />} label="รับชำระแล้ว" value={formatBaht(overview.totalPaid)} accent="success" isMoney />
            <KpiTile icon={<Clock className="size-4" />} label="ค้างชำระ" value={formatBaht(overview.totalOutstanding)} accent="warning" isMoney
              sub={`ค้าง ${formatNumber(overview.unpaidCount)} · บางส่วน ${formatNumber(overview.partialCount)}`} />
            <KpiTile icon={<AlertTriangle className="size-4" />} label="เกินกำหนด" value={formatBaht(overview.totalOverdue)} accent="danger" isMoney subDanger
              sub={overview.totalOverdue > 0 ? "ต้องตามเก็บ" : "ไม่มีเกินกำหนด"} />
          </div>

          {/* controls */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <div className="flex gap-1.5">
              {RANGES.map((r) => (
                <Link key={r.key} href={qs({ range: r.key })}
                  className={cn("px-3 h-9 rounded-lg text-sm font-medium inline-flex items-center", range === r.key ? "bg-zinc-900 text-white" : "bg-surface border border-border text-zinc-600")}>
                  {r.label}
                </Link>
              ))}
            </div>
            <div className="flex gap-1.5 ml-1">
              <Link href={qs({ view: "customers" })}
                className={cn("px-3 h-9 rounded-lg text-sm font-medium inline-flex items-center gap-1.5", view === "customers" ? "bg-brand-600 text-white" : "bg-surface border border-border text-zinc-600")}>
                <Users className="size-4" /> รายลูกค้า
              </Link>
              <Link href={qs({ view: "invoices" })}
                className={cn("px-3 h-9 rounded-lg text-sm font-medium inline-flex items-center gap-1.5", view === "invoices" ? "bg-brand-600 text-white" : "bg-surface border border-border text-zinc-600")}>
                <FileText className="size-4" /> รายใบ
              </Link>
            </div>
            <form className="ml-auto relative" action="/fuelos/sales">
              <input type="hidden" name="range" value={range} />
              <input type="hidden" name="view" value={view} />
              <input type="hidden" name="state" value={state} />
              <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input name="q" defaultValue={q} placeholder="ค้นหาลูกค้า / เลขใบ…"
                className="h-9 w-48 sm:w-64 rounded-lg border border-border bg-surface pl-9 pr-3 text-sm" />
            </form>
          </div>

          {view === "customers" ? (
            <CustomerTable rows={byCustomer} />
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {STATES.map((s) => (
                  <Link key={s.key} href={qs({ state: s.key })}
                    className={cn("px-3 h-8 rounded-full text-xs font-medium inline-flex items-center border", state === s.key ? "bg-zinc-900 text-white border-zinc-900" : "bg-surface border-border text-zinc-600")}>
                    {s.label}
                  </Link>
                ))}
              </div>
              <InvoiceTable rows={invoices} />
            </>
          )}
        </>
      )}
    </div>
  );
}

function CustomerTable({ rows }: { rows: Awaited<ReturnType<typeof getSalesData>>["byCustomer"] }) {
  if (rows.length === 0) return <Empty text="ไม่พบลูกค้าในช่วงนี้" />;
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-zinc-500 border-b border-border">
            <th className="px-4 py-2.5 font-medium">ลูกค้า</th>
            <th className="px-4 py-2.5 font-medium text-right">ยอดขาย</th>
            <th className="px-4 py-2.5 font-medium text-right">จ่ายแล้ว</th>
            <th className="px-4 py-2.5 font-medium text-right">ค้างชำระ</th>
            <th className="px-4 py-2.5 font-medium text-right">เกินกำหนด</th>
            <th className="px-4 py-2.5 font-medium text-right">ใบ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.key} className="border-b border-border/60 last:border-0 hover:bg-zinc-50/60">
              <td className="px-4 py-2.5">
                <div className="font-medium text-zinc-800">{c.org || c.name}</div>
                {c.org && c.name !== c.org && <div className="text-xs text-zinc-400">{c.name}</div>}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums">{formatBaht(c.totalSales)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-emerald-600">{formatBaht(c.paid)}</td>
              <td className={cn("px-4 py-2.5 text-right tabular-nums font-medium", c.outstanding > 0 ? "text-amber-600" : "text-zinc-400")}>{formatBaht(c.outstanding)}</td>
              <td className={cn("px-4 py-2.5 text-right tabular-nums", c.overdue > 0 ? "text-red-600 font-medium" : "text-zinc-300")}>{c.overdue > 0 ? formatBaht(c.overdue) : "—"}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-zinc-500">{c.invoiceCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InvoiceTable({ rows }: { rows: Awaited<ReturnType<typeof getSalesData>>["invoices"] }) {
  if (rows.length === 0) return <Empty text="ไม่พบใบกำกับภาษีตามเงื่อนไข" />;
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-zinc-500 border-b border-border">
            <th className="px-4 py-2.5 font-medium">เลขที่ / ลูกค้า</th>
            <th className="px-4 py-2.5 font-medium">วันที่</th>
            <th className="px-4 py-2.5 font-medium text-right">ยอด</th>
            <th className="px-4 py-2.5 font-medium text-right">จ่ายแล้ว</th>
            <th className="px-4 py-2.5 font-medium text-right">ค้าง</th>
            <th className="px-4 py-2.5 font-medium">สถานะ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const st = stateLabel(r.paymentState);
            return (
              <tr key={r.id} className="border-b border-border/60 last:border-0 hover:bg-zinc-50/60">
                <td className="px-4 py-2.5">
                  <div className="font-medium text-zinc-700">{r.docNo}</div>
                  <div className="text-xs text-zinc-500">{r.customerOrg || r.customerName}</div>
                </td>
                <td className="px-4 py-2.5 text-zinc-600 whitespace-nowrap">
                  {bkkDate(r.issueDate)}
                  {r.dueDate && <div className="text-xs text-zinc-400">ครบ {bkkDate(r.dueDate)}</div>}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatBaht(r.grandTotal)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-emerald-600">{r.paidAmount > 0 ? formatBaht(r.paidAmount) : "—"}</td>
                <td className={cn("px-4 py-2.5 text-right tabular-nums font-medium", r.outstanding > 0 ? "text-amber-600" : "text-zinc-300")}>{r.outstanding > 0 ? formatBaht(r.outstanding) : "—"}</td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-1.5">
                    <StatusPill tone={st.tone}>{st.text}</StatusPill>
                    {r.isOverdue && <StatusPill tone="danger">เกิน {r.overdueDays} วัน</StatusPill>}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-xl border border-border bg-surface px-6 py-10 text-center text-sm text-zinc-500">{text}</div>;
}
