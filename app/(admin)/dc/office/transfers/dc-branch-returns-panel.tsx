"use client";

// DC · หลังบ้าน · "รับคืนจากสาขา (รอรับ)" — client child ของ transfers/page.tsx (server).
//   • page.tsx (server) โหลด listPendingBranchReturnsForDc() → ส่ง rows มาเป็น props (ไม่มี query ที่นี่).
//   • คน DC กด "✓ รับคืนเข้าคลัง" → confirmBranchReturn(returnId) → ลงสต๊อก DC + ปิดใบ.
//   • สำเร็จ → เอาแถวออกทันที (optimistic) + router.refresh() ดึง list ใหม่.
//   • ★ ไม่มีปุ่ม "ยกเลิก" ฝั่ง DC — ยกเลิกเป็นสิทธิ์สาขาเท่านั้น (กัน confirm/cancel race).

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Loader2, Check, AlertTriangle, Undo2 } from "lucide-react";
import { confirmBranchReturn } from "@/lib/clawfleet/branch-return-actions";

export type BranchReturnRowVM = {
  id: string;
  returnCode: string;
  branchName: string;
  itemsCount: number;
  unitsCount: number;
  dispatchedAtLabel: string;
  note: string | null;
  lines: { productName: string; qty: number }[];
};

export function DcBranchReturnsPanel({ rows: initialRows }: { rows: BranchReturnRowVM[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<BranchReturnRowVM[]>(initialRows);
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<{ id: string; msg: string } | null>(null);

  function confirm(id: string) {
    setError(null);
    setConfirmingId(id);
    startTransition(async () => {
      const res = await confirmBranchReturn(id);
      if (!res.ok) { setError({ id, msg: res.error }); setConfirmingId(null); return; }
      // สำเร็จ (หรือรับไปแล้ว) → เอาออกจากลิสต์ทันที + ดึงใหม่ให้ตรงจริง
      setRows((prev) => prev.filter((r) => r.id !== id));
      setConfirmingId(null);
      router.refresh();
    });
  }

  if (rows.length === 0) return null; // ไม่มีของรอรับ → ไม่โชว์ section (page ตัดสินใจ header เอง)

  return (
    <div className="dc-card" style={{ padding: 0, overflowX: "auto", overflowY: "hidden" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: "left", color: "#71717a", background: "#fafafa" }}>
            <th style={{ ...cellHead, width: 36 }}></th>
            <th style={cellHead}>เลขที่</th>
            <th style={cellHead}>จากสาขา</th>
            <th style={{ ...cellHead, textAlign: "right" }}>รายการ</th>
            <th style={cellHead}>ส่งคืนเมื่อ</th>
            <th style={{ ...cellHead, textAlign: "right" }}>รับคืน</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const open = openId === r.id;
            const busy = pending && confirmingId === r.id;
            return (
              <Fragment key={r.id}>
                <tr
                  onClick={() => setOpenId(open ? null : r.id)}
                  style={{ borderTop: "1px solid var(--dc-line, #f0f0f2)", background: open ? "#f4f6fb" : "#fffbf5", cursor: "pointer" }}
                >
                  <td style={{ ...cell, width: 36, color: "#71717a" }}>
                    {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                  </td>
                  <td style={cell}>
                    <span style={{ fontWeight: 700, color: "var(--color-brand-700, #1d4ed8)", fontVariantNumeric: "tabular-nums" }}>{r.returnCode}</span>
                  </td>
                  <td style={{ ...cell, color: "#3f3f46", fontWeight: 600 }}>{r.branchName}</td>
                  <td style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#52525b" }}>
                    {r.itemsCount} รายการ · {r.unitsCount} ชิ้น
                  </td>
                  <td style={{ ...cell, color: "#52525b", fontVariantNumeric: "tabular-nums" }}>{r.dispatchedAtLabel}</td>
                  <td style={{ ...cell, textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => confirm(r.id)}
                      disabled={pending}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 5, border: "none", borderRadius: 9,
                        background: pending ? "#a7f3d0" : "#059669", color: "#fff", fontSize: 13, fontWeight: 700,
                        padding: "8px 13px", cursor: pending ? "not-allowed" : "pointer", whiteSpace: "nowrap",
                      }}
                    >
                      {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} รับคืนเข้าคลัง
                    </button>
                  </td>
                </tr>
                {error && error.id === r.id && (
                  <tr>
                    <td colSpan={6} style={{ padding: "0 14px 10px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#b91c1c", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "8px 12px" }}>
                        <AlertTriangle size={15} style={{ flex: "0 0 15px" }} /> {error.msg}
                      </div>
                    </td>
                  </tr>
                )}
                {open && (
                  <tr>
                    <td colSpan={6} style={{ padding: 0 }}>
                      <div style={{ padding: "12px 14px 14px", background: "#fafafa", borderTop: "1px dashed var(--dc-line, #e7ebf2)" }}>
                        {r.note && <div style={{ fontSize: 13, color: "#52525b", marginBottom: 10 }}>หมายเหตุ: {r.note}</div>}
                        <div style={{ overflowX: "auto" }}>
                          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                            <thead>
                              <tr style={{ textAlign: "left", color: "#71717a" }}>
                                <th style={lineHead}>สินค้า</th>
                                <th style={{ ...lineHead, textAlign: "right" }}>จำนวนคืน</th>
                              </tr>
                            </thead>
                            <tbody>
                              {r.lines.map((l, i) => (
                                <tr key={i} style={{ borderTop: "1px solid #eef0f3" }}>
                                  <td style={lineCell}>{l.productName}</td>
                                  <td style={{ ...lineCell, textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#52525b" }}>{l.qty}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 14px", fontSize: 12, color: "#9a3412", background: "#fff7ed", borderTop: "1px solid #fed7aa" }}>
        <Undo2 size={13} /> กด “รับคืนเข้าคลัง” = ของเข้าสต๊อกคลังกลางทันที · ยกเลิกได้เฉพาะฝั่งสาขา (ก่อน DC รับ)
      </div>
    </div>
  );
}

const cell: React.CSSProperties = { padding: "12px 14px", verticalAlign: "middle" };
const cellHead: React.CSSProperties = { padding: "10px 14px", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" };
const lineHead: React.CSSProperties = { padding: "6px 10px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" };
const lineCell: React.CSSProperties = { padding: "8px 10px", verticalAlign: "middle" };
