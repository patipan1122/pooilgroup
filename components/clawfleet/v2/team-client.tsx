"use client";

/**
 * ClawFleet v2 — Team & สาขา roster (บรรทัดเดียวต่อพนักงาน).
 *
 * ทุกแถว = avatar · ชื่อ · บทบาท · สาขา · เข้าใช้ล่าสุด · สถานะ · ปุ่ม
 * ปุ่มขวา: เชิญ/คัดลอกลิงก์ · แก้สิทธิ์ (popover) · เข้าใช้แทน · เอาออก.
 * ทุกปุ่มต่อ action จริง (no dead onClick):
 *   - เชิญ → inviteCfStaff (คืนลิงก์ให้คัดลอก)
 *   - แก้สิทธิ์ → updateCfStaffRole
 *   - เอาออก → removeCfStaff (confirm)
 *   - สร้างลิงก์ใหม่ → regenInviteLink
 *   - เข้าใช้แทน → POST /api/admin/users/[id]/impersonate (REUSE) → redirect
 */

import { useMemo, useState, useTransition, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Ic, Pill, type IconName } from "@/components/clawfleet/v2/chrome";
import {
  inviteCfStaff,
  updateCfStaffRole,
  removeCfStaff,
  regenInviteLink,
} from "@/lib/clawfleet/team-actions";
import type { TeamData, TeamMember, MemberStatus } from "@/lib/clawfleet/v2-admin-queries";

type Toast = { kind: "ok" | "err"; text: string };

const ROLE_TH: Record<string, string> = {
  super_admin: "Super Admin",
  org_admin: "Org Admin",
  admin: "Admin",
  area_manager: "ผจก. เขต",
  branch_manager: "ผจก. สาขา",
  staff: "พนักงาน",
  viewer: "ดูอย่างเดียว",
};

// role ที่หน้านี้กำหนดได้ (ตรงกับ CF_ASSIGNABLE_ROLES ฝั่ง action)
const ASSIGNABLE: { value: "staff" | "branch_manager" | "area_manager"; label: string }[] = [
  { value: "staff", label: "พนักงาน" },
  { value: "branch_manager", label: "ผจก. สาขา" },
  { value: "area_manager", label: "ผจก. เขต" },
];

const STATUS_META: Record<MemberStatus, { label: string; color: "emerald" | "amber" | "slate" }> = {
  active: { label: "ใช้งานอยู่", color: "emerald" },
  invited: { label: "รอเข้าระบบ", color: "amber" },
  disabled: { label: "ปิดใช้", color: "slate" },
};

const AVATAR_TONES = ["sky", "violet", "emerald", "amber", "rose"] as const;
function toneFor(id: string): (typeof AVATAR_TONES)[number] {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length]!;
}
function initials(name: string): string {
  const t = name.trim().replace(/^\[DEMO\]\s*/, "");
  return (t[0] ?? "?").toUpperCase();
}

