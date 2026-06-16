"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/fuelos/utils/cn";
import { bkkTime } from "@/lib/fuelos/utils/format";
import { lineEmojiImageUrl, type LineEmoji } from "@/lib/fuelos/line";
import { LineAvatar } from "@/components/fuelos/inbox/line-avatar";
import { ChevronUp, Lock } from "lucide-react";
import { loadOlderMessages } from "@/app/(admin)/fuelos/inbox/actions";
import type { ChatMessage } from "@/lib/fuelos/inbox-data";

// useLayoutEffect บน server จะเตือน — สลับเป็น useEffect ตอน SSR กัน warning
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

const STATUS_PREFIX = "📌 สถานะ:";

type Att =
  | { type: "text"; emojis: LineEmoji[] }
  | { type: "image" | "video" | "audio"; messageId: string | null }
  | { type: "sticker"; stickerId: string | null }
  | { type: "file"; messageId: string | null; fileName: string | null }
  | { type: "location"; lat: number | null; lng: number | null; title: string | null; address: string | null };

// ข้อความ text + LINE emoji พรีเมียม → แทรกรูป emoji ตามตำแหน่ง index/length (clamp กัน index เพี้ยน)
function RichText({ text, emojis, out }: { text: string; emojis: LineEmoji[]; out: boolean }) {
  const sorted = [...emojis].sort((a, b) => a.index - b.index);
  const nodes: ReactNode[] = [];
  let cursor = 0;
  sorted.forEach((e, i) => {
    const start = Math.max(cursor, Math.min(e.index, text.length));
    if (start > cursor) nodes.push(text.slice(cursor, start));
    nodes.push(
      // eslint-disable-next-line @next/next/no-img-element
      <img key={`e${i}`} src={lineEmojiImageUrl(e.productId, e.emojiId)} alt="emoji" className="inline-block align-text-bottom size-[1.2em] mx-px" />,
    );
    cursor = Math.min(start + Math.max(1, e.length), text.length);
  });
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return <div className={cn("text-sm whitespace-pre-wrap break-words", out && "text-white")}>{nodes}</div>;
}

function MsgContent({ attachments, externalId, body, out }: { attachments: unknown; externalId: string | null; body: string; out: boolean }) {
  const att = (attachments ?? null) as Att | null;
  if (att?.type === "text" && att.emojis?.length) {
    return <RichText text={body} emojis={att.emojis} out={out} />;
  }
  if (att?.type === "image" && externalId) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={`/api/fuelos/line-content/${externalId}`} alt="รูปจากลูกค้า" className="rounded-lg max-h-64 w-auto" />;
  }
  if (att?.type === "sticker" && att.stickerId) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={`https://stickershop.line-scdn.net/stickershop/v1/sticker/${att.stickerId}/android/sticker.png`} alt="สติกเกอร์" className="size-28 object-contain" />;
  }
  if (att?.type === "video" && externalId) {
    return <video src={`/api/fuelos/line-content/${externalId}`} controls className="rounded-lg max-h-64 w-auto" />;
  }
  if (att?.type === "audio" && externalId) {
    return <audio src={`/api/fuelos/line-content/${externalId}`} controls className="max-w-full" />;
  }
  if (att?.type === "location" && att.lat != null && att.lng != null) {
    return <a href={`https://maps.google.com/?q=${att.lat},${att.lng}`} target="_blank" rel="noreferrer" className={cn("text-sm underline", out ? "text-white" : "text-brand-700")}>📍 {att.title || att.address || "ดูตำแหน่งบนแผนที่"}</a>;
  }
  if (att?.type === "file" && externalId) {
    return <a href={`/api/fuelos/line-content/${externalId}`} target="_blank" rel="noreferrer" className={cn("text-sm underline", out ? "text-white" : "text-brand-700")}>📎 {att.fileName || "ดาวน์โหลดไฟล์"}</a>;
  }
  return <div className="text-sm whitespace-pre-wrap break-words">{body}</div>;
}

