"use client";

/**
 * CellDetailModal — popup ที่โผล่เมื่อกด "ช่อง" (ตู้ × วัน) ในรายงานเจาะสาขา.
 * โชว์ทุกรายการที่พนักงานกรอกวันนั้น (ยอดตั้งต้น + รอบเก็บ) แบบการ์ด: เลขมิเตอร์ก่อน→หลัง,
 * เงิน, ตุ๊กตา, สต๊อก, เติม, ธง, คนกรอก + รูปหลักฐานทุกใบ (กดดูขยาย) + ปุ่มแก้ (ตามสิทธิ์).
 * แก้รอบเก็บ = ปรับรอบถัดไปให้ · แก้ยอดตั้งต้น = ปรับรอบเก็บครั้งแรกให้ (MeterEditModal จัด routing).
 */

import { useState } from "react";
import { ImageIcon, Pencil, AlertTriangle, X, Loader2 } from "lucide-react";
import { Modal, EmptyState } from "@/components/clawfleet/os/kit";
import { bahtN } from "@/components/clawfleet/os/format";
import { MeterEditModal } from "./meter-edit";
import type { RawReadingRow, RawReadingPhoto } from "@/lib/clawfleet/raw-readings-queries";

const nfmt = (n: number | null | undefined): string => (n == null ? "—" : n.toLocaleString("en-US"));

function Delta({ before, after }: { before: number | null; after: number | null }) {
  if (after == null && before == null) return <span style={{ color: "#C2C7CF" }}>—</span>;
  if (before == null) return <b style={{ color: "#1A1D21" }}>{nfmt(after)}</b>;
  const d = after != null ? after - before : null;
  return (
    <span style={{ whiteSpace: "nowrap" }}>
      <span style={{ color: "#9AA1AB" }}>{nfmt(before)}</span>
      <span style={{ color: "#C2C7CF", margin: "0 4px" }}>→</span>
      <b style={{ color: "#1A1D21" }}>{nfmt(after)}</b>
      {d != null && (
        <span style={{ marginLeft: 5, fontSize: 11, fontWeight: 700, color: d < 0 ? "#B42318" : "#15803D" }}>
          {d >= 0 ? "+" : ""}
          {d.toLocaleString("en-US")}
        </span>
      )}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 10.5, fontWeight: 600, color: "#8A90A0", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13 }}>{children}</div>
    </div>
  );
}

