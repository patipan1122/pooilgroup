"use client";

// ตัวกรอง (overlay มุมขวาบน) — ฟิลเตอร์รอง: หมวด · ภาษีซื้อ (สี) · แหล่งที่มา.
// กด pill = นำทางทันที (คงฟิลเตอร์อื่น + คง view). พอร์ตหน้าตาจาก mockup §C7.
import { useState } from "react";
import { rrHref } from "./nav";
import type { ReceiptReviewData } from "./types";

const CC_OPTS: Array<{ v: "green" | "yellow" | "red"; label: string; dot: string }> = [
  { v: "green", label: "ขอคืนได้", dot: "#059669" },
  { v: "yellow", label: "รอใบกำกับ", dot: "#b45309" },
  { v: "red", label: "ขอคืนไม่ได้", dot: "#dc2626" },
];
const SRC_OPTS: Array<{ v: string; label: string }> = [
  { v: "all", label: "ทั้งหมด" },
  { v: "line", label: "จาก LINE" },
  { v: "web", label: "เพิ่มเอง" },
  { v: "mine", label: "ของฉัน" },
];

function Pill({
  active,
  dot,
  label,
  href,
  onNavigate,
}: {
  active: boolean;
  dot?: string;
  label: string;
  href: string;
  onNavigate: (h: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onNavigate(href)}
      className="rr-hb"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 11.5,
        fontWeight: 600,
        padding: "4px 9px",
        borderRadius: 999,
        border: `1px solid ${active ? "#1e293b" : "#e2e8f0"}`,
        background: active ? "#1e293b" : "#f8fafc",
        color: active ? "#fff" : "#475569",
        whiteSpace: "nowrap",
      }}
    >
      {dot && (
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: dot, flex: "none" }} />
      )}
      {label}
    </button>
  );
}

export function RRFilterOverlay({
  data,
  onClose,
  onNavigate,
}: {
  data: ReceiptReviewData;
  onClose: () => void;
  onNavigate: (href: string) => void;
}) {
  const { baseParams, filter, categories } = data;
  const selected = filter.selected;
  const [catQuery, setCatQuery] = useState("");

  const activeCount = [filter.categoryId, filter.cc, filter.tab !== "all" ? filter.tab : null].filter(
    Boolean,
  ).length;

  const visibleCats = categories
    .filter((c) => c.active || c.id === filter.categoryId)
    .filter((c) => (catQuery ? c.name.toLowerCase().includes(catQuery.toLowerCase()) : true));

  const clearHref = rrHref(baseParams, { category: null, cc: null, tab: null, project: null }, selected);

  return (
    <div
      onClick={onClose}
      style={{ position: "absolute", inset: 0, background: "rgba(15,23,42,.28)", zIndex: 40 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "absolute",
          top: 100,
          right: 16,
          width: 392,
          maxHeight: 720,
          display: "flex",
          flexDirection: "column",
          background: "#fff",
          border: "1px solid #cbd5e1",
          borderRadius: 14,
          boxShadow: "0 22px 54px rgba(15,23,42,.28)",
          zIndex: 41,
          overflow: "hidden",
        }}
      >
        {/* header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "11px 13px",
            borderBottom: "1px solid #eef1f5",
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>ตัวกรอง ({activeCount})</div>
          <button
            type="button"
            onClick={onClose}
            className="rr-hb"
            style={{
              width: 26,
              height: 26,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "1px solid #e2e8f0",
              borderRadius: 8,
              background: "#fff",
              color: "#475569",
              fontSize: 13,
            }}
          >
            ✕
          </button>
        </div>

        {/* body */}
        <div style={{ flex: 1, overflowY: "auto", padding: 13, display: "flex", flexDirection: "column", gap: 14 }}>
          {/* หมวด */}
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b" }}>หมวดค่าใช้จ่าย</div>
            <input
              value={catQuery}
              onChange={(e) => setCatQuery(e.target.value)}
              placeholder="ค้นหาหมวด…"
              style={{
                fontSize: 12,
                padding: "6px 9px",
                border: "1px solid #e2e8f0",
                borderRadius: 9,
                background: "#f8fafc",
              }}
            />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              <Pill
                active={!filter.categoryId}
                label="ทุกหมวด"
                href={rrHref(baseParams, { category: null }, selected)}
                onNavigate={onNavigate}
              />
              {visibleCats.map((c) => (
                <Pill
                  key={c.id}
                  active={filter.categoryId === c.id}
                  dot={c.color ?? undefined}
                  label={c.name}
                  href={rrHref(baseParams, { category: c.id }, selected)}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          </div>

          {/* ภาษีซื้อ */}
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b" }}>ภาษีซื้อ</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              <Pill
                active={!filter.cc}
                label="ทั้งหมด"
                href={rrHref(baseParams, { cc: null }, selected)}
                onNavigate={onNavigate}
              />
              {CC_OPTS.map((o) => (
                <Pill
                  key={o.v}
                  active={filter.cc === o.v}
                  dot={o.dot}
                  label={o.label}
                  href={rrHref(baseParams, { cc: o.v }, selected)}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          </div>

          {/* แหล่งที่มา */}
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b" }}>แหล่งที่มา</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {SRC_OPTS.map((o) => (
                <Pill
                  key={o.v}
                  active={(filter.tab || "all") === o.v}
                  label={o.label}
                  href={rrHref(baseParams, { tab: o.v === "all" ? null : o.v }, selected)}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          </div>
        </div>

        {/* footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 13px",
            borderTop: "1px solid #eef1f5",
          }}
        >
          <button
            type="button"
            onClick={() => onNavigate(clearHref)}
            className="rr-hb"
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "#475569",
              padding: "8px 12px",
              border: "1px solid #e2e8f0",
              borderRadius: 10,
              background: "#fff",
            }}
          >
            ล้างตัวกรอง
          </button>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            onClick={onClose}
            className="rr-bright"
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: "#fff",
              padding: "8px 16px",
              border: "none",
              borderRadius: 10,
              background: "#0f172a",
            }}
          >
            ดูผลลัพธ์
          </button>
        </div>
      </div>
    </div>
  );
}
