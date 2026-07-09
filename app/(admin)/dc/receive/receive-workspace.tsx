"use client";

// DC · หน้ารับเข้า (client) — สแกน/พิมพ์รหัส → เพิ่มรายการ → นับจำนวน → ยืนยันรับเข้า.
//   • สแกน/พิมพ์รหัส → lookupProduct → เพิ่มบรรทัด (มีอยู่แล้ว = +1)
//   • แต่ละบรรทัด: ชื่อ · stepper จำนวน · ต้นทุน/ชิ้น (ไม่บังคับ) · ลบ
//   • ★ lineKey (uuid) สร้างตอน "เพิ่ม" บรรทัด → ยืนยันซ้ำ = no-op (idempotent)
//   • ปุ่มยืนยัน busy-lock กันกดซ้ำ · สำเร็จ → toast เขียว + ปริ้นฉลาก QR ของที่เพิ่งรับ

import { useCallback, useEffect, useRef, useState } from "react";
import { Trash2, PackageCheck } from "lucide-react";
import { DcScanBox } from "@/components/dc/scan-box";
import { DcBarcodeGuess } from "@/components/dc/barcode-guess";
import { DcLabelButton, type DcLabelItem } from "@/components/dc/label-print";
import { lookupProduct, postReceive, type ReceiveLine } from "@/lib/dc/receive-actions";

type Line = {
  lineKey: string;
  productId: string;
  sku: string;
  name: string;
  unit: string;
  onHand: number;
  qty: number;
  /** ต้นทุน/ชิ้น เป็น "บาท" (string ในฟอร์ม) — แปลงเป็นสตางค์ตอนส่ง */
  costBaht: string;
};

// ★ บัฟเฟอร์รายการที่พิมพ์/ยิงไว้ใน localStorage แยกตามคลัง — กันลิสต์หายตอนรีเฟรช/เน็ตหลุด
const STORAGE_PREFIX = "dc.receive.";

function storageKey(warehouseId: string): string {
  return `${STORAGE_PREFIX}${warehouseId}`;
}

function loadBuffer(warehouseId: string): Line[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(warehouseId));
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

function saveBuffer(warehouseId: string, lines: Line[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(warehouseId), JSON.stringify(lines));
  } catch {
    /* quota / private mode — เงียบไว้ (ยังใช้ใน-memory ได้) */
  }
}

function newLineKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // fallback (เบราว์เซอร์เก่า) — ยังคงเป็น stable key ต่อบรรทัด
  return `lk-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** บาท (string) → สตางค์ (int) | null ถ้าว่าง/ไม่ถูกต้อง */
function bahtToSatang(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function ReceiveWorkspace({
  warehouseId,
  activeWarehouseName,
}: {
  warehouseId: string;
  activeWarehouseName: string;
}) {
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // รหัสที่ยิงแล้ว "ไม่พบในระบบเรา" → เดาชื่อจากอินเทอร์เน็ต (ยังต้องลงทะเบียนก่อนถึงรับเข้าได้)
  const [notFoundCode, setNotFoundCode] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // ฉลากของ "ที่เพิ่งรับเข้าสำเร็จ" (snapshot หลังยืนยัน) สำหรับปุ่มปริ้น
  const [justReceived, setJustReceived] = useState<DcLabelItem[]>([]);

  const lookingRef = useRef(false);

  // ---- โหลด buffer ตอน mount (กู้ลิสต์คืนหลังรีเฟรช/เน็ตหลุด) ----
  useEffect(() => {
    setLines(loadBuffer(warehouseId));
  }, [warehouseId]);

  // ---- persist ทุกครั้งที่ลิสต์เปลี่ยน ----
  useEffect(() => {
    saveBuffer(warehouseId, lines);
  }, [warehouseId, lines]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3500);
  }, []);

  // สแกน/พิมพ์รหัส → หาสินค้า → เพิ่มบรรทัด (มีแล้ว +1)
  const handleScan = useCallback(
    async (code: string) => {
      if (lookingRef.current) return;
      lookingRef.current = true;
      setError(null);
      setNotFoundCode(null);
      try {
        const res = await lookupProduct(code, warehouseId);
        if (!res.ok) {
          setError(res.error);
          setNotFoundCode(code); // ไม่พบในระบบ → ลองเดาชื่อจากเน็ต
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
              costBaht: "",
            },
          ];
        });
      } catch {
        setError("ค้นหาสินค้าไม่สำเร็จ ลองอีกครั้ง");
      } finally {
        lookingRef.current = false;
      }
    },
    [warehouseId],
  );

  const setQty = useCallback((lineKey: string, qty: number) => {
    setLines((prev) =>
      prev.map((l) => (l.lineKey === lineKey ? { ...l, qty: Math.max(1, Math.trunc(qty || 1)) } : l)),
    );
  }, []);

  const setCost = useCallback((lineKey: string, costBaht: string) => {
    setLines((prev) => prev.map((l) => (l.lineKey === lineKey ? { ...l, costBaht } : l)));
  }, []);

  const removeLine = useCallback((lineKey: string) => {
    setLines((prev) => prev.filter((l) => l.lineKey !== lineKey));
  }, []);

  const totalQty = lines.reduce((s, l) => s + l.qty, 0);

  const confirm = useCallback(async () => {
    if (busy || lines.length === 0) return;
    setBusy(true);
    setError(null);
    setJustReceived([]);
    try {
      const payload: ReceiveLine[] = lines.map((l) => ({
        productId: l.productId,
        qty: l.qty,
        unitCostSatang: bahtToSatang(l.costBaht),
        lineKey: l.lineKey,
      }));
      const res = await postReceive({ warehouseId, lines: payload });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // snapshot ฉลากของที่เพิ่งรับ (ก่อนเคลียร์รายการ)
      const labels: DcLabelItem[] = lines.map((l) => ({
        code: l.sku,
        name: l.name,
        sku: l.sku,
        qty: l.qty,
      }));
      setJustReceived(labels);
      setLines([]);
      showToast(`รับเข้าแล้ว ${res.posted} รายการ`);
    } catch {
      setError("บันทึกรับเข้าไม่สำเร็จ ลองอีกครั้ง");
    } finally {
      setBusy(false);
    }
  }, [busy, lines, warehouseId, showToast]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* กล่องสแกน */}
      <div className="dc-card" style={{ padding: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, color: "var(--dc-ink, #1f2733)" }}>
          ยิงบาร์โค้ด หรือ พิมพ์รหัสสินค้า — เข้าคลัง {activeWarehouseName}
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

      {/* เดาชื่อจากอินเทอร์เน็ต เมื่อยิงแล้วไม่พบในระบบ */}
      {notFoundCode && <DcBarcodeGuess key={notFoundCode} code={notFoundCode} />}

      {/* รายการรับเข้า */}
      {lines.length === 0 ? (
        <div className="dc-card" style={{ textAlign: "center", padding: 28, color: "var(--dc-muted, #6b7785)" }}>
          ยังไม่มีรายการ — ยิงบาร์โค้ดหรือพิมพ์รหัสเพื่อเพิ่ม
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {lines.map((l) => (
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
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#c0392b",
                    cursor: "pointer",
                    padding: 6,
                    flexShrink: 0,
                  }}
                >
                  <Trash2 size={20} />
                </button>
              </div>

              {/* stepper จำนวน */}
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
                  aria-label="จำนวนรับเข้า"
                />
                <button type="button" onClick={() => setQty(l.lineKey, l.qty + 1)} aria-label="เพิ่ม">
                  ＋
                </button>
              </div>

              {/* ต้นทุน/ชิ้น (ไม่บังคับ) */}
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginTop: 12,
                  fontSize: 14,
                  fontWeight: 600,
                  color: "var(--dc-muted, #6b7785)",
                }}
              >
                <span style={{ whiteSpace: "nowrap" }}>ต้นทุน/ชิ้น (บาท)</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={l.costBaht}
                  onChange={(e) => setCost(l.lineKey, e.target.value)}
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
          ))}
        </div>
      )}

      {/* ยืนยัน */}
      {lines.length > 0 && (
        <button type="button" className="dc-btn-xl" onClick={confirm} disabled={busy}>
          <PackageCheck size={20} />
          {busy ? "กำลังบันทึก…" : `ยืนยันรับเข้า (${totalQty} ชิ้น)`}
        </button>
      )}

      {/* ปริ้นฉลากของที่เพิ่งรับ */}
      {justReceived.length > 0 && (
        <div className="dc-card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--dc-ink, #1f2733)" }}>
            พิมพ์ฉลาก QR สำหรับของที่เพิ่งรับเข้า
          </div>
          <DcLabelButton items={justReceived} />
        </div>
      )}

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
