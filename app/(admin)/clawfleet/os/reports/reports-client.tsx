"use client";

/**
 * ตู้คีบ OS — รายงาน (Reports) · client
 * 2-col grid บนคอม (stack บนมือถือ): ตู้ที่มีปัญหา + สินค้าใกล้หมด
 * แล้ว full-width ตาราง คุณภาพงานพนักงานเก็บเงิน.
 * ข้อมูลจริงมาจาก page.tsx; ถ้าว่าง → SAMPLE + แบนเนอร์ amber.
 * design ref: ระบบตู้คีบ.dc.html 864–900
 */

import { AlertTriangle, Boxes, PackageSearch, ShieldCheck } from "lucide-react";
import { Card, Pill, IconBox, EmptyState } from "@/components/clawfleet/os/kit";
import { num, pnlTone, type PnlFlagKey, type Tone } from "@/components/clawfleet/os/format";
import type { MemberStatus } from "@/lib/clawfleet/admin-queries";

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

/* ── SAMPLE fallback (เมื่อ DB ว่าง) — ตัวเลขสไตล์ design ── */
const SAMPLE_PROBLEMS: ProblemBranch[] = [
  { branchId: "s5", name: "นนทบุรี", code: "NB", flag: "HIGH", riskyMachines: 3, avgBahtPerDoll: 410 },
  { branchId: "s1", name: "รังสิต", code: "RS", flag: "LOW", riskyMachines: 2, avgBahtPerDoll: 168 },
  { branchId: "s7", name: "สมุทรปราการ", code: "SP", flag: "LOW", riskyMachines: 2, avgBahtPerDoll: 178 },
  { branchId: "s4", name: "บางนา", code: "BN", flag: "AMBER", riskyMachines: 1, avgBahtPerDoll: 268 },
  { branchId: "s3", name: "บางแค", code: "BK", flag: "AMBER", riskyMachines: 1, avgBahtPerDoll: 322 },
];
const SAMPLE_STAFF: StaffQualityRow[] = [
  { id: "ss1", name: "สมชาย ใจดี", role: "staff", branchName: "รังสิต", status: "active", rounds: 24, mismatch: 0 },
  { id: "ss2", name: "วิภา แสงทอง", role: "staff", branchName: "ลาดพร้าว", status: "active", rounds: 21, mismatch: 1 },
  { id: "ss3", name: "ณัฐพล มั่นคง", role: "branch_manager", branchName: "บางแค", status: "active", rounds: 19, mismatch: 2 },
  { id: "ss4", name: "ปนัดดา ทองคำ", role: "staff", branchName: "บางนา", status: "active", rounds: 17, mismatch: 4 },
  { id: "ss5", name: "กิตติ ศรีสุข", role: "staff", branchName: "นนทบุรี", status: "invited", rounds: 0, mismatch: 0 },
];

/* สินค้าใกล้หมด — SAMPLE fallback (ใช้เมื่อ DB ว่าง) */
const SAMPLE_LOW_STOCK: LowStockItem[] = [
  { name: "หมีบราวน์ ไซต์ L", loc: "คลังกลาง", qty: 2, reorderLevel: 8 },
  { name: "ไดโนเสาร์เขียว", loc: "คลังกลาง", qty: 4, reorderLevel: 8 },
  { name: "แมวเหมียวชมพู", loc: "รังสิต", qty: 6, reorderLevel: 8 },
  { name: "ยูนิคอร์น พาสเทล", loc: "ลาดพร้าว", qty: 7, reorderLevel: 8 },
];

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

