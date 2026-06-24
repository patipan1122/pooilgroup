"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { upsertPackage } from "@/lib/playland/actions";
import { thb, packageTypeLabel } from "@/lib/playland/format";
import { Package, PlusCircle } from "lucide-react";

interface Branch { id: string; name: string; }
interface Pkg {
  id: string; branchId: string | null; type: string; name: string; description: string | null;
  minutes: number | null; price: number; perMinuteRate: number | null; active: boolean;
}

const TYPES = [
  { v: "FIXED", label: "Fixed (เหมา)" },
  { v: "PER_MINUTE", label: "Pay-per-minute" },
  { v: "DAY_PASS", label: "Day Pass" },
] as const;

// Locked "Play a lot" tokens (matches office)
const INK = "#3A3026", MUTED = "#8a7f70", BLUE = "#2D6CB1", GREEN = "#1F8A5B", RED = "#E74C3C", LINE = "#ece5d8";
const MITR = "var(--font-mitr), 'Mitr', sans-serif";
const FREDOKA = "var(--font-fredoka), 'Fredoka', sans-serif";
const MONO = "'IBM Plex Mono', var(--font-plex-mono), ui-monospace, monospace";
const card: React.CSSProperties = { background: "#fff", border: `1px solid ${LINE}`, borderRadius: 16, boxShadow: "0 1px 3px rgba(58,48,38,.05)" };
const th: React.CSSProperties = { fontSize: 11.5, color: MUTED, fontWeight: 600, textAlign: "left", padding: "11px 14px", borderBottom: `1px solid ${LINE}` };
const td: React.CSSProperties = { fontSize: 13.5, padding: "12px 14px", borderBottom: `1px solid #f2ebdd` };
const chip = (bg: string, fg: string): React.CSSProperties => ({ display: "inline-flex", alignItems: "center", fontSize: 11.5, fontWeight: 600, borderRadius: 99, padding: "2px 10px", background: bg, color: fg });
const lbl: React.CSSProperties = { fontSize: 12, color: MUTED, display: "block", marginBottom: 4 };
const inputS: React.CSSProperties = { width: "100%", border: `1px solid ${LINE}`, borderRadius: 9, padding: "9px 11px", fontSize: 14, fontFamily: MITR, color: INK, background: "#fff", boxSizing: "border-box" };
function btn(primary: boolean): React.CSSProperties {
  return { display: "inline-flex", alignItems: "center", gap: 7, cursor: "pointer", borderRadius: 9, padding: "9px 16px", fontSize: 13, fontWeight: 600, fontFamily: MITR,
    background: primary ? BLUE : "#fff", color: primary ? "#fff" : MUTED, border: primary ? "none" : `1px solid ${LINE}` };
}

