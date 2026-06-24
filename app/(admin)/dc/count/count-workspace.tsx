"use client";

// DC · นับสต๊อก — client workspace (OFFLINE-capable)
//
// ★ หน้าเดียวที่ต้องทำงานตอนเน็ตหลุด (back-of-house). กลไก:
//   1. ทุกบรรทัดนับมี lineKey = crypto.randomUUID() (stable id ฝั่ง client)
//   2. บัฟเฟอร์ทั้งหมดเก็บใน localStorage แยกตาม warehouseId
//   3. ONLINE: ยิง/พิมพ์รหัส → lookupForCount ทันที (รู้ชื่อ + ยอดในระบบ)
//      OFFLINE: เก็บแค่ code ไว้ → ค่อย resolve ชื่อ/ยอดตอนซิงค์
//   4. "ซิงค์" → syncCounts(); server idempotent ผ่าน sourceKey("count", lineKey)
//      → ยิงซ้ำปลอดภัย. รัน auto ตอนกลับมา online (window 'online' event)
//   5. badge "ออฟไลน์ — เก็บในเครื่อง N รายการ" เมื่อ offline หรือมีของยังไม่ซิงค์

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CloudOff, RefreshCw, Trash2, Check } from "lucide-react";
import { DcScanBox } from "@/components/dc/scan-box";
import { lookupForCount, syncCounts } from "@/lib/dc/count-actions";

