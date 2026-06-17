"use client";

// ClawHub admin — (re)install the LINE rich menu. POSTs to
// /api/clawhub/richmenu/register (built by another agent). We don't assume the
// response shape beyond { ok?: boolean, error?: string, message?: string }.

import { useState } from "react";

export function RichMenuButton() {
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function install() {
    setMsg(null);
    setPending(true);
    try {
      const r = await fetch("/api/clawhub/richmenu/register", { method: "POST" });
      let body: { ok?: boolean; error?: string; message?: string } = {};
      try {
        body = await r.json();
      } catch {
        /* non-JSON response */
      }
      if (r.ok && body.ok !== false) {
        setMsg({ kind: "ok", text: body.message ?? "ติดตั้ง Rich Menu เรียบร้อย" });
      } else {
        setMsg({
          kind: "err",
          text: body.error ?? `ติดตั้งไม่สำเร็จ (HTTP ${r.status})`,
        });
      }
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message });
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <button type="button" className="cw-btn" onClick={install} disabled={pending}>
        {pending ? "กำลังติดตั้ง…" : "ติดตั้ง / อัปเดต Rich Menu"}
      </button>
      {msg ? (
        <p
          className="mt-2 text-sm font-semibold"
          style={{ color: msg.kind === "ok" ? "var(--cw-ok)" : "var(--cw-danger)" }}
        >
          {msg.text}
        </p>
      ) : null}
    </div>
  );
}
