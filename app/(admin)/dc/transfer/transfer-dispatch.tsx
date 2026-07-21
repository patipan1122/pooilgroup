"use client";

// DC · หน้ารวมงาน "เอาของออกจากคลัง" (client):
//   <DcOutboundTabs> = แท็บบนสุด 3 งาน + render flow ที่เลือก (ใช้ทั้งหน้าคลัง floor และหลังบ้าน office)
//     • "เบิกออก"  → <IssueWorkspace>  (issue flow เดิม: lookupForIssue + postIssue)
//     • "โอนออก"  → <TransferDispatch> (transfer flow เดิม: lookupForTransfer + dispatchTransfer)
//     • "ย้ายที่"  → <MoveWorkspace>   (move flow เดิม: lookupForMove + moveLocation)
//   ★ แต่ละแท็บถือ buffer/รายการของตัวเอง (คนละ localStorage key) → สลับแท็บของไม่ปนกัน
//   ★ แท็บเป็นแค่เปลือก — ไม่แตะสัญญาณตัดสต๊อกของทั้ง 3 flow
//   <TransferDispatch> = เลือกปลายทาง → สแกน/พิมพ์รหัส "หรือ" กดเลือกจากรายการ → นับจำนวน → ส่งออก.
//     • เพิ่มทาง "เลือกจากรายการ" = ลิสต์สินค้าที่มีของจริง (listStockForPick) กดเพื่อเพิ่ม + โชว์ "เหลือ N"
//     • ★ lineKey (uuid) สร้างตอน "เพิ่ม" บรรทัด → ส่งซ้ำ = no-op (idempotent)
//     • ปุ่มส่งออก busy-lock กันกดซ้ำ · สำเร็จ → toast เขียว · buffer ใน localStorage กันลิสต์หาย

import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, List, Search, Trash2, Truck, X } from "lucide-react";
import { DcScanBox } from "@/components/dc/scan-box";
import { MoveWorkspace } from "../move/move-workspace";
import { IssueWorkspace } from "../issue/issue-workspace";
import { PoMovePicker, type PoMoveSelection } from "@/components/dc/po-move-picker";
import { DcThumb } from "@/components/dc/product-image";
import { DcTransferDestType } from "@/lib/generated/prisma/enums";
import {
  lookupForTransfer,
  dispatchTransfer,
  listStockForPick,
  type DispatchLine,
  type PickRow,
} from "@/lib/dc/transfer-actions";
// OutboundTab + resolveOutboundTab อยู่ในไฟล์ server-safe แยก (Server Component เรียก resolveOutboundTab ตอน render ไม่ได้ถ้าอยู่ในไฟล์ "use client")
import type { OutboundTab } from "./outbound-tab";

export type DestWarehouseOption = { id: string; name: string };
/** Wave 6 — สาขาตู้คีบ (ClawFleet) ที่เลือกเป็นปลายทางได้ */
export type ClawBranchOption = { id: string; name: string };

// ★ handoff (จากหน้าสินค้า floor/office) — prefill สะดวก เท่านั้น (server re-resolve จริง)
import { readDcHandoff, clearDcHandoffs, PO_HANDOFF_KEY, PRODUCT_HANDOFF_KEY } from "@/lib/dc/handoff";

type Line = {
  lineKey: string;
  productId: string;
  sku: string;
  name: string;
  unit: string;
  onHand: number;
  qty: number;
  imageUrl: string | null; // รูปสินค้า (resolve แล้ว) — null = โชว์ไอคอน placeholder
  poId: string | null; // Pinpoint #2 — บรรทัดนี้มาจากใบ PO ไหน (โอนจากหลายใบ) · null = เพิ่มเอง/สแกน
  poCode: string | null;
};

// ใบ PO ที่กำลังอ้างอิง (สะสมได้หลายใบ — Pinpoint #2)
type SelectedPo = { poId: string; poCode: string; poTitle: string | null; poLineCount: number };

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
// DcOutboundTabs — แท็บบนสุด: เบิกออก · โอนออก · ย้ายที่
// ════════════════════════════════════════════════════════════════════
// type OutboundTab + resolveOutboundTab ย้ายไป ./outbound-tab (server-safe) แล้ว

