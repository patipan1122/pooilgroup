"use client";

/**
 * ตารางข้อมูลดิบมิเตอร์ (Raw readings) — โหมดที่ 3 ของรายงานเจาะสาขา.
 * 1 แถว = 1 รายการที่พนักงานกรอกจริง (ตั้งต้น + รอบเก็บ) ของทั้งสาขา ในหน้าเดียว แบบ Excel.
 * แอดมิน/ผจก. กด "แก้" ที่แถวรอบเก็บ → แก้เลขเฟือง/ดิจิตอล/เงิน (adminEditCollectionEvent · money-safe).
 * ยอดตั้งต้น (baseline) ดูได้แต่แก้ที่นี่ไม่ได้ (ต้องแก้ผ่านเมนูตั้งค่าตู้ · กระทบลูกโซ่ทั้งเส้น).
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, ImageIcon, AlertTriangle, Download, X } from "lucide-react";
import { Modal, EmptyState } from "@/components/clawfleet/os/kit";
import { bahtN } from "@/components/clawfleet/os/format";
import { adminEditCollectionEvent } from "@/lib/clawfleet/actions";
import type { RawReadingRow } from "@/lib/clawfleet/raw-readings-queries";

const nfmt = (n: number | null | undefined): string =>
  n == null ? "—" : n.toLocaleString("en-US");

/** เซลล์ ก่อน→หลัง + ผลต่าง (delta) — baseline ไม่มี "ก่อน" → โชว์ค่าตั้งต้นเดี่ยว */
function BeforeAfter({ before, after }: { before: number | null; after: number | null }) {
  if (after == null && before == null) return <span style={{ color: "#C2C7CF" }}>—</span>;
  if (before == null) {
    return <span style={{ fontWeight: 600, color: "#1A1D21" }}>{nfmt(after)}</span>;
  }
  const delta = after != null ? after - before : null;
  return (
    <span style={{ whiteSpace: "nowrap" }}>
      <span style={{ color: "#9AA1AB" }}>{nfmt(before)}</span>
      <span style={{ color: "#C2C7CF", margin: "0 3px" }}>→</span>
      <span style={{ fontWeight: 600, color: "#1A1D21" }}>{nfmt(after)}</span>
      {delta != null && (
        <span style={{ marginLeft: 5, fontSize: 10.5, fontWeight: 700, color: delta < 0 ? "#B42318" : "#15803D" }}>
          {delta >= 0 ? "+" : ""}
          {delta.toLocaleString("en-US")}
        </span>
      )}
    </span>
  );
}

const TH: React.CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 2,
  background: "#F7F8FA",
  padding: "8px 10px",
  fontSize: 10.5,
  fontWeight: 700,
  color: "#5A6270",
  borderBottom: "1px solid #E3E6EA",
  borderRight: "1px solid #F0F1F4",
  whiteSpace: "nowrap",
  textAlign: "center",
};
const TD: React.CSSProperties = {
  padding: "7px 10px",
  fontSize: 12,
  borderBottom: "1px solid #F0F1F4",
  borderRight: "1px solid #F4F5F7",
  whiteSpace: "nowrap",
  textAlign: "center",
};

type EditTarget = {
  row: RawReadingRow;
  cash: string;
  coinDigital: string;
  coinGear: string;
  dollDigital: string;
  dollGear: string;
};

