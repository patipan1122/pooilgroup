"use client";

/**
 * ตู้คีบ OS — ตั้งค่า & สิทธิ์ (client)
 * 4 role cards + ตารางสิทธิ์ต่อเมนู (สะท้อน role model จาก role-guard) +
 * นโยบายระบบ (toggles, client state) + บัญชีผู้ใช้ (real getTeamData → sample fallback).
 */

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Plus, ShieldCheck, Users2, Coins, Wrench } from "lucide-react";
import { Card, Pill, Toggle, IconBox } from "@/components/clawfleet/os/kit";
import { TONE, num, type Tone } from "@/components/clawfleet/os/format";
import { saveClawfleetPolicy, type ClawfleetPolicy } from "@/lib/clawfleet/policy";

/* ── types (shared กับ page.tsx) ─────────────────────────────────────────── */
export type RoleKey = "owner" | "manager" | "collector" | "tech";
export type SettingsUserRow = {
  id: string;
  name: string;
  roleKey: RoleKey;
  scopeBranches: string[];
  lastLogin: string;
  status: "active" | "invited" | "disabled";
};

/* ── role model (สอดคล้อง role-guard: CF_ADMIN / CF_BRANCH / CF_STAFF) ───── */
const ROLE_META: Record<RoleKey, { name: string; sub: string; dot: string; tone: Tone }> = {
  owner: { name: "เจ้าของร้าน", sub: "เห็นทุกสาขา · ตั้งนโยบาย · อนุมัติทุกอย่าง", dot: "#4F46E5", tone: "brand" },
  manager: { name: "ผจก.สาขา", sub: "ดูแลสาขาตัวเอง · อนุมัติรอบเก็บเงิน · ตั้งค่าตู้", dot: "#15803D", tone: "green" },
  collector: { name: "พนง.เก็บเงิน", sub: "เก็บเงินหน้าบ้าน · ส่งรอบ · บันทึกมิเตอร์", dot: "#B45309", tone: "amber" },
  tech: { name: "ช่างซ่อม", sub: "ดูตู้เสีย · บันทึกการซ่อม · อ่านอย่างเดียว", dot: "#6B7280", tone: "neutral" },
};
const ROLE_ORDER: RoleKey[] = ["owner", "manager", "collector", "tech"];

/* ── access-level chips ──────────────────────────────────────────────────── */
type Access = "full" | "approve" | "view" | "none";
const ACCESS_META: Record<Access, { label: string; tone: Tone | null }> = {
  full: { label: "เต็ม", tone: "brand" },
  approve: { label: "อนุมัติ", tone: "green" },
  view: { label: "ดูอย่างเดียว", tone: "neutral" },
  none: { label: "—", tone: null },
};

/* permission matrix — STATIC reflection ของ role model.
 * แถว = เมนู ClawOS · คอลัมน์ = 4 บทบาท. ค่าสอดคล้องกับ role-guard:
 * owner=admin-tier(เต็ม) · manager=สาขาตัวเอง(อนุมัติ/เต็มบางส่วน) · collector=staff(เก็บเงิน) · tech=viewer(ดู) */
const PERM_MATRIX: { feat: string; owner: Access; manager: Access; collector: Access; tech: Access }[] = [
  { feat: "ภาพรวม (Dashboard)", owner: "full", manager: "view", collector: "view", tech: "view" },
  { feat: "สาขา", owner: "full", manager: "view", collector: "none", tech: "none" },
  { feat: "คลังสินค้า", owner: "full", manager: "full", collector: "view", tech: "view" },
  { feat: "ตรวจเงิน & กระทบยอด", owner: "approve", manager: "approve", collector: "view", tech: "none" },
  { feat: "ตั้งค่าตู้", owner: "full", manager: "full", collector: "none", tech: "view" },
  { feat: "รายงาน", owner: "full", manager: "view", collector: "none", tech: "none" },
  { feat: "พนักงาน", owner: "full", manager: "view", collector: "none", tech: "none" },
  { feat: "ตั้งค่า & สิทธิ์", owner: "full", manager: "none", collector: "none", tech: "none" },
  { feat: "เก็บเงินหน้าบ้าน", owner: "full", manager: "full", collector: "full", tech: "none" },
];

