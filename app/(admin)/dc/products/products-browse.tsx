"use client";

// DC · ดูสินค้า / สต๊อก (floor browse) — client
//
// หน้าไล่ดูสินค้าทั้งหมด (READ-ONLY) สำหรับพนักงานหน้างานบนมือถือ — ไม่ต้องสแกนก่อน:
//   • ช่องค้นหาติดบนสุด (sticky) + debounce 220ms
//   • ชิปหมวดหมู่เลื่อนแนวนอน
//   • รายการสินค้าเป็นแถว: [รูป 44px] [ชื่อ + รหัส + หมวด] [คงเหลือ + หน่วย ชิดขวา]
//   • ของหมด (คงเหลือ 0) = แถวจาง + ป้าย "หมด"
// filter หมวด + ค้นหา ยิงไป listDcFloorProducts ใหม่ทุกครั้ง.

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, ImageIcon, PackageSearch } from "lucide-react";
import {
  listDcFloorProducts,
  type FloorProductRow,
} from "@/lib/dc/floor-products-actions";

export function FloorProductsBrowse({
  warehouseId,
  warehouseName,
  categories,
  initialProducts,
}: {
  warehouseId: string;
  warehouseName: string;
  categories: string[];
  initialProducts: FloorProductRow[];
}) {
  const [activeCat, setActiveCat] = useState<string>(""); // "" = ทุกหมวด
  const [q, setQ] = useState("");
  const [products, setProducts] = useState<FloorProductRow[]>(initialProducts);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // ข้าม fetch รอบแรก (ใช้ initialProducts จาก server ไปเลย) — โหลดใหม่เฉพาะเมื่อผู้ใช้เปลี่ยน filter/q
  const firstRun = useRef(true);

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const t = setTimeout(() => {
      void (async () => {
        const res = await listDcFloorProducts({
          warehouseId,
          category: activeCat || undefined,
          q: q.trim() || undefined,
        });
        if (cancelled) return;
        if (res.ok) setProducts(res.products);
        else setError(res.error);
        setLoading(false);
      })();
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [warehouseId, activeCat, q]);

  const count = products.length;
  const outOfStock = useMemo(() => products.filter((p) => p.systemQty <= 0).length, [products]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* ---- แถบค้นหา + หมวด (ติดบนสุด) ---- */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 20,
          background: "var(--dc-canvas, #f1f4f9)",
          paddingBottom: 4,
          margin: "-4px -2px 0",
          padding: "4px 2px 6px",
        }}
      >
        {/* search */}
        <div style={{ position: "relative" }}>
          <Search
            size={18}
            style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: "var(--dc-subtle, #9aa4b2)" }}
          />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ค้นหาชื่อ / รหัส / บาร์โค้ด…"
            style={{
              width: "100%",
              padding: "12px 12px 12px 38px",
              borderRadius: 12,
              border: "1.5px solid var(--dc-line-strong, var(--dc-line))",
              fontSize: 15.5,
              color: "var(--dc-ink)",
              background: "var(--dc-paper)",
              outline: "none",
            }}
          />
        </div>

        {/* category chips */}
        {categories.length > 0 && (
          <div
            style={{
              display: "flex",
              gap: 8,
              overflowX: "auto",
              padding: "10px 0 2px",
              WebkitOverflowScrolling: "touch",
            }}
          >
            <CatChip label="ทุกหมวด" active={activeCat === ""} onClick={() => setActiveCat("")} />
            {categories.map((c) => (
              <CatChip key={c} label={c} active={activeCat === c} onClick={() => setActiveCat(c)} />
            ))}
          </div>
        )}
      </div>

      {/* ---- นับจำนวน + หมายเหตุของหมด ---- */}
      {!loading && !error && count > 0 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "0 2px" }}>
          <span style={{ fontSize: 12.5, color: "var(--dc-muted)" }}>
            {count} รายการ{outOfStock > 0 ? ` · ของหมด ${outOfStock}` : ""}
          </span>
          <span style={{ fontSize: 12, color: "var(--dc-subtle, #9aa4b2)" }}>คลัง {warehouseName}</span>
        </div>
      )}

      {/* ---- รายการสินค้า ---- */}
      <div className="dc-card" style={{ padding: 0, overflow: "hidden" }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: 32, color: "var(--dc-muted)", fontSize: 14 }}>กำลังโหลด…</div>
        ) : error ? (
          <div style={{ textAlign: "center", padding: 32, color: "#c0392b", fontSize: 14 }}>{error}</div>
        ) : count === 0 ? (
          <div style={{ textAlign: "center", padding: 40, color: "var(--dc-muted)" }}>
            <PackageSearch size={30} style={{ opacity: 0.5, marginBottom: 8 }} />
            <div style={{ fontSize: 14.5 }}>
              ไม่พบสินค้า{q.trim() ? ` ที่ตรงกับ “${q.trim()}”` : activeCat ? ` ในหมวด “${activeCat}”` : ""}
            </div>
          </div>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {products.map((p) => (
              <ProductRow key={p.productId} p={p} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ProductRow({ p }: { p: FloorProductRow }) {
  const empty = p.systemQty <= 0;
  return (
    <li
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "11px 14px",
        borderBottom: "1px solid var(--dc-line)",
        opacity: empty ? 0.62 : 1,
      }}
    >
      <Thumb url={p.imageUrl} size={44} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontWeight: 650, fontSize: 15, color: "var(--dc-ink)", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {p.name}
        </div>
        <div style={{ fontSize: 12.5, color: "var(--dc-muted)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {p.sku}
          {p.category ? ` · ${p.category}` : ""}
        </div>
      </div>
      <div style={{ flexShrink: 0, textAlign: "right", whiteSpace: "nowrap" }}>
        {empty ? (
          <span
            style={{
              display: "inline-block",
              fontSize: 12.5,
              fontWeight: 700,
              color: "#b0563a",
              background: "#fdecec",
              borderRadius: 8,
              padding: "3px 9px",
            }}
          >
            หมด
          </span>
        ) : (
          <>
            <span style={{ fontSize: 18, fontWeight: 800, color: "var(--dc-ink)" }}>{p.systemQty}</span>
            {p.unit ? (
              <span style={{ fontSize: 12.5, color: "var(--dc-muted)", fontWeight: 500 }}> {p.unit}</span>
            ) : null}
          </>
        )}
      </div>
    </li>
  );
}

function CatChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flexShrink: 0,
        display: "inline-flex",
        alignItems: "center",
        padding: "7px 14px",
        borderRadius: 999,
        fontSize: 13.5,
        fontWeight: 650,
        cursor: "pointer",
        whiteSpace: "nowrap",
        border: active ? "1.5px solid var(--color-brand-600)" : "1.5px solid var(--dc-line)",
        background: active ? "var(--color-brand-600)" : "var(--dc-paper)",
        color: active ? "#fff" : "var(--dc-muted)",
      }}
    >
      {label}
    </button>
  );
}

// รูปสินค้าเล็ก (สี่เหลี่ยม · fallback ไอคอนถ้าไม่มีรูป)
function Thumb({ url, size = 44 }: { url?: string | null; size?: number }) {
  return (
    <span
      aria-hidden
      style={{
        flexShrink: 0,
        width: size,
        height: size,
        borderRadius: 9,
        overflow: "hidden",
        background: "var(--dc-canvas, #f1f4f9)",
        border: "1px solid var(--dc-line)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        <ImageIcon size={Math.round(size * 0.42)} color="var(--dc-subtle, #9aa4b2)" />
      )}
    </span>
  );
}
