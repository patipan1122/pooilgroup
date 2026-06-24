"use client";

// DC · หน้าค้นหา (client) — "ของชิ้นนี้อยู่ไหน เหลือเท่าไหร่"
//   • กล่องสแกน/พิมพ์รหัส → resolveCode → productDetail (เปิดรายละเอียดทันที)
//   • ช่องค้นหาข้อความ → searchProducts → แตะรายการ → productDetail
//   • แผงรายละเอียด: ชื่อ/SKU/ประเภท + "ของอยู่ที่ไหน" (ทุกคลัง · ชั้นวาง · คงเหลือ)
//     + การเคลื่อนไหวล่าสุด
//   • busy-lock กันยิงซ้อน · empty-state แนะนำการใช้งาน

import { useCallback, useRef, useState } from "react";
import { Search, MapPin, PackageSearch, History, X } from "lucide-react";
import { DcScanBox } from "@/components/dc/scan-box";
import { PRODUCT_TYPE_LABEL } from "@/lib/dc/nav";
import {
  searchProducts,
  resolveCode,
  productDetail,
  type SearchProductRow,
  type ProductBalanceRow,
  type ProductMovementRow,
} from "@/lib/dc/search-actions";

type Detail = {
  product: { id: string; sku: string; name: string; barcode: string | null; type: string; unit: string };
  balances: ProductBalanceRow[];
  movements: ProductMovementRow[];
};

