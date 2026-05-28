"use client";

// Stock count cycle form · cashier enters physical count → auto diff → submit /bigfeature W7

import { useState, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import { submitStockCount } from "@/lib/playland/stock-count";
import { CheckCircle2, AlertCircle, ClipboardList, Save } from "lucide-react";

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
      setMsg({ kind: "ok", text: `ปรับ ${res.data.adjusted} รายการ · ข้าม ${res.data.skipped} (ตรงอยู่แล้ว)` });
      setCounts({});
      setReasons({});
      setNotes("");
      router.refresh();
    });
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {msg && (
        <div className="pl-card" style={{
          background: msg.kind === "ok" ? "var(--pl-ok-soft)" : "var(--pl-danger-soft)",
          color: msg.kind === "ok" ? "var(--pl-ok-ink)" : "var(--pl-danger-ink)",
          display: "flex", gap: 8, alignItems: "center",
        }}>
          {msg.kind === "ok" ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />} {msg.text}
        </div>
      )}

      {/* Search */}
      <div className="pl-card">
        <label className="pl-label">ค้นหาสินค้า · ชื่อ · SKU · หมวด</label>
        <input
          className="pl-input"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="พิมพ์เพื่อกรอง..."
        />
      </div>

      {/* Summary strip */}
      <div className="pl-card" style={{
        display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap",
        background: dirty.length > 0 ? "var(--pl-brand-soft)" : "var(--pl-ink-50)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <ClipboardList size={16} />
          <span style={{ fontWeight: 600 }}>{dirty.length} รายการ</span> ที่ต่างจากระบบ
        </div>
        {dirty.length > 0 && (
          <span style={{ fontFamily: "var(--pl-font-mono)", color: totalDiff >= 0 ? "var(--pl-ok-ink)" : "var(--pl-danger-ink)", fontWeight: 600 }}>
            {totalDiff >= 0 ? "+" : ""}{totalDiff} ชิ้น (รวม)
          </span>
        )}
        <button type="button" className="pl-btn pl-btn-primary" onClick={submit} disabled={pending || dirty.length === 0} style={{ marginLeft: "auto" }}>
          <Save size={14} /> {pending ? "กำลังบันทึก..." : "บันทึก stock count"}
        </button>
      </div>

      {/* Notes */}
      <div className="pl-card">
        <label className="pl-label">หมายเหตุ (เหตุผลรวมของ session นี้ · optional)</label>
        <input
          className="pl-input"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="เช่น นับประจำเดือน · มีของแตก · ของเสียจากความชื้น"
        />
      </div>

      {/* Table */}
      <div className="pl-card" style={{ padding: 0, overflow: "hidden" }}>
        <table className="pl-table">
          <thead>
            <tr>
              <th>สินค้า</th>
              <th style={{ textAlign: "right" }}>ระบบ</th>
              <th style={{ textAlign: "right" }}>นับจริง</th>
              <th style={{ textAlign: "right" }}>ต่าง</th>
              <th>เหตุผล (ถ้าต่าง)</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={5}><div className="pl-empty">ไม่มีสินค้า</div></td></tr>
            ) : filtered.map((p) => {
              const raw = counts[p.id] ?? "";
              const counted = raw === "" ? null : parseInt(raw, 10);
              const diff = counted !== null && Number.isFinite(counted) ? counted - p.stock : null;
              const diffTone =
                diff === null || diff === 0 ? "var(--pl-text-muted)" :
                diff < 0 ? "var(--pl-danger-ink)" : "var(--pl-ok-ink)";
              return (
                <tr key={p.id}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{p.name}</div>
                    <div style={{ fontSize: 11, color: "var(--pl-text-muted)", fontFamily: "var(--pl-font-mono)" }}>
                      {p.sku ?? "—"} · {p.category ?? "—"}
                    </div>
                  </td>
                  <td className="pl-num" style={{ textAlign: "right" }}>{p.stock}</td>
                  <td style={{ textAlign: "right" }}>
                    <input
                      className="pl-input"
                      type="number"
                      min={0}
                      inputMode="numeric"
                      value={raw}
                      onChange={(e) => setCount(p.id, e.target.value)}
                      style={{ width: 80, textAlign: "right", fontFamily: "var(--pl-font-mono)" }}
                      placeholder="—"
                    />
                  </td>
                  <td className="pl-num" style={{ textAlign: "right", color: diffTone, fontWeight: diff && diff !== 0 ? 700 : 400 }}>
                    {diff === null ? "—" : diff >= 0 ? `+${diff}` : diff}
                  </td>
                  <td>
                    {diff !== null && diff !== 0 ? (
                      <input
                        className="pl-input"
                        value={reasons[p.id] ?? ""}
                        onChange={(e) => setReason(p.id, e.target.value)}
                        placeholder="เช่น แตก · หาย · นับผิดเดิม"
                        style={{ fontSize: 12 }}
                      />
                    ) : (
                      <span style={{ color: "var(--pl-text-muted)", fontSize: 12 }}>—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
