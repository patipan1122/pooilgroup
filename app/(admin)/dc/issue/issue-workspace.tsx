"use client";

// DC · หน้าเบิกออก (client) — สแกน/พิมพ์รหัส → เพิ่มรายการ → นับจำนวนเบิก → ยืนยันเบิกออก.
//   • สแกน/พิมพ์รหัส → lookupForIssue → เพิ่มบรรทัด (มีอยู่แล้ว = +1)
//   • แต่ละบรรทัด: ชื่อ · โชว์ "มีอยู่ N" · stepper จำนวน · ช่อง "เหตุผล/เบิกไปไหน" (ไม่บังคับ) · ลบ
//   • เตือนแดงถ้า "จำนวนเบิก > มีอยู่" (จะเบิกไม่ผ่าน engine)
//   • ★ lineKey (uuid) สร้างตอน "เพิ่ม" บรรทัด → ยืนยันซ้ำ = no-op (idempotent)
//   • ปุ่มยืนยัน busy-lock กันกดซ้ำ · สำเร็จ → toast เขียว · โชว์รายการที่เบิกไม่ผ่านรายบรรทัด

import { useCallback, useEffect, useRef, useState } from "react";
import { Trash2, PackageMinus, List, Search, X, Plus, Check, ImageIcon, FileText } from "lucide-react";
import { DcScanBox } from "@/components/dc/scan-box";
import { DcThumb } from "@/components/dc/product-image";
import { PoMovePicker, type PoMoveSelection } from "@/components/dc/po-move-picker";
import { lookupForIssue, postIssue, type IssueLine } from "@/lib/dc/issue-actions";
import {
  listCategoriesForCount,
  listProductsForCount,
  type CountProductRow,
} from "@/lib/dc/count-actions";

