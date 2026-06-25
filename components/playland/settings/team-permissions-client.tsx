"use client";

// Playland · ทีม & สิทธิ์ — แอดมินตั้ง "ตำแหน่ง" ให้พนักงาน → สิทธิ์ถูก derive จากตำแหน่ง (ไม่ติ๊กทีละช่อง)
// ช่อง ✓/– ในตารางอ่านอย่างเดียว · สะท้อนตำแหน่งที่เลือก (จาก POSITION_PERMISSIONS)
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Minus } from "lucide-react";
import { setStaffPosition } from "@/lib/playland/branch-actions";
import {
  PLAYLAND_POSITIONS,
  PLAYLAND_PERMISSIONS,
  POSITION_PERMISSIONS,
  isPlaylandPosition,
  type PlaylandPositionKey,
} from "@/lib/playland/positions";

const INK = "#3A3026";
const MUTED = "#8a7f70";
const BLUE = "#2D6CB1";
const GREEN = "#1F8A5B";
const LINE = "#ece5d8";
const FREDOKA = "var(--font-fredoka), 'Fredoka', sans-serif";
const MITR = "var(--font-mitr), 'Mitr', sans-serif";

const card: React.CSSProperties = {
  background: "#fff",
  border: `1px solid ${LINE}`,
  borderRadius: 16,
  boxShadow: "0 1px 3px rgba(58,48,38,.05)",
};

// สีชิปตามตำแหน่ง — เจ้าของ=น้ำเงิน · ผู้จัดการ=เขียว · แคชเชียร์=เทา
const chipColor = (pos: string | null): { fg: string; bg: string; border: string } => {
  if (pos === "owner") return { fg: BLUE, bg: "#eaf2fb", border: "#cfe1f5" };
  if (pos === "manager") return { fg: GREEN, bg: "#e8f5ee", border: "#cfe9da" };
  if (pos === "cashier") return { fg: MUTED, bg: "#f4f1ea", border: LINE };
  return { fg: MUTED, bg: "#faf8f3", border: LINE };
};

export type TeamUser = {
  id: string;
  name: string;
  email: string | null;
  position: string | null; // ตำแหน่ง Playland ของสาขานี้ (null = ยังไม่กำหนด)
};

