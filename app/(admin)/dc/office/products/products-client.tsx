"use client";

// DC Redesign v2 · หน้าสินค้า (เนื้อใน) — การ์ด / ตาราง / กรองหมวด / ค้นหา / สแกน.
// ตรงตาม prototype DC Redesign v2.dc.html (isProducts) + เพิ่มมุมมอง "ตาราง" (CEO ขอ).
import { useState, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DataTable } from "@/components/ui/data-table";
import { DcThumb, DcLightbox } from "@/components/dc/product-image";
import { OfficePoBrowse } from "@/components/dc/office-po-browse";
import { OfficeTransferBrowse } from "@/components/dc/office-transfer-browse";
// ★ handoff → หน้า "เบิก · โอน · ย้ายที่" (convenience default — ปลายทาง re-resolve จริง server)
//   carry แค่ id + label (ไม่มี qty; general handoff = qty default 1 ที่ปลายทาง)
import { writeDcHandoff, PRODUCT_HANDOFF_KEY } from "@/lib/dc/handoff";

type SvgProps = { size?: number; sw?: number; stroke?: string; fill?: string; children: React.ReactNode };
function Svg({ size = 16, sw = 1.8, stroke = "currentColor", fill = "none", children }: SvgProps) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={stroke} strokeWidth={sw}>{children}</svg>;
}
const IcSearch = <><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></>;
const IcScan = <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10" />;
const IcFrame = <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />;
const IcPlus = <path d="M12 5v14M5 12h14" />;
const IcGridView = <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>;
const IcListView = <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />;
const IcAlert = <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />;
const IcImage = <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></>;
const IcIssue = <path d="M12 21V9M7 13l5-4 5 4M5 3h14" />;
const IcTransfer = <path d="M4 7h13l-3-3M20 17H7l3 3" />;
const IcKebab = <><circle cx="12" cy="5" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="12" cy="19" r="1.4" /></>;

export type ProductRow = {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  unit: string;
  catKey: string; // category หรือ "__none"
  catLabel: string;
  catC: string;
  catSoft: string;
  onhand: number;
  reorder: number | null;
  low: boolean;
  imageUrl: string | null;
};
export type CatChip = { key: string; label: string; count: number };