/** "2 ชม.ที่แล้ว" / "เมื่อวาน" / "3 วันก่อน" / "ยังไม่เข้า" */
function lastLoginLabel(d: Date | null): string {
  if (!d) return "ยังไม่เข้า";
  const diff = Date.now() - new Date(d).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "เมื่อสักครู่";
  if (min < 60) return `${min} นาทีที่แล้ว`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} ชม.ที่แล้ว`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "เมื่อวาน";
  if (day < 30) return `${day} วันก่อน`;
  return new Date(d).toLocaleDateString("th-TH", { day: "numeric", month: "short" });
}

export function TeamClient({ data }: { data: TeamData }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<Toast | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ name: string; url: string } | null>(null);

  function flash(t: Toast) {
    setToast(t);
    setTimeout(() => setToast(null), 2800);
  }

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, okText: string, onOk?: () => void) {
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        flash({ kind: "ok", text: okText });
        onOk?.();
        router.refresh();
      } else {
        flash({ kind: "err", text: res.error ?? "ไม่สำเร็จ" });
      }
    });
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      flash({ kind: "ok", text: "คัดลอกลิงก์แล้ว" });
    } catch {
      flash({ kind: "err", text: "คัดลอกไม่สำเร็จ · เลือกข้อความเอง" });
    }
  }

  function onRegen(m: TeamMember) {
    startTransition(async () => {
      const res = await regenInviteLink(m.id);
      if (res.ok) {
        setInviteResult({ name: res.data.name, url: res.data.inviteUrl });
        setShowInvite(true);
        flash({ kind: "ok", text: "สร้างลิงก์เชิญใหม่แล้ว" });
        router.refresh();
      } else {
        flash({ kind: "err", text: res.error });
      }
    });
  }

  function onRemove(m: TeamMember) {
    if (!window.confirm(`เอา "${m.name}" ออกจากสาขา ${m.branchName}?\n(ถ้าไม่เหลือสาขาอื่น บัญชีจะถูกปิดใช้งาน)`)) return;
    run(() => removeCfStaff(m.id, m.branchId), "เอาออกจากสาขาแล้ว");
  }

  function onImpersonate(m: TeamMember) {
    if (m.status !== "active") {
      flash({ kind: "err", text: "เข้าใช้แทนได้เฉพาะคนที่ใช้งานอยู่" });
      return;
    }
    if (!window.confirm(`เข้าใช้งานระบบแทน "${m.name}"?\nคุณจะเห็นหน้าจอแบบที่พนักงานคนนี้เห็น (มีแถบเตือนให้กลับเป็นตัวเอง)`)) return;
    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/users/${m.id}/impersonate`, { method: "POST" });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          flash({ kind: "err", text: body.error ?? "เข้าใช้แทนไม่สำเร็จ" });
          return;
        }
        router.push("/clawfleet/v2/hub");
        router.refresh();
      } catch {
        flash({ kind: "err", text: "เข้าใช้แทนไม่สำเร็จ" });
      }
    });
  }

  // flatten → one row per (member × branch membership)
  const rows = useMemo(
    () => data.branches.map((b) => ({ branch: b, members: b.staff })),
    [data.branches],
  );
  const hasAnyMember = rows.some((r) => r.members.length > 0);

  return (
    <div className="cf-page">
      <div className="cf-page-head">
        <div>
          <div className="cf-eyebrow">ทีม &amp; สาขา</div>
          <h1 className="cf-h1">พนักงานตู้คีบ</h1>
          <div className="cf-page-sub">
            {data.totals.staff} คน · {data.totals.branches} สาขา · {data.totals.machines} ตู้
          </div>
        </div>
        <div className="cf-page-actions">
          <button
            className="cf-btn cf-btn-primary"
            onClick={() => {
              setInviteResult(null);
              setShowInvite(true);
            }}
            disabled={pending}
          >
            <Ic name="plus" size={14} /> เพิ่มพนักงาน
          </button>
        </div>
      </div>

      <div className="cf-insight-cards">
        <Stat label="สาขา" value={data.totals.branches} sub="ที่เปิดอยู่" icon="building" tone="primary" />
        <Stat label="พนักงานทั้งหมด" value={data.totals.staff} sub="ที่ได้รับสิทธิ์" icon="users" />
        <Stat label="ที่ได้รับสิทธิ์" value={data.totals.withManager + "/" + data.totals.branches} sub="สาขาที่มีผู้จัดการ" icon="user" tone={data.totals.withManager < data.totals.branches ? "amber" : "neutral"} />
        <Stat label="รอเข้าระบบ" value={data.totals.pending} sub="ยังไม่กดลิงก์เชิญ" icon="clock" tone={data.totals.pending > 0 ? "amber" : "neutral"} />
      </div>

      {!hasAnyMember && (
        <div className="cf-manage-card cf-manage-empty">
          <div className="cf-manage-empty-sub">ยังไม่มีพนักงานในสาขาตู้คีบ — เริ่มจากเชิญคนแรก</div>
          <button className="cf-btn cf-btn-primary" onClick={() => { setInviteResult(null); setShowInvite(true); }}>
            <Ic name="plus" size={14} /> เพิ่มพนักงาน
          </button>
        </div>
      )}

      <div className="cf-roster">
        {rows.map(({ branch, members }) => (
          <div key={branch.id}>
            <div className="cf-roster-group-head">
              <span className="cf-roster-group-name">{branch.name}</span>
              <span className="cf-roster-group-meta">
                {branch.area} · {branch.code} · {members.length} คน
                {branch.managerName ? ` · ผจก. ${branch.managerName}` : ""}
              </span>
            </div>
            {members.length === 0 ? (
              <div className="cf-roster-row" style={{ justifyContent: "center", color: "var(--cf-text-3)" }}>
                ยังไม่มีพนักงานในสาขานี้
              </div>
            ) : (
              members.map((m) => (
                <RosterRow
                  key={`${m.id}-${m.branchId}`}
                  m={m}
                  pending={pending}
                  onChangeRole={(role) =>
                    run(() => updateCfStaffRole(m.id, m.branchId, role), "แก้สิทธิ์แล้ว")
                  }
                  onImpersonate={() => onImpersonate(m)}
                  onRemove={() => onRemove(m)}
                  onRegen={() => onRegen(m)}
                />
              ))
            )}
          </div>
        ))}
      </div>

      {showInvite && (
        <InviteModal
          pending={pending}
          branches={data.branches.map((b) => ({ id: b.id, name: b.name, code: b.code }))}
          result={inviteResult}
          onCopy={copyLink}
          onClose={() => {
            setShowInvite(false);
            setInviteResult(null);
          }}
          onSubmit={(v) =>
            startTransition(async () => {
              const res = await inviteCfStaff(v);
              if (res.ok) {
                setInviteResult({ name: res.data.name, url: res.data.inviteUrl });
                flash({ kind: "ok", text: "สร้างพนักงาน + ลิงก์เชิญแล้ว" });
                router.refresh();
              } else {
                flash({ kind: "err", text: res.error });
              }
            })
          }
        />
      )}

      {toast && (
        <div className={`cf-toast cf-toast-${toast.kind === "ok" ? "approve" : "escalate"}`}>
          <span className="cf-toast-icon">{toast.kind === "ok" ? "✓" : "⚠"}</span>
          <span>{toast.text}</span>
        </div>
      )}
    </div>
  );
}

