"use client";

// DC · หน้าส่ง/โอน (client) — เลือกปลายทาง → สแกน/พิมพ์รหัส → นับจำนวน → ส่งออก.
//   • ปลายทาง 2 แบบ:
//       (1) คลัง DC อื่น — โอน 2 จังหวะ (ปลายทางกด "ยืนยันรับ" ที่หลังบ้าน) · มีตัวเลือก
//           "อยู่ที่เดียวกัน (รับเข้าทันที)" = sameSite → รับเข้าเลยไม่ต้องรอยืนยัน
//       (2) สาขา/โมดูล (Playland/ตู้คีบ/สาขา) — พิมพ์ป้ายเอง · บันทึกแค่ส่งออก แล้วปิดด้วย
//           "ยืนยันส่งถึง" ที่หลังบ้าน (ยังไม่เขียนเข้าระบบปลายทาง — เฟส 3)
//   • ★ lineKey (uuid) สร้างตอน "เพิ่ม" บรรทัด → ส่งซ้ำ = no-op (idempotent)
//   • ปุ่มส่งออก busy-lock กันกดซ้ำ · สำเร็จ → toast เขียว

import { useCallback, useEffect, useRef, useState } from "react";
import { Trash2, Truck } from "lucide-react";
import { DcScanBox } from "@/components/dc/scan-box";
import { DcTransferDestType } from "@/lib/generated/prisma/enums";
import {
  lookupForTransfer,
  dispatchTransfer,
  type DispatchLine,
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
        setLines((prev) => {
          const idx = prev.findIndex((l) => l.productId === p.id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
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
      } catch {
        setError("ค้นหาสินค้าไม่สำเร็จ ลองอีกครั้ง");
      } finally {
        lookingRef.current = false;
      }
    },
    [fromWarehouseId],
  );

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

      {/* กล่องสแกน */}
      <div className="dc-card" style={{ padding: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, color: "var(--dc-ink, #1f2733)" }}>
          ยิงบาร์โค้ด หรือ พิมพ์รหัสสินค้า — ส่งออกจากคลัง {fromWarehouseName}
        </div>
        <DcScanBox onScan={handleScan} placeholder="ยิงบาร์โค้ด / พิมพ์ SKU แล้วกด Enter…" />
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
          ยังไม่มีรายการ — ยิงบาร์โค้ดหรือพิมพ์รหัสเพื่อเพิ่ม
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
                      {l.sku} · มีอยู่ {l.onHand} {l.unit}
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
                    ⚠️ ส่ง {l.qty} แต่มีอยู่แค่ {l.onHand} — จะส่งไม่ผ่าน
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
