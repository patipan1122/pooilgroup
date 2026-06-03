"use client";

import { useState } from "react";

type State = "idle" | "loading" | "done" | "error";

export function RegisterRichMenuButton({ disabled }: { disabled?: boolean }) {
  const [state, setState] = useState<State>("idle");
  const [msg, setMsg] = useState("");

  async function go() {
    setState("loading");
    setMsg("");
    try {
      const res = await fetch("/api/chairops/richmenu/register", { method: "POST" });
      const data = (await res.json()) as { ok: boolean; message?: string; error?: string };
      if (data.ok) {
        setState("done");
        setMsg(data.message ?? "สำเร็จ");
      } else {
        setState("error");
        setMsg(data.error ?? `เกิดข้อผิดพลาด (${res.status})`);
      }
    } catch (e) {
      setState("error");
      setMsg(e instanceof Error ? e.message : "เชื่อมต่อไม่ได้");
    }
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={go}
        disabled={disabled || state === "loading"}
        className="inline-flex h-12 items-center justify-center rounded-xl bg-emerald-600 px-6 text-base font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {state === "loading" ? "กำลังตั้งเมนู…" : "🦭 ดันเมนู Rich Menu ขึ้น LINE"}
      </button>
      {msg && (
        <p
          className={
            state === "error"
              ? "rounded-lg bg-rose-50 p-3 text-sm text-rose-700"
              : "rounded-lg bg-emerald-50 p-3 text-sm font-medium text-emerald-700"
          }
        >
          {state === "done" ? "✓ " : "⚠️ "}
          {msg}
        </p>
      )}
    </div>
  );
}