function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("th-TH", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function SearchWorkspace() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchProductRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [didSearch, setDidSearch] = useState(false);

  const [detail, setDetail] = useState<Detail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const busyRef = useRef(false);

  // เปิดรายละเอียดสินค้า (จากการแตะรายการ หรือสแกน)
  const openDetail = useCallback(async (productId: string) => {
    setError(null);
    setLoadingDetail(true);
    setDetail(null);
    try {
      const res = await productDetail({ productId });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDetail({ product: res.product, balances: res.balances, movements: res.movements });
    } catch {
      setError("โหลดรายละเอียดไม่สำเร็จ ลองอีกครั้ง");
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  // สแกน/พิมพ์รหัส → หาสินค้า → เปิดรายละเอียด
  const handleScan = useCallback(
    async (code: string) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setError(null);
      try {
        const res = await resolveCode({ code });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        await openDetail(res.productId);
      } catch {
        setError("ค้นหาสินค้าไม่สำเร็จ ลองอีกครั้ง");
      } finally {
        busyRef.current = false;
      }
    },
    [openDetail],
  );

  // ค้นหาข้อความ
  const runSearch = useCallback(async () => {
    const term = q.trim();
    setError(null);
    setDidSearch(true);
    if (!term) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const rows = await searchProducts({ q: term });
      setResults(rows);
    } catch {
      setError("ค้นหาไม่สำเร็จ ลองอีกครั้ง");
    } finally {
      setSearching(false);
    }
  }, [q]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* กล่องสแกน */}
      <div className="dc-card" style={{ padding: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, color: "var(--dc-ink, #1f2733)" }}>
          ยิงบาร์โค้ด หรือ พิมพ์รหัสสินค้า — ดูทันทีว่าอยู่ไหน
        </div>
        <DcScanBox onScan={handleScan} placeholder="ยิงบาร์โค้ด / พิมพ์ SKU แล้วกด Enter…" />
      </div>

      {/* ช่องค้นหาข้อความ */}
      <div className="dc-card" style={{ padding: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, color: "var(--dc-ink, #1f2733)" }}>
          หรือค้นหาจากชื่อสินค้า / รหัส
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ position: "relative", flex: 1 }}>
            <Search
              size={20}
              style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--color-brand-600)" }}
            />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void runSearch();
                }
              }}
              placeholder="พิมพ์ชื่อ / SKU / บาร์โค้ด…"
              inputMode="text"
              style={{
                width: "100%",
                background: "#fff",
                border: "1.5px solid var(--dc-line, #e6eaf0)",
                borderRadius: 12,
                padding: "14px 14px 14px 40px",
                fontSize: 17,
                color: "var(--dc-ink, #1f2733)",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>
          <button
            type="button"
            onClick={() => void runSearch()}
            disabled={searching}
            style={{
              background: "linear-gradient(180deg, var(--color-brand-500), var(--color-brand-700))",
              color: "#fff",
              border: "none",
              borderRadius: 12,
              padding: "0 22px",
              fontSize: 16,
              fontWeight: 700,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {searching ? "กำลังค้น…" : "ค้นหา"}
          </button>
        </div>

        {/* ผลค้นหา */}
        {didSearch && !searching && results.length === 0 && (
          <div style={{ marginTop: 14, color: "var(--dc-muted, #6b7785)", fontSize: 15 }}>
            ไม่พบสินค้า — ลองคำอื่น หรือยิงบาร์โค้ด
          </div>
        )}
        {results.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
            {results.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => void openDetail(r.id)}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 10,
                  textAlign: "left",
                  background: "#fff",
                  border: "1.5px solid var(--dc-line, #e6eaf0)",
                  borderRadius: 12,
                  padding: "12px 14px",
                  cursor: "pointer",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "var(--dc-ink, #1f2733)", lineHeight: 1.25 }}>
                    {r.name}
                  </div>
                  <div style={{ fontSize: 13, color: "var(--dc-muted, #6b7785)", marginTop: 2 }}>
                    {r.sku}
                    {r.barcode ? ` · ${r.barcode}` : ""} · {PRODUCT_TYPE_LABEL[r.type] ?? r.type}
                  </div>
                </div>
                <PackageSearch size={20} style={{ color: "var(--color-brand-600)", flexShrink: 0 }} />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* error */}
      {error && (
        <div
          role="alert"
          style={{
            background: "#fdecea",
            color: "#c0392b",
            border: "1px solid #f5c6c0",
            borderRadius: 12,
            padding: "12px 14px",
            fontSize: 15,
            fontWeight: 600,
          }}
        >
          {error}
        </div>
      )}

      {/* loading detail */}
      {loadingDetail && (
        <div className="dc-card" style={{ textAlign: "center", padding: 24, color: "var(--dc-muted, #6b7785)" }}>
          กำลังโหลดรายละเอียด…
        </div>
      )}

      {/* แผงรายละเอียด */}
      {detail && !loadingDetail && <DetailPanel detail={detail} onClose={() => setDetail(null)} />}

      {/* empty-state แนะนำ (ยังไม่ได้เลือกอะไร) */}
      {!detail && !loadingDetail && !error && (
        <div className="dc-card" style={{ textAlign: "center", padding: 28, color: "var(--dc-muted, #6b7785)" }}>
          <PackageSearch size={36} style={{ color: "var(--color-brand-600)", marginBottom: 8 }} />
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--dc-ink, #1f2733)" }}>
            ยังไม่ได้เลือกสินค้า
          </div>
          <div style={{ fontSize: 14, marginTop: 6, lineHeight: 1.5 }}>
            ยิงบาร์โค้ดของชิ้นนั้น หรือพิมพ์ชื่อ/รหัสค้นหา
            <br />
            แล้วระบบจะบอกว่าของอยู่คลังไหน ชั้นไหน เหลือเท่าไหร่
          </div>
        </div>
      )}
    </div>
  );
}

