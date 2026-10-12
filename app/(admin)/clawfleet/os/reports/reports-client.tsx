"use client";

/**
 * ตู้คีบ OS — รายงาน (Reports) · client
 * 2-col grid บนคอม (stack บนมือถือ): ตู้ที่มีปัญหา + สินค้าใกล้หมด
 * แล้ว full-width ตาราง คุณภาพงานพนักงานเก็บเงิน.
 * ข้อมูลจริงมาจาก page.tsx; ถ้าว่าง → empty-state ตรง ๆ ต่อการ์ด (ไม่มี SAMPLE/fake data substitute —
 * CEO 2026-10-12: ของปลอม "นนทบุรี"/NB ฯลฯ ทำ CEO ตกใจคิดว่าสาขาจริงหาย).
 * design ref: ระบบตู้คีบ.dc.html 864–900
 */

import Link from "next/link";
import { Boxes, ChevronRight, Download, PackageSearch, ShieldCheck, Store, Users2 } from "lucide-react";
import { Card, Pill, IconBox, EmptyState } from "@/components/clawfleet/os/kit";
import { num, pnlTone, type PnlFlagKey, type Tone } from "@/components/clawfleet/os/format";
import type { MemberStatus } from "@/lib/clawfleet/admin-queries";
import { buildCsv } from "@/lib/clawfleet/csv";

export type ProblemBranch = {
  branchId: string;
  name: string;
  code: string;
  flag: PnlFlagKey;
  riskyMachines: number;
  avgBahtPerDoll: number | null;
};
export type StaffQualityRow = {
  id: string;
  name: string;
  role: string;
  branchName: string;
  status: MemberStatus;
  /** จำนวนรอบเก็บเงินที่ปิดในช่วง 30 วัน (จริง) */
  rounds: number | null;
  /** จำนวนครั้งยอดไม่ตรง 30 วัน (จริง · event anomaly + รอบ review) */
  mismatch: number | null;
};
export type LowStockItem = {
  name: string;
  /** สาขาที่ใกล้หมด */
  loc: string;
  /** คงคลังในคลังสาขา */
  qty: number;
  /** จุดสั่งเติม */
  reorderLevel: number;
};

/* ── สถานะพนักงาน → pill ── */
function statusPill(s: MemberStatus): { tone: Tone; label: string } {
  if (s === "active") return { tone: "green", label: "ทำงานปกติ" };
  if (s === "invited") return { tone: "amber", label: "รอเข้าระบบ" };
  return { tone: "neutral", label: "ปิดใช้งาน" };
}

/* ── สถานะคุณภาพจากจำนวนยอดไม่ตรง ── */
function qualityPill(mismatch: number | null, status: MemberStatus): { tone: Tone; label: string } {
  if (mismatch == null) return statusPill(status);
  if (mismatch === 0) return { tone: "green", label: "ดีเยี่ยม" };
  if (mismatch <= 2) return { tone: "amber", label: "ต้องจับตา" };
  return { tone: "red", label: "ต้องตรวจสอบ" };
}

function initial(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

// NOTE (CEO 2026-10-12): เดิมมี SAMPLE_PROBLEMS/SAMPLE_STAFF/SAMPLE_LOW_STOCK โชว์แทนของจริงตอน DB ว่าง
// (ชื่อสาขาปลอม "นนทบุรี"/NB ฯลฯ + เลขที่ดูเหมือนจริง) — ตัดทิ้งทั้งหมด → ว่าง = empty-state จริงเสมอ
// (ดู EmptyState ต่อการ์ดด้านล่าง) ไม่โชว์ของปลอมอีก.

/** สีเตือนตามความใกล้หมด: ยิ่งต่ำเทียบ reorder ยิ่งแดงเข้ม */
function lowStockColor(qty: number, reorder: number): string {
  if (qty <= Math.ceil(reorder / 2)) return "#B42318"; // วิกฤต (≤ ครึ่งของจุดสั่งเติม)
  return "#B45309"; // ใกล้หมด
}

function problemIssue(p: ProblemBranch): string {
  const t = pnlTone(p.flag);
  const avg = p.avgBahtPerDoll == null ? "—" : `฿${p.avgBahtPerDoll}/ตัว`;
  const risky = p.riskyMachines > 0 ? ` · ${p.riskyMachines} ตู้เสี่ยง` : "";
  return `${t.label} · เฉลี่ย ${avg}${risky}`;
}

/* ── color legend — อธิบายความหมายของสีในตาราง (เขียว/เหลือง/แดง) ── */
function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
      <span style={{ width: 9, height: 9, borderRadius: "50%", background: color, display: "inline-block" }} />
      {label}
    </span>
  );
}
function ColorLegend() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginBottom: 12, fontSize: 11, color: "#8A909A" }}>
      <LegendDot color="#15803D" label="เขียว = ปกติ/ดี" />
      <LegendDot color="#B45309" label="เหลือง = ต้องจับตา" />
      <LegendDot color="#B42318" label="แดง = ต้องเข้าไปตรวจ" />
    </div>
  );
}

