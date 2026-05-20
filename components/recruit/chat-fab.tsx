"use client";

import { useState, useRef, useEffect } from "react";
import { Bot, X, Send, Loader2 } from "lucide-react";
import { askChat } from "@/app/(admin)/recruit/_actions/chat";

type Msg = { role: "user" | "assistant"; content: string };

export function RecruitChatFab() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Keyboard shortcut: Cmd+/
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "/") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape" && open) setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    const next: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setLoading(true);
    try {
      const reply = await askChat({
        message: text,
        history: messages,
        context: typeof window !== "undefined" ? window.location.pathname : "",
      });
      setMessages([...next, { role: "assistant", content: reply }]);
    } catch (e) {
      setMessages([
        ...next,
        {
          role: "assistant",
          content: "เกิดข้อผิดพลาด · ลองอีกครั้ง · " + (e as Error).message,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* FAB */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 size-14 rounded-full bg-[var(--color-brand-600)] text-white shadow-xl hover:bg-[var(--color-brand-700)] hover:scale-105 transition-all flex items-center justify-center group"
        aria-label="เปิดผู้ช่วย AI"
        title="ผู้ช่วย AI (⌘/)"
      >
        <Bot className="size-7" />
      </button>

      {/* Panel */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-end p-0 sm:p-6 sm:items-end sm:justify-end"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white w-full sm:w-[400px] h-[88vh] sm:h-[600px] sm:rounded-3xl shadow-2xl flex flex-col border border-zinc-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-zinc-100 bg-gradient-to-r from-[var(--color-brand-50)] to-white rounded-t-3xl">
              <div className="flex items-center gap-2">
                <div className="size-9 rounded-2xl bg-[var(--color-brand-600)] text-white flex items-center justify-center">
                  <Bot className="size-5" />
                </div>
                <div>
                  <p className="font-bold text-zinc-900 text-sm">ผู้ช่วย AI</p>
                  <p className="text-[11px] text-zinc-500">ช่วยร่าง JD · เปรียบเทียบคน · สรุปข้อมูล</p>
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="size-8 rounded-lg hover:bg-zinc-100 flex items-center justify-center"
                aria-label="ปิด"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.length === 0 && !loading && (
                <div className="text-sm text-zinc-500 space-y-3">
                  <p>สวัสดีครับ ผมช่วยอะไรได้บ้าง?</p>
                  <div className="space-y-1.5">
                    <Suggestion
                      text="ช่วยร่าง JD พนักงานขับรถบรรทุก"
                      onClick={(t) => setInput(t)}
                    />
                    <Suggestion
                      text="คำถามสัมภาษณ์พนักงานบัญชี"
                      onClick={(t) => setInput(t)}
                    />
                    <Suggestion
                      text="วิธีใช้โปรแกรมรับสมัครพนักงาน"
                      onClick={(t) => setInput(t)}
                    />
                  </div>
                </div>
              )}
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap leading-relaxed ${
                      m.role === "user"
                        ? "bg-[var(--color-brand-600)] text-white"
                        : "bg-zinc-100 text-zinc-900"
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex justify-start">
                  <div className="bg-zinc-100 rounded-2xl px-4 py-3 flex items-center gap-2">
                    <Loader2 className="size-4 animate-spin text-[var(--color-brand-600)]" />
                    <span className="text-xs text-zinc-600">กำลังคิด...</span>
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div className="border-t border-zinc-100 p-3">
              <div className="flex items-end gap-2">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  placeholder="พิมพ์คำถาม... (Enter ส่ง · Shift+Enter ขึ้นบรรทัด)"
                  className="flex-1 resize-none rounded-xl border border-zinc-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-300)] max-h-24"
                  rows={1}
                  disabled={loading}
                />
                <button
                  onClick={() => void send()}
                  disabled={loading || !input.trim()}
                  className="size-10 rounded-xl bg-[var(--color-brand-600)] text-white flex items-center justify-center disabled:opacity-40 hover:bg-[var(--color-brand-700)]"
                  aria-label="ส่ง"
                >
                  <Send className="size-4" />
                </button>
              </div>
              <p className="text-[10px] text-zinc-400 mt-1.5 text-center">
                ⌘/ เปิด-ปิด · Esc ปิด · AI อาจไม่ถูกเสมอ ตรวจสอบก่อนใช้
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Suggestion({
  text,
  onClick,
}: {
  text: string;
  onClick: (t: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onClick(text)}
      className="w-full text-left text-xs px-3 py-2 rounded-lg border border-zinc-200 hover:border-[var(--color-brand-400)] hover:bg-[var(--color-brand-50)] transition-colors"
    >
      💡 {text}
    </button>
  );
}