function DetailPanel({ detail, onClose }: { detail: Detail; onClose: () => void }) {
  const { product, balances, movements } = detail;
  const totalOnHand = balances.reduce((s, b) => s + b.qtyOnHand, 0);

  return (
    <div className="dc-card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 16 }}>
      {/* หัว: ชื่อ/SKU/ประเภท */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: "var(--dc-ink, #1f2733)", lineHeight: 1.25 }}>
            {product.name}
          </div>
          <div style={{ fontSize: 14, color: "var(--dc-muted, #6b7785)", marginTop: 4 }}>
            {product.sku}
            {product.barcode ? ` · ${product.barcode}` : ""} · {PRODUCT_TYPE_LABEL[product.type] ?? product.type}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="ปิด"
          style={{ background: "transparent", border: "none", color: "var(--dc-muted, #6b7785)", cursor: "pointer", padding: 4, flexShrink: 0 }}
        >
          <X size={22} />
        </button>
      </div>

      {/* ของอยู่ที่ไหน */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <MapPin size={20} style={{ color: "var(--color-brand-600)" }} />
          <span style={{ fontSize: 18, fontWeight: 800, color: "var(--dc-ink, #1f2733)" }}>ของอยู่ที่ไหน</span>
          <span style={{ fontSize: 14, color: "var(--dc-muted, #6b7785)", fontWeight: 600 }}>
            · รวม {totalOnHand} {product.unit}
          </span>
        </div>

        {balances.length === 0 ? (
          <div
            style={{
              background: "var(--dc-canvas, #f5f7fb)",
              borderRadius: 12,
              padding: "16px 14px",
              color: "var(--dc-muted, #6b7785)",
              fontSize: 15,
              fontWeight: 600,
              textAlign: "center",
            }}
          >
            ยังไม่มีสต๊อกในคลังที่คุณดูแล
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {balances.map((b, i) => (
              <div
                key={`${b.warehouseName}-${i}`}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  background: "var(--dc-canvas, #f5f7fb)",
                  border: "1.5px solid var(--dc-line, #e6eaf0)",
                  borderRadius: 14,
                  padding: "14px 16px",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 17, fontWeight: 700, color: "var(--dc-ink, #1f2733)" }}>
                    {b.warehouseName}
                  </div>
                  <div style={{ fontSize: 14, color: "var(--dc-muted, #6b7785)", marginTop: 2 }}>
                    ชั้น/ตำแหน่ง: <strong style={{ color: "var(--dc-ink, #1f2733)" }}>{b.location || "ยังไม่ระบุ"}</strong>
                    {b.qtyInTransit > 0 ? ` · ระหว่างทาง ${b.qtyInTransit}` : ""}
                  </div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontSize: 28, fontWeight: 800, color: "var(--color-brand-700)", lineHeight: 1 }}>
                    {b.qtyOnHand}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--dc-muted, #6b7785)", marginTop: 2 }}>{product.unit}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* การเคลื่อนไหวล่าสุด */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <History size={18} style={{ color: "var(--dc-muted, #6b7785)" }} />
          <span style={{ fontSize: 15, fontWeight: 700, color: "var(--dc-ink, #1f2733)" }}>การเคลื่อนไหวล่าสุด</span>
        </div>
        {movements.length === 0 ? (
          <div style={{ fontSize: 14, color: "var(--dc-muted, #6b7785)" }}>ยังไม่มีการเคลื่อนไหว</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {movements.map((m, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 4px",
                  borderBottom: i < movements.length - 1 ? "1px solid var(--dc-line, #e6eaf0)" : "none",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: "var(--dc-ink, #1f2733)" }}>{m.kind}</span>
                  {m.note ? (
                    <span style={{ fontSize: 13, color: "var(--dc-muted, #6b7785)", marginLeft: 6 }}>· {m.note}</span>
                  ) : null}
                  <div style={{ fontSize: 12, color: "var(--dc-muted, #6b7785)", marginTop: 2 }}>
                    {fmtDateTime(m.occurredAt)}
                  </div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <span
                    style={{
                      fontSize: 16,
                      fontWeight: 800,
                      color: m.qty > 0 ? "#1f8a4c" : m.qty < 0 ? "#c0392b" : "var(--dc-muted, #6b7785)",
                    }}
                  >
                    {m.qty > 0 ? `+${m.qty}` : m.qty}
                  </span>
                  {m.balanceAfter != null && (
                    <div style={{ fontSize: 12, color: "var(--dc-muted, #6b7785)", marginTop: 2 }}>
                      เหลือ {m.balanceAfter}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