// ★ handoff keys (จากหน้าสินค้า floor/office) — prefill สะดวก เท่านั้น (server re-resolve จริง)
const PO_HANDOFF_KEY = "dc.pohandoff";
const PRODUCT_HANDOFF_KEY = "dc.producthandoff";

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
  imageUrl: string | null; // รูปสินค้า (resolve แล้ว) — null = โชว์ไอคอน placeholder
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
  r2PublicUrl,
}: {
  warehouseId: string;
  warehouseName: string;
  r2PublicUrl?: string;
}) {
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [lastIssueId, setLastIssueId] = useState<string | null>(null); // ไว้พิมพ์ใบเบิกล่าสุด
  const [browseOpen, setBrowseOpen] = useState(false); // ป็อปอัป "ดูสินค้า / เลือกจากรายการ"
  const [poPickerOpen, setPoPickerOpen] = useState(false); // ตัวเลือก "เบิกเป็นใบ PO"
  const [selectedPoId, setSelectedPoId] = useState<string | null>(null);
  const [selectedPoCode, setSelectedPoCode] = useState<string | null>(null);
  const [selectedPoLineCount, setSelectedPoLineCount] = useState<number>(0); // จำนวนรายการ "ทั้งใบ" PO ที่อ้างอิง
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
              imageUrl: null, // สแกน/lookup ยังไม่คืนรูป → placeholder
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

  // กดเลือกจากป็อปอัป "ดูสินค้า" → เพิ่มบรรทัดแบบเดียวกับสแกน (มีอยู่แล้ว = +1).
  // คืน "added" / "exists" ให้ป็อปอัปโชว์สถานะปุ่ม. หมายเหตุ: listProductsForCount ไม่ส่ง
  // location มา → ใช้ null (สแกนตัวจริงจะเติม location ให้ · ตรงนี้เป็นแค่ตัวช่วยหาสินค้า).
  const addPickedProduct = useCallback(
    (p: CountProductRow): "added" | "exists" => {
      let outcome: "added" | "exists" = "added";
      setLines((prev) => {
        const idx = prev.findIndex((l) => l.productId === p.productId);
        if (idx >= 0) {
          outcome = "exists";
          const next = [...prev];
          next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
          return next;
        }
        return [
          ...prev,
          {
            lineKey: newLineKey(),
            productId: p.productId,
            sku: p.sku,
            name: p.name,
            unit: p.unit ?? "ชิ้น",
            onHand: p.systemQty,
            location: null,
            qty: 1,
            reason: "",
            imageUrl: p.imageUrl, // ดูสินค้า/browse มีรูปมาให้แล้ว
          },
        ];
      });
      return outcome;
    },
    [],
  );

  // รับผลจากตัวเลือกใบ PO → เติมบรรทัดเบิกตามจำนวนที่เลือก (มีอยู่แล้ว = ตั้งจำนวนใหม่) + จำ poId/poCode
  const handlePoConfirm = useCallback((sel: PoMoveSelection) => {
    setSelectedPoId(sel.poId);
    setSelectedPoCode(sel.poCode);
    setSelectedPoLineCount(sel.poLineCount ?? sel.lines.length); // fallback เผื่อ handoff เก่าไม่มีฟิลด์นี้
    setLines((prev) => {
      const next = [...prev];
      for (const pl of sel.lines) {
        const idx = next.findIndex((l) => l.productId === pl.productId);
        if (idx >= 0) {
          next[idx] = {
            ...next[idx],
            qty: pl.qty,
            onHand: Math.max(next[idx].onHand, pl.qty),
            imageUrl: pl.imageUrl ?? next[idx].imageUrl, // เติมรูปจากใบ PO ถ้ามี
          };
        } else {
          next.push({
            lineKey: newLineKey(),
            productId: pl.productId,
            sku: pl.sku,
            name: pl.name,
            unit: pl.unit,
            onHand: pl.qty,
            location: null,
            qty: pl.qty,
            reason: "",
            imageUrl: pl.imageUrl ?? null,
          });
        }
      }
      return next;
    });
  }, []);

  const clearPoRef = useCallback(() => {
    setSelectedPoId(null);
    setSelectedPoCode(null);
    setSelectedPoLineCount(0);
  }, []);

  // ---- hydrate จาก handoff (หน้าสินค้า floor/office) ตอน mount ----
  //   PO handoff → handlePoConfirm(sel) เดิม · general product handoff → addPickedProduct loop (qty default 1)
  //   ★ prefill = convenience default เท่านั้น: postIssue re-fetch getPoFulfillment + guard on-hand จริงฝั่ง server
  //     → prefilled qty ไม่ authoritative (house rule money-preview-must-match-server)
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const poRaw = window.sessionStorage.getItem(PO_HANDOFF_KEY);
      if (poRaw) {
        const sel = JSON.parse(poRaw) as PoMoveSelection;
        if (sel && Array.isArray(sel.lines) && sel.lines.length > 0) {
          handlePoConfirm(sel);
        }
        window.sessionStorage.removeItem(PO_HANDOFF_KEY);
        return; // PO handoff ชนะ
      }
      const prodRaw = window.sessionStorage.getItem(PRODUCT_HANDOFF_KEY);
      if (prodRaw) {
        const parsed = JSON.parse(prodRaw) as { lines: { productId: string; sku: string; name: string; unit: string }[] };
        if (parsed && Array.isArray(parsed.lines)) {
          for (const l of parsed.lines) {
            // general handoff ไม่มียอดจริง → systemQty=0 (จอเตือน "มีอยู่ 0" · server เป็นคนตัดสิน)
            addPickedProduct({ productId: l.productId, sku: l.sku, name: l.name, unit: l.unit, category: null, systemQty: 0, imageUrl: null });
          }
        }
        window.sessionStorage.removeItem(PRODUCT_HANDOFF_KEY);
      }
    } catch {
      /* handoff เสีย → เมินเงียบ */
    }
    // mount-once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      const res = await postIssue({ warehouseId, lines: payload, poId: selectedPoId || undefined });
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
      if (res.posted > 0 && res.issueId) setLastIssueId(res.issueId); // เก็บไว้พิมพ์ใบเบิก

      if (failed.length === 0) {
        setLines([]);
        setSelectedPoId(null);
        setSelectedPoCode(null);
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
  }, [busy, lines, warehouseId, showToast, selectedPoId]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* กล่องสแกน */}
      <div className="dc-card" style={{ padding: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, color: "var(--dc-ink, #1f2733)" }}>
          ยิงบาร์โค้ด หรือ พิมพ์รหัสสินค้า — เบิกออกจากคลัง {warehouseName}
        </div>
        <DcScanBox onScan={handleScan} placeholder="ยิงบาร์โค้ด / พิมพ์ SKU แล้วกด Enter…" />
        {/* หาสินค้าไม่เจอ/ไม่มีบาร์โค้ด → ไล่ดูจากรายการ (มีรูป + คงเหลือ) แล้วกดเลือก */}
        <button
          type="button"
          onClick={() => setBrowseOpen(true)}
          style={{
            marginTop: 10,
            width: "100%",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            minHeight: 46,
            borderRadius: 12,
            border: "1.5px solid var(--dc-line-strong, #c9d3e0)",
            background: "var(--dc-paper, #fff)",
            color: "var(--dc-ink, #1f2733)",
            fontSize: 15,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          <List size={18} /> ดูสินค้า / เลือกจากรายการ
        </button>
        <button
          type="button"
          onClick={() => setPoPickerOpen(true)}
          style={{
            marginTop: 10,
            width: "100%",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            minHeight: 46,
            borderRadius: 12,
            border: "1.5px solid var(--dc-line-strong, #c9d3e0)",
            background: "var(--dc-paper, #fff)",
            color: "var(--dc-ink, #1f2733)",
            fontSize: 15,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          <FileText size={18} /> เลือกจากใบ PO
        </button>
      </div>

      {/* กำลังเบิกจากใบ PO — banner + ยกเลิกอ้างอิง */}
      {selectedPoCode && (
        <div
          className="dc-card"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            padding: "12px 14px",
            background: "var(--color-brand-50, #eef3fe)",
            border: "1.5px solid var(--color-brand-600, #2563eb)",
          }}
        >
          <div style={{ display: "inline-flex", alignItems: "flex-start", gap: 8, minWidth: 0 }}>
            <FileText size={18} color="var(--color-brand-700, #1d4ed8)" style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14.5, fontWeight: 800, color: "var(--color-brand-700, #1d4ed8)" }}>
                กำลังเบิกจากใบ {selectedPoCode}
              </div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-brand-700, #1d4ed8)", opacity: 0.9, marginTop: 2 }}>
                ใบนี้มี {selectedPoLineCount} รายการ · หยิบมา {lines.length} รายการ ({totalQty} ชิ้น)
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={clearPoRef}
            style={{
              flexShrink: 0,
              border: "1.5px solid var(--color-brand-600, #2563eb)",
              background: "#fff",
              color: "var(--color-brand-700, #1d4ed8)",
              borderRadius: 10,
              padding: "6px 12px",
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            ยกเลิกอ้างอิงใบ
          </button>
        </div>
      )}

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
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10, minWidth: 0 }}>
                    <DcThumb url={l.imageUrl} alt={l.name} size={48} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 17, fontWeight: 700, color: "var(--dc-ink, #1f2733)", lineHeight: 1.25 }}>
                        {l.name}
                      </div>
                      <div style={{ fontSize: 13, color: "var(--dc-muted, #6b7785)", marginTop: 2 }}>
                        {l.sku} · มีอยู่ {l.onHand} {l.unit}
                        {l.location ? ` · ที่ ${l.location}` : ""}
                      </div>
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

      {/* ป็อปอัป "ดูสินค้า / เลือกจากรายการ" — ไล่ดูสินค้า (มีรูป + คงเหลือ) แล้วกดเลือกเข้าใบเบิก */}
      {browseOpen && (
        <BrowseProductsSheet
          warehouseId={warehouseId}
          warehouseName={warehouseName}
          inSheetIds={new Set(lines.map((l) => l.productId))}
          onClose={() => setBrowseOpen(false)}
          onPick={addPickedProduct}
        />
      )}

      {/* ตัวเลือก "เบิกเป็นใบ PO" */}
      <PoMovePicker
        open={poPickerOpen}
        onClose={() => setPoPickerOpen(false)}
        warehouseId={warehouseId}
        r2PublicUrl={r2PublicUrl || undefined}
        mode="issue"
        onConfirm={handlePoConfirm}
      />

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

