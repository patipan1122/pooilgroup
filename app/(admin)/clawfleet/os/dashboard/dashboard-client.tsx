"use client";

import { useRouter } from "next/navigation";
import { Wallet, TrendingUp, Boxes, Coins, AlertTriangle, ShieldAlert, Monitor } from "lucide-react";
import { Kpi, Card, Pill, AvgWinBar, IconBox } from "@/components/clawfleet/os/kit";
import { bahtN, num, deltaColor, pnlTone, avgWinMarkerPct, type PnlFlagKey, type Tone } from "@/components/clawfleet/os/format";

type BranchRow = {
  branchId: string; code: string; name: string; machines: number;
  dolls: number; revenue: number; profit: number; avgWin: number; flag: string;
};
type Alert = { title: string; detail: string; tag: string; tone: "red" | "amber" | "neutral" };

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
const DAYS = [
  { d: "18", profit: 24.2, cost: 12 }, { d: "19", profit: 31, cost: 14 }, { d: "20", profit: 28.5, cost: 13 },
  { d: "21", profit: 35, cost: 16 }, { d: "22", profit: 30.1, cost: 14 }, { d: "23", profit: 28.4, cost: 13 }, { d: "24", profit: 32.7, cost: 15 },
];
const LOW_STOCK = [
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
}: {
  summary: { revenue: number; profit: number; dollsOut: number; avgBahtPerDoll: number | null; riskyBranches: number };
  branches: BranchRow[];
  alerts: Alert[];
  machineCount: number;
}) {
  const router = useRouter();
  const empty = branches.length === 0;
  const rows = empty ? SAMPLE_BRANCHES : branches;
  const alertRows = alerts.length === 0 ? SAMPLE_ALERTS : alerts;
  const totRevenue = empty ? rows.reduce((s, b) => s + b.revenue, 0) : summary.revenue;
  const totProfit = empty ? rows.reduce((s, b) => s + b.profit, 0) : summary.profit;
  const totMachines = empty ? rows.reduce((s, b) => s + b.machines, 0) : Math.max(machineCount, rows.reduce((s, b) => s + b.machines, 0));
  const avgWinAll = empty
    ? Math.round(rows.reduce((s, b) => s + b.avgWin, 0) / rows.length)
    : summary.avgBahtPerDoll == null ? 0 : Math.round(summary.avgBahtPerDoll);
  const costPerDoll = avgWinAll > 0 ? Math.round(avgWinAll * 0.62) : 0;
  const tooEasy = rows.filter((b) => b.flag === "LOW" || b.flag === "LOSS").length;
  const good = rows.filter((b) => b.flag === "GOOD").length;
  const tooHard = rows.filter((b) => b.flag === "HIGH" || b.flag === "AMBER").length;
  const maxBar = Math.max(...DAYS.map((d) => d.profit + d.cost));

  return (
    <div>
      {empty && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", background: "#FCF8EC", border: "1px solid #F0E2BE", borderRadius: 10, padding: "9px 14px", marginBottom: 16, fontSize: 12, color: "#7A5510" }}>
          <AlertTriangle size={15} /> ยังไม่มีข้อมูลจริงในระบบ — กำลังแสดง<b> ตัวอย่าง</b> เพื่อให้เห็นภาพ (จะเปลี่ยนเป็นข้อมูลจริงเมื่อเริ่มเก็บเงิน)
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3.5 mb-4">
        <Kpi icon={<Wallet size={16} />} label="รายได้ (7 วัน)" value={bahtN(totRevenue)} delta="↑ 8.4% จากสัปดาห์ก่อน" />
        <Kpi icon={<TrendingUp size={16} />} iconTone="green" label="กำไรสุทธิ" value={bahtN(totProfit)} valueColor="#15803D" delta="↑ 6.1% หักต้นทุนตุ๊กตาแล้ว" />
        <Kpi icon={<Boxes size={16} />} iconTone="neutral" label="ตู้คีบทั้งหมด" value={`${num(totMachines)} ตู้`} delta={`${rows.length} สาขา`} deltaColor="#9AA1AB" />
        <Kpi icon={<Coins size={16} />} iconTone="amber" label="ต้นทุน/ตัว เฉลี่ย" value={bahtN(costPerDoll)} delta="↓ 2.0% จากสัปดาห์ก่อน" deltaColor="#15803D" />
        <Kpi icon={<ShieldAlert size={16} />} iconTone="red" label="ธงแดง · ต้องตรวจ" value={`${alertRows.length} รายการ`} valueColor="#B42318" delta={`${summary.riskyBranches || tooEasy + tooHard} สาขาเสี่ยง`} deltaColor="#C2756C" />
      </div>

      {/* daily chart */}
      <Card title="รายได้ & กำไรรายวัน" sub="7 วันล่าสุด · 18–24 มิ.ย. 69" style={{ marginBottom: 18 }} right={
        <div style={{ display: "flex", gap: 16, fontSize: 11.5 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, color: "#6B7280" }}><span style={{ width: 10, height: 10, borderRadius: 3, background: "#4F46E5" }} />กำไรสุทธิ</span>
          <span style={{ display: "flex", alignItems: "center", gap: 6, color: "#6B7280" }}><span style={{ width: 10, height: 10, borderRadius: 3, background: "#EEF0F4" }} />ต้นทุนตุ๊กตา</span>
        </div>
      }>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 18, height: 184, padding: "0 4px" }}>
          {DAYS.map((d) => {
            const total = d.profit + d.cost;
            const h = (total / maxBar) * 150;
            const profitH = (d.profit / total) * h;
            return (
              <div key={d.d} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%" }}>
                <div className="num" style={{ fontSize: 10.5, fontWeight: 700, color: "#454B54", marginBottom: 4 }}>฿{total.toFixed(0)}k</div>
                <div style={{ width: 30, height: h, borderRadius: "6px 6px 0 0", background: "#EEF0F4", display: "flex", flexDirection: "column", justifyContent: "flex-end", overflow: "hidden" }}>
                  <div style={{ height: profitH, background: "#4F46E5" }} />
                </div>
                <div className="num" style={{ fontSize: 11, color: "#9AA1AB", marginTop: 6 }}>{d.d}</div>
              </div>
            );
          })}
        </div>
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
              <div key={b.branchId} className="co-rowh" onClick={() => router.push(`/clawfleet/os/matrix?branch=${encodeURIComponent(b.code)}`)} style={{ display: "grid", gridTemplateColumns: "1.4fr 0.8fr 0.9fr 1.1fr", padding: "13px 20px", alignItems: "center", borderBottom: "1px solid #F4F5F7", cursor: "pointer" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
                  <IconBox tone="neutral" size={32}><span className="num" style={{ fontSize: 11, fontWeight: 700 }}>{b.code}</span></IconBox>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>{b.name}</div>
                    <div style={{ fontSize: 11, color: "#9AA1AB" }}>{b.machines} ตู้ · <span className="num">{b.dolls}</span> ตัวออก</div>
                  </div>
                </div>
                <div className="num" style={{ textAlign: "right", fontSize: 13.5, fontWeight: 600 }}>{bahtN(b.revenue)}</div>
                <div className="num" style={{ textAlign: "right", fontSize: 13.5, fontWeight: 700, color: deltaColor(b.profit) }}>{b.profit >= 0 ? "+" : ""}{bahtN(b.profit)}</div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                  <Pill tone={t.tone as Tone}><span className="num">฿{b.avgWin}</span> {t.label}</Pill>
                </div>
              </div>
            );
          })}
        </Card>

        <Card title="ธงแดง · ต้องตรวจสอบ" pad={false} right={<Pill tone="red">{alertRows.length}</Pill>}>
          {alertRows.map((a, i) => (
            <div key={i} className="co-rowh" onClick={() => router.push("/clawfleet/os/collections")} style={{ display: "flex", gap: 11, padding: "13px 18px", borderBottom: "1px solid #F4F5F7", cursor: "pointer" }}>
              <IconBox tone={a.tone === "red" ? "red" : a.tone === "amber" ? "amber" : "neutral"} size={30}><AlertTriangle size={14} /></IconBox>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.35 }}>{a.title}</div>
                <div style={{ fontSize: 11.5, color: "#8A909A", marginTop: 2, lineHeight: 1.35 }}>{a.detail}</div>
              </div>
              <Pill tone={a.tone === "red" ? "red" : a.tone === "amber" ? "amber" : "neutral"}>{a.tag}</Pill>
            </div>
          ))}
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
            {LOW_STOCK.map((s) => (
              <div key={s.name} style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 0", borderBottom: "1px solid #F4F5F7" }}>
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
              <span style={{ fontSize: 14, fontWeight: 700 }}>ตู้หน้า 7-11</span>
            </div>
            <div className="num" style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-1px" }}>80</div>
            <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.6)", marginBottom: 14 }}>ตู้ทั่วประเทศ · 1 ตู้/สาขา</div>
            <div style={{ display: "flex", gap: 8, marginTop: "auto" }}>
              <div style={{ flex: 1, background: "rgba(255,255,255,0.07)", borderRadius: 9, padding: "9px 10px" }}><div className="num" style={{ fontSize: 16, fontWeight: 700, color: "#F2B24A" }}>9</div><div style={{ fontSize: 10, color: "rgba(255,255,255,0.55)" }}>ต้องเติม</div></div>
              <div style={{ flex: 1, background: "rgba(255,255,255,0.07)", borderRadius: 9, padding: "9px 10px" }}><div className="num" style={{ fontSize: 16, fontWeight: 700, color: "#E8736A" }}>4</div><div style={{ fontSize: 10, color: "rgba(255,255,255,0.55)" }}>ตู้เสีย</div></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