type CountLine = {
  lineKey: string;
  code: string;
  productId: string | null; // null = ยังไม่ resolve (offline)
  name: string | null;
  unit: string | null;
  systemQty: number | null; // ยอดในระบบ ณ ตอน lookup (null = ยังไม่รู้)
  countedQty: number;
  resolving: boolean; // กำลัง lookup อยู่ (online)
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
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const linesRef = useRef<CountLine[]>([]);
  const syncingRef = useRef(false);

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

  // ---- ซิงค์เข้าระบบ ----
  const doSync = useCallback(async (): Promise<void> => {
    if (syncingRef.current) return;
    const current = linesRef.current;
    // ส่งเฉพาะบรรทัดที่ resolve แล้ว (มี productId) — offline ที่ยังไม่ resolve ส่งไม่ได้
    const ready = current.filter((l) => l.productId && Number.isFinite(l.countedQty));
    if (ready.length === 0) {
      setToast({ kind: "err", msg: "ไม่มีรายการพร้อมซิงค์ (บางรายการยังหาสินค้าไม่เจอ)" });
      return;
    }
    syncingRef.current = true;
    setSyncing(true);
    try {
      const res = await syncCounts({
        warehouseId,
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
      setToast({ kind: "ok", msg: `ซิงค์เข้าระบบแล้ว ${res.synced.length} รายการ` });
    } catch (e) {
      setToast({ kind: "err", msg: e instanceof Error ? e.message : "ซิงค์ไม่สำเร็จ" });
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [warehouseId]);

  // ---- online/offline listeners + auto-sync ตอนกลับมา online ----
  useEffect(() => {
    function handleOnline() {
      setOnline(true);
      // กลับมา online → ลองซิงค์อัตโนมัติ ถ้ามีของค้าง
      if (linesRef.current.some((l) => l.productId)) void doSync();
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
  }, [doSync]);

  // ---- auto-dismiss toast ----
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

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
        {!online && (
          <div style={{ fontSize: 13, color: "var(--dc-muted)", lineHeight: 1.5 }}>
            เน็ตหลุดอยู่ — นับต่อได้เลย ระบบเก็บไว้ในเครื่อง พอเน็ตกลับมาจะซิงค์ให้อัตโนมัติ
          </div>
        )}
      </div>

      {/* ---- รายการนับ ---- */}
      {lines.length === 0 ? (
        <div className="dc-card" style={{ textAlign: "center", padding: 28, color: "var(--dc-muted)" }}>
          ยังไม่มีรายการนับ — ยิงหรือพิมพ์รหัสสินค้าด้านบนเพื่อเริ่มนับ
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {lines.map((l) => (
            <CountRow
              key={l.lineKey}
              line={l}
              onChangeQty={(q) => updateLine(l.lineKey, { countedQty: q })}
              onRemove={() => removeLine(l.lineKey)}
            />
          ))}
        </div>
      )}

      {/* ---- ปุ่มซิงค์ ---- */}
      {lines.length > 0 && (
        <button
          type="button"
          className="dc-btn-xl"
          disabled={syncing || !online || lines.every((l) => !l.productId)}
          onClick={() => void doSync()}
        >
          <RefreshCw size={20} className={syncing ? "dc-spin" : undefined} />
          {syncing ? "กำลังซิงค์…" : `ซิงค์เข้าระบบ (${unsynced})`}
        </button>
      )}
      {!online && lines.length > 0 && (
        <div style={{ fontSize: 13, color: "var(--dc-muted)", textAlign: "center" }}>
          ซิงค์ไม่ได้ตอนนี้ (ออฟไลน์) — พอเน็ตกลับมาจะซิงค์ให้เอง หรือกดซิงค์เองได้
        </div>
      )}
      {online && unresolved > 0 && (
        <div style={{ fontSize: 13, color: "#b07b15", textAlign: "center" }}>
          มี {unresolved} รายการที่ยังหาสินค้าไม่เจอ — ระบบจะข้ามตอนซิงค์ จนกว่าจะแก้รหัสให้ถูก
        </div>
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

function CountRow({
  line,
  onChangeQty,
  onRemove,
}: {
  line: CountLine;
  onChangeQty: (q: number) => void;
  onRemove: () => void;
}) {
  const resolved = !!line.productId;
  const variance =
    line.systemQty !== null ? line.countedQty - line.systemQty : null;

  const varianceColor =
    variance === null ? "var(--dc-muted)" : variance > 0 ? "#1f8a4c" : variance < 0 ? "#c0392b" : "var(--dc-muted)";

  const step = (delta: number) => {
    const next = Math.max(0, line.countedQty + delta);
    onChangeQty(next);
  };

  return (
    <div className="dc-card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 16, color: "var(--dc-ink)" }}>
            {line.name ?? line.code}
            {!resolved && (
              <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 700, color: "#b07b15" }}>
                · รอหาสินค้าตอนซิงค์
              </span>
            )}
          </div>
          <div style={{ fontSize: 13, color: "var(--dc-muted)", marginTop: 2 }}>
            {resolved ? `รหัส ${line.code}` : `รหัสที่ยิง ${line.code}`}
            {line.systemQty !== null && ` · ในระบบ ${line.systemQty}${line.unit ? ` ${line.unit}` : ""}`}
          </div>
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label="ลบรายการนี้"
          style={{
            flexShrink: 0,
            background: "#fdecec",
            color: "#c0392b",
            border: "none",
            borderRadius: 10,
            width: 40,
            height: 40,
            display: "grid",
            placeItems: "center",
            cursor: "pointer",
          }}
        >
          <Trash2 size={18} />
        </button>
      </div>

      <div className="dc-qty">
        <button type="button" onClick={() => step(-1)} aria-label="ลด">−</button>
        <input
          inputMode="numeric"
          value={line.countedQty}
          onChange={(e) => {
            const n = parseInt(e.target.value.replace(/[^\d]/g, ""), 10);
            onChangeQty(Number.isFinite(n) ? n : 0);
          }}
          aria-label="จำนวนที่นับได้"
        />
        <button type="button" onClick={() => step(1)} aria-label="เพิ่ม">＋</button>
      </div>

      {variance !== null && (
        <div style={{ fontSize: 14, fontWeight: 700, color: varianceColor, textAlign: "right" }}>
          {variance === 0 ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Check size={15} /> ตรงกับระบบ
            </span>
          ) : (
            `ส่วนต่าง ${variance > 0 ? "+" : ""}${variance}${line.unit ? ` ${line.unit}` : ""}`
          )}
        </div>
      )}
    </div>
  );
}
