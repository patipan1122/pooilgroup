"use client";

// Playland · ผูกพนักงานเข้าสาขา — พนักงานเห็น/ทำได้เฉพาะสาขาที่ผูก (ยังไม่ผูก = เห็นทุกสาขา)
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { assignStaffToBranch, removeStaffFromBranch } from "@/lib/playland/branch-actions";
import { Building2, X, Users } from "lucide-react";

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
    <div style={{ marginTop: 26 }}>
      <h2 style={{ fontFamily: "var(--pl-font-display)", fontSize: "1.05rem", fontWeight: 600, margin: "0 0 4px", display: "flex", alignItems: "center", gap: 8 }}>
        <Users size={18} /> พนักงานประจำสาขา
      </h2>
      <div style={{ fontSize: 13, color: "var(--pl-text-muted)", marginBottom: 14 }}>
        ผูกพนักงานกับสาขา → คนนั้นเห็น/ทำได้เฉพาะสาขาที่ผูก · <strong>ยังไม่ผูก = เห็นทุกสาขา</strong> · ผู้ดูแล/เจ้าของเห็นทุกสาขาเสมอ
      </div>
      <div style={{ display: "grid", gap: 14 }}>
        {branches.map((b) => {
          const assigned = byBranch.get(b.id) ?? [];
          const assignedSet = new Set(assigned);
          const available = users.filter((u) => !assignedSet.has(u.id));
          return (
            <div key={b.id} className="pl-card">
              <div style={{ fontWeight: 600, marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
                <Building2 size={16} color="#2D6CB1" /> {b.name}
                <span style={{ fontSize: 12, color: "var(--pl-text-muted)", fontWeight: 400 }}>· {assigned.length} คน</span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                {assigned.length === 0 && <span style={{ color: "#a89c8b", fontSize: 13 }}>ยังไม่มีพนักงานผูกสาขานี้ (ทุกคนเห็นได้)</span>}
                {assigned.map((uid) => {
                  const u = umap.get(uid);
                  const key = `${uid}:${b.id}`;
                  return (
                    <span key={uid} className="pl-chip pl-chip-info" style={{ display: "inline-flex", alignItems: "center", gap: 6, opacity: busyKey === key ? 0.5 : 1, fontSize: 13, padding: "5px 6px 5px 12px" }}>
                      {u?.name ?? "—"}
                      <button type="button" disabled={pending} onClick={() => run(key, removeStaffFromBranch({ userId: uid, branchId: b.id }))} style={{ display: "inline-flex", background: "rgba(0,0,0,0.06)", border: "none", borderRadius: "50%", width: 18, height: 18, alignItems: "center", justifyContent: "center", cursor: "pointer", color: "inherit" }}><X size={12} /></button>
                    </span>
                  );
                })}
              </div>
              <select
                className="pl-select"
                value=""
                disabled={pending || available.length === 0}
                onChange={(e) => { if (e.target.value) run(`add:${b.id}`, assignStaffToBranch({ userId: e.target.value, branchId: b.id })); }}
                style={{ maxWidth: 320 }}
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