export function RawReadingsClient({
  rows,
  canEdit,
  branchName,
  total,
  truncated,
}: {
  rows: RawReadingRow[];
  canEdit: boolean;
  branchName: string;
  total: number;
  truncated: boolean;
}) {
  const router = useRouter();
  const [lightbox, setLightbox] = useState<{ url: string; label: string } | null>(null);
  const [edit, setEdit] = useState<EditTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const counts = useMemo(() => {
    let init = 0;
    let coll = 0;
    for (const r of rows) {
      if (r.kind === "INITIAL") init++;
      else coll++;
    }
    return { init, coll };
  }, [rows]);

  function openEdit(row: RawReadingRow) {
    setErr(null);
    setEdit({
      row,
      cash: String(row.cashBaht),
      coinDigital: String(row.coinDigital),
      coinGear: row.coinGear == null ? "" : String(row.coinGear),
      dollDigital: row.dollDigital == null ? "" : String(row.dollDigital),
      dollGear: row.dollGear == null ? "" : String(row.dollGear),
    });
  }

  async function saveEdit() {
    if (!edit) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await adminEditCollectionEvent({
        eventId: edit.row.eventId,
        cashCents: Math.round((Number(edit.cash) || 0) * 100),
        coinMeterAfter: Math.round(Number(edit.coinDigital) || 0),
        dollMeterAfter: edit.dollDigital === "" ? null : Math.round(Number(edit.dollDigital) || 0),
        coinMeterTop: edit.coinGear === "" ? null : Math.round(Number(edit.coinGear) || 0),
        dollMeterTop: edit.dollGear === "" ? null : Math.round(Number(edit.dollGear) || 0),
      });
      if (!res.ok) {
        setErr(res.error || "แก้ไม่สำเร็จ");
        setBusy(false);
        return;
      }
      setEdit(null);
      setBusy(false);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "แก้ไม่สำเร็จ");
      setBusy(false);
    }
  }

  function exportCsv() {
    const head = [
      "วันที่", "เวลา", "ตู้", "ชื่อเล่น", "ประเภท",
      "เหรียญก่อน", "เหรียญดิจิตอล", "เหรียญเฟือง",
      "ตุ๊กตาก่อน", "ตุ๊กตาดิจิตอล", "ตุ๊กตาเฟือง",
      "เงินสด(บาท)", "สต๊อกก่อน", "สต๊อกหลัง", "เติม",
      "คนกรอก", "สถานะรอบ", "ธง", "หมายเหตุ",
    ];
    const esc = (v: string | number | null) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = rows.map((r) =>
      [
        r.dateLabel, r.timeLabel, r.machineCode, r.machineNickname ?? "",
        r.kind === "INITIAL" ? "ตั้งต้น" : "รอบเก็บ",
        r.coinBefore, r.coinDigital, r.coinGear,
        r.dollBefore, r.dollDigital, r.dollGear,
        r.cashBaht, r.stockBefore, r.stockAfter, r.refillQty,
        r.collectedByName, r.sessionStatus ?? "", r.anomalyFlags.join(" "), r.notes ?? "",
      ].map(esc).join(","),
    );
    const csv = "﻿" + [head.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ข้อมูลดิบ-${branchName}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (rows.length === 0) {
    return (
      <div style={{ background: "#fff", border: "1px solid #E8EAED", borderRadius: 14 }}>
        <EmptyState
          icon={<ImageIcon size={28} />}
          title="ยังไม่มีข้อมูลที่พนักงานกรอกในสาขานี้"
          sub="เมื่อพนักงานตั้งค่าตู้ (ยอดตั้งต้น) หรือเก็บเงินรอบจริง เลขที่กรอกจะขึ้นในตารางนี้ทันที"
        />
      </div>
    );
  }

  return (
    <div>
      {/* summary + actions */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: "#5A6270" }}>
          <b style={{ color: "#1A1D21" }}>{rows.length}</b> รายการที่พนักงานกรอก
          <span style={{ color: "#B45309", fontWeight: 600, marginLeft: 8 }}>ตั้งต้น {counts.init}</span>
          <span style={{ color: "#4F46E5", fontWeight: 600, marginLeft: 8 }}>รอบเก็บ {counts.coll}</span>
        </div>
        <span style={{ flex: 1 }} />
        {!canEdit && (
          <span style={{ fontSize: 11, color: "#9AA1AB" }}>ดูอย่างเดียว — แก้เลขได้เฉพาะแอดมิน/ผจก.สาขา</span>
        )}
        <button
          onClick={exportCsv}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer",
            fontSize: 12, fontWeight: 600, padding: "7px 13px", borderRadius: 8,
            background: "#fff", color: "#5A6270", border: "1px solid #E3E6EA",
          }}
        >
          <Download size={14} /> ออก Excel (CSV)
        </button>
      </div>

      {truncated && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", background: "#FCF8EC", border: "1px solid #F0E2BE", borderRadius: 10, padding: "8px 13px", marginBottom: 12, fontSize: 12, color: "#7A5510" }}>
          <AlertTriangle size={15} /> แสดง {rows.length} จาก {total} รายการ (ล่าสุดก่อน) — รายการเก่ากว่านี้ถูกตัดออกเพื่อความเร็ว
        </div>
      )}

      {/* the raw table — sticky header + horizontal scroll */}
      <div style={{ background: "#fff", border: "1px solid #E8EAED", borderRadius: 14, overflow: "hidden" }}>
        <div style={{ overflow: "auto", maxHeight: "64vh" }}>
          <table style={{ borderCollapse: "separate", borderSpacing: 0, width: "100%", fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ ...TH, left: 0, zIndex: 3, textAlign: "left", minWidth: 92 }}>วันที่</th>
                <th style={{ ...TH, left: 92, zIndex: 3, textAlign: "left", minWidth: 88, borderRight: "1px solid #E3E6EA" }}>ตู้</th>
                <th style={{ ...TH, minWidth: 62 }}>ประเภท</th>
                <th style={{ ...TH, minWidth: 132 }}>มิเตอร์เหรียญ<div style={{ fontSize: 9, fontWeight: 500, color: "#9AA1AB" }}>ดิจิตอล ก่อน→หลัง</div></th>
                <th style={{ ...TH, minWidth: 76 }}>เหรียญ<div style={{ fontSize: 9, fontWeight: 500, color: "#9AA1AB" }}>เฟือง</div></th>
                <th style={{ ...TH, minWidth: 132 }}>มิเตอร์ตุ๊กตา<div style={{ fontSize: 9, fontWeight: 500, color: "#9AA1AB" }}>ดิจิตอล ก่อน→หลัง</div></th>
                <th style={{ ...TH, minWidth: 76 }}>ตุ๊กตา<div style={{ fontSize: 9, fontWeight: 500, color: "#9AA1AB" }}>เฟือง</div></th>
                <th style={{ ...TH, minWidth: 78 }}>เงินสด</th>
                <th style={{ ...TH, minWidth: 96 }}>สต๊อก<div style={{ fontSize: 9, fontWeight: 500, color: "#9AA1AB" }}>ก่อน→หลัง</div></th>
                <th style={{ ...TH, minWidth: 56 }}>เติม</th>
                <th style={{ ...TH, minWidth: 96, textAlign: "left" }}>คนกรอก</th>
                <th style={{ ...TH, minWidth: 48 }}>ธง</th>
                <th style={{ ...TH, minWidth: 52 }}>รูป</th>
                <th style={{ ...TH, minWidth: 60 }}>แก้</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isInit = r.kind === "INITIAL";
                const hasFlag = r.anomalyFlags.length > 0 || !!r.shortReason;
                return (
                  <tr key={r.eventId} style={{ background: isInit ? "#FFFCF6" : "#fff" }}>
                    <td style={{ ...TD, position: "sticky", left: 0, zIndex: 1, textAlign: "left", background: isInit ? "#FFFCF6" : "#fff", fontWeight: 600 }}>
                      {r.dateLabel}
                      <span style={{ display: "block", fontSize: 10, color: "#9AA1AB", fontWeight: 400 }}>{r.timeLabel} น.</span>
                    </td>
                    <td style={{ ...TD, position: "sticky", left: 92, zIndex: 1, textAlign: "left", background: isInit ? "#FFFCF6" : "#fff", borderRight: "1px solid #E3E6EA" }}>
                      <span style={{ fontWeight: 700, color: "#4F46E5" }}>{r.machineCode}</span>
                      {r.machineNickname && <span style={{ display: "block", fontSize: 9.5, color: "#8A90A0" }}>{r.machineNickname}</span>}
                    </td>
                    <td style={TD}>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 20, ...(isInit ? { background: "#FCF1E2", color: "#B45309" } : { background: "#EEF0FE", color: "#4F46E5" }) }}>
                        {isInit ? "ตั้งต้น" : "รอบเก็บ"}
                      </span>
                    </td>
                    <td style={{ ...TD, textAlign: "left" }}><BeforeAfter before={r.coinBefore} after={r.coinDigital} /></td>
                    <td style={TD}>{r.coinGear == null ? <span style={{ color: "#C2C7CF" }}>—</span> : <span style={{ color: "#6B7280" }}>{nfmt(r.coinGear)}</span>}</td>
                    <td style={{ ...TD, textAlign: "left" }}><BeforeAfter before={r.dollBefore} after={r.dollDigital} /></td>
                    <td style={TD}>{r.dollGear == null ? <span style={{ color: "#C2C7CF" }}>—</span> : <span style={{ color: "#6B7280" }}>{nfmt(r.dollGear)}</span>}</td>
                    <td style={{ ...TD, fontWeight: 700, color: "#15803D" }}>{bahtN(r.cashBaht)}</td>
                    <td style={{ ...TD, textAlign: "left", color: "#6B7280" }}>
                      {r.stockBefore == null && r.stockAfter == null ? "—" : `${nfmt(r.stockBefore)} → ${nfmt(r.stockAfter)}`}
                    </td>
                    <td style={TD}>{r.refillQty ? <span style={{ color: "#B45309", fontWeight: 600 }}>+{r.refillQty}</span> : <span style={{ color: "#C2C7CF" }}>—</span>}</td>
                    <td style={{ ...TD, textAlign: "left", color: "#5A6270" }}>{r.collectedByName}</td>
                    <td style={TD}>
                      {hasFlag ? (
                        <span title={[r.shortReason, ...r.anomalyFlags].filter(Boolean).join(" · ")} style={{ cursor: "help" }}>
                          <AlertTriangle size={14} color="#F97316" />
                        </span>
                      ) : (
                        <span style={{ color: "#D6DAE0" }}>—</span>
                      )}
                    </td>
                    <td style={TD}>
                      {r.photos.length > 0 ? (
                        <button
                          onClick={() => setLightbox(r.photos[0])}
                          title={`ดูรูป ${r.photos.length} รูป`}
                          style={{ display: "inline-flex", alignItems: "center", gap: 3, cursor: "pointer", border: "none", background: "transparent", color: "#4F46E5", fontSize: 11, fontWeight: 600 }}
                        >
                          <ImageIcon size={14} /> {r.photos.length}
                        </button>
                      ) : (
                        <span style={{ color: "#D6DAE0" }}>—</span>
                      )}
                    </td>
                    <td style={TD}>
                      {r.editable && canEdit ? (
                        <button
                          onClick={() => openEdit(r)}
                          style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer", fontSize: 11, fontWeight: 600, padding: "4px 9px", borderRadius: 7, background: "#EEF0FE", color: "#4F46E5", border: "1px solid #DDE0FB" }}
                        >
                          <Pencil size={12} /> แก้
                        </button>
                      ) : (
                        <span
                          title={isInit ? "ยอดตั้งต้น — แก้ที่นี่ไม่ได้ (แก้ผ่านเมนูตั้งค่าตู้)" : r.deposited ? "ฝากธนาคารแล้ว · แก้ไม่ได้" : "รอบยังไม่ปิด/ถูกล็อก · แก้ไม่ได้"}
                          style={{ color: "#D6DAE0", fontSize: 11, cursor: "help" }}
                        >
                          —
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* photo lightbox */}
      <Modal open={lightbox != null} onClose={() => setLightbox(null)} title={lightbox?.label ?? "รูปหลักฐาน"} width={620}>
        {lightbox && (
          <div style={{ padding: 16, textAlign: "center" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={lightbox.url} alt={lightbox.label} style={{ maxWidth: "100%", maxHeight: "70vh", borderRadius: 10 }} />
          </div>
        )}
      </Modal>

      {/* edit sheet */}
      <Modal
        open={edit != null}
        onClose={() => (busy ? undefined : setEdit(null))}
        title={edit ? `แก้เลข — ตู้ ${edit.row.machineCode}` : ""}
        sub={edit ? `${edit.row.dateLabel} ${edit.row.timeLabel} น. · กรอกโดย ${edit.row.collectedByName}` : undefined}
        width={520}
        footer={
          edit ? (
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", alignItems: "center", width: "100%" }}>
              {err && <span style={{ flex: 1, fontSize: 12, color: "#B42318" }}>{err}</span>}
              <button onClick={() => setEdit(null)} disabled={busy} style={{ cursor: "pointer", fontSize: 13, fontWeight: 600, padding: "9px 16px", borderRadius: 9, background: "#fff", color: "#5A6270", border: "1px solid #D8DBE1" }}>ยกเลิก</button>
              <button onClick={saveEdit} disabled={busy} style={{ cursor: busy ? "wait" : "pointer", fontSize: 13, fontWeight: 700, padding: "9px 18px", borderRadius: 9, background: "#4F46E5", color: "#fff", border: "none", opacity: busy ? 0.7 : 1 }}>
                {busy ? "กำลังบันทึก…" : "บันทึกการแก้ไข"}
              </button>
            </div>
          ) : undefined
        }
      >
        {edit && (
          <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start", background: "#FFFBEB", border: "1px solid #FDE9B5", borderRadius: 9, padding: "9px 12px", fontSize: 11.5, color: "#7A5510", lineHeight: 1.5 }}>
              <AlertTriangle size={14} style={{ flex: "0 0 14px", marginTop: 1 }} />
              <span>เลข <b>ดิจิตอล</b> คือเลขที่ใช้คิดเงินจริง · เลข <b>เฟือง</b> เป็นตัวเทียบกันโกง (ควรขยับเท่าดิจิตอล) · ระบบจะคำนวณยอดใหม่ + ต่อเลขให้รอบถัดไปอัตโนมัติ + เก็บประวัติว่าใครแก้</span>
            </div>

            <EditField label="เงินสดที่นับได้ (บาท)" value={edit.cash} onChange={(v) => setEdit({ ...edit, cash: v })} accent="#15803D" />

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <EditField label="มิเตอร์เหรียญ · ดิจิตอล" hint="ใช้คิดเงิน" value={edit.coinDigital} onChange={(v) => setEdit({ ...edit, coinDigital: v })} />
              <EditField label="มิเตอร์เหรียญ · เฟือง" hint="ตัวเทียบ" value={edit.coinGear} onChange={(v) => setEdit({ ...edit, coinGear: v })} muted />
              <EditField label="มิเตอร์ตุ๊กตา · ดิจิตอล" hint="ใช้คิดตุ๊กตาออก" value={edit.dollDigital} onChange={(v) => setEdit({ ...edit, dollDigital: v })} />
              <EditField label="มิเตอร์ตุ๊กตา · เฟือง" hint="ตัวเทียบ" value={edit.dollGear} onChange={(v) => setEdit({ ...edit, dollGear: v })} muted />
            </div>
          </div>
        )}
      </Modal>

      {/* close button on lightbox top-right (kit Modal already has close, but ensure escape) */}
      {lightbox && (
        <button onClick={() => setLightbox(null)} aria-label="ปิด" style={{ position: "fixed", top: 18, right: 18, zIndex: 60, background: "rgba(0,0,0,0.5)", color: "#fff", border: "none", borderRadius: "50%", width: 34, height: 34, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <X size={18} />
        </button>
      )}
    </div>
  );
}

function EditField({
  label,
  hint,
  value,
  onChange,
  accent = "#1A1D21",
  muted = false,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  accent?: string;
  muted?: boolean;
}) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ display: "flex", alignItems: "baseline", gap: 6, fontSize: 11.5, fontWeight: 600, color: "#5A6270", marginBottom: 5 }}>
        {label}
        {hint && <span style={{ fontSize: 9.5, fontWeight: 500, color: "#9AA1AB" }}>({hint})</span>}
      </span>
      <input
        type="number"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="—"
        style={{
          width: "100%",
          fontSize: 15,
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
          padding: "9px 12px",
          borderRadius: 9,
          border: "1px solid #D8DBE1",
          background: muted ? "#FAFBFC" : "#fff",
          color: accent,
        }}
      />
    </label>
  );
}
