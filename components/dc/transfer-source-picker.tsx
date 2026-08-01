"use client";

// DC · ตัวเลือก "โอนต่อ จากใบโอนที่รับเข้าคลัง" (bottom-sheet · มิเรอร์ po-move-picker)
//   1) เปิด → listReceivedTransfersForMoveAction(warehouseId) → ลิสต์ใบโอนที่รับเข้าคลังนี้แล้ว
//   2) แตะใบ → getReceivedTransferDetailAction(transferId, warehouseId) → ตารางสินค้าในใบ พร้อม
//      รับเข้า/คงเหลือจริง/พรีฟิลได้ + ช่องนับจำนวนต่อแถว
//   3) cap จำนวนต่อแถว = available (= min(received, onHand)) → server (dispatchTransfer) เช็ค onHand ซ้ำ
//   4) ยืนยัน → onConfirm({transferId, transferCode, lines: แถวที่ qty>0}) แล้วปิด
//
// ★ style ตาม pattern bottom-sheet เดียวกับ po-move-picker (.dcx tokens + inline) — คู่ปุ่ม "เลือกจากใบ PO"
// ★ ของจากใบโอน = ของบนชั้นคลังจริง (ไม่ผูก po_id ในคลังนี้) → หน้าฟอร์มจะเพิ่มบรรทัด poId:null

import { useCallback, useEffect, useMemo, useState } from "react";
import { X, ChevronLeft, Package, Search } from "lucide-react";
import {
  listReceivedTransfersForMoveAction,
  getReceivedTransferDetailAction,
} from "@/lib/dc/transfer-source-actions";
import { DcThumb } from "@/components/dc/product-image";
import { PoProgressBar } from "@/components/dc/po-progress-bar";
import type {
  ReceivedTransferForMove,
  TransferSourceDetail,
  TransferSourceLine,
} from "@/lib/dc/transfer-source";

export type TransferSourceConfirmLine = {
  productId: string;
  sku: string;
  name: string;
  unit: string;
  qty: number;
  imageUrl: string | null; // รูปสินค้า (resolve แล้ว) — ให้หน้าฟอร์มโชว์รูปต่อได้
};

export type TransferSourceSelection = {
  transferId: string;
  transferCode: string;
  fromWarehouseName: string | null; // "โอนมาจากคลัง ..." (โชว์ประกอบ)
  lines: TransferSourceConfirmLine[];
  transferLineCount: number; // จำนวนรายการสินค้า "ทั้งใบ" โอน (ไว้โชว์ "ใบนี้มี X รายการ")
};

type Props = {
  open: boolean;
  onClose: () => void;
  warehouseId: string;
  r2PublicUrl?: string;
  onConfirm: (sel: TransferSourceSelection) => void;
};

