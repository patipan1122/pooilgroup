"use client";

// DC · ตัวเลือก "โอน/เบิก เป็นใบ PO" (bottom-sheet · reuse ทั้งหน้าโอนและหน้าเบิก)
//   1) เปิด → listPosForMoveAction(warehouseId) → ลิสต์ใบ PO ที่รับเข้าคลังนี้แล้ว
//   2) แตะใบ → getPoFulfillmentAction(poId, warehouseId) → ตารางสินค้าในใบ พร้อม
//      สั่ง/รับเข้า/โอน-เบิกแล้ว/เหลือในใบ/คงเหลือจริง + ช่องนับจำนวนต่อแถว
//   3) cap จำนวนต่อแถว = min(remaining, onHand) → server guard ไม่มีทางเด้ง
//   4) ยืนยัน → onConfirm({poId, poCode, lines: แถวที่ qty>0}) แล้วปิด
//
// ★ style ตาม pattern bottom-sheet เดิมในหน้าโอน/เบิก (.dcx tokens + inline)

import { useCallback, useEffect, useMemo, useState } from "react";
import { X, ChevronLeft, Package } from "lucide-react";
import {
  listPosForMoveAction,
  getPoFulfillmentAction,
} from "@/lib/dc/po-move-actions";
import { DcThumb } from "@/components/dc/product-image";
import type {
  ReceivablePoForMove,
  PoFulfillment,
  PoFulfillmentLine,
} from "@/lib/dc/po-fulfillment";

export type PoMoveConfirmLine = {
  productId: string;
  sku: string;
  name: string;
  unit: string;
  qty: number;
  imageUrl: string | null; // รูปสินค้า (resolve แล้ว) — ให้หน้าฟอร์มโชว์รูปต่อได้
};

export type PoMoveSelection = {
  poId: string;
  poCode: string;
  lines: PoMoveConfirmLine[];
  poLineCount: number; // จำนวนรายการสินค้า "ทั้งใบ" PO (ไว้โชว์ "ใบนี้มี X รายการ")
};

type Props = {
  open: boolean;
  onClose: () => void;
  warehouseId: string;
  r2PublicUrl?: string;
  mode: "transfer" | "issue";
  onConfirm: (sel: PoMoveSelection) => void;
};

// เพดานที่โอน/เบิกได้จริงต่อแถว = ต่ำสุดของ "เหลือในใบ" กับ "คงเหลือจริง"
function capOf(line: PoFulfillmentLine): number {
  return Math.max(0, Math.min(line.remaining, line.onHand));
}

// รูปสินค้า: ถ้า path เป็น http อยู่แล้วใช้ตรง ๆ · ไม่งั้น prefix ด้วย r2PublicUrl
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

