import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/fuelos/auth";
import { getCustomer } from "@/lib/fuelos/customers-data";
import { formatBaht, formatNumber, bkkDate, bkkRelative } from "@/lib/fuelos/utils/format";
import { cn } from "@/lib/fuelos/utils/cn";
import { CustomerEditor } from "./customer-actions";
import { ArrowLeft, AlertTriangle, TrendingUp, Wallet, CalendarClock, FileText, ClipboardList, MessageSquare } from "lucide-react";

const ORDER_STATUS: Record<string, { label: string; tone: string }> = {
  AWAITING_CONFIRM: { label: "รอจัดส่ง", tone: "bg-surface-2 text-zinc-600" },
  DELIVERING: { label: "กำลังส่ง", tone: "bg-info/10 text-info" },
  DELIVERED_UNPAID: { label: "ส่งแล้ว/รอเก็บเงิน", tone: "bg-warning/15 text-warning" },
  CLOSED: { label: "ปิดบิล", tone: "bg-leaf-100 text-leaf-700" },
  CANCELLED: { label: "ยกเลิก", tone: "bg-danger/10 text-danger" },
};

export default async function CustomerDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const data = await getCustomer(user.orgId, id);
  if (!data) notFound();
  const { customer: c, health, timeline } = data;
  const creditLimit = c.creditLimit ? Number(c.creditLimit) : null;
  const creditUsed = Number(c.creditUsed);
  const pct = creditLimit ? Math.min(100, Math.round((creditUsed / creditLimit) * 100)) : 0;
  const convId = c.conversations[0]?.id;

  return (
    <div>
      <Link href="/fuelos/customers" className="inline-flex items-center gap-1 text-sm text-zinc-500 mb-3"><ArrowLeft className="size-4" /> ลูกค้าทั้งหมด</Link>

      {/* header */}
      <div className="rounded-2xl border border-border bg-surface p-5 mb-3">
        <div className="flex items-start gap-4">
          <div className="size-14 rounded-2xl bg-brand-100 text-brand-700 grid place-items-center text-xl font-bold shrink-0">{c.name.slice(0, 1)}</div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold">{c.name}</h1>
            <div className="text-sm text-zinc-500 mt-0.5">{c.legalName ?? "—"}</div>
            <div className="text-sm text-zinc-500">{c.zone ? `โซน ${c.zone}` : ""}{c.phone ? ` · ${c.phone}` : ""} · ดูแลโดย {c.assignedSales?.name ?? "—"}</div>
          </div>
          {convId && <Link href={`/inbox?c=${convId}`} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border text-sm shrink-0"><MessageSquare className="size-4" /> แชท</Link>}
        </div>
        {creditLimit != null && (
          <div className="mt-4">
            <div className="flex justify-between text-xs mb-1"><span className="text-zinc-500">วงเงินเครดิตใช้ไป</span><span className="font-medium">{formatBaht(creditUsed)} / {formatBaht(creditLimit)}</span></div>
            <div className="h-2 rounded-full bg-surface-2 overflow-hidden"><div className={cn("h-full", pct > 90 ? "bg-danger" : pct > 70 ? "bg-warning" : "bg-leaf-500")} style={{ width: `${pct}%` }} /></div>
          </div>
        )}
      </div>

      {/* overdue alert */}
      {health.overdue && (
        <div className="rounded-2xl border border-warning/30 bg-warning/10 p-4 mb-3 flex items-start gap-3">
          <AlertTriangle className="size-5 text-warning shrink-0 mt-0.5" />
          <div className="text-sm">
            <b>เกินรอบซื้อ {health.daysSinceOrder} วัน</b> (ปกติทุก {c.normalCadenceDays} วัน) — ควรติดตามก่อนลูกค้าไปซื้อเจ้าอื่น
          </div>
        </div>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
        <Kpi icon={TrendingUp} label="ยอดเดือนนี้" value={`${formatNumber(health.monthLiters)} ล.`} sub={`เฉลี่ย ${formatNumber(health.avgMonthly)} ล./ด.`} />
        <Kpi icon={Wallet} label="กำไรเฉลี่ย/ออเดอร์" value={formatBaht(health.avgMargin)} />
        <Kpi icon={CalendarClock} label="ซื้อล่าสุด" value={c.lastOrderAt ? bkkRelative(c.lastOrderAt) : "—"} sub={c.normalCadenceDays ? `รอบ ${c.normalCadenceDays} วัน` : undefined} />
        <Kpi icon={ClipboardList} label="ออเดอร์ทั้งหมด" value={`${timeline.length}`} />
      </div>

      <div className="grid lg:grid-cols-[1fr_360px] gap-3">
        {/* left: timeline + orders + quotes */}
        <div className="space-y-3">
          <Section title="ไทม์ไลน์การซื้อ" icon={ClipboardList}>
            {timeline.length === 0 ? <Empty>ยังไม่มีออเดอร์</Empty> : (
              <div className="space-y-1.5">
                {timeline.map((t, i) => (
                  <div key={i} className="flex items-center gap-3 text-sm">
                    <div className="size-2 rounded-full bg-brand-500 shrink-0" />
                    <span className="text-zinc-500 w-24 shrink-0">{bkkDate(t.date)}</span>
                    <span className="font-medium tabular-nums">{formatNumber(t.liters)} ล.</span>
                    <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full ml-auto", ORDER_STATUS[t.status]?.tone)}>{ORDER_STATUS[t.status]?.label}</span>
                    <span className="text-leaf-700 tabular-nums w-20 text-right">{formatBaht(t.profit)}</span>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title="ใบเสนอราคาล่าสุด" icon={FileText}>
            {c.quotes.length === 0 ? <Empty>ยังไม่มีใบเสนอราคา</Empty> : (
              <div className="space-y-1.5">
                {c.quotes.map((q) => (
                  <Link key={q.id} href={`/fuelos/quotes/${q.id}`} className="flex items-center justify-between text-sm hover:text-brand-700">
                    <span>{q.quoteNo} · {bkkDate(q.quoteDate)}</span>
                    <span className="tabular-nums">{formatBaht(Number(q.subtotal))}</span>
                  </Link>
                ))}
              </div>
            )}
          </Section>

          <Section title="การชำระเงิน / เช็ค" icon={Wallet}>
            {c.payments.length === 0 && c.cheques.length === 0 ? <Empty>ไม่มีรายการ</Empty> : (
              <div className="space-y-1.5 text-sm">
                {c.payments.map((p) => (
                  <div key={p.id} className="flex justify-between"><span>{bkkDate(p.paymentDate)} · {p.method}</span><span className="tabular-nums">{formatBaht(Number(p.amount))} <span className="text-[10px] text-zinc-400">{p.status}</span></span></div>
                ))}
                {c.cheques.map((ch) => (
                  <div key={ch.id} className="flex justify-between text-zinc-600"><span>เช็ค {ch.chequeNumber} · ครบ {bkkDate(ch.dueDate)}</span><span className="tabular-nums">{formatBaht(Number(ch.amount))} <span className="text-[10px]">{ch.status}</span></span></div>
                ))}
              </div>
            )}
          </Section>
        </div>

        {/* right: editor */}
        <CustomerEditor
          id={c.id}
          initialNotes={c.notes ?? ""}
          initialCadence={c.normalCadenceDays}
          followUps={c.followUps.map((f) => ({ id: f.id, note: f.note, dueDate: f.dueDate.toISOString(), kind: f.kind }))}
        />
      </div>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, sub }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <Icon className="size-4 text-brand-600 mb-2" />
      <div className="text-lg font-bold tabular-nums">{value}</div>
      <div className="text-[11px] text-zinc-500">{label}</div>
      {sub && <div className="text-[10px] text-zinc-400 mt-0.5">{sub}</div>}
    </div>
  );
}
function Section({ title, icon: Icon, children }: { title: string; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-center gap-2 mb-3 text-sm font-semibold"><Icon className="size-4 text-zinc-400" /> {title}</div>
      {children}
    </div>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-xs text-zinc-400">{children}</div>;
}
