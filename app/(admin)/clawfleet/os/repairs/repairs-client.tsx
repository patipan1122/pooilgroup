"use client";

/**
 * ตู้คีบ OS — แจ้งซ่อม / ตู้เสีย (client)
 * รายการตั๋วซ่อม + ฟิลเตอร์สถานะ · แต่ละใบ: รหัสตู้+สาขา / อาการ / ผู้แจ้ง+เวลา / รูป(lightbox) / สถานะ(ป้ายสี).
 * ปุ่ม ผจก.+แอดมิน: "ปิดงาน" (resolve — ถ้าขอ rebaseline มิเตอร์ โชว์ค่าเก่า→ใหม่ + checkbox อนุมัติ + เตือน คนเสนอ≠คนอนุมัติ),
 * "ยกเลิก", toggle "ปิดตู้ชั่วคราว/เปิด". กดตู้ → ไทม์ไลน์ประวัติซ่อมของตู้นั้น (สร้างจากตั๋วที่โหลดมาแล้ว).
 * ธีมเดิม indigo full-bleed · reuse kit.tsx/format.ts · empty state ซื่อสัตย์.
 */

import { useMemo, useState, useTransition } from "react";
import {
  Wrench,
  AlertTriangle,
  Info,
  Check,
  X,
  Gauge,
  Power,
  History,
  ArrowRight,
} from "lucide-react";
import { Pill, IconBox, EmptyState, Modal } from "@/components/clawfleet/os/kit";
import { num, type Tone } from "@/components/clawfleet/os/format";
import type { RepairTicketRow } from "@/lib/clawfleet/repair-queries";
import {
  resolveRepairTicket,
  cancelRepairTicket,
  toggleMachineActive,
} from "@/lib/clawfleet/repair-actions";

/* ── สถานะตั๋ว → ป้ายสี + accent ────────────────────────────────────────── */
type TicketStatus = RepairTicketRow["status"];
const STATUS_META: Record<TicketStatus, { label: string; tone: Tone; accent: string }> = {
  OPEN: { label: "แจ้งใหม่", tone: "red", accent: "#B42318" },
  IN_PROGRESS: { label: "กำลังซ่อม", tone: "amber", accent: "#B45309" },
  RESOLVED: { label: "ซ่อมแล้ว", tone: "green", accent: "#15803D" },
  CANCELLED: { label: "ยกเลิก", tone: "neutral", accent: "#9AA1AB" },
};

const FILTERS: { key: "ALL" | TicketStatus; label: string }[] = [
  { key: "ALL", label: "ทั้งหมด" },
  { key: "OPEN", label: "แจ้งใหม่" },
  { key: "IN_PROGRESS", label: "กำลังซ่อม" },
  { key: "RESOLVED", label: "ซ่อมแล้ว" },
  { key: "CANCELLED", label: "ยกเลิก" },
];

/** ISO → "วันนี้ 09:42" / "เมื่อวาน 17:30" / "12 มิ.ย." */
function timeLabel(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayDiff = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  const hhmm = d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", hour12: false });
  if (dayDiff === 0) return `วันนี้ ${hhmm}`;
  if (dayDiff === 1) return `เมื่อวาน ${hhmm}`;
  if (dayDiff > 1 && dayDiff < 7) return `${dayDiff} วันก่อน`;
  return d.toLocaleDateString("th-TH", { day: "numeric", month: "short" });
}