export function PoMovePicker({ open, onClose, warehouseId, r2PublicUrl, mode, onConfirm }: Props) {
  const verb = mode === "transfer" ? "โอน" : "เบิก";

  // ---- ชั้น 1: ลิสต์ใบ PO ----
  const [pos, setPos] = useState<ReceivablePoForMove[]>([]);
  const [posLoading, setPosLoading] = useState(false);
  const [posError, setPosError] = useState<string | null>(null);

  // ---- ชั้น 2: รายละเอียดใบที่เลือก ----
  const [detail, setDetail] = useState<PoFulfillment | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  // จำนวนที่เลือกต่อ productId
  const [qtyByProduct, setQtyByProduct] = useState<Record<string, number>>({});

  const resetToList = useCallback(() => {
    setDetail(null);
    setDetailError(null);
    setQtyByProduct({});
  }, []);

  // โหลดลิสต์ใบ PO ตอนเปิด
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    resetToList();
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
  }, [open, warehouseId, resetToList]);

  const openPo = useCallback(
    async (poId: string) => {
      setDetailLoading(true);
      setDetailError(null);
      setDetail(null);
      setQtyByProduct({});
      try {
        const res = await getPoFulfillmentAction(poId, warehouseId);
        if (!res.ok) {
          setDetailError(res.error);
          return;
        }
        setDetail(res.data);
        // default: เริ่มทุกแถวที่ 0 — ให้ผู้ใช้เลือกเองว่าจะหยิบตัวไหนกี่ชิ้น (กันเผลอเบิก/โอนเต็มใบ)
        //   อยากหยิบทั้งใบเร็ว ๆ → กดปุ่ม "เลือกทั้งหมด (ทั้งใบ)" เติมเต็มให้ทีเดียว
        const init: Record<string, number> = {};
        for (const l of res.data.lines) init[l.productId] = 0;
        setQtyByProduct(init);
      } catch {
        setDetailError("โหลดใบ PO ไม่สำเร็จ ลองอีกครั้ง");
      } finally {
        setDetailLoading(false);
      }
    },
    [warehouseId],
  );

  const setQty = useCallback((line: PoFulfillmentLine, raw: number) => {
    const cap = capOf(line);
    const v = Number.isFinite(raw) ? Math.trunc(raw) : 0;
    const clamped = Math.max(0, Math.min(cap, v));
    setQtyByProduct((prev) => ({ ...prev, [line.productId]: clamped }));
  }, []);

  const selectAll = useCallback(() => {
    if (!detail) return;
    const next: Record<string, number> = {};
    for (const l of detail.lines) next[l.productId] = capOf(l);
    setQtyByProduct(next);
  }, [detail]);

  const clearAll = useCallback(() => {
    if (!detail) return;
    const next: Record<string, number> = {};
    for (const l of detail.lines) next[l.productId] = 0;
    setQtyByProduct(next);
  }, [detail]);

  const selected = useMemo(() => {
    if (!detail) return { count: 0, rows: 0, lines: [] as PoMoveConfirmLine[] };
    const lines: PoMoveConfirmLine[] = [];
    let count = 0;
    for (const l of detail.lines) {
      const q = qtyByProduct[l.productId] ?? 0;
      if (q > 0) {
        lines.push({
          productId: l.productId,
          sku: l.sku,
          name: l.name,
          unit: l.unit,
          qty: q,
          imageUrl: imageSrc(l.imageR2Path, r2PublicUrl), // แนบรูปไปด้วย → หน้าฟอร์มโชว์รูปได้
        });
        count += q;
      }
    }
    return { count, rows: lines.length, lines };
  }, [detail, qtyByProduct, r2PublicUrl]);

  const confirm = useCallback(() => {
    if (!detail || selected.lines.length === 0) return;
    onConfirm({
      poId: detail.poId,
      poCode: detail.poCode,
      lines: selected.lines,
      poLineCount: detail.lines.length,
    });
    onClose();
  }, [detail, selected.lines, onConfirm, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`เลือกใบ PO เพื่อ${verb}`}
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9998,
        background: "rgba(20,28,45,0.32)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--dc-paper, #fff)",
          width: "100%",
          maxWidth: 760,
          maxHeight: "92vh",
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 -8px 34px rgba(20,40,90,0.22)",
          overflow: "hidden",
        }}
      >
        {/* header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            padding: "16px 16px 12px",
            borderBottom: "1px solid var(--dc-line, #e6eaf0)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            {detail && (
              <button
                type="button"
                onClick={resetToList}
                aria-label="เลือกใบอื่น"
                style={{
                  flexShrink: 0,
                  width: 38,
                  height: 38,
                  borderRadius: 10,
                  border: "1.5px solid var(--dc-line, #e6eaf0)",
                  background: "var(--dc-paper, #fff)",
                  display: "grid",
                  placeItems: "center",
                  cursor: "pointer",
                  color: "var(--dc-ink, #1f2733)",
                }}
              >
                <ChevronLeft size={20} />
              </button>
            )}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 17, color: "var(--dc-ink, #1f2733)" }}>
                {detail ? detail.poCode : `เลือกใบ PO เพื่อ${verb}`}
              </div>
              <div style={{ fontSize: 12.5, color: "var(--dc-muted, #6b7785)" }}>
                {detail
                  ? `${detail.supplierName ?? "ไม่ระบุผู้ขาย"} · ${verb}เท่าที่ "เหลือในใบ" และ "คงเหลือจริง"`
                  : `ใบที่รับเข้าคลังนี้แล้ว · กดเลือกแล้ว${verb}ต่อ`}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิด"
            style={{
              flexShrink: 0,
              width: 40,
              height: 40,
              borderRadius: 10,
              border: "1.5px solid var(--dc-line, #e6eaf0)",
              background: "var(--dc-paper, #fff)",
              display: "grid",
              placeItems: "center",
              cursor: "pointer",
              color: "var(--dc-muted, #6b7785)",
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* body */}
        <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
          {!detail ? (
            // ---- ชั้น 1: ลิสต์ใบ PO ----
            posError ? (
              <div style={{ padding: 24, textAlign: "center", color: "#c0392b", fontSize: 15, fontWeight: 600 }}>
                {posError}
              </div>
            ) : posLoading ? (
              <div style={{ padding: 28, textAlign: "center", color: "var(--dc-muted, #6b7785)", fontSize: 15 }}>
                กำลังโหลด…
              </div>
            ) : pos.length === 0 ? (
              <div style={{ padding: 28, textAlign: "center", color: "var(--dc-muted, #6b7785)", fontSize: 15 }}>
                ยังไม่มีใบ PO ที่รับเข้าคลังนี้
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {pos.map((p) => (
                  <button
                    key={p.poId}
                    type="button"
                    onClick={() => void openPo(p.poId)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      textAlign: "left",
                      width: "100%",
                      border: "1.5px solid var(--dc-line, #e6eaf0)",
                      background: "#fff",
                      borderRadius: 12,
                      padding: "13px 14px",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 16, fontWeight: 800, color: "var(--dc-ink, #1f2733)", lineHeight: 1.25 }}>
                        {p.poCode}
                      </div>
                      <div style={{ fontSize: 12.5, color: "var(--dc-muted, #6b7785)", marginTop: 2 }}>
                        {p.supplierName ?? "ไม่ระบุผู้ขาย"} · รับเข้า {fmtDate(p.receivedAt)}
                      </div>
                    </div>
                    <div
                      style={{
                        flexShrink: 0,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        fontSize: 13,
                        fontWeight: 700,
                        color: "var(--dc-muted, #6b7785)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      <Package size={15} /> {p.lineCount} รายการ
                    </div>
                  </button>
                ))}
              </div>
            )
          ) : detailLoading ? (
            <div style={{ padding: 28, textAlign: "center", color: "var(--dc-muted, #6b7785)", fontSize: 15 }}>
              กำลังโหลดรายละเอียดใบ…
            </div>
          ) : detailError ? (
            <div style={{ padding: 24, textAlign: "center", color: "#c0392b", fontSize: 15, fontWeight: 600 }}>
              {detailError}
            </div>
          ) : (
            // ---- ชั้น 2: รายละเอียดสินค้าในใบ ----
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {/* ปุ่มเลือกทั้งหมด / ล้าง */}
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  onClick={selectAll}
                  style={{
                    flex: 1,
                    border: "1.5px solid var(--color-brand-600, #2563eb)",
                    background: "var(--color-brand-50, #eef3fe)",
                    color: "var(--color-brand-700, #1d4ed8)",
                    borderRadius: 10,
                    padding: "10px 12px",
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  เลือกทั้งหมด (ทั้งใบ)
                </button>
                <button
                  type="button"
                  onClick={clearAll}
                  style={{
                    border: "1.5px solid var(--dc-line, #e6eaf0)",
                    background: "#fff",
                    color: "var(--dc-muted, #6b7785)",
                    borderRadius: 10,
                    padding: "10px 16px",
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  ล้าง
                </button>
              </div>

              {/* สรุป: ใบนี้มีกี่รายการ · เลือกแล้วกี่รายการ (ขยับตามที่ปรับ) */}
              <div style={{ fontSize: 13, color: "var(--dc-muted, #6b7785)", fontWeight: 600 }}>
                ใบนี้มี <b style={{ color: "var(--dc-ink, #1f2733)" }}>{detail.lines.length}</b> รายการ · เลือกแล้ว{" "}
                <b style={{ color: "var(--color-brand-700, #1d4ed8)" }}>{selected.rows}</b> รายการ ({selected.count} ชิ้น)
              </div>

              {detail.lines.length === 0 ? (
                <div style={{ padding: 24, textAlign: "center", color: "var(--dc-muted, #6b7785)", fontSize: 14 }}>
                  ใบนี้ไม่มีรายการสินค้า
                </div>
              ) : (
                detail.lines.map((l) => {
                  const cap = capOf(l);
                  const qty = qtyByProduct[l.productId] ?? 0;
                  const disabled = cap <= 0;
                  const src = imageSrc(l.imageR2Path, r2PublicUrl);
                  return (
                    <div
                      key={l.productId}
                      className="dc-card"
                      style={{
                        padding: 12,
                        opacity: disabled ? 0.62 : 1,
                        border: qty > 0 ? "1.5px solid var(--color-brand-600, #2563eb)" : undefined,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                        <DcThumb url={src} alt={l.name} size={48} />
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: 15.5, fontWeight: 700, color: "var(--dc-ink, #1f2733)", lineHeight: 1.25 }}>
                            {l.name}
                          </div>
                          <div style={{ fontSize: 12.5, color: "var(--dc-muted, #6b7785)", marginTop: 1 }}>
                            {l.sku}
                          </div>
                          {/* stat chips */}
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                            <Chip label="สั่ง" value={l.ordered} />
                            <Chip label="รับเข้า" value={l.received} />
                            <Chip label={`${verb}แล้ว`} value={l.movedOut} />
                            <Chip label="เหลือในใบ" value={l.remaining} tone="brand" strong />
                            <Chip label="คงเหลือจริง" value={l.onHand} tone={l.onHand > 0 ? "ok" : "warn"} />
                          </div>
                        </div>
                      </div>

                      {/* stepper จำนวน */}
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 10 }}>
                        <div style={{ fontSize: 12.5, color: "var(--dc-muted, #6b7785)", fontWeight: 600 }}>
                          {disabled ? `${verb}ไม่ได้ (ไม่เหลือในใบ/ไม่มีของ)` : `${verb}ได้สูงสุด ${cap} ${l.unit}`}
                        </div>
                        <div className="dc-qty" style={{ margin: 0 }}>
                          <button
                            type="button"
                            onClick={() => setQty(l, qty - 1)}
                            aria-label="ลด"
                            disabled={disabled}
                          >
                            −
                          </button>
                          <input
                            type="number"
                            inputMode="numeric"
                            min={0}
                            max={cap}
                            value={qty}
                            disabled={disabled}
                            onChange={(e) => setQty(l, Number(e.target.value))}
                            aria-label={`จำนวน${verb} ${l.name}`}
                            style={{ fontSize: 16 }}
                          />
                          <button
                            type="button"
                            onClick={() => setQty(l, qty + 1)}
                            aria-label="เพิ่ม"
                            disabled={disabled || qty >= cap}
                          >
                            ＋
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* footer */}
        {detail && !detailLoading && !detailError && (
          <div style={{ padding: "10px 16px 16px", borderTop: "1px solid var(--dc-line, #e6eaf0)" }}>
            <button
              type="button"
              className="dc-btn-xl"
              onClick={confirm}
              disabled={selected.lines.length === 0}
              style={selected.lines.length === 0 ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
            >
              {selected.lines.length === 0
                ? "ยังไม่ได้เลือกจำนวน"
                : `ใส่ในรายการ (${selected.count} ชิ้น รวม ${selected.rows} รายการ)`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// chip สถิติเล็ก ๆ ต่อสินค้า
function Chip({
  label,
  value,
  tone = "neutral",
  strong = false,
}: {
  label: string;
  value: number;
  tone?: "neutral" | "brand" | "ok" | "warn";
  strong?: boolean;
}) {
  const palette: Record<string, { bg: string; fg: string; border: string }> = {
    neutral: { bg: "var(--dc-canvas, #f1f4f9)", fg: "var(--dc-muted, #6b7785)", border: "var(--dc-line, #e6eaf0)" },
    brand: { bg: "var(--color-brand-50, #eef3fe)", fg: "var(--color-brand-700, #1d4ed8)", border: "var(--color-brand-600, #2563eb)" },
    ok: { bg: "#eafaf0", fg: "#1e8e4e", border: "#bfe6cd" },
    warn: { bg: "#fdecea", fg: "#c0392b", border: "#f5c6c0" },
  };
  const c = palette[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: strong ? "5px 11px" : "4px 9px",
        borderRadius: 999,
        fontSize: strong ? 13.5 : 12.5, // ตัวใหญ่ขึ้น (เดิม 11.5) — CEO อ่านเลข "เหลือในใบ/คงเหลือจริง" ยาก
        fontWeight: strong ? 800 : 600,
        background: c.bg,
        color: c.fg,
        border: `1px solid ${c.border}`,
        whiteSpace: "nowrap",
      }}
    >
      {label} <b style={{ fontWeight: 800, fontSize: strong ? 17 : 15.5 }}>{value}</b>
    </span>
  );
}