// เพดานที่โอนต่อได้จริงต่อแถว = available (server คิด min(received, onHand) มาให้แล้ว)
function capOf(line: TransferSourceLine): number {
  return Math.max(0, line.available);
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

export function TransferSourcePicker({ open, onClose, warehouseId, r2PublicUrl, onConfirm }: Props) {
  // ---- ชั้น 1: ลิสต์ใบโอน ----
  const [transfers, setTransfers] = useState<ReceivedTransferForMove[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [query, setQuery] = useState(""); // ค้นหาเลขใบ / ชื่อคลังต้นทาง

  // ---- ชั้น 2: รายละเอียดใบที่เลือก ----
  const [detail, setDetail] = useState<TransferSourceDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  // จำนวนที่เลือกต่อ productId
  const [qtyByProduct, setQtyByProduct] = useState<Record<string, number>>({});

  const resetToList = useCallback(() => {
    setDetail(null);
    setDetailError(null);
    setQtyByProduct({});
  }, []);

  // โหลดลิสต์ใบโอนตอนเปิด
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    resetToList();
    setQuery("");
    setListLoading(true);
    setListError(null);
    void (async () => {
      try {
        const res = await listReceivedTransfersForMoveAction(warehouseId);
        if (cancelled) return;
        if (!res.ok) {
          setListError(res.error);
          setTransfers([]);
        } else {
          setTransfers(res.transfers);
        }
      } catch {
        if (!cancelled) {
          setListError("โหลดรายการใบโอนไม่สำเร็จ ลองอีกครั้ง");
          setTransfers([]);
        }
      } finally {
        if (!cancelled) setListLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, warehouseId, resetToList]);

  const openTransfer = useCallback(
    async (transferId: string) => {
      setDetailLoading(true);
      setDetailError(null);
      setDetail(null);
      setQtyByProduct({});
      try {
        const res = await getReceivedTransferDetailAction(transferId, warehouseId);
        if (!res.ok) {
          setDetailError(res.error);
          return;
        }
        setDetail(res.data);
        // default: เริ่มทุกแถวที่ 0 — ให้ผู้ใช้เลือกเองว่าจะหยิบตัวไหนกี่ชิ้น (กันเผลอโอนเต็มใบ)
        //   อยากหยิบทั้งใบเร็ว ๆ → กดปุ่ม "เลือกทั้งหมด (ทั้งใบ)" เติมเต็มให้ทีเดียว
        const init: Record<string, number> = {};
        for (const l of res.data.lines) init[l.productId] = 0;
        setQtyByProduct(init);
      } catch {
        setDetailError("โหลดใบโอนไม่สำเร็จ ลองอีกครั้ง");
      } finally {
        setDetailLoading(false);
      }
    },
    [warehouseId],
  );

  const setQty = useCallback((line: TransferSourceLine, raw: number) => {
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
    if (!detail) return { count: 0, rows: 0, lines: [] as TransferSourceConfirmLine[] };
    const lines: TransferSourceConfirmLine[] = [];
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

  // กรองลิสต์ใบตามคำค้น (เลขใบ / ชื่อคลังต้นทาง) — client-side บนลิสต์ที่โหลดมาแล้ว
  const filteredTransfers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return transfers;
    return transfers.filter(
      (t) =>
        t.transferCode.toLowerCase().includes(q) ||
        (t.fromWarehouseName ?? "").toLowerCase().includes(q),
    );
  }, [transfers, query]);

  const confirm = useCallback(() => {
    if (!detail || selected.lines.length === 0) return;
    onConfirm({
      transferId: detail.transferId,
      transferCode: detail.transferCode,
      fromWarehouseName: detail.fromWarehouseName ?? null,
      lines: selected.lines,
      transferLineCount: detail.lines.length,
    });
    onClose();
  }, [detail, selected.lines, onConfirm, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="เลือกใบโอนเพื่อโอนต่อ"
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
                {detail ? detail.transferCode : "เลือกใบโอนเพื่อโอนต่อ"}
              </div>
              <div style={{ fontSize: 12.5, color: "var(--dc-muted, #6b7785)" }}>
                {detail
                  ? `โอนมาจาก ${detail.fromWarehouseName ?? "ไม่ระบุคลัง"} · โอนเท่าที่ "รับเข้า" และ "คงเหลือจริง"`
                  : "ใบที่รับเข้าคลังนี้แล้ว · กดเลือกแล้วโอนต่อ"}
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
            // ---- ชั้น 1: ลิสต์ใบโอน ----
            listError ? (
              <div style={{ padding: 24, textAlign: "center", color: "#c0392b", fontSize: 15, fontWeight: 600 }}>
                {listError}
              </div>
            ) : listLoading ? (
              <div style={{ padding: 28, textAlign: "center", color: "var(--dc-muted, #6b7785)", fontSize: 15 }}>
                กำลังโหลด…
              </div>
            ) : transfers.length === 0 ? (
              <div style={{ padding: 28, textAlign: "center", color: "var(--dc-muted, #6b7785)", fontSize: 15 }}>
                ยังไม่มีใบโอนที่มีของเหลือในคลังนี้
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {/* ค้นหาใบโอน (เลขใบ / ชื่อคลังต้นทาง) */}
                <div style={{ position: "relative", marginBottom: 2 }}>
                  <Search
                    size={16}
                    style={{
                      position: "absolute",
                      left: 12,
                      top: "50%",
                      transform: "translateY(-50%)",
                      color: "var(--dc-muted, #6b7785)",
                      pointerEvents: "none",
                    }}
                  />
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="ค้นหาเลขใบโอน หรือชื่อคลังต้นทาง…"
                    aria-label="ค้นหาใบโอน"
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      padding: "10px 12px 10px 36px",
                      borderRadius: 10,
                      border: "1.5px solid var(--dc-line, #e6eaf0)",
                      background: "#fff",
                      fontSize: 14.5,
                      color: "var(--dc-ink, #1f2733)",
                      outline: "none",
                    }}
                  />
                </div>

                {filteredTransfers.length === 0 ? (
                  <div style={{ padding: 22, textAlign: "center", color: "var(--dc-muted, #6b7785)", fontSize: 14 }}>
                    ไม่พบใบโอนที่ตรงกับ “{query.trim()}”
                  </div>
                ) : (
                  filteredTransfers.map((t) => (
                    <button
                      key={t.transferId}
                      type="button"
                      onClick={() => void openTransfer(t.transferId)}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                        textAlign: "left",
                        width: "100%",
                        border: "1.5px solid var(--dc-line, #e6eaf0)",
                        background: "#fff",
                        borderRadius: 12,
                        padding: "12px 14px",
                        cursor: "pointer",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          justifyContent: "space-between",
                          gap: 12,
                          width: "100%",
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 16, fontWeight: 800, color: "var(--dc-ink, #1f2733)", lineHeight: 1.25 }}>
                            {t.transferCode}
                          </div>
                          <div style={{ fontSize: 12.5, color: "var(--dc-muted, #6b7785)", marginTop: 2 }}>
                            โอนมาจาก {t.fromWarehouseName ?? "ไม่ระบุคลัง"} · รับเข้า {fmtDate(t.confirmedAt)}
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
                          <Package size={15} /> {t.lineCount} รายการ
                        </div>
                      </div>
                      {/* แถบ "คงเหลือ / รับเข้า" — เห็นว่าเหลือน้อย/มากก่อนคลิกเข้าใบ */}
                      <PoProgressBar value={t.totalAvailable} total={t.totalReceived} label="คงเหลือ" unit="ชิ้น" compact />
                    </button>
                  ))
                )}
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
                            <Chip label="รับเข้า" value={l.received} />
                            <Chip label="คงเหลือจริง" value={l.onHand} tone={l.onHand > 0 ? "ok" : "warn"} strong />
                          </div>
                        </div>
                      </div>

                      {/* stepper จำนวน */}
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 10 }}>
                        <div style={{ fontSize: 12.5, color: "var(--dc-muted, #6b7785)", fontWeight: 600 }}>
                          {disabled ? "โอนไม่ได้ (ไม่มีของคงเหลือ)" : `โอนได้สูงสุด ${cap} ${l.unit}`}
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
                            aria-label={`จำนวนโอน ${l.name}`}
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
        fontSize: strong ? 13.5 : 12.5,
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