export function ReportsClient({
  problemBranches,
  staffQuality,
  lowStock: lowStockReal,
}: {
  problemBranches: ProblemBranch[];
  staffQuality: StaffQualityRow[];
  lowStock: LowStockItem[];
}) {
  const empty = problemBranches.length === 0 && staffQuality.length === 0;
  const problems = problemBranches.length === 0 ? SAMPLE_PROBLEMS : problemBranches;
  const staff = staffQuality.length === 0 ? SAMPLE_STAFF : staffQuality;
  // ข้อมูลจริง · ใช้ SAMPLE เฉพาะตอนทั้งระบบยังว่าง (ไม่มีสาขา/staff)
  const lowStock = empty && lowStockReal.length === 0 ? SAMPLE_LOW_STOCK : lowStockReal;

  return (
    <div>
      {empty && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", background: "#FCF8EC", border: "1px solid #F0E2BE", borderRadius: 10, padding: "9px 14px", marginBottom: 16, fontSize: 12, color: "#7A5510" }}>
          <AlertTriangle size={15} /> ยังไม่มีข้อมูลจริงในระบบ — กำลังแสดง<b> ตัวอย่าง</b> เพื่อให้เห็นภาพ (จะเปลี่ยนเป็นข้อมูลจริงเมื่อเริ่มเก็บเงิน)
        </div>
      )}

      {/* ── 2-col: ตู้ที่มีปัญหา + สินค้าใกล้หมด ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[18px] mb-[18px]">
        <Card title="สาขา/ตู้ที่มีปัญหา" sub="ธงเสี่ยง · ตั้งค่าตู้ผิด · ต้องเข้าไปดู">
          {problems.length === 0 ? (
            <EmptyState icon={<ShieldCheck size={26} />} title="ทุกสาขาอยู่ในเกณฑ์ดี" sub="ไม่มีตู้ที่ต้องเข้าไปตรวจตอนนี้" />
          ) : (
            problems.map((p, i) => {
              const t = pnlTone(p.flag);
              const accent = t.tone === "red" ? "#B42318" : t.tone === "amber" ? "#B45309" : "#9AA1AB";
              return (
                <div
                  key={p.branchId}
                  className="co-accent-l"
                  style={{ "--co-accent": accent, display: "flex", alignItems: "center", gap: 11, padding: "11px 0 11px 13px", borderBottom: i === problems.length - 1 ? "none" : "1px solid #F4F5F7" } as React.CSSProperties}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>
                      {p.name} <span style={{ fontWeight: 400, color: "#9AA1AB", fontSize: 12 }} className="num">· {p.code}</span>
                    </div>
                    <div style={{ fontSize: 11.5, color: "#8A909A" }}>{problemIssue(p)}</div>
                  </div>
                  <Pill tone={t.tone}>{t.label}</Pill>
                </div>
              );
            })
          )}
        </Card>

        <Card title="สินค้าใกล้หมด · ต้องสั่งเพิ่ม" sub={`ตุ๊กตาต่ำกว่าจุดสั่งเติม (≤ ${SAMPLE_LOW_STOCK[0].reorderLevel} ชิ้น)`} right={<IconBox tone="amber" size={28} radius={8}><Boxes size={15} /></IconBox>}>
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
      <Card title="คุณภาพงานพนักงานเก็บเงิน" sub={`${num(staff.length)} คน · เรียงตามรายชื่อ`} pad={false}>
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
              return (
                <div key={st.id} className="co-rowh" style={{ display: "grid", gridTemplateColumns: "1.4fr 1.6fr 0.8fr 1fr 0.9fr", padding: "13px 20px", alignItems: "center", borderBottom: "1px solid #F4F5F7", fontSize: 13 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                    <span style={{ width: 30, height: 30, flex: "0 0 30px", borderRadius: "50%", background: "#EDEBFB", color: "#4F46E5", fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center" }}>{initial(st.name)}</span>
                    <span style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{st.name}</span>
                  </span>
                  <span style={{ color: "#6B7280", fontSize: 12 }}>{st.branchName}</span>
                  <span className="num" style={{ textAlign: "right" }}>{st.rounds == null ? "—" : num(st.rounds)}</span>
                  <span className="num" style={{ textAlign: "right", fontWeight: 700, color: mmColor }}>{st.mismatch == null ? "—" : `${num(st.mismatch)} ครั้ง`}</span>
                  <span style={{ textAlign: "right" }}><Pill tone={q.tone}>{q.label}</Pill></span>
                </div>
              );
            })}
          </div>
        </div>
        {staffQuality.length > 0 && (
          <div style={{ padding: "10px 20px", fontSize: 10.5, color: "#9AA1AB", fontStyle: "italic", borderTop: "1px solid #F4F5F7" }}>
            * &quot;รอบเก็บ&quot; = จำนวนรอบที่ปิดในรอบ 30 วัน · &quot;ยอดไม่ตรง&quot; = ครั้งที่เก็บแล้วยอดเงิน/ตุ๊กตาไม่ตรง (30 วัน)
          </div>
        )}
      </Card>
    </div>
  );
}
