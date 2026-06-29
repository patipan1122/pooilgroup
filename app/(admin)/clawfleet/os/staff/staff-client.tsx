"use client";

/**
 * ตู้คีบ OS — พนักงาน (Staff) · client
 * ตารางพนักงาน: avatar+ชื่อ / ตำแหน่ง / เส้นทาง-ดูแล / รอบเก็บ / ยอดไม่ตรง / สถานะ / จัดการ.
 * + จัดการทีมในหน้าเดียว (admin เท่านั้น): เพิ่มพนักงาน(เชิญ) · แก้สิทธิ์ · ปิดใช้ · สร้างลิงก์เชิญใหม่.
 * ข้อมูลจริงจาก page.tsx (getTeamData); ถ้าว่าง → SAMPLE + แบนเนอร์ amber (จัดการปิดในโหมดตัวอย่าง).
 * design ref: settings-client.tsx + ระบบตู้คีบ.dc.html 902–917
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Plus,
  Copy,
  Check,
  RefreshCw,
  UserMinus,
  Link2,
} from "lucide-react";
import { Card, Pill, Modal } from "@/components/clawfleet/os/kit";
import { num, type Tone } from "@/components/clawfleet/os/format";
import type { MemberStatus } from "@/lib/clawfleet/v2-admin-queries";
import {
  inviteCfStaff,
  updateCfStaffRole,
  removeCfStaff,
  regenInviteLink,
} from "@/lib/clawfleet/team-actions";

export type BranchOpt = { id: string; name: string };

export type StaffRow = {
  id: string;
  name: string;
  role: string;
  /** branch ที่ใช้เป็น scope ตอนแก้สิทธิ์/เอาออก (row แรกของ user) */
  branchId: string;
  branchName: string;
  status: MemberStatus;
  /** จำนวนรอบเก็บเงิน — null = ยังไม่มี metric จริง (ดู gap) */
  rounds: number | null;
  /** จำนวนครั้งยอดไม่ตรง — null = ยังไม่มี metric จริง (ดู gap) */
  mismatch: number | null;
};

/** บทบาทที่กำหนดได้จากหน้านี้ (ตรงกับ CF_ASSIGNABLE_ROLES ใน team-actions) */
type AssignableRole = "staff" | "branch_manager" | "area_manager";
const ASSIGNABLE: { value: AssignableRole; label: string }[] = [
  { value: "staff", label: "พนักงานเก็บเงิน" },
  { value: "branch_manager", label: "ผจก.สาขา" },
  { value: "area_manager", label: "ผจก.เขต" },
];

const ROLE_TH: Record<string, string> = {
  org_admin: "ผู้ดูแลระบบ",
  super_admin: "ผู้ดูแลระบบ",
  admin: "ผู้ดูแลระบบ",
  program_admin: "ผู้ดูแลโปรแกรม",
  area_manager: "ผจก.เขต",
  branch_manager: "ผจก.สาขา",
  staff: "พนักงานเก็บเงิน",
  viewer: "ผู้ชม",
};
function roleLabel(r: string): string {
  return ROLE_TH[r] ?? "พนักงานเก็บเงิน";
}

/** บทบาทระดับแอดมินองค์กร — ห้ามแก้/ปิดจากหน้านี้ (จัดที่หน้าผู้ใช้ส่วนกลาง) */
const ADMIN_TIER_ROLES = new Set(["super_admin", "org_admin", "admin", "program_admin"]);

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
  { id: "ss1", name: "สมชาย ใจดี", role: "staff", branchId: "", branchName: "รังสิต", status: "active", rounds: 24, mismatch: 0 },
  { id: "ss2", name: "วิภา แสงทอง", role: "staff", branchId: "", branchName: "ลาดพร้าว", status: "active", rounds: 21, mismatch: 1 },
  { id: "ss3", name: "ณัฐพล มั่นคง", role: "branch_manager", branchId: "", branchName: "บางแค", status: "active", rounds: 19, mismatch: 2 },
  { id: "ss4", name: "ปนัดดา ทองคำ", role: "staff", branchId: "", branchName: "บางนา", status: "active", rounds: 17, mismatch: 4 },
  { id: "ss5", name: "กิตติ ศรีสุข", role: "staff", branchId: "", branchName: "นนทบุรี", status: "invited", rounds: 0, mismatch: 0 },
  { id: "ss6", name: "อรทัย พงษ์ไพร", role: "org_admin", branchId: "", branchName: "ทุกสาขา", status: "active", rounds: 0, mismatch: 0 },
];