function EventCard({
  row,
  canEdit,
  onView,
  onEdit,
}: {
  row: RawReadingRow;
  canEdit: boolean;
  onView: (p: RawReadingPhoto) => void;
  onEdit: (r: RawReadingRow) => void;
}) {
  const isInit = row.kind === "INITIAL";
  const hasFlag = row.anomalyFlags.length > 0 || !!row.shortReason;
  // แก้ได้ = มีสิทธิ์ + ยังไม่ฝาก + รอบปิดรอตรวจแล้ว (ทั้งรอบเก็บและตั้งต้น · server re-check อีกชั้น)
  const editable =
    canEdit && !row.deposited && (row.sessionStatus === "CLOSED" || row.sessionStatus === "ANOMALY_REVIEW");

  return (
    <div style={{ border: "1px solid #E8EAED", borderRadius: 12, overflow: "hidden", background: isInit ? "#FFFCF6" : "#fff" }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderBottom: "1px solid #F0F1F4" }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 9px", borderRadius: 20, ...(isInit ? { background: "#FCF1E2", color: "#B45309" } : { background: "#EEF0FE", color: "#4F46E5" }) }}>
          {isInit ? "ยอดตั้งต้น" : "รอบเก็บ"}
        </span>
        <span style={{ fontSize: 12, color: "#5A6270" }}>{row.timeLabel} น.</span>
        <span style={{ fontSize: 12, color: "#8A90A0" }}>· {row.collectedByName}</span>
        {hasFlag && (
          <span title={[row.shortReason, ...row.anomalyFlags].filter(Boolean).join(" · ")} style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, fontWeight: 600, color: "#B45309", cursor: "help" }}>
            <AlertTriangle size={13} /> รอตรวจ
          </span>
        )}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 14, fontWeight: 800, color: "#15803D" }}>{bahtN(row.cashBaht)}</span>
        {editable && (
          <button
            onClick={() => onEdit(row)}
            style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer", fontSize: 11.5, fontWeight: 700, padding: "5px 11px", borderRadius: 8, background: "#EEF0FE", color: "#4F46E5", border: "1px solid #DDE0FB" }}
          >
            <Pencil size={12} /> แก้
          </button>
        )}
      </div>

      {/* fields */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px", padding: "12px 14px" }}>
        <Field label="มิเตอร์เหรียญ · ดิจิตอล (ก่อน→หลัง)"><Delta before={row.coinBefore} after={row.coinDigital} /></Field>
        <Field label="มิเตอร์เหรียญ · เฟือง">{row.coinGear == null ? <span style={{ color: "#C2C7CF" }}>—</span> : <span style={{ color: "#6B7280" }}>{nfmt(row.coinGear)}</span>}</Field>
        <Field label="มิเตอร์ตุ๊กตา · ดิจิตอล (ก่อน→หลัง)"><Delta before={row.dollBefore} after={row.dollDigital} /></Field>
        <Field label="มิเตอร์ตุ๊กตา · เฟือง">{row.dollGear == null ? <span style={{ color: "#C2C7CF" }}>—</span> : <span style={{ color: "#6B7280" }}>{nfmt(row.dollGear)}</span>}</Field>
        <Field label="สต๊อกตุ๊กตา (ก่อน→หลัง)">
          {row.stockBefore == null && row.stockAfter == null ? <span style={{ color: "#C2C7CF" }}>—</span> : <span style={{ color: "#3A414B" }}>{nfmt(row.stockBefore)} → {nfmt(row.stockAfter)}</span>}
        </Field>
        <Field label="เติมตุ๊กตา">{row.refillQty ? <span style={{ color: "#B45309", fontWeight: 700 }}>+{row.refillQty}</span> : <span style={{ color: "#C2C7CF" }}>—</span>}</Field>
        {row.notes && (
          <div style={{ gridColumn: "1 / -1" }}>
            <Field label="หมายเหตุ"><span style={{ color: "#5A6270" }}>{row.notes}</span></Field>
          </div>
        )}
      </div>

      {/* photos */}
      {row.photos.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "0 14px 14px" }}>
          {row.photos.map((p, i) => (
            <button
              key={i}
              onClick={() => onView(p)}
              title={p.label}
              style={{ position: "relative", cursor: "pointer", border: "1px solid #E3E6EA", borderRadius: 9, overflow: "hidden", padding: 0, background: "#F4F5F7", width: 74, height: 74 }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={p.label} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
              <span style={{ position: "absolute", left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.55)", color: "#fff", fontSize: 8, fontWeight: 600, padding: "2px 3px", lineHeight: 1.2, textAlign: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function CellDetailModal({
  open,
  onClose,
  title,
  sub,
  loading,
  rows,
  canEdit,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  sub?: string;
  loading: boolean;
  rows: RawReadingRow[];
  canEdit: boolean;
  /** เรียกหลังแก้สำเร็จ — parent โหลดช่องใหม่ + router.refresh */
  onSaved: () => void;
}) {
  const [lightbox, setLightbox] = useState<RawReadingPhoto | null>(null);
  const [editRow, setEditRow] = useState<RawReadingRow | null>(null);

  return (
    <>
      <Modal open={open} onClose={onClose} title={title || "รายละเอียด"} sub={sub} width={660}>
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12, maxHeight: "72vh", overflow: "auto" }}>
          {loading ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "40px 0", color: "#8A90A0", fontSize: 13 }}>
              <Loader2 size={18} style={{ animation: "cf-spin 0.8s linear infinite" }} /> กำลังโหลด…
              <style>{"@keyframes cf-spin{to{transform:rotate(360deg)}}"}</style>
            </div>
          ) : rows.length === 0 ? (
            <EmptyState icon={<ImageIcon size={26} />} title="ไม่มีข้อมูลในวันนี้" sub="ช่องนี้อาจเป็นข้อมูลตัวอย่าง หรือรายการถูกย้าย/ลบไปแล้ว" />
          ) : (
            rows.map((r) => (
              <EventCard key={r.eventId} row={r} canEdit={canEdit} onView={setLightbox} onEdit={setEditRow} />
            ))
          )}
        </div>
      </Modal>

      {/* lightbox */}
      <Modal open={lightbox != null} onClose={() => setLightbox(null)} title={lightbox?.label ?? "รูปหลักฐาน"} width={620}>
        {lightbox && (
          <div style={{ padding: 16, textAlign: "center" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={lightbox.url} alt={lightbox.label} style={{ maxWidth: "100%", maxHeight: "70vh", borderRadius: 10 }} />
          </div>
        )}
      </Modal>
      {lightbox && (
        <button onClick={() => setLightbox(null)} aria-label="ปิด" style={{ position: "fixed", top: 18, right: 18, zIndex: 60, background: "rgba(0,0,0,0.5)", color: "#fff", border: "none", borderRadius: "50%", width: 34, height: 34, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <X size={18} />
        </button>
      )}

      {/* edit sheet — key ให้ remount ค่าใหม่ทุกครั้งที่เปลี่ยนรายการ */}
      <MeterEditModal
        key={editRow ? editRow.eventId : "closed"}
        row={editRow}
        onClose={() => setEditRow(null)}
        onSaved={() => {
          setEditRow(null);
          onSaved();
        }}
      />
    </>
  );
}
