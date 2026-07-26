"use client";

// คอลัมน์ 1 — รายการบิล จัดกลุ่ม (ต้องตรวจ/ติดปัญหา/พร้อมโอน/จบแล้ว) + เลือกหลายใบ.
// pixel-locked จาก mockup "หน้าตรวจใบเสร็จ" (list rail region · 1440×900).
// ทุก inline-style คัดจาก mockup ตรง ๆ · ไม่มี write path ใหม่ — เรียก server action เดิม
// (sendExpensesToTrcloud / createPaymentRequestAction) แล้ว reload เมื่อสำเร็จ.
import { useMemo, useState, useTransition } from "react";
import { expenseConfirmability } from "@/lib/ledger/confirmability";
import { trcloudState } from "@/lib/ledger/trcloud-state";
import { sendExpensesToTrcloud, createPaymentRequestAction } from "../../_actions";
import { rrHref } from "./nav";
import type { ReceiptReviewData, RRExpenseRow } from "./types";

type GroupKey = "todo" | "block" | "pay" | "done";

const GROUP_META: Record<GroupKey, { label: string; color: string }> = {
  todo: { label: "ต้องตรวจก่อน", color: "#2563eb" },
  block: { label: "ติดปัญหา รอร้านตอบ", color: "#b45309" },
  pay: { label: "พร้อมตั้งขอโอน", color: "#0f766e" },
  done: { label: "จบแล้ว", color: "#64748b" },
};
const GROUP_ORDER: GroupKey[] = ["todo", "block", "pay", "done"];

// ปุ่มลัด 3 หน้าตา (mockup QSTYLE).
const QSTYLE = {
  primary: { fg: "#fff", bg: "#2563eb", border: "#2563eb" },
  dark: { fg: "#fff", bg: "#0f172a", border: "#0f172a" },
  ghost: { fg: "#475569", bg: "#fff", border: "#e2e8f0" },
} as const;

function fmtBaht(n: number): string {
  return `${Math.round(n).toLocaleString("en-US")} ฿`;
}

// docDate = ISO "YYYY-MM-DD" → "DD/MM" (เหมือน mockup "05/07").
function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const [, m, d] = iso.split("-");
  return d && m ? `${d}/${m}` : iso;
}

// ป้ายภาษีซื้อ (VAT tag) — อิง completenessStatus (แยกจาก confirm-gate โดยตั้งใจ).
function vatTag(cs: RRExpenseRow["completenessStatus"]): { text: string; fg: string; bg: string } {
  if (cs === "green_full") return { text: "ขอคืนได้", fg: "#059669", bg: "#ecfdf5" };
  if (cs === "yellow_partial" || cs === "red_invalid")
    return { text: "รอใบกำกับ", fg: "#b45309", bg: "#fffbeb" };
  return { text: "ไม่มี VAT", fg: "#64748b", bg: "#f1f5f9" };
}

// จัดกลุ่มต่อแถว — first match wins (ลำดับตาม GROUP_ORDER).
function groupOf(row: RRExpenseRow): GroupKey {
  const gateOk = expenseConfirmability({
    branchId: row.branchId,
    categoryId: row.categoryId,
  }).ok;
  const isDraft = row.status === "draft";
  const sentOrPaid =
    trcloudState(row.trcloudDocId) === "sent" ||
    row.payState === "paid" ||
    row.payState === "requested";
  // 1) ต้องตรวจก่อน
  if (isDraft && row.needsReview === true) return "todo";
  // 2) ติดปัญหา รอร้านตอบ
  if ((row.completenessStatus === "red_invalid" || !gateOk) && !sentOrPaid) return "block";
  // 3) พร้อมตั้งขอโอน
  if (row.payState !== "paid" && row.payState !== "requested" && gateOk && !isDraft) return "pay";
  // 4) จบแล้ว
  return "done";
}

// ข้อความ todo (สั้น) — ต่อกลุ่ม; done = สถานะสั้นจริงของแถว.
function todoTextOf(key: GroupKey, row: RRExpenseRow): string {
  if (key === "todo") return "ตรวจ + ยืนยัน";
  if (key === "block") return "รอใบกำกับ/สาขา-หมวด";
  if (key === "pay") return "พร้อมตั้งขอโอน";
  if (row.payState === "paid") return "โอนแล้ว";
  if (row.payState === "requested") return "รอโอน";
  if (trcloudState(row.trcloudDocId) === "sent") return "ส่ง TRCloud แล้ว";
  return "จบแล้ว";
}

