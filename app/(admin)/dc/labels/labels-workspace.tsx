"use client";

// DC · หน้าปริ้นฉลาก (client) — สแกน/ค้นหาสินค้า → ใส่รายการพิมพ์ → ตั้งจำนวนดวง → พิมพ์ QR 58มม.
//   • สแกน/พิมพ์รหัส → resolveCode → productDetail (ดึงชื่อ/SKU/บาร์โค้ด) → เพิ่มเข้ารายการ
//   • ค้นหาข้อความ → searchProducts → แตะ → เพิ่มเข้ารายการ
//   • แต่ละรายการ: stepper "จำนวนดวง" (copies) · ลบ
//   • DcLabelButton พิมพ์ทั้งหมด (code = บาร์โค้ด ถ้าไม่มีใช้ SKU) · "ล้าง" เคลียร์
//
// reuse searchProducts + resolveCode + productDetail จาก @/lib/dc/search-actions

import { useCallback, useRef, useState } from "react";
import { Search, Trash2, QrCode, PackageSearch } from "lucide-react";
import { DcScanBox } from "@/components/dc/scan-box";
import { DcLabelButton, type DcLabelItem } from "@/components/dc/label-print";
import { PRODUCT_TYPE_LABEL } from "@/lib/dc/nav";
import {
  searchProducts,
  resolveCode,
  productDetail,
  type SearchProductRow,
} from "@/lib/dc/search-actions";

type PrintItem = {
  productId: string;
  sku: string;
  name: string;
  barcode: string | null;
  type: string;
  copies: number;
};

