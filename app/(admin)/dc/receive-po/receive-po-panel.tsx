"use client";

// DC · หน้าคลัง · รายการ PO ที่รอรับเข้า (client) — แตะใบ → ฟอร์มรับสินค้า.
//   • แตะใบ → กางฟอร์ม: แต่ละบรรทัด (ชื่อสินค้า + จำนวนที่สั่ง) → stepper รับจริง + เสียหาย
//   • หมายเหตุการรับ (note) — เหมือนการนำเข้า (แนะนำให้กรอก)
//   • ปุ่ม "รับเข้าคลัง" busy-lock กันกดซ้ำ · สำเร็จ → toast เขียว + เอาใบออกจากรายการ
//   • รับเข้าคลัง = ctx.activeWarehouseId (ส่งมาจาก server)

import { useCallback, useState } from "react";
import { PackageCheck, ChevronDown, ChevronRight } from "lucide-react";
import { receivePo } from "@/lib/dc/po-actions";

export type ReceivablePoLine = {
  productId: string;
  name: string;
  sku: string;
  qtyOrdered: number;
};

export type ReceivablePo = {
  id: string;
  poCode: string;
  status: string;
  statusLabel: string;
  statusTone: string;
  supplierName: string;
  lineCount: number;
  lines: ReceivablePoLine[];
};

// state ฟอร์มต่อบรรทัด (string ในฟอร์ม → แปลงเป็น int ตอนส่ง)
type LineDraft = {
  productId: string;
  name: string;
  sku: string;
  qtyOrdered: number;
  qtyReceived: number;
  qtyDamaged: number;
};

function toInt(n: number): number {
  return Math.max(0, Math.trunc(Number.isFinite(n) ? n : 0));
}

