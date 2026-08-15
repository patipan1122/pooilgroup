"use client";

/**
 * ตู้คีบ OS — ฝากเงิน (client)
 * ปิดจุดบอดเงิน "มือพนักงาน → ธนาคาร": พิสูจน์ว่าเงินที่แม่บ้านเก็บได้ ถูกฝากเข้าธนาคารครบ.
 *
 * 2 แท็บ:
 *  (1) "รอฝาก" — รอบที่เก็บเงินแล้วแต่ยังไม่ฝาก (เงิน "ค้างมือ").
 *      เลือกหลายรอบ (checkbox) → รวมยอด "เก็บได้" → ฟอร์มบันทึกฝาก (ยอดฝากจริง + สลิป + วันที่ + note)
 *      → โชว์ preview ส่วนต่าง (ฝากจริง − เก็บได้ = ขาด/เกิน) ก่อนกดยืนยัน → recordCashDeposit.
 *      แถวเกินกำหนด (overdue) ไฮไลต์แดง.
 *  (2) "ประวัติฝาก" — ใบฝากย้อนหลัง (ฝากจริง vs ควรฝาก + ป้าย OK/SHORT/OVER + สลิป lightbox).
 *      แถว SHORT เด่นแดง = สัญญาณเงินหายช่วง มือ→ธนาคาร.
 *
 * ธีมเดิม indigo full-bleed · reuse kit.tsx/format.ts · empty state ซื่อสัตย์.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Wallet,
  Banknote,
  AlertTriangle,
  Check,
  Clock,
  Building2,
  ImageIcon,
  Info,
} from "lucide-react";
import { Pill, IconBox, EmptyState, Modal } from "@/components/clawfleet/os/kit";
import { baht, num, type Tone } from "@/components/clawfleet/os/format";
import { PhotoCaptureButton } from "@/components/clawfleet/photo-capture-button";
import type {
  PendingDepositRow,
  DepositRow,
} from "@/lib/clawfleet/deposit-queries";
import { recordCashDeposit, reviewCashDeposit } from "@/lib/clawfleet/deposit-actions";

/* ── สถานะใบฝาก → ป้ายสี ─────────────────────────────────────────────────── */
const DEPOSIT_STATUS_META: Record<string, { label: string; tone: Tone; accent: string; emoji: string }> = {
  OK: { label: "ตรง", tone: "green", accent: "#15803D", emoji: "🟢" },
  SHORT: { label: "ขาด", tone: "red", accent: "#B42318", emoji: "🔴" },
  OVER: { label: "เกิน", tone: "amber", accent: "#B45309", emoji: "🟠" },
};

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

