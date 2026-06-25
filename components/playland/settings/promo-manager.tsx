"use client";

// Playland · จัดโปรโมชั่น (ส่วนกลาง) — ฟอร์มซ้าย + ตารางขวา · สไตล์ Play a lot · พื้นขาว
// ส่วนลดทั้งหมดมาจากที่นี่ · แคชเชียร์ลดเองไม่ได้ (CEO policy)
// CRUD only — enforcement (ใช้โปรที่ POS) = Wave 3
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { upsertPromo, togglePromo, deletePromo } from "@/lib/playland/promo-actions";
import { Tag, PlusCircle, CheckCircle2, AlertCircle, Trash2 } from "lucide-react";

const INK = "#3A3026", MUTED = "#8a7f70", BLUE = "#2D6CB1", AMBER = "#a9791a", GREEN = "#1F8A5B", RED = "#E74C3C", LINE = "#ece5d8";
const FREDOKA = "var(--font-fredoka), 'Fredoka', sans-serif";
const MITR = "var(--font-mitr), 'Mitr', sans-serif";
const MONO = "'IBM Plex Mono', var(--font-plex-mono), ui-monospace, monospace";
const card: React.CSSProperties = { background: "#fff", border: `1px solid ${LINE}`, borderRadius: 16, boxShadow: "0 1px 3px rgba(58,48,38,.05)" };

type PromoType = "COUPON" | "LOYALTY_POINTS" | "BIRTHDAY" | "WEEKDAY" | "HAPPY_HOUR" | "PACKAGE_DISCOUNT";

const TYPE_LABEL: Record<PromoType, string> = {
  COUPON: "คูปอง",
  LOYALTY_POINTS: "แต้มสะสม",
  BIRTHDAY: "วันเกิด",
  WEEKDAY: "วันธรรมดา",
  HAPPY_HOUR: "ช่วงเวลาพิเศษ",
  PACKAGE_DISCOUNT: "ลดแพ็กเกจ",
};
const TYPE_ORDER: PromoType[] = ["COUPON", "WEEKDAY", "HAPPY_HOUR", "BIRTHDAY", "PACKAGE_DISCOUNT", "LOYALTY_POINTS"];

export interface PromoRow {
  id: string;
  code: string | null;
  name: string;
  type: PromoType;
  discountPercent: number | null;
  discountCents: number | null;
  maxUses: number | null;
  usesCount: number;
  startsAt: string | null;
  endsAt: string | null;
  branchId: string | null;
  active: boolean;
}
interface BranchOpt { id: string; name: string; }

const thb = (cents: number) => "฿" + (cents / 100).toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const toDateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
const fmtDay = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("th-TH", { day: "2-digit", month: "short" }) : null);

