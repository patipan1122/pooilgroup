"use client";

// POS · 2-pane: product grid + cart
// Barcode input always focused · scan or type then Enter = add to cart
// "ขายไว ๆ" — minimize clicks

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSale } from "@/lib/playland/actions";
import { thb } from "@/lib/playland/format";
import { ShoppingCart, Trash2, Barcode, CheckCircle2, AlertCircle, Search } from "lucide-react";

interface Product {
  id: string;
  name: string;
  priceCents: number;
  stock: number;
  barcode: string | null;
  category: string | null;
}

interface CartItem {
  productId: string;
  name: string;
  priceCents: number;
  quantity: number;
}

const PAY = [
  { v: "CASH", label: "เงินสด" },
  { v: "PROMPTPAY", label: "PromptPay" },
  { v: "STRIPE", label: "บัตร" },
  { v: "CHARGE_TO_MEMBER", label: "ใส่บิล member" },
] as const;

export function PosClient({ branchId, products }: { branchId: string; products: Product[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [search, setSearch] = useState("");
  const [pay, setPay] = useState<(typeof PAY)[number]["v"]>("CASH");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const barcodeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    barcodeRef.current?.focus();
  }, [cart.length]);

  function addProduct(p: Product) {
    if (p.stock < 1) {
      setMsg({ kind: "err", text: `"${p.name}" หมดสต๊อก` });
      return;
    }
    setCart((c) => {
      const existing = c.find((x) => x.productId === p.id);
      if (existing) {
        if (existing.quantity + 1 > p.stock) {
          setMsg({ kind: "err", text: `"${p.name}" เหลือ ${p.stock}` });
          return c;
        }
        return c.map((x) => (x.productId === p.id ? { ...x, quantity: x.quantity + 1 } : x));
      }
      return [...c, { productId: p.id, name: p.name, priceCents: p.priceCents, quantity: 1 }];
    });
    setMsg(null);
  }

  function handleBarcodeSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!search.trim()) return;
    const q = search.trim();
    // Try exact barcode match first, fall back to name search
    const exact = products.find((p) => p.barcode === q);
    if (exact) {
      addProduct(exact);
      setSearch("");
      return;
    }
    const nameMatch = products.find((p) => p.name.toLowerCase().includes(q.toLowerCase()));
    if (nameMatch) {
      addProduct(nameMatch);
      setSearch("");
      return;
    }
    setMsg({ kind: "err", text: `ไม่พบสินค้า "${q}"` });
  }

  function setQty(productId: string, qty: number) {
    setCart((c) => {
      if (qty <= 0) return c.filter((x) => x.productId !== productId);
      return c.map((x) => (x.productId === productId ? { ...x, quantity: qty } : x));
    });
  }

  function clearCart() { setCart([]); setMsg(null); }

  function checkout() {
    if (cart.length === 0) return;
    start(async () => {
      const res = await createSale({
        branchId,
        items: cart.map((c) => ({ productId: c.productId, quantity: c.quantity })),
        paymentMethod: pay,
      });
      if (!res.ok) { setMsg({ kind: "err", text: res.error }); return; }
      setMsg({ kind: "ok", text: `ขายสำเร็จ · ${thb(res.data.totalCents)} · saleId ${res.data.saleId.slice(0, 8)}` });
      setCart([]);
      router.refresh();
    });
  }

  const total = cart.reduce((a, c) => a + c.priceCents * c.quantity, 0);
  const categories = Array.from(new Set(products.map((p) => p.category).filter(Boolean))) as string[];
  const filtered = search.trim() ? products.filter((p) => p.name.toLowerCase().includes(search.trim().toLowerCase()) || p.barcode === search.trim()) : products;

  return (
    <div className="pl-page">
      <header className="pl-header">
        <div>
          <div className="pl-eyebrow">Playland · POS ขายของ</div>
          <h1>ตะกร้า · {cart.length} รายการ · {thb(total)}</h1>
        </div>
        <form onSubmit={handleBarcodeSubmit} style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Barcode size={16} color="var(--pl-text-muted)" />
          <input
            ref={barcodeRef}
            className="pl-input"
            placeholder="สแกน barcode หรือพิมพ์ชื่อสินค้า + Enter"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 360 }}
            autoFocus
          />
        </form>
      </header>

      {msg && (
        <div style={{ padding: "8px 16px", background: msg.kind === "ok" ? "#dcfce7" : "#fee2e2", color: msg.kind === "ok" ? "#166534" : "#991b1b", fontSize: 13, display: "flex", gap: 6, alignItems: "center" }}>
          {msg.kind === "ok" ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}{msg.text}
        </div>
      )}

      <div className="pl-two-pane">
        <div className="pl-pane" style={{ padding: 12 }}>
          {categories.length > 0 && (
            <div style={{ display: "flex", gap: 4, marginBottom: 10, flexWrap: "wrap" }}>
              {categories.map((c) => (
                <span key={c} className="pl-chip pl-chip-muted">{c}</span>
              ))}
            </div>
          )}
          {filtered.length === 0 ? (
            <div className="pl-empty"><Search size={28} opacity={0.4} />ไม่มีสินค้า</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10 }}>
              {filtered.map((p) => (
                <button
                  key={p.id}
                  className="pl-card"
                  onClick={() => addProduct(p)}
                  disabled={p.stock < 1}
                  style={{ textAlign: "left", cursor: p.stock < 1 ? "not-allowed" : "pointer", opacity: p.stock < 1 ? 0.5 : 1, border: "1px solid var(--pl-line)" }}
                >
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{p.name}</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "var(--pl-brand-dark)" }}>{thb(p.priceCents)}</div>
                  <div style={{ fontSize: 11, color: "var(--pl-text-muted)", marginTop: 4 }}>เหลือ {p.stock}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        <aside className="pl-pane" style={{ display: "grid", gridTemplateRows: "auto 1fr auto" }}>
          <div style={{ padding: "0.875rem 1rem", borderBottom: "1px solid var(--pl-line)", display: "flex", justifyContent: "space-between" }}>
            <div className="pl-eyebrow">ตะกร้า</div>
            {cart.length > 0 && <button className="pl-btn pl-btn-sm" onClick={clearCart}><Trash2 size={12} /> เคลียร์</button>}
          </div>
          <div style={{ overflowY: "auto" }}>
            {cart.length === 0 ? (
              <div className="pl-empty"><ShoppingCart size={32} opacity={0.4} />ยังไม่มีรายการ</div>
            ) : (
              cart.map((c) => (
                <div key={c.productId} style={{ padding: 10, borderBottom: "1px solid var(--pl-line)", display: "grid", gap: 4 }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontWeight: 600 }}>{c.name}</span>
                    <span style={{ fontWeight: 700 }}>{thb(c.priceCents * c.quantity)}</span>
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: "var(--pl-text-muted)" }}>
                    <button className="pl-btn pl-btn-sm" onClick={() => setQty(c.productId, c.quantity - 1)}>−</button>
                    <span style={{ minWidth: 24, textAlign: "center" }}>{c.quantity}</span>
                    <button className="pl-btn pl-btn-sm" onClick={() => setQty(c.productId, c.quantity + 1)}>+</button>
                    <span style={{ marginLeft: "auto" }}>× {thb(c.priceCents)}</span>
                  </div>
                </div>
              ))
            )}
          </div>
          <div style={{ padding: 12, borderTop: "1px solid var(--pl-line)", background: "var(--pl-paper)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
              <span style={{ fontSize: 14 }}>รวม</span>
              <span style={{ fontSize: 22, fontWeight: 700 }}>{thb(total)}</span>
            </div>
            <div style={{ display: "flex", gap: 4, marginBottom: 10, flexWrap: "wrap" }}>
              {PAY.map((m) => (
                <button key={m.v} onClick={() => setPay(m.v)} className="pl-btn pl-btn-sm" style={pay === m.v ? { background: "var(--pl-info)", color: "white", borderColor: "var(--pl-info)" } : {}}>{m.label}</button>
              ))}
            </div>
            <button className="pl-btn pl-btn-primary" style={{ width: "100%", padding: "10px 16px", fontSize: 15 }} onClick={checkout} disabled={pending || cart.length === 0}>
              {pending ? "กำลังบันทึก..." : `รับเงิน ${thb(total)}`}
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
