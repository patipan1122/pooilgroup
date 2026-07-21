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

// ★ handoff (จากหน้าสินค้า floor/office) — prefill สะดวก เท่านั้น (server re-resolve จริง)
import { readDcHandoff, clearDcHandoffs, PO_HANDOFF_KEY, PRODUCT_HANDOFF_KEY } from "@/lib/dc/handoff";

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
  poId: string | null; // Pinpoint #2 — บรรทัดนี้มาจากใบ PO ไหน (เบิกจากหลายใบพร้อมกัน) · null = เพิ่มเอง/สแกน
  poCode: string | null; // เลขใบ PO (โชว์ป้ายต่อบรรทัด)
};

// ใบ PO ที่กำลังอ้างอิง (สะสมได้หลายใบ — Pinpoint #2)
type SelectedPo = { poId: string; poCode: string; poTitle: string | null; poLineCount: number };

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
  const [selectedPos, setSelectedPos] = useState<SelectedPo[]>([]); // ใบ PO ที่อ้างอิง (สะสมหลายใบ · Pinpoint #2)
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
              poId: null,
              poCode: null,
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
            poId: null,
            poCode: null,
          },
        ];
      });
      return outcome;
    },
    [],
  );

  // รับผลจากตัวเลือกใบ PO → สะสมบรรทัดเบิก (เปิด picker หลายรอบ = เบิกจากหลายใบ · Pinpoint #2)
  //   match ตาม (productId + poId) → สินค้าเดียวกันจากคนละใบ = คนละบรรทัด (จำได้ว่ามาจากใบไหน)
  const handlePoConfirm = useCallback((sel: PoMoveSelection) => {
    setSelectedPos((prev) => {
      const lineCount = sel.poLineCount ?? sel.lines.length;
      if (prev.some((p) => p.poId === sel.poId)) {
        return prev.map((p) => (p.poId === sel.poId ? { ...p, poCode: sel.poCode, poTitle: sel.poTitle ?? null, poLineCount: lineCount } : p));
      }
      return [...prev, { poId: sel.poId, poCode: sel.poCode, poTitle: sel.poTitle ?? null, poLineCount: lineCount }];
    });
    setLines((prev) => {
      const next = [...prev];
      for (const pl of sel.lines) {
        const idx = next.findIndex((l) => l.productId === pl.productId && l.poId === sel.poId);
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
            poId: sel.poId,
            poCode: sel.poCode,
          });
        }
      }
      return next;
    });
  }, []);

  // ยกเลิกอ้างอิงใบ PO ใบเดียว → ลบบรรทัดที่มาจากใบนั้น + เอาใบออกจากรายการ
  const clearOnePo = useCallback((poId: string) => {
    setSelectedPos((prev) => prev.filter((p) => p.poId !== poId));
    setLines((prev) => prev.filter((l) => l.poId !== poId));
  }, []);

  // ยกเลิกอ้างอิงทุกใบ → ลบบรรทัดที่มาจากใบ PO ทั้งหมด (เก็บบรรทัดที่เพิ่มเอง/สแกนไว้)
  const clearPoRef = useCallback(() => {
    setSelectedPos([]);
    setLines((prev) => prev.filter((l) => l.poId == null));
  }, []);

  // ---- hydrate จาก handoff (หน้าสินค้า floor/office) ตอน mount ----
  //   PO handoff → handlePoConfirm(sel) เดิม · general product handoff → addPickedProduct loop (qty default 1)
  //   ★ prefill = convenience default เท่านั้น: postIssue re-fetch getPoFulfillment + guard on-hand จริงฝั่ง server
  //     → prefilled qty ไม่ authoritative (house rule money-preview-must-match-server)
  //   ★ กินเฉพาะของที่ฝากมาให้ "เบิก" เท่านั้น (readDcHandoff เช็ค intent ให้) — ของที่ฝากมาให้ "โอน" ปล่อยไว้
  //     กินแล้วล้างทั้ง 2 คีย์เสมอ (เดิม PO handoff return ทิ้ง product handoff ค้าง → ไป prefill งานอื่นทีหลัง)
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const sel = readDcHandoff<PoMoveSelection>(PO_HANDOFF_KEY, "issue");
      if (sel) {
        if (Array.isArray(sel.lines) && sel.lines.length > 0) {
          handlePoConfirm(sel);
        }
        clearDcHandoffs();
        return; // PO handoff ชนะ
      }
      const parsed = readDcHandoff<{ lines: { productId: string; sku: string; name: string; unit: string }[] }>(
        PRODUCT_HANDOFF_KEY,
        "issue",
      );
      if (parsed) {
        if (Array.isArray(parsed.lines)) {
          for (const l of parsed.lines) {
            // general handoff ไม่มียอดจริง → systemQty=0 (จอเตือน "มีอยู่ 0" · server เป็นคนตัดสิน)
            addPickedProduct({ productId: l.productId, sku: l.sku, name: l.name, unit: l.unit, category: null, systemQty: 0, imageUrl: null });
          }
        }
        clearDcHandoffs();
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
        poId: l.poId ?? undefined, // Pinpoint #2 — poId ต่อบรรทัด (เบิกจากหลายใบ) · server cap ต่อใบ
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
      if (res.posted > 0 && res.issueId) setLastIssueId(res.issueId); // เก็บไว้พิมพ์ใบเบิก

      if (failed.length === 0) {
        setLines([]);
        setSelectedPos([]);
        showToast(`เบิกออกแล้ว ${res.posted} รายการ`);
      } else {
        // เก็บเฉพาะบรรทัดที่ยังเบิกไม่สำเร็จไว้ให้แก้ไข
        const failedIds = new Set(res.failed.map((f) => f.productId));
        setLines((prev) => prev.filter((l) => failedIds.has(l.productId)));
        setSelectedPos((prev) => prev.filter((p) => lines.some((l) => l.poId === p.poId && failedIds.has(l.productId))));
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

      {/* กำลังเบิกจากใบ PO — สะสมได้หลายใบ (Pinpoint #2) */}
      {selectedPos.length > 0 && (
        <div
          className="dc-card"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            padding: "12px 14px",
            background: "var(--color-brand-50, #eef3fe)",
            border: "1.5px solid var(--color-brand-600, #2563eb)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <FileText size={18} color="var(--color-brand-700, #1d4ed8)" style={{ flexShrink: 0 }} />
              <span style={{ fontSize: 14.5, fontWeight: 800, color: "var(--color-brand-700, #1d4ed8)" }}>
                กำลังเบิกจาก {selectedPos.length} ใบ PO · รวม {lines.filter((l) => l.poId != null).length} รายการ ({totalQty} ชิ้น)
              </span>
            </div>
            {selectedPos.length > 1 && (
              <button
                type="button"
                onClick={clearPoRef}
                style={{ flexShrink: 0, border: "1.5px solid var(--color-brand-600, #2563eb)", background: "#fff", color: "var(--color-brand-700, #1d4ed8)", borderRadius: 10, padding: "6px 12px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
              >
                ล้างทุกใบ
              </button>
            )}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {selectedPos.map((po) => {
              const poLines = lines.filter((l) => l.poId === po.poId);
              const qty = poLines.reduce((s, l) => s + l.qty, 0);
              return (
                <span
                  key={po.poId}
                  style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#fff", border: "1.5px solid var(--color-brand-600, #2563eb)", borderRadius: 999, padding: "5px 6px 5px 12px" }}
                >
                  <span style={{ fontSize: 13, fontWeight: 800, color: "var(--color-brand-700, #1d4ed8)" }}>{po.poTitle ?? po.poCode}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--dc-muted, #6b7785)" }}>
                    หยิบ {poLines.length}/{po.poLineCount} ({qty} ชิ้น)
                  </span>
                  <button
                    type="button"
                    onClick={() => clearOnePo(po.poId)}
                    aria-label={`เอาใบ ${po.poCode} ออก`}
                    style={{ display: "grid", placeItems: "center", width: 22, height: 22, borderRadius: "50%", border: "none", background: "var(--color-brand-50, #eef3fe)", color: "var(--color-brand-700, #1d4ed8)", cursor: "pointer" }}
                  >
                    <X size={14} />
                  </button>
                </span>
              );
            })}
          </div>
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
                      {l.poCode && (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 5, padding: "2px 9px", borderRadius: 999, fontSize: 11.5, fontWeight: 700, background: "var(--color-brand-50, #eef3fe)", color: "var(--color-brand-700, #1d4ed8)", border: "1px solid var(--color-brand-600, #2563eb)" }}>
                          <FileText size={11} /> จาก {l.poCode}
                        </span>
                      )}
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
