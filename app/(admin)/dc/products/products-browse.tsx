"use client";

// DC · ดูสินค้า / สต๊อก (floor browse) — client
//
// หน้าไล่ดูสินค้าทั้งหมด (READ-ONLY) สำหรับพนักงานหน้างานบนมือถือ — ไม่ต้องสแกนก่อน:
//   • ช่องค้นหาติดบนสุด (sticky) + debounce 220ms
//   • ชิปหมวดหมู่เลื่อนแนวนอน
//   • รายการสินค้าเป็นแถว: [รูป 44px] [ชื่อ + รหัส + หมวด] [คงเหลือ + หน่วย ชิดขวา]
//   • ของหมด (คงเหลือ 0) = แถวจาง + ป้าย "หมด"
// filter หมวด + ค้นหา ยิงไป listDcFloorProducts ใหม่ทุกครั้ง.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, PackageSearch, ChevronRight, FileText, ChevronLeft, Package, Truck, PackageMinus, Move } from "lucide-react";
import {
  listDcFloorProducts,
  type FloorProductRow,
} from "@/lib/dc/floor-products-actions";
import { listPosForMoveAction, getPoFulfillmentAction } from "@/lib/dc/po-move-actions";
import type { ReceivablePoForMove, PoFulfillment, PoFulfillmentLine } from "@/lib/dc/po-fulfillment";
import { DcThumb } from "@/components/dc/product-image";

// ★ handoff ที่โยนไปหน้า "เบิก · โอน · ย้ายที่" (convenience default เท่านั้น —
//   หน้าปลายทาง re-resolve onHand/remaining จริงฝั่ง server เสมอ) → carry แค่ id + display qty + label.
import { writeDcHandoff, PO_HANDOFF_KEY } from "@/lib/dc/handoff";

export function FloorProductsBrowse({
  warehouseId,
  warehouseName,
  categories,
  initialProducts,
  r2PublicUrl,
}: {
  warehouseId: string;
  warehouseName: string;
  categories: string[];
  initialProducts: FloorProductRow[];
  r2PublicUrl?: string;
}) {
  const [mode, setMode] = useState<"all" | "po">("all");
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
      {/* ---- toggle: ทั้งหมด | ดูเป็นใบ PO ---- */}
      <div role="tablist" aria-label="มุมมองสินค้า" style={{ display: "flex", gap: 8 }}>
        <ModeTab label="ทั้งหมด" active={mode === "all"} onClick={() => setMode("all")} />
        <ModeTab label="ดูเป็นใบ PO" active={mode === "po"} onClick={() => setMode("po")} />
      </div>

      {mode === "po" ? (
        <PoBrowseView warehouseId={warehouseId} warehouseName={warehouseName} r2PublicUrl={r2PublicUrl} />
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}

// ── tab เล็ก ๆ ด้านบน (ทั้งหมด / ดูเป็นใบ PO) ──────────────────────────────
function ModeTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        flex: 1,
        padding: "10px 14px",
        borderRadius: 12,
        fontSize: 14.5,
        fontWeight: 700,
        cursor: "pointer",
        border: active ? "2px solid var(--color-brand-600, #2563eb)" : "1.5px solid var(--dc-line, #e6eaf0)",
        background: active ? "var(--color-brand-50, #eef3fe)" : "var(--dc-paper, #fff)",
        color: active ? "var(--color-brand-700, #1d4ed8)" : "var(--dc-muted, #6b7785)",
      }}
    >
      {label}
    </button>
  );
}

// ════════════════════════════════════════════════════════════════════════
// PoBrowseView — "ดูเป็นใบ PO": ลิสต์ใบ → เปิดใบ → 5 chips + checkbox ต่อแถว →
//   batch [โอน] / [ตัดจ่าย] (โยน handoff → หน้าโอน/เบิก) · per-row [ย้าย] deep-link (ย้ายทีละตัว)
//   ★ reuse listPosForMoveAction + getPoFulfillmentAction (floor-gated) · ไม่มี write/stock ที่นี่
// ════════════════════════════════════════════════════════════════════════
function imageSrc(path: string | null, base?: string): string | null {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  if (!base) return null;
  return `${base}/${path}`;
}

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" });
  } catch {
    return "—";
  }
}

