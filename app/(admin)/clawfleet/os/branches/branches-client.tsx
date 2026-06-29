"use client";

import { useState } from "react";
import Link from "next/link";
import { Boxes, Wallet, Store, AlertTriangle, ArrowRight, Cpu } from "lucide-react";
import { Kpi, IconBox, Pill } from "@/components/clawfleet/os/kit";
import { bahtN, num, deltaColor, pnlTone, type PnlFlagKey, type Tone } from "@/components/clawfleet/os/format";

/** สถานะตู้จริงจาก server (cfMachine): ดี / ต้องเติม / เสีย */
export type ServerDotStatus = "good" | "warn" | "broken";

export type BranchRow = {
  branchId: string;
  code: string;
  name: string;
  machines: number;
  dolls: number;
  revenue: number;
  profit: number;
  avgWin: number;
  flag: string;
  /** สถานะรายตู้จริง (เรียงตาม code) — ว่าง = ไม่มีข้อมูลตู้ */
  dots: ServerDotStatus[];
};

/* ── sample fallback (เมื่อ DB ว่าง) — ตัวเลข/สาขาแนวเดียวกับ dashboard ── */
const SAMPLE_BRANCHES: BranchRow[] = [
  { branchId: "s1", code: "RS", name: "รังสิต", machines: 12, dolls: 168, revenue: 70300, profit: 41200, avgWin: 168, flag: "LOW", dots: [] },
  { branchId: "s2", code: "LP", name: "ลาดพร้าว", machines: 10, dolls: 142, revenue: 61000, profit: 36800, avgWin: 215, flag: "GOOD", dots: [] },
  { branchId: "s3", code: "BK", name: "บางแค", machines: 11, dolls: 121, revenue: 58500, profit: 30900, avgWin: 242, flag: "GOOD", dots: [] },
  { branchId: "s4", code: "BN", name: "บางนา", machines: 9, dolls: 98, revenue: 52400, profit: 28100, avgWin: 268, flag: "AMBER", dots: [] },
  { branchId: "s5", code: "NB", name: "นนทบุรี", machines: 8, dolls: 64, revenue: 44800, profit: 19500, avgWin: 410, flag: "HIGH", dots: [] },
  { branchId: "s6", code: "PT", name: "ปทุมธานี", machines: 10, dolls: 110, revenue: 49200, profit: 21300, avgWin: 198, flag: "GOOD", dots: [] },
  { branchId: "s7", code: "SP", name: "สมุทรปราการ", machines: 7, dolls: 88, revenue: 38900, profit: 17600, avgWin: 178, flag: "LOW", dots: [] },
  { branchId: "s8", code: "MB", name: "มีนบุรี", machines: 9, dolls: 95, revenue: 42600, profit: 22700, avgWin: 225, flag: "GOOD", dots: [] },
];

/* ── per-machine status dots (จำลองในหน้านี้ — backend ไม่มี per-machine status ใน BranchPnl) ── */
type DotKind = "good" | "warn" | "bad" | "broken";
const DOT: Record<DotKind, { bg: string; letter: string; title: string }> = {
  good: { bg: "#2FA866", letter: "✓", title: "กำลังดี" },
  warn: { bg: "#E8A33D", letter: "!", title: "ตั้งง่าย/ยากไป" },
  bad: { bg: "#DB5040", letter: "✕", title: "มีปัญหา" },
  broken: { bg: "#B9BEC7", letter: "–", title: "ตู้เสีย" },
};

/** map สถานะตู้จริงจาก server → DotKind (real ไม่มี "bad"; ใช้ good/warn/broken) */
function realDots(dots: ServerDotStatus[]): DotKind[] {
  return dots.map((d) => (d === "warn" ? "warn" : d === "broken" ? "broken" : "good"));
}

/** fallback (เฉพาะตอน DB ว่าง/ไม่มีข้อมูลตู้): จำลองตาม flag + machines count */
function sampleDots(machines: number, flag: string): DotKind[] {
  const n = Math.max(1, Math.min(machines, 14));
  const out: DotKind[] = [];
  for (let i = 0; i < n; i++) {
    if ((flag === "HIGH" || flag === "LOSS") && i === 0) out.push("bad");
    else if ((flag === "AMBER" || flag === "LOW") && i === 0) out.push("warn");
    else if (i === n - 1 && machines > 8) out.push("broken");
    else out.push("good");
  }
  return out;
}

