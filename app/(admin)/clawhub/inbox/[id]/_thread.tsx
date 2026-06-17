"use client";

// ClawHub admin — conversation thread: bot toggle + reply box. The message list is
// rendered server-side and passed in; on reply success we refresh the route so the
// new OUT message appears.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { replyConversationAction, setConversationBotAction } from "../../_actions";

export type ThreadMessage = {
  id: string;
  direction: "IN" | "OUT";
  kind: string;
  text: string | null;
  imageUrl: string | null;
  byBot: boolean;
  createdAt: string;
};

export function ThreadControls({
  conversationId,
  botEnabled,
}: {
  conversationId: string;
  botEnabled: boolean;
}) {
  const [pending, start] = useTransition();
  const [on, setOn] = useState(botEnabled);

  function toggle() {
    const next = !on;
    start(async () => {
      const res = await setConversationBotAction({ conversationId, botEnabled: next });
      if (res.ok) setOn(next);
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      className={`cw-chip ${on ? "active" : ""}`}
      style={{ cursor: "pointer" }}
      title="เปิด/ปิดบอทตอบอัตโนมัติสำหรับบทสนทนานี้"
    >
      {on ? "บอทอัตโนมัติ: เปิด" : "บอทอัตโนมัติ: ปิด"}
    </button>
  );
}

export function ReplyBox({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function send() {
    if (!text.trim()) return;
    setErr(null);
    start(async () => {
      const res = await replyConversationAction({ conversationId, text });
      if (res.ok) {
        setText("");
        router.refresh();
      } else {
        setErr(res.error ?? "ส่งไม่สำเร็จ");
      }
    });
  }

  return (
    <div
      className="sticky bottom-0 border-t p-3"
      style={{ borderColor: "var(--cw-border)", background: "var(--cw-bg-2)" }}
    >
      {err ? (
        <p className="mb-1 text-xs font-semibold" style={{ color: "var(--cw-danger)" }}>
          {err}
        </p>
      ) : null}
      <div className="flex items-end gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={1}
          placeholder="พิมพ์ตอบลูกค้า…"
          className="min-h-[44px] flex-1 resize-none rounded-2xl border px-4 py-2.5 text-sm"
          style={{ borderColor: "var(--cw-border)", background: "var(--cw-surface)" }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button type="button" className="cw-btn" onClick={send} disabled={pending || !text.trim()}>
          {pending ? "…" : "ส่ง"}
        </button>
      </div>
    </div>
  );
}

export function MessageBubble({ m }: { m: ThreadMessage }) {
  const isOut = m.direction === "OUT";
  return (
    <div className={`flex ${isOut ? "justify-end" : "justify-start"}`}>
      <div
        className="max-w-[78%] rounded-2xl px-3.5 py-2 text-sm"
        style={{
          background: isOut ? "var(--cw-brand)" : "var(--cw-surface)",
          color: isOut ? "#fff" : "var(--cw-text)",
          border: isOut ? "none" : "1px solid var(--cw-border)",
        }}
      >
        {m.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={m.imageUrl} alt="รูป" className="mb-1 max-h-60 rounded-lg object-contain" />
        ) : null}
        {m.text ? <div className="whitespace-pre-wrap break-words">{m.text}</div> : null}
        {!m.text && !m.imageUrl ? (
          <div style={{ opacity: 0.7 }}>[{m.kind}]</div>
        ) : null}
        <div
          className="mt-0.5 text-[10px]"
          style={{ color: isOut ? "rgba(255,255,255,0.8)" : "var(--cw-text-3)" }}
        >
          {isOut ? (m.byBot ? "บอท" : "แอดมิน") : "ลูกค้า"} · {m.createdAt}
        </div>
      </div>
    </div>
  );
}