/* ── system policies (toggles · persist ใน Organization.settings.clawfleetPolicy) ──
 * key = field ของ ClawfleetPolicy (saveClawfleetPolicy รับ partial ตาม key นี้). */
const POLICY_DEFS: { key: keyof ClawfleetPolicy; label: string; sub: string }[] = [
  { key: "photoRequired", label: "บังคับถ่ายรูปก่อน–หลังเติม", sub: "พนักงานต้องแนบรูปทุกครั้งก่อนปิดรอบ" },
  { key: "cashAlert", label: "เตือนเงินไม่ตรงทันที", sub: "ส่งแจ้งเตือน ผจก.สาขาเมื่อยอดต่างเกินเกณฑ์" },
  { key: "lockConfig", label: "ล็อกค่าตู้รออนุมัติ", sub: "การเปลี่ยนความแรงคีบต้องให้เจ้าของอนุมัติก่อน" },
  { key: "meterMatch", label: "มิเตอร์เฟือง + ดิจิตอลต้องเท่ากัน", sub: "บล็อกการปิดรอบถ้าเลขมิเตอร์ 2 ตัวไม่ตรง" },
];

/* ── sample fallback (เมื่อ DB ว่าง) ─────────────────────────────────────── */
const SAMPLE_USERS: SettingsUserRow[] = [
  { id: "s1", name: "คุณเอ (เจ้าของ)", roleKey: "owner", scopeBranches: ["ทุกสาขา"], lastLogin: "เมื่อสักครู่", status: "active" },
  { id: "s2", name: "พี่หน่อย", roleKey: "manager", scopeBranches: ["รังสิต"], lastLogin: "2 ชม.ก่อน", status: "active" },
  { id: "s3", name: "พี่ตั้ม", roleKey: "manager", scopeBranches: ["ลาดพร้าว", "บางแค"], lastLogin: "เมื่อวาน", status: "active" },
  { id: "s4", name: "น้องมิ้น", roleKey: "collector", scopeBranches: ["รังสิต"], lastLogin: "5 ชม.ก่อน", status: "active" },
  { id: "s5", name: "น้องเบนซ์", roleKey: "collector", scopeBranches: ["บางนา"], lastLogin: "ยังไม่เคยเข้า", status: "invited" },
  { id: "s6", name: "ช่างโจ", roleKey: "tech", scopeBranches: ["ทุกสาขา"], lastLogin: "3 วันก่อน", status: "active" },
  { id: "s7", name: "น้องฟ้า", roleKey: "collector", scopeBranches: ["นนทบุรี"], lastLogin: "6 วันก่อน", status: "disabled" },
];

const STATUS_META: Record<SettingsUserRow["status"], { label: string; dot: string }> = {
  active: { label: "ใช้งานอยู่", dot: "#15803D" },
  invited: { label: "รอเข้าระบบ", dot: "#B45309" },
  disabled: { label: "ปิดใช้", dot: "#9AA1AB" },
};

const ROLE_ICON: Record<RoleKey, typeof ShieldCheck> = {
  owner: ShieldCheck,
  manager: Users2,
  collector: Coins,
  tech: Wrench,
};

function initialOf(name: string): string {
  const c = name.trim().replace(/^(คุณ|พี่|น้อง|ช่าง)/, "").charAt(0);
  return c || name.charAt(0) || "?";
}

