// Playland · รายงานเจ้าของ (P&L) — หน้าเต็มแบบ Excel: ตารางรายวัน + แถวรวม + การ์ดสรุป + จัดการต้นทุน
// แยกเป็นหน้าของตัวเอง (ไม่ใช่ toggle ใน /reports) · ค่าเริ่มต้น = เดือนนี้ (1 → วันนี้) เพื่อให้เห็นตารางหลายวัน
import { requireSession } from "@/lib/auth/session";
import { requirePlaylandManager } from "@/lib/playland/role-guard";
import { prisma } from "@/lib/prisma";
import { getBranchContext } from "@/lib/playland/branch-context";
import { thb, fmtDate } from "@/lib/playland/format";
import { BranchSwitcher } from "@/components/playland/branch-switcher";
import { OwnerReportPanel, type ExpenseRow } from "@/components/playland/reports/owner-report-panel";
import { OwnerReportCsvButton, type CsvDayRow } from "@/components/playland/reports/owner-report-csv-button";
import { Wallet, TrendingUp, TrendingDown, Users, Target, ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "รายงานเจ้าของ · Play a lot" };

const INK = "#3A3026", MUTED = "#8a7f70", BLUE = "#2D6CB1", AMBER = "#a9791a", GREEN = "#1F8A5B", RED = "#E74C3C", LINE = "#ece5d8";
const MONO = "'IBM Plex Mono', var(--font-plex-mono), ui-monospace, monospace";
const FREDOKA = "var(--font-fredoka), 'Fredoka', sans-serif";
const MITR = "var(--font-mitr), 'Mitr', sans-serif";
const card: React.CSSProperties = { background: "#fff", border: `1px solid ${LINE}`, borderRadius: 16, boxShadow: "0 1px 3px rgba(58,48,38,.05)" };

// ── helpers (เขตเวลา local) ──
const fmtD = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dayKey = fmtD;
const dateOnly = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const daysInMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();

// แปลง YYYY-MM-DD → ป้ายไทยสั้น (วว/ดด)
const shortLabel = (key: string) => key.slice(5).replace("-", "/");

type ExpenseLite = { id: string; kind: string; label: string | null; amountCents: number; staffCount: number | null; period: string; expenseDate: Date };

// ── แยก "ขนม" (ของกิน/ดื่ม/สิ้นเปลือง) vs "ของ" (ของเล่น/สินค้าทั่วไป) จาก category หรือชื่อสินค้า ──
const SNACK_KEYWORDS = ["ขนม", "เครื่องดื่ม", "น้ำ", "นม", "ไอศ", "ไอติม", "อาหาร", "ลูกอม", "ช็อก", "คุกกี้", "เวเฟอร์", "มันฝรั่ง", "เลย์", "ป๊อป", "ขนน", "snack", "drink", "food", "ice"];
function isSnack(category: string | null | undefined, name: string | null | undefined): boolean {
  const hay = `${category ?? ""} ${name ?? ""}`.toLowerCase();
  return SNACK_KEYWORDS.some((kw) => hay.includes(kw.toLowerCase()));
}

// คิดต้นทุนที่ตกในวัน D (เฉลี่ยหารต่อวัน): once → เต็มถ้า expenseDate==D · monthly → amount / daysInMonth(D)
function costForDay(dKey: string, expenses: ExpenseLite[]): number {
  let cost = 0;
  for (const ex of expenses) {
    const ed = new Date(ex.expenseDate);
    if (ex.period === "monthly") {
      if (ed.getFullYear() === Number(dKey.slice(0, 4)) && (ed.getMonth() + 1) === Number(dKey.slice(5, 7))) {
        cost += Math.round(ex.amountCents / (daysInMonth(ed) || 1));
      }
    } else {
      if (dayKey(ed) === dKey) cost += ex.amountCents;
    }
  }
  return cost;
}

