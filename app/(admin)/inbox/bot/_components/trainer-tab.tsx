"use client";

// "เทรนกับ Claude" — chat interface where the CEO describes scenarios in
// Thai and Claude (Anthropic Sonnet 4.6) proposes FAQ / knowledge entries.
// Proposals come back inside ```faq / ```knowledge fenced blocks that we
// parse client-side and render as Apply cards.  Right pane has an inline
// preview that simulates what the live bot would reply for a test message.

import { useState, useTransition, useRef, useEffect } from "react";
import { toast } from "sonner";
import {
  Send,
  Sparkles,
  Plus,
  BookOpen,
  MessageSquareText,
  PlayCircle,
  Loader2,
  AlertTriangle,
  RotateCcw,
} from "lucide-react";
import {
  trainerChat,
  previewBotReply,
  type TrainerTurn,
} from "@/lib/inbox/bot/trainer-actions";
import {
  createFaq,
  createKnowledge,
} from "@/lib/inbox/bot/knowledge-actions";

interface FaqProposal {
  keywords: string;
  intent: string;
  answer: string;
}

interface KnowledgeProposal {
  title: string;
  content: string;
}

interface ParsedAssistant {
  text: string;
  faqs: FaqProposal[];
  knowledge: KnowledgeProposal[];
}

// Parse a Claude reply for ```faq / ```knowledge fenced blocks.  Anything
// outside the blocks is preserved as the conversational reply text.
function parseAssistant(raw: string): ParsedAssistant {
  const faqs: FaqProposal[] = [];
  const knowledge: KnowledgeProposal[] = [];
  let text = raw;

  const re = /```(faq|knowledge)\s*\n([\s\S]*?)```/g;
  text = text.replace(re, (_match, kind: string, body: string) => {
    const fields = parseKeyValueBlock(body);
    if (kind === "faq" && fields.keywords && fields.answer) {
      faqs.push({
        keywords: fields.keywords,
        intent: fields.intent ?? "",
        answer: fields.answer,
      });
    } else if (kind === "knowledge" && fields.title && fields.content) {
      knowledge.push({ title: fields.title, content: fields.content });
    }
    return ""; // strip from chat text
  });

  return { text: text.trim(), faqs, knowledge };
}

// Light "key: value" parser — supports multi-line `answer:` / `content:`
// up to the next recognized key or end of block.
function parseKeyValueBlock(raw: string): Record<string, string> {
  const lines = raw.split("\n");
  const KEYS = new Set([
    "keywords",
    "intent",
    "answer",
    "title",
    "content",
  ]);
  const out: Record<string, string> = {};
  let currentKey: string | null = null;
  for (const line of lines) {
    const m = /^([a-zA-Z_]+)\s*:\s*(.*)$/.exec(line);
    if (m && KEYS.has(m[1].toLowerCase())) {
      currentKey = m[1].toLowerCase();
      out[currentKey] = m[2];
    } else if (currentKey) {
      out[currentKey] = (out[currentKey] + "\n" + line).trim();
    }
  }
  for (const k of Object.keys(out)) out[k] = out[k].trim();
  return out;
}

const HINTS = [
  "ลูกค้าบอกหาเลขเครื่องไม่เจอ — อยากให้บอทบอกให้โทรเข้ามาทันที จะแก้ออนไลน์ใน 30 วินาที",
  "ลูกค้าถามราคา — อยากให้บอทตอบราคา 100฿/50นาที และวิธีชำระ (เหรียญ/แบงค์/QR)",
  "ลูกค้าบอกนวดแรงเจ็บ — อยากเก็บข้อมูล: ตรงไหน, ระดับ 1-10, ชาย/หญิง, อายุ",
  "ลูกค้าถามที่ตั้งสาขา — บอกว่ามีสาขาในห้างไหนบ้าง (ใส่ข้อมูลให้)",
];

// localStorage key — separate per business so chairops history doesn't
// bleed into other org's training sessions.
const STORAGE_KEY = (tag: string) => `inbox-trainer-history:${tag}`;

