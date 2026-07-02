"use client";

import { useRouter } from "next/navigation";
import { Wallet, TrendingUp, Boxes, Coins, AlertTriangle, ShieldAlert, ShieldCheck, Monitor, ChevronRight, PackageOpen, Banknote } from "lucide-react";
import { Kpi, Card, Pill, AvgWinBar, IconBox, EmptyState } from "@/components/clawfleet/os/kit";
import { bahtN, num, deltaColor, pnlTone, avgWinMarkerPct, type PnlFlagKey, type Tone } from "@/components/clawfleet/os/format";

type BranchRow = {
  branchId: string; code: string; name: string; machines: number;
  dolls: number; revenue: number; profit: number; avgWin: number; flag: string;
};
type Alert = { title: string; detail: string; tag: string; tone: "red" | "amber" | "neutral" };
type DailyPoint = { d: string; iso: string; profit: number; cost: number };
type LowStockItem = { name: string; loc: string; qty: number; color: string };
type Fleet = { totalMachines: number; activeMachines: number; needRefill: number; broken: number };
// สรุปเงินรอฝาก (custody→deposit): มาจาก getPendingDepositSummary() ฝั่ง server (หน่วยเป็นสตางค์)
type PendingDeposit = { count: number; totalCents: number; overdueCount: number; overdueCents: number };

/* ── sample fallback (เมื่อ DB ว่าง) — ตัวเลขจาก design ── */
const SAMPLE_BRANCHES: BranchRow[] = [
  { branchId: "s1", code: "RS", name: "รังสิต", machines: 12, dolls: 168, revenue: 70300, profit: 41200, avgWin: 168, flag: "LOW" },
  { branchId: "s2", code: "LP", name: "ลาดพร้าว", machines: 10, dolls: 142, revenue: 61000, profit: 36800, avgWin: 215, flag: "GOOD" },
  { branchId: "s3", code: "BK", name: "บางแค", machines: 11, dolls: 121, revenue: 58500, profit: 30900, avgWin: 242, flag: "GOOD" },
  { branchId: "s4", code: "BN", name: "บางนา", machines: 9, dolls: 98, revenue: 52400, profit: 28100, avgWin: 268, flag: "AMBER" },
  { branchId: "s5", code: "NB", name: "นนทบุรี", machines: 8, dolls: 64, revenue: 44800, profit: 19500, avgWin: 410, flag: "HIGH" },
  { branchId: "s6", code: "PT", name: "ปทุมธานี", machines: 10, dolls: 110, revenue: 49200, profit: 21300, avgWin: 198, flag: "GOOD" },
  { branchId: "s7", code: "SP", name: "สมุทรปราการ", machines: 7, dolls: 88, revenue: 38900, profit: 17600, avgWin: 178, flag: "LOW" },
  { branchId: "s8", code: "MB", name: "มีนบุรี", machines: 9, dolls: 95, revenue: 42600, profit: 22700, avgWin: 225, flag: "GOOD" },
];
const SAMPLE_ALERTS: Alert[] = [
  { title: "เก็บเงินได้น้อยกว่ามิเตอร์", detail: "รังสิต · RS-03 · 12 นาทีก่อน", tag: "P0", tone: "red" },
  { title: "ตู้ไม่ขยับ 3 วัน", detail: "นนทบุรี · NB-02 · วันนี้", tag: "P1", tone: "amber" },
  { title: "เหรียญเข้ายอดไม่ตรง", detail: "บางแค · BK-05 · 2 ชม.ก่อน", tag: "P1", tone: "amber" },
  { title: "ตุ๊กตาออกผิดปกติ", detail: "ลาดพร้าว · LP-01 · เมื่อวาน", tag: "P2", tone: "neutral" },
  { title: "ยังไม่ปิดรอบเก็บเงิน", detail: "สมุทรปราการ · SP-02 · วันนี้", tag: "P2", tone: "neutral" },
];
/* sample fallback เมื่อ DB ว่าง */
const SAMPLE_DAYS: DailyPoint[] = [
  { d: "18", iso: "", profit: 24.2, cost: 12 }, { d: "19", iso: "", profit: 31, cost: 14 }, { d: "20", iso: "", profit: 28.5, cost: 13 },
  { d: "21", iso: "", profit: 35, cost: 16 }, { d: "22", iso: "", profit: 30.1, cost: 14 }, { d: "23", iso: "", profit: 28.4, cost: 13 }, { d: "24", iso: "", profit: 32.7, cost: 15 },
];
const SAMPLE_LOW_STOCK: LowStockItem[] = [
  { name: "หมีบราวน์ ไซต์ L", loc: "คลังกลาง", qty: 8, color: "#B42318" },
  { name: "ไดโนเสาร์เขียว", loc: "คลังกลาง", qty: 14, color: "#B45309" },
  { name: "แมวเหมียวชมพู", loc: "รังสิต", qty: 19, color: "#B45309" },
  { name: "ยูนิคอร์น พาสเทล", loc: "ลาดพร้าว", qty: 22, color: "#B45309" },
];