export function PromoManager({ promos, branches }: { promos: PromoRow[]; branches: BranchOpt[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<PromoRow | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // form state
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [type, setType] = useState<PromoType>("COUPON");
  const [discMode, setDiscMode] = useState<"percent" | "cents">("percent");
  const [discPercent, setDiscPercent] = useState("");
  const [discBaht, setDiscBaht] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [branchId, setBranchId] = useState(""); // "" = ทุกสาขา
  const [active, setActive] = useState(true);

  function resetForm() {
    setName(""); setCode(""); setType("COUPON"); setDiscMode("percent");
    setDiscPercent(""); setDiscBaht(""); setMaxUses(""); setStartsAt(""); setEndsAt(""); setBranchId(""); setActive(true);
  }
  function startNew() { setEditing(null); resetForm(); setShowForm(true); }
  function startEdit(p: PromoRow) {
    setEditing(p);
    setName(p.name); setCode(p.code ?? ""); setType(p.type);
    if (p.discountCents != null) { setDiscMode("cents"); setDiscBaht(String(p.discountCents / 100)); setDiscPercent(""); }
    else { setDiscMode("percent"); setDiscPercent(p.discountPercent != null ? String(p.discountPercent) : ""); setDiscBaht(""); }
    setMaxUses(p.maxUses != null ? String(p.maxUses) : "");
    setStartsAt(toDateInput(p.startsAt)); setEndsAt(toDateInput(p.endsAt));
    setBranchId(p.branchId ?? ""); setActive(p.active);
    setShowForm(true);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const percent = discMode === "percent" && discPercent !== "" ? Number(discPercent) : undefined;
    const cents = discMode === "cents" && discBaht !== "" ? Math.round(Number(discBaht) * 100) : undefined;
    start(async () => {
      const res = await upsertPromo({
        id: editing?.id,
        name, code: code || undefined, type,
        discountPercent: percent, discountCents: cents,
        maxUses: maxUses !== "" ? Number(maxUses) : undefined,
        startsAt: startsAt || undefined, endsAt: endsAt || undefined,
        branchId: branchId || undefined, active,
      });
      if (!res.ok) { setMsg({ kind: "err", text: res.error }); return; }
      setMsg({ kind: "ok", text: editing ? "อัปเดตโปรแล้ว" : "เพิ่มโปรใหม่แล้ว" });
      setShowForm(false); router.refresh();
    });
  }
  function onToggle(p: PromoRow) {
    start(async () => { await togglePromo({ id: p.id, active: !p.active }); router.refresh(); });
  }
  function onDelete(p: PromoRow) {
    if (!confirm(`ลบโปร "${p.name}" ?`)) return;
    start(async () => { await deletePromo({ id: p.id }); setMsg({ kind: "ok", text: "ลบโปรแล้ว" }); router.refresh(); });
  }

  const branchName = (id: string | null) => (id ? (branches.find((b) => b.id === id)?.name ?? "สาขา") : null);

  return (
    <div style={{ fontFamily: MITR, color: INK }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
        <h2 style={{ fontFamily: FREDOKA, fontSize: "1.05rem", fontWeight: 600, margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
          <Tag size={18} color={BLUE} /> โปรโมชั่น <span style={{ fontFamily: MONO, fontSize: 14, color: MUTED, fontWeight: 400 }}>{promos.length}</span>
        </h2>
        <button type="button" onClick={startNew} style={btnPrimary("auto")}>
          <PlusCircle size={15} /> เพิ่มโปร
        </button>
      </div>

      {msg && (
        <div style={{ padding: "10px 14px", borderRadius: 11, marginBottom: 14, background: msg.kind === "ok" ? "#eaf3eb" : "#fdeceb", color: msg.kind === "ok" ? GREEN : RED, fontSize: 13, display: "flex", gap: 6, alignItems: "center" }}>
          {msg.kind === "ok" ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}{msg.text}
        </div>
      )}

      <div className={showForm ? "pl-grid-2" : undefined} style={showForm ? { alignItems: "start" } : undefined}>
        {/* ฟอร์มซ้าย */}
        {showForm && (
          <form onSubmit={submit} style={{ ...card, padding: 18, display: "grid", gap: 10 }}>
            <div style={{ fontFamily: FREDOKA, fontWeight: 600, fontSize: 14 }}>{editing ? "แก้โปรโมชั่น" : "โปรโมชั่นใหม่"}</div>
            <div>
              <label style={lbl}>ชื่อโปร *</label>
              <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น ลด 10% วันธรรมดา" style={inp} />
            </div>
            <div>
              <label style={lbl}>ประเภท *</label>
              <select value={type} onChange={(e) => setType(e.target.value as PromoType)} style={inp}>
                {TYPE_ORDER.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>รหัสคูปอง (code) · เว้นว่างได้</label>
              <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/\s/g, ""))} placeholder="เช่น WEEKDAY10" style={{ ...inp, fontFamily: MONO }} />
            </div>
            {/* ส่วนลด: % หรือ บาท */}
            <div>
              <label style={lbl}>ส่วนลด</label>
              <div style={{ display: "flex", gap: 8 }}>
                <select value={discMode} onChange={(e) => setDiscMode(e.target.value as "percent" | "cents")} style={{ ...inp, width: 110, flex: "none" }}>
                  <option value="percent">เปอร์เซ็นต์</option>
                  <option value="cents">บาท</option>
                </select>
                {discMode === "percent" ? (
                  <input type="number" min={0} max={100} value={discPercent} onChange={(e) => setDiscPercent(e.target.value)} placeholder="0–100" style={{ ...inp, fontFamily: MONO }} />
                ) : (
                  <input type="number" min={0} step="0.01" value={discBaht} onChange={(e) => setDiscBaht(e.target.value)} placeholder="บาท" style={{ ...inp, fontFamily: MONO }} />
                )}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ flex: 1 }}>
                <label style={lbl}>จำนวนครั้งสูงสุด</label>
                <input type="number" min={0} value={maxUses} onChange={(e) => setMaxUses(e.target.value)} placeholder="ไม่จำกัด" style={{ ...inp, fontFamily: MONO }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={lbl}>สาขา</label>
                <select value={branchId} onChange={(e) => setBranchId(e.target.value)} style={inp}>
                  <option value="">ทุกสาขา</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ flex: 1 }}>
                <label style={lbl}>เริ่ม</label>
                <input type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} style={inp} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={lbl}>หมดอายุ</label>
                <input type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} style={inp} />
              </div>
            </div>
            <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> เปิดใช้งานโปรนี้
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={() => setShowForm(false)} style={btnGhost}>ยกเลิก</button>
              <button type="submit" disabled={pending} style={{ ...btnPrimary(), flex: 1, opacity: pending ? 0.6 : 1, cursor: pending ? "wait" : "pointer" }}>{pending ? "บันทึก..." : "บันทึก"}</button>
            </div>
          </form>
        )}

        {/* ตารางขวา */}
        <div style={{ ...card, padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#faf7f1", borderBottom: `1px solid ${LINE}` }}>
                  <th style={th}>ชื่อ / code</th><th style={th}>ประเภท</th>
                  <th style={{ ...th, textAlign: "right" }}>ส่วนลด</th><th style={th}>เงื่อนไข</th>
                  <th style={th}>สาขา</th><th style={{ ...th, textAlign: "center" }}>Active</th><th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {promos.length === 0 && (
                  <tr><td colSpan={7} style={{ padding: 40, textAlign: "center", color: MUTED }}><Tag size={28} style={{ opacity: 0.4, display: "block", margin: "0 auto 8px" }} />ยังไม่มีโปรโมชั่น · กด “เพิ่มโปร”</td></tr>
                )}
                {promos.map((p) => (
                  <tr key={p.id} style={{ borderTop: `1px solid #f2ebdd` }}>
                    <td style={{ ...td, cursor: "pointer" }} onClick={() => startEdit(p)}>
                      <div style={{ fontWeight: 600 }}>{p.name}</div>
                      {p.code && <code style={{ fontSize: 11.5, fontFamily: MONO, color: MUTED }}>{p.code}</code>}
                    </td>
                    <td style={td}><span style={chip("#eaf2fb", BLUE)}>{TYPE_LABEL[p.type]}</span></td>
                    <td style={{ ...td, textAlign: "right", fontFamily: MONO, fontWeight: 600, color: AMBER }}>
                      {p.discountPercent != null ? `${p.discountPercent}%` : p.discountCents != null ? thb(p.discountCents) : "—"}
                    </td>
                    <td style={{ ...td, color: MUTED, fontSize: 12 }}>
                      <div>ใช้ {p.usesCount}{p.maxUses != null ? ` / ${p.maxUses}` : " / ∞"}</div>
                      {fmtDay(p.endsAt) && <div>ถึง {fmtDay(p.endsAt)}</div>}
                    </td>
                    <td style={td}>
                      {p.branchId
                        ? <span style={chip("#f4efe6", MUTED)}>{branchName(p.branchId)}</span>
                        : <span style={chip("#eaf3eb", GREEN)}>ทุกสาขา</span>}
                    </td>
                    <td style={{ ...td, textAlign: "center" }}>
                      <button type="button" onClick={() => onToggle(p)} disabled={pending} title={p.active ? "ปิด" : "เปิด"}
                        style={{ border: "none", background: "transparent", cursor: pending ? "wait" : "pointer", padding: 0 }}>
                        {p.active ? <span style={chip("#eaf3eb", GREEN)}>ใช้</span> : <span style={chip("#f2ebdd", MUTED)}>ปิด</span>}
                      </button>
                    </td>
                    <td style={{ ...td, textAlign: "center" }}>
                      <button type="button" onClick={() => onDelete(p)} disabled={pending} title="ลบ"
                        style={{ border: "none", background: "transparent", color: RED, cursor: pending ? "wait" : "pointer", padding: 4 }}>
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

const th: React.CSSProperties = { textAlign: "left", padding: "11px 16px", fontSize: 11, fontWeight: 600, color: MUTED, textTransform: "uppercase", letterSpacing: 0.4 };
const td: React.CSSProperties = { padding: "12px 16px", verticalAlign: "middle" };
const lbl: React.CSSProperties = { fontSize: 12, color: MUTED, display: "block", marginBottom: 4 };
const inp: React.CSSProperties = { width: "100%", border: `1px solid ${LINE}`, borderRadius: 9, padding: "9px 12px", fontSize: 13, fontFamily: MITR, color: INK, background: "#fff", outline: "none", boxSizing: "border-box" };
const chip = (bg: string, fg: string): React.CSSProperties => ({ display: "inline-flex", alignItems: "center", fontSize: 11.5, fontWeight: 600, borderRadius: 99, padding: "2px 10px", background: bg, color: fg });
const btnGhost: React.CSSProperties = { flex: 1, border: `1px solid ${LINE}`, borderRadius: 9, padding: "9px 14px", fontSize: 13, fontWeight: 600, background: "#fff", color: MUTED, cursor: "pointer", fontFamily: MITR };
function btnPrimary(marginLeft?: string): React.CSSProperties {
  return { marginLeft, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, border: "none", borderRadius: 9, padding: "9px 16px", fontSize: 13, fontWeight: 600, background: BLUE, color: "#fff", cursor: "pointer", fontFamily: MITR };
}
