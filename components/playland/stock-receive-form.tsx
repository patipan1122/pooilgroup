"use client";

// Playland · รับของเข้า (goods receipt) — เลือก/ยิงบาร์โค้ดสินค้า → ใส่จำนวน+ต้นทุน → บันทึก → สต๊อกเพิ่ม
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { receivePurchase } from "@/lib/playland/stock";
import { BarcodeScanBox } from "@/components/playland/barcode-scan-box";

type Prod = { id: string; name: string; barcode: string | null; stock: number; costCents: number | null; kind: string };
type Line = { productId: string; name: string; quantity: number; unitCostBaht: number };

const MITR = "var(--font-mitr), 'Mitr', sans-serif";
const FREDOKA = "var(--font-fredoka), 'Fredoka', sans-serif";
const MONO = "'IBM Plex Mono', var(--font-plex-mono), ui-monospace, monospace";
const input: React.CSSProperties = { background: "#fff", border: "1px solid #ece5d8", borderRadius: 10, padding: "10px 12px", fontSize: 15, fontFamily: MITR, color: "#3A3026", outline: "none", boxSizing: "border-box" };
const card: React.CSSProperties = { background: "#fff", border: "1px solid #ece5d8", borderRadius: 16, boxShadow: "0 1px 3px rgba(58,48,38,.05)" };

export function StockReceiveForm({ branchId, products }: { branchId: string; products: Prod[] }) {
  const router = useRouter();
  const [lines, setLines] = useState<Line[]>([]);
  const [supplier, setSupplier] = useState("");
  const [note, setNote] = useState("");
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const pmap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const addProduct = (id: string) => {
    const p = pmap.get(id);
    if (!p) return;
    setLines((ls) => {
      const ex = ls.find((l) => l.productId === id);
      if (ex) return ls.map((l) => (l.productId === id ? { ...l, quantity: l.quantity + 1 } : l));
      return [...ls, { productId: id, name: p.name, quantity: 1, unitCostBaht: Math.round((p.costCents ?? 0) / 100) }];
    });
  };
  const onScan = (code: string) => {
    const p = products.find((x) => x.barcode === code.trim());
    if (p) { addProduct(p.id); setMsg(`+ ${p.name}`); }
    else setMsg(`❌ ไม่พบบาร์โค้ด ${code}`);
  };
  const setQty = (id: string, q: number) => setLines((ls) => ls.map((l) => (l.productId === id ? { ...l, quantity: Math.max(0, q) } : l)));
  const setCost = (id: string, c: number) => setLines((ls) => ls.map((l) => (l.productId === id ? { ...l, unitCostBaht: Math.max(0, c) } : l)));
  const remove = (id: string) => setLines((ls) => ls.filter((l) => l.productId !== id));

  const total = lines.reduce((a, l) => a + l.quantity * l.unitCostBaht, 0);

  const submit = async () => {
    if (busy) return;
    const valid = lines.filter((l) => l.quantity > 0);
    if (valid.length === 0) { setMsg("ยังไม่ได้ใส่รายการ"); return; }
    setBusy(true);
    setMsg(null);
    try {
      const res = await receivePurchase({
        branchId,
        supplierName: supplier,
        note,
        lines: valid.map((l) => ({ productId: l.productId, quantity: l.quantity, unitCostCents: Math.round(l.unitCostBaht * 100) })),
      });
      if (res.ok) { setLines([]); setSupplier(""); setNote(""); router.push(`/playland/stock/receipts/${res.data.purchaseId}`); }
      else setMsg("❌ " + res.error);
    } catch { setMsg("❌ บันทึกไม่สำเร็จ · ลองใหม่"); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ ...card, padding: 18 }}>
        <div style={{ fontSize: 14, color: "#8a7f70", marginBottom: 8 }}>ยิงบาร์โค้ด หรือเลือกสินค้าเพื่อเพิ่มรายการ</div>
        <div style={{ marginBottom: 12 }}><BarcodeScanBox onScan={onScan} placeholder="ยิงบาร์โค้ดของที่รับเข้า…" /></div>
        <select value={pick} onChange={(e) => { if (e.target.value) { addProduct(e.target.value); setPick(""); } }} style={{ ...input, width: "100%" }}>
          <option value="">+ เลือกสินค้า/อะไหล่ จากรายการ…</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.kind === "SPARE_PART" ? "🔧 " : "🍬 "}{p.name} (เหลือ {p.stock})</option>)}
        </select>
      </div>

      {lines.length > 0 && (
        <div style={{ ...card, overflow: "hidden" }}>
          {lines.map((l) => (
            <div key={l.productId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: "1px solid #f2ebdd", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 140, fontSize: 15, fontWeight: 500 }}>{l.name}</div>
              <label style={{ fontSize: 12, color: "#8a7f70" }}>จำนวน <input type="number" value={l.quantity} onChange={(e) => setQty(l.productId, parseInt(e.target.value) || 0)} style={{ ...input, width: 72, fontFamily: MONO }} /></label>
              <label style={{ fontSize: 12, color: "#8a7f70" }}>ต้นทุน/ชิ้น <input type="number" value={l.unitCostBaht} onChange={(e) => setCost(l.productId, parseFloat(e.target.value) || 0)} style={{ ...input, width: 90, fontFamily: MONO }} /></label>
              <div style={{ fontFamily: MONO, fontWeight: 600, width: 84, textAlign: "right" }}>฿{(l.quantity * l.unitCostBaht).toLocaleString()}</div>
              <button onClick={() => remove(l.productId)} style={{ background: "none", border: "none", color: "#E74C3C", cursor: "pointer", fontSize: 18 }}>×</button>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", padding: "14px 16px", background: "#f9f7f2" }}>
            <span style={{ fontWeight: 500 }}>รวมต้นทุนรับเข้า</span>
            <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 20, color: "#2D6CB1" }}>฿{total.toLocaleString()}</span>
          </div>
        </div>
      )}

      <div className="pl-grid-2e">
        <input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="ผู้ขาย/ร้านค้า (ไม่บังคับ)" style={input} />
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="หมายเหตุ (ไม่บังคับ)" style={input} />
      </div>

      {msg && <div style={{ borderRadius: 10, padding: "12px 16px", fontSize: 15, background: msg.startsWith("✓") ? "#eaf3eb" : msg.startsWith("+") ? "#eaf3f6" : "#fdecea", color: msg.startsWith("✓") ? "#1F8A5B" : msg.startsWith("+") ? "#2D6CB1" : "#c0392b" }}>{msg}</div>}

      <button type="button" onClick={submit} disabled={busy} style={{ background: "#1F8A5B", color: "#fff", border: "none", borderRadius: 14, padding: 16, fontFamily: MITR, fontWeight: 500, fontSize: 18, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>{busy ? "กำลังบันทึก…" : "บันทึกรับของเข้า"}</button>
    </div>
  );
}