export function TeamPermissionsClient({
  users,
  branchId,
  branchName,
}: {
  users: TeamUser[];
  branchId: string | null;
  branchName: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // optimistic: เก็บตำแหน่งที่เลือกล่าสุดต่อ user → ช่อง ✓/– อัปเดตทันทีก่อน refresh
  const [optimistic, setOptimistic] = useState<Record<string, string | null>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const posOf = (u: TeamUser): string | null =>
    u.id in optimistic ? optimistic[u.id] : u.position;

  const changePosition = (userId: string, raw: string) => {
    if (!branchId) {
      alert("ยังไม่มีสาขา — สร้างสาขาก่อนตั้งตำแหน่ง");
      return;
    }
    const next = isPlaylandPosition(raw) ? raw : null;
    setOptimistic((m) => ({ ...m, [userId]: next })); // อัปเดตช่อง ✓/– ทันที
    setSavingId(userId);
    start(async () => {
      const res = await setStaffPosition({ userId, branchId, position: next });
      setSavingId(null);
      if (!res.ok) {
        setOptimistic((m) => {
          const { [userId]: _, ...rest } = m; // rollback
          return rest;
        });
        alert(res.error || "บันทึกไม่สำเร็จ");
        return;
      }
      router.refresh();
    });
  };

  const hasUnassigned = users.some((u) => !posOf(u));

  return (
    <div style={{ fontFamily: MITR, color: INK }}>
      {/* legend: อธิบายแต่ละตำแหน่ง */}
      <div style={{ ...card, padding: "14px 16px", marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: MUTED, marginBottom: 8 }}>ตำแหน่งใน Playland</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          {PLAYLAND_POSITIONS.map((p) => {
            const c = chipColor(p.key);
            return (
              <div key={p.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: c.fg,
                    background: c.bg,
                    border: `1px solid ${c.border}`,
                    borderRadius: 999,
                    padding: "3px 10px",
                  }}
                >
                  {p.label}
                </span>
                <span style={{ fontSize: 12, color: MUTED }}>{p.gloss}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* matrix — กว้าง · มือถือเลื่อนแนวนอน */}
      <div style={{ ...card, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 860 }}>
            <thead>
              <tr style={{ background: "#faf8f3", borderBottom: `1px solid ${LINE}` }}>
                <th style={thStyle("left", 240)}>พนักงาน</th>
                <th style={thStyle("left", 170)}>ตำแหน่ง</th>
                {PLAYLAND_PERMISSIONS.map((perm) => (
                  <th key={perm.key} style={thStyle("center")}>
                    {perm.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.length === 0 && (
                <tr>
                  <td colSpan={2 + PLAYLAND_PERMISSIONS.length} style={{ padding: "28px 16px", textAlign: "center", color: MUTED, fontSize: 14 }}>
                    ยังไม่มีพนักงานใน org นี้
                  </td>
                </tr>
              )}
              {users.map((u) => {
                const pos = posOf(u);
                const perms: Record<string, boolean> | null = isPlaylandPosition(pos)
                  ? POSITION_PERMISSIONS[pos as PlaylandPositionKey]
                  : null;
                const c = chipColor(pos);
                const isSaving = savingId === u.id && pending;
                const initial = (u.name?.trim()?.[0] ?? u.email?.trim()?.[0] ?? "?").toUpperCase();
                return (
                  <tr key={u.id} style={{ borderBottom: `1px solid ${LINE}`, opacity: isSaving ? 0.55 : 1 }}>
                    {/* พนักงาน */}
                    <td style={{ padding: "12px 16px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span
                          style={{
                            width: 34,
                            height: 34,
                            borderRadius: 999,
                            background: c.bg,
                            color: c.fg,
                            border: `1px solid ${c.border}`,
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontWeight: 700,
                            fontSize: 14,
                            flexShrink: 0,
                          }}
                        >
                          {initial}
                        </span>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 180 }}>
                            {u.name || "(ไม่มีชื่อ)"}
                          </div>
                          <div style={{ fontSize: 12, color: MUTED, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 180 }}>
                            {u.email || "—"}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* ตำแหน่ง — dropdown */}
                    <td style={{ padding: "12px 16px" }}>
                      <select
                        value={pos ?? ""}
                        disabled={isSaving}
                        onChange={(e) => changePosition(u.id, e.target.value)}
                        style={{
                          fontSize: 16,
                          fontFamily: MITR,
                          fontWeight: 600,
                          color: c.fg,
                          background: c.bg,
                          border: `1px solid ${c.border}`,
                          borderRadius: 10,
                          padding: "7px 10px",
                          cursor: isSaving ? "wait" : "pointer",
                          outline: "none",
                          width: "100%",
                          maxWidth: 160,
                        }}
                      >
                        <option value="">— ยังไม่กำหนด</option>
                        {PLAYLAND_POSITIONS.map((p) => (
                          <option key={p.key} value={p.key}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                    </td>

                    {/* ช่องสิทธิ์ — อ่านอย่างเดียว · derive จากตำแหน่ง */}
                    {PLAYLAND_PERMISSIONS.map((perm) => {
                      const on = perms ? perms[perm.key] === true : false;
                      return (
                        <td key={perm.key} style={{ padding: "12px 8px", textAlign: "center" }}>
                          {on ? (
                            <Check size={18} color={GREEN} strokeWidth={3} />
                          ) : (
                            <Minus size={16} color="#cfc6b7" strokeWidth={3} />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* หมายเหตุ null case */}
      {hasUnassigned && (
        <div style={{ fontSize: 12, color: MUTED, marginTop: 12, lineHeight: 1.6 }}>
          พนักงานที่ยังไม่กำหนดตำแหน่ง = ใช้สิทธิ์ตามระบบเดิม (role ขององค์กร) · กำหนดตำแหน่งเมื่อต้องการให้สิทธิ์มาตามตำแหน่ง Playland
        </div>
      )}
      <div style={{ fontSize: 12, color: MUTED, marginTop: 6 }}>
        ตำแหน่งเป็นรายสาขา — กำลังตั้งให้สาขา <b style={{ color: INK }}>{branchName}</b>
      </div>
    </div>
  );
}

function thStyle(align: "left" | "center", width?: number): React.CSSProperties {
  return {
    textAlign: align,
    padding: "11px 12px",
    fontSize: 12,
    fontWeight: 600,
    color: MUTED,
    fontFamily: MITR,
    whiteSpace: "nowrap",
    width,
  };
}