export function ProductsClient({
  products,
  headerExtra,
  r2PublicUrl,
  warehouseId,
}: { products: ProductRow[]; chips: CatChip[]; total: number; lowCount: number; headerExtra?: React.ReactNode; r2PublicUrl?: string; warehouseId?: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"products" | "po" | "transfer">("products"); // Pinpoint #8 — ดูตามใบ PO · +ดูตามใบโอน (CEO 2026-08-01)
  const [view, setView] = useState<"grid" | "table">("grid");
  const [cat, setCat] = useState<string>("all");
  const [q, setQ] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [showSoldOut, setShowSoldOut] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // เลือกหลายชิ้น — สะสมข้ามหมวด/ค้นหา (เก็บ id ไว้ ไม่ล้างตอนเปลี่ยน filter)
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const searchRef = useRef<HTMLInputElement>(null);

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // stash แถวที่ให้ไป → หน้าโอน/เบิก (carry แค่ id + label · ไม่มี qty → ปลายทาง default 1)
  const stashAndGo = useCallback(
    (rows: ProductRow[], target: "transfer" | "issue") => {
      if (rows.length === 0) return;
      const payload = {
        lines: rows.map((p) => ({ productId: p.id, sku: p.sku, name: p.name, unit: p.unit, imageUrl: p.imageUrl, onHand: p.onhand })),
      };
      // ปั๊ม intent ไปด้วย → หน้าปลายทางเปิดแท็บตามที่คนกดตั้งใจ ไม่ต้องเดา
      writeDcHandoff(PRODUCT_HANDOFF_KEY, payload, target);
      router.push(target === "transfer" ? "/dc/transfer?tab=transfer" : "/dc/transfer?tab=issue");
    },
    [router],
  );

  // ซ่อนสินค้าที่คงเหลือ = 0 (ของใช้แล้วหมดไป · ซื้อ/สร้างใหม่เสมอ) — กด "แสดงของหมด" ดูได้
  const soldOutCount = products.reduce((n, p) => n + (p.onhand <= 0 ? 1 : 0), 0);
  const base = showSoldOut ? products : products.filter((p) => p.onhand > 0);

  const term = q.trim().toLowerCase();
  const filtered = base.filter((p) => {
    if (cat !== "all" && p.catKey !== cat) return false;
    if (lowOnly && !p.low) return false;
    if (term && !`${p.name} ${p.sku} ${p.barcode ?? ""}`.toLowerCase().includes(term)) return false;
    return true;
  });

  // chips + ตัวเลข คำนวณจากชุดที่มองเห็นจริง (สอดคล้องกับการซ่อนของหมด)
  const byCat = new Map<string, CatChip>();
  for (const p of base) {
    const ex = byCat.get(p.catKey);
    if (ex) ex.count++;
    else byCat.set(p.catKey, { key: p.catKey, label: p.catLabel, count: 1 });
  }
  const dynChips = [...byCat.values()].sort((a, b) => b.count - a.count);
  const lowCount = base.reduce((n, p) => n + (p.low ? 1 : 0), 0);
  const allChips: CatChip[] = [{ key: "all", label: "ทั้งหมด", count: base.length }, ...dynChips];

  return (
    <div>
      {/* header */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 18, gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 25, fontWeight: 700, letterSpacing: "-.01em" }}>สินค้า</h1>
          <p style={{ margin: "5px 0 0", color: "var(--ink2)", fontSize: 14 }}>หารูป–หมวดหมู่ได้ไว เห็นคงเหลือทันที · เลือกหลายชิ้นเพื่อ โอน / ตัดจ่าย / ลบ ได้เลย</p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {headerExtra}
          <button
            type="button"
            onClick={() => setNotice("นำเข้า Excel — กำลังจะมาเร็ว ๆ นี้")}
            style={{ display: "flex", alignItems: "center", gap: 7, background: "#fff", border: "1px solid var(--border)", borderRadius: 10, padding: "9px 14px", fontSize: 13.5, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", color: "var(--ink)" }}
          >
            <Svg size={15} stroke="#5B6477">{IcFrame}</Svg>นำเข้า Excel
          </button>
          <Link href="/dc/office/products/new" style={{ display: "flex", alignItems: "center", gap: 7, background: "var(--primary)", color: "#fff", border: "none", borderRadius: 10, padding: "9px 16px", fontSize: 13.5, fontWeight: 600, textDecoration: "none", boxShadow: "0 2px 6px rgba(31,79,214,.25)" }}>
            <Svg size={16} sw={2}>{IcPlus}</Svg>เพิ่มสินค้า
          </Link>
        </div>
      </div>

      {/* มุมมอง: รายการสินค้า / ดูตามใบ PO (Pinpoint #8) */}
      <div role="tablist" aria-label="มุมมองสินค้า" style={{ display: "flex", gap: 2, marginBottom: 16, borderBottom: "1px solid var(--border)" }}>
        {([["products", "รายการสินค้า"], ["po", "ดูตามใบ PO"], ["transfer", "ดูตามใบโอน"]] as const).map(([m, label]) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            style={{
              background: "none", border: "none", cursor: "pointer", fontFamily: "inherit",
              padding: "9px 14px", fontSize: 14, fontWeight: mode === m ? 700 : 600,
              color: mode === m ? "var(--primary)" : "var(--ink2)",
              borderBottom: mode === m ? "2.5px solid var(--primary)" : "2.5px solid transparent",
              marginBottom: -1,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "po" ? (
        <OfficePoBrowse warehouseId={warehouseId} r2PublicUrl={r2PublicUrl} />
      ) : mode === "transfer" ? (
        <OfficeTransferBrowse warehouseId={warehouseId} r2PublicUrl={r2PublicUrl} />
      ) : (
      <>
      {notice ? (
        <div style={{ marginBottom: 12, background: "#FEF1DE", color: "#B45309", border: "1px solid #F3D9C0", borderRadius: 10, padding: "9px 14px", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
          <Svg size={15} sw={2} stroke="#B45309">{IcAlert}</Svg>{notice}
          <button type="button" onClick={() => setNotice(null)} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "#B45309", fontWeight: 700 }}>✕</button>
        </div>
      ) : null}

      {/* search + scan + view toggle */}
      <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, background: "#fff", border: "1px solid var(--border)", borderRadius: 11, padding: "11px 14px", flex: 1 }}>
          <Svg size={17} stroke="#9A9082">{IcSearch}</Svg>
          <input
            ref={searchRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ค้นหาชื่อ / SKU / บาร์โค้ด…"
            style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontSize: 16, fontFamily: "inherit", color: "var(--ink)" }}
          />
          <span
            role="button"
            onClick={() => searchRef.current?.focus()}
            style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--primary)", fontWeight: 600, fontSize: 12.5, cursor: "pointer" }}
          >
            <Svg size={15}>{IcScan}</Svg>สแกน
          </span>
        </div>
        <div className="dcx-vtoggle">
          <button type="button" className={view === "grid" ? "dcx-vbtn on" : "dcx-vbtn"} onClick={() => setView("grid")} aria-label="มุมมองการ์ด">
            <Svg size={16} sw={1.9}>{IcGridView}</Svg>
          </button>
          <button type="button" className={view === "table" ? "dcx-vbtn on" : "dcx-vbtn"} onClick={() => setView("table")} aria-label="มุมมองตาราง">
            <Svg size={16} sw={1.9}>{IcListView}</Svg>
          </button>
        </div>
      </div>

      {/* category chips + sold-out toggle + low */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        {allChips.map((c) => (
          <span key={c.key} className={cat === c.key ? "dcx-chip on" : "dcx-chip"} onClick={() => setCat(c.key)}>
            {c.label} · {c.count}
          </span>
        ))}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {soldOutCount > 0 ? (
            <span
              onClick={() => setShowSoldOut((v) => !v)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 600,
                color: showSoldOut ? "#475569" : "#94A3B8", background: showSoldOut ? "#E7ECF3" : "#F1F4F8",
                padding: "7px 13px", borderRadius: 20, cursor: "pointer",
                boxShadow: showSoldOut ? "inset 0 0 0 1.5px #94A3B8" : "none",
              }}
            >
              {showSoldOut ? "ซ่อนของหมด" : `แสดงของหมด ${soldOutCount}`}
            </span>
          ) : null}
          {lowCount > 0 ? (
            <span
              onClick={() => setLowOnly((v) => !v)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 600,
                color: "#B45309", background: "#FEF1DE", padding: "7px 13px", borderRadius: 20, cursor: "pointer",
                boxShadow: lowOnly ? "inset 0 0 0 1.5px #E0922F" : "none",
              }}
            >
              <Svg size={14} sw={2} stroke="#B45309">{IcAlert}</Svg>ของใกล้หมด {lowCount}
            </span>
          ) : null}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div style={{ marginTop: 28, textAlign: "center", color: "var(--muted)", fontSize: 14, padding: "40px 0" }}>
          {!showSoldOut && soldOutCount > 0 && base.length === 0
            ? `สินค้าใช้หมดแล้วทั้งหมด (${soldOutCount} รายการ) — กด “แสดงของหมด” เพื่อดู`
            : "ไม่พบสินค้าที่ตรงกับเงื่อนไข"}
        </div>
      ) : view === "grid" ? (
        <GridView rows={filtered} selected={selected} onToggle={toggleSelect} onStash={stashAndGo} />
      ) : (
        <TableView rows={filtered} selected={selected} onToggle={toggleSelect} onStash={stashAndGo} />
      )}

      {/* แถบเลือกหลายชิ้น (ติดล่าง) — โอน / ตัดจ่าย ทีเดียวหลายรายการ */}
      {selected.size > 0 && (
        <SelectionBar
          count={selected.size}
          onClear={() => setSelected(new Set())}
          onTransfer={() => stashAndGo(products.filter((p) => selected.has(p.id)), "transfer")}
          onIssue={() => stashAndGo(products.filter((p) => selected.has(p.id)), "issue")}
        />
      )}
      </>
      )}
    </div>
  );
}