/* ── ดาวน์โหลด CSV (client · Blob) — ใช้ buildCsv (มี BOM ให้ Excel เปิดไทยได้) ── */
function downloadCsv(filename: string, csv: string) {
  try {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch {
    window.alert("ดาวน์โหลดไฟล์ไม่สำเร็จ ลองใหม่อีกครั้ง");
  }
}

/** วันที่วันนี้แบบ YYYY-MM-DD สำหรับตั้งชื่อไฟล์ */
function todayStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** ปุ่มดาวน์โหลด CSV เล็ก ๆ ใช้บนหัวการ์ด (disabled ถ้าเป็นข้อมูลตัวอย่าง) */
function CsvButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? "ยังไม่มีข้อมูลจริงให้ดาวน์โหลด" : "ดาวน์โหลดเป็นไฟล์ Excel (CSV)"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 12,
        fontWeight: 600,
        color: disabled ? "#B6BBC4" : "#4F46E5",
        background: disabled ? "#F4F5F7" : "#EEF0FF",
        border: `1px solid ${disabled ? "#E3E6EA" : "#DDE0FB"}`,
        borderRadius: 8,
        padding: "6px 11px",
        cursor: disabled ? "not-allowed" : "pointer",
        whiteSpace: "nowrap",
      }}
    >
      <Download size={13} /> ดาวน์โหลด CSV
    </button>
  );
}

