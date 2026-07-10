"use client";

// DC · นับสต๊อก — client workspace (OFFLINE-capable)
//
// ★ หน้าเดียวที่ต้องทำงานตอนเน็ตหลุด (back-of-house). กลไก:
//   1. ทุกบรรทัดนับมี lineKey = crypto.randomUUID() (stable id ฝั่ง client)
//   2. บัฟเฟอร์ทั้งหมดเก็บใน localStorage แยกตาม warehouseId
//   3. ONLINE: ยิง/พิมพ์รหัส → lookupForCount ทันที (รู้ชื่อ + ยอดในระบบ)
//      OFFLINE: เก็บแค่ code ไว้ → ค่อย resolve ชื่อ/ยอดตอนซิงค์
//   4. "บันทึกใบนับ" → saveCountSheet(); สร้างเอกสาร "ใบนับ" (เลขที่+ใครนับ+หมายเหตุ) +
//      ปรับสต๊อก. server idempotent ผ่าน sourceKey("count", lineKey) → ยิงซ้ำปลอดภัย.
//      รัน auto (silent) ตอนกลับมา online (window 'online' event)
//   5. badge "ออฟไลน์ — เก็บในเครื่อง N รายการ" เมื่อ offline หรือมีของยังไม่ซิงค์
//
// ★ เพิ่มใหม่ (CEO #5 — อย่าบังคับนับทั้งหมด):
//   • filter หมวดหมู่ (category) + ปุ่ม "ดูสินค้าทั้งหมด" → ตารางสินค้าให้กดเลือกเองว่าจะนับอะไร
//   • กดเลือกจากตาราง = เพิ่มบรรทัดนับเหมือนสแกน (addProductLine ทางเดียวกัน)
//   • ฟีเจอร์ browse/หมวดหมู่ = online-only (ต้องถาม server) → offline ก็ยังสแกน+บัฟเฟอร์ได้ปกติ
//   • รายการนับ = ตารางอ่านง่าย (สินค้า | ระบบมี | นับได้ | ส่วนต่าง)

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CloudOff, Save, Trash2, Check, List, Search, X, Plus, ImageIcon, CheckCheck } from "lucide-react";
import { DcScanBox } from "@/components/dc/scan-box";
import {
  lookupForCount,
  saveCountSheet,
  listCategoriesForCount,
  listProductsForCount,
  type CountProductRow,
} from "@/lib/dc/count-actions";

type CountLine = {
  lineKey: string;
  code: string;
  productId: string | null; // null = ยังไม่ resolve (offline)
  name: string | null;
  unit: string | null;
  systemQty: number | null; // ยอดในระบบ ณ ตอน lookup (null = ยังไม่รู้)
  countedQty: number;
  resolving: boolean; // กำลัง lookup อยู่ (online)
  imageUrl?: string | null; // รูปสินค้า (จากตาราง "ดูสินค้าทั้งหมด") — โชว์รูปเล็กในแถวนับ
};

const STORAGE_PREFIX = "dc.count.buffer.";

function storageKey(warehouseId: string): string {
  return `${STORAGE_PREFIX}${warehouseId}`;
}

function loadBuffer(warehouseId: string): CountLine[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(warehouseId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // sanitize: บังคับ shape + ปิด resolving ที่ค้างจาก session ก่อน
    return parsed
      .filter((l): l is CountLine => !!l && typeof (l as CountLine).lineKey === "string")
      .map((l) => ({ ...l, resolving: false }));
  } catch {
    return [];
  }
}

