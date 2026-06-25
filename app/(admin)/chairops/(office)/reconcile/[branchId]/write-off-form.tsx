"use client";

// Write-off "ตั้งต้นใหม่" form (CEO 2026-06-25).
// Pick a date → the server computes the drift accumulated UP TO that day and
// auto-fills the amount + direction (ขาด/เกิน). The CEO can override both, must
// give a reason, and submits as a maker-checker approval request (server action
// `requestWriteOff`). All money math stays server-side; this only orchestrates
// the auto-fill fetch + the form fields.

import { useEffect, useState } from "react";
import { requestWriteOff } from "../../../reconcile/actions";

type Direction = "SHORT" | "OVER";

const fmt = (n: number) => n.toLocaleString("en-US");

export function WriteOffForm({ branchId, today }: { branchId: string; today: string }) {
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState("");
  const [direction, setDirection] = useState<Direction>("SHORT");
  const [residual, setResidual] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [touchedAmount, setTouchedAmount] = useState(false);

  // Fetch the drift-as-of the chosen date and auto-fill amount + direction.
  // Re-runs whenever the date changes. We only overwrite the amount field while
  // the CEO hasn't manually edited it (touchedAmount), so a hand-typed figure
  // is never clobbered by a refetch.
  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    let cancelled = false;
    setLoading(true);
    setErr(null);
    fetch(
      `/api/chairops/reconcile/drift-asof?branchId=${encodeURIComponent(
        branchId,
      )}&date=${date}`,
    )
      .then((r) => r.json())
      .then((data: { amount?: number; direction?: Direction; residual?: number; error?: string }) => {
        if (cancelled) return;
        if (data.error) {
          setErr(data.error);
          setResidual(null);
          return;
        }
        setResidual(data.residual ?? 0);
        if (data.direction) setDirection(data.direction);
        if (!touchedAmount) setAmount(String(data.amount ?? 0));
      })
      .catch(() => {
        if (!cancelled) setErr("ดึงยอดไม่สำเร็จ");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, branchId]);

  const dirLabel = direction === "SHORT" ? "เงินขาด (ค้างฝาก)" : "เงินเกิน (ฝากเกิน)";
  const hint =
    residual === null
      ? null
      : residual === 0
        ? `ยอดหาย/เกินสะสมถึง ${date} = 0 — ไม่มีอะไรต้องตั้งต้น`
        : residual > 0
          ? `ยอดขาดสะสมถึง ${date} = +${fmt(residual)} ฿ (ค้างฝาก) → ตั้งต้นแล้วยอดจะเป็น 0`
          : `ยอดเกินสะสมถึง ${date} = ${fmt(residual)} ฿ (ฝากเกิน) → ตั้งต้นแล้วยอดจะเป็น 0`;

  return (
    <form action={requestWriteOff} aria-label="แบบฟอร์มตัดเงินขาด/เกิน ตั้งต้นใหม่">
      <input type="hidden" name="branchId" value={branchId} />
      <input type="hidden" name="effectiveDate" value={date} />
      <input type="hidden" name="direction" value={direction} />

      {/* วันตั้งต้น */}
      <label
        htmlFor="wo-date"
        className="text-2"
        style={{ display: "block", fontSize: 12, fontWeight: 600 }}
      >
        ตั้งต้น ณ วันที่
      </label>
      <input
        id="wo-date"
        type="date"
        value={date}
        max={today}
        onChange={(e) => {
          setTouchedAmount(false); // a fresh date may suggest a fresh amount
          setDate(e.target.value);
        }}
        className="input mono"
        style={{ margin: "4px 0 12px" }}
      />

      {/* hint = ยอดที่ระบบคำนวณให้ */}
      {hint && (
        <p
          className="text-3"
          style={{
            fontSize: 12,
            margin: "0 0 12px",
            color: loading ? "var(--text-3)" : residual && residual !== 0 ? "var(--accent)" : "var(--text-3)",
          }}
        >
          {loading ? "กำลังคำนวณยอด…" : hint}
        </p>
      )}
      {err && (
        <p className="text-3" style={{ fontSize: 12, margin: "0 0 12px", color: "var(--crit)" }}>
          {err}
        </p>
      )}

      {/* ทิศ ขาด/เกิน */}
      <span className="text-2" style={{ display: "block", fontSize: 12, fontWeight: 600 }}>
        ประเภท
      </span>
      <div style={{ display: "flex", gap: 8, margin: "4px 0 12px" }}>
        {(["SHORT", "OVER"] as Direction[]).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDirection(d)}
            className={direction === d ? "btn btn-primary" : "btn"}
            style={{ flex: 1, fontSize: 13 }}
          >
            {d === "SHORT" ? "เงินขาด" : "เงินเกิน"}
          </button>
        ))}
      </div>

      {/* จำนวนเงิน */}
      <label
        htmlFor="wo-amount"
        className="text-2"
        style={{ display: "block", fontSize: 12, fontWeight: 600 }}
      >
        จำนวนเงิน (บาท) · {dirLabel}
      </label>
      <input
        id="wo-amount"
        type="number"
        name="amount"
        min={1}
        max={1_000_000}
        required
        value={amount}
        onChange={(e) => {
          setTouchedAmount(true);
          setAmount(e.target.value);
        }}
        className="input mono"
        style={{ margin: "4px 0 12px" }}
      />

      {/* เหตุผล (บังคับ) */}
      <label
        htmlFor="wo-reason"
        className="text-2"
        style={{ display: "block", fontSize: 12, fontWeight: 600 }}
      >
        เหตุผล (บังคับ)
      </label>
      <textarea
        id="wo-reason"
        name="reason"
        required
        rows={3}
        minLength={5}
        maxLength={500}
        placeholder="เช่น ตั้งต้นยอดสาขา · แม่บ้านลาออก · ยอดหายไป · POS รายงานผิด"
        className="input"
        style={{ margin: "4px 0 12px", resize: "vertical" }}
      />

      <button type="submit" className="btn btn-primary" style={{ width: "100%" }}>
        ส่งคำขออนุมัติ
      </button>
    </form>
  );
}
