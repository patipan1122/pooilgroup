"use client";

// DC · หน้าเบิกออก (client) — สแกน/พิมพ์รหัส → เพิ่มรายการ → นับจำนวนเบิก → ยืนยันเบิกออก.
//   • สแกน/พิมพ์รหัส → lookupForIssue → เพิ่มบรรทัด (มีอยู่แล้ว = +1)
//   • แต่ละบรรทัด: ชื่อ · โชว์ "มีอยู่ N" · stepper จำนวน · ช่อง "เหตุผล/เบิกไปไหน" (ไม่บังคับ) · ลบ
//   • เตือนแดงถ้า "จำนวนเบิก > มีอยู่" (จะเบิกไม่ผ่าน engine)
//   • ★ lineKey (uuid) สร้างตอน "เพิ่ม" บรรทัด → ยืนยันซ้ำ = no-op (idempotent)
//   • ปุ่มยืนยัน busy-lock กันกดซ้ำ · สำเร็จ → toast เขียว · โชว์รายการที่เบิกไม่ผ่านรายบรรทัด

import { useCallback, useEffect, useRef, useState } from "react";
import { Trash2, PackageMinus } from "lucide-react";
import { DcScanBox } from "@/components/dc/scan-box";
import { lookupForIssue, postIssue, type IssueLine } from "@/lib/dc/issue-actions";

type Line = {
  lineKey: string;
  productId: string;
  sku: string;
  name: string;
  unit: string;
  onHand: number;
  location: string | null;
  qty: number;
  reason: string;
};

// ★ บัฟเฟอร์รายการที่พิมพ์/ยิงไว้ใน localStorage แยกตามคลัง — กันลิสต์หายตอนรีเฟรช/เน็ตหลุด
const STORAGE_PREFIX = "dc.issue.";

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
  return `lk-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function IssueWorkspace({
  warehouseId,
  warehouseName,
}: {
  warehouseId: string;
  warehouseName: string;
}) {
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [lastIssueId, setLastIssueId] = useState<string | null>(null); // ไว้พิมพ์ใบเบิกล่าสุด
  // รายการที่เบิกไม่ผ่าน (เช่น สต๊อกไม่พอ) จากรอบล่าสุด — โชว์ให้ผู้ใช้รู้
  const [failedNotes, setFailedNotes] = useState<{ name: string; error: string }[]>([]);

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
      try {
        const res = await lookupForIssue({ warehouseId, code });
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
              location: p.location,
              qty: 1,
              reason: "",
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

  const setReason = useCallback((lineKey: string, reason: string) => {
    setLines((prev) => prev.map((l) => (l.lineKey === lineKey ? { ...l, reason } : l)));
  }, []);

  const removeLine = useCallback((lineKey: string) => {
    setLines((prev) => prev.filter((l) => l.lineKey !== lineKey));
  }, []);

  const totalQty = lines.reduce((s, l) => s + l.qty, 0);

  const confirm = useCallback(async () => {
    if (busy || lines.length === 0) return;
    setBusy(true);
    setError(null);
    setFailedNotes([]);
    try {
      const payload: IssueLine[] = lines.map((l) => ({
        productId: l.productId,
        qty: l.qty,
        reason: l.reason.trim() || undefined,
        lineKey: l.lineKey,
      }));
      const res = await postIssue({ warehouseId, lines: payload });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // map failed productId → ชื่อสินค้า (จาก lines ปัจจุบัน)
      const nameOf = new Map(lines.map((l) => [l.productId, l.name]));
      const failed = res.failed.map((f) => ({
        name: nameOf.get(f.productId) ?? f.productId,
        error: f.error,
      }));
      setFailedNotes(failed);
      if (res.posted > 0) setLastIssueId(res.issueId); // เก็บไว้พิมพ์ใบเบิก

      if (failed.length === 0) {
        setLines([]);
        showToast(`เบิกออกแล้ว ${res.posted} รายการ`);
      } else {
        // เก็บเฉพาะบรรทัดที่ยังเบิกไม่สำเร็จไว้ให้แก้ไข
        const failedIds = new Set(res.failed.map((f) => f.productId));
        setLines((prev) => prev.filter((l) => failedIds.has(l.productId)));
        showToast(`เบิกสำเร็จ ${res.posted} · ไม่ผ่าน ${failed.length}`);
      }
    } catch {
      setError("บันทึกเบิกออกไม่สำเร็จ ลองอีกครั้ง");
    } finally {
      setBusy(false);
    }
  }, [busy, lines, warehouseId, showToast]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* กล่องสแกน */}
      <div className="dc-card" style={{ padding: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, color: "var(--dc-ink, #1f2733)" }}>
          ยิงบาร์โค้ด หรือ พิมพ์รหัสสินค้า — เบิกออกจากคลัง {warehouseName}
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

      {/* รายการที่เบิกไม่ผ่าน (สต๊อกไม่พอ ฯลฯ) */}
      {failedNotes.length > 0 && (
        <div
          role="alert"
          style={{
            background: "#fff7ed",
            color: "#9a3412",
            border: "1px solid #fed7aa",
            borderRadius: 12,
            padding: "12px 14px",
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          <div style={{ marginBottom: 6, fontWeight: 700 }}>เบิกไม่ผ่าน {failedNotes.length} รายการ</div>
          <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
            {failedNotes.map((f, i) => (
              <li key={i}>
                {f.name} — {f.error}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* รายการเบิกออก */}
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
                      {l.location ? ` · ที่ ${l.location}` : ""}
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

                {/* stepper จำนวนเบิก */}
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
                    aria-label="จำนวนเบิกออก"
                  />
                  <button type="button" onClick={() => setQty(l.lineKey, l.qty + 1)} aria-label="เพิ่ม">
                    ＋
                  </button>
                </div>

                {/* เตือนสต๊อกไม่พอ */}
                {over && (
                  <div
                    style={{
                      marginTop: 8,
                      color: "#c0392b",
                      fontSize: 13,
                      fontWeight: 700,
                    }}
                  >
                    ⚠️ เบิก {l.qty} แต่มีอยู่แค่ {l.onHand} — จะเบิกไม่ผ่าน
                  </div>
                )}

                {/* เหตุผล / เบิกไปไหน (ไม่บังคับ) */}
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
                  <span style={{ whiteSpace: "nowrap" }}>เหตุผล/เบิกไปไหน</span>
                  <input
                    type="text"
                    value={l.reason}
                    onChange={(e) => setReason(l.lineKey, e.target.value)}
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
            );
          })}
        </div>
      )}

      {/* ยืนยันเบิกออก */}
      {lines.length > 0 && (
        <button
          type="button"
          className="dc-btn-xl dc-btn-xl--danger"
          onClick={confirm}
          disabled={busy}
        >
          <PackageMinus size={20} />
          {busy ? "กำลังบันทึก…" : `ยืนยันเบิกออก (${totalQty} ชิ้น)`}
        </button>
      )}

      {/* พิมพ์ใบเบิกล่าสุด (โผล่หลังเบิกสำเร็จ) */}
      {lastIssueId && (
        <a
          href={`/dc/office/issues/${lastIssueId}/print`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, alignSelf: "center", minHeight: 46, padding: "0 20px", borderRadius: 12, border: "1.5px solid #c9d8f0", background: "linear-gradient(180deg,#f5f9ff,#eef3fb)", color: "#1d4ed8", fontSize: 15, fontWeight: 700, textDecoration: "none" }}
        >
          🖨️ พิมพ์ใบเบิกล่าสุด
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
          <PackageMinus size={18} /> {toast}
        </div>
      )}
    </div>
  );
}