export function TrainerTab({ businessTag }: { businessTag: string }) {
  const [history, setHistory] = useState<TrainerTurn[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, startSend] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Hydrate from localStorage so a page refresh doesn't lose context.  Done
  // after mount so SSR doesn't render the stored value (would break hydration).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY(businessTag));
      if (raw) {
        const parsed = JSON.parse(raw) as TrainerTurn[];
        if (Array.isArray(parsed)) setHistory(parsed);
      }
    } catch {
      /* corrupt JSON — ignore */
    }
    setHydrated(true);
  }, [businessTag]);

  // Persist on every change so a refresh halfway through still has context.
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY(businessTag), JSON.stringify(history));
    } catch {
      /* quota / disabled — ignore */
    }
  }, [history, businessTag, hydrated]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [history.length, sending]);

  function resetConversation() {
    if (history.length > 0 && !confirm("เริ่มสนทนาใหม่? บทสนทนาเก่าจะหายไป")) {
      return;
    }
    setHistory([]);
    try {
      localStorage.removeItem(STORAGE_KEY(businessTag));
    } catch {
      /* ignore */
    }
  }

  function send(messageText?: string) {
    const userText = (messageText ?? draft).trim();
    if (!userText) return;
    const nextHistory: TrainerTurn[] = [
      ...history,
      { role: "user", content: userText },
    ];
    setHistory(nextHistory);
    setDraft("");
    startSend(async () => {
      try {
        const res = await trainerChat({ history: nextHistory, businessTag });
        setHistory((prev) => [
          ...prev,
          { role: "assistant", content: res.reply },
        ]);
      } catch (e) {
        toast.error((e as Error).message || "Claude ตอบไม่ได้");
        // Roll back the user turn so they can retry without re-typing.
        setHistory((prev) => prev.slice(0, -1));
      }
    });
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_360px]">
      {/* LEFT — chat with Claude */}
      <div className="rounded-2xl border border-zinc-200 bg-white shadow-soft">
        <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3">
          <Sparkles className="size-4 text-[var(--color-brand-600)]" />
          <p className="text-sm font-bold text-zinc-900">เทรนกับ Claude</p>
          <span className="ml-auto text-[11px] text-zinc-500">
            Claude Sonnet 4.6 · จำสนทนาได้ ~40 turn · บันทึกอัตโนมัติ
          </span>
          {history.length > 0 && (
            <button
              type="button"
              onClick={resetConversation}
              className="ml-2 inline-flex h-7 items-center gap-1 rounded-lg border border-zinc-200 px-2.5 text-[11px] font-bold text-zinc-600 hover:bg-zinc-50"
              title="เริ่มสนทนาใหม่"
            >
              <RotateCcw className="size-3.5" />
              เริ่มใหม่
            </button>
          )}
        </div>

        {history.length === 0 ? (
          <div className="space-y-3 p-5">
            <p className="text-sm text-zinc-600">
              เล่าให้ Claude ฟังว่า <strong>ลูกค้าทักแบบไหน</strong>{" "}
              และ <strong>อยากให้บอทตอบแบบไหน</strong>{" "}
              Claude จะแนะนำว่าควรเป็น FAQ / ข้อมูลร้าน / หรือปรับ AI
              พร้อมร่างคำตอบให้ · กด "เพิ่มเลย" ก็ขึ้นระบบทันที
            </p>
            <p className="text-xs text-zinc-500">
              💡 คุยกับ Claude ต่อเนื่องได้เลย — สอบถามเพิ่ม / แก้ร่าง /
              เล่าเคสใหม่ในห้องเดียวกัน Claude จำสิ่งที่เราคุยมาก่อนได้ ·
              บทสนทนาบันทึกไว้ในเบราว์เซอร์อัตโนมัติ (ปิดแล้วเปิดใหม่ก็ยังอยู่)
            </p>
            <p className="text-[11px] font-bold uppercase tracking-wide text-zinc-400">
              ลองพิมพ์
            </p>
            <div className="flex flex-wrap gap-2">
              {HINTS.map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => send(h)}
                  className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs text-zinc-700 hover:border-[var(--color-brand-300)] hover:bg-[var(--color-brand-50)]"
                >
                  {h}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div
            ref={scrollRef}
            className="max-h-[560px] min-h-[320px] space-y-3 overflow-y-auto p-4"
          >
            {history.map((m, i) => (
              <ChatBubble
                key={i}
                role={m.role}
                content={m.content}
                businessTag={businessTag}
              />
            ))}
            {sending && (
              <div className="flex items-center gap-2 text-xs text-zinc-500">
                <Loader2 className="size-3.5 animate-spin" />
                Claude กำลังคิด...
              </div>
            )}
          </div>
        )}

        <div className="border-t border-zinc-200 p-3">
          <div className="flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  send();
                }
              }}
              rows={2}
              placeholder="เล่าให้ Claude ฟัง... (Cmd/Ctrl+Enter เพื่อส่ง)"
              className="flex-1 resize-none rounded-xl border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-300)]"
            />
            <button
              type="button"
              onClick={() => send()}
              disabled={sending || !draft.trim()}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[var(--color-brand-600)] px-4 text-sm font-bold text-white hover:bg-[var(--color-brand-700)] disabled:opacity-40"
            >
              <Send className="size-4" />
              ส่ง
            </button>
          </div>
        </div>
      </div>

      {/* RIGHT — preview pane */}
      <div className="rounded-2xl border border-zinc-200 bg-white shadow-soft">
        <PreviewPane businessTag={businessTag} />
      </div>
    </div>
  );
}