function MessageRow({ m }: { m: ChatMessage }) {
  const out = m.direction === "OUT";
  // โน้ตภายใน (สถานะ) — ลูกค้าไม่เห็น · แสดงกลางจอแบบ chip
  if (out && m.body.startsWith(STATUS_PREFIX)) {
    return (
      <div className="flex justify-center">
        <span className="inline-flex items-center gap-1 text-[11px] text-zinc-500 bg-surface border border-border rounded-full px-2.5 py-1">
          <Lock className="size-3" /> โน้ตภายใน · {m.body.replace(STATUS_PREFIX, "").trim()}
          <span className="text-zinc-400">(ลูกค้าไม่เห็น)</span>
        </span>
      </div>
    );
  }
  const contactName = m.senderContact?.alias?.trim() || m.senderContact?.displayName?.trim() || "ลูกค้า";
  const pic = m.senderContact?.pictureUrl;
  return (
    <div className={cn("flex gap-2", out ? "justify-end" : "justify-start")}>
      {!out && <LineAvatar src={pic} name={contactName} size={28} className="mt-0.5" />}
      <div className={cn("max-w-[78%] rounded-2xl px-3.5 py-2", out ? "bg-brand-600 text-white" : "bg-surface border border-border")}>
        {!out && (
          <div className="text-[10px] text-zinc-500 mb-0.5 flex items-center gap-1">
            {contactName}
            {m.senderContact?.roleLabel && <span className="text-brand-600 bg-brand-50 rounded px-1">{m.senderContact.roleLabel}</span>}
          </div>
        )}
        {out && (m.senderUserName || m.sentByBot) && (
          <div className="text-[10px] text-white/70 mb-0.5">{m.sentByBot ? "🤖 บอท" : m.senderUserName}</div>
        )}
        <MsgContent attachments={m.attachments} externalId={m.externalId} body={m.body} out={out} />
        <div className={cn("text-[10px] mt-0.5", out ? "text-white/60" : "text-zinc-400")}>{bkkTime(m.createdAt)}</div>
      </div>
    </div>
  );
}

export function ChatThread({
  convId,
  initialMessages,
  hasMore: hasMoreInitial,
}: {
  convId: string;
  initialMessages: ChatMessage[];
  hasMore: boolean;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [hasMore, setHasMore] = useState(hasMoreInitial);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);
  // เก็บความสูงก่อน prepend เพื่อคงตำแหน่งจอ ไม่ให้กระโดด
  const anchorRef = useRef<number | null>(null);

  // เปิดแชท → เด้งลงล่างสุด (ข้อความล่าสุด) · หลังโหลดเก่า → คงตำแหน่งเดิม
  // (parent ใส่ key={convId} ให้ remount ใหม่ทุกแชท → ไม่ต้อง reset state เอง)
  useIsoLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (!mountedRef.current) {
      mountedRef.current = true;
      el.scrollTop = el.scrollHeight;
      return;
    }
    if (anchorRef.current != null) {
      el.scrollTop = el.scrollHeight - anchorRef.current;
      anchorRef.current = null;
    }
  }, [messages]);

  async function loadOlder() {
    const el = scrollRef.current;
    if (loading || messages.length === 0) return;
    setLoading(true);
    anchorRef.current = el?.scrollHeight ?? 0; // จุดอ้างอิงคงตำแหน่งหลัง prepend
    try {
      const res = await loadOlderMessages(convId, messages[0].id);
      if (res.ok && res.messages.length > 0) {
        setMessages((cur) => [...res.messages, ...cur]);
        setHasMore(res.hasMore);
      } else {
        setHasMore(false);
        anchorRef.current = null;
      }
    } catch {
      anchorRef.current = null;
    } finally {
      setLoading(false);
    }
  }

  return (
    <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2.5">
      {hasMore ? (
        <div className="flex justify-center pb-1">
          <button
            type="button"
            onClick={loadOlder}
            disabled={loading}
            className="press inline-flex items-center gap-1.5 text-xs font-medium text-brand-700 bg-surface border border-border rounded-full px-3 h-8 hover:bg-surface-2 disabled:opacity-50"
          >
            <ChevronUp className="size-3.5" />
            {loading ? "กำลังโหลด…" : "ดูข้อความเก่ากว่านี้"}
          </button>
        </div>
      ) : (
        messages.length > 0 && (
          <div className="text-center text-[11px] text-zinc-400 pb-1">— เริ่มต้นบทสนทนา —</div>
        )
      )}
      {messages.map((m) => (
        <MessageRow key={m.id} m={m} />
      ))}
    </div>
  );
}
