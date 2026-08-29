"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { RsBadge } from "@/components/rentspace/ui";
import { formatBaht } from "@/lib/rentspace/format";
import { actDecideContractTerms } from "../../_actions";

type Field = "rent" | "discount";

function FieldRow({
  contractId,
  field,
  label,
  status,
  pendingValue,
  canDecide,
}: {
  contractId: string;
  field: Field;
  label: string;
  status: string;
  pendingValue: number | null;
  canDecide: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);

  const decide = (decision: "approve" | "reject") => {
    setBusy(decision);
    startTransition(async () => {
      try {
        await actDecideContractTerms(contractId, field, decision);
        toast.success(decision === "approve" ? "อนุมัติแล้ว" : "ปฏิเสธคำขอแล้ว");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "ทำรายการไม่สำเร็จ");
      } finally {
        setBusy(null);
      }
    });
  };

  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="flex items-center gap-2">
        <span className="text-[13px]" style={{ color: "var(--rs-text-2)" }}>
          {label}
        </span>
        <RsBadge kind="discount" status={status} />
        {status === "pending" && pendingValue != null && (
          <span className="text-[13px] font-medium" style={{ color: "var(--rs-text)" }}>
            ขอเปลี่ยนเป็น {formatBaht(pendingValue)}
          </span>
        )}
      </div>
      {status === "pending" && canDecide && (
        <div className="flex items-center gap-1.5">
          <button
            className="rs-btn min-h-[36px] px-3 text-[12.5px]"
            style={{ background: "var(--rs-ok)", color: "#fff" }}
            disabled={pending}
            onClick={() => decide("approve")}
          >
            {busy === "approve" ? "..." : "อนุมัติ"}
          </button>
          <button
            className="rs-btn rs-btn-ghost min-h-[36px] px-3 text-[12.5px]"
            disabled={pending}
            onClick={() => decide("reject")}
          >
            {busy === "reject" ? "..." : "ปฏิเสธ"}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * แสดงเฉพาะเมื่อมีคำขอ/ประวัติอนุมัติค่าเช่า-ส่วนลด (status !== "none")
 * ปุ่มอนุมัติ/ปฏิเสธเห็นเฉพาะ super_admin (CEO 2026-08-29: เฉพาะ super admin เท่านั้น)
 */
export function TermsApprovalPanel({
  contractId,
  rentStatus,
  pendingRentAmountThb,
  discountStatus,
  pendingPromoDiscountThb,
  canDecide,
}: {
  contractId: string;
  rentStatus: string;
  pendingRentAmountThb: number | null;
  discountStatus: string;
  pendingPromoDiscountThb: number | null;
  canDecide: boolean;
}) {
  if (rentStatus === "none" && discountStatus === "none") return null;
  return (
    <div
      className="mt-3 rounded-lg px-3 py-1 divide-y"
      style={{ background: "var(--rs-bg-2)", borderColor: "var(--rs-border)" }}
    >
      {rentStatus !== "none" && (
        <FieldRow
          contractId={contractId}
          field="rent"
          label="อนุมัติค่าเช่า"
          status={rentStatus}
          pendingValue={pendingRentAmountThb}
          canDecide={canDecide}
        />
      )}
      {discountStatus !== "none" && (
        <FieldRow
          contractId={contractId}
          field="discount"
          label="อนุมัติส่วนลด"
          status={discountStatus}
          pendingValue={pendingPromoDiscountThb}
          canDecide={canDecide}
        />
      )}
    </div>
  );
}
