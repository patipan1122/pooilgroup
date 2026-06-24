"use client";

// Playland · บันทึกซ่อมเครื่อง + เบิกอะไหล่ → ตัดสต๊อกอะไหล่
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { logRepair } from "@/lib/playland/stock";

type Part = { id: string; name: string; stock: number; costCents: number | null };
type Line = { productId: string; name: string; quantity: number; stock: number; costBaht: number };

const MITR = "var(--font-mitr), 'Mitr', sans-serif";
const FREDOKA = "var(--font-fredoka), 'Fredoka', sans-serif";
const input: React.CSSProperties = { background: "#fff", border: "1px solid #ece5d8", borderRadius: 10, padding: "11px 13px", fontSize: 15, fontFamily: MITR, color: "#3A3026", outline: "none", boxSizing: "border-box", width: "100%" };

export function RepairForm({ branchId, parts }: { branchId: string; parts: Part[] }) {
  const router = useRouter();
  const [machine, setMachine] = useState("");
  const [desc, setDesc] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const pmap = useMemo(() => new Map(parts.map((p) => [p.id, p])), [parts]);

  const addPart = (id: string) => {
    const p = pmap.get(id);
    if (!p) return;
    setLines((ls) => (ls.find((l) => l.productId === id) ? ls.map((l) => (l.productId === id ? { ...l, quantity: l.quantity + 1 } : l)) : [...ls, { productId: id, name: p.name, quantity: 1, stock: p.stock, costBaht: Math.round((p.costCents ?? 0) / 100) }]));
  };
  const setQty = (id: string, q: number) => setLines((ls) => ls.map((l) => (l.productId === id ? { ...l, quantity: Math.max(0, q) } : l)));
  const remove = (id: string) => setLines((ls) => ls.filter((l) => l.productId !== id));
  const totalCost = lines.reduce((a, l) => a + l.quantity * l.costBaht, 0);

  const submit = async () => {
    if (busy) return;
    if (!machine.trim()) { setMsg("ใส่ชื่อเครื่อง/จุดที่ซ่อม"); return; }
    setBusy(true);
    setMsg(null);
    try {
      const res = await logRepair({ branchId, machineLabel: machine, description: desc, parts: lines.filter((l) => l.quantity > 0).map((l) => ({ productId: l.productId, quantity: l.quantity })) });
      if (res.ok) { setMsg(`✓ บันทึกซ่อมแล้ว · ค่าอะไหล่ ฿${Math.round(res.data.partsCostCents / 100).toLocaleString()}`); setMachine(""); setDesc(""); setLines([]); router.refresh(); }
      else setMsg("❌ " + res.error);
    } catch { setMsg("❌ บันทึกไม่สำเร็จ · ลองใหม่"); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ background: "#fff", border: "1px solid #ece5d8", borderRadius: 16, padding: 18, display: "grid", gap: 12 }}>
        <div>
          <div style={{ fontSize: 13, color: "#8a7f70", marginBottom: 6 }}>เครื่อง/จุดที่ซ่อม *</div>
          <input value={machine} onChange={(e) => setMachine(e.target.value)} placeholder="เช่น เครื่องเล่นโซน A · ประตูสแกน 2" style={input} />
        </div>
        <div>
          <div style={{ fontSize: 13, color: "#8a7f70", marginBottom: 6 }}>อาการ/รายละเอียด (ไม่บังคับ)</div>
          <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="เช่น มอเตอร์เสีย เปลี่ยนสายพาน" style={input} />
        </div>
      </div>

      <div style={{ background: "#fff", border: "1px solid #ece5d8", borderRadius: 16, padding: 18 }}>
        <div style={{ fontSize: 14, color: "#8a7f70", marginBottom: 8 }}>เบิกอะไหล่ที่ใช้ (ตัดสต๊อก)</div>
        {parts.length === 0 ? (
          <div style={{ color: "#a89c8b", fontSize: 14 }}>ยังไม่มีอะไหล่ในคลัง · เพิ่มสินค้าแล้วตั้งประเภทเป็น &quot;อะไหล่&quot;</div>
        ) : (
          <select value={pick} onChange={(e) => { if (e.target.value) { addPart(e.target.value); setPick(""); } }} style={input}>
            <option value="">+ เลือกอะไหล่…</option>
            {parts.map((p) => <option key={p.id} value={p.id} disabled={p.stock <= 0}>🔧 {p.name} (เหลือ {p.stock}){p.stock <= 0 ? " — หมด" : ""}</option>)}
          </select>
        )}
        {lines.length > 0 && (
          <div style={{ marginTop: 12, border: "1px solid #f2ebdd", borderRadius: 12, overflow: "hidden" }}>
            {lines.map((l) => (
              <div key={l.productId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: "1px solid #f2ebdd" }}>
                <div style={{ flex: 1, minWidth: 0, fontSize: 15 }}>{l.name} <span style={{ fontSize: 12, color: "#a89c8b" }}>(เหลือ {l.stock})</span></div>
                <input type="number" value={l.quantity} onChange={(e) => setQty(l.productId, parseInt(e.target.value) || 0)} style={{ ...input, width: 72, fontFamily: FREDOKA }} />
                <button onClick={() => remove(l.productId)} style={{ background: "none", border: "none", color: "#E74C3C", cursor: "pointer", fontSize: 18 }}>×</button>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 14px", background: "#f9f4ea" }}><span style={{ fontSize: 14 }}>ค่าอะไหล่รวม</span><span style={{ fontFamily: FREDOKA, fontWeight: 700, color: "#a9791a" }}>฿{totalCost.toLocaleString()}</span></div>
          </div>
        )}
      </div>

      {msg && <div style={{ borderRadius: 10, padding: "12px 16px", fontSize: 15, background: msg.startsWith("✓") ? "#eaf3eb" : "#fdecea", color: msg.startsWith("✓") ? "#1F8A5B" : "#c0392b" }}>{msg}</div>}
      <button onClick={submit} disabled={busy} style={{ background: "#2D6CB1", color: "#fff", border: "none", borderRadius: 14, padding: 16, fontFamily: MITR, fontWeight: 500, fontSize: 18, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>{busy ? "กำลังบันทึก…" : "บันทึกการซ่อม"}</button>
    </div>
  );
}
