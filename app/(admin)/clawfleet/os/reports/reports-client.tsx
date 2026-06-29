"use client";

/**
 * ตู้คีบ OS — รายงาน (Reports) · client
 * 2-col grid บนคอม (stack บนมือถือ): ตู้ที่มีปัญหา + สินค้าใกล้หมด
 * แล้ว full-width ตาราง คุณภาพงานพนักงานเก็บเงิน.
 * ข้อมูลจริงมาจาก page.tsx; ถ้าว่าง → SAMPLE + แบนเนอร์ amber.
 * design ref: ระบบตู้คีบ.dc.html 864–900
 */

import { AlertTriangle, Boxes } from "lucide-react";
import { Card, Pill, IconBox } from "@/components/clawfleet/os/kit";
import { num, pnlTone, type PnlFlagKey, type Tone } from "@/components/clawfleet/os/format";
import type { MemberStatus } from "@/lib/clawfleet/v2-admin-queries";

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
  /** จำนวนรอบเก็บเงิน — null = ยังไม่มี metric จริง (ดู gap) */
  rounds: number | null;
  /** จำนวนครั้งยอดไม่ตรง — null = ยังไม่มี metric จริง (ดู gap) */
  mismatch: number | null;
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

/* สินค้าใกล้หมด — SAMPLE ทั้งหมด (ยังไม่มี aggregate ต่ำกว่า reorder จาก backend · ดู gap) */
const SAMPLE_LOW_STOCK: { name: string; loc: string; qty: number; color: string }[] = [
  { name: "หมีบราวน์ ไซต์ L", loc: "คลังกลาง", qty: 8, color: "#B42318" },
  { name: "ไดโนเสาร์เขียว", loc: "คลังกลาง", qty: 14, color: "#B45309" },
  { name: "แมวเหมียวชมพู", loc: "รังสิต", qty: 19, color: "#B45309" },
  { name: "ยูนิคอร์น พาสเทล", loc: "ลาดพร้าว", qty: 22, color: "#B45309" },
];

function problemIssue(p: ProblemBranch): string {
  const t = pnlTone(p.flag);
  const avg = p.avgBahtPerDoll == null ? "—" : `฿${p.avgBahtPerDoll}/ตัว`;
  const risky = p.riskyMachines > 0 ? ` · ${p.riskyMachines} ตู้เสี่ยง` : "";
  return `${t.label} · เฉลี่ย ${avg}${risky}`;
}

export function ReportsClient({
  problemBranches,
  staffQuality,
}: {
  problemBranches: ProblemBranch[];
  staffQuality: StaffQualityRow[];
}) {
  const empty = problemBranches.length === 0 && staffQuality.length === 0;
  const problems = problemBranches.length === 0 ? SAMPLE_PROBLEMS : problemBranches;
  const staff = staffQuality.length === 0 ? SAMPLE_STAFF : staffQuality;
  const lowStock = SAMPLE_LOW_STOCK; // backend gap — ดู briefing

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
            <div style={{ fontSize: 12.5, color: "#9AA1AB", padding: "8px 0" }}>ทุกสาขาอยู่ในเกณฑ์ดี — ไม่มีตู้ที่ต้องตรวจ</div>
          ) : (
            problems.map((p, i) => {
              const t = pnlTone(p.flag);
              return (
                <div key={p.branchId} style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 0", borderBottom: i === problems.length - 1 ? "none" : "1px solid #F4F5F7" }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: pnlTone(p.flag).tone === "red" ? "#B42318" : pnlTone(p.flag).tone === "amber" ? "#B45309" : "#9AA1AB", flex: "0 0 8px" }} />
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

        <Card title="สินค้าใกล้หมด · ต้องสั่งเพิ่ม" sub="ตุ๊กตาต่ำกว่าจุดสั่งเติม" right={<IconBox tone="amber" size={28} radius={8}><Boxes size={15} /></IconBox>}>
          {lowStock.map((s, i) => (
            <div key={s.name} style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 0", borderBottom: i === lowStock.length - 1 ? "none" : "1px solid #F4F5F7" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.name}</div>
                <div style={{ fontSize: 11.5, color: "#9AA1AB" }}>{s.loc}</div>
              </div>
              <span className="num" style={{ fontSize: 14, fontWeight: 700, color: s.color, whiteSpace: "nowrap" }}>{num(s.qty)} ชิ้น</span>
            </div>
          ))}
          <div style={{ marginTop: 10, fontSize: 10.5, color: "#9AA1AB", fontStyle: "italic" }}>* ตัวอย่าง — ยังไม่ได้เชื่อมจุดสั่งเติมจริง</div>
        </Card>
      </div>

      {/* ── full-width: คุณภาพงานพนักงานเก็บเงิน ── */}
      <Card title="คุณภาพงานพนักงานเก็บเงิน" sub={`${num(staff.length)} คน · เรียงตามรายชื่อ`} pad={false}>
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 640 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1.6fr 0.8fr 1fr 0.9fr", padding: "10px 20px", fontSize: 11, fontWeight: 600, color: "#9AA1AB", borderBottom: "1px solid #F4F5F7" }}>
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
            * &quot;รอบเก็บ&quot; และ &quot;ยอดไม่ตรง&quot; ต่อคน ยังไม่มี metric จริง (แสดง —) — ดูได้จากหน้าเก็บเงิน/ตรวจสอบ
          </div>
        )}
      </Card>
    </div>
  );
}
