"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/fuelos/ui/button";
import { cn } from "@/lib/fuelos/utils/cn";
import { formatBaht } from "@/lib/fuelos/utils/format";
import {
  advanceOrderStatus,
  cancelOrder,
  assignTruck,
  requestCreditApproval,
  actCreditApproval,
} from "../actions";
import {
  Check,
  Truck as TruckIcon,
  XCircle,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import type { OrderStatus } from "@/lib/generated/prisma/enums";

const STEPS: { status: OrderStatus; label: string }[] = [
  { status: "AWAITING_CONFIRM", label: "รอจัดส่ง" },
  { status: "DELIVERING", label: "กำลังส่ง" },
  { status: "DELIVERED_UNPAID", label: "ส่งแล้ว/รอเก็บเงิน" },
  { status: "CLOSED", label: "ปิดบิล" },
];

const NEXT_LABEL: Partial<Record<OrderStatus, string>> = {
  AWAITING_CONFIRM: "ยืนยัน → กำลังส่ง",
  DELIVERING: "ส่งถึงแล้ว → รอเก็บเงิน",
  DELIVERED_UNPAID: "เก็บเงินครบ → ปิดบิล",
};

type TruckOpt = { id: string; plate: string; status: string; capacityLiters: number };
type Approval = {
  status: "PENDING" | "APPROVED" | "REJECTED";
  amountOver: number;
  note: string | null;
  requestedBy: string | null;
  approvedBy: string | null;
} | null;

export function OrderControls({
  orderId,
  status,
  trucks,
  currentTruckId,
  scheduledDate,
  credit,
  approval,
  canApprove,
}: {
  orderId: string;
  status: OrderStatus;
  trucks: TruckOpt[];
  currentTruckId: string | null;
  scheduledDate: string | null; // yyyy-MM-dd
  credit: {
    creditLimit: number | null;
    creditUsed: number;
    subtotal: number;
    projectedUsed: number;
    overLimit: boolean;
    amountOver: number;
    overrideApproved: boolean;
  };
  approval: Approval;
  canApprove: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [truckId, setTruckId] = useState(currentTruckId ?? "");
  const [schedule, setSchedule] = useState(scheduledDate ?? "");
  const [note, setNote] = useState("");

  const cancelled = status === "CANCELLED";
  const closed = status === "CLOSED";
  const stepIdx = STEPS.findIndex((s) => s.status === status);
  const nextLabel = NEXT_LABEL[status];

  // ต้องขออนุมัติก่อนถึงจะเดินจาก AWAITING ได้ ถ้ายอดเกินวงเงิน
  const blockedByCredit =
    status === "AWAITING_CONFIRM" &&
    credit.overLimit &&
    !credit.overrideApproved;

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    start(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(okMsg);
        router.refresh();
      } else {
        toast.error(res.error ?? "เกิดข้อผิดพลาด");
      }
    });
  }

  return (
    <div className="space-y-4">
      {/* ---- Status stepper ---- */}
      <div className="rounded-2xl border border-border bg-surface p-4">
        <h3 className="font-semibold text-sm mb-3">สถานะออเดอร์</h3>

        {cancelled ? (
          <div className="flex items-center gap-2 text-sm text-danger">
            <XCircle className="size-4" /> ออเดอร์นี้ถูกยกเลิกแล้ว
          </div>
        ) : (
          <ol className="space-y-2 mb-4">
            {STEPS.map((s, i) => {
              const done = i < stepIdx;
              const active = i === stepIdx;
              return (
                <li key={s.status} className="flex items-center gap-2.5 text-sm">
                  <span
                    className={cn(
                      "size-5 rounded-full grid place-items-center text-[10px] shrink-0 border",
                      done && "bg-leaf-500 border-leaf-500 text-white",
                      active && "bg-brand-600 border-brand-600 text-white",
                      !done && !active && "border-border text-zinc-400",
                    )}
                  >
                    {done ? <Check className="size-3" /> : i + 1}
                  </span>
                  <span className={cn(active ? "font-semibold" : done ? "text-zinc-500" : "text-zinc-400")}>
                    {s.label}
                  </span>
                </li>
              );
            })}
          </ol>
        )}

        {!cancelled && !closed && (
          <div className="space-y-2">
            {blockedByCredit ? (
              <p className="text-xs text-warning flex items-center gap-1.5">
                <ShieldAlert className="size-3.5" /> ยอดเกินวงเงิน — ต้องได้รับอนุมัติก่อนจึงจะยืนยันออเดอร์ได้
              </p>
            ) : (
              nextLabel && (
                <Button
                  fullWidth
                  loading={pending}
                  onClick={() => {
                    const next = STEPS[stepIdx + 1]?.status;
                    if (next) run(() => advanceOrderStatus(orderId, next), "อัปเดตสถานะแล้ว");
                  }}
                >
                  {nextLabel}
                </Button>
              )
            )}
            <Button
              fullWidth
              variant="ghost"
              loading={pending}
              onClick={() => {
                if (confirm("ยืนยันยกเลิกออเดอร์นี้?")) {
                  run(() => cancelOrder(orderId), "ยกเลิกออเดอร์แล้ว");
                }
              }}
            >
              <XCircle className="size-4" /> ยกเลิกออเดอร์
            </Button>
          </div>
        )}
        {closed && (
          <div className="flex items-center gap-2 text-sm text-leaf-700">
            <Check className="size-4" /> ปิดบิลเรียบร้อย
          </div>
        )}
      </div>

      {/* ---- Truck + schedule ---- */}
      {!cancelled && (
        <div className="rounded-2xl border border-border bg-surface p-4">
          <h3 className="font-semibold text-sm mb-3 flex items-center gap-1.5">
            <TruckIcon className="size-4 text-zinc-400" /> จัดรถ + วันนัดส่ง
          </h3>
          <label className="block text-xs text-zinc-500 mb-1">รถบรรทุก</label>
          <select
            value={truckId}
            onChange={(e) => setTruckId(e.target.value)}
            className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm mb-3"
          >
            <option value="">— ยังไม่จัดรถ —</option>
            {trucks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.plate} ({t.status})
              </option>
            ))}
          </select>
          <label className="block text-xs text-zinc-500 mb-1">วันนัดส่ง</label>
          <input
            type="date"
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
            className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm mb-3"
          />
          <Button
            size="sm"
            variant="secondary"
            fullWidth
            loading={pending}
            onClick={() =>
              run(() => assignTruck(orderId, truckId || null, schedule || null), "บันทึกการจัดส่งแล้ว")
            }
          >
            บันทึกการจัดส่ง
          </Button>
        </div>
      )}

      {/* ---- Credit check / approval ---- */}
      {credit.creditLimit != null && (
        <div
          className={cn(
            "rounded-2xl border p-4",
            credit.overLimit && !credit.overrideApproved
              ? "border-warning/40 bg-warning/5"
              : "border-border bg-surface",
          )}
        >
          <h3 className="font-semibold text-sm mb-3 flex items-center gap-1.5">
            {credit.overrideApproved ? (
              <ShieldCheck className="size-4 text-leaf-600" />
            ) : (
              <ShieldAlert className={cn("size-4", credit.overLimit ? "text-warning" : "text-zinc-400")} />
            )}
            วงเงินเครดิต
          </h3>

          <div className="text-xs space-y-1 mb-3">
            <Row label="วงเงิน" value={formatBaht(credit.creditLimit)} />
            <Row label="ใช้ไปแล้ว" value={formatBaht(credit.creditUsed)} />
            <Row label="ยอดออเดอร์นี้" value={formatBaht(credit.subtotal)} />
            <div className="h-px bg-border my-1.5" />
            <Row
              label="รวมหลังออเดอร์นี้"
              value={formatBaht(credit.projectedUsed)}
              valueClass={credit.overLimit ? "text-danger font-semibold" : "text-zinc-700"}
            />
          </div>

          {/* สถานะคำขออนุมัติ */}
          {approval && (
            <div
              className={cn(
                "rounded-xl px-3 py-2 text-xs mb-3",
                approval.status === "PENDING" && "bg-warning/15 text-warning",
                approval.status === "APPROVED" && "bg-leaf-100 text-leaf-700",
                approval.status === "REJECTED" && "bg-danger/10 text-danger",
              )}
            >
              {approval.status === "PENDING" && (
                <>รออนุมัติขายเกินวงเงิน {formatBaht(approval.amountOver)} · โดย {approval.requestedBy ?? "—"}</>
              )}
              {approval.status === "APPROVED" && (
                <>อนุมัติขายเกินวงเงินแล้ว · โดย {approval.approvedBy ?? "—"}</>
              )}
              {approval.status === "REJECTED" && (
                <>คำขอถูกปฏิเสธ · โดย {approval.approvedBy ?? "—"}</>
              )}
              {approval.note && <div className="opacity-80 mt-0.5">หมายเหตุ: {approval.note}</div>}
            </div>
          )}

          {/* ขออนุมัติ (เมื่อเกินวงเงิน + ยังไม่ override + ไม่มีคำขอ pending) */}
          {credit.overLimit &&
            !credit.overrideApproved &&
            (!approval || approval.status === "REJECTED") && (
              <div className="space-y-2">
                <p className="text-xs text-zinc-500">
                  เกินวงเงิน {formatBaht(credit.amountOver)} — ขออนุมัติเพื่อขายเกินวงเงิน
                </p>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  placeholder="เหตุผล (ถ้ามี)…"
                  className="w-full rounded-xl border border-border bg-surface p-2.5 text-sm resize-none"
                />
                <Button
                  size="sm"
                  fullWidth
                  loading={pending}
                  onClick={() =>
                    run(() => requestCreditApproval(orderId, note), "ส่งคำขออนุมัติแล้ว")
                  }
                >
                  ขออนุมัติขายเกินวงเงิน
                </Button>
              </div>
            )}

          {/* OWNER อนุมัติ/ปฏิเสธ */}
          {canApprove && approval?.status === "PENDING" && (
            <div className="flex gap-2">
              <Button
                size="sm"
                fullWidth
                loading={pending}
                onClick={() => run(() => actCreditApproval(orderId, true), "อนุมัติแล้ว")}
              >
                <ShieldCheck className="size-4" /> อนุมัติ
              </Button>
              <Button
                size="sm"
                variant="danger"
                fullWidth
                loading={pending}
                onClick={() => run(() => actCreditApproval(orderId, false), "ปฏิเสธแล้ว")}
              >
                ปฏิเสธ
              </Button>
            </div>
          )}

          {!credit.overLimit && !approval && (
            <p className="text-xs text-leaf-700">ยอดอยู่ในวงเงิน ไม่ต้องขออนุมัติ</p>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-zinc-500">{label}</span>
      <span className={cn("tabular-nums", valueClass ?? "text-zinc-700")}>{value}</span>
    </div>
  );
}