export function SettingsClient({
  users,
  counts,
  policy,
}: {
  users: SettingsUserRow[];
  counts: { branches: number; machines: number };
  policy: ClawfleetPolicy;
}) {
  const router = useRouter();
  const empty = users.length === 0;
  const rows = empty ? SAMPLE_USERS : users;

  // นโยบายระบบ — init จาก prop (ค่าที่ persist จริง) ไม่ใช่ค่า hardcode
  const [pol, setPol] = useState<ClawfleetPolicy>(policy);
  const [savingKey, setSavingKey] = useState<keyof ClawfleetPolicy | null>(null);
  const [, startSaving] = useTransition();

  function togglePolicy(key: keyof ClawfleetPolicy, value: boolean) {
    const prev = pol[key];
    setPol((p) => ({ ...p, [key]: value })); // optimistic
    setSavingKey(key);
    startSaving(async () => {
      const res = await saveClawfleetPolicy({ [key]: value });
      setSavingKey(null);
      if (!res.ok) {
        setPol((p) => ({ ...p, [key]: prev })); // rollback
        window.alert(res.error);
        return;
      }
      setPol(res.data); // sync กับค่าที่ persist จริง (กัน drift)
    });
  }

  const countByRole = useMemo(() => {
    const m: Record<RoleKey, number> = { owner: 0, manager: 0, collector: 0, tech: 0 };
    for (const u of rows) m[u.roleKey] += 1;
    return m;
  }, [rows]);

  return (
    <div>
      {empty && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", background: "#FCF8EC", border: "1px solid #F0E2BE", borderRadius: 10, padding: "9px 14px", marginBottom: 16, fontSize: 12, color: "#7A5510" }}>
          <AlertTriangle size={15} /> ยังไม่มีบัญชีผู้ใช้จริงในระบบ — กำลังแสดง<b> ตัวอย่าง</b> เพื่อให้เห็นภาพ (เพิ่มผู้ใช้จริงได้ที่หน้าพนักงาน)
        </div>
      )}

      {/* ── 4 role summary cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 mb-5">
        {ROLE_ORDER.map((rk) => {
          const meta = ROLE_META[rk];
          const Icon = ROLE_ICON[rk];
          const t = TONE[meta.tone];
          return (
            <div key={rk} className="co-card" style={{ padding: "15px 16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9 }}>
                <IconBox tone={meta.tone} size={26} radius={7}><Icon size={14} /></IconBox>
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: meta.dot }} />
                <span style={{ fontSize: 13.5, fontWeight: 700 }}>{meta.name}</span>
              </div>
              <div style={{ fontSize: 11.5, color: "#9AA1AB", lineHeight: 1.4, minHeight: 32 }}>{meta.sub}</div>
              <div className="num" style={{ fontSize: 12, fontWeight: 700, color: t.text, marginTop: 6 }}>
                {num(countByRole[rk])} คน
              </div>
            </div>
          );
        })}
      </div>

      {/* ── perm matrix + system policies ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.55fr_1fr] gap-[18px] items-start">
        <Card title="สิทธิ์การเข้าถึงแต่ละเมนู" sub="กำหนดว่าแต่ละบทบาทเข้าถึงเมนูไหนได้ระดับใด" pad={false}>
          <div style={{ overflowX: "auto" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1.5fr repeat(4, 1fr)", padding: "11px 20px", fontSize: 11, fontWeight: 700, color: "#9AA1AB", borderBottom: "1px solid #F4F5F7", minWidth: 560 }}>
              <span>เมนู / ฟังก์ชัน</span>
              {ROLE_ORDER.map((rk) => (
                <span key={rk} style={{ textAlign: "center" }}>{ROLE_META[rk].name}</span>
              ))}
            </div>
            {PERM_MATRIX.map((p) => (
              <div key={p.feat} style={{ display: "grid", gridTemplateColumns: "1.5fr repeat(4, 1fr)", padding: "11px 20px", alignItems: "center", borderBottom: "1px solid #F4F5F7", fontSize: 12.5, minWidth: 560 }}>
                <span style={{ fontWeight: 600 }}>{p.feat}</span>
                {ROLE_ORDER.map((rk) => {
                  const acc = p[rk];
                  const am = ACCESS_META[acc];
                  return (
                    <span key={rk} style={{ textAlign: "center" }}>
                      {am.tone ? (
                        <Pill tone={am.tone}>{am.label}</Pill>
                      ) : (
                        <span style={{ color: "#C5C9D0" }}>—</span>
                      )}
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
        </Card>

        <Card title="นโยบายระบบ" sub="กฎกลางที่บังคับใช้กับทุกสาขา">
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {POLICY_DEFS.map((p) => (
              <div key={p.key} style={{ display: "flex", alignItems: "flex-start", gap: 12, opacity: savingKey === p.key ? 0.6 : 1 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.35 }}>{p.label}</div>
                  <div style={{ fontSize: 11.5, color: "#9AA1AB", marginTop: 3, lineHeight: 1.4 }}>{p.sub}</div>
                </div>
                <Toggle
                  on={pol[p.key]}
                  onChange={(v) => togglePolicy(p.key, v)}
                />
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* ── บัญชีผู้ใช้ ── */}
      <Card
        title="บัญชีผู้ใช้"
        sub="มอบบทบาทและขอบเขตสาขาที่เข้าถึงได้"
        pad={false}
        style={{ marginTop: 18 }}
        right={
          <Link
            href="/clawfleet/os/staff"
            style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 600, color: "#fff", background: "#4F46E5", border: "none", padding: "9px 15px", borderRadius: 9, cursor: "pointer", textDecoration: "none" }}
          >
            <Plus size={15} /> เพิ่มผู้ใช้
          </Link>
        }
      >
        <div style={{ overflowX: "auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1.2fr 1.6fr 1fr 0.7fr", padding: "11px 20px", fontSize: 11, fontWeight: 700, color: "#9AA1AB", borderBottom: "1px solid #F4F5F7", minWidth: 640 }}>
            <span>ผู้ใช้</span><span>บทบาท</span><span>ขอบเขตสาขา</span><span>เข้าใช้ล่าสุด</span><span style={{ textAlign: "right" }}>สถานะ</span>
          </div>
          {rows.map((u) => {
            const rm = ROLE_META[u.roleKey];
            const t = TONE[rm.tone];
            const sm = STATUS_META[u.status];
            return (
              <div key={u.id} className="co-rowh" style={{ display: "grid", gridTemplateColumns: "1.4fr 1.2fr 1.6fr 1fr 0.7fr", padding: "13px 20px", alignItems: "center", borderBottom: "1px solid #F4F5F7", fontSize: 13, minWidth: 640 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
                  <span style={{ width: 34, height: 34, flex: "0 0 34px", borderRadius: "50%", background: t.bg, color: t.text, fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {initialOf(u.name)}
                  </span>
                  <span style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{u.name}</span>
                </span>
                <span><Pill tone={rm.tone}>{rm.name}</Pill></span>
                <span style={{ color: "#6B7280", fontSize: 12.5 }}>{u.scopeBranches.join(" · ")}</span>
                <span style={{ color: "#9AA1AB", fontSize: 12 }}>{u.lastLogin}</span>
                <span style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: sm.dot }} />
                  <span style={{ fontSize: 11.5, color: "#6B7280", whiteSpace: "nowrap" }}>{sm.label}</span>
                </span>
              </div>
            );
          })}
        </div>
        <div style={{ padding: "12px 20px", fontSize: 11.5, color: "#9AA1AB", display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            onClick={() => router.push("/clawfleet/os/staff")}
            style={{ fontSize: 12, fontWeight: 600, color: "#4F46E5", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}
          >
            จัดการบทบาท · เชิญ · ปิดใช้ (หน้าทีม) →
          </button>
          {counts.branches > 0 && (
            <span>· {num(counts.branches)} สาขา · {num(counts.machines)} ตู้</span>
          )}
        </div>
      </Card>
    </div>
  );
}