/** วันนี้ "YYYY-MM-DD" สำหรับ default ช่องวันที่ฝาก */
function todayLocalISO(): string {
  const d = new Date();
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

type TabKey = "pending" | "history";

export function DepositsClient({
  pending,
  history,
  orgId,
  currentUserName,
}: {
  pending: PendingDepositRow[];
  history: DepositRow[];
  orgId: string;
  currentUserName: string;
}) {
  const [tab, setTab] = useState<TabKey>("pending");
  // ข้อมูลจริงจาก server เป็นหลัก · optimistic เฉพาะตอนบันทึกฝากสำเร็จ
  const [pendingRows, setPendingRows] = useState<PendingDepositRow[]>(pending);
  const [historyRows, setHistoryRows] = useState<DepositRow[]>(history);

  // per-viewer review context — denormalize มากับทุก DepositRow (page.tsx ไม่ได้ส่ง prop นี้แยก).
  // ใช้ค่าจากแถวแรกที่มี (เหมือนกันทุกแถว) · ไม่มีประวัติเลย → fallback ปลอดภัย
  //   (optimistic row เป็นใบที่ตัวเองเพิ่งฝาก → maker ≠ checker กันไม่ให้ตัวเองอนุมัติอยู่แล้ว).
  const reviewCtx = useMemo(
    () => ({
      canReview: history[0]?.canReview ?? false,
      currentUserId: history[0]?.currentUserId ?? "",
    }),
    [history],
  );

  // รอบที่เลือกไว้ (Set ของ sessionId)
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // ฟอร์มบันทึกฝาก
  const [amountText, setAmountText] = useState("");
  const [slipUrl, setSlipUrl] = useState("");
  // สลิปกำลังอัปโหลดอยู่ไหม — กันกด "ยืนยันบันทึกฝาก" ก่อนรูปขึ้น R2 จริง (2026-08-15)
  const [slipUploading, setSlipUploading] = useState(false);
  const [depositDate, setDepositDate] = useState(todayLocalISO());
  const [note, setNote] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const router = useRouter();

  // ── review ใบฝากขาด (SHORT) — อนุมัติ/ตีกลับ ──
  const [reviewingId, setReviewingId] = useState<string | null>(null); // ใบที่กำลังตัดสิน (disable ปุ่ม)
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [isReviewing, startReview] = useTransition();

  function handleReview(depositId: string, decision: "approve" | "reject") {
    setReviewError(null);
    setReviewingId(depositId);
    startReview(async () => {
      const res = await reviewCashDeposit({ depositId, decision });
      if (!res.ok) {
        setReviewError(res.error || "ทำรายการไม่สำเร็จ ลองอีกครั้ง");
        setReviewingId(null);
        return;
      }
      if (decision === "approve") {
        // approve → stamp ในแถวเดิม (รอบยังผูกใบ · ไม่ต้องดึงรายการรอฝากใหม่)
        setHistoryRows((prev) =>
          prev.map((r) =>
            r.id === depositId
              ? { ...r, approvalStatus: "APPROVED", reviewedByName: currentUserName || "—" }
              : r,
          ),
        );
        setReviewingId(null);
      } else {
        // reject → รอบถูกคืนกลับ "รอฝาก" ที่ server → refresh ดึงรายการรอฝาก + ประวัติที่อัปเดตจริง
        setHistoryRows((prev) =>
          prev.map((r) =>
            r.id === depositId
              ? { ...r, approvalStatus: "REJECTED", reviewedByName: currentUserName || "—" }
              : r,
          ),
        );
        setReviewingId(null);
        router.refresh();
      }
    });
  }

  // lightbox สลิป
  const [lightbox, setLightbox] = useState<string | null>(null);

  /* ── รอฝาก: สรุปยอดที่เลือก ─────────────────────────────────────────────── */
  const selectedRows = useMemo(
    () => pendingRows.filter((r) => selected.has(r.sessionId)),
    [pendingRows, selected],
  );
  const expectedCents = useMemo(
    () => selectedRows.reduce((s, r) => s + r.cashCents, 0),
    [selectedRows],
  );
  // สาขาของรอบที่เลือก — ต้องเป็นสาขาเดียวกันจึงบันทึกฝากรวมได้ (สลิป 1 ใบ = 1 สาขา)
  const selectedBranchIds = useMemo(
    () => Array.from(new Set(selectedRows.map((r) => r.branchId))),
    [selectedRows],
  );
  const mixedBranch = selectedBranchIds.length > 1;
  const depositBranchId = selectedBranchIds[0] ?? "";
  const depositBranchName = selectedRows[0]?.branchName ?? null;

  // ยอดฝากจริง (บาท) → เซนต์ · parse graceful
  const amountBaht = Number(amountText);
  const amountValid = amountText.trim() !== "" && !Number.isNaN(amountBaht) && amountBaht >= 0;
  const amountCents = amountValid ? Math.round(amountBaht * 100) : 0;
  // ส่วนต่าง preview: ฝากจริง − เก็บได้ (+ เกิน / − ขาด)
  const varianceCents = amountCents - expectedCents;

  const overduePending = useMemo(() => pendingRows.filter((r) => r.overdue).length, [pendingRows]);
  const totalPendingCents = useMemo(
    () => pendingRows.reduce((s, r) => s + r.cashCents, 0),
    [pendingRows],
  );

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setFormError(null);
  }

  function resetForm() {
    setSelected(new Set());
    setAmountText("");
    setSlipUrl("");
    setDepositDate(todayLocalISO());
    setNote("");
    setFormError(null);
  }

  function submitDeposit() {
    setFormError(null);
    if (slipUploading) {
      setFormError("รอรูปอัปโหลดเสร็จก่อนสักครู่ แล้วกดอีกครั้ง");
      return;
    }
    if (selectedRows.length === 0) {
      setFormError("เลือกรอบที่ต้องการบันทึกฝากอย่างน้อย 1 รอบ");
      return;
    }
    if (mixedBranch) {
      setFormError("รอบที่เลือกอยู่คนละสาขา — สลิป 1 ใบต้องเป็นของสาขาเดียว กรุณาเลือกเฉพาะรอบสาขาเดียวกัน");
      return;
    }
    if (!amountValid) {
      setFormError("กรอกยอดเงินที่ฝากจริง (บาท)");
      return;
    }
    const sessionIds = selectedRows.map((r) => r.sessionId);
    const depositedAtISO = new Date(`${depositDate}T00:00:00`).toISOString();
    const noteTrim = note.trim();
    startTransition(async () => {
      const res = await recordCashDeposit({
        sessionIds,
        amountCents,
        slipPhotoUrl: slipUrl || undefined,
        depositedAt: depositedAtISO,
        note: noteTrim || undefined,
      });
      if (!res.ok) {
        setFormError(res.error || "บันทึกฝากไม่สำเร็จ ลองอีกครั้ง");
        return;
      }
      // optimistic: ตัดรอบที่ฝากแล้วออกจาก "รอฝาก" + ใส่ใบฝากใหม่หัวประวัติ
      const depositedSet = new Set(sessionIds);
      setPendingRows((prev) => prev.filter((r) => !depositedSet.has(r.sessionId)));
      const newRow: DepositRow = {
        id: res.data.depositId,
        depositCode: res.data.depositCode || "รอซิงก์…",
        branchId: selectedRows[0]?.branchId ?? "",
        branchName: depositBranchName,
        amountCents,
        expectedCents,
        varianceCents: res.data.varianceCents,
        status: res.data.status,
        approvalStatus: res.data.approvalStatus,
        reviewedByName: null,
        // maker = ผู้ใช้ปัจจุบัน → maker ≠ checker กันตัวเองอนุมัติใบตัวเองอยู่แล้ว
        depositedById: reviewCtx.currentUserId,
        canReview: reviewCtx.canReview,
        currentUserId: reviewCtx.currentUserId,
        sessionCount: sessionIds.length,
        depositedByName: currentUserName || "—",
        depositedAt: depositedAtISO,
        slipPhotoUrl: slipUrl || null,
        note: noteTrim || null,
      };
      setHistoryRows((prev) => [newRow, ...prev]);
      resetForm();
      setTab("history");
    });
  }

  return (
    <div>
      {/* แบนเนอร์อธิบาย flow (indigo) — เก็บ → ฝาก → พิสูจน์เข้าธนาคารครบ */}
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
          <Wallet size={16} />
        </IconBox>
        <span style={{ fontSize: 13, color: "#3F3AAE", lineHeight: 1.5 }}>
          เงินที่พนักงานเก็บได้แต่ละรอบ จะอยู่สถานะ <b>“ค้างมือ”</b> จนกว่าจะบันทึกว่า
          <b> ฝากเข้าธนาคารแล้ว</b> — ระบบเทียบยอดฝากจริงกับยอดที่เก็บได้ เพื่อพิสูจน์ว่าเงิน
          จากมือพนักงานเข้าธนาคารครบ ไม่หายระหว่างทาง
          {overduePending > 0 && (
            <>
              {" · "}
              <b className="num" style={{ color: "#B42318" }}>{overduePending}</b> รอบเลยกำหนดฝาก
            </>
          )}
        </span>
      </div>

      {/* แท็บ */}
      <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
        {([
          { key: "pending", label: "รอฝาก", count: pendingRows.length },
          { key: "history", label: "ประวัติฝาก", count: historyRows.length },
        ] as { key: TabKey; label: string; count: number }[]).map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
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
              {t.label}
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
                {num(t.count)}
              </span>
            </button>
          );
        })}
      </div>

      {tab === "pending" ? (
        <PendingTab
          rows={pendingRows}
          selected={selected}
          onToggle={toggleRow}
          totalPendingCents={totalPendingCents}
          overdueCount={overduePending}
          selectedRows={selectedRows}
          expectedCents={expectedCents}
          mixedBranch={mixedBranch}
          depositBranchId={depositBranchId}
          depositBranchName={depositBranchName}
          amountText={amountText}
          onAmountChange={(v) => {
            setAmountText(v);
            setFormError(null);
          }}
          amountValid={amountValid}
          varianceCents={varianceCents}
          slipUrl={slipUrl}
          onSlipChange={setSlipUrl}
          onSlipUploadStatus={(s) => setSlipUploading(s.uploading)}
          depositDate={depositDate}
          onDateChange={setDepositDate}
          note={note}
          onNoteChange={setNote}
          formError={formError}
          onSubmit={submitDeposit}
          onClearSelection={resetForm}
          submitting={isPending || slipUploading}
          orgId={orgId}
        />
      ) : (
        <HistoryTab
          rows={historyRows}
          onOpenSlip={setLightbox}
          onReview={handleReview}
          reviewingId={reviewingId}
          reviewBusy={isReviewing}
          reviewError={reviewError}
        />
      )}

      {/* lightbox สลิป */}
      <Modal
        open={lightbox !== null}
        onClose={() => setLightbox(null)}
        title="สลิปการฝากเงิน"
        width={620}
      >
        <div style={{ padding: 16, display: "flex", justifyContent: "center", background: "#111318" }}>
          {lightbox && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={lightbox}
              alt="สลิปการฝากเงิน"
              style={{ maxWidth: "100%", maxHeight: "72vh", borderRadius: 10, display: "block" }}
            />
          )}
        </div>
      </Modal>
    </div>
  );
}

