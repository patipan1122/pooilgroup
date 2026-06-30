"use client";

import { useMemo, useState, useTransition } from "react";
import { Info, AlertTriangle, ClipboardList, Check, X, ArrowRight } from "lucide-react";
import { Pill, IconBox, EmptyState } from "@/components/clawfleet/os/kit";
import { bahtN, type Tone } from "@/components/clawfleet/os/format";
import {
  approveCfConfigRequest,
  rejectCfConfigRequest,
  type CfConfigRequestView,
  type CfConfigStatus,
} from "@/lib/clawfleet/config-requests";

const STATUS_META: Record<CfConfigStatus, { label: string; tone: Tone }> = {
  pending: { label: "รอตรวจ", tone: "amber" },
  approved: { label: "อนุมัติแล้ว", tone: "green" },
  rejected: { label: "ตีกลับ", tone: "red" },
};

/** ISO → "วันนี้ 09:42" / "เมื่อวาน 17:30" / "12 มิ.ย." */
function timeLabel(iso: string): string {
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

export function ConfigClient({
  branches,
  requests,
}: {
  branches: { id: string; name: string; code: string }[];
  requests: CfConfigRequestView[];
}) {
  // ข้อมูลจริงจาก server เป็นหลัก. optimistic เฉพาะตอนกดอนุมัติ/ตีกลับ (action จริงข้างหลัง).
  const [rows, setRows] = useState<CfConfigRequestView[]>(requests);
  const [isPending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  // error แบบ inline ต่อการ์ด (แทน window.alert) — auto-clear ใน 6 วิ
  const [errorByRow, setErrorByRow] = useState<Record<string, string>>({});
  // ยืนยันในหน้า (แทน window.confirm) — เก็บคำขอ+ผลที่กำลังจะทำ
  const [confirmFor, setConfirmFor] = useState<{ id: string; next: "approved" | "rejected" } | null>(null);

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

  const pendingCount = useMemo(
    () => rows.filter((r) => r.status === "pending").length,
    [rows],
  );

  // กดปุ่ม → เปิดยืนยันในหน้า (ไม่เรียก action จนกว่าจะกด "ใช่")
  function requestDecide(req: CfConfigRequestView, next: "approved" | "rejected") {
    setConfirmFor({ id: req.id, next });
  }

  // ยืนยันแล้ว → เรียก action จริง (wiring เดิม)
  function confirmDecide(req: CfConfigRequestView, next: "approved" | "rejected") {
    setConfirmFor(null);
    setBusyId(req.id);
    startTransition(async () => {
      const res =
        next === "approved"
          ? await approveCfConfigRequest(req.id)
          : await rejectCfConfigRequest(req.id);
      setBusyId(null);
      if (!res.ok) {
        showRowError(req.id, res.error ?? "ทำรายการไม่สำเร็จ ลองอีกครั้ง");
        return;
      }
      // อัปเดตสถานะในหน้าให้ตรง (revalidatePath จะรีเฟรชจริงในรอบถัดไป)
      setRows((prev) =>
        prev.map((r) =>
          r.id === req.id
            ? { ...r, status: next, reviewedAt: new Date().toISOString() }
            : r,
        ),
      );
    });
  }

  const empty = rows.length === 0;

  return (
    <div>
      {/* แบนเนอร์อธิบายขั้นตอน (amber) — พนักงานเสนอ → รอตรวจ จนเจ้าของอนุมัติ */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: "#FCF8EC",
          border: "1px solid #F0E2BE",
          borderRadius: 12,
          padding: "13px 18px",
          marginBottom: 18,
        }}
      >
        <IconBox tone="amber" size={30} radius={9}>
          <Info size={16} />
        </IconBox>
        <span style={{ fontSize: 13, color: "#7A5510", lineHeight: 1.5 }}>
          พนักงานเก็บเงินเป็นผู้เสนอตั้งค่าตู้ — คำขอจะอยู่สถานะ{" "}
          <b>“รอตรวจ”</b> จนกว่าเจ้าของจะกดอนุมัติ
          {pendingCount > 0 && (
            <>
              {" · "}
              <b className="num">{pendingCount}</b> คำขอรอตรวจ
            </>
          )}
          {branches.length > 0 && (
            <>
              {" · "}
              <span style={{ color: "#9A7B3A" }}>{branches.length} สาขาในระบบ</span>
            </>
          )}
        </span>
      </div>

      {/* empty state — ยังไม่มีคำขอจริงในฐานข้อมูล (ไม่โชว์ sample หลอกตา) */}
      {empty ? (
        <div style={{ background: "#fff", border: "1px dashed #D9DCE3", borderRadius: 16 }}>
          <EmptyState
            icon={<ClipboardList size={30} />}
            title="ยังไม่มีคำขอตั้งค่าตู้"
            sub="เมื่อพนักงานเสนอปรับความแรงการคีบหรือราคาขายของตู้ คำขอจะมาอยู่ที่นี่เพื่อรอเจ้าของอนุมัติ"
          />
        </div>
      ) : (
        /* รายการคำขอตั้งค่าตู้ */
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {rows.map((cf) => {
            const sm = STATUS_META[cf.status];
            const isRowPending = cf.status === "pending";
            const rowBusy = busyId === cf.id && isPending;
            return (
              <div
                key={cf.id}
                className="co-accent-l"
                style={{
                  background: "#fff",
                  border: "1px solid #E8EAED",
                  borderRadius: 14,
                  padding: "18px 22px",
                  opacity: rowBusy ? 0.6 : 1,
                  ["--co-accent" as string]:
                    cf.status === "pending" ? "#B45309" : cf.status === "approved" ? "#15803D" : "#B42318",
                }}
              >
                {/* หัวการ์ด: รหัสตู้ + สาขา + ผู้เสนอ + สถานะ */}
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                  <span
                    className="num"
                    style={{
                      minWidth: 40,
                      height: 40,
                      flex: "0 0 auto",
                      padding: "0 8px",
                      borderRadius: 10,
                      background: "#F1F2F7",
                      color: "#4F46E5",
                      fontSize: 12.5,
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {cf.machineCode}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 700 }}>
                      ตู้ {cf.machineCode} · {cf.branchName}
                    </div>
                    <div style={{ fontSize: 11.5, color: "#9AA1AB" }}>
                      เสนอโดย {cf.submittedByName ?? "—"} · {timeLabel(cf.submittedAt)}
                    </div>
                  </div>
                  <Pill tone={sm.tone}>{sm.label}</Pill>
                </div>

                {/* กริดสรุปค่าที่เสนอ — ความแรงคีบ / สินค้า / ราคาขาย */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 mb-4">
                  <div style={{ background: "#F8F9FB", borderRadius: 11, padding: "12px 14px" }}>
                    <div style={{ fontSize: 10.5, color: "#9AA1AB", marginBottom: 7 }}>ปรับความแรงการคีบ</div>
                    {cf.clawFrom !== null && cf.clawTo !== null ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        <span
                          className="num"
                          style={{ fontSize: 13.5, fontWeight: 700, color: "#9AA1AB", background: "#EFF1F4", borderRadius: 7, padding: "3px 9px" }}
                        >
                          {cf.clawFrom}
                        </span>
                        <ArrowRight size={14} color="#9AA1AB" style={{ flex: "0 0 14px" }} />
                        <span className="num" style={{ fontSize: 14, fontWeight: 700, color: "#4F46E5", background: "#EEF0FE", borderRadius: 7, padding: "3px 10px" }}>
                          {cf.clawTo}
                        </span>
                      </div>
                    ) : (
                      <div style={{ fontSize: 13.5, color: "#C5C9D0" }}>ไม่ระบุ</div>
                    )}
                  </div>
                  <div style={{ background: "#F8F9FB", borderRadius: 11, padding: "12px 14px" }}>
                    <div style={{ fontSize: 10.5, color: "#9AA1AB", marginBottom: 7 }}>สินค้าในตู้</div>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>{cf.productName ?? "—"}</div>
                  </div>
                  <div style={{ background: "#F8F9FB", borderRadius: 11, padding: "12px 14px" }}>
                    <div style={{ fontSize: 10.5, color: "#9AA1AB", marginBottom: 7 }}>ราคาขายตั้งไว้</div>
                    <div className="num" style={{ fontSize: 15, fontWeight: 700 }}>
                      {cf.priceBaht !== null ? bahtN(cf.priceBaht) : "—"}
                    </div>
                  </div>
                </div>

                {/* เหตุผล */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 8,
                    fontSize: 12.5,
                    background: "#FCEDEC",
                    borderRadius: 10,
                    padding: "11px 14px",
                    marginBottom: isRowPending ? 16 : 0,
                  }}
                >
                  <AlertTriangle size={15} color="#B42318" style={{ flex: "0 0 15px", marginTop: 1 }} />
                  <span style={{ color: "#9B3127" }}>
                    <b>เหตุผล:</b> {cf.reason}
                  </span>
                </div>

                {/* แสดงผู้ตรวจ (เมื่อ approve/reject แล้ว) */}
                {!isRowPending && cf.reviewedByName && (
                  <div style={{ fontSize: 11.5, color: "#9AA1AB", marginTop: 10 }}>
                    {cf.status === "approved" ? "อนุมัติโดย" : "ตีกลับโดย"} {cf.reviewedByName}
                    {cf.reviewedAt ? ` · ${timeLabel(cf.reviewedAt)}` : ""}
                    {cf.reviewNote ? ` · ${cf.reviewNote}` : ""}
                  </div>
                )}

                {/* error แบบ inline (แทน alert) — auto-clear */}
                {errorByRow[cf.id] && (
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
                    <span>{errorByRow[cf.id]}</span>
                  </div>
                )}

                {/* ปุ่ม (เฉพาะ pending) — ตีกลับ / อนุมัติ · กดแล้วยืนยันในหน้า (ไม่ใช้ popup) */}
                {isRowPending && confirmFor?.id !== cf.id && (
                  <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                    <button
                      type="button"
                      disabled={rowBusy}
                      onClick={() => requestDecide(cf, "rejected")}
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
                        padding: "9px 18px",
                        borderRadius: 9,
                        cursor: rowBusy ? "not-allowed" : "pointer",
                      }}
                    >
                      <X size={15} /> ตีกลับ
                    </button>
                    <button
                      type="button"
                      disabled={rowBusy}
                      onClick={() => requestDecide(cf, "approved")}
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
                      <Check size={15} /> {rowBusy ? "กำลังบันทึก…" : "อนุมัติให้ตั้งค่า"}
                    </button>
                  </div>
                )}

                {/* ยืนยันในหน้า (แทน window.confirm) — ใช่ / ยกเลิก */}
                {isRowPending && confirmFor?.id === cf.id && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      flexWrap: "wrap",
                      justifyContent: "flex-end",
                      background: confirmFor.next === "approved" ? "#F2FAF5" : "#FCEDEC",
                      border: `1px solid ${confirmFor.next === "approved" ? "#CDE9D7" : "#F0CFCB"}`,
                      borderRadius: 10,
                      padding: "12px 16px",
                    }}
                  >
                    <span style={{ flex: 1, minWidth: 180, fontSize: 12.5, fontWeight: 600, color: confirmFor.next === "approved" ? "#15803D" : "#9B3127" }}>
                      {confirmFor.next === "approved" ? "อนุมัติให้ตั้งค่า" : "ตีกลับคำขอ"}ตู้ {cf.machineCode} ({cf.branchName}) ?
                    </span>
                    <button
                      type="button"
                      onClick={() => setConfirmFor(null)}
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
                      onClick={() => confirmDecide(cf, confirmFor.next)}
                      className="co-tap"
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "#fff",
                        background: confirmFor.next === "approved" ? "#15803D" : "#B42318",
                        border: "none", padding: "8px 18px", borderRadius: 9, cursor: "pointer",
                      }}
                    >
                      {confirmFor.next === "approved" ? <Check size={15} /> : <X size={15} />} ใช่
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
