"use client";

// DC · รายการใบสั่งซื้อ (client) — 2 มุมมอง:
//   • รายการ (list): การ์ดชื่อร้าน/ผู้ขาย กดกาง (accordion) → เห็นสินค้าในใบ + จำนวนกล่อง
//   • Kanban: คอลัมน์ตามสถานะ (PO_FLOW_STATUSES) การ์ดเล็กลิงก์ไปหน้ารายละเอียด
// แท็บกรองสถานะ (ชิป) + ปุ่มสลับมุมมอง + ปุ่ม "＋ สั่งซื้อ" (เลือกจีน/ไทย).
// อ่านอย่างเดียว — ไม่มี action ที่นี่ (action อยู่หน้ารายละเอียด).

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, Plus, LayoutGrid, List as ListIcon, Package, ChevronRight } from "lucide-react";
import {
  PO_STATUS_LABEL,
  PO_STATUS_TONE,
  PO_FLOW_STATUSES,
  PO_ORIGIN_LABEL,
} from "@/lib/dc/nav";

export type PoListLine = {
  id: string;
  name: string;
  sku: string;
  qty: number;
  unitPrice: number;
};

export type PoListItem = {
  id: string;
  poCode: string;
  status: string;
  origin: string;
  currency: string;
  supplierName: string | null;
  total: number;
  lineCount: number;
  boxCount: number;
  date: string; // ISO
  lines: PoListLine[];
};

const ALL = "__ALL__";

function fmt(n: number, d = 2): string {
  return new Intl.NumberFormat("th-TH", { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
}
function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat("th-TH", { day: "2-digit", month: "short", year: "2-digit" }).format(new Date(iso));
}
/** สัญลักษณ์เงินตาม origin: จีน=¥ · ไทย=฿ (fallback ดูจาก currency). */
function sym(item: { origin: string; currency: string }): string {
  if (item.origin === "THAI" || item.currency === "THB") return "฿";
  return "¥";
}
function tone(status: string): string {
  return PO_STATUS_TONE[status] ?? "draft";
}

export function PoListView({ items }: { items: PoListItem[] }) {
  const [view, setView] = useState<"list" | "kanban">("list");
  const [filter, setFilter] = useState<string>(ALL);

  // นับจำนวนต่อสถานะ (ไว้โชว์บนชิป) — รวมทุกสถานะที่มีจริง
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const it of items) c[it.status] = (c[it.status] ?? 0) + 1;
    return c;
  }, [items]);

  const filtered = useMemo(
    () => (filter === ALL ? items : items.filter((it) => it.status === filter)),
    [items, filter],
  );

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {/* แถวบน: ปุ่มสั่งซื้อ (จีน/ไทย) + สลับมุมมอง */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <NewPoButton />
        <ViewToggle view={view} onChange={setView} />
      </div>

      {/* แท็บกรองสถานะ (ชิป) */}
      <div className="dc-chips" role="tablist" aria-label="กรองสถานะใบสั่งซื้อ">
        <button
          type="button"
          role="tab"
          aria-selected={filter === ALL}
          className={`dc-chip${filter === ALL ? " is-active" : ""}`}
          onClick={() => setFilter(ALL)}
        >
          ทั้งหมด <span style={{ opacity: 0.7 }}>· {items.length}</span>
        </button>
        {PO_FLOW_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={filter === s}
            className={`dc-chip${filter === s ? " is-active" : ""}`}
            onClick={() => setFilter(s)}
          >
            {PO_STATUS_LABEL[s] ?? s}
            {counts[s] ? <span style={{ opacity: 0.7 }}> · {counts[s]}</span> : null}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <div className="dc-card" style={{ textAlign: "center", color: "var(--dc-muted, #71717a)", padding: "40px 16px" }}>
          ยังไม่มีใบสั่งซื้อ — กด “＋ สั่งซื้อ” เพื่อสร้างใบแรก
        </div>
      ) : view === "list" ? (
        <ListView items={filtered} />
      ) : (
        <KanbanView items={items} />
      )}
    </div>
  );
}

