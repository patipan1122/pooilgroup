"use client";

// ClawHub admin — inline active/inactive toggle for a reward row.
import { useState, useTransition } from "react";
import { toggleRewardActiveAction } from "../_actions";

export function ActiveToggle({ id, active }: { id: string; active: boolean }) {
  const [pending, start] = useTransition();
  const [on, setOn] = useState(active);

  function toggle() {
    const next = !on;
    start(async () => {
      const res = await toggleRewardActiveAction({ id, isActive: next });
      if (res.ok) setOn(next);
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      className={`cw-badge ${on ? "cw-badge-ok" : "cw-badge-danger"}`}
      style={{ cursor: "pointer", opacity: pending ? 0.6 : 1 }}
      title="คลิกเพื่อเปิด/ปิด"
    >
      {on ? "เปิดแลก" : "ปิด"}
    </button>
  );
}