export function PackagesClient({ branches, packages, activeBranchId }: { branches: Branch[]; packages: Pkg[]; activeBranchId: string | null }) {
  const router = useRouter();
  const activeBranchName = branches.find((b) => b.id === activeBranchId)?.name ?? "";
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<Pkg | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [type, setType] = useState<(typeof TYPES)[number]["v"]>("FIXED");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [minutes, setMinutes] = useState("60");
  const [price, setPrice] = useState("100");
  const [perMinute, setPerMinute] = useState("2");
  const [branchId, setBranchId] = useState<string | "">("");
  const [active, setActive] = useState(true);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  function startEdit(p: Pkg) {
    setEditing(p);
    setType(p.type as (typeof TYPES)[number]["v"]);
    setName(p.name);
    setDescription(p.description ?? "");
    setMinutes(String(p.minutes ?? 60));
    setPrice(((p.price ?? 0) / 100).toString());
    setPerMinute(((p.perMinuteRate ?? 200) / 100).toString());
    setBranchId(p.branchId ?? "");
    setActive(p.active);
    setSaveErr(null);
    setShowForm(true);
  }
  function startNew() {
    setEditing(null);
    setType("FIXED"); setName(""); setDescription(""); setMinutes("60"); setPrice("100"); setPerMinute("2"); setBranchId(activeBranchId ?? ""); setActive(true); setSaveErr(null);
    setShowForm(true);
  }
  function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaveErr(null);
    start(async () => {
      const priceCents = Math.round(parseFloat(price || "0") * 100);
      const perMinuteCents = Math.round(parseFloat(perMinute || "0") * 100);
      const res = await upsertPackage({
        id: editing?.id,
        branchId: branchId || null,
        type,
        name,
        description: description || undefined,
        minutes: type === "DAY_PASS" ? undefined : parseInt(minutes || "0"),
        price: priceCents,
        perMinuteRate: type === "PER_MINUTE" ? perMinuteCents : undefined,
        active,
      });
      if (res.ok) { setShowForm(false); router.refresh(); }
      else setSaveErr(res.error || "บันทึกไม่สำเร็จ · ลองใหม่");
    });
  }

  return (
    <div style={{ fontFamily: MITR, color: INK, padding: "22px 28px 44px", maxWidth: 1480, margin: "0 auto" }}>
      {/* sub-header: title + count + primary action */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: "1.2rem", fontWeight: 600, fontFamily: FREDOKA, display: "flex", alignItems: "center", gap: 8 }}>
            <Package size={19} color={BLUE} /> Packages · {packages.length}
          </div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>
            ราคาเข้าเล่น{activeBranchName && <> · <span style={{ color: BLUE }}>{activeBranchName}</span></>} · แตะแถวเพื่อแก้ราคา/เวลา
          </div>
        </div>
        <button onClick={startNew} style={{ ...btn(true), marginLeft: "auto" }}><PlusCircle size={15} /> เพิ่ม Package</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: showForm ? "1fr 360px" : "1fr", gap: 16, alignItems: "start" }}>
        <div style={{ ...card, overflow: "hidden" }}>
          {packages.length === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "48px 20px", color: MUTED }}>
              <Package size={30} opacity={0.4} />ยังไม่มี package
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>
                <th style={th}>ชื่อ</th><th style={th}>ประเภท</th><th style={{ ...th, textAlign: "right" }}>นาที</th>
                <th style={{ ...th, textAlign: "right" }}>ราคา</th><th style={th}>สาขา</th><th style={{ ...th, textAlign: "center" }}>Active</th>
              </tr></thead>
              <tbody>
                {packages.map((p) => {
                  const isSel = editing?.id === p.id;
                  return (
                    <tr key={p.id} onClick={() => startEdit(p)} style={{ cursor: "pointer", background: isSel ? "#f5f9fe" : "transparent" }}>
                      <td style={{ ...td, fontWeight: 600 }}>{p.name}</td>
                      <td style={td}><span style={chip("#eaf2fb", BLUE)}>{packageTypeLabel(p.type)}</span></td>
                      <td style={{ ...td, textAlign: "right", fontFamily: MONO }}>
                        {p.type === "DAY_PASS" ? "ทั้งวัน" : p.type === "PER_MINUTE" ? `${(p.perMinuteRate ?? 0) / 100}฿/min` : `${p.minutes ?? 0}`}
                      </td>
                      <td style={{ ...td, textAlign: "right", fontFamily: MONO, fontWeight: 600 }}>{thb(p.price)}</td>
                      <td style={td}>
                        {p.branchId
                          ? <span style={chip("#f2ebdd", MUTED)}>{branches.find((b) => b.id === p.branchId)?.name ?? "—"}</span>
                          : <span style={chip("#eaf3eb", GREEN)}>ทุกสาขา</span>}
                      </td>
                      <td style={{ ...td, textAlign: "center" }}>
                        {p.active
                          ? <span style={chip("#eaf3eb", GREEN)}>ใช้</span>
                          : <span style={chip("#f2ebdd", MUTED)}>ปิด</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {showForm && (
          <form onSubmit={submit} style={{ ...card, padding: 18, display: "grid", gap: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 600, fontFamily: FREDOKA }}>{editing ? "แก้ package" : "package ใหม่"}</div>
            <div>
              <label style={lbl}>ประเภท *</label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {TYPES.map((t) => (
                  <button type="button" key={t.v} onClick={() => setType(t.v)}
                    style={{ ...btn(type === t.v), padding: "7px 12px", fontSize: 12 }}>{t.label}</button>
                ))}
              </div>
            </div>
            <div>
              <label style={lbl}>ชื่อ *</label>
              <input style={inputS} required value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น 60 นาที / Day Pass" />
            </div>
            {type !== "DAY_PASS" && (
              <div>
                <label style={lbl}>นาที</label>
                <input style={inputS} type="number" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
              </div>
            )}
            {type === "PER_MINUTE" && (
              <div>
                <label style={lbl}>ราคาต่อนาที (บาท)</label>
                <input style={inputS} type="number" step="0.01" value={perMinute} onChange={(e) => setPerMinute(e.target.value)} />
              </div>
            )}
            <div>
              <label style={lbl}>ราคา (บาท)</label>
              <input style={inputS} type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} required />
            </div>
            <div>
              <label style={lbl}>สาขา</label>
              <select style={inputS} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                <option value="">ทุกสาขา</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <label style={{ fontSize: 13.5, display: "flex", alignItems: "center", gap: 7 }}>
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active
            </label>
            {saveErr && <div style={{ fontSize: 13, color: "#fff", background: RED, borderRadius: 9, padding: "8px 12px" }}>{saveErr}</div>}
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" style={btn(false)} onClick={() => setShowForm(false)}>ยกเลิก</button>
              <button type="submit" style={btn(true)} disabled={pending}>{pending ? "บันทึก..." : "บันทึก"}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
