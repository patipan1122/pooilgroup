"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { upsertProduct } from "@/lib/playland/actions";
import { thb } from "@/lib/playland/format";
import { ShoppingBasket, PlusCircle, ArrowLeft } from "lucide-react";

interface Branch { id: string; name: string; }
interface Product {
  id: string; branchId: string; name: string; barcode: string | null; sku: string | null;
  category: string | null; priceCents: number; costCents: number | null; stock: number; reorderLevel: number; active: boolean;
}

export function ProductsClient({ branches, products }: { branches: Branch[]; products: Product[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<Product | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [barcode, setBarcode] = useState("");
  const [category, setCategory] = useState("");
  const [price, setPrice] = useState("0");
  const [stock, setStock] = useState("0");
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [active, setActive] = useState(true);

  function startEdit(p: Product) {
    setEditing(p);
    setName(p.name); setBarcode(p.barcode ?? ""); setCategory(p.category ?? "");
    setPrice(((p.priceCents) / 100).toString()); setStock(String(p.stock));
    setBranchId(p.branchId); setActive(p.active); setShowForm(true);
  }
  function startNew() {
    setEditing(null);
    setName(""); setBarcode(""); setCategory(""); setPrice("0"); setStock("0");
    setBranchId(branches[0]?.id ?? ""); setActive(true); setShowForm(true);
  }
  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const priceCents = Math.round(parseFloat(price || "0") * 100);
      const res = await upsertProduct({
        id: editing?.id, branchId, name, barcode: barcode || undefined, category: category || undefined,
        priceCents, stock: parseInt(stock || "0"), active,
      });
      if (res.ok) { setShowForm(false); router.refresh(); }
    });
  }

  const lowStock = products.filter((p) => p.stock <= p.reorderLevel);

  return (
    <div className="pl-page">
      <header className="pl-header">
        <div>
          <Link href="/playland/settings" className="pl-eyebrow" style={{ display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none" }}><ArrowLeft size={12} /> Settings</Link>
          <h1>สินค้า POS · {products.length} {lowStock.length > 0 && <span className="pl-chip pl-chip-danger" style={{ marginLeft: 6, fontSize: 11 }}>เหลือน้อย {lowStock.length}</span>}</h1>
        </div>
        <button className="pl-btn pl-btn-primary" onClick={startNew}><PlusCircle size={14} /> เพิ่มสินค้า</button>
      </header>

      <div style={{ padding: 16, display: "grid", gridTemplateColumns: showForm ? "1fr 380px" : "1fr", gap: 16 }}>
        <div className="pl-card" style={{ padding: 0, overflow: "hidden" }}>
          <table className="pl-table">
            <thead><tr><th>ชื่อ</th><th>Barcode</th><th>หมวด</th><th>ราคา</th><th>คงเหลือ</th><th>สาขา</th><th>Active</th></tr></thead>
            <tbody>
              {products.length === 0 && <tr><td colSpan={7}><div className="pl-empty"><ShoppingBasket size={28} opacity={0.4} />ยังไม่มีสินค้า</div></td></tr>}
              {products.map((p) => {
                const low = p.stock <= p.reorderLevel;
                return (
                  <tr key={p.id} onClick={() => startEdit(p)}>
                    <td style={{ fontWeight: 600 }}>{p.name}</td>
                    <td><code style={{ fontSize: 12 }}>{p.barcode ?? "—"}</code></td>
                    <td>{p.category ?? "—"}</td>
                    <td style={{ fontWeight: 600 }}>{thb(p.priceCents)}</td>
                    <td style={{ color: low ? "var(--pl-danger)" : "inherit", fontWeight: low ? 600 : 400 }}>{p.stock}</td>
                    <td>{branches.find((b) => b.id === p.branchId)?.name ?? "—"}</td>
                    <td>{p.active ? <span className="pl-chip pl-chip-ok">ใช้</span> : <span className="pl-chip pl-chip-muted">ปิด</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {showForm && (
          <form className="pl-card" onSubmit={submit} style={{ display: "grid", gap: 10 }}>
            <div className="pl-eyebrow">{editing ? "แก้สินค้า" : "สินค้าใหม่"}</div>
            <div>
              <label style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>ชื่อ *</label>
              <input className="pl-input" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <label style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>Barcode</label>
                <input className="pl-input" value={barcode} onChange={(e) => setBarcode(e.target.value)} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>หมวด</label>
                <input className="pl-input" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="ขนม / เครื่องดื่ม" />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <label style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>ราคา (บาท)</label>
                <input className="pl-input" type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} required />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>สต๊อก</label>
                <input className="pl-input" type="number" value={stock} onChange={(e) => setStock(e.target.value)} required />
              </div>
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>สาขา</label>
              <select className="pl-select" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <label style={{ fontSize: 13 }}><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} style={{ marginRight: 6 }} /> Active</label>
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" className="pl-btn" onClick={() => setShowForm(false)}>ยกเลิก</button>
              <button type="submit" className="pl-btn pl-btn-primary" disabled={pending}>{pending ? "บันทึก..." : "บันทึก"}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
