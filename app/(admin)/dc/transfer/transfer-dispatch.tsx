"use client";

// DC · หน้ารวมงานหน้าคลัง (client):
//   <FloorTransferMove> = toggle บนสุด 2 โหมด + render flow ที่เลือก
//     • "ย้ายที่เก็บ — ในคลังนี้"  → <MoveWorkspace> (move flow เดิม: lookupForMove + moveLocation)
//     • "ส่ง / โอน — ไปคลัง/สาขาอื่น" → <TransferDispatch> (transfer flow เดิม: lookupForTransfer + dispatchTransfer)
//   <TransferDispatch> = เลือกปลายทาง → สแกน/พิมพ์รหัส "หรือ" กดเลือกจากรายการ → นับจำนวน → ส่งออก.
//     • เพิ่มทาง "เลือกจากรายการ" = ลิสต์สินค้าที่มีของจริง (listStockForPick) กดเพื่อเพิ่ม + โชว์ "เหลือ N"
//     • ★ lineKey (uuid) สร้างตอน "เพิ่ม" บรรทัด → ส่งซ้ำ = no-op (idempotent)
//     • ปุ่มส่งออก busy-lock กันกดซ้ำ · สำเร็จ → toast เขียว · buffer ใน localStorage กันลิสต์หาย

import { useCallback, useEffect, useRef, useState } from "react";
import { List, Search, Trash2, Truck, X } from "lucide-react";
import { DcScanBox } from "@/components/dc/scan-box";
import { MoveWorkspace } from "../move/move-workspace";
import { DcTransferDestType } from "@/lib/generated/prisma/enums";
import {
  lookupForTransfer,
  dispatchTransfer,
  listStockForPick,
  type DispatchLine,
  type PickRow,
} from "@/lib/dc/transfer-actions";

export type DestWarehouseOption = { id: string; name: string };

type Line = {
  lineKey: string;
  productId: string;
  sku: string;
  name: string;
  unit: string;
  onHand: number;
  qty: number;
};

type DestMode = "warehouse" | "module";

// ★ บัฟเฟอร์รายการที่พิมพ์/ยิงไว้ใน localStorage แยกตามคลังต้นทาง — กันลิสต์หายตอนรีเฟรช/เน็ตหลุด
const STORAGE_PREFIX = "dc.transfer.";

function storageKey(fromWarehouseId: string): string {
  return `${STORAGE_PREFIX}${fromWarehouseId}`;
}

function loadBuffer(fromWarehouseId: string): Line[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(fromWarehouseId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (l): l is Line => !!l && typeof (l as Line).lineKey === "string" && typeof (l as Line).productId === "string",
    );
  } catch {
    return [];
  }
}

function saveBuffer(fromWarehouseId: string, lines: Line[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(fromWarehouseId), JSON.stringify(lines));
  } catch {
    /* quota / private mode — เงียบไว้ (ยังใช้ใน-memory ได้) */
  }
}

function newLineKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `lk-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ════════════════════════════════════════════════════════════════════
// FloorTransferMove — toggle บนสุด: ย้ายที่ (ในคลัง) ⇄ ส่ง/โอน (ข้ามคลัง)
// ════════════════════════════════════════════════════════════════════

export function FloorTransferMove({
  initialTab,
  warehouseId,
  warehouseName,
  warehouses,
}: {
  initialTab: "move" | "transfer";
  warehouseId: string;
  warehouseName: string;
  warehouses: DestWarehouseOption[];
}) {
  const [tab, setTab] = useState<"move" | "transfer">(initialTab);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* toggle อธิบายความต่างชัด ๆ (CEO สับสนว่า 2 หน้านี้ต่างกันยังไง) */}
      <div className="dc-card" style={{ padding: 10 }}>
        <div role="tablist" aria-label="เลือกงาน" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "move"}
            onClick={() => setTab("move")}
            style={tabStyle(tab === "move")}
          >
            <div style={{ fontSize: 16, fontWeight: 800 }}>ย้ายที่เก็บ — ในคลังนี้</div>
            <div style={{ fontSize: 12.5, fontWeight: 600, opacity: 0.85, marginTop: 2, lineHeight: 1.35 }}>
              ย้ายของจากช่อง/ชั้นวางหนึ่ง ไปอีกช่องในคลังเดียวกัน
            </div>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "transfer"}
            onClick={() => setTab("transfer")}
            style={tabStyle(tab === "transfer")}
          >
            <div style={{ fontSize: 16, fontWeight: 800 }}>ส่ง / โอน — ไปคลัง/สาขาอื่น</div>
            <div style={{ fontSize: 12.5, fontWeight: 600, opacity: 0.85, marginTop: 2, lineHeight: 1.35 }}>
              ส่งของออกจากคลังนี้ ไปคลัง DC อื่น หรือสาขา/โมดูล
            </div>
          </button>
        </div>
      </div>

      {tab === "move" ? (
        <MoveWorkspace warehouseId={warehouseId} warehouseName={warehouseName} />
      ) : (
        <TransferDispatch
          fromWarehouseId={warehouseId}
          fromWarehouseName={warehouseName}
          warehouses={warehouses}
        />
      )}
    </div>
  );
}

export function TransferDispatch({
  fromWarehouseId,
  fromWarehouseName,
  warehouses,
}: {
  fromWarehouseId: string;
  fromWarehouseName: string;
  warehouses: DestWarehouseOption[];
}) {
  // ปลายทางที่เลือกได้ = คลังอื่น (ไม่รวมต้นทาง)
  const destWarehouses = warehouses.filter((w) => w.id !== fromWarehouseId);

  const [destMode, setDestMode] = useState<DestMode>(
    destWarehouses.length > 0 ? "warehouse" : "module",
  );
  const [toWarehouseId, setToWarehouseId] = useState<string>(destWarehouses[0]?.id ?? "");
  const [toLabel, setToLabel] = useState("");
  const [sameSite, setSameSite] = useState(false);
  const [note, setNote] = useState("");

  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // ---- "เลือกจากรายการ" (tap-select) ----
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickQuery, setPickQuery] = useState("");
  const [pickRows, setPickRows] = useState<PickRow[]>([]);
  const [pickLoading, setPickLoading] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);

  const lookingRef = useRef(false);

  // ---- โหลด buffer ตอน mount (กู้ลิสต์คืนหลังรีเฟรช/เน็ตหลุด) ----
  useEffect(() => {
    setLines(loadBuffer(fromWarehouseId));
  }, [fromWarehouseId]);

  // ---- persist ทุกครั้งที่ลิสต์เปลี่ยน ----
  useEffect(() => {
    saveBuffer(fromWarehouseId, lines);
  }, [fromWarehouseId, lines]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3500);
  }, []);

  // เพิ่มสินค้า 1 ชิ้นเข้าลิสต์ (ใช้ทั้งสแกนและกดเลือก) — มีอยู่แล้ว → +1, ไม่มี → บรรทัดใหม่
  const addProduct = useCallback(
    (p: { id: string; sku: string; name: string; unit: string; onHand: number }) => {
      setLines((prev) => {
        const idx = prev.findIndex((l) => l.productId === p.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...next[idx], qty: next[idx].qty + 1, onHand: p.onHand };
          return next;
        }
        return [
          ...prev,
          {
            lineKey: newLineKey(),
            productId: p.id,
            sku: p.sku,
            name: p.name,
            unit: p.unit,
            onHand: p.onHand,
            qty: 1,
          },
        ];
      });
    },
    [],
  );

  const handleScan = useCallback(
    async (code: string) => {
      if (lookingRef.current) return;
      lookingRef.current = true;
      setError(null);
      try {
        const res = await lookupForTransfer({ fromWarehouseId, code });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        const p = res.product;
        addProduct({ id: p.id, sku: p.sku, name: p.name, unit: p.unit, onHand: p.onHand });
      } catch {
        setError("ค้นหาสินค้าไม่สำเร็จ ลองอีกครั้ง");
      } finally {
        lookingRef.current = false;
      }
    },
    [fromWarehouseId, addProduct],
  );

  // โหลดรายการสินค้าที่มีของจริง (qtyOnHand>0) — เรียกตอนเปิด picker + ตอนพิมพ์ค้นหา (debounce)
  const loadPicks = useCallback(
    async (q: string) => {
      setPickLoading(true);
      setPickError(null);
      try {
        const res = await listStockForPick({ fromWarehouseId, q: q.trim() || undefined });
        if (!res.ok) {
          setPickError(res.error);
          setPickRows([]);
          return;
        }
        setPickRows(res.rows);
      } catch {
        setPickError("โหลดรายการไม่สำเร็จ ลองอีกครั้ง");
        setPickRows([]);
      } finally {
        setPickLoading(false);
      }
    },
    [fromWarehouseId],
  );

  const openPicker = useCallback(() => {
    setPickerOpen(true);
    setPickQuery("");
    void loadPicks("");
  }, [loadPicks]);

  // debounce ค้นหาในลิสต์
  useEffect(() => {
    if (!pickerOpen) return;
    const t = window.setTimeout(() => void loadPicks(pickQuery), 250);
    return () => window.clearTimeout(t);
  }, [pickQuery, pickerOpen, loadPicks]);

  const setQty = useCallback((lineKey: string, qty: number) => {
    setLines((prev) =>
      prev.map((l) => (l.lineKey === lineKey ? { ...l, qty: Math.max(1, Math.trunc(qty || 1)) } : l)),
    );
  }, []);

  const removeLine = useCallback((lineKey: string) => {
    setLines((prev) => prev.filter((l) => l.lineKey !== lineKey));
  }, []);

  const totalQty = lines.reduce((s, l) => s + l.qty, 0);

  const destOk =
    destMode === "warehouse" ? !!toWarehouseId : toLabel.trim().length > 0;

  const dispatch = useCallback(async () => {
    if (busy || lines.length === 0 || !destOk) return;
    setBusy(true);
    setError(null);
    try {
      const payload: DispatchLine[] = lines.map((l) => ({
        productId: l.productId,
        qty: l.qty,
        lineKey: l.lineKey,
      }));

      const res = await dispatchTransfer(
        destMode === "warehouse"
          ? {
              fromWarehouseId,
              destType: DcTransferDestType.WAREHOUSE,
              toWarehouseId,
              sameSite,
              note: note.trim() || undefined,
              lines: payload,
            }
          : {
              fromWarehouseId,
              destType: DcTransferDestType.MODULE,
              toLabel: toLabel.trim(),
              note: note.trim() || undefined,
              lines: payload,
            },
      );

      if (!res.ok) {
        setError(res.error);
        return;
      }

      setLines([]);
      setNote("");
      if (res.status === "CONFIRMED") {
        showToast(`ส่ง + รับเข้าแล้ว ${totalQty} ชิ้น (อยู่ที่เดียวกัน)`);
      } else {
        showToast(`ส่งออกแล้ว ${totalQty} ชิ้น — รอปลายทางยืนยันรับ`);
      }
    } catch {
      setError("ส่งออกไม่สำเร็จ ลองอีกครั้ง");
    } finally {
      setBusy(false);
    }
  }, [busy, lines, destOk, destMode, fromWarehouseId, toWarehouseId, sameSite, note, toLabel, totalQty, showToast]);

  // จำนวนที่หยิบไปแล้วต่อสินค้า (ใช้คำนวณ "เหลือ" ในลิสต์เลือก)
  const pickedQtyByProduct = new Map<string, number>();
  for (const l of lines) pickedQtyByProduct.set(l.productId, l.qty);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* เลือกปลายทาง */}
      <div className="dc-card" style={{ padding: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, color: "var(--dc-ink, #1f2733)" }}>
          ส่งไปที่ไหน?
        </div>

        {/* toggle ประเภทปลายทาง */}
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => setDestMode("warehouse")}
            disabled={destWarehouses.length === 0}
            style={destToggleStyle(destMode === "warehouse", destWarehouses.length === 0)}
          >
            คลัง DC อื่น
          </button>
          <button
            type="button"
            onClick={() => setDestMode("module")}
            style={destToggleStyle(destMode === "module", false)}
          >
            สาขา / โมดูล
          </button>
        </div>

        {destMode === "warehouse" ? (
          destWarehouses.length === 0 ? (
            <div style={{ fontSize: 14, color: "var(--dc-muted, #6b7785)" }}>
              ไม่มีคลัง DC อื่นให้ส่ง — เลือก &quot;สาขา / โมดูล&quot; แทน
            </div>
          ) : (
            <>
              <select
                value={toWarehouseId}
                onChange={(e) => setToWarehouseId(e.target.value)}
                style={selectStyle}
                aria-label="คลังปลายทาง"
              >
                {destWarehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginTop: 12,
                  fontSize: 15,
                  fontWeight: 600,
                  color: "var(--dc-ink, #1f2733)",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={sameSite}
                  onChange={(e) => setSameSite(e.target.checked)}
                  style={{ width: 20, height: 20 }}
                />
                อยู่ที่เดียวกัน (รับเข้าทันที — ไม่ต้องรอยืนยัน)
              </label>
            </>
          )
        ) : (
          <>
            <input
              type="text"
              value={toLabel}
              onChange={(e) => setToLabel(e.target.value)}
              placeholder="พิมพ์ชื่อสาขา/โมดูลปลายทาง เช่น Playland เซ็นทรัล, ตู้คีบ A1"
              style={selectStyle}
              aria-label="ปลายทาง (สาขา/โมดูล)"
            />
            <div style={{ marginTop: 8, fontSize: 13, color: "var(--dc-muted, #6b7785)", lineHeight: 1.5 }}>
              บันทึก &quot;ส่งออก&quot; ก่อน → ปลายทางกด &quot;ยืนยันส่งถึง&quot; ที่หลังบ้านเพื่อปิดใบ
            </div>
          </>
        )}
      </div>

      {/* กล่องสแกน + ปุ่มเลือกจากรายการ */}
      <div className="dc-card" style={{ padding: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, color: "var(--dc-ink, #1f2733)" }}>
          ยิงบาร์โค้ด หรือ พิมพ์รหัสสินค้า — ส่งออกจากคลัง {fromWarehouseName}
        </div>
        <DcScanBox onScan={handleScan} placeholder="ยิงบาร์โค้ด / พิมพ์ SKU แล้วกด Enter…" />
        <button
          type="button"
          onClick={openPicker}
          style={{
            marginTop: 12,
            width: "100%",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            border: "1.5px solid var(--color-brand-600, #2D6CB1)",
            background: "var(--color-brand-50, #eef3fe)",
            color: "var(--color-brand-700, #1d4ed8)",
            borderRadius: 12,
            padding: "12px 14px",
            fontSize: 15,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          <List size={18} /> เลือกจากรายการสินค้า
        </button>
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

      {/* รายการส่งออก */}
      {lines.length === 0 ? (
        <div className="dc-card" style={{ textAlign: "center", padding: 28, color: "var(--dc-muted, #6b7785)" }}>
          ยังไม่มีรายการ — ยิงบาร์โค้ด พิมพ์รหัส หรือกด &quot;เลือกจากรายการสินค้า&quot;
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {lines.map((l) => {
            const over = l.qty > l.onHand;
            return (
              <div key={l.lineKey} className="dc-card" style={{ padding: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 17, fontWeight: 700, color: "var(--dc-ink, #1f2733)", lineHeight: 1.25 }}>
                      {l.name}
                    </div>
                    <div style={{ fontSize: 13, color: "var(--dc-muted, #6b7785)", marginTop: 2 }}>
                      {l.sku} · เหลือ {l.onHand} {l.unit}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeLine(l.lineKey)}
                    aria-label="ลบรายการ"
                    style={{ background: "transparent", border: "none", color: "#c0392b", cursor: "pointer", padding: 6, flexShrink: 0 }}
                  >
                    <Trash2 size={20} />
                  </button>
                </div>

                <div className="dc-qty" style={{ marginTop: 12 }}>
                  <button type="button" onClick={() => setQty(l.lineKey, l.qty - 1)} aria-label="ลด">
                    −
                  </button>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    value={l.qty}
                    onChange={(e) => setQty(l.lineKey, Number(e.target.value))}
                    aria-label="จำนวนส่งออก"
                  />
                  <button type="button" onClick={() => setQty(l.lineKey, l.qty + 1)} aria-label="เพิ่ม">
                    ＋
                  </button>
                </div>

                {over && (
                  <div style={{ marginTop: 8, color: "#c0392b", fontSize: 13, fontWeight: 700 }}>
                    ⚠️ ส่ง {l.qty} แต่เหลือแค่ {l.onHand} — จะส่งไม่ผ่าน
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* หมายเหตุ (ไม่บังคับ) */}
      {lines.length > 0 && (
        <div className="dc-card" style={{ padding: 14 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, fontWeight: 600, color: "var(--dc-muted, #6b7785)" }}>
            <span style={{ whiteSpace: "nowrap" }}>หมายเหตุ</span>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="ไม่บังคับ"
              style={{
                flex: 1,
                minWidth: 0,
                border: "1.5px solid var(--dc-line, #e6eaf0)",
                borderRadius: 10,
                padding: "10px 12px",
                fontSize: 16,
                fontWeight: 600,
                color: "var(--dc-ink, #1f2733)",
                background: "#fff",
              }}
            />
          </label>
        </div>
      )}

      {/* ปุ่มส่งออก */}
      {lines.length > 0 && (
        <button
          type="button"
          className="dc-btn-xl"
          onClick={dispatch}
          disabled={busy || !destOk}
        >
          <Truck size={20} />
          {busy ? "กำลังส่ง…" : `ส่งออก (${totalQty} ชิ้น)`}
        </button>
      )}

      {/* ป็อปอัปเลือกจากรายการ (tap-select) */}
      {pickerOpen && (
        <div
          role="dialog"
          aria-label="เลือกจากรายการสินค้า"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9998,
            background: "rgba(0,0,0,0.2)",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
          }}
          onClick={() => setPickerOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 560,
              maxHeight: "85vh",
              background: "#fff",
              borderTopLeftRadius: 18,
              borderTopRightRadius: 18,
              boxShadow: "0 -8px 32px rgba(0,0,0,0.2)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {/* หัวป็อปอัป + ค้นหา */}
            <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--dc-line, #e6eaf0)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: "var(--dc-ink, #1f2733)" }}>
                  เลือกสินค้า — คลัง {fromWarehouseName}
                </div>
                <button
                  type="button"
                  onClick={() => setPickerOpen(false)}
                  aria-label="ปิด"
                  style={{ background: "transparent", border: "none", color: "var(--dc-muted, #6b7785)", cursor: "pointer", padding: 4 }}
                >
                  <X size={22} />
                </button>
              </div>
              <div style={{ position: "relative", marginTop: 10 }}>
                <Search
                  size={18}
                  style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--dc-muted, #6b7785)" }}
                />
                <input
                  type="text"
                  value={pickQuery}
                  onChange={(e) => setPickQuery(e.target.value)}
                  placeholder="ค้นหาชื่อหรือ SKU…"
                  autoFocus
                  style={{
                    width: "100%",
                    border: "1.5px solid var(--dc-line, #e6eaf0)",
                    borderRadius: 12,
                    padding: "12px 14px 12px 38px",
                    fontSize: 16,
                    fontWeight: 600,
                    color: "var(--dc-ink, #1f2733)",
                    background: "#fff",
                    boxSizing: "border-box",
                  }}
                />
              </div>
            </div>

            {/* รายการ */}
            <div style={{ overflowY: "auto", padding: 10 }}>
              {pickError ? (
                <div style={{ padding: 20, textAlign: "center", color: "#c0392b", fontSize: 15, fontWeight: 600 }}>
                  {pickError}
                </div>
              ) : pickLoading ? (
                <div style={{ padding: 24, textAlign: "center", color: "var(--dc-muted, #6b7785)", fontSize: 15 }}>
                  กำลังโหลด…
                </div>
              ) : pickRows.length === 0 ? (
                <div style={{ padding: 24, textAlign: "center", color: "var(--dc-muted, #6b7785)", fontSize: 15 }}>
                  ไม่พบสินค้าที่มีของในคลังนี้
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {pickRows.map((r) => {
                    const inCart = pickedQtyByProduct.get(r.productId) ?? 0;
                    const remaining = Math.max(0, r.onHand - inCart);
                    return (
                      <button
                        key={r.productId}
                        type="button"
                        onClick={() =>
                          addProduct({ id: r.productId, sku: r.sku, name: r.name, unit: r.unit, onHand: r.onHand })
                        }
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 12,
                          textAlign: "left",
                          width: "100%",
                          border: "1.5px solid var(--dc-line, #e6eaf0)",
                          background: inCart > 0 ? "var(--color-brand-50, #eef3fe)" : "#fff",
                          borderRadius: 12,
                          padding: "12px 14px",
                          cursor: "pointer",
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--dc-ink, #1f2733)", lineHeight: 1.25 }}>
                            {r.name}
                          </div>
                          <div style={{ fontSize: 12.5, color: "var(--dc-muted, #6b7785)", marginTop: 2 }}>
                            {r.sku}
                            {inCart > 0 ? ` · หยิบแล้ว ${inCart}` : ""}
                          </div>
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <div style={{ fontSize: 17, fontWeight: 800, color: remaining > 0 ? "#1e8e4e" : "#c0392b" }}>
                            เหลือ {remaining}
                          </div>
                          <div style={{ fontSize: 11.5, color: "var(--dc-muted, #6b7785)" }}>{r.unit}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ท้ายป็อปอัป */}
            <div style={{ padding: 12, borderTop: "1px solid var(--dc-line, #e6eaf0)" }}>
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                className="dc-btn-xl"
                style={{ marginTop: 0 }}
              >
                เสร็จ — กลับไปนับจำนวน{totalQty > 0 ? ` (${totalQty} ชิ้น)` : ""}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* toast */}
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
          <Truck size={18} /> {toast}
        </div>
      )}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  width: "100%",
  border: "1.5px solid var(--dc-line, #e6eaf0)",
  borderRadius: 12,
  padding: "12px 14px",
  fontSize: 16,
  fontWeight: 600,
  color: "var(--dc-ink, #1f2733)",
  background: "#fff",
  boxSizing: "border-box",
};

function destToggleStyle(active: boolean, disabled: boolean): React.CSSProperties {
  return {
    flex: 1,
    minWidth: 120,
    border: active ? "2px solid var(--color-brand-600, #2D6CB1)" : "1.5px solid var(--dc-line, #e6eaf0)",
    background: active ? "var(--color-brand-50, #eef3fe)" : "#fff",
    color: active ? "var(--color-brand-700, #1d4ed8)" : disabled ? "#b8c0cc" : "var(--dc-ink, #1f2733)",
    borderRadius: 12,
    padding: "12px 14px",
    fontSize: 15,
    fontWeight: 700,
    cursor: disabled ? "not-allowed" : "pointer",
  };
}

function tabStyle(active: boolean): React.CSSProperties {
  return {
    flex: 1,
    minWidth: 200,
    textAlign: "left",
    border: active ? "2px solid var(--color-brand-600, #2D6CB1)" : "1.5px solid var(--dc-line, #e6eaf0)",
    background: active ? "var(--color-brand-50, #eef3fe)" : "#fff",
    color: active ? "var(--color-brand-700, #1d4ed8)" : "var(--dc-ink, #1f2733)",
    borderRadius: 14,
    padding: "12px 14px",
    cursor: "pointer",
  };
}
