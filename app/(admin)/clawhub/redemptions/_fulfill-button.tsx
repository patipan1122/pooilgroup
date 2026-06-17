"use client";

// ClawHub admin — mark a redemption FULFILLED (staff handed the doll over).
import { useState, useTransition } from "react";
import { fulfillRedemptionAction } from "../_actions";

export function FulfillButton({ redemptionId }: { redemptionId: string }) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function fulfill() {
    setErr(null);
    start(async () => {
      const res = await fulfillRedemptionAction({ redemptionId });
      if (res.ok) setDone(true);
      else setErr(res.error ?? "ทำรายการไม่สำเร็จ");
    });
  }

  if (done) {
    return <span className="cw-badge cw-badge-ok">จ่ายแล้ว ✓</span>;
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button type="button" className="cw-btn" onClick={fulfill} disabled={pending}>
        {pending ? "กำลังทำ…" : "ทำเครื่องหมายว่าจ่ายแล้ว"}
      </button>
      {err ? (
        <span className="text-xs" style={{ color: "var(--cw-danger)" }}>
          {err}
        </span>
      ) : null}
    </div>
  );
}