function saveBuffer(warehouseId: string, lines: CountLine[]): void {
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
  return `lk_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function CountWorkspace({
  warehouseId,
  warehouseName,
}: {
  warehouseId: string;
  warehouseName: string;
}) {
  const [lines, setLines] = useState<CountLine[]>([]);
  const [note, setNote] = useState("");
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const [savedCode, setSavedCode] = useState<string | null>(null); // เลขที่ใบนับที่เพิ่งบันทึก
  const [browseOpen, setBrowseOpen] = useState(false);
  const linesRef = useRef<CountLine[]>([]);
  const noteRef = useRef("");
  const syncingRef = useRef(false);
  noteRef.current = note;

  // keep refs in sync (เพื่อให้ event handler/auto-sync เห็นค่าล่าสุด)
  linesRef.current = lines;

  // ---- โหลด buffer + ตั้ง online state ตอน mount ----
  useEffect(() => {
    setLines(loadBuffer(warehouseId));
    if (typeof navigator !== "undefined") setOnline(navigator.onLine);
  }, [warehouseId]);

  // ---- persist ทุกครั้งที่ buffer เปลี่ยน ----
  useEffect(() => {
    saveBuffer(warehouseId, lines);
  }, [warehouseId, lines]);

  const updateLine = useCallback((lineKey: string, patch: Partial<CountLine>) => {
    setLines((prev) => prev.map((l) => (l.lineKey === lineKey ? { ...l, ...patch } : l)));
  }, []);

  const removeLine = useCallback((lineKey: string) => {
    setLines((prev) => prev.filter((l) => l.lineKey !== lineKey));
  }, []);

  // ---- บันทึกใบนับ (สร้างเอกสาร "ใบนับ" + ปรับสต๊อก) ----
  //   silent=true → auto ตอนกลับมา online (ไม่เด้ง error ถ้าไม่มีรายการพร้อม)
  const doSave = useCallback(async (silent = false): Promise<void> => {
    if (syncingRef.current) return;
    const current = linesRef.current;
    // ส่งเฉพาะบรรทัดที่ resolve แล้ว (มี productId) — offline ที่ยังไม่ resolve ส่งไม่ได้
    const ready = current.filter((l) => l.productId && Number.isFinite(l.countedQty));
    if (ready.length === 0) {
      if (!silent) setToast({ kind: "err", msg: "ไม่มีรายการพร้อมบันทึก (บางรายการยังหาสินค้าไม่เจอ)" });
      return;
    }
    syncingRef.current = true;
    setSyncing(true);
    try {
      const res = await saveCountSheet({
        warehouseId,
        note: noteRef.current.trim() || null,
        lines: ready.map((l) => ({
          productId: l.productId as string,
          countedQty: l.countedQty,
          lineKey: l.lineKey,
        })),
      });
      if (!res.ok) {
        setToast({ kind: "err", msg: res.error });
        return;
      }
      const syncedSet = new Set(res.synced);
      setLines((prev) => prev.filter((l) => !syncedSet.has(l.lineKey)));
      setNote("");
      setSavedCode(res.countCode);
      setToast({
        kind: "ok",
        msg: res.countCode
          ? `บันทึกใบนับ ${res.countCode} แล้ว (${res.synced.length} รายการ)`
          : `บันทึกแล้ว ${res.synced.length} รายการ`,
      });
    } catch (e) {
      setToast({ kind: "err", msg: e instanceof Error ? e.message : "บันทึกไม่สำเร็จ" });
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [warehouseId]);

  // ---- online/offline listeners + auto-sync ตอนกลับมา online ----
  useEffect(() => {
    function handleOnline() {
      setOnline(true);
      // กลับมา online → บันทึกใบนับอัตโนมัติ (silent) ถ้ามีของค้าง
      if (linesRef.current.some((l) => l.productId)) void doSave(true);
    }
    function handleOffline() {
      setOnline(false);
    }
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [doSave]);

  // ---- auto-dismiss toast ----
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  // ---- เพิ่มบรรทัดนับจากสินค้าที่ resolve แล้ว (ใช้ร่วมกันทั้งสแกน online + กดเลือกจากตาราง) ----
  // ★ tap-add จากตาราง = สแกน-add: สร้างบรรทัดนับด้วย productId + systemQty (ค่าเริ่ม countedQty = systemQty)
  const addProductLine = useCallback(
    (p: { productId: string; sku: string; name: string; unit: string | null; systemQty: number; imageUrl?: string | null }): "added" | "exists" => {
      const exists = linesRef.current.find((l) => l.productId === p.productId);
      if (exists) {
        setToast({ kind: "ok", msg: `มีรายการ "${p.name}" อยู่แล้ว — แก้จำนวนได้เลย` });
        return "exists";
      }
      const line: CountLine = {
        lineKey: newLineKey(),
        code: p.sku,
        productId: p.productId,
        name: p.name,
        unit: p.unit,
        systemQty: p.systemQty,
        countedQty: p.systemQty, // default = ยอดในระบบ
        resolving: false,
        imageUrl: p.imageUrl ?? null,
      };
      setLines((prev) => [line, ...prev]);
      return "added";
    },
    [],
  );

  // ---- เพิ่มบรรทัดจากการยิง/พิมพ์รหัส ----
  const onScan = useCallback(
    async (code: string) => {
      const c = code.trim();
      if (!c) return;

      // ถ้ามีบรรทัด code เดิมที่ยังไม่ resolve อยู่แล้ว → โฟกัสนับเพิ่ม (กันซ้ำ)
      const existing = linesRef.current.find(
        (l) => l.code.toLowerCase() === c.toLowerCase(),
      );
      if (existing) {
        setToast({ kind: "ok", msg: `มีรายการ "${existing.name ?? c}" อยู่แล้ว — แก้จำนวนได้เลย` });
        return;
      }

      const lineKey = newLineKey();
      const base: CountLine = {
        lineKey,
        code: c,
        productId: null,
        name: null,
        unit: null,
        systemQty: null,
        countedQty: 0,
        resolving: false,
      };

      if (typeof navigator !== "undefined" && navigator.onLine) {
        // ONLINE → resolve ทันที
        setLines((prev) => [{ ...base, resolving: true }, ...prev]);
        const res = await lookupForCount({ warehouseId, code: c });
        if (res.ok) {
          updateLine(lineKey, {
            productId: res.product.id,
            name: res.product.name,
            unit: res.product.unit,
            systemQty: res.product.systemQty,
            countedQty: res.product.systemQty, // default = ยอดในระบบ
            resolving: false,
          });
        } else {
          // หาไม่เจอ → เก็บเป็นบรรทัด code ดิบ (offline-style) ให้นับ + เตือน
          updateLine(lineKey, { resolving: false });
          setToast({ kind: "err", msg: res.error });
        }
      } else {
        // OFFLINE → เก็บ code ไว้ก่อน resolve ตอนซิงค์
        setLines((prev) => [base, ...prev]);
      }
    },
    [warehouseId, updateLine],
  );

  // จำนวนที่ยังไม่ซิงค์ (= ทั้ง buffer) + จำนวนที่ยัง resolve ไม่ได้
  const unsynced = lines.length;
  const unresolved = useMemo(() => lines.filter((l) => !l.productId).length, [lines]);
  const showOfflineBadge = !online || unsynced > 0;
  // set ของ productId ที่อยู่ในชีตแล้ว → ใช้ทำ state "เลือกแล้ว" ในตารางเลือกสินค้า
  const inSheetIds = useMemo(
    () => new Set(lines.map((l) => l.productId).filter((id): id is string => !!id)),
    [lines],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* ---- แถบสถานะ + scan ---- */}
      <div className="dc-card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>ยิง/พิมพ์รหัสสินค้าเพื่อนับ</div>
          {showOfflineBadge && (
            <span className="dc-offline-badge">
              <CloudOff size={13} />
              {online
                ? `เก็บในเครื่อง ${unsynced} รายการ — ยังไม่ซิงค์`
                : `ออฟไลน์ — เก็บในเครื่อง ${unsynced} รายการ`}
            </span>
          )}
        </div>
        <DcScanBox onScan={onScan} placeholder="ยิงบาร์โค้ด / พิมพ์รหัสสินค้า แล้วกด Enter…" />

        {/* ปุ่มดูสินค้าทั้งหมด — เลือกเองว่าจะนับอะไร (online เท่านั้น) */}
        <button
          type="button"
          className="dc-btn-xl dc-btn-xl--ghost"
          disabled={!online}
          onClick={() => setBrowseOpen(true)}
          title={online ? undefined : "ดูสินค้าทั้งหมดต้องต่อเน็ต"}
        >
          <List size={20} />
          ดูสินค้าทั้งหมด — เลือกสินค้าที่จะนับเอง
        </button>
        {!online && (
          <div style={{ fontSize: 13, color: "var(--dc-muted)", lineHeight: 1.5 }}>
            เน็ตหลุดอยู่ — นับต่อได้เลย (ยิง/พิมพ์รหัส) ระบบเก็บไว้ในเครื่อง พอเน็ตกลับมาจะซิงค์ให้อัตโนมัติ
            <br />
            <span style={{ fontSize: 12.5 }}>(ปุ่ม “ดูสินค้าทั้งหมด” ใช้ได้ตอนต่อเน็ต)</span>
          </div>
        )}
      </div>

      {/* ---- รายการนับ (ตาราง: สินค้า | ระบบมี | นับได้ | ส่วนต่าง) ---- */}
      {lines.length === 0 ? (
        <div className="dc-card" style={{ textAlign: "center", padding: 28, color: "var(--dc-muted)" }}>
          ยังไม่มีรายการนับ — ยิงรหัสสินค้า หรือกด “ดูสินค้าทั้งหมด” เพื่อเลือกสินค้าที่จะนับ
        </div>
      ) : (
        <CountSheet lines={lines} onChangeQty={updateLine} onRemove={removeLine} />
      )}

      {/* ---- หมายเหตุ + ปุ่มบันทึกใบนับ ---- */}
      {lines.length > 0 && (
        <div className="dc-card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--dc-ink)" }}>หมายเหตุ (ไม่บังคับ)</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="เช่น นับรอบสิ้นเดือน / นับหลังจัดชั้น…"
              maxLength={200}
              style={{
                width: "100%",
                padding: "11px 12px",
                borderRadius: 11,
                border: "1.5px solid var(--dc-line-strong, var(--dc-line))",
                fontSize: 15,
                color: "var(--dc-ink)",
                background: "var(--dc-paper)",
                outline: "none",
              }}
            />
          </label>
          <button
            type="button"
            className="dc-btn-xl"
            disabled={syncing || !online || lines.every((l) => !l.productId)}
            onClick={() => void doSave()}
          >
            <Save size={20} className={syncing ? "dc-spin" : undefined} />
            {syncing ? "กำลังบันทึก…" : `บันทึกใบนับ (${unsynced})`}
          </button>
          <div style={{ fontSize: 12.5, color: "var(--dc-muted)", textAlign: "center", lineHeight: 1.5 }}>
            บันทึกแล้วจะได้ “ใบนับ” 1 ใบ (มีเลขที่ · ใครนับ · ส่วนต่างขาด/เกิน) ปรับสต๊อกให้ตรงกับที่นับได้
          </div>
        </div>
      )}
      {savedCode && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "12px 14px",
            borderRadius: 12,
            background: "#eaf6ee",
            border: "1.5px solid #bfe3cb",
            color: "#1f6b3e",
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          <Check size={17} />
          <span>
            บันทึกใบนับ <strong>{savedCode}</strong> เรียบร้อย —{" "}
            <a href="/dc/count/history" style={{ color: "#1f6b3e", textDecoration: "underline", fontWeight: 700 }}>
              ดูประวัติใบนับ
            </a>
          </span>
        </div>
      )}
      {!online && lines.length > 0 && (
        <div style={{ fontSize: 13, color: "var(--dc-muted)", textAlign: "center" }}>
          บันทึกไม่ได้ตอนนี้ (ออฟไลน์) — พอเน็ตกลับมาจะบันทึกให้เอง หรือกดบันทึกเองได้
        </div>
      )}
      {online && unresolved > 0 && (
        <div style={{ fontSize: 13, color: "#b07b15", textAlign: "center" }}>
          มี {unresolved} รายการที่ยังหาสินค้าไม่เจอ — ระบบจะข้ามตอนซิงค์ จนกว่าจะแก้รหัสให้ถูก
        </div>
      )}

      {/* ---- ป็อปอัป "ดูสินค้าทั้งหมด" (เลือกสินค้าที่จะนับ) ---- */}
      {browseOpen && (
        <BrowseProductsSheet
          warehouseId={warehouseId}
          warehouseName={warehouseName}
          inSheetIds={inSheetIds}
          onClose={() => setBrowseOpen(false)}
          onPick={(p) => addProductLine(p)}
        />
      )}

      {/* ---- toast ---- */}
      {toast && (
        <div
          role="status"
          style={{
            position: "fixed",
            left: "50%",
            bottom: 24,
            transform: "translateX(-50%)",
            zIndex: 9999,
            background: toast.kind === "ok" ? "#1f8a4c" : "#c0392b",
            color: "#fff",
            padding: "12px 20px",
            borderRadius: 12,
            fontSize: 15,
            fontWeight: 600,
            boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
            maxWidth: "90vw",
          }}
        >
          {toast.msg}
        </div>
      )}

      {/* spinner keyframes (scoped inline) */}
      <style>{`@keyframes dc-spin{to{transform:rotate(360deg)}}.dc-spin{animation:dc-spin .8s linear infinite}`}</style>
    </div>
  );
}

// ====================================================================
// รายการนับ = ตารางอ่านง่าย (mobile: เลื่อนแนวนอนได้)
// ====================================================================
function CountSheet({
  lines,
  onChangeQty,
  onRemove,
}: {
  lines: CountLine[];
  onChangeQty: (lineKey: string, patch: Partial<CountLine>) => void;
  onRemove: (lineKey: string) => void;
}) {
  return (
    <div className="dc-card" style={{ padding: 0, overflow: "hidden" }}>
      {/* wrapper เลื่อนแนวนอนบนมือถือ */}
      <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
          <thead>
            <tr>
              <Th style={{ textAlign: "left", paddingLeft: 14 }}>สินค้า</Th>
              <Th style={{ textAlign: "right" }}>ระบบมี</Th>
              <Th style={{ textAlign: "center", minWidth: 168 }}>นับได้</Th>
              <Th style={{ textAlign: "right" }}>ส่วนต่าง</Th>
              <Th style={{ width: 48 }} aria-label="ลบ" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <CountSheetRow
                key={l.lineKey}
                line={l}
                onChangeQty={(q) => onChangeQty(l.lineKey, { countedQty: q })}
                onRemove={() => onRemove(l.lineKey)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children, style, ...rest }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      {...rest}
      style={{
        fontSize: 12.5,
        fontWeight: 700,
        color: "var(--dc-muted)",
        padding: "11px 12px",
        borderBottom: "1.5px solid var(--dc-line)",
        whiteSpace: "nowrap",
        background: "var(--dc-canvas)",
        ...style,
      }}
    >
      {children}
    </th>
  );
}

function CountSheetRow({
  line,
  onChangeQty,
  onRemove,
}: {
  line: CountLine;
  onChangeQty: (q: number) => void;
  onRemove: () => void;
}) {
  const resolved = !!line.productId;
  const variance = line.systemQty !== null ? line.countedQty - line.systemQty : null;
  const varianceColor =
    variance === null
      ? "var(--dc-muted)"
      : variance > 0
        ? "#1f8a4c"
        : variance < 0
          ? "#c0392b"
          : "var(--dc-muted)";

  const step = (delta: number) => onChangeQty(Math.max(0, line.countedQty + delta));

  const tdBase: React.CSSProperties = {
    padding: "10px 12px",
    borderBottom: "1px solid var(--dc-line)",
    fontSize: 14.5,
    verticalAlign: "middle",
  };

  return (
    <tr>
      {/* สินค้า */}
      <td style={{ ...tdBase, paddingLeft: 12, minWidth: 180 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Thumb url={line.imageUrl} size={38} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, color: "var(--dc-ink)", lineHeight: 1.25 }}>
              {line.name ?? line.code}
              {!resolved && (
                <span style={{ marginLeft: 6, fontSize: 11.5, fontWeight: 700, color: "#b07b15" }}>
                  · รอหาตอนซิงค์
                </span>
              )}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--dc-muted)", marginTop: 1 }}>
              รหัส {line.code}
            </div>
          </div>
        </div>
      </td>

      {/* ระบบมี */}
      <td style={{ ...tdBase, textAlign: "right", whiteSpace: "nowrap", color: "var(--dc-ink)", fontWeight: 600 }}>
        {line.systemQty !== null ? line.systemQty : "—"}
        {line.systemQty !== null && line.unit ? (
          <span style={{ color: "var(--dc-muted)", fontWeight: 400, fontSize: 12.5 }}> {line.unit}</span>
        ) : null}
      </td>

      {/* นับได้ — stepper ใหญ่ */}
      <td style={{ ...tdBase, textAlign: "center" }}>
        <div className="dc-qty" style={{ justifyContent: "center" }}>
          <button type="button" onClick={() => step(-1)} aria-label="ลด">
            −
          </button>
          <input
            inputMode="numeric"
            value={line.countedQty}
            onChange={(e) => {
              const n = parseInt(e.target.value.replace(/[^\d]/g, ""), 10);
              onChangeQty(Number.isFinite(n) ? n : 0);
            }}
            aria-label="จำนวนที่นับได้"
            style={{ maxWidth: 72 }}
          />
          <button type="button" onClick={() => step(1)} aria-label="เพิ่ม">
            ＋
          </button>
        </div>
      </td>

      {/* ส่วนต่าง (ขาด − / เกิน +) */}
      <td style={{ ...tdBase, textAlign: "right", whiteSpace: "nowrap", fontWeight: 700, color: varianceColor }}>
        {variance === null ? (
          "—"
        ) : variance === 0 ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
            <Check size={14} /> ตรง
          </span>
        ) : (
          <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", lineHeight: 1.15 }}>
            <span>{`${variance > 0 ? "+" : ""}${variance}`}</span>
            <span style={{ fontSize: 11, fontWeight: 700 }}>{variance > 0 ? "เกิน" : "ขาด"}</span>
          </span>
        )}
      </td>

      {/* ลบ */}
      <td style={{ ...tdBase, textAlign: "center" }}>
        <button
          type="button"
          onClick={onRemove}
          aria-label="ลบรายการนี้"
          style={{
            background: "#fdecec",
            color: "#c0392b",
            border: "none",
            borderRadius: 9,
            width: 36,
            height: 36,
            display: "grid",
            placeItems: "center",
            cursor: "pointer",
          }}
        >
          <Trash2 size={17} />
        </button>
      </td>
    </tr>
  );
}

// ====================================================================
// "ดูสินค้าทั้งหมด" — แผ่นเลือกสินค้า (online-only) — filter หมวด + ค้นหา + กดเลือก
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
  onPick: (p: { productId: string; sku: string; name: string; unit: string | null; systemQty: number; imageUrl?: string | null }) => "added" | "exists";
}) {
  const [cats, setCats] = useState<string[]>([]);
  const [activeCat, setActiveCat] = useState<string>(""); // "" = ทุกหมวด
  const [q, setQ] = useState("");
  const [products, setProducts] = useState<CountProductRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // optimistic: id ที่เพิ่งกดเลือก (ก่อน parent re-render ส่ง inSheetIds กลับมา)
  const [justAdded, setJustAdded] = useState<Set<string>>(new Set());

  // โหลดรายชื่อหมวดหมู่ครั้งเดียวตอนเปิด
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
    onPick({ productId: p.productId, sku: p.sku, name: p.name, unit: p.unit, systemQty: p.systemQty, imageUrl: p.imageUrl });
    setJustAdded((prev) => new Set(prev).add(p.productId));
  };

  // เลือกทั้งหมด (เฉพาะที่โชว์อยู่ในลิสต์ตอนนี้ + ยังไม่ถูกเลือก)
  const notYet = products.filter((p) => !(inSheetIds.has(p.productId) || justAdded.has(p.productId)));
  const pickAll = () => {
    for (const p of notYet) {
      onPick({ productId: p.productId, sku: p.sku, name: p.name, unit: p.unit, systemQty: p.systemQty, imageUrl: p.imageUrl });
    }
    setJustAdded((prev) => {
      const next = new Set(prev);
      for (const p of notYet) next.add(p.productId);
      return next;
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="ดูสินค้าทั้งหมด — เลือกสินค้าที่จะนับ"
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
          background: "var(--dc-paper)",
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
            borderBottom: "1px solid var(--dc-line)",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 17, color: "var(--dc-ink)" }}>ดูสินค้าทั้งหมด</div>
            <div style={{ fontSize: 12.5, color: "var(--dc-muted)" }}>
              คลัง {warehouseName} · กดเลือกสินค้าที่ต้องการนับ
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
              border: "1.5px solid var(--dc-line)",
              background: "var(--dc-paper)",
              display: "grid",
              placeItems: "center",
              cursor: "pointer",
              color: "var(--dc-muted)",
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
              style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--dc-subtle)" }}
            />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="ค้นหาชื่อ / รหัส / บาร์โค้ด…"
              style={{
                width: "100%",
                padding: "11px 12px 11px 36px",
                borderRadius: 12,
                border: "1.5px solid var(--dc-line-strong)",
                fontSize: 15,
                color: "var(--dc-ink)",
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

        {/* แถบ "เลือกทั้งหมด" (เลือกทุกตัวที่โชว์อยู่เข้าใบนับทีเดียว) */}
        {!loading && !error && products.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "0 16px 10px" }}>
            <span style={{ fontSize: 12.5, color: "var(--dc-muted)" }}>{products.length} รายการ</span>
            <button
              type="button"
              onClick={pickAll}
              disabled={notYet.length === 0}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 13px", borderRadius: 10,
                border: "1.5px solid var(--color-brand-600)",
                background: notYet.length === 0 ? "var(--dc-canvas)" : "var(--color-brand-50, #eef4ff)",
                color: notYet.length === 0 ? "var(--dc-muted)" : "var(--color-brand-700)",
                fontWeight: 700, fontSize: 13, cursor: notYet.length === 0 ? "default" : "pointer", whiteSpace: "nowrap",
              }}
            >
              <CheckCheck size={15} /> เลือกทั้งหมด{notYet.length > 0 ? ` (${notYet.length})` : ""}
            </button>
          </div>
        )}

        {/* product table */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 8px 8px" }}>
          {loading ? (
            <div style={{ textAlign: "center", padding: 28, color: "var(--dc-muted)", fontSize: 14 }}>กำลังโหลด…</div>
          ) : error ? (
            <div style={{ textAlign: "center", padding: 28, color: "#c0392b", fontSize: 14 }}>{error}</div>
          ) : products.length === 0 ? (
            <div style={{ textAlign: "center", padding: 28, color: "var(--dc-muted)", fontSize: 14 }}>
              ไม่พบสินค้า{q.trim() ? ` ที่ตรงกับ “${q.trim()}”` : ""}
            </div>
          ) : (
            <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 460 }}>
                <thead>
                  <tr>
                    <Th style={{ textAlign: "left", paddingLeft: 14 }}>สินค้า</Th>
                    <Th style={{ textAlign: "right" }}>ระบบมี</Th>
                    <Th style={{ width: 96, textAlign: "center" }} aria-label="เลือก" />
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) => {
                    const added = inSheetIds.has(p.productId) || justAdded.has(p.productId);
                    return (
                      <tr key={p.productId}>
                        <td style={{ padding: "8px 12px", borderBottom: "1px solid var(--dc-line)", minWidth: 180 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <Thumb url={p.imageUrl} />
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 650, fontSize: 14.5, color: "var(--dc-ink)", lineHeight: 1.25 }}>{p.name}</div>
                              <div style={{ fontSize: 12.5, color: "var(--dc-muted)", marginTop: 1 }}>
                                {p.sku}
                                {p.category ? ` · ${p.category}` : ""}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td
                          style={{
                            padding: "10px 12px",
                            borderBottom: "1px solid var(--dc-line)",
                            textAlign: "right",
                            whiteSpace: "nowrap",
                            fontWeight: 600,
                            color: "var(--dc-ink)",
                          }}
                        >
                          {p.systemQty}
                          {p.unit ? (
                            <span style={{ color: "var(--dc-muted)", fontWeight: 400, fontSize: 12.5 }}> {p.unit}</span>
                          ) : null}
                        </td>
                        <td style={{ padding: "10px 12px", borderBottom: "1px solid var(--dc-line)", textAlign: "center" }}>
                          <button
                            type="button"
                            onClick={() => handlePick(p)}
                            disabled={added}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 5,
                              padding: "8px 12px",
                              borderRadius: 10,
                              border: "none",
                              cursor: added ? "default" : "pointer",
                              fontWeight: 700,
                              fontSize: 13.5,
                              background: added ? "var(--dc-canvas)" : "var(--color-brand-600)",
                              color: added ? "var(--dc-muted)" : "#fff",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {added ? (
                              <>
                                <Check size={15} /> เลือกแล้ว
                              </>
                            ) : (
                              <>
                                <Plus size={15} /> นับ
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
        <div style={{ padding: "10px 16px 16px", borderTop: "1px solid var(--dc-line)" }}>
          <button type="button" className="dc-btn-xl" onClick={onClose}>
            เสร็จ — กลับไปนับ
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
        border: active ? "1.5px solid var(--color-brand-600)" : "1.5px solid var(--dc-line)",
        background: active ? "var(--color-brand-600)" : "var(--dc-paper)",
        color: active ? "#fff" : "var(--dc-muted)",
      }}
    >
      {label}
    </button>
  );
}

// รูปสินค้าเล็ก (สี่เหลี่ยม · fallback ไอคอนถ้าไม่มีรูป) — ใช้ทั้งตารางเลือก + แถวที่นับ
function Thumb({ url, size = 40 }: { url?: string | null; size?: number }) {
  return (
    <span
      aria-hidden
      style={{
        flexShrink: 0, width: size, height: size, borderRadius: 8, overflow: "hidden",
        background: "var(--dc-canvas, #f1f4f9)", border: "1px solid var(--dc-line)",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
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