function PoBrowseView({
  warehouseId,
  warehouseName,
  r2PublicUrl,
}: {
  warehouseId: string;
  warehouseName: string;
  r2PublicUrl?: string;
}) {
  const router = useRouter();

  const [pos, setPos] = useState<ReceivablePoForMove[]>([]);
  const [posLoading, setPosLoading] = useState(false);
  const [posError, setPosError] = useState<string | null>(null);

  const [detail, setDetail] = useState<PoFulfillment | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  // โหลดลิสต์ใบ PO ตอน mount
  useEffect(() => {
    let cancelled = false;
    setPosLoading(true);
    setPosError(null);
    void (async () => {
      try {
        const res = await listPosForMoveAction(warehouseId);
        if (cancelled) return;
        if (!res.ok) {
          setPosError(res.error);
          setPos([]);
        } else {
          setPos(res.pos);
        }
      } catch {
        if (!cancelled) {
          setPosError("โหลดรายการใบ PO ไม่สำเร็จ ลองอีกครั้ง");
          setPos([]);
        }
      } finally {
        if (!cancelled) setPosLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [warehouseId]);

  const openPo = useCallback(
    async (poId: string) => {
      setDetailLoading(true);
      setDetailError(null);
      setDetail(null);
      setChecked(new Set());
      try {
        const res = await getPoFulfillmentAction(poId, warehouseId);
        if (!res.ok) {
          setDetailError(res.error);
          return;
        }
        setDetail(res.data);
        // default: ติ๊กแถวที่ยัง "เหลือในใบ" > 0 (เป็นตัวเลือกสะดวก — ผู้ใช้ปรับได้)
        const init = new Set<string>();
        for (const l of res.data.lines) if (l.remaining > 0) init.add(l.productId);
        setChecked(init);
      } catch {
        setDetailError("โหลดใบ PO ไม่สำเร็จ ลองอีกครั้ง");
      } finally {
        setDetailLoading(false);
      }
    },
    [warehouseId],
  );

  const backToList = useCallback(() => {
    setDetail(null);
    setDetailError(null);
    setChecked(new Set());
  }, []);

  const toggle = useCallback((productId: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  }, []);

  const checkedLines = useMemo<PoFulfillmentLine[]>(
    () => (detail ? detail.lines.filter((l) => checked.has(l.productId)) : []),
    [detail, checked],
  );

  // โยน handoff → หน้าโอน/เบิก (carry แค่ id + display qty=remaining + label)
  const handoff = useCallback(
    (target: "transfer" | "issue") => {
      if (!detail || checkedLines.length === 0) return;
      const payload = {
        poId: detail.poId,
        poCode: detail.poCode,
        poTitle: detail.title ?? null, // ชื่อเรียกใบ → หน้าปลายทางโชว์ชื่อบนชิปแทนเลข
        poLineCount: detail.lines.length, // ให้หน้าปลายทางโชว์ "ใบนี้มี X รายการ"
        lines: checkedLines.map((l) => ({
          productId: l.productId,
          sku: l.sku,
          name: l.name,
          unit: l.unit,
          imageUrl: imageSrc(l.imageR2Path, r2PublicUrl), // แนบรูปไปด้วย → หน้าปลายทางโชว์รูปได้
          // display qty = ไม่เกินของจริงในคลัง (min เหลือในใบ, คงเหลือจริง) → เลขที่โชว์ = เลขที่ server ตัดได้จริง
          qty: Math.max(0, Math.min(l.remaining, l.onHand)), // ปลายทาง re-resolve จริงฝั่ง server อีกชั้น
        })),
      };
      // ปั๊ม intent ไปด้วย → หน้าปลายทางเปิดแท็บตามที่คนกดตั้งใจ ไม่ต้องเดา
      writeDcHandoff(PO_HANDOFF_KEY, payload, target);
      router.push(target === "transfer" ? "/dc/transfer?tab=transfer" : "/dc/transfer?tab=issue");
    },
    [detail, checkedLines, router, r2PublicUrl],
  );

  // ── ชั้น 1: ลิสต์ใบ PO ──
  if (!detail) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 12.5, color: "var(--dc-muted)", padding: "0 2px" }}>
          ใบ PO ที่รับเข้าคลัง {warehouseName} แล้ว · กดเลือกใบเพื่อดูสินค้า แล้ว โอน / ตัดจ่าย ทั้งใบได้
        </div>
        {posError ? (
          <div className="dc-card" style={{ textAlign: "center", padding: 28, color: "#c0392b", fontSize: 14 }}>{posError}</div>
        ) : posLoading ? (
          <div className="dc-card" style={{ textAlign: "center", padding: 28, color: "var(--dc-muted)", fontSize: 14 }}>กำลังโหลด…</div>
        ) : detailLoading ? (
          <div className="dc-card" style={{ textAlign: "center", padding: 28, color: "var(--dc-muted)", fontSize: 14 }}>กำลังโหลดใบ…</div>
        ) : pos.length === 0 ? (
          <div className="dc-card" style={{ textAlign: "center", padding: 32, color: "var(--dc-muted)" }}>
            <FileText size={28} style={{ opacity: 0.5, marginBottom: 8 }} />
            <div style={{ fontSize: 14.5 }}>ยังไม่มีใบ PO ที่รับเข้าคลังนี้</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {pos.map((p) => (
              <button
                key={p.poId}
                type="button"
                onClick={() => void openPo(p.poId)}
                className="dc-card"
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, textAlign: "left", width: "100%", padding: "13px 14px", cursor: "pointer" }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: "var(--dc-ink)", lineHeight: 1.25 }}>{p.title ?? p.poCode}</div>
                  <div style={{ fontSize: 12.5, color: "var(--dc-muted)", marginTop: 2 }}>
                    {p.title ? p.poCode + " · " : ""}{p.supplierName ?? "ไม่ระบุผู้ขาย"} · รับเข้า {fmtDate(p.receivedAt)}
                  </div>
                </div>
                <div style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 5, fontSize: 13, fontWeight: 700, color: "var(--dc-muted)", whiteSpace: "nowrap" }}>
                  <Package size={15} /> {p.lineCount} รายการ
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── ชั้น 2: รายละเอียดใบ (5 chips + checkbox ต่อแถว) ──
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingBottom: 88 }}>
      {/* หัวใบ + กลับ */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button
          type="button"
          onClick={backToList}
          aria-label="เลือกใบอื่น"
          style={{ flexShrink: 0, width: 38, height: 38, borderRadius: 10, border: "1.5px solid var(--dc-line)", background: "var(--dc-paper)", display: "grid", placeItems: "center", cursor: "pointer", color: "var(--dc-ink)" }}
        >
          <ChevronLeft size={20} />
        </button>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 17, color: "var(--dc-ink)" }}>{detail.title ?? detail.poCode}</div>
          <div style={{ fontSize: 12.5, color: "var(--dc-muted)" }}>{detail.title ? detail.poCode + " · " : ""}{detail.supplierName ?? "ไม่ระบุผู้ขาย"} · ติ๊กสินค้าที่จะ โอน / ตัดจ่าย</div>
        </div>
      </div>

      {detailError ? (
        <div className="dc-card" style={{ textAlign: "center", padding: 24, color: "#c0392b", fontSize: 14 }}>{detailError}</div>
      ) : detail.lines.length === 0 ? (
        <div className="dc-card" style={{ textAlign: "center", padding: 24, color: "var(--dc-muted)", fontSize: 14 }}>ใบนี้ไม่มีรายการสินค้า</div>
      ) : (
        detail.lines.map((l) => {
          const on = checked.has(l.productId);
          const src = imageSrc(l.imageR2Path, r2PublicUrl);
          return (
            <div key={l.productId} className="dc-card" style={{ padding: 12, border: on ? "1.5px solid var(--color-brand-600, #2563eb)" : undefined }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggle(l.productId)}
                  aria-label={`เลือก ${l.name}`}
                  style={{ width: 22, height: 22, flexShrink: 0, marginTop: 2, cursor: "pointer" }}
                />
                <DcThumb url={src} alt={l.name} size={48} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 15.5, fontWeight: 700, color: "var(--dc-ink)", lineHeight: 1.25 }}>{l.name}</div>
                  <div style={{ fontSize: 12.5, color: "var(--dc-muted)", marginTop: 1 }}>{l.sku}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                    <PoChip label="สั่ง" value={l.ordered} />
                    <PoChip label="รับเข้า" value={l.received} />
                    <PoChip label="โอน-เบิกแล้ว" value={l.movedOut} />
                    <PoChip label="เหลือในใบ" value={l.remaining} tone="brand" strong />
                    <PoChip label="คงเหลือจริง" value={l.onHand} tone={l.onHand > 0 ? "ok" : "warn"} />
                  </div>
                </div>
              </div>
              {/* per-row ย้าย (ย้ายทีละตัว · deep-link ไปหน้าย้ายที่) */}
              <div style={{ marginTop: 10, textAlign: "right" }}>
                <Link
                  href="/dc/transfer?mode=move"
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700, color: "var(--dc-muted)", textDecoration: "none", padding: "6px 10px", borderRadius: 9, border: "1.5px solid var(--dc-line)" }}
                >
                  <Move size={15} /> ย้ายที่เก็บ
                </Link>
              </div>
            </div>
          );
        })
      )}

      {/* bottom action bar: [โอน] [ตัดจ่าย] (batch เฉพาะแถวที่ติ๊ก) */}
      {detail.lines.length > 0 && (
        <div
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 30,
            background: "var(--dc-paper, #fff)",
            borderTop: "1px solid var(--dc-line, #e6eaf0)",
            padding: "12px 16px calc(12px + env(safe-area-inset-bottom, 0px))",
            display: "flex",
            gap: 10,
            boxShadow: "0 -6px 20px rgba(20,40,90,0.10)",
          }}
        >
          <button
            type="button"
            onClick={() => handoff("transfer")}
            disabled={checkedLines.length === 0}
            style={{
              flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
              borderRadius: 12, padding: "13px 14px", fontSize: 15, fontWeight: 800, cursor: checkedLines.length === 0 ? "not-allowed" : "pointer",
              border: "none", background: checkedLines.length === 0 ? "var(--dc-canvas, #f1f4f9)" : "var(--color-brand-600, #2563eb)",
              color: checkedLines.length === 0 ? "var(--dc-muted, #6b7785)" : "#fff",
            }}
          >
            <Truck size={18} /> โอน{checkedLines.length > 0 ? ` (${checkedLines.length})` : ""}
          </button>
          <button
            type="button"
            onClick={() => handoff("issue")}
            disabled={checkedLines.length === 0}
            style={{
              flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
              borderRadius: 12, padding: "13px 14px", fontSize: 15, fontWeight: 800, cursor: checkedLines.length === 0 ? "not-allowed" : "pointer",
              border: checkedLines.length === 0 ? "1.5px solid var(--dc-line, #e6eaf0)" : "1.5px solid #c0392b",
              background: checkedLines.length === 0 ? "var(--dc-canvas, #f1f4f9)" : "#fdecec",
              color: checkedLines.length === 0 ? "var(--dc-muted, #6b7785)" : "#c0392b",
            }}
          >
            <PackageMinus size={18} /> ตัดจ่าย{checkedLines.length > 0 ? ` (${checkedLines.length})` : ""}
          </button>
        </div>
      )}
    </div>
  );
}