function ChatBubble({
  role,
  content,
  businessTag,
}: {
  role: "user" | "assistant";
  content: string;
  businessTag: string;
}) {
  if (role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-[var(--color-brand-600)] px-3.5 py-2 text-sm text-white">
          {content}
        </div>
      </div>
    );
  }

  const parsed = parseAssistant(content);
  return (
    <div className="space-y-2">
      <div className="max-w-[90%] whitespace-pre-wrap rounded-2xl rounded-bl-md border border-zinc-200 bg-zinc-50 px-3.5 py-2 text-sm text-zinc-900">
        {parsed.text || (
          <span className="text-zinc-500">
            Claude แนะนำให้เพิ่มสิ่งด้านล่างนี้
          </span>
        )}
      </div>
      {parsed.faqs.map((f, i) => (
        <FaqProposalCard key={`faq-${i}`} proposal={f} businessTag={businessTag} />
      ))}
      {parsed.knowledge.map((k, i) => (
        <KnowledgeProposalCard
          key={`kn-${i}`}
          proposal={k}
          businessTag={businessTag}
        />
      ))}
    </div>
  );
}

function FaqProposalCard({
  proposal,
  businessTag,
}: {
  proposal: FaqProposal;
  businessTag: string;
}) {
  const [applied, setApplied] = useState(false);
  const [busy, startBusy] = useTransition();

  function apply() {
    startBusy(async () => {
      try {
        await createFaq({
          businessTag,
          keywords: proposal.keywords,
          answer: proposal.answer,
          intent: proposal.intent || undefined,
        });
        setApplied(true);
        toast.success("เพิ่ม FAQ แล้ว");
      } catch (e) {
        toast.error((e as Error).message || "เพิ่มไม่สำเร็จ");
      }
    });
  }

  return (
    <div className="rounded-xl border border-[var(--color-brand-200)] bg-[var(--color-brand-50)]/40 p-3">
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--color-brand-800)]">
        <MessageSquareText className="size-3.5" />
        ข้อเสนอ FAQ
        {proposal.intent && (
          <span className="rounded bg-white px-1.5 py-0.5 text-[10px] text-zinc-600">
            {proposal.intent}
          </span>
        )}
      </div>
      <p className="text-[11px] text-zinc-500">คำหลัก</p>
      <p className="mb-1.5 text-sm text-zinc-900">{proposal.keywords}</p>
      <p className="text-[11px] text-zinc-500">คำตอบ</p>
      <p className="mb-2 whitespace-pre-wrap text-sm text-zinc-900">
        {proposal.answer}
      </p>
      <button
        type="button"
        onClick={apply}
        disabled={busy || applied}
        className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-brand-600)] px-3 py-1.5 text-xs font-bold text-white hover:bg-[var(--color-brand-700)] disabled:opacity-40"
      >
        <Plus className="size-3.5" />
        {applied ? "เพิ่มแล้ว" : busy ? "กำลังเพิ่ม..." : "เพิ่ม FAQ นี้"}
      </button>
    </div>
  );
}

function KnowledgeProposalCard({
  proposal,
  businessTag,
}: {
  proposal: KnowledgeProposal;
  businessTag: string;
}) {
  const [applied, setApplied] = useState(false);
  const [busy, startBusy] = useTransition();

  function apply() {
    startBusy(async () => {
      try {
        await createKnowledge({
          businessTag,
          title: proposal.title,
          content: proposal.content,
        });
        setApplied(true);
        toast.success("เพิ่มข้อมูลร้านแล้ว");
      } catch (e) {
        toast.error((e as Error).message || "เพิ่มไม่สำเร็จ");
      }
    });
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3">
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-amber-800">
        <BookOpen className="size-3.5" />
        ข้อเสนอข้อมูลร้าน
      </div>
      <p className="mb-1 text-sm font-bold text-zinc-900">{proposal.title}</p>
      <p className="mb-2 whitespace-pre-wrap text-sm text-zinc-900">
        {proposal.content}
      </p>
      <button
        type="button"
        onClick={apply}
        disabled={busy || applied}
        className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-40"
      >
        <Plus className="size-3.5" />
        {applied ? "เพิ่มแล้ว" : busy ? "กำลังเพิ่ม..." : "เพิ่มข้อมูลร้านนี้"}
      </button>
    </div>
  );
}