// ── ปุ่มสั่งซื้อ + เลือกจีน/ไทย ───────────────────────────────
function NewPoButton() {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        className="dc-btn-xl"
        style={{ width: "auto", minHeight: 44, padding: "0 18px", fontSize: 15, display: "inline-flex", alignItems: "center", gap: 8 }}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <Plus size={18} /> สั่งซื้อ
      </button>
      {open && (
        <>
          {/* คลิกที่อื่นเพื่อปิด */}
          <div style={{ position: "fixed", inset: 0, zIndex: 20 }} onClick={() => setOpen(false)} />
          <div
            role="menu"
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              left: 0,
              zIndex: 21,
              background: "#fff",
              border: "1px solid var(--dc-line, #e4e4e7)",
              borderRadius: 12,
              boxShadow: "0 8px 28px rgba(0,0,0,0.12)",
              padding: 6,
              minWidth: 200,
              display: "grid",
              gap: 4,
            }}
          >
            <Link href="/dc/office/purchasing/new?origin=china" role="menuitem" className="dc-newpo-item" onClick={() => setOpen(false)}>
              <span style={{ fontSize: 18 }}>🇨🇳</span>
              <span><b>สั่งจากจีน</b><br /><span style={{ fontSize: 12, color: "#71717a" }}>ราคาเป็นหยวน (¥) · มีกล่อง/CBM</span></span>
            </Link>
            <Link href="/dc/office/purchasing/new?origin=thai" role="menuitem" className="dc-newpo-item" onClick={() => setOpen(false)}>
              <span style={{ fontSize: 18 }}>🇹🇭</span>
              <span><b>ซื้อในไทย</b><br /><span style={{ fontSize: 12, color: "#71717a" }}>ราคาเป็นบาท (฿)</span></span>
            </Link>
          </div>
        </>
      )}
      <style>{`
        .dc-newpo-item { display:flex; align-items:center; gap:10px; padding:9px 10px; border-radius:9px; color:#18181b; }
        .dc-newpo-item:hover { background: var(--color-brand-50, #eff4fe); }
      `}</style>
    </div>
  );
}

// ── สลับมุมมอง List ⇄ Kanban ──────────────────────────────────
function ViewToggle({ view, onChange }: { view: "list" | "kanban"; onChange: (v: "list" | "kanban") => void }) {
  return (
    <div className="dc-subtabs" style={{ marginBottom: 0, border: "none", gap: 4 }} role="tablist" aria-label="สลับมุมมอง">
      <button
        type="button"
        role="tab"
        aria-selected={view === "list"}
        className={`dc-chip${view === "list" ? " is-active" : ""}`}
        style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
        onClick={() => onChange("list")}
      >
        <ListIcon size={15} /> รายการ
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={view === "kanban"}
        className={`dc-chip${view === "kanban" ? " is-active" : ""}`}
        style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
        onClick={() => onChange("kanban")}
      >
        <LayoutGrid size={15} /> Kanban
      </button>
    </div>
  );
}

// ── มุมมองรายการ (accordion การ์ดชื่อร้าน) ─────────────────────
function ListView({ items }: { items: PoListItem[] }) {
  if (items.length === 0) {
    return (
      <div className="dc-card" style={{ textAlign: "center", color: "var(--dc-muted, #71717a)", padding: "32px 16px" }}>
        ไม่มีใบสั่งซื้อในสถานะนี้
      </div>
    );
  }
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {items.map((it) => (
        <PoCard key={it.id} item={it} />
      ))}
    </div>
  );
}