// chip สถิติเล็ก ๆ (mirror po-move-picker) — 5 สถานะ
function PoChip({ label, value, tone = "neutral", strong = false }: { label: string; value: number; tone?: "neutral" | "brand" | "ok" | "warn"; strong?: boolean }) {
  const palette: Record<string, { bg: string; fg: string; border: string }> = {
    neutral: { bg: "var(--dc-canvas, #f1f4f9)", fg: "var(--dc-muted, #6b7785)", border: "var(--dc-line, #e6eaf0)" },
    brand: { bg: "var(--color-brand-50, #eef3fe)", fg: "var(--color-brand-700, #1d4ed8)", border: "var(--color-brand-600, #2563eb)" },
    ok: { bg: "#eafaf0", fg: "#1e8e4e", border: "#bfe6cd" },
    warn: { bg: "#fdecea", fg: "#c0392b", border: "#f5c6c0" },
  };
  const c = palette[tone];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 999, fontSize: 11.5, fontWeight: strong ? 800 : 600, background: c.bg, color: c.fg, border: `1px solid ${c.border}`, whiteSpace: "nowrap" }}>
      {label} <b style={{ fontWeight: 800 }}>{value}</b>
    </span>
  );
}

function ProductRow({ p }: { p: FloorProductRow }) {
  const empty = p.systemQty <= 0;
  return (
    <li style={{ borderBottom: "1px solid var(--dc-line)", opacity: empty ? 0.62 : 1 }}>
      {/* แตะทั้งแถว → ประวัติสินค้า (per-product log) */}
      <Link
        href={`/dc/products/${p.productId}`}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "11px 14px",
          textDecoration: "none",
          color: "inherit",
        }}
      >
        <DcThumb url={p.imageUrl} alt={p.name} size={44} />
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
        <ChevronRight size={18} color="var(--dc-subtle, #9aa4b2)" style={{ flexShrink: 0 }} />
      </Link>
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