export default async function OwnerReportPage({ searchParams }: { searchParams: Promise<{ branch?: string; from?: string; to?: string; mode?: string }> }) {
  const sp = await searchParams;
  const session = await requireSession();
  requirePlaylandManager(session.user.role); // รายงานเจ้าของ = ผู้จัดการ/เจ้าของขึ้นไป
  const orgId = session.user.org_id;
  const { branches, activeId } = await getBranchContext(orgId, sp.branch);
  const branchId = activeId ?? "";
  const branchName = branches.find((b) => b.id === branchId)?.name ?? "ทุกสาขา";

  // โหมดตาราง: "min" = ย่อ (เน้นยอดขาย ไม่มีต้นทุน/กำไร) · "full" = ขยาย (P&L เต็ม · ค่าเริ่มต้น)
  const mode: "min" | "full" = sp.mode === "min" ? "min" : "full";

  // ── ช่วงวันที่: ค่าเริ่มต้น = เดือนนี้ (วันที่ 1 → วันนี้) เพื่อให้ตาราง Excel มีหลายแถว ──
  const today = new Date(); today.setHours(23, 59, 59, 999);
  const to = sp.to ? new Date(sp.to) : today;
  to.setHours(23, 59, 59, 999);
  const from = sp.from ? new Date(sp.from) : new Date(to.getFullYear(), to.getMonth(), 1);
  from.setHours(0, 0, 0, 0);
  const fromDay = dateOnly(from), toDay = dateOnly(to);

  // จำนวนวันในช่วง (รวมหัวท้าย)
  const numDays = Math.max(1, Math.round((toDay - fromDay) / 86_400_000) + 1);

  // ── ช่วงก่อนหน้า (ยาวเท่ากัน อยู่ติดก่อน from) สำหรับ "เทียบช่วงก่อน" ──
  const prevTo = new Date(from); prevTo.setDate(prevTo.getDate() - 1); prevTo.setHours(23, 59, 59, 999);
  const prevFrom = new Date(prevTo); prevFrom.setDate(prevFrom.getDate() - (numDays - 1)); prevFrom.setHours(0, 0, 0, 0);

  const saleWhere = (g: Date, l: Date) => ({ orgId, soldAt: { gte: g, lte: l }, voidedAt: null, ...(branchId ? { branchId } : {}) });

  // โหลดต้นทุน: ครอบทั้งเดือนที่คาบช่วง [prevFrom, to] เพื่อให้เฉลี่ยรายเดือนถูกต้องทุกวัน
  const expStartMonth = new Date(prevFrom.getFullYear(), prevFrom.getMonth(), 1, 0, 0, 0, 0);
  const expEndMonth = new Date(to.getFullYear(), to.getMonth() + 1, 0, 23, 59, 59, 999);

  const [sales, saleLines, sessions, prevSales, expensesAll] = await Promise.all([
    prisma.playlandSale.findMany({
      where: saleWhere(from, to),
      select: { totalCents: true, soldAt: true, paymentMethod: true, _count: { select: { lines: true } } },
    }),
    // sale lines (สินค้าที่ขายจริง) ใช้แยก ขนม vs ของ ต่อวัน — กรองผ่าน sale ให้ตรงกับ saleWhere (ไม่เอา voided)
    prisma.playlandSaleLine.findMany({
      where: { sale: saleWhere(from, to) },
      select: { lineCents: true, productName: true, product: { select: { category: true, name: true } }, sale: { select: { soldAt: true } } },
    }),
    prisma.playlandSession.findMany({
      where: { orgId, checkInAt: { gte: from, lte: to }, ...(branchId ? { branchId } : {}) },
      select: { memberId: true, checkInAt: true, member: { select: { type: true, createdAt: true } } },
    }),
    // ช่วงก่อน: เอาแค่ยอด+วัน → ไว้เทียบ revenue/profit
    prisma.playlandSale.findMany({
      where: saleWhere(prevFrom, prevTo),
      select: { totalCents: true, soldAt: true },
    }),
    prisma.playlandDailyExpense.findMany({
      where: { orgId, ...(branchId ? { branchId } : {}), expenseDate: { gte: expStartMonth, lte: expEndMonth } },
      select: { id: true, kind: true, label: true, amountCents: true, staffCount: true, period: true, expenseDate: true },
      orderBy: { expenseDate: "desc" },
    }),
  ]);

  const isProduct = (s: { _count: { lines: number } }) => s._count.lines > 0;

  // ── per-วัน: เงิน + คน ──
  type DayMoney = { entry: number; product: number; cash: number; transfer: number; bills: number };
  const dayMoney = new Map<string, DayMoney>();
  for (const s of sales) {
    const k = dayKey(new Date(s.soldAt));
    const x = dayMoney.get(k) ?? { entry: 0, product: 0, cash: 0, transfer: 0, bills: 0 };
    if (isProduct(s)) x.product += s.totalCents; else x.entry += s.totalCents;
    if (s.paymentMethod === "CASH") x.cash += s.totalCents; else x.transfer += s.totalCents;
    x.bills += 1;
    dayMoney.set(k, x);
  }
  // ── per-วัน: แยกยอดสินค้าออกเป็น ขนม vs ของ จาก sale lines ──
  type DaySplit = { snack: number; goods: number };
  const daySplit = new Map<string, DaySplit>();
  for (const l of saleLines) {
    const k = dayKey(new Date(l.sale.soldAt));
    const x = daySplit.get(k) ?? { snack: 0, goods: 0 };
    if (isSnack(l.product?.category, l.product?.name ?? l.productName)) x.snack += l.lineCents;
    else x.goods += l.lineCents;
    daySplit.set(k, x);
  }

  // คนต่อวัน (distinct memberId) + เด็ก/ผู้ใหญ่ + ใหม่/เก่า (createdAt อยู่ในช่วง = ใหม่)
  type DayPeople = { all: Set<string>; kids: Set<string>; adults: Set<string>; newC: Set<string>; retC: Set<string> };
  const dayPeople = new Map<string, DayPeople>();
  for (const s of sessions) {
    const k = dayKey(new Date(s.checkInAt));
    const p = dayPeople.get(k) ?? { all: new Set(), kids: new Set(), adults: new Set(), newC: new Set(), retC: new Set() };
    p.all.add(s.memberId);
    if (s.member?.type === "KID") p.kids.add(s.memberId);
    else if (s.member?.type === "PARENT") p.adults.add(s.memberId);
    const created = s.member?.createdAt ? dateOnly(new Date(s.member.createdAt)) : null;
    if (created != null && created >= fromDay && created <= toDay) p.newC.add(s.memberId);
    else p.retC.add(s.memberId);
    dayPeople.set(k, p);
  }

  const expenses = expensesAll as ExpenseLite[];

  // ── สร้างทุกวันใน [from,to] (รวมวันที่ยอด 0) ──
  type Row = {
    day: string; revenue: number; entry: number; product: number; snack: number; goods: number; cash: number; transfer: number;
    customers: number; newCustomers: number; returningCustomers: number; kids: number; adults: number;
    cost: number; profit: number; marginPct: number; avgBill: number; bills: number;
  };
  const rows: Row[] = [];
  for (let t = fromDay; t <= toDay; t += 86_400_000) {
    const d = new Date(t);
    const k = dayKey(d);
    const m = dayMoney.get(k) ?? { entry: 0, product: 0, cash: 0, transfer: 0, bills: 0 };
    const p = dayPeople.get(k);
    const revenue = m.entry + m.product;
    // ขนม/ของ จาก lines · reconcile: ถ้ายอดสินค้าของวันนั้นมีส่วนที่ไม่มี line รองรับ → โยนส่วนต่างเข้า "ของ" เพื่อให้ ขนม+ของ = product
    const sp_ = daySplit.get(k) ?? { snack: 0, goods: 0 };
    const snack = sp_.snack;
    const goods = Math.max(0, m.product - snack); // ของ = ยอดสินค้าทั้งหมด − ขนม (กลืนส่วนต่างที่ line ไม่ครอบคลุม)
    const cost = costForDay(k, expenses); // ต้นทุนเฉลี่ยที่ตกในวันนี้ (รายเดือนยังคิดแม้ขายได้ 0 → กำไรติดลบ = ถูกต้อง)
    const profit = revenue - cost;
    rows.push({
      day: k, revenue, entry: m.entry, product: m.product, snack, goods, cash: m.cash, transfer: m.transfer,
      customers: p?.all.size ?? 0, newCustomers: p?.newC.size ?? 0, returningCustomers: p?.retC.size ?? 0,
      kids: p?.kids.size ?? 0, adults: p?.adults.size ?? 0,
      cost, profit, marginPct: revenue > 0 ? (profit / revenue) * 100 : 0,
      avgBill: m.bills > 0 ? Math.round(revenue / m.bills) : 0, bills: m.bills,
    });
  }

  // ── แถวรวม ──
  const tot = rows.reduce(
    (a, r) => ({
      revenue: a.revenue + r.revenue, entry: a.entry + r.entry, product: a.product + r.product,
      snack: a.snack + r.snack, goods: a.goods + r.goods,
      cash: a.cash + r.cash, transfer: a.transfer + r.transfer, customers: a.customers + r.customers,
      newCustomers: a.newCustomers + r.newCustomers, returningCustomers: a.returningCustomers + r.returningCustomers,
      kids: a.kids + r.kids, adults: a.adults + r.adults, cost: a.cost + r.cost, profit: a.profit + r.profit, bills: a.bills + r.bills,
    }),
    { revenue: 0, entry: 0, product: 0, snack: 0, goods: 0, cash: 0, transfer: 0, customers: 0, newCustomers: 0, returningCustomers: 0, kids: 0, adults: 0, cost: 0, profit: 0, bills: 0 },
  );
  // ลูกค้า distinct ทั้งช่วง (ไม่ใช่ผลรวมรายวัน เพราะคนเดิมมาหลายวัน)
  const allMembers = new Set<string>(), newMembers = new Set<string>();
  for (const s of sessions) {
    allMembers.add(s.memberId);
    const created = s.member?.createdAt ? dateOnly(new Date(s.member.createdAt)) : null;
    if (created != null && created >= fromDay && created <= toDay) newMembers.add(s.memberId);
  }
  const customersTotal = allMembers.size;
  const customersNew = newMembers.size;
  const customersReturning = Math.max(0, customersTotal - customersNew);

  const totalRevenue = tot.revenue;
  const totalExpense = tot.cost;
  const profit = totalRevenue - totalExpense;
  const margin = totalRevenue > 0 ? (profit / totalRevenue) * 100 : 0;
  const totalMarginPct = margin;
  const totalAvgBill = tot.bills > 0 ? Math.round(totalRevenue / tot.bills) : 0;

  // ── จุดคุ้มทุน/วัน = ต้นทุนเฉลี่ยต่อวันในช่วง ──
  const breakEvenPerDay = Math.round(totalExpense / numDays);
  // ── กำไรต่อหัวลูกค้า ──
  const profitPerCustomer = customersTotal > 0 ? Math.round(profit / customersTotal) : 0;

  // ── เทียบช่วงก่อน: revenue + profit ──
  const prevFromDay = dateOnly(prevFrom), prevToDay = dateOnly(prevTo);
  const prevRevenue = prevSales.reduce((m, s) => m + s.totalCents, 0);
  // ต้นทุนช่วงก่อน = ผลรวม costForDay ของทุกวันใน [prevFrom, prevTo]
  let prevExpense = 0;
  for (let t = prevFromDay; t <= prevToDay; t += 86_400_000) prevExpense += costForDay(dayKey(new Date(t)), expenses);
  const prevProfit = prevRevenue - prevExpense;
  const hasPrev = prevSales.length > 0 || prevExpense > 0;
  const pctChange = (cur: number, prev: number): number | null => (prev === 0 ? null : ((cur - prev) / Math.abs(prev)) * 100);
  const revChange = hasPrev ? pctChange(totalRevenue, prevRevenue) : null;
  const profitChange = hasPrev ? pctChange(profit, prevProfit) : null;

  // ── date presets (พก branch ไปด้วย) ──
  const _t = new Date(); _t.setHours(0, 0, 0, 0);
  const _m1 = new Date(_t.getFullYear(), _t.getMonth(), 1);
  const _lastM1 = new Date(_t.getFullYear(), _t.getMonth() - 1, 1);
  const _lastMEnd = new Date(_t.getFullYear(), _t.getMonth(), 0);
  const _bq = branchId ? `&branch=${branchId}` : "";
  const _mq = mode === "min" ? "&mode=min" : ""; // พก mode ไปด้วย (full = default ไม่ต้องใส่)
  const datePresets = [
    { label: "วันนี้", href: `?from=${fmtD(_t)}&to=${fmtD(_t)}${_bq}${_mq}` },
    { label: "เดือนนี้", href: `?from=${fmtD(_m1)}&to=${fmtD(_t)}${_bq}${_mq}` },
    { label: "เดือนก่อน", href: `?from=${fmtD(_lastM1)}&to=${fmtD(_lastMEnd)}${_bq}${_mq}` },
  ];
  // ── chip ย่อ/ขยาย (พก from/to/branch ไปด้วย) ──
  const _rangeQ = `from=${fmtD(from)}&to=${fmtD(to)}${_bq}`;
  const minHref = `?${_rangeQ}&mode=min`;
  const fullHref = `?${_rangeQ}&mode=full`;

  // expense rows สำหรับ panel (allocated ในช่วง = ผลรวม costForDay เฉพาะวันที่อยู่ใน [from,to])
  const expenseRows: ExpenseRow[] = expenses
    .map((ex) => {
      let allocated = 0;
      const ed = new Date(ex.expenseDate);
      if (ex.period === "monthly") {
        const dim = daysInMonth(ed) || 1;
        for (let t = fromDay; t <= toDay; t += 86_400_000) {
          const d = new Date(t);
          if (d.getFullYear() === ed.getFullYear() && d.getMonth() === ed.getMonth()) allocated += Math.round(ex.amountCents / dim);
        }
      } else {
        const edDay = dateOnly(ed);
        allocated = edDay >= fromDay && edDay <= toDay ? ex.amountCents : 0;
      }
      return { ex, allocated };
    })
    .filter(({ allocated }) => allocated > 0)
    .map(({ ex, allocated }) => ({
      id: ex.id, kind: ex.kind, label: ex.label, amountCents: ex.amountCents,
      allocatedCents: allocated, staffCount: ex.staffCount, period: ex.period === "monthly" ? "monthly" : "once",
    }));

  const csvRows: CsvDayRow[] = rows.map((r) => ({
    day: r.day, revenue: r.revenue, entry: r.entry, product: r.product, snack: r.snack, goods: r.goods, cash: r.cash, transfer: r.transfer,
    customers: r.customers, newCustomers: r.newCustomers, returningCustomers: r.returningCustomers,
    kids: r.kids, adults: r.adults, cost: r.cost, profit: r.profit, marginPct: r.marginPct, avgBill: r.avgBill, bills: r.bills,
  }));

  const subtitle = `${fmtDate(from)} – ${fmtDate(to)} · ${branchName} · ${numDays} วัน`;
  const backQ = `?from=${fmtD(from)}&to=${fmtD(to)}${_bq}`;

  return (
    <div className="pl-scroll" style={{ background: "#fbfbf9", fontFamily: MITR, color: INK }}>
      {/* header strip */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 28px", background: "#fff", borderBottom: `1px solid ${LINE}`, flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <Wallet size={20} color={BLUE} />
            <div style={{ fontWeight: 600, fontSize: "1.35rem", fontFamily: FREDOKA }}>รายงานเจ้าของ · กำไร-ขาดทุน</div>
          </div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>{subtitle}</div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
          {datePresets.map((p) => (
            <a key={p.label} href={p.href} style={{ fontSize: 12.5, fontWeight: 600, color: BLUE, background: "#eaf3f6", borderRadius: 8, padding: "7px 12px", textDecoration: "none" }}>{p.label}</a>
          ))}
        </div>
        <form style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {branchId && <input type="hidden" name="branch" value={branchId} />}
          <input type="date" name="from" defaultValue={fmtD(from)} style={dateInput} />
          <input type="date" name="to" defaultValue={fmtD(to)} style={dateInput} />
          <button style={btn(false)}>ดู</button>
          <BranchSwitcher branches={branches} activeId={activeId} />
          <OwnerReportCsvButton rows={csvRows} from={fmtD(from)} to={fmtD(to)} branchName={branchName} mode={mode} />
        </form>
      </div>

      <div style={{ maxWidth: 1680, margin: "0 auto", padding: "18px 28px 44px" }}>
        {/* back link → /reports */}
        <a href={`/playland/reports${backQ}`} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: MUTED, textDecoration: "none", marginBottom: 14 }}>
          <ArrowLeft size={15} /> กลับไปหน้ารายงาน · ปิดวัน
        </a>

        {/* ════ KPI row ════ */}
        <div className="pl-kpi-row" style={{ marginBottom: 14 }}>
          {/* รายรับรวม */}
          <div style={{ ...card, padding: 18 }}>
            <div style={{ fontSize: 12, color: MUTED, marginBottom: 6 }}>รายรับรวม</div>
            <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 24, color: GREEN }}>{thb(totalRevenue)}</div>
            <div style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>{tot.bills} บิล</div>
          </div>
          {/* ต้นทุนรวม */}
          <div style={{ ...card, padding: 18 }}>
            <div style={{ fontSize: 12, color: MUTED, marginBottom: 6 }}>ต้นทุนรวม</div>
            <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 24, color: RED }}>{thb(totalExpense)}</div>
            <div style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>เฉลี่ยรายวันในช่วง</div>
          </div>
          {/* กำไรสุทธิ (hero) */}
          <div style={{ background: profit >= 0 ? GREEN : RED, borderRadius: 16, padding: 18, color: "#fff" }}>
            <div style={{ fontSize: 12, opacity: 0.9, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
              {profit >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />} กำไรสุทธิ
            </div>
            <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 26 }}>{profit < 0 ? "−" : ""}{thb(Math.abs(profit))}</div>
            <div style={{ fontSize: 12, opacity: 0.9, marginTop: 4 }}>มาร์จิน {margin.toFixed(1)}%</div>
          </div>
          {/* ลูกค้า */}
          <div style={{ ...card, padding: 18 }}>
            <div style={{ fontSize: 12, color: MUTED, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}><Users size={14} color={BLUE} /> ลูกค้า</div>
            <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 24 }}>{customersTotal}</div>
            <div style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>ใหม่ <strong style={{ color: GREEN }}>{customersNew}</strong> · เก่า <strong>{customersReturning}</strong></div>
          </div>
          {/* จุดคุ้มทุน/วัน */}
          <div style={{ ...card, padding: 18 }}>
            <div style={{ fontSize: 12, color: MUTED, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}><Target size={14} color={AMBER} /> จุดคุ้มทุน/วัน</div>
            <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 24, color: AMBER }}>{thb(breakEvenPerDay)}</div>
            <div style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>ต้องขายวันละ ≈ เท่านี้ถึงคุ้ม</div>
          </div>
          {/* กำไรต่อหัว */}
          <div style={{ ...card, padding: 18 }}>
            <div style={{ fontSize: 12, color: MUTED, marginBottom: 6 }}>กำไรต่อหัวลูกค้า</div>
            <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 24, color: profitPerCustomer >= 0 ? GREEN : RED }}>
              {profitPerCustomer < 0 ? "−" : ""}{thb(Math.abs(profitPerCustomer))}
            </div>
            <div style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>{customersTotal > 0 ? `จาก ${customersTotal} คน` : "ยังไม่มีลูกค้า"}</div>
          </div>
        </div>

        {/* ════ เทียบช่วงก่อน ════ */}
        <div style={{ ...card, padding: "14px 20px", marginBottom: 18, display: "flex", gap: 28, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ fontSize: 13, color: MUTED }}>
            เทียบช่วงก่อน <span style={{ fontFamily: MONO }}>({fmtDate(prevFrom)} – {fmtDate(prevTo)})</span>
          </div>
          <DeltaStat label="รายรับ" change={revChange} prevValue={prevRevenue} />
          <DeltaStat label="กำไร" change={profitChange} prevValue={prevProfit} />
        </div>

        {/* ════ HERO: ตาราง Excel รายวัน ════ */}
        <div style={{ ...card, padding: 0, overflow: "hidden", marginBottom: 18 }}>
          <div style={{ padding: "16px 22px", borderBottom: `1px solid ${LINE}`, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ fontWeight: 600, fontSize: 17, fontFamily: FREDOKA }}>{mode === "min" ? "ตารางยอดขาย รายวัน" : "ตารางกำไร-ขาดทุน รายวัน"}</div>
            <div style={{ fontSize: 12, color: MUTED }}>เลื่อนซ้าย-ขวาเพื่อดูทุกคอลัมน์ · แถวล่างสุด = รวมทั้งช่วง</div>
            {/* chip ย่อ/ขยาย */}
            <div style={{ display: "inline-flex", gap: 6, marginLeft: 4 }}>
              <a href={minHref} style={modeChip(mode === "min")} title="โหมดย่อ — เน้นยอดขาย ไม่มีต้นทุน/กำไร">ย่อ</a>
              <a href={fullHref} style={modeChip(mode === "full")} title="โหมดขยาย — กำไร-ขาดทุนเต็ม">ขยาย</a>
            </div>
            <div style={{ marginLeft: "auto" }}>
              <OwnerReportCsvButton rows={csvRows} from={fmtD(from)} to={fmtD(to)} branchName={branchName} mode={mode} />
            </div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", minWidth: mode === "min" ? 880 : 1320, borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr>
                  <th style={{ ...xth, ...xstickyL, textAlign: "left" }}>วันที่</th>
                  <th style={xth}>ยอดขายรวม</th>
                  <th style={xth}>ค่าเข้า·เวลา</th>
                  <th style={xth}>ขนม</th>
                  <th style={xth}>ของ</th>
                  {mode === "full" && <th style={xth}>เงินสด</th>}
                  {mode === "full" && <th style={xth}>เงินโอน</th>}
                  <th style={xth}>ลูกค้า</th>
                  {mode === "full" && <th style={xth}>ใหม่</th>}
                  {mode === "full" && <th style={xth}>เก่า</th>}
                  <th style={xth}>เด็ก</th>
                  <th style={xth}>ผู้ใหญ่</th>
                  <th style={xth}>บิล</th>
                  <th style={xth}>บิลเฉลี่ย</th>
                  {mode === "full" && <th style={xth}>ต้นทุน</th>}
                  {mode === "full" && <th style={xth}>กำไรสุทธิ</th>}
                  {mode === "full" && <th style={xth}>%</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const zebra = i % 2 === 1 ? "#fcfaf6" : "#fff";
                  const empty = r.revenue === 0 && r.customers === 0;
                  const dash = (v: React.ReactNode) => (empty ? <span style={{ color: "#cfc6b6" }}>—</span> : v);
                  return (
                    <tr key={r.day} style={{ background: zebra }}>
                      <td style={{ ...xtd, ...xstickyL, background: zebra, textAlign: "left", fontFamily: MONO, whiteSpace: "nowrap" }}>{shortLabel(r.day)}</td>
                      <td style={{ ...xtd, fontWeight: 600 }}>{dash(thb(r.revenue))}</td>
                      <td style={xtd}>{dash(thb(r.entry))}</td>
                      <td style={{ ...xtd, color: AMBER }}>{dash(thb(r.snack))}</td>
                      <td style={{ ...xtd, color: BLUE }}>{dash(thb(r.goods))}</td>
                      {mode === "full" && <td style={{ ...xtd, color: GREEN }}>{dash(thb(r.cash))}</td>}
                      {mode === "full" && <td style={{ ...xtd, color: BLUE }}>{dash(thb(r.transfer))}</td>}
                      <td style={xtd}>{dash(r.customers)}</td>
                      {mode === "full" && <td style={{ ...xtd, color: GREEN }}>{dash(r.newCustomers)}</td>}
                      {mode === "full" && <td style={xtd}>{dash(r.returningCustomers)}</td>}
                      <td style={{ ...xtd, color: AMBER }}>{dash(r.kids)}</td>
                      <td style={{ ...xtd, color: BLUE }}>{dash(r.adults)}</td>
                      <td style={xtd}>{r.bills > 0 ? r.bills : dash(0)}</td>
                      <td style={xtd}>{r.bills > 0 ? thb(r.avgBill) : "—"}</td>
                      {mode === "full" && <td style={{ ...xtd, color: RED }}>{r.cost > 0 ? thb(r.cost) : dash(thb(0))}</td>}
                      {mode === "full" && <td style={{ ...xtd, fontWeight: 700, color: r.profit >= 0 ? GREEN : RED }}>{r.profit < 0 ? "−" : ""}{thb(Math.abs(r.profit))}</td>}
                      {mode === "full" && <td style={{ ...xtd, color: r.profit >= 0 ? GREEN : RED }}>{r.revenue > 0 ? `${r.marginPct.toFixed(0)}%` : "—"}</td>}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: `2px solid ${INK}`, fontWeight: 700, background: "#f5f1e8" }}>
                  <td style={{ ...xtd, ...xstickyL, background: "#f5f1e8", textAlign: "left", fontFamily: FREDOKA }}>รวม</td>
                  <td style={{ ...xtd, fontFamily: MONO }}>{thb(tot.revenue)}</td>
                  <td style={{ ...xtd, fontFamily: MONO }}>{thb(tot.entry)}</td>
                  <td style={{ ...xtd, fontFamily: MONO, color: AMBER }}>{thb(tot.snack)}</td>
                  <td style={{ ...xtd, fontFamily: MONO, color: BLUE }}>{thb(tot.goods)}</td>
                  {mode === "full" && <td style={{ ...xtd, fontFamily: MONO, color: GREEN }}>{thb(tot.cash)}</td>}
                  {mode === "full" && <td style={{ ...xtd, fontFamily: MONO, color: BLUE }}>{thb(tot.transfer)}</td>}
                  <td style={{ ...xtd, fontFamily: MONO }}>{customersTotal}</td>
                  {mode === "full" && <td style={{ ...xtd, fontFamily: MONO, color: GREEN }}>{customersNew}</td>}
                  {mode === "full" && <td style={{ ...xtd, fontFamily: MONO }}>{customersReturning}</td>}
                  <td style={{ ...xtd, fontFamily: MONO, color: AMBER }}>{tot.kids}</td>
                  <td style={{ ...xtd, fontFamily: MONO, color: BLUE }}>{tot.adults}</td>
                  <td style={{ ...xtd, fontFamily: MONO }}>{tot.bills}</td>
                  <td style={{ ...xtd, fontFamily: MONO }}>{thb(totalAvgBill)}</td>
                  {mode === "full" && <td style={{ ...xtd, fontFamily: MONO, color: RED }}>{thb(tot.cost)}</td>}
                  {mode === "full" && <td style={{ ...xtd, fontFamily: MONO, color: profit >= 0 ? GREEN : RED }}>{profit < 0 ? "−" : ""}{thb(Math.abs(profit))}</td>}
                  {mode === "full" && <td style={{ ...xtd, fontFamily: MONO, color: profit >= 0 ? GREEN : RED }}>{totalMarginPct.toFixed(0)}%</td>}
                </tr>
              </tfoot>
            </table>
          </div>
          <div style={{ fontSize: 11, color: MUTED, padding: "10px 22px" }}>
            * ต้นทุนรายวัน = ค่าครั้งเดียวลงวันที่จ่าย + ค่ารายเดือนเฉลี่ยหารต่อวัน (ยอด/เดือน ÷ จำนวนวันในเดือน) → วันที่ขายไม่ได้แต่มีค่าเช่า กำไรจะติดลบ ซึ่งถูกต้อง · ลูกค้า ใหม่/เก่า รวม = นับหัวไม่ซ้ำทั้งช่วง (ไม่ใช่ผลบวกรายวัน)
          </div>
        </div>

        {/* ════ จัดการต้นทุน (reuse panel) ════ */}
        <div style={{ ...card, padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "16px 22px", borderBottom: `1px solid ${LINE}`, display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <div style={{ fontWeight: 600, fontSize: 17, fontFamily: FREDOKA }}>💸 จัดการต้นทุน</div>
            <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 20, color: RED }}>{thb(totalExpense)}</div>
          </div>
          <div style={{ padding: 22 }}>
            <OwnerReportPanel branchId={branchId} defaultDate={fmtD(to)} expenses={expenseRows} />
          </div>
        </div>
      </div>
    </div>
  );
}