export function RepairsClient({
  tickets,
  canManage,
  currentUserName,
}: {
  tickets: RepairTicketRow[];
  canManage: boolean;
  currentUserName: string;
}) {
  // ข้อมูลจริงจาก server เป็นหลัก · optimistic เฉพาะตอนกด (action จริงข้างหลัง)
  const [rows, setRows] = useState<RepairTicketRow[]>(tickets);
  const [filter, setFilter] = useState<"ALL" | TicketStatus>("ALL");
  const [isPending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorByRow, setErrorByRow] = useState<Record<string, string>>({});
  // แถบ "ปิดงาน" ที่เปิดค้าง (inline confirm แทน popup) — เก็บ ticketId + สถานะ checkbox
  const [resolveFor, setResolveFor] = useState<string | null>(null);
  const [approveRebaseline, setApproveRebaseline] = useState(false);
  const [resolutionNote, setResolutionNote] = useState("");
  const [reactivate, setReactivate] = useState(true);
  // แถบ "ยกเลิก" ที่เปิดค้าง
  const [cancelFor, setCancelFor] = useState<string | null>(null);
  const [cancelNote, setCancelNote] = useState("");
  // lightbox รูป (url เดียว)
  const [lightbox, setLightbox] = useState<string | null>(null);
  // drill-down ประวัติซ่อมรายตู้ (machineId)
  const [historyFor, setHistoryFor] = useState<string | null>(null);

  function showRowError(id: string, msg: string) {
    setErrorByRow((prev) => ({ ...prev, [id]: msg }));
    setTimeout(() => {
      setErrorByRow((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }, 6000);
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = { ALL: rows.length };
    for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [rows]);

  const openCount = counts.OPEN ?? 0;

  const visible = useMemo(
    () => (filter === "ALL" ? rows : rows.filter((r) => r.status === filter)),
    [rows, filter],
  );

  // ประวัติซ่อมของตู้ที่กดดู — สร้างจากตั๋วที่โหลดมาแล้ว (เรียงใหม่→เก่า)
  const historyRows = useMemo(() => {
    if (!historyFor) return [];
    return rows
      .filter((r) => r.machineId === historyFor)
      .slice()
      .sort((a, b) => new Date(b.reportedAt).getTime() - new Date(a.reportedAt).getTime());
  }, [rows, historyFor]);
  const historyMachineCode = historyRows[0]?.machineCode ?? "";

  function openResolve(t: RepairTicketRow) {
    setCancelFor(null);
    setResolveFor(t.id);
    setApproveRebaseline(false);
    setResolutionNote("");
    setReactivate(true);
  }

  function openCancel(t: RepairTicketRow) {
    setResolveFor(null);
    setCancelFor(t.id);
    setCancelNote("");
  }

  function closeInline() {
    setResolveFor(null);
    setCancelFor(null);
    setResolutionNote("");
    setCancelNote("");
    setApproveRebaseline(false);
  }

  function doResolve(t: RepairTicketRow) {
    const note = resolutionNote.trim();
    const applyMeterReset = t.meterResetRequested && approveRebaseline;
    const react = reactivate;
    closeInline();
    setBusyId(t.id);
    startTransition(async () => {
      const res = await resolveRepairTicket(t.id, {
        resolutionNote: note || undefined,
        applyMeterReset,
        reactivate: react,
      });
      setBusyId(null);
      if (!res.ok) {
        showRowError(t.id, res.error ?? "ปิดงานไม่สำเร็จ ลองอีกครั้ง");
        return;
      }
      setRows((prev) =>
        prev.map((r) =>
          r.id === t.id
            ? {
                ...r,
                status: "RESOLVED",
                resolvedByName: currentUserName || r.resolvedByName,
                resolvedAt: new Date().toISOString(),
                resolutionNote: note || r.resolutionNote,
              }
            : r,
        ),
      );
    });
  }

  function doCancel(t: RepairTicketRow) {
    const note = cancelNote.trim();
    closeInline();
    setBusyId(t.id);
    startTransition(async () => {
      const res = await cancelRepairTicket(t.id, note || undefined);
      setBusyId(null);
      if (!res.ok) {
        showRowError(t.id, res.error ?? "ยกเลิกไม่สำเร็จ ลองอีกครั้ง");
        return;
      }
      setRows((prev) =>
        prev.map((r) => (r.id === t.id ? { ...r, status: "CANCELLED" } : r)),
      );
    });
  }

  // ปิด/เปิดตู้ชั่วคราว — เขียนที่ machine.isActive (ทุกตั๋วของตู้เดียวกันเห็นเหมือนกัน)
  function doToggleMachine(t: RepairTicketRow, nextActive: boolean) {
    setBusyId(t.id);
    startTransition(async () => {
      const res = await toggleMachineActive(t.machineId, nextActive);
      setBusyId(null);
      if (!res.ok) {
        showRowError(t.id, res.error ?? "เปลี่ยนสถานะตู้ไม่สำเร็จ");
      }
      // สถานะตู้ (isActive) ไม่ได้อยู่ใน RepairTicketRow → ให้ revalidate ฝั่ง action คุม
      // (optimistic ไม่จำเป็น เพราะ toggle จะ redraw จาก server รอบถัดไป)
    });
  }

  const empty = rows.length === 0;

  return (
    <div>
      {/* แบนเนอร์อธิบาย flow (indigo) — พนักงานแจ้ง → ผจก./แอดมิน ปิดงาน · rebaseline มิเตอร์กันโดนหาว่าโกง */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: "#EEF0FE",
          border: "1px solid #D9DBFB",
          borderRadius: 12,
          padding: "13px 18px",
          marginBottom: 18,
        }}
      >
        <IconBox tone="brand" size={30} radius={9}>
          <Wrench size={16} />
        </IconBox>
        <span style={{ fontSize: 13, color: "#3F3AAE", lineHeight: 1.5 }}>
          พนักงานแจ้งตู้เสียจากหน้างาน — คำแจ้งจะอยู่สถานะ <b>“แจ้งใหม่”</b> จนกว่า
          ผจก./แอดมิน จะกด <b>“ปิดงาน”</b>. ถ้าซ่อมแล้วเปลี่ยนมิเตอร์
          ให้อนุมัติ <b>ตั้งมิเตอร์ใหม่ (rebaseline)</b> ตอนปิดงาน — ระบบจะไม่หาว่าเก็บเงินขาด
          {openCount > 0 && (
            <>
              {" · "}
              <b className="num">{openCount}</b> รายการรอดำเนินการ
            </>
          )}
        </span>
      </div>

      {/* ฟิลเตอร์สถานะ */}
      <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
        {FILTERS.map((f) => {
          const active = filter === f.key;
          const c = counts[f.key] ?? 0;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className="co-tap"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                fontSize: 12.5,
                fontWeight: 600,
                color: active ? "#fff" : "#5A6270",
                background: active ? "#4F46E5" : "#fff",
                border: `1px solid ${active ? "#4F46E5" : "#E3E6EA"}`,
                padding: "7px 14px",
                borderRadius: 9,
                cursor: "pointer",
              }}
            >
              {f.label}
              <span
                className="num"
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: active ? "#fff" : "#9AA1AB",
                  background: active ? "rgba(255,255,255,0.22)" : "#F1F2F7",
                  borderRadius: 20,
                  padding: "1px 8px",
                }}
              >
                {num(c)}
              </span>
            </button>
          );
        })}
      </div>

      {/* empty state — ยังไม่มีตั๋วซ่อมจริง (ไม่โชว์ sample หลอกตา) */}
      {empty ? (
        <div style={{ background: "#fff", border: "1px dashed #D9DCE3", borderRadius: 16 }}>
          <EmptyState
            icon={<Wrench size={30} />}
            title="ยังไม่มีการแจ้งซ่อม"
            sub="เมื่อพนักงานแจ้งตู้เสียจากหน้างาน รายการจะมาอยู่ที่นี่เพื่อให้ ผจก./แอดมิน ตามซ่อมและปิดงาน"
          />
        </div>
      ) : visible.length === 0 ? (
        <div style={{ background: "#fff", border: "1px dashed #D9DCE3", borderRadius: 16 }}>
          <EmptyState
            icon={<Wrench size={30} />}
            title="ไม่มีรายการในสถานะนี้"
            sub="ลองเลือกฟิลเตอร์อื่นด้านบน"
          />
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {visible.map((t) => {
            const sm = STATUS_META[t.status] ?? STATUS_META.OPEN;
            const rowBusy = busyId === t.id && isPending;
            const canAct = canManage && (t.status === "OPEN" || t.status === "IN_PROGRESS");
            return (
              <div
                key={t.id}
                className="co-accent-l"
                style={{
                  background: "#fff",
                  border: "1px solid #E8EAED",
                  borderRadius: 14,
                  padding: "18px 22px",
                  opacity: rowBusy ? 0.6 : 1,
                  ["--co-accent" as string]: sm.accent,
                }}
              >
                {/* หัวการ์ด: รหัสตู้ (กดดูประวัติ) + สาขา + ผู้แจ้ง + สถานะ */}
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                  <button
                    type="button"
                    onClick={() => setHistoryFor(t.machineId)}
                    className="co-tap num"
                    title="ดูประวัติซ่อมของตู้นี้"
                    style={{
                      minWidth: 44,
                      height: 40,
                      flex: "0 0 auto",
                      padding: "0 9px",
                      borderRadius: 10,
                      background: "#EEF0FE",
                      color: "#4F46E5",
                      fontSize: 12.5,
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      border: "1px solid #D9DBFB",
                      cursor: "pointer",
                    }}
                  >
                    {t.machineCode}
                  </button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 700 }}>
                      ตู้ {t.machineCode}
                      {t.branchName ? ` · ${t.branchName}` : ""}
                    </div>
                    <div style={{ fontSize: 11.5, color: "#9AA1AB" }}>
                      แจ้งโดย {t.reportedByName || "—"} · {timeLabel(t.reportedAt)}
                    </div>
                  </div>
                  {t.meterResetRequested && (
                    <Pill tone="brand">
                      <Gauge size={12} style={{ marginRight: 3, verticalAlign: "-1px" }} />
                      ขอตั้งมิเตอร์ใหม่
                    </Pill>
                  )}
                  <Pill tone={sm.tone}>{sm.label}</Pill>
                </div>

                {/* อาการ */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 8,
                    fontSize: 13,
                    background: "#F8F9FB",
                    borderRadius: 10,
                    padding: "11px 14px",
                  }}
                >
                  <AlertTriangle size={15} color="#B45309" style={{ flex: "0 0 15px", marginTop: 1 }} />
                  <span style={{ color: "#3F4650" }}>
                    <b>อาการ:</b> {t.symptom}
                    {t.note ? (
                      <span style={{ color: "#9AA1AB" }}> · {t.note}</span>
                    ) : null}
                  </span>
                </div>

                {/* รูปจากหน้างาน (lightbox) */}
                {t.photoUrls && t.photoUrls.length > 0 && (
                  <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                    {t.photoUrls.map((url, i) => (
                      <button
                        key={`${t.id}-${i}`}
                        type="button"
                        onClick={() => setLightbox(url)}
                        className="co-tap"
                        style={{
                          width: 68,
                          height: 68,
                          borderRadius: 10,
                          overflow: "hidden",
                          border: "1px solid #E3E6EA",
                          padding: 0,
                          cursor: "pointer",
                          background: "#F1F2F7",
                        }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={url}
                          alt={`รูปแจ้งซ่อม ${i + 1}`}
                          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                        />
                      </button>
                    ))}
                  </div>
                )}

                {/* ค่ามิเตอร์ที่เสนอตั้งใหม่ (rebaseline) — โชว์เมื่อมีการขอ */}
                {t.meterResetRequested && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 14,
                      marginTop: 12,
                      background: "#EEF0FE",
                      border: "1px solid #D9DBFB",
                      borderRadius: 10,
                      padding: "11px 14px",
                      flexWrap: "wrap",
                    }}
                  >
                    <Gauge size={16} color="#4F46E5" style={{ flex: "0 0 16px" }} />
                    {t.proposedCoinMeter != null && (
                      <span style={{ fontSize: 12, color: "#3F3AAE" }}>
                        มิเตอร์เหรียญใหม่:{" "}
                        <b className="num" style={{ color: "#4F46E5" }}>{num(t.proposedCoinMeter)}</b>
                      </span>
                    )}
                    {t.proposedDollStock != null && (
                      <span style={{ fontSize: 12, color: "#3F3AAE" }}>
                        ตุ๊กตาคงเหลือใหม่:{" "}
                        <b className="num" style={{ color: "#4F46E5" }}>{num(t.proposedDollStock)}</b>
                      </span>
                    )}
                    {t.proposedCoinMeter == null && t.proposedDollStock == null && (
                      <span style={{ fontSize: 12, color: "#9AA1AB" }}>
                        พนักงานขอตั้งมิเตอร์ใหม่ (ยังไม่ระบุตัวเลข)
                      </span>
                    )}
                  </div>
                )}

                {/* ผู้ปิดงาน (เมื่อ resolved) */}
                {t.status === "RESOLVED" && (t.resolvedByName || t.resolutionNote) && (
                  <div style={{ fontSize: 11.5, color: "#9AA1AB", marginTop: 12 }}>
                    ปิดงานโดย {t.resolvedByName || "—"}
                    {t.resolvedAt ? ` · ${timeLabel(t.resolvedAt)}` : ""}
                    {t.resolutionNote ? ` · ${t.resolutionNote}` : ""}
                  </div>
                )}

                {/* error inline (แทน alert) — auto-clear */}
                {errorByRow[t.id] && (
                  <div
                    role="alert"
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 8,
                      fontSize: 12,
                      background: "#FCEDEC",
                      border: "1px solid #F0CFCB",
                      borderRadius: 10,
                      padding: "10px 13px",
                      marginTop: 12,
                      color: "#9B3127",
                    }}
                  >
                    <AlertTriangle size={14} color="#B42318" style={{ flex: "0 0 14px", marginTop: 1 }} />
                    <span>{errorByRow[t.id]}</span>
                  </div>
                )}

                {/* ปุ่มจัดการ (ผจก.+แอดมิน) — ปิดงาน / ยกเลิก / ปิดตู้ชั่วคราว */}
                {canAct && resolveFor !== t.id && cancelFor !== t.id && (
                  <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      disabled={rowBusy}
                      onClick={() => doToggleMachine(t, false)}
                      className="co-tap"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 13,
                        fontWeight: 600,
                        color: "#B45309",
                        background: "#fff",
                        border: "1px solid #F0E2BE",
                        padding: "9px 16px",
                        borderRadius: 9,
                        cursor: rowBusy ? "not-allowed" : "pointer",
                      }}
                    >
                      <Power size={15} /> ปิดตู้ชั่วคราว
                    </button>
                    <button
                      type="button"
                      disabled={rowBusy}
                      onClick={() => openCancel(t)}
                      className="co-tap"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 13,
                        fontWeight: 600,
                        color: "#B42318",
                        background: "#fff",
                        border: "1px solid #F0CFCB",
                        padding: "9px 16px",
                        borderRadius: 9,
                        cursor: rowBusy ? "not-allowed" : "pointer",
                      }}
                    >
                      <X size={15} /> ยกเลิก
                    </button>
                    <button
                      type="button"
                      disabled={rowBusy}
                      onClick={() => openResolve(t)}
                      className="co-tap"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 13,
                        fontWeight: 600,
                        color: "#fff",
                        background: "#15803D",
                        border: "none",
                        padding: "9px 18px",
                        borderRadius: 9,
                        cursor: rowBusy ? "not-allowed" : "pointer",
                      }}
                    >
                      <Check size={15} /> ปิดงาน
                    </button>
                  </div>
                )}

                {/* เปิดตู้กลับ (เมื่อดูตู้ที่ปิดอยู่ — ผจก.+แอดมิน · โชว์คู่ปุ่มปิดงานได้ทุกสถานะที่จัดการได้) */}
                {canManage && resolveFor !== t.id && cancelFor !== t.id && (
                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                    <button
                      type="button"
                      disabled={rowBusy}
                      onClick={() => doToggleMachine(t, true)}
                      className="co-tap"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 12,
                        fontWeight: 600,
                        color: "#15803D",
                        background: "transparent",
                        border: "none",
                        padding: "4px 8px",
                        borderRadius: 8,
                        cursor: rowBusy ? "not-allowed" : "pointer",
                      }}
                    >
                      <Power size={13} /> เปิดตู้กลับ (ถ้าซ่อมเสร็จแล้ว)
                    </button>
                  </div>
                )}

                {/* แถบ "ปิดงาน" (inline) — resolutionNote + rebaseline checkbox + maker≠checker warning */}
                {canAct && resolveFor === t.id && (
                  <div
                    style={{
                      background: "#F2FAF5",
                      border: "1px solid #CDE9D7",
                      borderRadius: 10,
                      padding: "14px 16px",
                      marginTop: 16,
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#15803D", marginBottom: 10 }}>
                      ปิดงานซ่อม ตู้ {t.machineCode}
                      {t.branchName ? ` · ${t.branchName}` : ""}
                    </div>

                    {/* rebaseline มิเตอร์ — เฉพาะตั๋วที่ขอ */}
                    {t.meterResetRequested && (
                      <>
                        {/* ค่าเก่า → ใหม่ */}
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            flexWrap: "wrap",
                            background: "#fff",
                            border: "1px solid #D9DBFB",
                            borderRadius: 9,
                            padding: "10px 12px",
                            marginBottom: 12,
                          }}
                        >
                          <Gauge size={15} color="#4F46E5" style={{ flex: "0 0 15px" }} />
                          {t.proposedCoinMeter != null && (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                              <span style={{ color: "#9AA1AB" }}>มิเตอร์เหรียญ</span>
                              <ArrowRight size={12} color="#9AA1AB" />
                              <b className="num" style={{ color: "#4F46E5" }}>{num(t.proposedCoinMeter)}</b>
                            </span>
                          )}
                          {t.proposedDollStock != null && (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                              <span style={{ color: "#9AA1AB" }}>ตุ๊กตาคงเหลือ</span>
                              <ArrowRight size={12} color="#9AA1AB" />
                              <b className="num" style={{ color: "#4F46E5" }}>{num(t.proposedDollStock)}</b>
                            </span>
                          )}
                        </div>

                        <label
                          style={{
                            display: "flex",
                            alignItems: "flex-start",
                            gap: 9,
                            fontSize: 12.5,
                            color: "#3F4650",
                            cursor: "pointer",
                            marginBottom: 10,
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={approveRebaseline}
                            onChange={(e) => setApproveRebaseline(e.target.checked)}
                            style={{ marginTop: 2, width: 16, height: 16, accentColor: "#4F46E5", flex: "0 0 16px" }}
                          />
                          <span>
                            <b>อนุมัติตั้งมิเตอร์ใหม่ (rebaseline)</b> — ยืนยันว่าค่ามิเตอร์ข้างบนคือค่าจริงหลังซ่อม
                            ระบบจะถือค่านี้เป็นจุดตั้งต้นใหม่ · รอบเก็บถัดไปจะไม่ถูกหาว่าเก็บขาด
                          </span>
                        </label>

                        {/* เตือน คนเสนอ ≠ คนอนุมัติ (maker-checker) */}
                        {approveRebaseline && (
                          <div
                            style={{
                              display: "flex",
                              alignItems: "flex-start",
                              gap: 8,
                              fontSize: 11.5,
                              background: "#FCF8EC",
                              border: "1px solid #F0E2BE",
                              borderRadius: 9,
                              padding: "9px 12px",
                              marginBottom: 12,
                              color: "#7A5510",
                            }}
                          >
                            <Info size={14} color="#B45309" style={{ flex: "0 0 14px", marginTop: 1 }} />
                            <span>
                              การตั้งมิเตอร์ใหม่ควรให้ <b>คนละคน</b> กับผู้แจ้ง ({t.reportedByName || "—"}) เป็นผู้อนุมัติ
                              เพื่อกันการปรับตัวเลขเอง
                              {currentUserName && t.reportedByName && currentUserName === t.reportedByName && (
                                <>
                                  {" "}
                                  <b style={{ color: "#B42318" }}>
                                    — คุณเป็นผู้แจ้งเอง ควรให้ผู้อื่นอนุมัติ
                                  </b>
                                </>
                              )}
                            </span>
                          </div>
                        )}
                      </>
                    )}

                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 9,
                        fontSize: 12.5,
                        color: "#3F4650",
                        cursor: "pointer",
                        marginBottom: 12,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={reactivate}
                        onChange={(e) => setReactivate(e.target.checked)}
                        style={{ width: 16, height: 16, accentColor: "#15803D", flex: "0 0 16px" }}
                      />
                      <span>เปิดตู้กลับให้ใช้งานได้ (ถ้าปิดตู้ชั่วคราวไว้ก่อนหน้า)</span>
                    </label>

                    <textarea
                      value={resolutionNote}
                      onChange={(e) => setResolutionNote(e.target.value)}
                      maxLength={1000}
                      rows={2}
                      placeholder="บันทึกการซ่อม (ไม่บังคับ) — เช่น เปลี่ยนมอเตอร์คีบ / รีเซ็ตเครื่องหยอดเหรียญ"
                      style={{
                        width: "100%",
                        fontSize: 12.5,
                        color: "#3F4650",
                        background: "#fff",
                        border: "1px solid #CDE9D7",
                        borderRadius: 9,
                        padding: "9px 12px",
                        resize: "vertical",
                        fontFamily: "inherit",
                        lineHeight: 1.5,
                        marginBottom: 12,
                      }}
                    />

                    <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                      <button
                        type="button"
                        onClick={closeInline}
                        className="co-tap"
                        style={{
                          fontSize: 13, fontWeight: 600, color: "#5A6270", background: "#fff",
                          border: "1px solid #DFE2E8", padding: "8px 16px", borderRadius: 9, cursor: "pointer",
                        }}
                      >
                        ยกเลิก
                      </button>
                      <button
                        type="button"
                        onClick={() => doResolve(t)}
                        className="co-tap"
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600,
                          color: "#fff", background: "#15803D", border: "none", padding: "8px 18px", borderRadius: 9, cursor: "pointer",
                        }}
                      >
                        <Check size={15} /> ยืนยันปิดงาน
                      </button>
                    </div>
                  </div>
                )}

                {/* แถบ "ยกเลิก" (inline) — เหตุผล */}
                {canAct && cancelFor === t.id && (
                  <div
                    style={{
                      background: "#FCEDEC",
                      border: "1px solid #F0CFCB",
                      borderRadius: 10,
                      padding: "14px 16px",
                      marginTop: 16,
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#9B3127", marginBottom: 10 }}>
                      ยกเลิกการแจ้งซ่อม ตู้ {t.machineCode} ?
                    </div>
                    <textarea
                      value={cancelNote}
                      onChange={(e) => setCancelNote(e.target.value)}
                      maxLength={1000}
                      rows={2}
                      placeholder="เหตุผลที่ยกเลิก (ไม่บังคับ) — เช่น แจ้งซ้ำ / ตู้ปกติดีอยู่แล้ว"
                      style={{
                        width: "100%",
                        fontSize: 12.5,
                        color: "#9B3127",
                        background: "#fff",
                        border: "1px solid #F0CFCB",
                        borderRadius: 9,
                        padding: "9px 12px",
                        resize: "vertical",
                        fontFamily: "inherit",
                        lineHeight: 1.5,
                        marginBottom: 12,
                      }}
                    />
                    <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                      <button
                        type="button"
                        onClick={closeInline}
                        className="co-tap"
                        style={{
                          fontSize: 13, fontWeight: 600, color: "#5A6270", background: "#fff",
                          border: "1px solid #DFE2E8", padding: "8px 16px", borderRadius: 9, cursor: "pointer",
                        }}
                      >
                        ไม่ยกเลิก
                      </button>
                      <button
                        type="button"
                        onClick={() => doCancel(t)}
                        className="co-tap"
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600,
                          color: "#fff", background: "#B42318", border: "none", padding: "8px 18px", borderRadius: 9, cursor: "pointer",
                        }}
                      >
                        <X size={15} /> ยืนยันยกเลิก
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* lightbox รูป */}
      <Modal
        open={lightbox !== null}
        onClose={() => setLightbox(null)}
        title="รูปแจ้งซ่อมจากหน้างาน"
        width={720}
      >
        <div style={{ padding: 16, display: "flex", justifyContent: "center", background: "#111318" }}>
          {lightbox && (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={lightbox}
                alt="รูปแจ้งซ่อม"
                style={{ maxWidth: "100%", maxHeight: "72vh", borderRadius: 10, display: "block" }}
              />
            </>
          )}
        </div>
      </Modal>

      {/* drill-down ประวัติซ่อมรายตู้ (timeline) */}
      <Modal
        open={historyFor !== null}
        onClose={() => setHistoryFor(null)}
        title={`ประวัติซ่อม ตู้ ${historyMachineCode}`}
        sub="รายการแจ้งซ่อมทั้งหมดของตู้นี้ · ใหม่ → เก่า"
        width={620}
      >
        <div style={{ padding: "16px 20px" }}>
          {historyRows.length === 0 ? (
            <EmptyState
              icon={<History size={28} />}
              title="ยังไม่มีประวัติซ่อม"
              sub="ตู้นี้ยังไม่เคยถูกแจ้งซ่อม"
            />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {historyRows.map((h, idx) => {
                const sm = STATUS_META[h.status] ?? STATUS_META.OPEN;
                const last = idx === historyRows.length - 1;
                return (
                  <div key={h.id} style={{ display: "flex", gap: 12 }}>
                    {/* rail */}
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: "0 0 auto" }}>
                      <span
                        style={{
                          width: 12,
                          height: 12,
                          borderRadius: "50%",
                          background: sm.accent,
                          marginTop: 4,
                          flex: "0 0 12px",
                          boxShadow: "0 0 0 3px #fff",
                        }}
                      />
                      {!last && <span style={{ width: 2, flex: 1, background: "#E8EAED", marginTop: 2 }} />}
                    </div>
                    {/* content */}
                    <div style={{ paddingBottom: last ? 0 : 18, flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                        <Pill tone={sm.tone}>{sm.label}</Pill>
                        <span style={{ fontSize: 11.5, color: "#9AA1AB" }}>{timeLabel(h.reportedAt)}</span>
                        {h.meterResetRequested && (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10.5, color: "#4F46E5" }}>
                            <Gauge size={11} /> ตั้งมิเตอร์ใหม่
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 13, color: "#3F4650" }}>
                        <b>อาการ:</b> {h.symptom}
                      </div>
                      <div style={{ fontSize: 11.5, color: "#9AA1AB", marginTop: 2 }}>
                        แจ้งโดย {h.reportedByName || "—"}
                        {h.status === "RESOLVED" && h.resolvedByName ? ` · ปิดงานโดย ${h.resolvedByName}` : ""}
                      </div>
                      {h.resolutionNote && (
                        <div style={{ fontSize: 11.5, color: "#5A6270", marginTop: 4, background: "#F8F9FB", borderRadius: 8, padding: "7px 10px" }}>
                          {h.resolutionNote}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