/* ══ แท็บ (1) รอฝาก ════════════════════════════════════════════════════════ */
function PendingTab({
  rows,
  selected,
  onToggle,
  totalPendingCents,
  overdueCount,
  selectedRows,
  expectedCents,
  mixedBranch,
  depositBranchId,
  depositBranchName,
  amountText,
  onAmountChange,
  amountValid,
  varianceCents,
  slipUrl,
  onSlipChange,
  onSlipUploadStatus,
  depositDate,
  onDateChange,
  note,
  onNoteChange,
  formError,
  onSubmit,
  onClearSelection,
  submitting,
  orgId,
}: {
  rows: PendingDepositRow[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  totalPendingCents: number;
  overdueCount: number;
  selectedRows: PendingDepositRow[];
  expectedCents: number;
  mixedBranch: boolean;
  depositBranchId: string;
  depositBranchName: string | null;
  amountText: string;
  onAmountChange: (v: string) => void;
  amountValid: boolean;
  varianceCents: number;
  slipUrl: string;
  onSlipChange: (url: string) => void;
  onSlipUploadStatus: (status: { uploading: boolean; error: string | null }) => void;
  depositDate: string;
  onDateChange: (v: string) => void;
  note: string;
  onNoteChange: (v: string) => void;
  formError: string | null;
  onSubmit: () => void;
  onClearSelection: () => void;
  submitting: boolean;
  orgId: string;
}) {
  const hasSelection = selectedRows.length > 0;
  // ส่วนต่าง preview: < 0 ขาด(แดง) · > 0 เกิน(ส้ม) · = 0 ตรง(เขียว)
  const varTone: Tone = varianceCents < 0 ? "red" : varianceCents > 0 ? "amber" : "green";
  const varAccent = varianceCents < 0 ? "#B42318" : varianceCents > 0 ? "#B45309" : "#15803D";
  const varLabel = varianceCents < 0 ? "ขาด" : varianceCents > 0 ? "เกิน" : "ตรงพอดี";
  const varBg = varianceCents < 0 ? "#FFF9F8" : varianceCents > 0 ? "#FCF8EC" : "#F2FAF5";

  if (rows.length === 0) {
    return (
      <div style={{ background: "#fff", border: "1px dashed #D9DCE3", borderRadius: 16 }}>
        <EmptyState
          icon={<Wallet size={30} />}
          title="ไม่มีเงินค้างมือ"
          sub="ทุกรอบที่เก็บเงินแล้ว ถูกบันทึกว่าฝากเข้าธนาคารครบแล้ว — ไม่มีเงินค้างที่มือพนักงาน"
        />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* สรุปยอดค้างมือทั้งหมด */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          background: "#fff",
          border: "1px solid #E8EAED",
          borderRadius: 14,
          padding: "16px 20px",
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ fontSize: 12, color: "#9AA1AB", marginBottom: 3 }}>เงินค้างมือรวม (ยังไม่ฝาก)</div>
          <div className="num" style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.5px", color: "#1A1D21" }}>
            {baht(totalPendingCents)}
          </div>
        </div>
        <div style={{ height: 34, width: 1, background: "#EDEFF2" }} />
        <div>
          <div style={{ fontSize: 12, color: "#9AA1AB", marginBottom: 3 }}>จำนวนรอบค้าง</div>
          <div className="num" style={{ fontSize: 18, fontWeight: 700, color: "#3F4650" }}>{num(rows.length)} รอบ</div>
        </div>
        {overdueCount > 0 && (
          <>
            <div style={{ height: 34, width: 1, background: "#EDEFF2" }} />
            <div>
              <div style={{ fontSize: 12, color: "#9AA1AB", marginBottom: 3 }}>เลยกำหนดฝาก</div>
              <div className="num" style={{ fontSize: 18, fontWeight: 700, color: "#B42318" }}>
                {num(overdueCount)} รอบ
              </div>
            </div>
          </>
        )}
      </div>

      {/* ตารางรอบที่รอฝาก */}
      <div style={{ background: "#fff", border: "1px solid #E8EAED", borderRadius: 14, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#F8F9FB", color: "#6B7280", textAlign: "left" }}>
                <th style={{ padding: "11px 14px", fontWeight: 600, width: 44 }}></th>
                <th style={{ padding: "11px 14px", fontWeight: 600 }}>รหัสรอบ</th>
                <th style={{ padding: "11px 14px", fontWeight: 600 }}>สาขา</th>
                <th style={{ padding: "11px 14px", fontWeight: 600 }}>คนถือ</th>
                <th style={{ padding: "11px 14px", fontWeight: 600, textAlign: "right" }}>เก็บได้</th>
                <th style={{ padding: "11px 14px", fontWeight: 600 }}>ค้าง</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isSel = selected.has(r.sessionId);
                return (
                  <tr
                    key={r.sessionId}
                    onClick={() => onToggle(r.sessionId)}
                    style={{
                      borderTop: "1px solid #F0F1F4",
                      cursor: "pointer",
                      background: r.overdue ? "#FFF6F5" : isSel ? "#F5F6FF" : "#fff",
                    }}
                  >
                    <td style={{ padding: "11px 14px" }}>
                      <input
                        type="checkbox"
                        checked={isSel}
                        onChange={() => onToggle(r.sessionId)}
                        onClick={(e) => e.stopPropagation()}
                        style={{ width: 16, height: 16, accentColor: "#4F46E5", cursor: "pointer" }}
                      />
                    </td>
                    <td className="num" style={{ padding: "11px 14px", fontWeight: 600, color: "#3F4650" }}>
                      {r.sessionCode}
                    </td>
                    <td style={{ padding: "11px 14px", color: "#3F4650" }}>{r.branchName ?? "—"}</td>
                    <td style={{ padding: "11px 14px", color: "#5A6270" }}>{r.holderName || "—"}</td>
                    <td className="num" style={{ padding: "11px 14px", textAlign: "right", fontWeight: 700, color: "#1A1D21" }}>
                      {baht(r.cashCents)}
                    </td>
                    <td style={{ padding: "11px 14px" }}>
                      {r.overdue ? (
                        <Pill tone="red">
                          <Clock size={11} style={{ marginRight: 3, verticalAlign: "-1px" }} />
                          เลยกำหนด {num(r.daysOverdue)} วัน
                        </Pill>
                      ) : (
                        <span style={{ fontSize: 12, color: "#9AA1AB" }}>
                          {r.daysOverdue > 0 ? `${num(r.daysOverdue)} วัน` : "วันนี้"}
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

      {/* ── ฟอร์มบันทึกฝาก — โผล่เมื่อเลือกอย่างน้อย 1 รอบ ────────────────────── */}
      {hasSelection && (
        <div
          className="co-accent-l"
          style={{
            background: "#fff",
            border: "1px solid #D9DBFB",
            borderRadius: 14,
            padding: "18px 22px",
            ["--co-accent" as string]: "#4F46E5",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <IconBox tone="brand" size={30} radius={9}>
              <Banknote size={16} />
            </IconBox>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>
                บันทึกการฝากเงิน
                {depositBranchName ? ` · ${depositBranchName}` : ""}
              </div>
              <div style={{ fontSize: 12, color: "#9AA1AB", marginTop: 1 }}>
                เลือก {num(selectedRows.length)} รอบ · รวมที่เลือก{" "}
                <b className="num" style={{ color: "#4F46E5" }}>{baht(expectedCents)}</b>
              </div>
            </div>
          </div>

          {/* เตือน: รอบคนละสาขา */}
          {mixedBranch && (
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
                fontSize: 12,
                background: "#FCF8EC",
                border: "1px solid #F0E2BE",
                borderRadius: 10,
                padding: "10px 13px",
                marginBottom: 14,
                color: "#7A5510",
              }}
            >
              <Info size={14} color="#B45309" style={{ flex: "0 0 14px", marginTop: 1 }} />
              <span>
                รอบที่เลือกอยู่คนละสาขา — สลิปธนาคาร 1 ใบควรเป็นของ <b>สาขาเดียว</b>{" "}
                กรุณาเลือกเฉพาะรอบของสาขาเดียวกันก่อนบันทึก
              </span>
            </div>
          )}

          {/* ยอดฝากจริง */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "#3F4650", marginBottom: 6 }}>
              ยอดเงินที่ฝากจริง (บาท)
            </label>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={amountText}
              onChange={(e) => onAmountChange(e.target.value)}
              placeholder="เช่น 12500"
              className="num"
              style={{
                width: "100%",
                maxWidth: 260,
                fontSize: 18,
                fontWeight: 700,
                color: "#1A1D21",
                background: "#fff",
                border: "1px solid #D9DBFB",
                borderRadius: 10,
                padding: "11px 14px",
              }}
            />
          </div>

          {/* preview ส่วนต่าง (ฝากจริง − เก็บได้) — โชว์เมื่อกรอกยอดแล้ว */}
          {amountValid && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                background: varBg,
                border: `1px solid ${varAccent}33`,
                borderRadius: 10,
                padding: "12px 16px",
                marginBottom: 14,
                flexWrap: "wrap",
              }}
            >
              <div style={{ fontSize: 12, color: "#6B7280" }}>
                เก็บได้ <b className="num" style={{ color: "#3F4650" }}>{baht(expectedCents)}</b>
              </div>
              <span style={{ color: "#C4C9D0" }}>→</span>
              <div style={{ fontSize: 12, color: "#6B7280" }}>
                ฝากจริง <b className="num" style={{ color: "#3F4650" }}>{baht(Math.round(Number(amountText) * 100))}</b>
              </div>
              <div style={{ flex: 1 }} />
              <Pill tone={varTone}>
                {varLabel}
                {varianceCents !== 0 && (
                  <>
                    {" "}
                    <b className="num">{baht(Math.abs(varianceCents))}</b>
                  </>
                )}
              </Pill>
            </div>
          )}

          {/* สลิป + วันที่ */}
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 14 }}>
            <div style={{ flex: "1 1 220px", minWidth: 0 }}>
              <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "#3F4650", marginBottom: 6 }}>
                สลิปการฝาก (ถ่าย/แนบ)
              </label>
              <PhotoCaptureButton
                label="ถ่ายสลิปฝากเงิน"
                value={slipUrl}
                onChange={onSlipChange}
                onUploadStatus={onSlipUploadStatus}
                orgId={orgId}
                machineCode={`deposit-${depositBranchId || "none"}`}
                eventScopeId={`deposit-${depositBranchId || "none"}`}
                phase="cash"
              />
            </div>
            <div style={{ flex: "1 1 200px", minWidth: 0 }}>
              <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "#3F4650", marginBottom: 6 }}>
                วันที่ฝาก
              </label>
              <input
                type="date"
                value={depositDate}
                onChange={(e) => onDateChange(e.target.value)}
                className="num"
                style={{
                  width: "100%",
                  fontSize: 14,
                  color: "#3F4650",
                  background: "#fff",
                  border: "1px solid #D9DBFB",
                  borderRadius: 10,
                  padding: "11px 14px",
                }}
              />
            </div>
          </div>

          {/* note */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "#3F4650", marginBottom: 6 }}>
              บันทึกเพิ่มเติม (ไม่บังคับ)
            </label>
            <textarea
              value={note}
              onChange={(e) => onNoteChange(e.target.value)}
              maxLength={1000}
              rows={2}
              placeholder="เช่น ฝากผ่านตู้ ATM สาขาชลบุรี / เลขอ้างอิงสลิป"
              style={{
                width: "100%",
                fontSize: 12.5,
                color: "#3F4650",
                background: "#fff",
                border: "1px solid #D9DBFB",
                borderRadius: 10,
                padding: "9px 12px",
                resize: "vertical",
                fontFamily: "inherit",
                lineHeight: 1.5,
              }}
            />
          </div>

          {/* error inline */}
          {formError && (
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
                marginBottom: 14,
                color: "#9B3127",
              }}
            >
              <AlertTriangle size={14} color="#B42318" style={{ flex: "0 0 14px", marginTop: 1 }} />
              <span>{formError}</span>
            </div>
          )}

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={onClearSelection}
              disabled={submitting}
              className="co-tap"
              style={{
                fontSize: 13, fontWeight: 600, color: "#5A6270", background: "#fff",
                border: "1px solid #DFE2E8", padding: "9px 16px", borderRadius: 9,
                cursor: submitting ? "not-allowed" : "pointer",
              }}
            >
              ล้างการเลือก
            </button>
            <button
              type="button"
              onClick={onSubmit}
              disabled={submitting}
              className="co-tap"
              style={{
                display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600,
                color: "#fff", background: "#4F46E5", border: "none", padding: "9px 20px", borderRadius: 9,
                cursor: submitting ? "not-allowed" : "pointer", opacity: submitting ? 0.6 : 1,
              }}
            >
              <Check size={15} /> {submitting ? "กำลังบันทึก…" : "ยืนยันบันทึกฝาก"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── ป้ายสถานะอนุมัติใบฝากขาด (SHORT · Wave 4b maker-checker) ─────────────── */
const APPROVAL_META: Record<string, { label: string; bg: string; border: string; color: string }> = {
  PENDING: { label: "⏳ รออนุมัติ", bg: "#FCF8EC", border: "#F0E2BE", color: "#7A5510" },
  APPROVED: { label: "✅ อนุมัติแล้ว", bg: "#F2FAF5", border: "#CFE9D8", color: "#15803D" },
  REJECTED: { label: "↩️ ตีกลับ", bg: "#FCEDEC", border: "#F0CFCB", color: "#9B3127" },
};

/* ══ แท็บ (2) ประวัติฝาก ═══════════════════════════════════════════════════ */
function HistoryTab({
  rows,
  onOpenSlip,
  onReview,
  reviewingId,
  reviewBusy,
  reviewError,
}: {
  rows: DepositRow[];
  onOpenSlip: (url: string) => void;
  onReview: (depositId: string, decision: "approve" | "reject") => void;
  reviewingId: string | null;
  reviewBusy: boolean;
  reviewError: string | null;
}) {
  if (rows.length === 0) {
    return (
      <div style={{ background: "#fff", border: "1px dashed #D9DCE3", borderRadius: 16 }}>
        <EmptyState
          icon={<Banknote size={30} />}
          title="ยังไม่มีประวัติการฝาก"
          sub="เมื่อบันทึกการฝากเงินเข้าธนาคาร ใบฝากจะมาอยู่ที่นี่ พร้อมเทียบยอดฝากจริงกับยอดที่เก็บได้"
        />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {rows.map((d) => {
        const sm = DEPOSIT_STATUS_META[d.status] ?? DEPOSIT_STATUS_META.OK;
        const isShort = d.status === "SHORT";
        // คำเรียกส่วนต่างตามทิศ (SHORT/OVER) — ใช้ในข้อความ maker-checker ให้อ่านถูกทั้งขาดและเกิน
        const varianceWord = d.status === "OVER" ? "เงินเกิน" : "เงินขาด";
        // maker-checker (Wave 4b) — ใบยอดไม่ตรง (SHORT/OVER) ที่รออนุมัติ + ผู้ใช้เป็น ผจก./แอดมิน + ไม่ใช่คนฝากเอง
        const am = APPROVAL_META[d.approvalStatus] ?? null;
        const isPendingReview = d.approvalStatus === "PENDING";
        const isMaker = d.depositedById !== "" && d.depositedById === d.currentUserId;
        const canActNow = isPendingReview && d.canReview && !isMaker;
        const rowBusy = reviewBusy && reviewingId === d.id;
        return (
          <div
            key={d.id}
            className="co-accent-l"
            style={{
              background: isShort ? "#FFF9F8" : "#fff",
              border: `1px solid ${isShort ? "#F3D9D5" : "#E8EAED"}`,
              borderRadius: 14,
              padding: "18px 22px",
              ["--co-accent" as string]: sm.accent,
            }}
          >
            {/* หัวการ์ด: เลขที่ + สาขา + ป้ายสถานะ */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
              <div
                className="num"
                style={{
                  minWidth: 44, height: 40, flex: "0 0 auto", padding: "0 12px", borderRadius: 10,
                  background: "#EEF0FE", color: "#4F46E5", fontSize: 12.5, fontWeight: 700,
                  display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid #D9DBFB",
                }}
              >
                {d.depositCode}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                  <Building2 size={14} color="#9AA1AB" />
                  {d.branchName ?? "สาขา"}
                </div>
                <div style={{ fontSize: 11.5, color: "#9AA1AB" }}>
                  ฝากโดย {d.depositedByName || "—"} · {timeLabel(d.depositedAt)} · {num(d.sessionCount)} รอบ
                </div>
              </div>
              <Pill tone={sm.tone}>
                {sm.emoji} {sm.label}
                {d.varianceCents !== 0 && (
                  <>
                    {" "}
                    <b className="num">{baht(Math.abs(d.varianceCents))}</b>
                  </>
                )}
              </Pill>
              {/* ป้ายสถานะอนุมัติ (เฉพาะใบ SHORT ที่เข้า flow อนุมัติ · NONE ไม่โชว์) */}
              {am && (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    fontSize: 11.5,
                    fontWeight: 700,
                    background: am.bg,
                    border: `1px solid ${am.border}`,
                    color: am.color,
                    borderRadius: 20,
                    padding: "3px 10px",
                  }}
                >
                  {am.label}
                  {d.approvalStatus !== "PENDING" && d.reviewedByName && (
                    <span style={{ fontWeight: 500 }}> · โดย {d.reviewedByName}</span>
                  )}
                </span>
              )}
            </div>

            {/* ฝากจริง vs ควรฝาก */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                background: "#F8F9FB",
                borderRadius: 10,
                padding: "12px 16px",
                flexWrap: "wrap",
              }}
            >
              <div>
                <div style={{ fontSize: 11, color: "#9AA1AB", marginBottom: 2 }}>ควรฝาก (เก็บได้)</div>
                <div className="num" style={{ fontSize: 16, fontWeight: 700, color: "#3F4650" }}>{baht(d.expectedCents)}</div>
              </div>
              <span style={{ color: "#C4C9D0" }}>→</span>
              <div>
                <div style={{ fontSize: 11, color: "#9AA1AB", marginBottom: 2 }}>ฝากจริง</div>
                <div className="num" style={{ fontSize: 16, fontWeight: 700, color: "#1A1D21" }}>{baht(d.amountCents)}</div>
              </div>
              <div style={{ flex: 1 }} />
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 11, color: "#9AA1AB", marginBottom: 2 }}>ส่วนต่าง</div>
                <div className="num" style={{ fontSize: 16, fontWeight: 700, color: sm.accent }}>
                  {d.varianceCents > 0 ? "+" : ""}{baht(d.varianceCents)}
                </div>
              </div>
            </div>

            {/* SHORT = เตือนเงินหายช่วงมือ→ธนาคาร */}
            {isShort && (
              <div
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
                <span>
                  <b>ฝากขาด {baht(Math.abs(d.varianceCents))}</b> — เงินที่เก็บได้เข้าธนาคารไม่ครบ
                  เป็นสัญญาณเงินหายช่วง “มือพนักงาน → ธนาคาร” ควรตรวจสอบ
                </span>
              </div>
            )}

            {/* ── maker-checker · ปุ่มอนุมัติ/ตีกลับ (เฉพาะ ผจก./แอดมิน ที่ไม่ใช่คนฝากใบนี้) ── */}
            {canActNow && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  marginTop: 12,
                  paddingTop: 12,
                  borderTop: "1px dashed #EDD9A8",
                }}
              >
                <div style={{ fontSize: 11.5, color: "#7A5510" }}>
                  ใบฝาก{varianceWord}นี้ (ยอดไม่ตรง) ต้องมีผู้จัดการ/แอดมิน (ไม่ใช่คนฝาก) รับรอง —
                  <b> อนุมัติ</b> ถ้ายอมรับว่า{varianceWord}จริง หรือ <b>ตีกลับ</b> ให้ฝากใหม่ให้ยอดตรง
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={() => onReview(d.id, "approve")}
                    disabled={rowBusy}
                    className="co-tap"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: "#fff",
                      background: "#15803D",
                      border: "none",
                      padding: "8px 16px",
                      borderRadius: 9,
                      cursor: rowBusy ? "not-allowed" : "pointer",
                      opacity: rowBusy ? 0.6 : 1,
                    }}
                  >
                    <Check size={14} /> {rowBusy ? "กำลังบันทึก…" : `อนุมัติ (รับทราบ${varianceWord})`}
                  </button>
                  <button
                    type="button"
                    onClick={() => onReview(d.id, "reject")}
                    disabled={rowBusy}
                    className="co-tap"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: "#9B3127",
                      background: "#fff",
                      border: "1px solid #F0CFCB",
                      padding: "8px 16px",
                      borderRadius: 9,
                      cursor: rowBusy ? "not-allowed" : "pointer",
                      opacity: rowBusy ? 0.6 : 1,
                    }}
                  >
                    ↩️ ตีกลับ (ให้ฝากใหม่)
                  </button>
                </div>
                {reviewError && reviewingId === d.id && (
                  <div
                    role="alert"
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 8,
                      fontSize: 12,
                      color: "#9B3127",
                    }}
                  >
                    <AlertTriangle size={14} color="#B42318" style={{ flex: "0 0 14px", marginTop: 1 }} />
                    <span>{reviewError}</span>
                  </div>
                )}
              </div>
            )}

            {/* ใบ PENDING แต่ผู้ใช้ไม่มีสิทธิ์ตัดสิน (คนฝากเอง / staff) — แจ้งว่ารอคนอื่นรับรอง */}
            {isPendingReview && !canActNow && (
              <div style={{ fontSize: 11.5, color: "#7A5510", marginTop: 10 }}>
                {isMaker
                  ? "รอผู้จัดการ/แอดมินคนอื่นรับรอง (คุณเป็นผู้บันทึกฝากใบนี้ · อนุมัติเองไม่ได้)"
                  : `รอผู้จัดการ/แอดมินรับรอง${varianceWord}`}
              </div>
            )}

            {/* note + สลิป */}
            {(d.note || d.slipPhotoUrl) && (
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
                {d.note && (
                  <span style={{ fontSize: 11.5, color: "#5A6270", background: "#F8F9FB", borderRadius: 8, padding: "6px 10px" }}>
                    {d.note}
                  </span>
                )}
                {d.slipPhotoUrl && (
                  <button
                    type="button"
                    onClick={() => onOpenSlip(d.slipPhotoUrl!)}
                    className="co-tap"
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600,
                      color: "#4F46E5", background: "#EEF0FE", border: "1px solid #D9DBFB",
                      padding: "6px 12px", borderRadius: 9, cursor: "pointer",
                    }}
                  >
                    <ImageIcon size={13} /> ดูสลิป
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
