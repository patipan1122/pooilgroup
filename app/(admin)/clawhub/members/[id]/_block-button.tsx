"use client";

// ClawHub admin — block / unblock a member.
import { useState, useTransition } from "react";
import { setMemberBlockedAction } from "../../_actions";

export function BlockButton({ memberId, blocked }: { memberId: string; blocked: boolean }) {
  const [pending, start] = useTransition();
  const [isBlocked, setIsBlocked] = useState(blocked);
  const [err, setErr] = useState<string | null>(null);

  function toggle() {
    setErr(null);
    const next = !isBlocked;
    start(async () => {
      const res = await setMemberBlockedAction({ memberId, block: next });
      if (res.ok) setIsBlocked(next);
      else setErr(res.error ?? "ทำรายการไม่สำเร็จ");
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        className="cw-btn"
        onClick={toggle}
        disabled={pending}
        style={isBlocked ? undefined : { background: "var(--cw-red)" }}
      >
        {pending ? "กำลังทำ…" : isBlocked ? "ปลดระงับสมาชิก" : "ระงับสมาชิก"}
      </button>
      {err ? (
        <span className="text-xs" style={{ color: "var(--cw-danger)" }}>
          {err}
        </span>
      ) : null}
    </div>
  );
}