// คำอธิบายความต่างของ 3 งาน — CEO เคยสับสนว่า "โอน" กับ "ย้าย" ต่างกันยังไง
// → แท็บสั้นเพื่อความหนาแน่น แต่ยังกางคำอธิบายของแท็บที่เลือกอยู่ให้อ่านได้เสมอ
const OUTBOUND_TABS: { key: OutboundTab; label: string; desc: string; tone: string }[] = [
  {
    key: "issue",
    label: "เบิกออก",
    desc: "เบิกของ/อะไหล่ออกไปใช้ — ของออกจากคลังถาวร ไม่มีปลายทางให้กดรับ",
    tone: "#c0392b",
  },
  {
    key: "transfer",
    label: "โอนออก",
    desc: "ส่งของไปคลัง DC อื่น หรือสาขา/โมดูล — ปลายทางต้องกดรับเข้าอีกที",
    tone: "#1b7f4d",
  },
  {
    key: "move",
    label: "ย้ายที่",
    desc: "ย้ายของจากช่อง/ชั้นวางหนึ่ง ไปอีกช่องในคลังเดียวกัน — ยอดคงเหลือรวมไม่เปลี่ยน",
    tone: "#2D6CB1",
  },
];

export function DcOutboundTabs({
  initialTab,
  warehouseId,
  warehouseName,
  warehouses,
  clawBranches = [],
  r2PublicUrl,
}: {
  initialTab: OutboundTab;
  warehouseId: string;
  warehouseName: string;
  warehouses: DestWarehouseOption[];
  clawBranches?: ClawBranchOption[];
  r2PublicUrl?: string;
}) {
  const [tab, setTab] = useState<OutboundTab>(initialTab);

  // ★ ไม่มีการ "เด้งแท็บอัตโนมัติ" จากของฝากอีกแล้ว — แท็บมาจาก ?tab= บน URL อย่างเดียว
  //   หน้าสินค้ากด "เบิก"/"โอน" → push ?tab=issue / ?tab=transfer อยู่แล้ว = URL บอกเจตนาครบ
  //   เดิมเด้งตามของฝาก → ของฝากที่ค้างอยู่ (เช่น ตอนยังไม่ได้เลือกคลัง หน้าไม่ทันโหลดตัวรับ)
  //   จะมาทับแท็บที่ผู้ใช้เพิ่งกดเลือกเองทีหลัง = ของออกผิดทางแบบเงียบ ๆ
  //   ของฝากที่ไม่มีใครมากิน → หมดอายุเองใน 10 นาที (ดู lib/dc/handoff.ts)

  // สลับแท็บ → sync ?tab= บน URL (ไม่ rerender server) เพื่อให้ refresh/แชร์ลิงก์แล้วอยู่แท็บเดิม
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get("tab") === tab) return;
      url.searchParams.set("tab", tab);
      url.searchParams.delete("mode"); // ลิงก์เก่า — ไม่ต้องพาไปด้วย
      window.history.replaceState(null, "", url.toString());
    } catch {
      /* URL API พัง — ไม่เป็นไร แท็บยังใช้ได้ */
    }
  }, [tab]);

  const active = OUTBOUND_TABS.find((t) => t.key === tab) ?? OUTBOUND_TABS[0];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="dc-card" style={{ padding: 10 }}>
        <div role="tablist" aria-label="เลือกงาน" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {OUTBOUND_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              style={outboundTabStyle(tab === t.key, t.tone)}
            >
              {t.label}
            </button>
          ))}
        </div>
        {/* คำอธิบายของแท็บที่เลือก — กันสับสนว่างานไหนคืออะไร */}
        <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink2, #5b6675)", marginTop: 8, lineHeight: 1.4 }}>
          {active.desc}
        </div>
      </div>

      {tab === "issue" ? (
        <IssueWorkspace warehouseId={warehouseId} warehouseName={warehouseName} r2PublicUrl={r2PublicUrl} />
      ) : tab === "move" ? (
        <MoveWorkspace warehouseId={warehouseId} warehouseName={warehouseName} />
      ) : (
        <TransferDispatch
          fromWarehouseId={warehouseId}
          fromWarehouseName={warehouseName}
          warehouses={warehouses}
          clawBranches={clawBranches}
          r2PublicUrl={r2PublicUrl}
        />
      )}
    </div>
  );
}