// การ์ดเล็กแสดง % เปลี่ยนเทียบช่วงก่อน (▲ เขียว / ▼ แดง / — ไม่มีข้อมูล)
function DeltaStat({ label, change, prevValue }: { label: string; change: number | null; prevValue: number }) {
  const up = change != null && change >= 0;
  const color = change == null ? MUTED : up ? GREEN : RED;
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
      <span style={{ fontSize: 13, color: MUTED }}>{label}</span>
      {change == null ? (
        <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 16, color: MUTED }}>—</span>
      ) : (
        <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 16, color }}>
          {up ? "▲" : "▼"} {Math.abs(change).toFixed(0)}%
        </span>
      )}
      <span style={{ fontSize: 11.5, color: MUTED, fontFamily: MONO }}>(เดิม {thb(prevValue)})</span>
    </div>
  );
}

// chip ย่อ/ขยาย — active = น้ำเงินทึบขาว, inactive = ขอบบาง
function modeChip(active: boolean): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center", textDecoration: "none", borderRadius: 8,
    padding: "6px 14px", fontSize: 12.5, fontWeight: 600, fontFamily: MITR, cursor: "pointer",
    background: active ? BLUE : "#fff", color: active ? "#fff" : MUTED,
    border: active ? "none" : `1px solid ${LINE}`,
  };
}
const dateInput: React.CSSProperties = { border: `1px solid ${LINE}`, borderRadius: 9, padding: "7px 10px", fontSize: 13, fontFamily: MITR, color: INK, background: "#fff", outline: "none" };
function btn(primary: boolean): React.CSSProperties {
  return { display: "inline-flex", alignItems: "center", gap: 7, textDecoration: "none", borderRadius: 9, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer",
    background: primary ? BLUE : "#fff", color: primary ? "#fff" : MUTED, border: primary ? "none" : `1px solid ${LINE}` };
}
// Excel-like cells: เส้นบาง · header เทาทึบ sticky-top · ตัวเลขชิดขวา mono
const xth: React.CSSProperties = {
  position: "sticky", top: 0, zIndex: 2, background: "#f9f7f2", borderBottom: `1px solid ${LINE}`, borderRight: `1px solid #f2ebdd`,
  padding: "10px 12px", fontWeight: 600, fontSize: 12, color: INK, textAlign: "right", whiteSpace: "nowrap",
};
const xtd: React.CSSProperties = {
  padding: "8px 12px", borderRight: `1px solid #f2ebdd`, borderBottom: `1px solid #f2ebdd`,
  textAlign: "right", fontFamily: MONO, whiteSpace: "nowrap",
};
// วันที่ = sticky-left (เห็นวันที่ตลอดเวลา scroll แนวนอน)
const xstickyL: React.CSSProperties = { position: "sticky", left: 0, zIndex: 1, borderRight: `1px solid ${LINE}` };