// แถบล่างเลือกหลายชิ้น (.dcx tokens ให้เข้าหน้านี้)
function SelectionBar({
  count,
  onClear,
  onTransfer,
  onIssue,
}: {
  count: number;
  onClear: () => void;
  onTransfer: () => void;
  onIssue: () => void;
}) {
  return (
    <div
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 40,
        background: "#fff",
        borderTop: "1px solid var(--border)",
        padding: "12px 16px calc(12px + env(safe-area-inset-bottom, 0px))",
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        boxShadow: "0 -6px 20px rgba(20,40,90,.08)",
      }}
    >
      <span style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)" }}>เลือก {count} รายการ</span>
      <button
        type="button"
        onClick={onClear}
        style={{ background: "none", border: "1px solid var(--border)", borderRadius: 9, padding: "8px 12px", fontSize: 13, fontWeight: 600, color: "var(--ink2)", cursor: "pointer", fontFamily: "inherit" }}
      >
        ล้าง
      </button>
      <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
        <button
          type="button"
          onClick={onIssue}
          style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "#FDECEC", color: "#C0392B", border: "1px solid #F3C9C4", borderRadius: 10, padding: "10px 16px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
        >
          <Svg size={15}>{IcIssue}</Svg>ตัดจ่าย ({count})
        </button>
        <button
          type="button"
          onClick={onTransfer}
          style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "var(--primary)", color: "#fff", border: "none", borderRadius: 10, padding: "10px 16px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", boxShadow: "0 2px 6px rgba(31,79,214,.25)" }}
        >
          <Svg size={15}>{IcTransfer}</Svg>โอน ({count})
        </button>
      </div>
    </div>
  );
}

