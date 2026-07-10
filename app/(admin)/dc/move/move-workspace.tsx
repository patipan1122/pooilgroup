"use client";

// DC · หน้าย้ายที่ (client) — สแกน/พิมพ์รหัส → ดูสินค้า+ตำแหน่งปัจจุบัน → ระบุตำแหน่งใหม่ → ย้าย.
//   • สแกน/พิมพ์รหัส → lookupForMove → โชว์ชื่อ · ยอดคงเหลือ · ตำแหน่งปัจจุบัน
//   • พิมพ์ "ตำแหน่งใหม่ (เช่น A-3)" → ปุ่มใหญ่ "ย้ายไป {location}" → moveLocation
//   • ★ lineKey (uuid) สร้างตอน lookup สำเร็จ → กดย้ายซ้ำ = no-op (idempotent)
//   • สำเร็จ → toast เขียว + พร้อมสแกนตัวถัดไป (เคลียร์รายการ) · พิมพ์รหัสมือได้เสมอ

import { useCallback, useRef, useState } from "react";
import { MoveRight, X } from "lucide-react";
import { DcScanBox } from "@/components/dc/scan-box";
import { lookupForMove, moveLocation } from "@/lib/dc/issue-actions";

type Picked = {
  lineKey: string;
  productId: string;
  sku: string;
  name: string;
  onHand: number;
  location: string | null;
};

function newLineKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `lk-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function MoveWorkspace({
  warehouseId,
  warehouseName,
}: {
  warehouseId: string;
  warehouseName: string;
}) {
  const [picked, setPicked] = useState<Picked | null>(null);
  const [toLocation, setToLocation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [lastMoveId, setLastMoveId] = useState<string | null>(null); // ไว้พิมพ์ใบย้ายล่าสุด

  const lookingRef = useRef(false);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3500);
  }, []);

  // สแกน/พิมพ์รหัส → หาสินค้า → ตั้งเป็นรายการที่จะย้าย
  const handleScan = useCallback(
    async (code: string) => {
      if (lookingRef.current) return;
      lookingRef.current = true;
      setError(null);
      try {
        const res = await lookupForMove({ warehouseId, code });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        const p = res.product;
        setPicked({
          lineKey: newLineKey(),
          productId: p.id,
          sku: p.sku,
          name: p.name,
          onHand: p.onHand,
          location: p.location,
        });
        setToLocation("");
      } catch {
        setError("ค้นหาสินค้าไม่สำเร็จ ลองอีกครั้ง");
      } finally {
        lookingRef.current = false;
      }
    },
    [warehouseId],
  );

  const clearPicked = useCallback(() => {
    setPicked(null);
    setToLocation("");
    setError(null);
  }, []);

  const doMove = useCallback(async () => {
    if (busy || !picked) return;
    const to = toLocation.trim();
    if (!to) {
      setError("กรุณากรอกตำแหน่งใหม่");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await moveLocation({
        warehouseId,
        productId: picked.productId,
        toLocation: to,
        lineKey: picked.lineKey,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      showToast(`ย้าย ${picked.name} ไป ${res.location} แล้ว`);
      setLastMoveId(res.moveId); // เก็บไว้พิมพ์ใบย้าย
      // พร้อมสแกนตัวถัดไป
      setPicked(null);
      setToLocation("");
    } catch {
      setError("ย้ายตำแหน่งไม่สำเร็จ ลองอีกครั้ง");
    } finally {
      setBusy(false);
    }
  }, [busy, picked, toLocation, warehouseId, showToast]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* กล่องสแกน */}
      <div className="dc-card" style={{ padding: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, color: "var(--dc-ink, #1f2733)" }}>
          ยิงบาร์โค้ด หรือ พิมพ์รหัสสินค้า — ย้ายที่ในคลัง {warehouseName}
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

      {/* รายการที่จะย้าย */}
      {!picked ? (
        <div className="dc-card" style={{ textAlign: "center", padding: 28, color: "var(--dc-muted, #6b7785)" }}>
          ยังไม่มีรายการ — ยิงบาร์โค้ดหรือพิมพ์รหัสเพื่อเลือกสินค้า
        </div>
      ) : (
        <div className="dc-card" style={{ padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 19, fontWeight: 800, color: "var(--dc-ink, #1f2733)", lineHeight: 1.25 }}>
                {picked.name}
              </div>
              <div style={{ fontSize: 13, color: "var(--dc-muted, #6b7785)", marginTop: 2 }}>
                {picked.sku} · มีอยู่ {picked.onHand}
              </div>
            </div>
            <button
              type="button"
              onClick={clearPicked}
              aria-label="ยกเลิก"
              style={{
                background: "transparent",
                border: "none",
                color: "var(--dc-muted, #6b7785)",
                cursor: "pointer",
                padding: 6,
                flexShrink: 0,
              }}
            >
              <X size={20} />
            </button>
          </div>

          {/* ตำแหน่งปัจจุบัน */}
          <div
            style={{
              marginTop: 14,
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontSize: 15,
              color: "var(--dc-ink, #1f2733)",
            }}
          >
            <span style={{ color: "var(--dc-muted, #6b7785)", fontWeight: 600 }}>ตำแหน่งปัจจุบัน:</span>
            <span style={{ fontWeight: 800, fontSize: 18 }}>{picked.location ?? "— ยังไม่กำหนด"}</span>
          </div>

          {/* ตำแหน่งใหม่ */}
          <label
            style={{
              display: "block",
              marginTop: 16,
              fontSize: 14,
              fontWeight: 700,
              color: "var(--dc-muted, #6b7785)",
            }}
          >
            ตำแหน่งใหม่ (เช่น A-3)
            <input
              type="text"
              value={toLocation}
              onChange={(e) => setToLocation(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void doMove();
                }
              }}
              placeholder="A-3"
              autoFocus
              style={{
                display: "block",
                width: "100%",
                marginTop: 8,
                border: "1.5px solid var(--dc-line, #e6eaf0)",
                borderRadius: 12,
                padding: "14px 14px",
                fontSize: 18,
                fontWeight: 700,
                color: "var(--dc-ink, #1f2733)",
                background: "#fff",
                boxSizing: "border-box",
              }}
            />
          </label>

          {/* ปุ่มย้าย */}
          <button
            type="button"
            className="dc-btn-xl"
            onClick={doMove}
            disabled={busy || !toLocation.trim()}
            style={{ marginTop: 16 }}
          >
            <MoveRight size={20} />
            {busy
              ? "กำลังย้าย…"
              : toLocation.trim()
                ? `ย้ายไป ${toLocation.trim()}`
                : "ย้ายที่"}
          </button>
        </div>
      )}

      {/* พิมพ์ใบย้ายล่าสุด (โผล่หลังย้ายสำเร็จ) */}
      {lastMoveId && (
        <a
          href={`/dc/office/moves/${lastMoveId}/print`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, alignSelf: "center", minHeight: 46, padding: "0 20px", borderRadius: 12, border: "1.5px solid #c9d8f0", background: "linear-gradient(180deg,#f5f9ff,#eef3fb)", color: "#1d4ed8", fontSize: 15, fontWeight: 700, textDecoration: "none" }}
        >
          🖨️ พิมพ์ใบย้ายล่าสุด
        </a>
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
          <MoveRight size={18} /> {toast}
        </div>
      )}
    </div>
  );
}
