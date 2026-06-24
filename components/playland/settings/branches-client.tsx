"use client";

// Playland · จัดการสาขา (CRUD) — สไตล์ Play a lot · พื้นขาว · เต็มความกว้าง
// ไม่มี shell ของตัวเอง (หน้า branches เป็นคนครอบ header strip + locked wrapper)
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { upsertBranch } from "@/lib/playland/actions";
import { Building2, PlusCircle, CheckCircle2, AlertCircle } from "lucide-react";

const INK = "#3A3026", MUTED = "#8a7f70", BLUE = "#2D6CB1", GREEN = "#1F8A5B", RED = "#E74C3C", LINE = "#ece5d8";
const FREDOKA = "var(--font-fredoka), 'Fredoka', sans-serif";
const MITR = "var(--font-mitr), 'Mitr', sans-serif";
const MONO = "'IBM Plex Mono', var(--font-plex-mono), ui-monospace, monospace";
const card: React.CSSProperties = { background: "#fff", border: `1px solid ${LINE}`, borderRadius: 16, boxShadow: "0 1px 3px rgba(58,48,38,.05)" };

interface Branch {
  id: string;
  name: string;
  slug: string;
  address: string | null;
  phone: string | null;
  active: boolean;
}

export function BranchesClient({ branches }: { branches: Branch[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [showForm, setShowForm] = useState(branches.length === 0);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [name, setName] = useState(editing?.name ?? "");
  const [slug, setSlug] = useState(editing?.slug ?? "");
  const [address, setAddress] = useState(editing?.address ?? "");
  const [phone, setPhone] = useState(editing?.phone ?? "");
  const [active, setActive] = useState(editing?.active ?? true);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  function startEdit(b: Branch) {
    setEditing(b);
    setName(b.name); setSlug(b.slug); setAddress(b.address ?? ""); setPhone(b.phone ?? ""); setActive(b.active);
    setShowForm(true);
  }
  function startNew() {
    setEditing(null);
    setName(""); setSlug(""); setAddress(""); setPhone(""); setActive(true);
    setShowForm(true);
  }
  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await upsertBranch({ id: editing?.id, name, slug, address: address || undefined, phone: phone || undefined, active });
      if (!res.ok) { setMsg({ kind: "err", text: res.error }); return; }
      setMsg({ kind: "ok", text: editing ? "อัปเดตสาขาแล้ว" : "สร้างสาขาใหม่แล้ว" });
      setShowForm(false);
      router.refresh();
    });
  }

  return (
    <div style={{ fontFamily: MITR, color: INK }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
        <h2 style={{ fontFamily: FREDOKA, fontSize: "1.05rem", fontWeight: 600, margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
          <Building2 size={18} color={BLUE} /> สาขา <span style={{ fontFamily: MONO, fontSize: 14, color: MUTED, fontWeight: 400 }}>{branches.length}</span>
        </h2>
        <button type="button" onClick={startNew} style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 7, border: "none", borderRadius: 9, padding: "9px 16px", fontSize: 13, fontWeight: 600, background: BLUE, color: "#fff", cursor: "pointer", fontFamily: MITR }}>
          <PlusCircle size={15} /> เพิ่มสาขา
        </button>
      </div>

      {msg && (
        <div style={{ padding: "10px 14px", borderRadius: 11, marginBottom: 14, background: msg.kind === "ok" ? "#eaf3eb" : "#fdeceb", color: msg.kind === "ok" ? GREEN : RED, fontSize: 13, display: "flex", gap: 6, alignItems: "center" }}>
          {msg.kind === "ok" ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}{msg.text}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: showForm ? "1fr 380px" : "1fr", gap: 16, alignItems: "start" }}>
        <div style={{ ...card, padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#faf7f1", borderBottom: `1px solid ${LINE}` }}>
                <th style={th}>ชื่อ</th><th style={th}>Slug (URL)</th><th style={th}>ที่อยู่</th><th style={th}>เบอร์</th><th style={th}>สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {branches.length === 0 && (
                <tr><td colSpan={5} style={{ padding: 40, textAlign: "center", color: MUTED }}><Building2 size={28} style={{ opacity: 0.4, display: "block", margin: "0 auto 8px" }} />ยังไม่มีสาขา</td></tr>
              )}
              {branches.map((b) => (
                <tr key={b.id} onClick={() => startEdit(b)} style={{ borderTop: `1px solid #f2ebdd`, cursor: "pointer" }}>
                  <td style={{ ...td, fontWeight: 600 }}>{b.name}</td>
                  <td style={td}><code style={{ fontSize: 12, fontFamily: MONO, color: MUTED }}>{b.slug}</code></td>
                  <td style={{ ...td, color: b.address ? INK : "#b3a896" }}>{b.address ?? "—"}</td>
                  <td style={{ ...td, fontFamily: MONO, color: b.phone ? INK : "#b3a896" }}>{b.phone ?? "—"}</td>
                  <td style={td}>
                    {b.active
                      ? <span style={{ ...pill, background: "#eaf3eb", color: GREEN }}>ใช้งาน</span>
                      : <span style={{ ...pill, background: "#f4efe6", color: MUTED }}>ปิด</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {showForm && (
          <form onSubmit={submit} style={{ ...card, padding: 18, display: "grid", gap: 10 }}>
            <div style={{ fontFamily: FREDOKA, fontWeight: 600, fontSize: 14 }}>{editing ? "แก้สาขา" : "สาขาใหม่"}</div>
            <div>
              <label style={lbl}>ชื่อสาขา *</label>
              <input required value={name} onChange={(e) => setName(e.target.value)} style={inp} />
            </div>
            <div>
              <label style={lbl}>Slug (สำหรับ URL public · ใช้ภาษาอังกฤษ) *</label>
              <input required value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} placeholder="เช่น central-westgate" style={inp} />
            </div>
            <div>
              <label style={lbl}>ที่อยู่</label>
              <input value={address} onChange={(e) => setAddress(e.target.value)} style={inp} />
            </div>
            <div>
              <label style={lbl}>เบอร์</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} style={inp} />
            </div>
            <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> เปิดใช้งานสาขา
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={() => setShowForm(false)} style={{ flex: 1, border: `1px solid ${LINE}`, borderRadius: 9, padding: "9px 14px", fontSize: 13, fontWeight: 600, background: "#fff", color: MUTED, cursor: "pointer", fontFamily: MITR }}>ยกเลิก</button>
              <button type="submit" disabled={pending} style={{ flex: 1, border: "none", borderRadius: 9, padding: "9px 14px", fontSize: 13, fontWeight: 600, background: BLUE, color: "#fff", cursor: pending ? "wait" : "pointer", fontFamily: MITR, opacity: pending ? 0.6 : 1 }}>{pending ? "บันทึก..." : "บันทึก"}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

const th: React.CSSProperties = { textAlign: "left", padding: "11px 16px", fontSize: 11, fontWeight: 600, color: MUTED, textTransform: "uppercase", letterSpacing: 0.4 };
const td: React.CSSProperties = { padding: "12px 16px", verticalAlign: "middle" };
const pill: React.CSSProperties = { display: "inline-flex", alignItems: "center", borderRadius: 999, padding: "3px 10px", fontSize: 12, fontWeight: 500, fontFamily: MITR };
const lbl: React.CSSProperties = { fontSize: 12, color: MUTED, display: "block", marginBottom: 4 };
const inp: React.CSSProperties = { width: "100%", border: `1px solid ${LINE}`, borderRadius: 9, padding: "9px 12px", fontSize: 13, fontFamily: MITR, color: INK, background: "#fff", outline: "none", boxSizing: "border-box" };
