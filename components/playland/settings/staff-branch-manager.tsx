"use client";

// Playland · ผูกพนักงานเข้าสาขา — พนักงานเห็น/ทำได้เฉพาะสาขาที่ผูก (ยังไม่ผูก = เห็นทุกสาขา)
// สไตล์ Play a lot · พื้นขาว · per-branch staff chips · เต็มความกว้าง
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { assignStaffToBranch, removeStaffFromBranch } from "@/lib/playland/branch-actions";
import { Building2, X, Users } from "lucide-react";

const INK = "#3A3026", MUTED = "#8a7f70", BLUE = "#2D6CB1", LINE = "#ece5d8";
const FREDOKA = "var(--font-fredoka), 'Fredoka', sans-serif";
const MITR = "var(--font-mitr), 'Mitr', sans-serif";
const card: React.CSSProperties = { background: "#fff", border: `1px solid ${LINE}`, borderRadius: 16, boxShadow: "0 1px 3px rgba(58,48,38,.05)", padding: 20 };

type U = { id: string; name: string; email: string | null; role: string };

export function StaffBranchManager({ branches, users, assignments }: {
  branches: { id: string; name: string }[];
  users: U[];
  assignments: { userId: string; branchId: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const umap = new Map(users.map((u) => [u.id, u]));
  const byBranch = new Map<string, string[]>();
  for (const b of branches) byBranch.set(b.id, []);
  for (const a of assignments) byBranch.get(a.branchId)?.push(a.userId);

  function run(key: string, p: Promise<unknown>) {
    setBusyKey(key);
    start(async () => { await p; setBusyKey(null); router.refresh(); });
  }

  return (
    <div style={{ marginTop: 26, fontFamily: MITR, color: INK }}>
      <h2 style={{ fontFamily: FREDOKA, fontSize: "1.05rem", fontWeight: 600, margin: "0 0 4px", display: "flex", alignItems: "center", gap: 8 }}>
        <Users size={18} color={BLUE} /> พนักงานประจำสาขา
      </h2>
      <div style={{ fontSize: 13, color: MUTED, marginBottom: 16 }}>
        ผูกพนักงานกับสาขา → คนนั้นเห็น/ทำได้เฉพาะสาขาที่ผูก · <strong>ยังไม่ผูก = เห็นทุกสาขา</strong> · ผู้ดูแล/เจ้าของเห็นทุกสาขาเสมอ
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 14 }}>
        {branches.map((b) => {
          const assigned = byBranch.get(b.id) ?? [];
          const assignedSet = new Set(assigned);
          const available = users.filter((u) => !assignedSet.has(u.id));
          return (
            <div key={b.id} style={card}>
              <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
                <Building2 size={16} color={BLUE} /> {b.name}
                <span style={{ fontSize: 12, color: MUTED, fontWeight: 400 }}>· {assigned.length} คน</span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14, minHeight: 28 }}>
                {assigned.length === 0 && <span style={{ color: "#b3a896", fontSize: 13 }}>ยังไม่มีพนักงานผูกสาขานี้ (ทุกคนเห็นได้)</span>}
                {assigned.map((uid) => {
                  const u = umap.get(uid);
                  const key = `${uid}:${b.id}`;
                  return (
                    <span key={uid} style={{ display: "inline-flex", alignItems: "center", gap: 6, opacity: busyKey === key ? 0.5 : 1, fontSize: 13, padding: "5px 6px 5px 12px", borderRadius: 999, background: "#eaf3f6", color: BLUE, fontWeight: 500 }}>
                      {u?.name ?? "—"}
                      <button type="button" disabled={pending} onClick={() => run(key, removeStaffFromBranch({ userId: uid, branchId: b.id }))} style={{ display: "inline-flex", background: "rgba(45,108,177,0.14)", border: "none", borderRadius: "50%", width: 18, height: 18, alignItems: "center", justifyContent: "center", cursor: "pointer", color: "inherit" }}><X size={12} /></button>
                    </span>
                  );
                })}
              </div>
              <select
                value=""
                disabled={pending || available.length === 0}
                onChange={(e) => { if (e.target.value) run(`add:${b.id}`, assignStaffToBranch({ userId: e.target.value, branchId: b.id })); }}
                style={{ width: "100%", border: `1px solid ${LINE}`, borderRadius: 9, padding: "9px 12px", fontSize: 13, fontFamily: MITR, color: INK, background: "#fff", cursor: pending ? "wait" : "pointer", outline: "none" }}
              >
                <option value="">{available.length === 0 ? "ผูกครบทุกคนแล้ว" : "+ เพิ่มพนักงานเข้าสาขานี้…"}</option>
                {available.map((u) => <option key={u.id} value={u.id}>{u.name}{u.email ? ` · ${u.email}` : ""} ({u.role})</option>)}
              </select>
            </div>
          );
        })}
      </div>
    </div>
  );
}
