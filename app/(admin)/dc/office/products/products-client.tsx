"use client";

// DC Redesign v2 · หน้าสินค้า (เนื้อใน) — การ์ด / ตาราง / กรองหมวด / ค้นหา / สแกน.
// ตรงตาม prototype DC Redesign v2.dc.html (isProducts) + เพิ่มมุมมอง "ตาราง" (CEO ขอ).
import { useState, useRef } from "react";
import Link from "next/link";
import { DataTable } from "@/components/ui/data-table";

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
}: { products: ProductRow[]; chips: CatChip[]; total: number; lowCount: number }) {
  const [view, setView] = useState<"grid" | "table">("grid");
  const [cat, setCat] = useState<string>("all");
  const [q, setQ] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [showSoldOut, setShowSoldOut] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

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
        <div style={{ display: "flex", gap: 10 }}>
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
            style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontSize: 13.5, fontFamily: "inherit", color: "var(--ink)" }}
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
        <GridView rows={filtered} />
      ) : (
        <TableView rows={filtered} />
      )}
    </div>
  );
}

function GridView({ rows }: { rows: ProductRow[] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(196px,1fr))", gap: 14, marginTop: 14 }}>
      {rows.map((p) => (
        <div key={p.id} className="dcx-card">
          <div style={{ position: "relative", aspectRatio: "1.35", background: p.catSoft, display: "flex", alignItems: "center", justifyContent: "center", color: p.catC, overflow: "hidden" }}>
            {p.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.imageUrl} alt={p.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <Svg size={40} sw={1.4}>{IcImage}</Svg>
            )}
            <span style={{ position: "absolute", top: 8, left: 8, fontSize: 10.5, fontWeight: 600, color: p.catC, background: p.catSoft, padding: "2px 8px", borderRadius: 6 }}>{p.catLabel}</span>
            {p.low ? <span style={{ position: "absolute", top: 8, right: 8, fontSize: 10, fontWeight: 700, color: "#fff", background: "#DC5B53", padding: "2px 8px", borderRadius: 20 }}>ใกล้หมด</span> : null}
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
            <Link href="/dc/issue" className="dcx-cardbtn issue" style={{ borderRight: "1px solid var(--border)" }}><Svg size={14}>{IcIssue}</Svg>ตัดจ่าย</Link>
            <Link href="/dc/transfer" className="dcx-cardbtn move" style={{ borderRight: "1px solid var(--border)" }}><Svg size={14}>{IcTransfer}</Svg>โอน</Link>
            <Link href={`/dc/office/products/${p.id}`} className="dcx-cardbtn" style={{ padding: "9px 11px", borderRight: "1px solid var(--border)" }}><Svg size={15}>{IcImage}</Svg></Link>
            <Link href={`/dc/office/products/${p.id}`} className="dcx-cardbtn" style={{ padding: "9px 11px" }}><Svg size={15} sw={2}>{IcKebab}</Svg></Link>
          </div>
        </div>
      ))}
    </div>
  );
}

// ตาราง — ใช้ <DataTable> จริง (real <table> w-full ใน overflow-x-auto, auto-sizing)
// แทน fake grid เดิม (fr/auto ไม่มี min-width:0 → คอลัมน์ยาวดันเหลื่อมซ้อน header).
function TableView({ rows }: { rows: ProductRow[] }) {
  return (
    <div style={{ marginTop: 14 }}>
      <DataTable
        columns={[
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
            name: (
              <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
                <span style={{ width: 30, height: 30, borderRadius: 8, background: p.catSoft, color: p.catC, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, overflow: "hidden" }}>
                  {p.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.imageUrl} alt={p.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    <Svg size={16} sw={1.5}>{IcImage}</Svg>
                  )}
                </span>
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