/* ---------------- one roster row ---------------- */
function RosterRow({
  m,
  pending,
  onChangeRole,
  onImpersonate,
  onRemove,
  onRegen,
}: {
  m: TeamMember;
  pending: boolean;
  onChangeRole: (role: "staff" | "branch_manager" | "area_manager") => void;
  onImpersonate: () => void;
  onRemove: () => void;
  onRegen: () => void;
}) {
  const [popOpen, setPopOpen] = useState(false);
  const popRef = useRef<HTMLDivElement | null>(null);
  const st = STATUS_META[m.status];
  const isAdminTier = ["super_admin", "org_admin", "admin"].includes(m.role);

  useEffect(() => {
    if (!popOpen) return;
    const h = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setPopOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [popOpen]);

  return (
    <div className={`cf-roster-row ${m.status === "disabled" ? "is-disabled" : ""}`}>
      <div className="cf-roster-id">
        <div className={`cf-avatar cf-avatar-${toneFor(m.id)}`}>{initials(m.name)}</div>
        <div className="cf-roster-name-wrap">
          <div className="cf-roster-name">{m.name}</div>
          <div className="cf-roster-contact">{m.email ?? "—"}</div>
        </div>
      </div>

      <span className="cf-roster-cell cf-roster-cell-role">
        <Pill color={isAdminTier ? "blue" : "slate"} size="sm">
          {ROLE_TH[m.role] ?? m.role}
        </Pill>
      </span>

      <span className="cf-roster-cell cf-roster-cell-branch" title={m.branchName}>
        <Ic name="building" size={13} /> {m.branchName}
      </span>

      <span className="cf-roster-cell cf-roster-cell-login">
        <Ic name="clock" size={13} /> {lastLoginLabel(m.lastLoginAt)}
      </span>

      <span className="cf-roster-cell cf-roster-cell-status">
        <Pill color={st.color === "emerald" ? "emerald" : st.color === "amber" ? "amber" : "slate"} size="sm" dot>
          {st.label}
        </Pill>
      </span>

      <div className="cf-roster-actions">
        {m.status === "invited" ? (
          <button
            className="cf-roster-iconbtn"
            title="สร้าง/คัดลอกลิงก์เชิญ"
            onClick={onRegen}
            disabled={pending}
          >
            <Ic name="link" size={15} />
          </button>
        ) : null}

        {!isAdminTier && (
          <div className="cf-roster-pop-wrap" ref={popRef}>
            <button
              className="cf-roster-iconbtn"
              title="แก้สิทธิ์"
              onClick={() => setPopOpen((o) => !o)}
              disabled={pending}
            >
              <Ic name="settings" size={15} />
            </button>
            {popOpen && (
              <div className="cf-roster-pop">
                {ASSIGNABLE.map((r) => (
                  <button
                    key={r.value}
                    className={`cf-roster-pop-item ${m.role === r.value ? "is-active" : ""}`}
                    onClick={() => {
                      setPopOpen(false);
                      if (m.role !== r.value) onChangeRole(r.value);
                    }}
                  >
                    {r.label}
                    {m.role === r.value && <Ic name="check" size={14} />}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <button
          className="cf-roster-iconbtn"
          title="เข้าใช้งานแทน"
          onClick={onImpersonate}
          disabled={pending || m.status !== "active"}
        >
          <Ic name="play" size={14} />
        </button>

        <button
          className="cf-roster-iconbtn is-danger"
          title="เอาออกจากสาขา"
          onClick={onRemove}
          disabled={pending}
        >
          <Ic name="x" size={15} />
        </button>
      </div>
    </div>
  );
}

/* ---------------- invite modal (form + link result) ---------------- */
function InviteModal({
  pending,
  branches,
  result,
  onClose,
  onSubmit,
  onCopy,
}: {
  pending: boolean;
  branches: { id: string; name: string; code: string }[];
  result: { name: string; url: string } | null;
  onClose: () => void;
  onSubmit: (v: { name: string; email?: string; phone?: string; branchId: string; role: "staff" | "branch_manager" | "area_manager" }) => void;
  onCopy: (url: string) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [role, setRole] = useState<"staff" | "branch_manager" | "area_manager">("staff");
  const valid = name.trim().length > 0 && branchId.length > 0;

  return (
    <div className="cf-modal-overlay" onClick={onClose}>
      <div className="cf-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cf-modal-head">
          <h3 className="cf-modal-title">{result ? "ลิงก์เชิญพร้อมแล้ว" : "เพิ่มพนักงาน"}</h3>
          <button className="cf-btn cf-btn-ghost cf-btn-sm" onClick={onClose}>
            <Ic name="x" size={14} />
          </button>
        </div>

        {result ? (
          <div className="cf-invite-result">
            <div className="cf-invite-result-title">
              เชิญ {result.name} แล้ว · ส่งลิงก์นี้ให้เข้าใช้ครั้งแรก
            </div>
            <div className="cf-invite-linkrow">
              <input className="cf-input" value={result.url} readOnly onFocus={(e) => e.currentTarget.select()} />
              <button className="cf-btn cf-btn-primary" onClick={() => onCopy(result.url)}>
                <Ic name="link" size={14} /> คัดลอก
              </button>
            </div>
            <div className="cf-invite-note">
              ลิงก์ใช้ได้ 48 ชั่วโมง · เมื่อพนักงานกดและตั้งรหัสผ่าน บัญชีจะเปิดใช้งานอัตโนมัติ
            </div>
          </div>
        ) : (
          <>
            <label className="cf-field">
              <span className="cf-field-label">ชื่อพนักงาน</span>
              <input className="cf-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น สมชาย ใจดี" autoFocus />
            </label>
            <label className="cf-field">
              <span className="cf-field-label">อีเมล (ไม่บังคับ · ใช้ลิงก์เชิญแทนก็ได้)</span>
              <input className="cf-input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="staff@example.com" />
            </label>
            <label className="cf-field">
              <span className="cf-field-label">เบอร์โทร (ไม่บังคับ)</span>
              <input className="cf-input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="08x-xxx-xxxx" />
            </label>
            <label className="cf-field">
              <span className="cf-field-label">สาขา</span>
              <select className="cf-input" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} · {b.code}
                  </option>
                ))}
              </select>
            </label>
            <label className="cf-field">
              <span className="cf-field-label">บทบาท</span>
              <select className="cf-input" value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
                {ASSIGNABLE.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="cf-modal-actions">
              <button className="cf-btn cf-btn-ghost" onClick={onClose} disabled={pending}>
                ยกเลิก
              </button>
              <button
                className="cf-btn cf-btn-primary"
                disabled={!valid || pending}
                onClick={() =>
                  onSubmit({
                    name: name.trim(),
                    email: email.trim() || undefined,
                    phone: phone.trim() || undefined,
                    branchId,
                    role,
                  })
                }
              >
                {pending ? "กำลังเชิญ…" : "สร้างลิงก์เชิญ"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------------- small stat tile (server StatTile is fine but keep client) ---------------- */
function Stat({
  label,
  value,
  sub,
  icon,
  tone = "neutral",
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  icon?: IconName;
  tone?: "neutral" | "primary" | "amber";
}) {
  return (
    <div className={`cf-stat cf-stat-${tone}`}>
      <div className="cf-stat-head">
        <span className="cf-stat-label">{label}</span>
        {icon && (
          <span className="cf-stat-icon">
            <Ic name={icon} size={16} />
          </span>
        )}
      </div>
      <div className="cf-stat-value">{value}</div>
      <div className="cf-stat-foot">{sub && <span className="cf-stat-sub">{sub}</span>}</div>
    </div>
  );
}
