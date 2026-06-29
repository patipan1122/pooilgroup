"use client";

/**
 * ตู้คีบ OS — พนักงาน (Staff) · client
 * ตารางพนักงาน: avatar+ชื่อ / ตำแหน่ง / เส้นทาง-ดูแล / รอบเก็บ / ยอดไม่ตรง / สถานะ.
 * ข้อมูลจริงจาก page.tsx (getTeamData); ถ้าว่าง → SAMPLE + แบนเนอร์ amber.
 * design ref: ระบบตู้คีบ.dc.html 902–917
 */

import { AlertTriangle } from "lucide-react";
import { Card, Pill } from "@/components/clawfleet/os/kit";
import { num, type Tone } from "@/components/clawfleet/os/format";
import type { MemberStatus } from "@/lib/clawfleet/v2-admin-queries";

export type StaffRow = {
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

const ROLE_TH: Record<string, string> = {
  org_admin: "ผู้ดูแลระบบ",
  program_admin: "ผู้ดูแลโปรแกรม",
  branch_manager: "ผู้จัดการสาขา",
  staff: "พนักงานเก็บเงิน",
  viewer: "ผู้ชม",
};
function roleLabel(r: string): string {
  return ROLE_TH[r] ?? "พนักงานเก็บเงิน";
}

function statusPill(s: MemberStatus): { tone: Tone; label: string } {
  if (s === "active") return { tone: "green", label: "ทำงานปกติ" };
  if (s === "invited") return { tone: "amber", label: "รอเข้าระบบ" };
  return { tone: "neutral", label: "ปิดใช้งาน" };
}

function initial(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

/* ── SAMPLE fallback (เมื่อ DB ว่าง) ── */
const SAMPLE_STAFF: StaffRow[] = [
  { id: "ss1", name: "สมชาย ใจดี", role: "staff", branchName: "รังสิต", status: "active", rounds: 24, mismatch: 0 },
  { id: "ss2", name: "วิภา แสงทอง", role: "staff", branchName: "ลาดพร้าว", status: "active", rounds: 21, mismatch: 1 },
  { id: "ss3", name: "ณัฐพล มั่นคง", role: "branch_manager", branchName: "บางแค", status: "active", rounds: 19, mismatch: 2 },
  { id: "ss4", name: "ปนัดดา ทองคำ", role: "staff", branchName: "บางนา", status: "active", rounds: 17, mismatch: 4 },
  { id: "ss5", name: "กิตติ ศรีสุข", role: "staff", branchName: "นนทบุรี", status: "invited", rounds: 0, mismatch: 0 },
  { id: "ss6", name: "อรทัย พงษ์ไพร", role: "org_admin", branchName: "ทุกสาขา", status: "active", rounds: 0, mismatch: 0 },
];

export function StaffClient({ staff, totalStaff }: { staff: StaffRow[]; totalStaff: number }) {
  const empty = staff.length === 0;
  const rows = empty ? SAMPLE_STAFF : staff;
  const count = empty ? rows.length : totalStaff;
  const hasRealMetrics = !empty && rows.some((r) => r.rounds != null);

  return (
    <div>
      {empty && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", background: "#FCF8EC", border: "1px solid #F0E2BE", borderRadius: 10, padding: "9px 14px", marginBottom: 16, fontSize: 12, color: "#7A5510" }}>
          <AlertTriangle size={15} /> ยังไม่มีพนักงานในระบบ — กำลังแสดง<b> ตัวอย่าง</b> เพื่อให้เห็นภาพ (เพิ่มพนักงานได้ที่หน้าตั้งค่า)
        </div>
      )}

      <Card title="พนักงานทั้งหมด" sub={`${num(count)} คน · ทุกสาขา`} pad={false}>
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 720 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1.2fr 1.6fr 0.8fr 1fr 0.9fr", padding: "12px 22px", fontSize: 11, fontWeight: 600, color: "#9AA1AB", borderBottom: "1px solid #F4F5F7" }}>
              <span>พนักงาน</span>
              <span>ตำแหน่ง</span>
              <span>เส้นทาง/ดูแล</span>
              <span style={{ textAlign: "right" }}>รอบเก็บ</span>
              <span style={{ textAlign: "right" }}>ยอดไม่ตรง</span>
              <span style={{ textAlign: "right" }}>สถานะ</span>
            </div>
            {rows.map((st) => {
              const s = statusPill(st.status);
              const mmColor = st.mismatch == null ? "#9AA1AB" : st.mismatch === 0 ? "#15803D" : st.mismatch <= 2 ? "#B45309" : "#B42318";
              return (
                <div key={st.id} className="co-rowh" style={{ display: "grid", gridTemplateColumns: "1.4fr 1.2fr 1.6fr 0.8fr 1fr 0.9fr", padding: "15px 22px", alignItems: "center", borderBottom: "1px solid #F4F5F7", fontSize: 13 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
                    <span style={{ width: 34, height: 34, flex: "0 0 34px", borderRadius: "50%", background: "#EDEBFB", color: "#4F46E5", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center" }}>{initial(st.name)}</span>
                    <span style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{st.name}</span>
                  </span>
                  <span style={{ color: "#6B7280", fontSize: 12.5 }}>{roleLabel(st.role)}</span>
                  <span style={{ color: "#6B7280", fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{st.branchName}</span>
                  <span className="num" style={{ textAlign: "right" }}>{st.rounds == null ? "—" : num(st.rounds)}</span>
                  <span className="num" style={{ textAlign: "right", fontWeight: 700, color: mmColor }}>{st.mismatch == null ? "—" : `${num(st.mismatch)} ครั้ง`}</span>
                  <span style={{ textAlign: "right" }}><Pill tone={s.tone}>{s.label}</Pill></span>
                </div>
              );
            })}
          </div>
        </div>
        {!hasRealMetrics && !empty && (
          <div style={{ padding: "10px 22px", fontSize: 10.5, color: "#9AA1AB", fontStyle: "italic", borderTop: "1px solid #F4F5F7" }}>
            * &quot;รอบเก็บ&quot; และ &quot;ยอดไม่ตรง&quot; ต่อคน ยังไม่มี metric จริง (แสดง —) — ดูได้จากหน้าเก็บเงิน/ตรวจสอบ
          </div>
        )}
      </Card>
    </div>
  );
}