// ====================================================================
// ป็อปอัป "ดูสินค้า / เลือกจากรายการ" — เดียวกับหน้านับสต๊อก (BrowseProductsSheet)
//   • reuse listProductsForCount (มีรูป + คงเหลือ + ซ่อนของหมด = ถูกต้องสำหรับเบิก:
//     เบิกของที่ไม่มีในสต๊อกไม่ได้อยู่แล้ว)
//   • กดเลือก → onPick → เพิ่มบรรทัดเบิก (เหมือนสแกน · มีอยู่แล้ว = +1)
// ====================================================================

function BrowseProductsSheet({
  warehouseId,
  warehouseName,
  inSheetIds,
  onClose,
  onPick,
}: {
  warehouseId: string;
  warehouseName: string;
  inSheetIds: Set<string>;
  onClose: () => void;
  onPick: (p: CountProductRow) => "added" | "exists";
}) {
  const [cats, setCats] = useState<string[]>([]);
  const [activeCat, setActiveCat] = useState<string>(""); // "" = ทุกหมวด
  const [q, setQ] = useState("");
  const [products, setProducts] = useState<CountProductRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // optimistic: id ที่เพิ่งกดเลือก (ก่อน parent ส่ง inSheetIds กลับมา)
  const [justAdded, setJustAdded] = useState<Set<string>>(new Set());

  // โหลดหมวดหมู่ครั้งเดียวตอนเปิด
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const list = await listCategoriesForCount();
      if (!cancelled) setCats(list);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // โหลดสินค้า (debounce ค้นหา) ทุกครั้งที่ category/q เปลี่ยน
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const t = setTimeout(() => {
      void (async () => {
        const res = await listProductsForCount({
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

  const handlePick = (p: CountProductRow) => {
    onPick(p);
    setJustAdded((prev) => new Set(prev).add(p.productId));
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="ดูสินค้า — เลือกสินค้าที่จะเบิกออก"
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
          maxHeight: "90vh",
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 -8px 34px rgba(20,40,90,0.22)",
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
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 17, color: "var(--dc-ink, #1f2733)" }}>ดูสินค้า</div>
            <div style={{ fontSize: 12.5, color: "var(--dc-muted, #6b7785)" }}>
              คลัง {warehouseName} · กดเลือกสินค้าที่จะเบิกออก
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

        {/* search */}
        <div style={{ padding: "12px 16px 8px" }}>
          <div style={{ position: "relative" }}>
            <Search
              size={17}
              style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--dc-subtle, #9aa4b2)" }}
            />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="ค้นหาชื่อ / รหัส / บาร์โค้ด…"
              style={{
                width: "100%",
                padding: "11px 12px 11px 36px",
                borderRadius: 12,
                border: "1.5px solid var(--dc-line-strong, #c9d3e0)",
                fontSize: 15,
                color: "var(--dc-ink, #1f2733)",
                outline: "none",
              }}
            />
          </div>
        </div>

        {/* category chips */}
        {cats.length > 0 && (
          <div
            style={{
              display: "flex",
              gap: 8,
              overflowX: "auto",
              padding: "4px 16px 12px",
              WebkitOverflowScrolling: "touch",
            }}
          >
            <CatChip label="ทุกหมวด" active={activeCat === ""} onClick={() => setActiveCat("")} />
            {cats.map((c) => (
              <CatChip key={c} label={c} active={activeCat === c} onClick={() => setActiveCat(c)} />
            ))}
          </div>
        )}

        {/* product table */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 8px 8px" }}>
          {loading ? (
            <div style={{ textAlign: "center", padding: 28, color: "var(--dc-muted, #6b7785)", fontSize: 14 }}>กำลังโหลด…</div>
          ) : error ? (
            <div style={{ textAlign: "center", padding: 28, color: "#c0392b", fontSize: 14 }}>{error}</div>
          ) : products.length === 0 ? (
            <div style={{ textAlign: "center", padding: 28, color: "var(--dc-muted, #6b7785)", fontSize: 14 }}>
              ไม่พบสินค้า{q.trim() ? ` ที่ตรงกับ “${q.trim()}”` : " ที่มีของในคลังนี้"}
            </div>
          ) : (
            <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 460 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", paddingLeft: 14, fontSize: 12, color: "var(--dc-muted, #6b7785)", fontWeight: 700, padding: "8px 12px" }}>สินค้า</th>
                    <th style={{ textAlign: "right", fontSize: 12, color: "var(--dc-muted, #6b7785)", fontWeight: 700, padding: "8px 12px" }}>มีอยู่</th>
                    <th style={{ width: 96, textAlign: "center" }} aria-label="เลือก" />
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) => {
                    const added = inSheetIds.has(p.productId) || justAdded.has(p.productId);
                    return (
                      <tr key={p.productId}>
                        <td style={{ padding: "8px 12px", borderBottom: "1px solid var(--dc-line, #e6eaf0)", minWidth: 180 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <Thumb url={p.imageUrl} />
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 650, fontSize: 14.5, color: "var(--dc-ink, #1f2733)", lineHeight: 1.25 }}>{p.name}</div>
                              <div style={{ fontSize: 12.5, color: "var(--dc-muted, #6b7785)", marginTop: 1 }}>
                                {p.sku}
                                {p.category ? ` · ${p.category}` : ""}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td
                          style={{
                            padding: "10px 12px",
                            borderBottom: "1px solid var(--dc-line, #e6eaf0)",
                            textAlign: "right",
                            whiteSpace: "nowrap",
                            fontWeight: 600,
                            color: "var(--dc-ink, #1f2733)",
                          }}
                        >
                          {p.systemQty}
                          {p.unit ? (
                            <span style={{ color: "var(--dc-muted, #6b7785)", fontWeight: 400, fontSize: 12.5 }}> {p.unit}</span>
                          ) : null}
                        </td>
                        <td style={{ padding: "10px 12px", borderBottom: "1px solid var(--dc-line, #e6eaf0)", textAlign: "center" }}>
                          <button
                            type="button"
                            onClick={() => handlePick(p)}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 5,
                              padding: "8px 12px",
                              borderRadius: 10,
                              border: "none",
                              cursor: "pointer",
                              fontWeight: 700,
                              fontSize: 13.5,
                              background: added ? "var(--dc-canvas, #f1f4f9)" : "var(--color-brand-600, #2563eb)",
                              color: added ? "var(--dc-muted, #6b7785)" : "#fff",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {added ? (
                              <>
                                <Check size={15} /> ในใบแล้ว
                              </>
                            ) : (
                              <>
                                <Plus size={15} /> เบิก
                              </>
                            )}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* footer */}
        <div style={{ padding: "10px 16px 16px", borderTop: "1px solid var(--dc-line, #e6eaf0)" }}>
          <button type="button" className="dc-btn-xl" onClick={onClose}>
            เสร็จ — กลับไปเบิก
          </button>
        </div>
      </div>
    </div>
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
        border: active ? "1.5px solid var(--color-brand-600, #2563eb)" : "1.5px solid var(--dc-line, #e6eaf0)",
        background: active ? "var(--color-brand-600, #2563eb)" : "var(--dc-paper, #fff)",
        color: active ? "#fff" : "var(--dc-muted, #6b7785)",
      }}
    >
      {label}
    </button>
  );
}

// รูปสินค้าเล็ก (fallback ไอคอนถ้าไม่มีรูป)
function Thumb({ url, size = 40 }: { url?: string | null; size?: number }) {
  return (
    <span
      aria-hidden
      style={{
        flexShrink: 0,
        width: size,
        height: size,
        borderRadius: 8,
        overflow: "hidden",
        background: "var(--dc-canvas, #f1f4f9)",
        border: "1px solid var(--dc-line, #e6eaf0)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        <ImageIcon size={Math.round(size * 0.42)} color="var(--dc-subtle, #9aa4b2)" />
      )}
    </span>
  );
}
