"use client";

// DC · ใบสั่งซื้อจีน — มุมมอง "ตาราง" (มุมมองที่ 3 ของ workspace):
//   ทุกใบเรียงเป็นแถวแบบ Excel: ชื่อออเดอร์/ผู้ขาย · วันสั่ง · คาดว่าจะถึง · สถานะ · ยอด(ต้นทาง ¥/฿) · ยอด(บาท)
//   แถวล่างสุด = ยอดรวมบาททั้งหมด (แปลง ¥→฿ ด้วยเรตของแต่ละใบ ที่ server คิดมาให้)
//   ปุ่ม "ส่งออก Excel" → ไฟล์ CSV (BOM · เปิด Excel/Sheets ภาษาไทยไม่เพี้ยน) — export ตามที่กรองอยู่บนจอ
//   อ่านล้วน · ไม่เขียน DB/ไม่แตะเงิน/ไม่แตะ TRCloud.

import { useMemo, useState } from "react";
import Link from "next/link";
import { Download, Ship, Truck } from "lucide-react";
import { PO_STATUS_LABEL, PO_STATUS_TONE, PO_FLOW_STATUSES, PO_ORIGIN_LABEL } from "@/lib/dc/nav";
import {
  type PoListItem,
  fmtMoney,
  fmtDate,
  moneySym,
  needsInput,
  arrivalEstimate,
  shipModeLabel,
} from "./purchasing-workspace";

const ALL = "__ALL__";

// ยุบ READY_TO_RECEIVE → AT_WAREHOUSE ให้ตรงกับมุมมองอื่น (ไม่งั้นใบเก่านับตกหล่นในชิปกรอง)
const foldStatus = (s: string) => (s === "READY_TO_RECEIVE" ? "AT_WAREHOUSE" : s);
const tone = (status: string): string => PO_STATUS_TONE[status] ?? "draft";

/** ชื่อออเดอร์: ใช้ title ที่ตั้งไว้ก่อน ไม่มี→ชื่อผู้ขาย ไม่มี→ขีด. */
function orderName(it: PoListItem): string {
  return it.title?.trim() || it.supplierName || "— ไม่ระบุ —";
}
/** ข้อความ "คาดว่าจะถึง" สั้น ๆ (ตัดคำว่า "คาดถึง " ออกให้เหลือช่วงวัน). */
function arrivalText(it: PoListItem): string {
  const est = arrivalEstimate(it);
  if (est) return `${shipModeLabel(it.shipMode)} ${est.label.replace(/^คาดถึง\s*/, "")}`.trim();
  if (needsInput(it)) return "รอเลขพัสดุ";
  return "—";
}

