"use client";

import Link from "next/link";
import { useState, useTransition, useEffect } from "react";
import { toast } from "sonner";
import { sendMessage, markThreadRead } from "@/lib/recruit/message-actions";
import { Phone, Mail, MessageCircle, Send, ChevronLeft, AlertCircle } from "lucide-react";

interface Message {
  id: string;
  channel: string;
  direction: "IN" | "OUT";
  body: string;
  status: string;
  createdAt: string;
  sentBy: string | null;
}

interface Thread {
  applicationId: string;
  applicantName: string;
  phone: string;
  email: string | null;
  lineId: string | null;
  postingTitle: string;
  messages: Message[];
}

const CHANNEL_META: Record<
  string,
  { label: string; chip: string; needs?: "phone" | "email" | "lineId" }
> = {
  INAPP: { label: "ในระบบ", chip: "bg-zinc-100 text-zinc-700" },
  EMAIL: { label: "Email", chip: "bg-amber-100 text-amber-700", needs: "email" },
  LINE: { label: "LINE", chip: "bg-green-100 text-green-800", needs: "lineId" },
  SMS: { label: "SMS", chip: "bg-blue-100 text-blue-700", needs: "phone" },
};

export function MessageThreadView({ thread }: { thread: Thread }) {
  const [channel, setChannel] = useState<"INAPP" | "EMAIL" | "LINE" | "SMS">("INAPP");
  const [body, setBody] = useState("");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    // Mark inbound messages read
    if (thread.messages.some((m) => m.direction === "IN" && m.status !== "READ")) {
      markThreadRead(thread.applicationId).catch(() => {});
    }
  }, [thread.applicationId, thread.messages]);

  function submit() {
    const text = body.trim();
    if (!text) return;
    startTransition(async () => {
      try {
        const result = await sendMessage({
          applicationId: thread.applicationId,
          channel,
          body: text,
        });
        if (result.deliveryError) {
          toast.warning(`ส่งคิวแล้ว · แต่ delivery ติดปัญหา: ${result.deliveryError}`);
        } else {
          toast.success("ส่งข้อความแล้ว");
        }
        setBody("");
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  const channelMeta = CHANNEL_META[channel];
  const canUseChannel =
    !channelMeta.needs ||
    (channelMeta.needs === "phone" && !!thread.phone) ||
    (channelMeta.needs === "email" && !!thread.email) ||
    (channelMeta.needs === "lineId" && !!thread.lineId);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-zinc-200 bg-white flex items-center gap-3">
        <Link
          href="/recruit/messages"
          className="lg:hidden size-9 rounded-lg hover:bg-zinc-100 flex items-center justify-center"
        >
          <ChevronLeft className="size-4" />
        </Link>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-zinc-900 truncate">{thread.applicantName}</p>
          <p className="text-xs text-zinc-500 truncate">{thread.postingTitle}</p>
        </div>
        <div className="flex items-center gap-1">
          <a
            href={`tel:${thread.phone.replace(/[^0-9+]/g, "")}`}
            title="โทร"
            className="size-9 rounded-lg border border-zinc-200 text-zinc-600 hover:bg-green-50 hover:text-green-700 flex items-center justify-center"
          >
            <Phone className="size-4" />
          </a>
          {thread.email && (
            <a
              href={`mailto:${thread.email}`}
              title="อีเมล"
              className="size-9 rounded-lg border border-zinc-200 text-zinc-600 hover:bg-amber-50 hover:text-amber-700 flex items-center justify-center"
            >
              <Mail className="size-4" />
            </a>
          )}
          <Link
            href={`/recruit/applications/${thread.applicationId}`}
            className="h-9 px-3 rounded-lg bg-[var(--color-brand-600)] text-white text-xs font-bold flex items-center hover:bg-[var(--color-brand-700)]"
          >
            ดูใบสมัคร
          </Link>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-5 bg-zinc-50/40 space-y-3">
        {thread.messages.length === 0 ? (
          <p className="text-center text-sm text-zinc-400 py-10">
            ยังไม่มีข้อความ · พิมพ์เพื่อเริ่ม
          </p>
        ) : (
          thread.messages.map((m) => {
            const isOut = m.direction === "OUT";
            const chip = CHANNEL_META[m.channel]?.chip ?? "bg-zinc-100 text-zinc-700";
            const chipLabel = CHANNEL_META[m.channel]?.label ?? m.channel;
            return (
              <div
                key={m.id}
                className={`flex flex-col gap-1 ${isOut ? "items-end" : "items-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap ${
                    isOut
                      ? "bg-[var(--color-brand-600)] text-white rounded-br-md"
                      : "bg-white text-zinc-900 border border-zinc-200 rounded-bl-md"
                  }`}
                >
                  {m.body}
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-zinc-400">
                  <span className={`px-1.5 py-0.5 rounded ${chip} font-bold`}>
                    {chipLabel}
                  </span>
                  <span>
                    {new Date(m.createdAt).toLocaleString("th-TH", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  {m.status === "QUEUED" && (
                    <span className="text-amber-600 font-bold">· คิว</span>
                  )}
                  {m.status === "FAILED" && (
                    <span className="text-red-600 font-bold">· ล้มเหลว</span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-zinc-200 bg-white p-4">
        <div className="flex items-center gap-1.5 mb-2 flex-wrap">
          {(["INAPP", "EMAIL", "LINE", "SMS"] as const).map((c) => {
            const meta = CHANNEL_META[c];
            const enabled =
              !meta.needs ||
              (meta.needs === "phone" && !!thread.phone) ||
              (meta.needs === "email" && !!thread.email) ||
              (meta.needs === "lineId" && !!thread.lineId);
            return (
              <button
                key={c}
                type="button"
                onClick={() => enabled && setChannel(c)}
                disabled={!enabled}
                className={`text-xs h-8 px-3 rounded-full font-bold border transition-colors ${
                  channel === c
                    ? "border-[var(--color-brand-600)] bg-[var(--color-brand-50)] text-[var(--color-brand-800)]"
                    : enabled
                      ? "border-zinc-200 text-zinc-600 hover:bg-zinc-50"
                      : "border-zinc-100 text-zinc-300 cursor-not-allowed"
                }`}
                title={enabled ? `ส่งทาง ${meta.label}` : `ไม่มีข้อมูล ${meta.needs}`}
              >
                {meta.label}
              </button>
            );
          })}
        </div>
        {(channel === "LINE" || channel === "SMS") && (
          <p className="text-[11px] text-amber-700 mb-2 inline-flex items-center gap-1">
            <AlertCircle className="size-3" />
            ช่อง {channelMeta.label} จะเข้า queue · ยังไม่ส่งจริง (รอตั้งค่า Phase 2)
          </p>
        )}
        <div className="flex items-end gap-2">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={`พิมพ์ข้อความ ส่งทาง ${channelMeta.label} ... (Cmd+Enter)`}
            className="flex-1 resize-none rounded-xl border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-300)]"
            rows={2}
          />
          <button
            type="button"
            onClick={submit}
            disabled={isPending || !body.trim() || !canUseChannel}
            className="size-10 rounded-xl bg-[var(--color-brand-600)] text-white hover:bg-[var(--color-brand-700)] disabled:opacity-40 flex items-center justify-center shrink-0"
          >
            <Send className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