export function RRListRail({
  data,
  onNavigate,
}: {
  data: ReceiptReviewData;
  onNavigate: (href: string) => void;
}) {
  const [selMode, setSelMode] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  const sendableSet = useMemo(() => new Set(data.sendableIds), [data.sendableIds]);

  // จัดบิลเข้ากลุ่ม (คงลำดับเดิมของ data.rows ในแต่ละกลุ่ม).
  const grouped = useMemo(() => {
    const buckets: Record<GroupKey, RRExpenseRow[]> = { todo: [], block: [], pay: [], done: [] };
    for (const row of data.rows) buckets[groupOf(row)].push(row);
    return buckets;
  }, [data.rows]);

  // สรุปหัวคอลัมน์ + แถบเลือกหลายใบ.
  const totalSum = useMemo(() => data.rows.reduce((a, r) => a + (r.total ?? 0), 0), [data.rows]);
  const selCount = sel.size;
  const selSum = useMemo(
    () => data.rows.filter((r) => sel.has(r.id)).reduce((a, r) => a + (r.total ?? 0), 0),
    [data.rows, sel],
  );

  function toggleSel(id: string) {
    setSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelMode() {
    setSelMode((v) => {
      if (v) setSel(new Set()); // ปิดโหมด → ล้างที่เลือก
      return !v;
    });
  }

  // "ส่งทั้งหมด" — ส่งเฉพาะใบที่เลือก ∩ ส่งได้ (sendableIds) เข้า TRCloud. ไม่มีใบส่งได้ = no-op.
  function sendAll() {
    if (pending) return;
    const ids = [...sel].filter((id) => sendableSet.has(id));
    if (ids.length === 0) return;
    startTransition(async () => {
      try {
        const res = await sendExpensesToTrcloud(ids, data.companyId);
        if (res.ok) window.location.reload();
      } catch {
        /* graceful — ไม่ทำอะไรร้ายแรง */
      }
    });
  }

  // ปุ่มลัด "ตั้งขอโอน" (กลุ่มพร้อมโอน) — ใช้ path เดียวกับ list mode (createPaymentRequestAction).
  function requestTransfer(id: string) {
    if (pending) return;
    startTransition(async () => {
      try {
        const res = await createPaymentRequestAction([id], {});
        if (res.ok) window.location.reload();
      } catch {
        /* graceful */
      }
    });
  }

  const subtitle = `${data.rows.length} รายการ · ${fmtBaht(totalSum)}`;

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #dfe3ea",
        borderRadius: 12,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      {/* Header strip */}
      <div
        style={{
          padding: "8px 11px",
          borderBottom: "1px solid #eef1f5",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <div style={{ fontSize: 12.5, fontWeight: 700 }}>ตรวจใบเสร็จ</div>
        <div
          style={{
            fontSize: 10.5,
            color: "#94a3b8",
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {subtitle}
        </div>
        <div
          onClick={toggleSelMode}
          className="rr-hb"
          style={{
            cursor: "pointer",
            fontSize: 10.5,
            fontWeight: 600,
            color: selMode ? "#fff" : "#475569",
            background: selMode ? "#2563eb" : "#fff",
            border: `1px solid ${selMode ? "#2563eb" : "#e2e8f0"}`,
            padding: "3px 8px",
            borderRadius: 6,
            whiteSpace: "nowrap",
          }}
        >
          {selMode ? "เสร็จ" : "เลือกหลายใบ"}
        </div>
      </div>

      {/* Select-mode bar */}
      {selMode && (
        <div
          style={{
            padding: "7px 10px",
            background: "#eff6ff",
            borderBottom: "1px solid #dbeafe",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <div className="rr-num" style={{ fontSize: 11, fontWeight: 700, color: "#1e3a8a", flex: 1 }}>
            เลือก {selCount} ใบ · {fmtBaht(selSum)}
          </div>
          <div
            onClick={sendAll}
            className="rr-bright"
            style={{
              cursor: "pointer",
              fontSize: 10.5,
              fontWeight: 700,
              color: "#fff",
              background: "#2563eb",
              padding: "4px 9px",
              borderRadius: 6,
              whiteSpace: "nowrap",
              opacity: pending ? 0.6 : 1,
            }}
          >
            ส่งทั้งหมด
          </div>
          <div
            onClick={() => setSel(new Set())}
            style={{
              cursor: "pointer",
              fontSize: 10.5,
              fontWeight: 600,
              color: "#475569",
              padding: "4px 6px",
              borderRadius: 6,
            }}
          >
            ล้าง
          </div>
        </div>
      )}

      {/* Scroll body — 4 groups (skip empty) */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 6 }}>
        {GROUP_ORDER.map((key) => {
          const items = grouped[key];
          if (items.length === 0) return null;
          const meta = GROUP_META[key];
          return (
            <div key={key}>
              {/* Group header */}
              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 4px 4px" }}>
                <div style={{ width: 5, height: 5, borderRadius: "50%", background: meta.color }} />
                <div
                  style={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    color: meta.color,
                    textTransform: "uppercase",
                    letterSpacing: ".03em",
                  }}
                >
                  {meta.label}
                </div>
                <div style={{ flex: 1, height: 1, background: "#eef1f5" }} />
                <div className="rr-num" style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600 }}>
                  {items.length}
                </div>
              </div>

              {/* Item cards */}
              {items.map((row) => {
                const active = data.filter.selected === row.id;
                const checked = sel.has(row.id);
                const vt = vatTag(row.completenessStatus);
                const pics = row.attachments?.length ?? 0;
                const dateCat = [fmtDate(row.docDate), row.categoryName || "ยังไม่เลือกหมวด"]
                  .filter(Boolean)
                  .join(" · ");
                const todoText = todoTextOf(key, row);
                const q = key === "pay" ? QSTYLE.dark : key === "done" ? QSTYLE.ghost : QSTYLE.primary;
                const qLabel = key === "pay" ? "ตั้งขอโอน" : key === "done" ? "เปิดดู" : "เปิดตรวจ";
                const selectBill = () => onNavigate(rrHref(data.baseParams, {}, row.id));
                const onQuick = (e: React.MouseEvent) => {
                  e.stopPropagation();
                  if (key === "pay") requestTransfer(row.id);
                  else selectBill();
                };
                return (
                  <div
                    key={row.id}
                    onClick={selectBill}
                    className="rr-hb"
                    style={{
                      cursor: "pointer",
                      padding: "7px 8px",
                      borderRadius: 10,
                      marginBottom: 5,
                      border: `1px solid ${active ? "#93c5fd" : "#eef1f5"}`,
                      background: active ? "#eff6ff" : "#fff",
                      position: "relative",
                    }}
                  >
                    {/* Row A — checkbox (selMode) + vendor + amount */}
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {selMode && (
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleSel(row.id);
                          }}
                          style={{
                            width: 15,
                            height: 15,
                            borderRadius: 4,
                            border: `1.5px solid ${checked ? "#2563eb" : "#cbd5e1"}`,
                            background: checked ? "#2563eb" : "#fff",
                            color: "#fff",
                            fontSize: 10,
                            fontWeight: 700,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flex: "none",
                            cursor: "pointer",
                          }}
                        >
                          {checked ? "✓" : ""}
                        </div>
                      )}
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          flex: 1,
                        }}
                      >
                        {row.vendor || "ไม่ระบุผู้ขาย"}
                      </div>
                      <div
                        className="rr-num"
                        style={{ fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}
                      >
                        {fmtBaht(row.total)}
                      </div>
                    </div>

                    {/* Row B — date · cat + pics badge + VAT tag */}
                    <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 3 }}>
                      <div
                        style={{
                          fontSize: 10,
                          color: "#94a3b8",
                          flex: 1,
                          minWidth: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {dateCat}
                      </div>
                      {pics > 0 && (
                        <div
                          style={{
                            fontSize: 9.5,
                            fontWeight: 600,
                            color: "#64748b",
                            background: "#f1f5f9",
                            padding: "1px 5px",
                            borderRadius: 4,
                            whiteSpace: "nowrap",
                          }}
                        >
                          🖼 {pics}
                        </div>
                      )}
                      <div
                        style={{
                          fontSize: 9.5,
                          fontWeight: 600,
                          whiteSpace: "nowrap",
                          color: vt.fg,
                          background: vt.bg,
                          padding: "1px 5px",
                          borderRadius: 4,
                        }}
                      >
                        {vt.text}
                      </div>
                    </div>

                    {/* Row C — todo text + quick-action */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        marginTop: 6,
                        paddingTop: 6,
                        borderTop: `1px solid ${active ? "#dbeafe" : "#f4f6f9"}`,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 10.5,
                          fontWeight: 700,
                          color: meta.color,
                          flex: 1,
                          minWidth: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {todoText}
                      </div>
                      <div
                        onClick={onQuick}
                        className="rr-bright6"
                        style={{
                          cursor: "pointer",
                          fontSize: 10.5,
                          fontWeight: 700,
                          color: q.fg,
                          background: q.bg,
                          border: `1px solid ${q.border}`,
                          padding: "3px 9px",
                          borderRadius: 6,
                          whiteSpace: "nowrap",
                          opacity: pending && key === "pay" ? 0.6 : 1,
                        }}
                      >
                        {qLabel}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