function csvEscape(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function TableView({ items }: { items: PoListItem[] }) {
  const [filter, setFilter] = useState<string>(ALL);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const it of items) {
      const st = foldStatus(it.status);
      c[st] = (c[st] ?? 0) + 1;
    }
    return c;
  }, [items]);

  const rows = useMemo(
    () => (filter === ALL ? items : items.filter((it) => foldStatus(it.status) === filter)),
    [items, filter],
  );

  // ยอดรวมบาท (เฉพาะใบที่แปลงบาทได้) + นับใบที่ยังไม่มีเรต (โชว์หมายเหตุ)
  const { sumThb, missingFx } = useMemo(() => {
    let s = 0;
    let miss = 0;
    for (const it of rows) {
      if (it.totalThb == null) miss += 1;
      else s += it.totalThb;
    }
    return { sumThb: s, missingFx: miss };
  }, [rows]);

  function exportCsv() {
    const HEADERS = ["ชื่อออเดอร์", "เลขใบ", "ผู้ขาย", "ที่มา", "จำนวนรายการ", "สถานะ", "วันสั่ง", "คาดว่าจะถึง", "สกุลเงิน", "ยอด (ต้นทาง)", "ยอด (บาท)"];
    const lines: string[] = [];
    lines.push(HEADERS.map(csvEscape).join(","));
    for (const it of rows) {
      const cur = moneySym(it) === "฿" ? "THB" : "CNY";
      lines.push(
        [
          orderName(it),
          it.poCode,
          it.supplierName ?? "",
          PO_ORIGIN_LABEL[it.origin] ?? it.origin,
          it.lineCount,
          PO_STATUS_LABEL[it.status] ?? it.status,
          fmtDate(it.orderedAt ?? it.date),
          arrivalText(it),
          cur,
          it.total.toFixed(2),
          it.totalThb != null ? it.totalThb.toFixed(2) : "",
        ]
          .map(csvEscape)
          .join(","),
      );
    }
    // แถวรวมท้ายตาราง
    lines.push(["รวม", `${rows.length} ใบ`, "", "", "", "", "", "", "THB", "", sumThb.toFixed(2)].map(csvEscape).join(","));

    const csv = "﻿" + lines.join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const stamp = fmtDate(new Date().toISOString()).replace(/\s/g, "");
    a.download = `dc-ใบสั่งซื้อ_${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="dc-pur-table">
      {/* แถวบน: ชิปกรองสถานะ + ปุ่มส่งออก */}
      <div style={topBar}>
        <div className="dc-chips" role="tablist" aria-label="กรองสถานะใบสั่งซื้อ" style={{ marginBottom: 0 }}>
          <button
            type="button"
            role="tab"
            aria-selected={filter === ALL}
            className={`dc-chip${filter === ALL ? " is-active" : ""}`}
            onClick={() => setFilter(ALL)}
          >
            ทั้งหมด <span style={{ opacity: 0.7 }}>· {items.length}</span>
          </button>
          {PO_FLOW_STATUSES.map((s) =>
            counts[s] ? (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={filter === s}
                className={`dc-chip${filter === s ? " is-active" : ""}`}
                onClick={() => setFilter(s)}
              >
                {PO_STATUS_LABEL[s] ?? s} <span style={{ opacity: 0.7 }}>· {counts[s]}</span>
              </button>
            ) : null,
          )}
        </div>
        <button
          type="button"
          className="dc-btn-xl dc-btn-xl--ghost"
          onClick={exportCsv}
          disabled={rows.length === 0}
          style={exportBtn}
          title="ส่งออกตารางเป็นไฟล์ Excel (CSV)"
        >
          <Download size={16} /> ส่งออก Excel
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="dc-card dc-pur-md__placeholder">ไม่มีใบสั่งซื้อในสถานะนี้</div>
      ) : (
        <div style={scrollWrap}>
          <table style={table}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: "left" }}>ออเดอร์</th>
                <th style={th}>วันสั่ง</th>
                <th style={th}>คาดว่าจะถึง</th>
                <th style={th}>สถานะ</th>
                <th style={{ ...th, textAlign: "right" }}>ยอด (ต้นทาง)</th>
                <th style={{ ...th, textAlign: "right" }}>ยอด (บาท)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((it) => {
                const isThai = it.origin === "THAI";
                const ModeIcon = it.shipMode === "TRUCK" ? Truck : Ship;
                const est = arrivalEstimate(it);
                return (
                  <tr key={it.id} style={tr} className="dc-pur-table__row">
                    {/* ออเดอร์: ชื่อ (title) + เลขใบ · ผู้ขาย · รายการ */}
                    <td style={{ ...td, textAlign: "left" }}>
                      <Link href={`/dc/office/purchasing/${it.id}`} style={rowLink}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                          <span
                            aria-hidden
                            title={PO_ORIGIN_LABEL[it.origin] ?? it.origin}
                            style={{ flex: "0 0 auto", width: 7, height: 7, borderRadius: 999, background: isThai ? "#167a41" : "#2456b8" }}
                          />
                          <span style={{ fontWeight: 600, color: "var(--dc-ink,#1c2533)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {orderName(it)}
                          </span>
                        </span>
                        <span style={{ fontSize: 11.5, color: "var(--dc-muted,#5b6676)", fontVariantNumeric: "tabular-nums", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {it.poCode}
                          {it.supplierName ? ` · ${it.supplierName}` : ""} · {it.lineCount} รก.
                          {it.boxCount > 0 ? ` · ${it.boxCount} กล่อง` : ""}
                        </span>
                      </Link>
                    </td>
                    {/* วันสั่ง */}
                    <td style={td}>
                      <span style={{ fontVariantNumeric: "tabular-nums", color: "var(--dc-ink,#1c2533)" }}>
                        {fmtDate(it.orderedAt ?? it.date)}
                      </span>
                    </td>
                    {/* คาดว่าจะถึง */}
                    <td style={td}>
                      {est ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "#1d4ed8", fontWeight: 600, fontSize: 12.5 }}>
                          <ModeIcon size={12} aria-hidden />
                          {shipModeLabel(it.shipMode)} {est.label.replace(/^คาดถึง\s*/, "")}
                        </span>
                      ) : needsInput(it) ? (
                        <span style={{ color: "var(--dc-muted,#5b6676)", fontSize: 12.5 }}>รอเลขพัสดุ</span>
                      ) : (
                        <span style={{ color: "var(--dc-muted,#9aa4b2)" }}>—</span>
                      )}
                    </td>
                    {/* สถานะ */}
                    <td style={td}>
                      <span className={`dc-st dc-st--${tone(it.status)}`} style={{ fontSize: 11.5, padding: "2px 9px" }}>
                        {PO_STATUS_LABEL[it.status] ?? it.status}
                      </span>
                    </td>
                    {/* ยอด (ต้นทาง) */}
                    <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600, color: "var(--dc-ink,#1c2533)" }}>
                      {moneySym(it)}
                      {fmtMoney(it.total, 2)}
                    </td>
                    {/* ยอด (บาท) */}
                    <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: "var(--dc-ink,#1c2533)" }}>
                      {it.totalThb != null ? `฿${fmtMoney(it.totalThb, 2)}` : <span style={{ color: "var(--dc-muted,#9aa4b2)", fontWeight: 400 }}>—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td style={{ ...tfootTd, textAlign: "left", fontWeight: 700 }}>รวม {rows.length} ใบ</td>
                <td style={tfootTd} colSpan={3} />
                <td style={{ ...tfootTd, textAlign: "right", color: "var(--dc-muted,#5b6676)", fontSize: 12 }}>ยอดรวม (บาท)</td>
                <td style={{ ...tfootTd, textAlign: "right", fontWeight: 800, fontSize: 15, fontVariantNumeric: "tabular-nums" }}>
                  ฿{fmtMoney(sumThb, 2)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {missingFx > 0 && (
        <p style={{ margin: "8px 2px 0", fontSize: 12, color: "var(--dc-muted,#5b6676)" }}>
          * มี {missingFx} ใบจีนที่ยังไม่ได้ตั้งเรต — ยังไม่รวมในยอดบาท
        </p>
      )}
    </div>
  );
}

// ── styles ───────────────────────────────────────────────────
const topBar: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap",
  marginBottom: 12,
};
const exportBtn: React.CSSProperties = {
  width: "auto",
  minHeight: 40,
  padding: "0 15px",
  fontSize: 14,
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  flex: "0 0 auto",
};
const scrollWrap: React.CSSProperties = {
  overflowX: "auto",
  border: "1px solid var(--dc-line,#e7ebf2)",
  borderRadius: 12,
  background: "#fff",
};
const table: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 13.5,
  minWidth: 640,
};
const th: React.CSSProperties = {
  textAlign: "center",
  padding: "10px 12px",
  fontSize: 12,
  fontWeight: 700,
  color: "var(--dc-muted,#5b6676)",
  background: "var(--color-brand-50,#f7faff)",
  borderBottom: "1px solid var(--dc-line,#e7ebf2)",
  whiteSpace: "nowrap",
  position: "sticky",
  top: 0,
};
const tr: React.CSSProperties = {
  borderBottom: "1px solid var(--dc-line,#eef1f6)",
};
const td: React.CSSProperties = {
  padding: "9px 12px",
  textAlign: "center",
  verticalAlign: "middle",
  whiteSpace: "nowrap",
};
const tfootTd: React.CSSProperties = {
  padding: "11px 12px",
  textAlign: "center",
  background: "var(--color-brand-50,#f7faff)",
  borderTop: "2px solid var(--dc-line,#e7ebf2)",
};
const rowLink: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 1,
  textDecoration: "none",
  minWidth: 0,
  maxWidth: 280,
};