export function DashboardClient({
  summary,
  branches,
  alerts,
  machineCount,
  dailyPnl,
  lowStock,
  fleet,
  hasRealData = false,
  pendingDeposit = { count: 0, totalCents: 0, overdueCount: 0, overdueCents: 0 },
}: {
  summary: { revenue: number; cost: number; profit: number; dollsOut: number; hasCost: boolean; avgBahtPerDoll: number | null; riskyBranches: number };
  branches: BranchRow[];
  alerts: Alert[];
  machineCount: number;
  dailyPnl: DailyPoint[];
  lowStock: LowStockItem[];
  fleet: Fleet;
  // org นี้เคยเก็บเงินจริงไหม (มี CfCollectionSession) — จาก server. true = มีข้อมูลจริง
  hasRealData?: boolean;
  // เงินที่แม่บ้านเก็บได้แต่ "ยังไม่ฝากธนาคาร" (ค้างมือ) — default 0 กัน build/hydrate พัง
  pendingDeposit?: PendingDeposit;
}) {
  const router = useRouter();
  // เงินรอฝาก: แปลงสตางค์→บาท (bahtN รับหน่วยบาท) · โชว์เฉพาะ org จริง (empty=sample ไม่โชว์ตัวเลขปลอม)
  const depoBaht = Math.round(pendingDeposit.totalCents / 100);
  const depoOverdueBaht = Math.round(pendingDeposit.overdueCents / 100);
  const hasPending = pendingDeposit.count > 0;
  const hasOverdue = pendingDeposit.overdueCount > 0;
  // "ว่างจริง" = ไม่มีสาขาจริง และไม่เคยเก็บเงินเลย → โชว์ตัวอย่างเพื่อให้เห็นภาพ.
  // org จริงที่มีข้อมูล (มีสาขา หรือ เคยเก็บเงิน) → ห้ามโชว์ตัวอย่าง แม้ยังไม่มีธงแดง.
  const empty = branches.length === 0 && !hasRealData;
  const rows = empty ? SAMPLE_BRANCHES : branches;
  // ธงแดง: โชว์ sample เฉพาะตอน "ว่างจริง" เท่านั้น · org จริงที่ 0 anomaly = ธงแดงว่างจริง (ไม่ปลอม)
  const alertRows = empty ? SAMPLE_ALERTS : alerts;
  // มีข้อมูลจริงแล้วแต่ไม่มีธงแดง = สถานะที่ดี (ทุกรอบปกติ) → โชว์ empty-state บวก ไม่ใช่ตัวเลขปลอม
  const alertsClean = !empty && alertRows.length === 0;
  // กราฟรายวัน:
  //  - org จริง (hasRealData) → ห้าม fallback SAMPLE เด็ดขาด · ใช้ dailyPnl จริง (แม้ทุกแท่ง = ฿0)
  //    ถ้ายังไม่มีรอบเก็บใน 7 วันนี้ → chartEmptyReal=true โชว์ข้อความจริงแทนตัวเลขปลอม
  //  - org ว่างจริง (empty) → โชว์ SAMPLE เพื่อให้เห็นภาพ
  const hasRealDailyData = dailyPnl.length > 0 && dailyPnl.some((d) => Math.abs(d.profit) + Math.abs(d.cost) > 0);
  const chartEmptyReal = hasRealData && !hasRealDailyData;
  const days = hasRealData ? dailyPnl : (hasRealDailyData ? dailyPnl : SAMPLE_DAYS);
  const lowStockRows = lowStock.length > 0 ? lowStock : (empty ? SAMPLE_LOW_STOCK : []);
  const totRevenue = empty ? rows.reduce((s, b) => s + b.revenue, 0) : summary.revenue;
  const totProfit = empty ? rows.reduce((s, b) => s + b.profit, 0) : summary.profit;
  const totMachines = empty ? rows.reduce((s, b) => s + b.machines, 0) : machineCount;
  const avgWinAll = empty
    ? Math.round(rows.reduce((s, b) => s + b.avgWin, 0) / rows.length)
    : summary.avgBahtPerDoll == null ? 0 : Math.round(summary.avgBahtPerDoll);
  // ต้นทุน/ตัว จริง = ต้นทุนตุ๊กตารวม ÷ จำนวนตุ๊กตาที่ออก (ไม่เดา) · null ถ้ายังไม่มีต้นทุนตั้งไว้/ไม่มีตุ๊กตาออก
  const costPerDoll =
    !empty && summary.hasCost && summary.dollsOut > 0
      ? Math.round(summary.cost / summary.dollsOut)
      : null;
  // fleet overview: ใช้ของจริงถ้า DB ไม่ว่าง · ถ้า DB ว่าง (sample) → needRefill/broken ไม่รู้จริง = null
  const fleetView = empty
    ? { activeMachines: totMachines, needRefill: null as number | null, broken: null as number | null }
    : { activeMachines: fleet.activeMachines, needRefill: fleet.needRefill, broken: fleet.broken };
  const tooEasy = rows.filter((b) => b.flag === "LOW" || b.flag === "LOSS").length;
  const good = rows.filter((b) => b.flag === "GOOD").length;
  const tooHard = rows.filter((b) => b.flag === "HIGH" || b.flag === "AMBER").length;
  // ยอดต่อวัน = รายได้จริง (กำไร + ต้นทุน) · กำไรติดลบได้ (วันขาดทุน) → ใช้ค่าสัมบูรณ์หา scale
  // แท่งสูง = รายได้รวมวันนั้น · ส่วนสีน้ำเงิน = สัดส่วนกำไร (วันขาดทุน = ไม่มีแถบกำไร + ป้ายแดง)
  const dayRevenue = (d: DailyPoint) => d.profit + d.cost;
  const maxBar = Math.max(1, ...days.map((d) => Math.abs(dayRevenue(d))));

  // KPI "เมื่อวาน" — แท่งก่อนแท่งสุดท้ายในซีรีส์จริง (index length-2) เทียบวันก่อนหน้า (length-3)
  // ใช้เฉพาะ org จริงที่มีข้อมูลกราฟจริง · ต้องมีอย่างน้อย 2 วันถึงเทียบได้
  const showYesterday = hasRealData && hasRealDailyData && days.length >= 2;
  const yRevenue = showYesterday ? dayRevenue(days[days.length - 2]) : 0;
  const prevRevenue = showYesterday && days.length >= 3 ? dayRevenue(days[days.length - 3]) : null;
  const yDeltaPct =
    prevRevenue != null && Math.abs(prevRevenue) > 0.0001
      ? Math.round(((yRevenue - prevRevenue) / Math.abs(prevRevenue)) * 100)
      : null;

  return (
    <div>
      {empty && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", background: "#FCF8EC", border: "1px solid #F0E2BE", borderRadius: 10, padding: "9px 14px", marginBottom: 16, fontSize: 12, color: "#7A5510" }}>
          <AlertTriangle size={15} /> ยังไม่มีข้อมูลจริงในระบบ — กำลังแสดง<b> ตัวอย่าง</b> เพื่อให้เห็นภาพ (จะเปลี่ยนเป็นข้อมูลจริงเมื่อเริ่มเก็บเงิน)
        </div>
      )}

      {/* เงินรอฝาก (custody→deposit) — โชว์เฉพาะ org จริง (empty=sample ห้ามโชว์ตัวเลขปลอม).
          มีเงินค้างมือ → แถบเตือน (เกินกำหนด=แดง · ยังไม่เกิน=เหลือง) กดไปหน้าใบฝาก.
          ฝากครบ (count=0) → แถบเขียวสั้นๆ ให้เจ้าของสบายใจ. */}
      {!empty && (
        hasPending ? (
          <div
            role="button"
            tabIndex={0}
            onClick={() => router.push("/clawfleet/os/deposits")}
            style={{
              display: "flex", alignItems: "center", gap: 12, marginBottom: 16, padding: "13px 16px",
              borderRadius: 12, cursor: "pointer",
              background: hasOverdue ? "#FCECEA" : "#FBF3E4",
              border: `1px solid ${hasOverdue ? "#F3CEC8" : "#EFDCB4"}`,
            }}
          >
            <IconBox tone={hasOverdue ? "red" : "amber"} size={38} radius={10}>
              <Banknote size={18} />
            </IconBox>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: hasOverdue ? "#8A2018" : "#7A5510" }}>
                💰 เงินรอฝาก <span className="num">{bahtN(depoBaht)}</span>{" "}
                <span style={{ fontWeight: 500 }}>· <span className="num">{num(pendingDeposit.count)}</span> รอบค้างมือ</span>
              </div>
              {hasOverdue && (
                <div style={{ fontSize: 12, fontWeight: 600, color: "#B42318", marginTop: 2 }}>
                  ⚠️ เกินกำหนด <span className="num">{num(pendingDeposit.overdueCount)}</span> รอบ · <span className="num">{bahtN(depoOverdueBaht)}</span> ยังไม่เข้าธนาคาร
                </div>
              )}
              {!hasOverdue && (
                <div style={{ fontSize: 12, color: "#8A6D2C", marginTop: 2 }}>เงินที่เก็บได้แต่ยังไม่ฝากเข้าธนาคาร — กดเพื่อดู/บันทึกการฝาก</div>
              )}
            </div>
            <Pill tone={hasOverdue ? "red" : "amber"}>ดูใบฝาก</Pill>
            <ChevronRight size={16} style={{ color: hasOverdue ? "#C2756C" : "#C2A85C", flex: "0 0 auto" }} />
          </div>
        ) : (
          <div
            style={{
              display: "flex", alignItems: "center", gap: 10, marginBottom: 16, padding: "10px 16px",
              borderRadius: 12, background: "#EDF7F0", border: "1px solid #CDE9D6", fontSize: 12.5, color: "#15803D", fontWeight: 600,
            }}
          >
            <ShieldCheck size={16} /> เงินเก็บฝากเข้าธนาคารครบแล้ว — ไม่มีเงินค้างมือ
          </div>
        )
      )}

      {/* KPIs */}
      <div className={`grid grid-cols-2 ${showYesterday ? "lg:grid-cols-6" : "lg:grid-cols-5"} gap-3.5 mb-4`}>
        {showYesterday && (
          <Kpi
            icon={<Wallet size={16} />}
            iconTone="neutral"
            label="เมื่อวาน"
            value={bahtN(Math.round(yRevenue * 1000))}
            delta={
              yDeltaPct == null
                ? "เทียบวันก่อนไม่ได้"
                : `${yDeltaPct >= 0 ? "▲" : "▼"} ${Math.abs(yDeltaPct)}% เทียบวันก่อน`
            }
            deltaColor={yDeltaPct == null ? "#9AA1AB" : deltaColor(yDeltaPct)}
          />
        )}
        <Kpi icon={<Wallet size={16} />} label="รายได้ (7 วัน)" value={bahtN(totRevenue)} />
        <Kpi icon={<TrendingUp size={16} />} iconTone="green" label="กำไรสุทธิ" value={bahtN(totProfit)} valueColor="#15803D" delta="หักต้นทุนตุ๊กตาแล้ว" deltaColor="#9AA1AB" />
        <Kpi icon={<Boxes size={16} />} iconTone="neutral" label="ตู้คีบทั้งหมด" value={`${num(totMachines)} ตู้`} delta={`${rows.length} สาขา`} deltaColor="#9AA1AB" />
        <Kpi icon={<Coins size={16} />} iconTone="amber" label="ต้นทุน/ตัว เฉลี่ย" value={costPerDoll == null ? "—" : bahtN(costPerDoll)} delta={costPerDoll == null ? "ยังไม่มีต้นทุนตั้งไว้" : "ต้นทุนตุ๊กตา ÷ ตัวที่ออก"} deltaColor="#9AA1AB" />
        {alertsClean ? (
          <Kpi icon={<ShieldCheck size={16} />} iconTone="green" label="ธงแดง · ต้องตรวจ" value="0 รายการ" valueColor="#15803D" delta="ทุกรอบปกติ" deltaColor="#9AA1AB" />
        ) : (
          <Kpi icon={<ShieldAlert size={16} />} iconTone="red" label="ธงแดง · ต้องตรวจ" value={`${alertRows.length} รายการ`} valueColor="#B42318" delta={empty ? `${summary.riskyBranches || tooEasy + tooHard} สาขาเสี่ยง` : `${summary.riskyBranches} สาขาเสี่ยง`} deltaColor="#C2756C" />
        )}
      </div>

      {/* daily chart */}
      <Card title="รายได้ & กำไรรายวัน" sub={`${days.length} วันล่าสุด · กำไรสุทธิหักต้นทุนตุ๊กตา`} style={{ marginBottom: 18 }} right={
        <div style={{ display: "flex", gap: 16, fontSize: 11.5 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, color: "#6B7280" }}><span style={{ width: 10, height: 10, borderRadius: 3, background: "#4F46E5" }} />กำไรสุทธิ</span>
          <span style={{ display: "flex", alignItems: "center", gap: 6, color: "#6B7280" }}><span style={{ width: 10, height: 10, borderRadius: 3, background: "#EEF0F4" }} />ต้นทุนตุ๊กตา</span>
        </div>
      }>
        {chartEmptyReal ? (
          <EmptyState icon={<TrendingUp size={26} />} title="ยังไม่มีรอบเก็บใน 7 วันนี้" sub="กราฟจะแสดงรายได้–กำไรเมื่อมีรอบเก็บเงินปิดในช่วง 7 วันล่าสุด" />
        ) : (
        <>
        <div style={{ position: "relative", display: "flex", alignItems: "flex-end", gap: 18, height: 184, padding: "0 4px" }}>
          {/* baseline rule — เส้นฐานใต้แท่งกราฟ ให้ดูมีระดับอ้างอิง */}
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 23, height: 1, background: "#EBEDF1", pointerEvents: "none" }} />
          {days.map((d, di) => {
            const revenue = d.profit + d.cost; // รายได้จริงต่อวัน (พันบาท)
            const isLoss = d.profit < 0;       // วันขาดทุน = ต้นทุนตุ๊กตา > เงินที่เก็บได้
            // แท่งสูงตามรายได้จริง (ค่าสัมบูรณ์ กันแท่งหาย/ติดลบเมื่อขาดทุน)
            const h = (Math.abs(revenue) / maxBar) * 150;
            // ส่วนสีน้ำเงิน = สัดส่วนกำไร (เฉพาะกำไรบวก) · วันขาดทุนไม่มีแถบกำไร
            const profitH = !isLoss && revenue > 0 ? (d.profit / revenue) * h : 0;
            const isToday = di === days.length - 1; // แท่งขวาสุด = วันล่าสุด
            return (
              <div key={d.iso || `${d.d}-${di}`} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%" }}>
                <div className="num" style={{ fontSize: 10.5, fontWeight: 700, color: isLoss ? "#B42318" : isToday ? "#4F46E5" : "#454B54", marginBottom: 4 }}>{isLoss ? "ขาดทุน" : `฿${revenue.toFixed(0)}k`}</div>
                <div style={{ width: 30, height: h, borderRadius: "6px 6px 0 0", background: isLoss ? "#FBEAE8" : "#EEF0F4", display: "flex", flexDirection: "column", justifyContent: "flex-end", overflow: "hidden", boxShadow: isToday ? "0 0 0 2px rgba(79,70,229,0.22)" : undefined }}>
                  <div style={{ height: profitH, background: "#4F46E5" }} />
                </div>
                <div className="num" style={{ fontSize: 11, color: isToday ? "#4F46E5" : "#9AA1AB", fontWeight: isToday ? 700 : 400, marginTop: 6 }}>{d.d}</div>
              </div>
            );
          })}
        </div>
        {/* axis caption — บอกแกนให้คนอ่านเข้าใจ + วันนี้เน้นน้ำเงิน */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10, fontSize: 11, color: "#9AA1AB" }}>
          <span>ตัวเลขบนแท่ง = ยอดรวมต่อวัน (พันบาท)</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "#4F46E5", fontWeight: 600 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#4F46E5" }} /> วันล่าสุด
          </span>
        </div>
        </>
        )}
      </Card>

      {/* P&L by branch + red flags */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.55fr_1fr] gap-[18px] mb-[18px]">
        <Card title="กำไร–ขาดทุนรายสาขา" sub={`${rows.length} สาขา · ${num(totMachines)} ตู้ · 7 วันล่าสุด`} pad={false} right={
          <div style={{ display: "flex", gap: 14, fontSize: 11 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 5, color: "#6B7280" }}><span style={{ width: 9, height: 9, borderRadius: 3, background: "#15803D" }} />กำไร</span>
            <span style={{ display: "flex", alignItems: "center", gap: 5, color: "#6B7280" }}><span style={{ width: 9, height: 9, borderRadius: 3, background: "#B42318" }} />ขาดทุน</span>
          </div>
        }>
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 0.8fr 0.9fr 1.1fr", padding: "10px 20px", fontSize: 11, fontWeight: 600, color: "#9AA1AB", borderBottom: "1px solid #F4F5F7" }}>
            <span>สาขา</span><span style={{ textAlign: "right" }}>รายได้</span><span style={{ textAlign: "right" }}>กำไรสุทธิ</span><span style={{ textAlign: "right" }}>อัตราตุ๊กตาออก</span>
          </div>
          {rows.map((b) => {
            const t = pnlTone(b.flag as PnlFlagKey);
            return (
              <div key={b.branchId} className="co-rowlink" onClick={() => router.push(`/clawfleet/os/matrix?branch=${encodeURIComponent(b.code)}`)} style={{ display: "grid", gridTemplateColumns: "1.4fr 0.8fr 0.9fr 1.1fr", padding: "13px 20px", alignItems: "center", borderBottom: "1px solid #F4F5F7" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
                  <IconBox tone="neutral" size={32}><span className="num" style={{ fontSize: 11, fontWeight: 700 }}>{b.code}</span></IconBox>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>{b.name}</div>
                    <div style={{ fontSize: 11, color: "#9AA1AB" }}>{b.machines} ตู้ · <span className="num">{b.dolls}</span> ตัวออก</div>
                  </div>
                </div>
                <div className="num" style={{ textAlign: "right", fontSize: 13.5, fontWeight: 600 }}>{bahtN(b.revenue)}</div>
                <div className="num" style={{ textAlign: "right", fontSize: 13.5, fontWeight: 700, color: deltaColor(b.profit) }}>{b.profit >= 0 ? "+" : ""}{bahtN(b.profit)}</div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
                  <Pill tone={t.tone as Tone}><span className="num">฿{b.avgWin}</span> {t.label}</Pill>
                  <ChevronRight size={15} style={{ color: "#C2C7CF", flex: "0 0 auto" }} />
                </div>
              </div>
            );
          })}
        </Card>

        <Card title="ธงแดง · ต้องตรวจสอบ" pad={alertsClean} right={alertsClean ? <Pill tone="green">0</Pill> : <Pill tone="red">{alertRows.length}</Pill>}>
          {alertsClean ? (
            <EmptyState icon={<ShieldCheck size={26} />} title="วันนี้ไม่มีธงแดง · ทุกรอบปกติ" sub="ทุกรอบเก็บเงินกระทบยอดตรง — ไม่มีรายการต้องตรวจ" />
          ) : alertRows.map((a, i) => {
            const accent = a.tone === "red" ? "var(--co-red)" : a.tone === "amber" ? "var(--co-amber)" : "var(--co-border)";
            return (
              <div
                key={i}
                className="co-rowlink co-accent-l"
                onClick={() => router.push("/clawfleet/os/collections")}
                style={{ display: "flex", alignItems: "center", gap: 11, padding: "13px 18px", borderBottom: "1px solid #F4F5F7", ["--co-accent" as string]: accent }}
              >
                <IconBox tone={a.tone === "red" ? "red" : a.tone === "amber" ? "amber" : "neutral"} size={30}><AlertTriangle size={14} /></IconBox>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.35 }}>{a.title}</div>
                  <div style={{ fontSize: 11.5, color: "#8A909A", marginTop: 2, lineHeight: 1.35 }}>{a.detail}</div>
                </div>
                <Pill tone={a.tone === "red" ? "red" : a.tone === "amber" ? "amber" : "neutral"}>{a.tag}</Pill>
                <ChevronRight size={15} style={{ color: "#C2C7CF", flex: "0 0 auto" }} />
              </div>
            );
          })}
        </Card>
      </div>

      {/* config health + low stock + fleet */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.1fr] gap-[18px]">
        <Card pad>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 3 }}>สุขภาพการตั้งค่าตู้ (อัตราตุ๊กตาออก)</div>
          <div style={{ fontSize: 12, color: "#9AA1AB", marginBottom: 18 }}>ต้นทุนเฉลี่ยที่ลูกค้าจ่ายต่อตุ๊กตา 1 ตัว · ราคาขายตั้งไว้ <span className="num">฿250</span></div>
          <AvgWinBar markerPct={avgWinMarkerPct(avgWinAll)} />
          <div style={{ display: "flex", alignItems: "flex-end", gap: 14, marginTop: 18 }}>
            <div>
              <div className="num" style={{ fontSize: 32, fontWeight: 700, letterSpacing: "-1px", color: avgWinAll >= 180 && avgWinAll <= 280 ? "#15803D" : "#B45309" }}>฿{avgWinAll}</div>
              <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>เฉลี่ยทั้งร้าน{avgWinAll >= 180 && avgWinAll <= 280 ? " · กำลังดี" : ""}</div>
            </div>
            <div style={{ flex: 1, display: "flex", gap: 8, justifyContent: "flex-end" }}>
              {[["ง่ายไป", tooEasy, "#B45309"], ["กำลังดี", good, "#15803D"], ["ยากไป", tooHard, "#B42318"]].map(([l, n, c]) => (
                <div key={l as string} style={{ textAlign: "center" }}>
                  <div className="num" style={{ fontSize: 17, fontWeight: 700, color: c as string }}>{n as number}</div>
                  <div style={{ fontSize: 10.5, color: "#9AA1AB" }}>{l as string}</div>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-[18px]">
          <Card pad>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
              <IconBox tone="amber" size={26} radius={7}><Boxes size={14} /></IconBox>
              <span style={{ fontSize: 14, fontWeight: 700 }}>สินค้าใกล้หมด</span>
            </div>
            {lowStockRows.length === 0 ? (
              <EmptyState icon={<PackageOpen size={26} />} title="สต๊อกเพียงพอ" sub="ยังไม่มีสินค้าที่ใกล้หมด" />
            ) : lowStockRows.map((s, i) => (
              <div key={`${s.name}-${s.loc}-${i}`} style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 0", borderBottom: "1px solid #F4F5F7" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.name}</div>
                  <div style={{ fontSize: 10.5, color: "#9AA1AB" }}>{s.loc}</div>
                </div>
                <span className="num" style={{ fontSize: 13, fontWeight: 700, color: s.color }}>{s.qty}</span>
              </div>
            ))}
          </Card>

          <div style={{ background: "#1E2230", border: "1px solid #1E2230", borderRadius: 14, padding: "17px 18px", color: "#fff", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 13 }}>
              <span style={{ width: 26, height: 26, borderRadius: 7, background: "rgba(255,255,255,0.12)", display: "flex", alignItems: "center", justifyContent: "center" }}><Monitor size={14} /></span>
              <span style={{ fontSize: 14, fontWeight: 700 }}>ภาพรวมตู้ทั้งร้าน</span>
            </div>
            <div className="num" style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-1px" }}>{num(fleetView.activeMachines)}</div>
            <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.6)", marginBottom: 14 }}>ตู้คีบที่เปิดใช้งาน · {rows.length} สาขา</div>
            <div style={{ display: "flex", gap: 8, marginTop: "auto" }}>
              <div style={{ flex: 1, background: "rgba(255,255,255,0.07)", borderRadius: 9, padding: "9px 10px" }}><div className="num" style={{ fontSize: 16, fontWeight: 700, color: "#F2B24A" }}>{fleetView.needRefill == null ? "—" : num(fleetView.needRefill)}</div><div style={{ fontSize: 10, color: "rgba(255,255,255,0.55)" }}>ต้องเติม</div></div>
              <div style={{ flex: 1, background: "rgba(255,255,255,0.07)", borderRadius: 9, padding: "9px 10px" }}><div className="num" style={{ fontSize: 16, fontWeight: 700, color: "#E8736A" }}>{fleetView.broken == null ? "—" : num(fleetView.broken)}</div><div style={{ fontSize: 10, color: "rgba(255,255,255,0.55)" }}>ตู้เสีย</div></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