/* ── inline button styles (ตรงธีม settings-client) ── */
const PRIMARY_BTN: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 600,
  color: "#fff", background: "#4F46E5", border: "none", padding: "9px 15px",
  borderRadius: 9, cursor: "pointer",
};
const GHOST_BTN: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 600,
  color: "#4F46E5", background: "transparent", border: "1px solid #D9DBFB",
  padding: "5px 9px", borderRadius: 7, cursor: "pointer", whiteSpace: "nowrap",
};
const DANGER_BTN: React.CSSProperties = {
  ...GHOST_BTN, color: "#B42318", border: "1px solid #F3D9D5",
};
const INPUT: React.CSSProperties = {
  width: "100%", fontSize: 13.5, padding: "9px 12px", borderRadius: 9,
  border: "1px solid #DFE2E8", background: "#fff", outline: "none",
};
const LABEL: React.CSSProperties = {
  fontSize: 12, fontWeight: 600, color: "#5A6270", marginBottom: 5, display: "block",
};

/** กล่องโชว์ลิงก์เชิญ + ปุ่มคัดลอก (reuse ทั้งฟอร์มเชิญ + regen) */
function InviteLinkBox({ url, name }: { url: string; name: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div style={{ background: "#F2FAF5", border: "1px solid #CDE9D7", borderRadius: 11, padding: "13px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 700, color: "#15803D", marginBottom: 8 }}>
        <Check size={15} /> สร้างลิงก์เชิญ &quot;{name}&quot; สำเร็จ
      </div>
      <div style={{ fontSize: 11.5, color: "#5A6270", marginBottom: 8 }}>
        ส่งลิงก์นี้ให้พนักงานเปิดเพื่อตั้งรหัสและเข้าระบบ (ลิงก์มีอายุ 48 ชั่วโมง)
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
        <input
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          style={{ ...INPUT, fontSize: 12, background: "#fff", flex: 1, minWidth: 0 }}
        />
        <button type="button" onClick={copy} style={{ ...PRIMARY_BTN, padding: "0 14px", background: copied ? "#15803D" : "#4F46E5" }}>
          {copied ? <Check size={15} /> : <Copy size={15} />}
          {copied ? "คัดลอกแล้ว" : "คัดลอกลิงก์"}
        </button>
      </div>
    </div>
  );
}

export function StaffClient({
  staff,
  totalStaff,
  branches,
  isAdmin,
}: {
  staff: StaffRow[];
  totalStaff: number;
  branches: BranchOpt[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const empty = staff.length === 0;
  const rows = empty ? SAMPLE_STAFF : staff;
  const count = empty ? rows.length : totalStaff;
  const hasRealMetrics = !empty && rows.some((r) => r.rounds != null);

  // จัดการทีมเปิดเฉพาะ admin + มีข้อมูลจริง (โหมดตัวอย่างปิด action เพราะ id ไม่จริง)
  const canManage = isAdmin && !empty;

  const [isPending, startTransition] = useTransition();

  /* ── invite modal state ── */
  const [openInvite, setOpenInvite] = useState(false);
  const [form, setForm] = useState<{ name: string; branchId: string; role: AssignableRole; email: string; phone: string }>({
    name: "",
    branchId: branches[0]?.id ?? "",
    role: "staff",
    email: "",
    phone: "",
  });
  const [inviteResult, setInviteResult] = useState<{ url: string; name: string } | null>(null);
  const [formErr, setFormErr] = useState<string | null>(null);

  /* ── per-row action state ── */
  const [rowErr, setRowErr] = useState<{ id: string; msg: string } | null>(null);
  const [regenResult, setRegenResult] = useState<{ id: string; url: string; name: string } | null>(null);

  function resetInvite() {
    setForm({ name: "", branchId: branches[0]?.id ?? "", role: "staff", email: "", phone: "" });
    setInviteResult(null);
    setFormErr(null);
  }
  function closeInvite() {
    setOpenInvite(false);
    // เคลียร์หลังปิด (ถ้าเพิ่งเชิญสำเร็จ → refresh ให้ตารางอัปเดต)
    if (inviteResult) router.refresh();
    resetInvite();
  }

  function submitInvite() {
    setFormErr(null);
    if (!form.name.trim()) { setFormErr("กรอกชื่อพนักงาน"); return; }
    if (!form.branchId) { setFormErr("เลือกสาขา"); return; }
    startTransition(async () => {
      const res = await inviteCfStaff({
        name: form.name.trim(),
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        branchId: form.branchId,
        role: form.role,
      });
      if (res.ok) {
        setInviteResult({ url: res.data.inviteUrl, name: res.data.name });
      } else {
        setFormErr(res.error);
      }
    });
  }

  function changeRole(row: StaffRow, role: AssignableRole) {
    if (role === row.role) return;
    setRowErr(null);
    startTransition(async () => {
      const res = await updateCfStaffRole(row.id, row.branchId, role);
      if (res.ok) router.refresh();
      else setRowErr({ id: row.id, msg: res.error });
    });
  }

  function disableMember(row: StaffRow) {
    if (!confirm(`เอา "${row.name}" ออกจากสาขานี้?\nถ้าไม่เหลือสาขา บัญชีจะถูกปิดใช้งาน`)) return;
    setRowErr(null);
    startTransition(async () => {
      const res = await removeCfStaff(row.id, row.branchId);
      if (res.ok) router.refresh();
      else setRowErr({ id: row.id, msg: res.error });
    });
  }

  function regen(row: StaffRow) {
    setRowErr(null);
    setRegenResult(null);
    startTransition(async () => {
      const res = await regenInviteLink(row.id);
      if (res.ok) setRegenResult({ id: row.id, url: res.data.inviteUrl, name: res.data.name });
      else setRowErr({ id: row.id, msg: res.error });
    });
  }

  // grid: เพิ่มคอลัมน์ "จัดการ" เฉพาะตอน admin จัดการได้
  const cols = canManage
    ? "1.4fr 1.1fr 1.4fr 0.7fr 0.9fr 0.85fr 1.5fr"
    : "1.4fr 1.2fr 1.6fr 0.8fr 1fr 0.9fr";
  const minW = canManage ? 900 : 720;

  return (
    <div>
      {empty && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", background: "#FCF8EC", border: "1px solid #F0E2BE", borderRadius: 10, padding: "9px 14px", marginBottom: 16, fontSize: 12, color: "#7A5510" }}>
          <AlertTriangle size={15} /> ยังไม่มีพนักงานในระบบ — กำลังแสดง<b> ตัวอย่าง</b> เพื่อให้เห็นภาพ{isAdmin ? " · กด “เพิ่มพนักงาน” เพื่อเชิญคนจริง" : ""}
        </div>
      )}

      <Card
        title="พนักงานทั้งหมด"
        sub={`${num(count)} คน · ทุกสาขา`}
        pad={false}
        right={
          isAdmin ? (
            <button
              type="button"
              onClick={() => { resetInvite(); setOpenInvite(true); }}
              style={PRIMARY_BTN}
            >
              <Plus size={15} /> เพิ่มพนักงาน
            </button>
          ) : undefined
        }
      >
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: minW }}>
            <div style={{ display: "grid", gridTemplateColumns: cols, padding: "12px 22px", fontSize: 11, fontWeight: 600, color: "#9AA1AB", borderBottom: "1px solid #F4F5F7" }}>
              <span>พนักงาน</span>
              <span>ตำแหน่ง</span>
              <span>เส้นทาง/ดูแล</span>
              <span style={{ textAlign: "right" }}>รอบเก็บ</span>
              <span style={{ textAlign: "right" }}>ยอดไม่ตรง</span>
              <span style={{ textAlign: canManage ? "left" : "right" }}>สถานะ</span>
              {canManage && <span style={{ textAlign: "right" }}>จัดการ</span>}
            </div>
            {rows.map((st) => {
              const s = statusPill(st.status);
              const mmColor = st.mismatch == null ? "#9AA1AB" : st.mismatch === 0 ? "#15803D" : st.mismatch <= 2 ? "#B45309" : "#B42318";
              const isProtectedRole = ADMIN_TIER_ROLES.has(st.role);
              const currentAssignable = ASSIGNABLE.some((a) => a.value === st.role) ? (st.role as AssignableRole) : "staff";
              return (
                <div key={st.id}>
                  <div className="co-rowh" style={{ display: "grid", gridTemplateColumns: cols, padding: "15px 22px", alignItems: "center", borderBottom: "1px solid #F4F5F7", fontSize: 13 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
                      <span style={{ width: 34, height: 34, flex: "0 0 34px", borderRadius: "50%", background: "#EDEBFB", color: "#4F46E5", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center" }}>{initial(st.name)}</span>
                      <span style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{st.name}</span>
                    </span>
                    <span style={{ color: "#6B7280", fontSize: 12.5 }}>{roleLabel(st.role)}</span>
                    <span style={{ color: "#6B7280", fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{st.branchName}</span>
                    <span className="num" style={{ textAlign: "right" }}>{st.rounds == null ? "—" : num(st.rounds)}</span>
                    <span className="num" style={{ textAlign: "right", fontWeight: 700, color: mmColor }}>{st.mismatch == null ? "—" : `${num(st.mismatch)} ครั้ง`}</span>
                    <span style={{ textAlign: canManage ? "left" : "right" }}><Pill tone={s.tone}>{s.label}</Pill></span>
                    {canManage && (
                      <span style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6, flexWrap: "wrap" }}>
                        {isProtectedRole ? (
                          <span style={{ fontSize: 11, color: "#9AA1AB" }}>ผู้ดูแลองค์กร</span>
                        ) : (
                          <>
                            <select
                              value={currentAssignable}
                              disabled={isPending}
                              onChange={(e) => changeRole(st, e.target.value as AssignableRole)}
                              title="เปลี่ยนบทบาท"
                              style={{ fontSize: 11.5, padding: "4px 6px", borderRadius: 7, border: "1px solid #DFE2E8", background: "#fff", cursor: "pointer", maxWidth: 110 }}
                            >
                              {ASSIGNABLE.map((a) => (
                                <option key={a.value} value={a.value}>{a.label}</option>
                              ))}
                            </select>
                            {st.status === "invited" && (
                              <button type="button" disabled={isPending} onClick={() => regen(st)} style={GHOST_BTN} title="สร้างลิงก์เชิญใหม่">
                                <RefreshCw size={12} /> ลิงก์
                              </button>
                            )}
                            <button type="button" disabled={isPending} onClick={() => disableMember(st)} style={DANGER_BTN} title="เอาออก / ปิดใช้งาน">
                              <UserMinus size={12} /> ปิดใช้
                            </button>
                          </>
                        )}
                      </span>
                    )}
                  </div>
                  {canManage && rowErr?.id === st.id && (
                    <div style={{ padding: "8px 22px", fontSize: 12, color: "#B42318", background: "#FCEDEC", borderBottom: "1px solid #F4F5F7" }}>
                      {rowErr.msg}
                    </div>
                  )}
                  {canManage && regenResult?.id === st.id && (
                    <div style={{ padding: "12px 22px", borderBottom: "1px solid #F4F5F7", background: "#F8F9FB" }}>
                      <InviteLinkBox url={regenResult.url} name={regenResult.name} />
                    </div>
                  )}
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

      {/* ── เพิ่มพนักงาน (เชิญ) ── */}
      <Modal
        open={openInvite}
        onClose={closeInvite}
        title="เพิ่มพนักงาน"
        sub="เชิญพนักงานเข้าสาขา → ได้ลิงก์ตั้งรหัส ส่งให้พนักงานเปิดเอง"
        width={560}
        footer={
          inviteResult ? (
            <div style={{ padding: "12px 18px", display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button type="button" onClick={resetInvite} style={{ ...GHOST_BTN, padding: "9px 14px", fontSize: 13 }}>
                <Plus size={14} /> เชิญอีกคน
              </button>
              <button type="button" onClick={closeInvite} style={PRIMARY_BTN}>เสร็จสิ้น</button>
            </div>
          ) : (
            <div style={{ padding: "12px 18px", display: "flex", justifyContent: "flex-end", gap: 10, alignItems: "center" }}>
              {formErr && <span style={{ fontSize: 12, color: "#B42318", marginRight: "auto" }}>{formErr}</span>}
              <button type="button" onClick={closeInvite} style={{ ...GHOST_BTN, padding: "9px 14px", fontSize: 13, color: "#5A6270", border: "1px solid #DFE2E8" }}>ยกเลิก</button>
              <button type="button" onClick={submitInvite} disabled={isPending} style={{ ...PRIMARY_BTN, opacity: isPending ? 0.6 : 1 }}>
                {isPending ? "กำลังสร้างลิงก์…" : "สร้างลิงก์เชิญ"}
              </button>
            </div>
          )
        }
      >
        <div style={{ padding: "18px 20px" }}>
          {inviteResult ? (
            <InviteLinkBox url={inviteResult.url} name={inviteResult.name} />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={LABEL}>ชื่อพนักงาน <span style={{ color: "#B42318" }}>*</span></label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="เช่น สมชาย ใจดี"
                  style={INPUT}
                  autoFocus
                />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={LABEL}>สาขา <span style={{ color: "#B42318" }}>*</span></label>
                  <select
                    value={form.branchId}
                    onChange={(e) => setForm((f) => ({ ...f, branchId: e.target.value }))}
                    style={{ ...INPUT, cursor: "pointer" }}
                  >
                    {branches.length === 0 && <option value="">— ไม่มีสาขา —</option>}
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={LABEL}>บทบาท <span style={{ color: "#B42318" }}>*</span></label>
                  <select
                    value={form.role}
                    onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as AssignableRole }))}
                    style={{ ...INPUT, cursor: "pointer" }}
                  >
                    {ASSIGNABLE.map((a) => (
                      <option key={a.value} value={a.value}>{a.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={LABEL}>อีเมล <span style={{ color: "#9AA1AB", fontWeight: 400 }}>(ไม่บังคับ)</span></label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    placeholder="name@email.com"
                    style={INPUT}
                  />
                </div>
                <div>
                  <label style={LABEL}>เบอร์โทร <span style={{ color: "#9AA1AB", fontWeight: 400 }}>(ไม่บังคับ)</span></label>
                  <input
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                    placeholder="08x-xxx-xxxx"
                    style={INPUT}
                  />
                </div>
              </div>
              <div style={{ display: "flex", gap: 7, alignItems: "flex-start", fontSize: 11.5, color: "#6B7280", background: "#F8F9FB", borderRadius: 9, padding: "10px 12px" }}>
                <Link2 size={14} style={{ marginTop: 1, flex: "0 0 14px" }} />
                <span>กดสร้างแล้วจะได้<b> ลิงก์เชิญ</b> ส่งให้พนักงานเปิดเพื่อตั้งรหัสและเข้าระบบ (ยังไม่ส่งอีเมลอัตโนมัติ)</span>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
