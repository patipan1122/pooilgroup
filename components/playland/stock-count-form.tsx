"use client";

// Stock count cycle form · cashier enters physical count → auto diff → submit /bigfeature W7
// สไตล์ Play a lot หลังบ้าน (พื้นขาว · inline tokens) — CEO 2026-06-24

import { useState, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import { submitStockCount } from "@/lib/playland/stock-count";
import { CheckCircle2, AlertCircle, ClipboardList, Save } from "lucide-react";

const INK = "#3A3026", MUTED = "#8a7f70", BLUE = "#2D6CB1", GREEN = "#1F8A5B", RED = "#E74C3C", LINE = "#ece5d8";
const MONO = "'IBM Plex Mono', var(--font-plex-mono), ui-monospace, monospace";
const MITR = "var(--font-mitr), 'Mitr', sans-serif";
const card: React.CSSProperties = { background: "#fff", border: `1px solid ${LINE}`, borderRadius: 16, boxShadow: "0 1px 3px rgba(58,48,38,.05)" };
const input: React.CSSProperties = { background: "#fff", border: `1px solid ${LINE}`, borderRadius: 10, padding: "10px 12px", fontSize: 15, fontFamily: MITR, color: INK, outline: "none", boxSizing: "border-box", width: "100%" };
const label: React.CSSProperties = { display: "block", fontSize: 12.5, color: MUTED, marginBottom: 6 };

interface Product {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  stock: number;
}

export function StockCountForm({ branchId, products }: { branchId: string; products: Product[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [filter, setFilter] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const filtered = useMemo(() => {
    if (!filter.trim()) return products;
    const q = filter.toLowerCase();
    return products.filter((p) =>
      p.name.toLowerCase().includes(q) ||
      (p.sku ?? "").toLowerCase().includes(q) ||
      (p.category ?? "").toLowerCase().includes(q),
    );
  }, [products, filter]);

  function setCount(id: string, val: string) {
    setCounts((prev) => ({ ...prev, [id]: val }));
  }

  function setReason(id: string, val: string) {
    setReasons((prev) => ({ ...prev, [id]: val }));
  }

  const dirty = useMemo(() => {
    const out: Array<{ id: string; before: number; after: number; diff: number; reason: string }> = [];
    for (const p of products) {
      const v = counts[p.id];
      if (v === undefined || v === "") continue;
      const n = parseInt(v, 10);
      if (!Number.isFinite(n) || n < 0) continue;
      if (n === p.stock) continue;
      out.push({ id: p.id, before: p.stock, after: n, diff: n - p.stock, reason: reasons[p.id] ?? "" });
    }
    return out;
  }, [counts, reasons, products]);

  const totalDiff = dirty.reduce((s, d) => s + d.diff, 0);

  function submit() {
    if (dirty.length === 0) { setMsg({ kind: "err", text: "ยังไม่มีรายการที่นับต่างจากระบบ" }); return; }
    if (!confirm(`ยืนยันปรับสต๊อก ${dirty.length} รายการ? (รวม ${totalDiff >= 0 ? "+" : ""}${totalDiff})`)) return;
    start(async () => {
      const res = await submitStockCount({
        branchId,
        notes: notes.trim() || undefined,
        lines: dirty.map((d) => ({ productId: d.id, countedQty: d.after, reason: d.reason || undefined })),
      });
      if (!res.ok) { setMsg({ kind: "err", text: res.error }); return; }
      setCounts({});
      setReasons({});
      setNotes("");
      if (res.data.countId) {
        // เปิดใบนับที่เพิ่งบันทึก (ดูส่วนต่าง · ใครนับ · หมายเหตุ)
        router.push(`/playland/stock/counts/${res.data.countId}`);
        return;
      }
      setMsg({ kind: "ok", text: `นับครบ · ตรงกับระบบทุกรายการ (ข้าม ${res.data.skipped})` });
      router.refresh();
    });
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {msg && (
        <div style={{
          ...card, padding: "12px 16px",
          background: msg.kind === "ok" ? "#eaf3eb" : "#fdeceb",
          color: msg.kind === "ok" ? GREEN : RED,
          display: "flex", gap: 8, alignItems: "center",
        }}>
          {msg.kind === "ok" ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />} {msg.text}
        </div>
      )}

      {/* Search */}
      <div style={{ ...card, padding: 16 }}>
        <label style={label} htmlFor="stock-count-search">ค้นหาสินค้า · ชื่อ · SKU · หมวด</label>
        <input
          id="stock-count-search"
          style={input}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="พิมพ์เพื่อกรอง..."
        />
      </div>

      {/* Summary strip */}
      <div style={{
        ...card, padding: "14px 16px",
        display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap",
        background: dirty.length > 0 ? "#eaf3f6" : "#fff",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <ClipboardList size={16} color={BLUE} />
          <span style={{ fontWeight: 600 }}>{dirty.length} รายการ</span> ที่ต่างจากระบบ
        </div>
        {dirty.length > 0 && (
          <span style={{ fontFamily: MONO, color: totalDiff >= 0 ? GREEN : RED, fontWeight: 600 }}>
            {totalDiff >= 0 ? "+" : ""}{totalDiff} ชิ้น (รวม)
          </span>
        )}
        <button type="button" onClick={submit} disabled={pending || dirty.length === 0} style={{
          marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 7, background: BLUE, color: "#fff",
          border: "none", borderRadius: 9, padding: "9px 18px", fontFamily: MITR, fontSize: 14, fontWeight: 600,
          cursor: pending || dirty.length === 0 ? "default" : "pointer", opacity: pending || dirty.length === 0 ? 0.55 : 1,
        }}>
          <Save size={14} /> {pending ? "กำลังบันทึก..." : "บันทึก stock count"}
        </button>
      </div>

      {/* Notes */}
      <div style={{ ...card, padding: 16 }}>
        <label style={label} htmlFor="stock-count-notes">หมายเหตุ (เหตุผลรวมของ session นี้ · optional)</label>
        <input
          id="stock-count-notes"
          style={input}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="เช่น นับประจำเดือน · มีของแตก · ของเสียจากความชื้น"
        />
      </div>

      {/* Table */}
      <div style={{ ...card, overflow: "hidden" }}>
        <div style={{ ...rowGrid, padding: "12px 18px", background: "#f9f7f2", fontSize: 12.5, color: MUTED, fontWeight: 500 }}>
          <div>สินค้า</div>
          <div style={{ textAlign: "right" }}>ระบบ</div>
          <div style={{ textAlign: "right" }}>นับจริง</div>
          <div style={{ textAlign: "right" }}>ต่าง</div>
          <div>เหตุผล (ถ้าต่าง)</div>
        </div>
        {filtered.length === 0 ? (
          <div style={{ padding: "22px 18px", color: MUTED, fontSize: 15 }}>ไม่มีสินค้า</div>
        ) : filtered.map((p) => {
          const raw = counts[p.id] ?? "";
          const counted = raw === "" ? null : parseInt(raw, 10);
          const diff = counted !== null && Number.isFinite(counted) ? counted - p.stock : null;
          const diffTone =
            diff === null || diff === 0 ? MUTED :
            diff < 0 ? RED : GREEN;
          return (
            <div key={p.id} style={{ ...rowGrid, padding: "11px 18px", borderTop: `1px solid #f2ebdd`, alignItems: "center" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 500 }}>{p.name}</div>
                <div style={{ fontSize: 11.5, color: "#a89c8b", fontFamily: MONO }}>
                  {p.sku ?? "—"} · {p.category ?? "—"}
                </div>
              </div>
              <div style={{ textAlign: "right", fontFamily: MONO, fontSize: 14, color: MUTED }}>{p.stock}</div>
              <div style={{ textAlign: "right" }}>
                <input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={raw}
                  onChange={(e) => setCount(p.id, e.target.value)}
                  style={{ ...input, width: 84, textAlign: "right", fontFamily: MONO, padding: "8px 10px" }}
                  placeholder="—"
                  aria-label={`นับจริง ${p.name}`}
                />
              </div>
              <div style={{ textAlign: "right", fontFamily: MONO, fontSize: 14, color: diffTone, fontWeight: diff && diff !== 0 ? 700 : 400 }}>
                {diff === null ? "—" : diff >= 0 ? `+${diff}` : diff}
              </div>
              <div>
                {diff !== null && diff !== 0 ? (
                  <input
                    value={reasons[p.id] ?? ""}
                    onChange={(e) => setReason(p.id, e.target.value)}
                    placeholder="เช่น แตก · หาย · นับผิดเดิม"
                    style={{ ...input, fontSize: 13, padding: "8px 10px" }}
                    aria-label={`เหตุผล ${p.name}`}
                  />
                ) : (
                  <span style={{ color: "#a89c8b", fontSize: 12 }}>—</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const rowGrid: React.CSSProperties = { display: "grid", gridTemplateColumns: "1.6fr 70px 120px 70px 1.4fr", gap: 12 };