const PATH_LABEL: Record<string, { label: string; tone: string }> = {
  faq: { label: "FAQ", tone: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  template: {
    label: "Template",
    tone: "bg-sky-50 text-sky-800 border-sky-200",
  },
  ai: { label: "AI Gemini", tone: "bg-purple-50 text-purple-800 border-purple-200" },
  escalate: { label: "ส่งต่อพนักงาน", tone: "bg-red-50 text-red-800 border-red-200" },
};

function PreviewPane({ businessTag }: { businessTag: string }) {
  const [text, setText] = useState("");
  const [busy, startBusy] = useTransition();
  const [result, setResult] = useState<{
    path: string;
    topic: string;
    isUrgent: boolean;
    isLead: boolean;
    isComplaint: boolean;
    reply: string;
    matchedFaqKeywords?: string;
    hasFlowImage: boolean;
  } | null>(null);

  function run() {
    const value = text.trim();
    if (!value) return;
    startBusy(async () => {
      try {
        const r = await previewBotReply({ text: value, businessTag });
        setResult({
          path: r.path,
          topic: r.topic,
          isUrgent: r.isUrgent,
          isLead: r.isLead,
          isComplaint: r.isComplaint,
          reply: r.reply,
          matchedFaqKeywords: r.matchedFaqKeywords,
          hasFlowImage: r.hasFlowImage,
        });
      } catch (e) {
        toast.error((e as Error).message || "พรีวิวไม่สำเร็จ");
      }
    });
  }

  const pathInfo = result ? PATH_LABEL[result.path] : null;

  return (
    <div>
      <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3">
        <PlayCircle className="size-4 text-[var(--color-brand-600)]" />
        <p className="text-sm font-bold text-zinc-900">ทดลองบอทตอบ</p>
      </div>
      <div className="space-y-3 p-4">
        <p className="text-[11px] text-zinc-500">
          พิมพ์ข้อความที่ลูกค้าจะส่ง · ไม่ส่งจริง · แสดงว่าบอทจะใช้ทางไหนตอบ
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder="เช่น &quot;หยอดเงินแล้วเครื่องไม่ทำงาน&quot;"
          className="w-full resize-none rounded-xl border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-300)]"
        />
        <button
          type="button"
          onClick={run}
          disabled={busy || !text.trim()}
          className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-zinc-200 bg-zinc-50 text-sm font-bold text-zinc-800 hover:bg-zinc-100 disabled:opacity-40"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <PlayCircle className="size-4" />
          )}
          ดูว่าบอทจะตอบยังไง
        </button>

        {result && pathInfo && (
          <div className="space-y-2 pt-1">
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 font-bold ${pathInfo.tone}`}
              >
                {pathInfo.label}
              </span>
              <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-zinc-700">
                topic: {result.topic}
              </span>
              {result.isUrgent && (
                <span className="rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 font-bold text-orange-800">
                  ด่วน
                </span>
              )}
              {result.isLead && (
                <span className="rounded-full border border-purple-200 bg-purple-50 px-2 py-0.5 font-bold text-purple-800">
                  สนใจซื้อ
                </span>
              )}
              {result.isComplaint && (
                <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 font-bold text-red-800">
                  ร้องเรียน
                </span>
              )}
              {result.hasFlowImage && (
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-bold text-emerald-800">
                  + รูปประกอบ
                </span>
              )}
            </div>
            {result.matchedFaqKeywords && (
              <p className="text-[11px] text-zinc-500">
                คำหลักที่ตรง: <span className="text-zinc-800">{result.matchedFaqKeywords}</span>
              </p>
            )}
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
              <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-zinc-500">
                บอทจะตอบ
              </p>
              <p className="whitespace-pre-wrap text-sm text-zinc-900">
                {result.reply}
              </p>
            </div>
          </div>
        )}

        {!result && !busy && (
          <div className="rounded-xl border border-dashed border-zinc-200 p-3 text-[11px] text-zinc-500">
            <p className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>
                FAQ → Template → AI ตามลำดับ · ถ้าผลออกมาไม่ตรงใจ ไปปรับที่แท็บ
                "คลังคำตอบ" / "ข้อมูลร้าน" หรือคุยกับ Claude ทางซ้ายให้ช่วย
              </span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
