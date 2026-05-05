// Floating AI Chat — bottom-right button with slide-up sheet
// Auditmekub-style numbered section, blue accent

"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { Bot, Send, X, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface Msg {
  role: "user" | "assistant";
  content: string;
  ts: number;
}

const SUGGESTIONS = [
  "สาขาไหนยอดดีสุดเดือนนี้?",
  "EV ทำไมยอดตกช่วงนี้?",
  "เดือนนี้จะถึงเป้าไหม?",
  "เครดิตค้างรวมเท่าไหร่?",
  "สาขาไหนไม่กรอกบ่อยสุด?",
];

export function AiChat() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [pending, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [msgs, open]);

  function send(question?: string) {
    const text = (question ?? input).trim();
    if (!text || pending) return;
    setInput("");
    const userMsg: Msg = { role: "user", content: text, ts: Date.now() };
    setMsgs((cur) => [...cur, userMsg]);

    startTransition(async () => {
      try {
        const res = await fetch("/api/cashhub/ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question: text,
            history: msgs.slice(-6).map((m) => ({
              role: m.role,
              content: m.content,
            })),
          }),
        });
        const json = await res.json();
        if (!res.ok) {
          setMsgs((cur) => [
            ...cur,
            {
              role: "assistant",
              content: `❌ ${json.error || "ติดต่อ AI ไม่ได้"}`,
              ts: Date.now(),
            },
          ]);
          return;
        }
        setMsgs((cur) => [
          ...cur,
          { role: "assistant", content: json.answer, ts: Date.now() },
        ]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "เน็ตขาด";
        setMsgs((cur) => [
          ...cur,
          { role: "assistant", content: `❌ ${msg}`, ts: Date.now() },
        ]);
      }
    });
  }

  return (
    <>
      {/* Floating button */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "fixed bottom-5 right-5 z-40 size-14 rounded-2xl shadow-blue flex items-center justify-center transition-transform hover:scale-105",
          "bg-[var(--color-brand-600)] text-white",
          open && "scale-0 pointer-events-none",
        )}
        aria-label="ถาม AI"
      >
        <Bot className="size-6" />
      </button>

      {/* Backdrop + sheet */}
      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/30"
            onClick={() => setOpen(false)}
          />
          <div className="fixed bottom-0 right-0 sm:bottom-5 sm:right-5 z-50 w-full sm:w-[420px] sm:max-w-[calc(100vw-2.5rem)] h-[85vh] sm:h-[600px] sm:max-h-[calc(100vh-3rem)] bg-white rounded-t-3xl sm:rounded-3xl border-2 border-zinc-200 shadow-pop flex flex-col overflow-hidden">
            {/* Header */}
            <div className="px-4 sm:px-5 py-3 border-b-2 border-zinc-100 flex items-center justify-between bg-gradient-to-br from-[var(--color-brand-50)] to-white">
              <div className="flex items-center gap-2.5">
                <div className="size-9 rounded-xl bg-[var(--color-brand-600)] text-white flex items-center justify-center shadow-blue">
                  <Sparkles className="size-4" />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-[var(--color-brand-600)] font-bold">
                    AI ASSISTANT
                  </p>
                  <p className="text-base font-extrabold font-display leading-tight">
                    ถาม <span className="accent">AI</span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="size-9 rounded-xl hover:bg-zinc-100 flex items-center justify-center"
                aria-label="ปิด"
              >
                <X className="size-5" />
              </button>
            </div>

            {/* Messages */}
            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto p-4 space-y-3"
            >
              {msgs.length === 0 ? (
                <div className="text-sm text-zinc-500">
                  <p className="mb-3">
                    👋 สวัสดี ถามอะไรเกี่ยวกับยอดสาขาได้เลย
                  </p>
                  <div className="space-y-1.5">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => send(s)}
                        className="block w-full text-left px-3 py-2 rounded-xl bg-zinc-50 hover:bg-[var(--color-brand-50)] hover:text-[var(--color-brand-700)] text-xs sm:text-sm transition-colors border border-zinc-100"
                      >
                        💬 {s}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                msgs.map((m, i) => (
                  <div
                    key={i}
                    className={cn(
                      "flex",
                      m.role === "user" ? "justify-end" : "justify-start",
                    )}
                  >
                    <div
                      className={cn(
                        "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap leading-relaxed",
                        m.role === "user"
                          ? "bg-[var(--color-brand-600)] text-white"
                          : "bg-zinc-100 text-zinc-900",
                      )}
                    >
                      {m.content}
                    </div>
                  </div>
                ))
              )}
              {pending && (
                <div className="flex justify-start">
                  <div className="bg-zinc-100 rounded-2xl px-3.5 py-2.5 text-sm flex items-center gap-2">
                    <span className="size-2 rounded-full bg-zinc-400 animate-pulse" />
                    <span className="size-2 rounded-full bg-zinc-400 animate-pulse delay-100" />
                    <span className="size-2 rounded-full bg-zinc-400 animate-pulse delay-200" />
                    <span className="text-zinc-500 ml-1">กำลังคิด...</span>
                  </div>
                </div>
              )}
            </div>

            {/* Input */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
              className="p-3 border-t-2 border-zinc-100 bg-zinc-50/50 safe-bottom"
            >
              <div className="flex items-center gap-2">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="พิมพ์คำถาม..."
                  disabled={pending}
                  className="flex-1 h-11 rounded-xl border border-zinc-200 px-4 text-sm bg-white outline-none focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)]"
                />
                <button
                  type="submit"
                  disabled={pending || !input.trim()}
                  className="size-11 rounded-xl bg-[var(--color-brand-600)] text-white shadow-blue flex items-center justify-center disabled:bg-zinc-300 disabled:shadow-none transition-colors hover:bg-[var(--color-brand-700)]"
                >
                  <Send className="size-4" />
                </button>
              </div>
              <p className="text-[10px] text-zinc-400 mt-1.5 text-center">
                AI ตอบจากข้อมูลล่าสุดของระบบ — ใช้ Gemini Flash (ฟรี) · ตรวจสอบก่อนตัดสินใจ
              </p>
            </form>
          </div>
        </>
      )}
    </>
  );
}
