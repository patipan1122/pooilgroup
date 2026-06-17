"use client";

// ClawHub admin — a single refund-request card with approve/reject actions and a
// click-to-enlarge screenshot. The signed screenshot URL is generated server-side
// (PDPA: refund photos are private member data) and passed in as `screenshotUrl`.

import { useState, useTransition } from "react";
import { approveRefundAction, rejectRefundAction } from "../_actions";
import { RefundStatusBadge } from "../_components/ui";
import type { ClawhubRefundStatus } from "@/lib/generated/prisma/client";

export type RefundCardData = {
  id: string;
  status: ClawhubRefundStatus;
  screenshotUrl: string | null;
  claimedBaht: number;
  aiReadBaht: number | null;
  aiConfidence: string;
  machineCode: string | null;
  branchId: string | null;
  decisionReason: string | null;
  createdAt: string; // formatted
  pointsAwarded: number;
  reviewNote: string | null;
  member: {
    name: string;
    code: string;
    refundCount: number;
    pointsBalance: number;
  };
};

export function RefundCard({ data }: { data: RefundCardData }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [note, setNote] = useState("");
  const [zoom, setZoom] = useState(false);
  const [decided, setDecided] = useState<ClawhubRefundStatus | null>(null);

  const status = decided ?? data.status;
  const isPending = status === "PENDING_REVIEW";

  function approve() {
    setMsg(null);
    start(async () => {
      const res = await approveRefundAction({ requestId: data.id, note: note || undefined });
      if (res.ok) {
        setDecided("APPROVED");
        setMsg({ kind: "ok", text: "อนุมัติแล้ว · เพิ่มแต้มให้ลูกค้าเรียบร้อย" });
      } else {
        setMsg({ kind: "err", text: res.error ?? "อนุมัติไม่สำเร็จ" });
      }
    });
  }

  function reject() {
    setMsg(null);
    start(async () => {
      const res = await rejectRefundAction({ requestId: data.id, note: note || undefined });
      if (res.ok) {
        setDecided("REJECTED");
        setMsg({ kind: "ok", text: "ปฏิเสธคำขอแล้ว" });
      } else {
        setMsg({ kind: "err", text: res.error ?? "ปฏิเสธไม่สำเร็จ" });
      }
    });
  }

  const aiMatch =
    data.aiReadBaht != null && data.aiReadBaht === data.claimedBaht;

  return (
    <div className="cw-card overflow-hidden">
      <div className="flex flex-col gap-4 p-4 sm:flex-row">
        {/* Screenshot */}
        <div className="shrink-0">
          {data.screenshotUrl ? (
            <button
              type="button"
              onClick={() => setZoom(true)}
              className="block overflow-hidden rounded-xl border"
              style={{ borderColor: "var(--cw-border)" }}
              title="คลิกเพื่อขยาย"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={data.screenshotUrl}
                alt="ภาพหน้าจอตู้"
                className="h-40 w-40 object-cover"
              />
            </button>
          ) : (
            <div
              className="flex h-40 w-40 items-center justify-center rounded-xl border text-xs"
              style={{ borderColor: "var(--cw-border)", color: "var(--cw-text-3)" }}
            >
              ไม่มีรูป
            </div>
          )}
        </div>

        {/* Details */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <RefundStatusBadge status={status} />
              <span className="text-xs" style={{ color: "var(--cw-text-3)" }}>
                {data.createdAt}
              </span>
            </div>
            {status !== "PENDING_REVIEW" && data.pointsAwarded > 0 ? (
              <span className="cw-tnum text-sm font-bold" style={{ color: "var(--cw-ok)" }}>
                +{data.pointsAwarded} แต้ม
              </span>
            ) : null}
          </div>

          {/* Money read */}
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Field label="ลูกค้ากรอก">
              <b className="cw-tnum">{data.claimedBaht}฿</b>
            </Field>
            <Field label="AI อ่านได้">
              <b className="cw-tnum" style={{ color: aiMatch ? "var(--cw-ok)" : "var(--cw-charcoal)" }}>
                {data.aiReadBaht != null ? `${data.aiReadBaht}฿` : "—"}
              </b>
            </Field>
            <Field label="ความมั่นใจ AI">
              <b className="cw-tnum">{data.aiConfidence}</b>
            </Field>
            <Field label="ตู้ / สาขา">
              <span>{data.machineCode ?? "—"}</span>
            </Field>
          </div>

          <div className="mt-2 text-sm">
            <span style={{ color: "var(--cw-text-3)" }}>สมาชิก: </span>
            <b>{data.member.name}</b>{" "}
            <span style={{ color: "var(--cw-text-3)" }}>
              ({data.member.code} · คืนมาแล้ว {data.member.refundCount} ครั้ง · แต้มคงเหลือ{" "}
              <span className="cw-tnum">{data.member.pointsBalance}</span>)
            </span>
          </div>

          {data.decisionReason ? (
            <div className="mt-2 text-xs" style={{ color: "var(--cw-text-2)" }}>
              เหตุผลระบบ: {data.decisionReason}
            </div>
          ) : null}
          {!isPending && data.reviewNote ? (
            <div className="mt-1 text-xs" style={{ color: "var(--cw-text-2)" }}>
              หมายเหตุผู้ตรวจ: {data.reviewNote}
            </div>
          ) : null}

          {/* Actions (only for pending) */}
          {isPending ? (
            <div className="mt-4 space-y-2">
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="หมายเหตุ (ไม่บังคับ · จะส่งให้ลูกค้าเมื่อปฏิเสธ)"
                className="w-full rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: "var(--cw-border)", background: "var(--cw-bg-2)" }}
                disabled={pending}
              />
              <div className="flex gap-2">
                <button type="button" className="cw-btn" onClick={approve} disabled={pending}>
                  {pending ? "กำลังทำ…" : "อนุมัติ"}
                </button>
                <button
                  type="button"
                  className="cw-btn"
                  onClick={reject}
                  disabled={pending}
                  style={{ background: "var(--cw-red)" }}
                >
                  ปฏิเสธ
                </button>
              </div>
            </div>
          ) : null}

          {msg ? (
            <p
              className="mt-2 text-sm font-semibold"
              style={{ color: msg.kind === "ok" ? "var(--cw-ok)" : "var(--cw-danger)" }}
            >
              {msg.text}
            </p>
          ) : null}
        </div>
      </div>

      {/* Lightbox */}
      {zoom && data.screenshotUrl ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setZoom(false)}
          role="dialog"
          aria-modal="true"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={data.screenshotUrl}
            alt="ภาพหน้าจอตู้ (ขยาย)"
            className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
          />
        </div>
      ) : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs" style={{ color: "var(--cw-text-3)" }}>
        {label}
      </div>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}