export function LabelsWorkspace() {
  const [items, setItems] = useState<PrintItem[]>([]);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchProductRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [didSearch, setDidSearch] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const busyRef = useRef(false);

  // เพิ่มสินค้าเข้ารายการพิมพ์ (มีอยู่แล้ว = +1 ดวง)
  const addItem = useCallback(
    (p: { productId: string; sku: string; name: string; barcode: string | null; type: string }) => {
      setItems((prev) => {
        const idx = prev.findIndex((x) => x.productId === p.productId);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...next[idx], copies: next[idx].copies + 1 };
          return next;
        }
        return [...prev, { ...p, copies: 1 }];
      });
    },
    [],
  );

  // สแกน/พิมพ์รหัส → resolveCode → productDetail (เอาชื่อ/บาร์โค้ด) → เพิ่ม
  const handleScan = useCallback(
    async (code: string) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setError(null);
      try {
        const r = await resolveCode({ code });
        if (!r.ok) {
          setError(r.error);
          return;
        }
        const d = await productDetail({ productId: r.productId });
        if (!d.ok) {
          setError(d.error);
          return;
        }
        addItem({
          productId: d.product.id,
          sku: d.product.sku,
          name: d.product.name,
          barcode: d.product.barcode,
          type: d.product.type,
        });
      } catch {
        setError("ค้นหาสินค้าไม่สำเร็จ ลองอีกครั้ง");
      } finally {
        busyRef.current = false;
      }
    },
    [addItem],
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

  const setCopies = useCallback((productId: string, copies: number) => {
    setItems((prev) =>
      prev.map((x) => (x.productId === productId ? { ...x, copies: Math.max(1, Math.trunc(copies || 1)) } : x)),
    );
  }, []);

  const removeItem = useCallback((productId: string) => {
    setItems((prev) => prev.filter((x) => x.productId !== productId));
  }, []);

  const clearAll = useCallback(() => setItems([]), []);

  const totalCopies = items.reduce((s, x) => s + x.copies, 0);

  // ฉลากสำหรับพิมพ์: code = บาร์โค้ด (ถ้ามี) ไม่งั้น SKU
  const labelItems: DcLabelItem[] = items.map((x) => ({
    code: x.barcode || x.sku,
    name: x.name,
    sku: x.sku,
    qty: x.copies,
  }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* กล่องสแกน */}
      <div className="dc-card" style={{ padding: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, color: "var(--dc-ink, #1f2733)" }}>
          ยิงบาร์โค้ด หรือ พิมพ์รหัสสินค้า — เพิ่มเข้ารายการพิมพ์
        </div>
        <DcScanBox onScan={handleScan} placeholder="ยิงบาร์โค้ด / พิมพ์ SKU แล้วกด Enter…" />
      </div>

      {/* ค้นหาข้อความ */}
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
                onClick={() =>
                  addItem({ productId: r.id, sku: r.sku, name: r.name, barcode: r.barcode, type: r.type })
                }
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
                <span style={{ fontSize: 14, fontWeight: 700, color: "var(--color-brand-700)", flexShrink: 0 }}>
                  + เพิ่ม
                </span>
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

      {/* รายการพิมพ์ (preview) */}
      {items.length === 0 ? (
        <div className="dc-card" style={{ textAlign: "center", padding: 28, color: "var(--dc-muted, #6b7785)" }}>
          <PackageSearch size={36} style={{ color: "var(--color-brand-600)", marginBottom: 8 }} />
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--dc-ink, #1f2733)" }}>ยังไม่มีฉลากในรายการ</div>
          <div style={{ fontSize: 14, marginTop: 6 }}>ยิงบาร์โค้ดหรือค้นหาสินค้าเพื่อเพิ่มฉลาก</div>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 4px" }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--dc-ink, #1f2733)" }}>
              รายการพิมพ์ ({items.length} ชนิด · {totalCopies} ดวง)
            </span>
            <button
              type="button"
              onClick={clearAll}
              style={{ background: "transparent", border: "none", color: "var(--dc-muted, #6b7785)", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
            >
              ล้าง
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {items.map((x) => (
              <div key={x.productId} className="dc-card" style={{ padding: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 17, fontWeight: 700, color: "var(--dc-ink, #1f2733)", lineHeight: 1.25 }}>
                      {x.name}
                    </div>
                    <div style={{ fontSize: 13, color: "var(--dc-muted, #6b7785)", marginTop: 2 }}>
                      {x.sku}
                      {x.barcode ? ` · ${x.barcode}` : " · (ไม่มีบาร์โค้ด · QR ใช้ SKU)"}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeItem(x.productId)}
                    aria-label="ลบรายการ"
                    style={{ background: "transparent", border: "none", color: "#c0392b", cursor: "pointer", padding: 6, flexShrink: 0 }}
                  >
                    <Trash2 size={20} />
                  </button>
                </div>

                {/* stepper จำนวนดวง */}
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    marginTop: 12,
                    fontSize: 14,
                    fontWeight: 600,
                    color: "var(--dc-muted, #6b7785)",
                  }}
                >
                  <span style={{ whiteSpace: "nowrap" }}>จำนวนดวง</span>
                  <div className="dc-qty" style={{ flex: 1 }}>
                    <button type="button" onClick={() => setCopies(x.productId, x.copies - 1)} aria-label="ลด">
                      −
                    </button>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      value={x.copies}
                      onChange={(e) => setCopies(x.productId, Number(e.target.value))}
                      aria-label="จำนวนดวงที่พิมพ์"
                    />
                    <button type="button" onClick={() => setCopies(x.productId, x.copies + 1)} aria-label="เพิ่ม">
                      ＋
                    </button>
                  </div>
                </label>
              </div>
            ))}
          </div>

          {/* ปุ่มพิมพ์ */}
          <div className="dc-card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 700, color: "var(--dc-ink, #1f2733)" }}>
              <QrCode size={18} style={{ color: "var(--color-brand-600)" }} />
              พิมพ์ฉลาก QR 58มม. — รวม {totalCopies} ดวง
            </div>
            <DcLabelButton items={labelItems} label={`พิมพ์ฉลาก QR (${totalCopies} ดวง)`} />
          </div>
        </>
      )}
    </div>
  );
}