export function ReportsClient({
  problemBranches,
  staffQuality,
  lowStock: lowStockReal,
}: {
  problemBranches: ProblemBranch[];
  staffQuality: StaffQualityRow[];
  lowStock: LowStockItem[];
}) {
  // ข้อมูลจริงล้วน — ว่าง = empty-state จริงต่อการ์ด (ดูด้านล่าง) ไม่มี SAMPLE fallback อีกแล้ว
  const problems = problemBranches;
  const staff = staffQuality;
  const lowStock = lowStockReal;

  // ── CSV export: สร้างจากข้อมูลจริงเท่านั้น (ปุ่ม disabled เมื่อเป็นตัวอย่าง) ──
  function exportProblems() {
    const csv = buildCsv(
      [
        { key: "name", label: "สาขา" },
        { key: "code", label: "รหัสสาขา" },
        { key: "status", label: "สถานะ" },
        { key: "avg", label: "เฉลี่ยบาท/ตุ๊กตา" },
        { key: "risky", label: "ตู้เสี่ยง" },
      ],
      problemBranches.map((p) => ({
        name: p.name,
        code: p.code,
        status: pnlTone(p.flag).label,
        avg: p.avgBahtPerDoll ?? "",
        risky: p.riskyMachines,
      })),
    );
    downloadCsv(`clawos-สาขาที่มีปัญหา-${todayStamp()}.csv`, csv);
  }

  function exportStaff() {
    const csv = buildCsv(
      [
        { key: "name", label: "พนักงาน" },
        { key: "branch", label: "เส้นทาง/ดูแล" },
        { key: "rounds", label: "รอบเก็บ (30 วัน)" },
        { key: "mismatch", label: "ยอดไม่ตรง (ครั้ง)" },
        { key: "status", label: "สถานะคุณภาพ" },
      ],
      staffQuality.map((st) => ({
        name: st.name,
        branch: st.branchName,
        rounds: st.rounds ?? "",
        mismatch: st.mismatch ?? "",
        status: qualityPill(st.mismatch, st.status).label,
      })),
    );
    downloadCsv(`clawos-คุณภาพพนักงาน-${todayStamp()}.csv`, csv);
  }

  return (
    <div>
      {/* ── แกลเลอรีตู้ (รายงานใหม่ · กดเข้าดูตู้ทุกตู้พร้อมรูป) ── */}
      <Link
        href="/clawfleet/os/reports/gallery"
        className="co-card co-rowlink"
        style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 20px", marginBottom: 18, textDecoration: "none", color: "inherit" }}
      >
        <IconBox tone="brand" size={40} radius={11}><Store size={19} /></IconBox>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: "#1A1D21" }}>แกลเลอรีตู้ · ดูสินค้าในตู้แต่ละสาขา</div>
          <div style={{ fontSize: 12, color: "#8A909A", marginTop: 2 }}>
            เลือกสาขา → เห็นตู้ทุกตู้พร้อมรูป · สินค้าในตู้ · ราคาเล่น · ทุนรวม เหมือนเดินดูหน้าร้าน
          </div>
        </div>
        <ChevronRight size={18} color="#C2C7CF" />
      </Link>

      {/* ── 2-col: ตู้ที่มีปัญหา + สินค้าใกล้หมด ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[18px] mb-[18px]">
        <Card title="สาขา/ตู้ที่มีปัญหา" sub="ธงเสี่ยง · ตั้งค่าตู้ผิด · ต้องเข้าไปดู" right={<CsvButton onClick={exportProblems} disabled={problems.length === 0} />}>
          <ColorLegend />
          {problems.length === 0 ? (
            <EmptyState icon={<ShieldCheck size={26} />} title="ทุกสาขาอยู่ในเกณฑ์ดี" sub="ไม่มีตู้ที่ต้องเข้าไปตรวจตอนนี้" />
          ) : (
            problems.map((p, i) => {
              const t = pnlTone(p.flag);
              const accent = t.tone === "red" ? "#B42318" : t.tone === "amber" ? "#B45309" : "#9AA1AB";
              const rowStyle = { "--co-accent": accent, display: "flex", alignItems: "center", gap: 11, padding: "11px 0 11px 13px", borderBottom: i === problems.length - 1 ? "none" : "1px solid #F4F5F7", textDecoration: "none", color: "inherit" } as React.CSSProperties;
              return (
                <Link key={p.branchId} href={`/clawfleet/os/matrix?branch=${encodeURIComponent(p.code)}`} className="co-accent-l co-rowlink" style={rowStyle}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>
                      {p.name} <span style={{ fontWeight: 400, color: "#9AA1AB", fontSize: 12 }} className="num">· {p.code}</span>
                    </div>
                    <div style={{ fontSize: 11.5, color: "#8A909A" }}>{problemIssue(p)}</div>
                  </div>
                  <Pill tone={t.tone}>{t.label}</Pill>
                  <ChevronRight size={16} style={{ color: "#C5C9D0", flex: "0 0 16px" }} />
                </Link>
              );
            })
          )}
        </Card>

        <Card title="สินค้าใกล้หมด · ต้องสั่งเพิ่ม" sub="ตุ๊กตาต่ำกว่าจุดสั่งเติมของสินค้านั้น ๆ" right={<IconBox tone="amber" size={28} radius={8}><Boxes size={15} /></IconBox>}>
          {lowStock.length === 0 ? (
            <EmptyState icon={<PackageSearch size={26} />} title="ไม่มีสินค้าใกล้หมด" sub="คลังทุกสาขาอยู่เหนือจุดสั่งเติม" />
          ) : (
            lowStock.map((s, i) => {
              const accent = lowStockColor(s.qty, s.reorderLevel);
              return (
                <div
                  key={`${s.loc}-${s.name}`}
                  className="co-accent-l"
                  style={{ "--co-accent": accent, display: "flex", alignItems: "center", gap: 11, padding: "11px 0 11px 13px", borderBottom: i === lowStock.length - 1 ? "none" : "1px solid #F4F5F7" } as React.CSSProperties}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.name}</div>
                    <div style={{ fontSize: 11.5, color: "#9AA1AB" }}>{s.loc} · จุดสั่งเติม {num(s.reorderLevel)}</div>
                  </div>
                  <span className="num" style={{ fontSize: 14, fontWeight: 700, color: accent, whiteSpace: "nowrap" }}>{num(s.qty)} ชิ้น</span>
                </div>
              );
            })
          )}
        </Card>
      </div>

      {/* ── full-width: คุณภาพงานพนักงานเก็บเงิน ── */}
      <Card title="คุณภาพงานพนักงานเก็บเงิน" sub={`${num(staff.length)} คน · เรียงตามยอดไม่ตรงมากสุด`} pad={false} right={<CsvButton onClick={exportStaff} disabled={staff.length === 0} />}>
        <div style={{ padding: "12px 20px 0" }}><ColorLegend /></div>
        {staff.length === 0 ? (
          <EmptyState icon={<Users2 size={26} />} title="ยังไม่มีพนักงานเก็บเงิน" sub="เชิญพนักงานเข้าสาขาก่อน แล้วรายงานคุณภาพงานจะแสดงผล" />
        ) : (
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 640 }}>
            <div className="co-eyebrow" style={{ display: "grid", gridTemplateColumns: "1.4fr 1.6fr 0.8fr 1fr 0.9fr", padding: "10px 20px", borderBottom: "1px solid #F4F5F7" }}>
              <span>พนักงาน</span>
              <span>เส้นทาง/ดูแล</span>
              <span style={{ textAlign: "right" }}>รอบเก็บ</span>
              <span style={{ textAlign: "right" }}>ยอดไม่ตรง</span>
              <span style={{ textAlign: "right" }}>สถานะ</span>
            </div>
            {staff.map((st) => {
              const q = qualityPill(st.mismatch, st.status);
              const mmColor = st.mismatch == null ? "#9AA1AB" : st.mismatch === 0 ? "#15803D" : st.mismatch <= 2 ? "#B45309" : "#B42318";
              const rowStyle = { display: "grid", gridTemplateColumns: "1.4fr 1.6fr 0.8fr 1fr 0.9fr", padding: "13px 20px", alignItems: "center", borderBottom: "1px solid #F4F5F7", fontSize: 13, textDecoration: "none", color: "inherit" } as React.CSSProperties;
              return (
                <Link key={st.id} href="/clawfleet/os/collections" className="co-rowh co-rowlink" title={`ดูรอบตรวจเงินของ ${st.name}`} style={rowStyle}>
                  <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                    <span style={{ width: 30, height: 30, flex: "0 0 30px", borderRadius: "50%", background: "#EDEBFB", color: "#4F46E5", fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center" }}>{initial(st.name)}</span>
                    <span style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "flex", alignItems: "center" }}>{st.name}</span>
                  </span>
                  <span style={{ color: "#6B7280", fontSize: 12 }}>{st.branchName}</span>
                  <span className="num" style={{ textAlign: "right" }}>{st.rounds == null ? "—" : num(st.rounds)}</span>
                  <span className="num" style={{ textAlign: "right", fontWeight: 700, color: mmColor }}>{st.mismatch == null ? "—" : `${num(st.mismatch)} ครั้ง`}</span>
                  <span style={{ textAlign: "right" }}><Pill tone={q.tone}>{q.label}</Pill></span>
                </Link>
              );
            })}
          </div>
        </div>
        )}
        <div style={{ padding: "10px 20px", fontSize: 10.5, color: "#9AA1AB", fontStyle: "italic", borderTop: "1px solid #F4F5F7" }}>
          * &quot;รอบเก็บ&quot; = จำนวนรอบที่ปิดในรอบ 30 วัน · &quot;ยอดไม่ตรง&quot; = รอบที่ถูกตัดสินว่าผิดจริง/ต้องสอบ (30 วัน · ไม่นับรอบที่อนุมัติผ่านแล้ว)
        </div>
      </Card>
    </div>
  );
}