export function BranchesClient({ branches }: { branches: BranchRow[] }) {
  const empty = branches.length === 0;
  const rows = empty ? SAMPLE_BRANCHES : branches;
  const [openId, setOpenId] = useState<string | null>(null);

  const totMachines = rows.reduce((s, b) => s + b.machines, 0);
  const totRevenue = rows.reduce((s, b) => s + b.revenue, 0);
  const problem = rows.filter((b) => b.flag === "HIGH" || b.flag === "LOSS" || b.flag === "AMBER").length;

  return (
    <div>
      {empty && (
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            background: "#FCF8EC",
            border: "1px solid #F0E2BE",
            borderRadius: 10,
            padding: "9px 14px",
            marginBottom: 16,
            fontSize: 12,
            color: "#7A5510",
          }}
        >
          <AlertTriangle size={15} /> ยังไม่มีข้อมูลจริงในระบบ — กำลังแสดง<b> ตัวอย่าง</b> เพื่อให้เห็นภาพ (จะเปลี่ยนเป็นข้อมูลจริงเมื่อเริ่มเก็บเงิน)
        </div>
      )}

      {/* ── 4 KPI summary cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 mb-5">
        <Kpi icon={<Store size={16} />} label="สาขาทั้งหมด" value={`${num(rows.length)} สาขา`} delta="ทั่วกรุงเทพฯ–ปริมณฑล" deltaColor="#9AA1AB" />
        <Kpi icon={<Boxes size={16} />} iconTone="neutral" label="ตู้คีบรวม" value={`${num(totMachines)} ตู้`} delta={`${rows.length} สาขา`} deltaColor="#9AA1AB" />
        <Kpi icon={<Wallet size={16} />} iconTone="green" label="รายได้รวม 7 วัน" value={bahtN(totRevenue)} valueColor="#15803D" delta="ก่อนหักต้นทุนตุ๊กตา" deltaColor="#9AA1AB" />
        <Kpi icon={<AlertTriangle size={16} />} iconTone="red" label="สาขาที่ต้องดู" value={`${num(problem)} สาขา`} valueColor="#B42318" delta="ตั้งค่าตู้เพี้ยน/ขาดทุน" deltaColor="#C2756C" />
      </div>

      {/* ── branches grid: 2 คอลัมน์ desktop → 1 คอลัมน์มือถือ ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {rows.map((b) => {
          const t = pnlTone(b.flag as PnlFlagKey);
          const open = openId === b.branchId;
          // ใช้สถานะตู้จริงถ้ามี · ไม่งั้น (DB ว่าง/ไม่มีตู้) ใช้ sample จำลอง
          const dots = b.dots.length > 0 ? realDots(b.dots) : sampleDots(b.machines, b.flag);
          return (
            <div key={b.branchId} className="co-card" style={{ padding: "18px 20px" }}>
              {/* header: code chip + name + flag pill */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                <IconBox tone="neutral" size={42} radius={11} bg="#F1F2F7" color="#4F46E5">
                  <span className="num" style={{ fontSize: 14, fontWeight: 700 }}>{b.code}</span>
                </IconBox>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>{b.name}</div>
                  <div style={{ fontSize: 11.5, color: "#9AA1AB" }}>
                    <span className="num">{b.machines}</span> ตู้ · <span className="num">{b.dolls}</span> ตัวออก (7 วัน)
                  </div>
                </div>
                <Pill tone={t.tone as Tone}>{t.label}</Pill>
              </div>

              {/* stats row: รายได้ / กำไร / ต้นทุน(เฉลี่ย บาท/ตัว) */}
              <div style={{ display: "flex", gap: 26, marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 11, color: "#9AA1AB", marginBottom: 3 }}>รายได้ 7 วัน</div>
                  <div className="num" style={{ fontSize: 16, fontWeight: 700 }}>{bahtN(b.revenue)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "#9AA1AB", marginBottom: 3 }}>กำไรสุทธิ</div>
                  <div className="num" style={{ fontSize: 16, fontWeight: 700, color: deltaColor(b.profit) }}>
                    {b.profit >= 0 ? "+" : ""}{bahtN(b.profit)}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "#9AA1AB", marginBottom: 3 }}>เฉลี่ย บาท/ตัว</div>
                  <div className="num" style={{ fontSize: 16, fontWeight: 700, color: t.tone === "green" ? "#15803D" : t.tone === "red" ? "#B42318" : "#B45309" }}>
                    ฿{b.avgWin}
                  </div>
                </div>
              </div>

              {/* footer: dot strip + ดูรายตู้ toggle */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, paddingTop: 14, borderTop: "1px solid #F4F5F7" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10.5, color: "#9AA1AB", marginBottom: 6 }}>สถานะตู้ในสาขา</div>
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                    {dots.map((d, i) => {
                      const cfg = DOT[d];
                      return (
                        <span
                          key={i}
                          title={cfg.title}
                          style={{ width: 16, height: 16, borderRadius: 4, background: cfg.bg, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 9, fontWeight: 700 }}
                        >
                          {cfg.letter}
                        </span>
                      );
                    })}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : b.branchId)}
                  className="co-tap"
                  style={{
                    border: "1px solid #E3E6EA",
                    background: open ? "#EEF0FE" : "#fff",
                    color: open ? "#4F46E5" : "#454B54",
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 600,
                    padding: "7px 13px",
                    borderRadius: 9,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    whiteSpace: "nowrap",
                  }}
                >
                  ดูรายตู้ <span style={{ fontSize: 14, transition: "transform .15s", transform: open ? "rotate(90deg)" : "none" }}>→</span>
                </button>
              </div>

              {/* expandable detail */}
              {open && (
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #F4F5F7" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9 }}>
                    <span style={{ fontSize: 11, color: "#9AA1AB" }}>รายตู้ · สถานะการตั้งค่า · เก็บล่าสุด</span>
                    <span style={{ flex: 1 }} />
                    <Link
                      href={`/clawfleet/os/matrix?branch=${encodeURIComponent(b.code)}`}
                      style={{ textDecoration: "none", fontSize: 10.5, fontWeight: 700, color: "#4F46E5", background: "#EEF0FE", padding: "5px 11px", borderRadius: 20, display: "inline-flex", alignItems: "center", gap: 4 }}
                    >
                      เจาะดู <ArrowRight size={12} />
                    </Link>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                    {dots.map((d, i) => {
                      const cfg = DOT[d];
                      const st = pnlTone(
                        d === "good" ? "GOOD" : d === "warn" ? "AMBER" : d === "bad" ? "HIGH" : "NODATA",
                      );
                      return (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 11, background: "#F8F9FB", borderRadius: 10, padding: "9px 11px" }}>
                          <span style={{ width: 36, height: 36, flex: "0 0 36px", borderRadius: 8, background: "#EAECF1", display: "flex", alignItems: "center", justifyContent: "center", color: "#9AA1AB" }}>
                            <Cpu size={16} />
                          </span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                              <span className="num" style={{ fontSize: 12.5, fontWeight: 700, color: "#4F46E5" }}>{b.code}-{String(i + 1).padStart(2, "0")}</span>
                              <Pill tone={st.tone as Tone}>{cfg.title}</Pill>
                            </div>
                            <div style={{ fontSize: 11, color: "#9AA1AB", marginTop: 2 }}>เก็บล่าสุด · ดูรายละเอียดในหน้าเจาะดู</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── legend: ความหมายของช่องสถานะตู้ ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 18,
          marginTop: 18,
          padding: "13px 18px",
          background: "#fff",
          border: "1px solid #E8EAED",
          borderRadius: 12,
          fontSize: 11.5,
          color: "#6B7280",
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontWeight: 600, color: "#454B54" }}>สถานะตู้ (ตัวย่อในช่อง · ชี้เมาส์ดูได้):</span>
        {(["good", "warn", "bad", "broken"] as DotKind[]).map((k) => {
          const cfg = DOT[k];
          return (
            <span key={k} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 16, height: 16, borderRadius: 4, background: cfg.bg, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 9, fontWeight: 700 }}>{cfg.letter}</span>
              {cfg.title}
            </span>
          );
        })}
      </div>
    </div>
  );
}