function PoCard({ item }: { item: PoListItem }) {
  const [open, setOpen] = useState(false);
  const s = sym(item);
  return (
    <div className="dc-card" style={{ padding: 0, overflow: "hidden" }}>
      {/* หัวการ์ด: กดกาง */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "14px 16px",
          background: "transparent",
          border: "none",
          textAlign: "left",
          cursor: "pointer",
        }}
      >
        <ChevronDown
          size={18}
          style={{ color: "#a1a1aa", transition: "transform .15s", transform: open ? "rotate(0deg)" : "rotate(-90deg)", flexShrink: 0 }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 750, fontSize: 16, color: "#18181b" }}>{item.supplierName ?? "— ไม่ระบุผู้ขาย —"}</span>
            <span className={`dc-st dc-st--${item.origin === "THAI" ? "ok" : "ship"}`} style={{ fontSize: 11 }}>
              {PO_ORIGIN_LABEL[item.origin] ?? item.origin}
            </span>
          </div>
          <div style={{ fontSize: 12.5, color: "#71717a", marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
            {item.poCode} · {item.lineCount} รายการ
            {item.boxCount > 0 && <> · {item.boxCount} กล่อง</>} · {fmtDate(item.date)}
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 15, fontVariantNumeric: "tabular-nums", color: "#18181b" }}>
            {s}{fmt(item.total)}
          </div>
          <span className={`dc-st dc-st--${tone(item.status)}`} style={{ marginTop: 4 }}>
            {PO_STATUS_LABEL[item.status] ?? item.status}
          </span>
        </div>
      </button>

      {/* เนื้อหากาง: รายการสินค้า + ลิงก์ไปหน้ารายละเอียด */}
      {open && (
        <div style={{ borderTop: "1px solid var(--dc-line, #f0f0f2)", padding: "12px 16px", background: "#fcfcfd" }}>
          {item.lines.length === 0 ? (
            <div style={{ fontSize: 13, color: "#a1a1aa" }}>ยังไม่มีรายการในใบนี้</div>
          ) : (
            <div style={{ display: "grid", gap: 6 }}>
              {item.lines.map((l) => (
                <div
                  key={l.id}
                  style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 13.5, fontVariantNumeric: "tabular-nums" }}
                >
                  <span style={{ flex: 1, minWidth: 0, color: "#27272a" }}>{l.name}</span>
                  <span style={{ color: "#71717a", whiteSpace: "nowrap" }}>× {l.qty}</span>
                  <span style={{ color: "#71717a", whiteSpace: "nowrap", minWidth: 84, textAlign: "right" }}>
                    {s}{fmt(l.unitPrice)}
                  </span>
                  <span style={{ fontWeight: 600, whiteSpace: "nowrap", minWidth: 96, textAlign: "right" }}>
                    {s}{fmt(l.qty * l.unitPrice)}
                  </span>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, gap: 12, flexWrap: "wrap" }}>
            <div style={{ fontSize: 12.5, color: "#71717a", display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Package size={14} /> {item.boxCount > 0 ? `${item.boxCount} กล่อง/พัสดุ` : "ยังไม่มีกล่อง"}
            </div>
            <Link
              href={`/dc/office/purchasing/${item.id}`}
              style={{ fontSize: 13.5, fontWeight: 600, color: "var(--color-brand-700, #1d4ed8)", display: "inline-flex", alignItems: "center", gap: 4 }}
            >
              เปิดใบ · จัดการกล่อง · เปลี่ยนสถานะ <ChevronRight size={15} />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

// ── มุมมอง Kanban (คอลัมน์ตามสถานะ) ───────────────────────────
function KanbanView({ items }: { items: PoListItem[] }) {
  const byStatus = useMemo(() => {
    const m: Record<string, PoListItem[]> = {};
    for (const s of PO_FLOW_STATUSES) m[s] = [];
    for (const it of items) {
      if (m[it.status]) m[it.status].push(it);
      // สถานะนอก flow (PARTIAL/CLOSED/CANCELLED) ไม่แสดงเป็นคอลัมน์ใน Kanban
    }
    return m;
  }, [items]);

  return (
    <div className="dc-kanban">
      {PO_FLOW_STATUSES.map((s) => {
        const col = byStatus[s] ?? [];
        return (
          <div key={s} className="dc-kanban__col">
            <div className="dc-kanban__head">
              <span>{PO_STATUS_LABEL[s] ?? s}</span>
              <span style={{ color: "#a1a1aa" }}>{col.length}</span>
            </div>
            {col.length === 0 ? (
              <div style={{ fontSize: 12, color: "#c4c4cc", padding: "6px 2px" }}>—</div>
            ) : (
              col.map((it) => <KanbanCard key={it.id} item={it} />)
            )}
          </div>
        );
      })}
    </div>
  );
}

function KanbanCard({ item }: { item: PoListItem }) {
  const s = sym(item);
  return (
    <Link href={`/dc/office/purchasing/${item.id}`} className="dc-kanban__card" style={{ display: "block", color: "inherit" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 13.5, color: "#18181b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {item.supplierName ?? "— ไม่ระบุ —"}
        </span>
        <span className={`dc-st dc-st--${item.origin === "THAI" ? "ok" : "ship"}`} style={{ fontSize: 10.5, padding: "2px 7px", flexShrink: 0 }}>
          {PO_ORIGIN_LABEL[item.origin] ?? item.origin}
        </span>
      </div>
      <div style={{ fontSize: 11.5, color: "#71717a", marginTop: 3, fontVariantNumeric: "tabular-nums" }}>
        {item.poCode} · {item.lineCount} รายการ{item.boxCount > 0 ? ` · ${item.boxCount} กล่อง` : ""}
      </div>
      <div style={{ fontWeight: 800, fontSize: 14, marginTop: 6, fontVariantNumeric: "tabular-nums", color: "#18181b" }}>
        {s}{fmt(item.total)}
      </div>
    </Link>
  );
}