export function TransferDispatch({
  fromWarehouseId,
  fromWarehouseName,
  warehouses,
  clawBranches = [],
  r2PublicUrl,
}: {
  fromWarehouseId: string;
  fromWarehouseName: string;
  warehouses: DestWarehouseOption[];
  clawBranches?: ClawBranchOption[];
  r2PublicUrl?: string;
}) {
  // ปลายทางที่เลือกได้ = คลังอื่น (ไม่รวมต้นทาง)
  const destWarehouses = warehouses.filter((w) => w.id !== fromWarehouseId);
  const hasClawBranches = clawBranches.length > 0;

  const [destMode, setDestMode] = useState<DestMode>(
    destWarehouses.length > 0 ? "warehouse" : "module",
  );
  const [toWarehouseId, setToWarehouseId] = useState<string>(destWarehouses[0]?.id ?? "");
  const [toLabel, setToLabel] = useState("");
  // Wave 6 — โหมด "สาขา/โมดูล" เลือกได้ 2 แบบ: ตู้คีบ (ClawFleet · เขียนเข้าสโตร์สาขาจริง) หรือ อื่น ๆ (label อิสระ)
  const [moduleTargetType, setModuleTargetType] = useState<"clawfleet" | "other">(
    hasClawBranches ? "clawfleet" : "other",
  );
  const [toBranchId, setToBranchId] = useState<string>(clawBranches[0]?.id ?? "");
  const [sameSite, setSameSite] = useState(false);
  const [note, setNote] = useState("");

  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // ---- "เลือกจากใบ PO" (โอนเป็นใบ) ----
  const [poPickerOpen, setPoPickerOpen] = useState(false);
  const [selectedPos, setSelectedPos] = useState<SelectedPo[]>([]); // ใบ PO ที่อ้างอิง (สะสมหลายใบ · Pinpoint #2)

  // ---- ค่าขนส่งไทย-ไทย (บาท → ส่งเป็นสตางค์ตอน dispatch) ----
  const [freightBaht, setFreightBaht] = useState("");
  const [freightNote, setFreightNote] = useState("");

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
    (p: { id: string; sku: string; name: string; unit: string; onHand: number; imageUrl?: string | null }) => {
      setLines((prev) => {
        const idx = prev.findIndex((l) => l.productId === p.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = {
            ...next[idx],
            qty: next[idx].qty + 1,
            onHand: p.onHand,
            imageUrl: p.imageUrl ?? next[idx].imageUrl, // เติมรูปถ้ามีมาใหม่
          };
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
            imageUrl: p.imageUrl ?? null,
            poId: null,
            poCode: null,
          },
        ];
      });
    },
    [],
  );

  // รับผลจากตัวเลือกใบ PO → สะสมบรรทัด (เปิด picker หลายรอบ = โอนจากหลายใบ · Pinpoint #2)
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
            qty: pl.qty,
            imageUrl: pl.imageUrl ?? null,
            poId: sel.poId,
            poCode: sel.poCode,
          });
        }
      }
      return next;
    });
  }, []);

  // ยกเลิกอ้างอิงใบ PO ใบเดียว → ลบบรรทัดที่มาจากใบนั้น + เอาใบออก
  const clearOnePo = useCallback((poId: string) => {
    setSelectedPos((prev) => prev.filter((p) => p.poId !== poId));
    setLines((prev) => prev.filter((l) => l.poId !== poId));
  }, []);

  // ยกเลิกอ้างอิงทุกใบ → ลบบรรทัดจากใบ PO ทั้งหมด (เก็บบรรทัดที่เพิ่มเอง/สแกน)
  const clearPoRef = useCallback(() => {
    setSelectedPos([]);
    setLines((prev) => prev.filter((l) => l.poId == null));
  }, []);

  // ---- hydrate จาก handoff (หน้าสินค้า floor/office) ตอน mount ----
  //   PO handoff → handlePoConfirm(sel) เดิม · general product handoff → addProduct loop (qty default 1)
  //   ★ prefill = convenience default เท่านั้น: dispatchTransfer re-fetch getPoFulfillment + recordMovement
  //     guard on-hand จริงฝั่ง server → prefilled qty ไม่ใช่ตัวเลข authoritative (house rule money-preview-must-match-server)
  //   ★ กินเฉพาะของที่ฝากมาให้ "โอน" เท่านั้น (readDcHandoff เช็ค intent ให้) — ของที่ฝากมาให้ "เบิก" ปล่อยไว้
  //     กินแล้วล้างทั้ง 2 คีย์เสมอ (เดิม PO handoff return ทิ้ง product handoff ค้าง → ไป prefill งานอื่นทีหลัง)
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const sel = readDcHandoff<PoMoveSelection>(PO_HANDOFF_KEY, "transfer");
      if (sel) {
        if (Array.isArray(sel.lines) && sel.lines.length > 0) {
          handlePoConfirm(sel);
        }
        clearDcHandoffs();
        return; // PO handoff ชนะ (มีทั้งคู่ = ไม่ควรเกิด แต่กันไว้)
      }
      const parsed = readDcHandoff<{
        lines: { productId: string; sku: string; name: string; unit: string; imageUrl?: string | null; onHand?: number }[];
      }>(PRODUCT_HANDOFF_KEY, "transfer");
      if (parsed) {
        if (Array.isArray(parsed.lines)) {
          for (const l of parsed.lines) {
            // carry รูป + onHand จากหน้าสินค้า (prefill/แสดงผลเท่านั้น · server re-guard on-hand จริงตอน dispatch)
            addProduct({ id: l.productId, sku: l.sku, name: l.name, unit: l.unit, onHand: l.onHand ?? 0, imageUrl: l.imageUrl ?? null });
          }
        }
        clearDcHandoffs();
      }
    } catch {
      /* handoff เสีย → เมินเงียบ (ผู้ใช้เพิ่มเองได้) */
    }
    // mount-once: hydrate ครั้งเดียวตอนเข้าหน้า
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // ปลายทางพร้อมส่งไหม: คลัง→ต้องเลือกคลัง · โมดูล ClawFleet→ต้องเลือกสาขา · โมดูลอื่น→ต้องพิมพ์ชื่อ
  const isClawTarget = destMode === "module" && moduleTargetType === "clawfleet" && hasClawBranches;
  const destOk =
    destMode === "warehouse"
      ? !!toWarehouseId
      : isClawTarget
        ? !!toBranchId
        : toLabel.trim().length > 0;
  const selectedClawBranch = clawBranches.find((b) => b.id === toBranchId) ?? null;

  const dispatch = useCallback(async () => {
    if (busy || lines.length === 0 || !destOk) return;
    setBusy(true);
    setError(null);
    try {
      const payload: DispatchLine[] = lines.map((l) => ({
        productId: l.productId,
        qty: l.qty,
        lineKey: l.lineKey,
        poId: l.poId ?? undefined, // Pinpoint #2 — poId ต่อบรรทัด (โอนจากหลายใบ) · server cap ต่อใบ
      }));

      // baht → satang (สตางค์): round(บาท × 100) · กัน NaN/ติดลบ → 0 (money-critical)
      const thaiFreightSatang = Math.max(0, Math.round((parseFloat(freightBaht) || 0) * 100));
      // header poId ไม่ตั้ง — ให้ per-line poId ใน payload เป็นตัวขับ (กันบรรทัดที่เพิ่มเอง/สแกน ถูก attribute ผิดใบ)
      const poIdArg: string | undefined = undefined;
      const freightNoteArg = freightNote.trim() || undefined;

      const res = await dispatchTransfer(
        destMode === "warehouse"
          ? {
              fromWarehouseId,
              destType: DcTransferDestType.WAREHOUSE,
              toWarehouseId,
              sameSite,
              note: note.trim() || undefined,
              lines: payload,
              poId: poIdArg,
              thaiFreightSatang,
              thaiFreightNote: freightNoteArg,
            }
          : isClawTarget && selectedClawBranch
            ? {
                // Wave 6 — ปลายทางตู้คีบ (ClawFleet): ส่ง toBranchId + toModule='clawfleet' + label=ชื่อสาขา
                //   → ตอนกดยืนยันรับ ของจะเข้า "สโตร์สาขา" ของสาขานี้จริง (per-branch)
                fromWarehouseId,
                destType: DcTransferDestType.MODULE,
                toBranchId: selectedClawBranch.id,
                toModule: "clawfleet",
                toLabel: selectedClawBranch.name,
                note: note.trim() || undefined,
                lines: payload,
                poId: poIdArg,
                thaiFreightSatang,
                thaiFreightNote: freightNoteArg,
              }
            : {
                fromWarehouseId,
                destType: DcTransferDestType.MODULE,
                toLabel: toLabel.trim(),
                note: note.trim() || undefined,
                lines: payload,
                poId: poIdArg,
                thaiFreightSatang,
                thaiFreightNote: freightNoteArg,
              },
      );

      if (!res.ok) {
        setError(res.error);
        return;
      }

      setLines([]);
      setNote("");
      setFreightBaht("");
      setFreightNote("");
      setSelectedPos([]);
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
  }, [busy, lines, destOk, destMode, fromWarehouseId, toWarehouseId, sameSite, note, toLabel, totalQty, showToast, freightBaht, freightNote, isClawTarget, selectedClawBranch]);

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
            {/* Wave 6 — เลือกชนิดปลายทาง: ตู้คีบ (เขียนเข้าสโตร์สาขาจริง) หรือ อื่น ๆ (พิมพ์ชื่อเอง) */}
            {hasClawBranches && (
              <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => setModuleTargetType("clawfleet")}
                  style={destToggleStyle(moduleTargetType === "clawfleet", false)}
                >
                  ตู้คีบ (ClawFleet)
                </button>
                <button
                  type="button"
                  onClick={() => setModuleTargetType("other")}
                  style={destToggleStyle(moduleTargetType === "other", false)}
                >
                  อื่น ๆ
                </button>
              </div>
            )}

            {isClawTarget ? (
              <>
                <select
                  value={toBranchId}
                  onChange={(e) => setToBranchId(e.target.value)}
                  style={selectStyle}
                  aria-label="สาขาตู้คีบปลายทาง"
                >
                  {clawBranches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
                <div style={{ marginTop: 8, fontSize: 13, color: "var(--dc-muted, #6b7785)", lineHeight: 1.5 }}>
                  เมื่อสาขายืนยัน &quot;รับของ&quot; → ของจะเข้า <strong>สโตร์สาขา</strong> ของตู้คีบนี้อัตโนมัติ (ต้นทุนตามของไป)
                </div>
              </>
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
            border: "1.5px solid var(--dc-line-strong, #c9d3e0)",
            background: "var(--dc-paper, #fff)",
            color: "var(--dc-ink, #1f2733)",
            borderRadius: 12,
            padding: "12px 14px",
            fontSize: 15,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          <FileText size={18} /> เลือกจากใบ PO
        </button>
      </div>

      {/* กำลังโอนจากใบ PO — สะสมได้หลายใบ (Pinpoint #2) */}
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
                กำลังโอนจาก {selectedPos.length} ใบ PO · รวม {lines.filter((l) => l.poId != null).length} รายการ ({totalQty} ชิ้น)
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
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10, minWidth: 0 }}>
                    <DcThumb url={l.imageUrl} alt={l.name} size={48} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 17, fontWeight: 700, color: "var(--dc-ink, #1f2733)", lineHeight: 1.25 }}>
                        {l.name}
                      </div>
                      <div style={{ fontSize: 13, color: "var(--dc-muted, #6b7785)", marginTop: 2 }}>
                        {l.sku} · เหลือ {l.onHand} {l.unit}
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

      {/* ค่าขนส่งไทย-ไทย + หมายเหตุ (ไม่บังคับ) */}
      {lines.length > 0 && (
        <div className="dc-card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 160 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: "var(--dc-ink, #1f2733)" }}>
                ค่าขนส่งไทย-ไทย (บาท)
              </span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={freightBaht}
                onChange={(e) => setFreightBaht(e.target.value)}
                placeholder="0"
                aria-label="ค่าขนส่งไทย-ไทย (บาท)"
                style={{
                  width: "100%",
                  border: "1.5px solid var(--dc-line, #e6eaf0)",
                  borderRadius: 10,
                  padding: "10px 12px",
                  fontSize: 16,
                  fontWeight: 600,
                  color: "var(--dc-ink, #1f2733)",
                  background: "#fff",
                  boxSizing: "border-box",
                }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6, flex: 2, minWidth: 180 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: "var(--dc-muted, #6b7785)" }}>
                หมายเหตุค่าขนส่ง (ไม่บังคับ)
              </span>
              <input
                type="text"
                value={freightNote}
                onChange={(e) => setFreightNote(e.target.value)}
                placeholder="เช่น ขนส่งเอกชน / ค่ารถ"
                aria-label="หมายเหตุค่าขนส่ง"
                style={{
                  width: "100%",
                  border: "1.5px solid var(--dc-line, #e6eaf0)",
                  borderRadius: 10,
                  padding: "10px 12px",
                  fontSize: 16,
                  fontWeight: 600,
                  color: "var(--dc-ink, #1f2733)",
                  background: "#fff",
                  boxSizing: "border-box",
                }}
              />
            </label>
          </div>
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
                      <div
                        key={r.productId}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          border: "1.5px solid var(--dc-line, #e6eaf0)",
                          background: inCart > 0 ? "var(--color-brand-50, #eef3fe)" : "#fff",
                          borderRadius: 12,
                          padding: "10px 12px",
                        }}
                      >
                        {/* รูปสินค้า (คลิกซูม) — อยู่นอกปุ่ม "เลือก" กันคลิกชนกัน */}
                        <DcThumb url={r.imageUrl} alt={r.name} size={44} />
                        <button
                          type="button"
                          onClick={() =>
                            addProduct({ id: r.productId, sku: r.sku, name: r.name, unit: r.unit, onHand: r.onHand, imageUrl: r.imageUrl })
                          }
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 12,
                            textAlign: "left",
                            flex: 1,
                            minWidth: 0,
                            border: "none",
                            background: "transparent",
                            padding: 0,
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
                      </div>
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

      {/* ตัวเลือก "โอนเป็นใบ PO" */}
      <PoMovePicker
        open={poPickerOpen}
        onClose={() => setPoPickerOpen(false)}
        warehouseId={fromWarehouseId}
        r2PublicUrl={r2PublicUrl || undefined}
        mode="transfer"
        onConfirm={handlePoConfirm}
      />

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

// แท็บ pill — แท็บที่เลือกทึบด้วยสีประจำงาน (เบิก=แดง · โอน=เขียว · ย้าย=น้ำเงิน) ให้รู้ทันทีว่ากำลังทำอะไรอยู่
function outboundTabStyle(active: boolean, tone: string): React.CSSProperties {
  return {
    minWidth: 96,
    minHeight: 44, // แตะบน iPad ได้สบาย
    padding: "9px 20px",
    border: active ? `1.5px solid ${tone}` : "1.5px solid var(--dc-line, #e6eaf0)",
    background: active ? tone : "#fff",
    color: active ? "#fff" : "var(--dc-ink, #1f2733)",
    borderRadius: 999,
    fontSize: 15,
    fontWeight: active ? 800 : 700,
    cursor: "pointer",
  };
}