export function ReceivePoList({
  pos,
  warehouseId,
}: {
  pos: ReceivablePo[];
  warehouseId: string;
}) {
  const [items, setItems] = useState<ReceivablePo[]>(pos);
  const [openId, setOpenId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3500);
  }, []);

  const removePo = useCallback((poId: string) => {
    setItems((prev) => prev.filter((p) => p.id !== poId));
    setOpenId((cur) => (cur === poId ? null : cur));
  }, []);

  if (items.length === 0) {
    return (
      <div
        className="dc-card"
        style={{ textAlign: "center", padding: 28, color: "var(--dc-muted, #6b7785)" }}
      >
        ไม่มีใบสั่งซื้อที่รอรับเข้า — ของมาถึงแล้วค่อยกลับมาที่หน้านี้
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {items.map((po) => (
        <PoCard
          key={po.id}
          po={po}
          warehouseId={warehouseId}
          open={openId === po.id}
          onToggle={() => setOpenId((cur) => (cur === po.id ? null : po.id))}
          onReceived={(grnId) => {
            removePo(po.id);
            showToast(`รับเข้าคลังแล้ว · ${po.poCode}`);
            void grnId;
          }}
        />
      ))}

      {/* toast สำเร็จ */}
      {toast && (
        <div
          role="status"
          style={{
            position: "fixed",
            left: "50%",
            bottom: 24,
            transform: "translateX(-50%)",
            background: "#1e8e4e",
            color: "#fff",
            borderRadius: 12,
            padding: "12px 20px",
            fontSize: 16,
            fontWeight: 700,
            boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
            zIndex: 9999,
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <PackageCheck size={18} /> {toast}
        </div>
      )}
    </div>
  );
}

function PoCard({
  po,
  warehouseId,
  open,
  onToggle,
  onReceived,
}: {
  po: ReceivablePo;
  warehouseId: string;
  open: boolean;
  onToggle: () => void;
  onReceived: (grnId: string) => void;
}) {
  // draft ของบรรทัด — เริ่มต้น: รับ = จำนวนที่สั่ง, เสียหาย = 0
  const [drafts, setDrafts] = useState<LineDraft[]>(() =>
    po.lines.map((l) => ({
      productId: l.productId,
      name: l.name,
      sku: l.sku,
      qtyOrdered: l.qtyOrdered,
      qtyReceived: l.qtyOrdered,
      qtyDamaged: 0,
    })),
  );
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setReceived = useCallback((productId: string, qty: number) => {
    setDrafts((prev) =>
      prev.map((d) => (d.productId === productId ? { ...d, qtyReceived: toInt(qty) } : d)),
    );
  }, []);
  const setDamaged = useCallback((productId: string, qty: number) => {
    setDrafts((prev) =>
      prev.map((d) => (d.productId === productId ? { ...d, qtyDamaged: toInt(qty) } : d)),
    );
  }, []);

  const confirm = useCallback(async () => {
    if (busy) return;
    if (!note.trim()) {
      setError("กรุณากรอกหมายเหตุการรับ (เช่น สภาพของ / ผู้รับ / กล่องที่ขาด)");
      return;
    }
    const lines = drafts
      .filter((d) => d.qtyReceived > 0 || d.qtyDamaged > 0)
      .map((d) => ({
        productId: d.productId,
        qtyReceived: d.qtyReceived,
        qtyDamaged: d.qtyDamaged,
      }));
    if (lines.length === 0) {
      setError("กรุณาระบุจำนวนที่รับเข้าอย่างน้อย 1 รายการ");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await receivePo({ poId: po.id, warehouseId, note: note.trim(), lines });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onReceived(res.grnId);
    } catch {
      setError("บันทึกรับเข้าไม่สำเร็จ ลองอีกครั้ง");
    } finally {
      setBusy(false);
    }
  }, [busy, note, drafts, po.id, warehouseId, onReceived]);

  const totalReceived = drafts.reduce((s, d) => s + d.qtyReceived, 0);

  return (
    <div className="dc-card" style={{ padding: 0, overflow: "hidden" }}>
      {/* หัวใบ — แตะเพื่อกาง/พับ */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: 16,
          background: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span style={{ color: "var(--dc-muted, #6b7785)", flexShrink: 0 }}>
          {open ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: 17,
              fontWeight: 700,
              color: "var(--dc-ink, #1f2733)",
              lineHeight: 1.25,
            }}
          >
            {po.poCode}
          </div>
          <div style={{ fontSize: 13, color: "var(--dc-muted, #6b7785)", marginTop: 2 }}>
            {po.supplierName} · {po.lineCount} รายการ
          </div>
        </div>
        <span className={`dc-st dc-st--${po.statusTone}`} style={{ flexShrink: 0 }}>
          {po.statusLabel}
        </span>
      </button>

      {/* ฟอร์มรับสินค้า */}
      {open && (
        <div
          style={{
            padding: 16,
            borderTop: "1px solid var(--dc-line, #e6eaf0)",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          {drafts.map((d) => (
            <div
              key={d.productId}
              style={{
                border: "1px solid var(--dc-line, #e6eaf0)",
                borderRadius: 12,
                padding: 14,
              }}
            >
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: "var(--dc-ink, #1f2733)",
                  lineHeight: 1.25,
                }}
              >
                {d.name}
              </div>
              <div style={{ fontSize: 13, color: "var(--dc-muted, #6b7785)", marginTop: 2 }}>
                {d.sku} · สั่งไว้ {d.qtyOrdered} ชิ้น
              </div>

              {/* จำนวนที่รับจริง */}
              <div style={{ marginTop: 12 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--dc-muted, #6b7785)",
                    marginBottom: 6,
                  }}
                >
                  รับจริง
                </div>
                <div className="dc-qty">
                  <button
                    type="button"
                    onClick={() => setReceived(d.productId, d.qtyReceived - 1)}
                    aria-label="ลดจำนวนรับ"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={d.qtyReceived}
                    onChange={(e) => setReceived(d.productId, Number(e.target.value))}
                    aria-label="จำนวนที่รับจริง"
                  />
                  <button
                    type="button"
                    onClick={() => setReceived(d.productId, d.qtyReceived + 1)}
                    aria-label="เพิ่มจำนวนรับ"
                  >
                    ＋
                  </button>
                </div>
              </div>

              {/* จำนวนที่เสียหาย */}
              <div style={{ marginTop: 12 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--dc-muted, #6b7785)",
                    marginBottom: 6,
                  }}
                >
                  เสียหาย (ถ้ามี)
                </div>
                <div className="dc-qty">
                  <button
                    type="button"
                    onClick={() => setDamaged(d.productId, d.qtyDamaged - 1)}
                    aria-label="ลดจำนวนเสียหาย"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={d.qtyDamaged}
                    onChange={(e) => setDamaged(d.productId, Number(e.target.value))}
                    aria-label="จำนวนที่เสียหาย"
                  />
                  <button
                    type="button"
                    onClick={() => setDamaged(d.productId, d.qtyDamaged + 1)}
                    aria-label="เพิ่มจำนวนเสียหาย"
                  >
                    ＋
                  </button>
                </div>
              </div>
            </div>
          ))}

          {/* หมายเหตุการรับ — เหมือนการนำเข้า */}
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--dc-ink, #1f2733)" }}>
              หมายเหตุการรับ
            </span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="เช่น ของครบ สภาพดี / กล่องที่ 3 บุบ / รับโดยช่างเอก…"
              style={{
                width: "100%",
                border: "1.5px solid var(--dc-line, #e6eaf0)",
                borderRadius: 10,
                padding: "10px 12px",
                fontSize: 15,
                lineHeight: 1.5,
                color: "var(--dc-ink, #1f2733)",
                background: "#fff",
                resize: "vertical",
                fontFamily: "inherit",
              }}
            />
          </label>

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

          <button type="button" className="dc-btn-xl" onClick={confirm} disabled={busy}>
            <PackageCheck size={20} />
            {busy ? "กำลังบันทึก…" : `รับเข้าคลัง (${totalReceived} ชิ้น)`}
          </button>
        </div>
      )}
    </div>
  );
}