// รูปหน้าปกการ์ด (landscape) — คลิกเปิดรูปใหญ่ (lightbox) แทนการเข้าหน้า detail
function CoverImage({ url, alt }: { url: string; alt: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={alt}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        style={{ width: "100%", height: "100%", objectFit: "cover", cursor: "zoom-in" }}
      />
      {open ? <DcLightbox url={url} alt={alt} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function GridView({
  rows,
  selected,
  onToggle,
  onStash,
}: {
  rows: ProductRow[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onStash: (rows: ProductRow[], target: "transfer" | "issue") => void;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(152px,1fr))", gap: 12, marginTop: 14, paddingBottom: 72 }}>
      {rows.map((p) => {
        const on = selected.has(p.id);
        return (
        <div key={p.id} className="dcx-card" style={on ? { outline: "2px solid var(--primary)", outlineOffset: -1 } : undefined}>
          <div style={{ position: "relative", aspectRatio: "1.35", background: p.catSoft, display: "flex", alignItems: "center", justifyContent: "center", color: p.catC, overflow: "hidden" }}>
            {p.imageUrl ? (
              <CoverImage url={p.imageUrl} alt={p.name} />
            ) : (
              <Svg size={40} sw={1.4}>{IcImage}</Svg>
            )}
            {/* checkbox เลือกหลายชิ้น */}
            <label
              onClick={(e) => e.stopPropagation()}
              style={{ position: "absolute", top: 6, right: 6, display: "grid", placeItems: "center", width: 28, height: 28, borderRadius: 8, background: "rgba(255,255,255,.9)", cursor: "pointer" }}
            >
              <input
                type="checkbox"
                checked={on}
                onChange={() => onToggle(p.id)}
                aria-label={`เลือก ${p.name}`}
                style={{ width: 18, height: 18, cursor: "pointer" }}
              />
            </label>
            <span style={{ position: "absolute", top: 8, left: 8, fontSize: 10.5, fontWeight: 600, color: p.catC, background: p.catSoft, padding: "2px 8px", borderRadius: 6 }}>{p.catLabel}</span>
            {p.low ? <span style={{ position: "absolute", bottom: 8, right: 8, fontSize: 10, fontWeight: 700, color: "#fff", background: "#DC5B53", padding: "2px 8px", borderRadius: 20 }}>ใกล้หมด</span> : null}
          </div>
          <div style={{ padding: "12px 13px", flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ lineHeight: 1.25 }}>
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>{p.name}</div>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>หน่วย: {p.unit}</div>
            </div>
            <div className="num" style={{ fontSize: 11, color: "var(--muted)" }}>{p.sku}</div>
            <div style={{ marginTop: "auto", display: "flex", alignItems: "center", paddingTop: 8, borderTop: "1px solid var(--border)" }}>
              <span style={{ fontSize: 12, color: "var(--ink2)" }}>คงเหลือ <b className="num" style={{ color: p.low ? "#DC5B53" : "var(--ink)", fontWeight: 700 }}>{p.onhand}</b> <span style={{ color: "var(--muted)" }}>{p.unit}</span></span>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto auto", borderTop: "1px solid var(--border)" }}>
            {/* prefill สินค้าตัวนี้แล้วไปหน้าตัดจ่าย/โอน (แก้ dead Link เดิมที่ไม่ prefill อะไร) */}
            <button type="button" onClick={() => onStash([p], "issue")} className="dcx-cardbtn issue" style={{ borderRight: "1px solid var(--border)", background: "none", cursor: "pointer", fontFamily: "inherit" }}><Svg size={14}>{IcIssue}</Svg>ตัดจ่าย</button>
            <button type="button" onClick={() => onStash([p], "transfer")} className="dcx-cardbtn move" style={{ borderRight: "1px solid var(--border)", background: "none", cursor: "pointer", fontFamily: "inherit" }}><Svg size={14}>{IcTransfer}</Svg>โอน</button>
            <Link href={`/dc/office/products/${p.id}`} className="dcx-cardbtn" style={{ padding: "9px 11px", borderRight: "1px solid var(--border)" }}><Svg size={15}>{IcImage}</Svg></Link>
            <Link href={`/dc/office/products/${p.id}`} className="dcx-cardbtn" style={{ padding: "9px 11px" }}><Svg size={15} sw={2}>{IcKebab}</Svg></Link>
          </div>
        </div>
        );
      })}
    </div>
  );
}

// ตาราง — ใช้ <DataTable> จริง (real <table> w-full ใน overflow-x-auto, auto-sizing)
// แทน fake grid เดิม (fr/auto ไม่มี min-width:0 → คอลัมน์ยาวดันเหลื่อมซ้อน header).
function TableView({
  rows,
  selected,
  onToggle,
}: {
  rows: ProductRow[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onStash: (rows: ProductRow[], target: "transfer" | "issue") => void;
}) {
  return (
    <div style={{ marginTop: 14, paddingBottom: 72 }}>
      <DataTable
        stickyHeader={false}
        columns={[
          { key: "sel", header: "", align: "center", className: "w-10" },
          { key: "name", header: "สินค้า" },
          { key: "cat", header: "หมวด" },
          { key: "unit", header: "หน่วย" },
          { key: "onhand", header: "คงเหลือ", align: "right" },
          { key: "status", header: "สถานะ", align: "center" },
        ]}
        rows={rows.map((p) => ({
          key: p.id,
          href: `/dc/office/products/${p.id}`,
          cells: {
            sel: (
              // stopPropagation กันคลิก checkbox แล้วเด้งเข้าหน้า detail (ทั้งแถวมี onClick นำทาง)
              <span onClick={(e) => e.stopPropagation()} style={{ display: "inline-flex" }}>
                <input
                  type="checkbox"
                  checked={selected.has(p.id)}
                  onChange={() => onToggle(p.id)}
                  aria-label={`เลือก ${p.name}`}
                  style={{ width: 18, height: 18, cursor: "pointer" }}
                />
              </span>
            ),
            name: (
              <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
                <DcThumb url={p.imageUrl} alt={p.name} size={30} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "var(--ink)" }}>{p.name}</div>
                  <div className="num" style={{ fontSize: 11, color: "var(--muted)" }}>{p.sku}</div>
                </div>
              </div>
            ),
            cat: (
              <span style={{ display: "inline-block", whiteSpace: "nowrap", fontSize: 11, fontWeight: 600, color: p.catC, background: p.catSoft, padding: "2px 9px", borderRadius: 6 }}>{p.catLabel}</span>
            ),
            unit: <span style={{ whiteSpace: "nowrap", color: "var(--ink2)" }}>{p.unit}</span>,
            onhand: <span className="num" style={{ fontWeight: 700, color: p.low ? "#DC5B53" : "var(--ink)" }}>{p.onhand}</span>,
            status: p.low ? (
              <span style={{ display: "inline-block", whiteSpace: "nowrap", fontSize: 11, fontWeight: 600, color: "#B45309", background: "#FEF1DE", padding: "2px 9px", borderRadius: 20 }}>ใกล้หมด</span>
            ) : (
              <span style={{ display: "inline-block", whiteSpace: "nowrap", fontSize: 11, fontWeight: 600, color: "#1F8A55", background: "#E1F0E8", padding: "2px 9px", borderRadius: 20 }}>ปกติ</span>
            ),
          },
        }))}
      />
    </div>
  );
}
