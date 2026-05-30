"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { businessLabel, topicLabel } from "@/lib/inbox/business";
import {
  sendReply,
  markConversationRead,
  setConversationStatus,
  setNeedsHuman,
  saveContactInfo,
} from "@/lib/inbox/actions";
import type { ConversationDetail } from "@/lib/inbox/queries";
import { fullThaiTime } from "./format";
import { Send, Phone, StickyNote, UserCheck } from "lucide-react";

interface Props {
  conversation: ConversationDetail;
}

const STATUS_OPTIONS: {
  value: "OPEN" | "SNOOZED" | "CLOSED";
  label: string;
}[] = [
  { value: "OPEN", label: "เปิด" },
  { value: "SNOOZED", label: "พักไว้" },
  { value: "CLOSED", label: "ปิด" },
];

export function ConversationDetailPane({ conversation }: Props) {
  const [reply, setReply] = useState("");
  const [phone, setPhone] = useState(conversation.contactPhone ?? "");
  const [note, setNote] = useState(conversation.contactNote ?? "");
  const [sending, startSend] = useTransition();
  const [savingStatus, startStatus] = useTransition();
  const [savingContact, startContact] = useTransition();
  const [togglingHuman, startHuman] = useTransition();
  const threadEndRef = useRef<HTMLDivElement>(null);

  // Reset local form state + scroll to bottom when switching conversations.
  useEffect(() => {
    setReply("");
    setPhone(conversation.contactPhone ?? "");
    setNote(conversation.contactNote ?? "");
  }, [conversation.id, conversation.contactPhone, conversation.contactNote]);

  // Mark read on open (fire-and-forget; revalidate refreshes the list badge).
  useEffect(() => {
    markConversationRead(conversation.id).catch(() => {});
  }, [conversation.id]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ block: "end" });
  }, [conversation.id, conversation.messages.length]);

  function submitReply() {
    const text = reply.trim();
    if (!text) return;
    startSend(async () => {
      try {
        await sendReply(conversation.id, text);
        setReply("");
        toast.success("ส่งข้อความแล้ว");
      } catch (e) {
        toast.error((e as Error).message || "ส่งข้อความไม่สำเร็จ");
      }
    });
  }

  function changeStatus(status: "OPEN" | "SNOOZED" | "CLOSED") {
    if (status === conversation.status) return;
    startStatus(async () => {
      try {
        await setConversationStatus(conversation.id, status);
        toast.success(
          status === "OPEN"
            ? "เปิดบทสนทนาแล้ว"
            : status === "SNOOZED"
              ? "พักบทสนทนาไว้แล้ว"
              : "ปิดบทสนทนาแล้ว",
        );
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  function toggleHuman() {
    startHuman(async () => {
      try {
        await setNeedsHuman(conversation.id, !conversation.needsHuman);
        toast.success(
          conversation.needsHuman ? "ปลดธงต้องคนตอบแล้ว" : "ตั้งธงต้องคนตอบแล้ว",
        );
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  function saveContact() {
    startContact(async () => {
      try {
        await saveContactInfo(conversation.id, { phone, note });
        toast.success("บันทึกข้อมูลลูกค้าแล้ว");
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  const name = conversation.displayName || "ลูกค้าไม่ระบุชื่อ";
  const isLine = conversation.platform === "LINE";

  return (
    <div className="flex h-full flex-col lg:flex-row">
      {/* Main column: header + thread + reply box */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <div className="border-b border-zinc-200 bg-white px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold ${
                    isLine ? "bg-green-100 text-green-800" : "bg-blue-100 text-blue-700"
                  }`}
                >
                  {isLine ? "LINE" : "Facebook"}
                </span>
                <p className="truncate text-base font-bold text-zinc-900">{name}</p>
              </div>
              <p className="mt-0.5 truncate text-xs text-zinc-500">
                {conversation.channelName}
                {conversation.businessTag
                  ? ` · ${businessLabel(conversation.businessTag)}`
                  : ""}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              {conversation.needsHuman && (
                <Badge tone="danger">🙋 ต้องคนตอบ</Badge>
              )}
              {conversation.isUrgent && <Badge tone="orange">ด่วน</Badge>}
              {conversation.isLead && <Badge tone="purple">สนใจซื้อ</Badge>}
              {conversation.topicTag && (
                <Badge tone="neutral">{topicLabel(conversation.topicTag)}</Badge>
              )}
            </div>
          </div>

          {/* Status controls */}
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold text-zinc-500">สถานะ:</span>
            {STATUS_OPTIONS.map((opt) => {
              const active = conversation.status === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => changeStatus(opt.value)}
                  disabled={savingStatus}
                  // aria-pressed conveys "this status is the active one" to
                  // screen readers — visual style alone failed AT users
                  // (audit CH-004).
                  aria-pressed={active}
                  className={`h-7 rounded-full border px-3 text-xs font-bold transition-colors disabled:opacity-50 ${
                    active
                      ? "border-[var(--color-brand-600)] bg-[var(--color-brand-50)] text-[var(--color-brand-800)]"
                      : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
            <button
              type="button"
              onClick={toggleHuman}
              disabled={togglingHuman}
              className={`ml-auto inline-flex h-7 items-center gap-1 rounded-full border px-3 text-xs font-bold transition-colors disabled:opacity-50 ${
                conversation.needsHuman
                  ? "border-red-300 bg-red-50 text-red-700 hover:bg-red-100"
                  : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"
              }`}
            >
              <UserCheck className="size-3.5" />
              {conversation.needsHuman ? "ปลดธงต้องคนตอบ" : "ตั้งธงต้องคนตอบ"}
            </button>
          </div>
        </div>

        {/* Thread */}
        <div className="flex-1 space-y-3 overflow-y-auto bg-zinc-50/40 p-5">
          {conversation.messages.length === 0 ? (
            <p className="py-10 text-center text-sm text-zinc-400">
              ยังไม่มีข้อความในบทสนทนานี้
            </p>
          ) : (
            conversation.messages.map((m) => {
              const isOut = m.direction === "OUT";
              const hasImage = m.attachment?.type === "image" && !!m.attachment.url;
              // Suppress the body bubble when it's just the "[รูปภาพ]"
              // placeholder we wrote alongside an image upload.
              const placeholderBodies = new Set(["[รูปภาพ]", "[image]", "[Image]"]);
              const showBody = !!m.body && !(hasImage && placeholderBodies.has(m.body));
              return (
                <div
                  key={m.id}
                  className={`flex flex-col gap-1 ${isOut ? "items-end" : "items-start"}`}
                >
                  {hasImage && (
                    <a
                      href={m.attachment!.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`block max-w-[60%] overflow-hidden rounded-2xl border bg-white shadow-sm transition hover:shadow-md ${
                        isOut
                          ? "rounded-br-md border-[var(--color-brand-200)]"
                          : "rounded-bl-md border-zinc-200"
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={m.attachment!.url}
                        alt={isOut ? "รูปภาพจากเรา" : "รูปภาพจากลูกค้า"}
                        className="block max-h-72 w-full object-cover"
                        loading="lazy"
                      />
                    </a>
                  )}
                  {showBody && (
                    <div
                      className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm ${
                        isOut
                          ? "rounded-br-md bg-[var(--color-brand-600)] text-white"
                          : "rounded-bl-md border border-zinc-200 bg-white text-zinc-900"
                      }`}
                    >
                      {m.body}
                    </div>
                  )}
                  <div className="flex items-center gap-1.5 text-[10px] text-zinc-400">
                    {m.sentByBot && (
                      <span className="rounded bg-zinc-200 px-1.5 py-0.5 font-bold text-zinc-600">
                        🤖 บอท
                      </span>
                    )}
                    <span>{fullThaiTime(m.createdAt)}</span>
                  </div>
                </div>
              );
            })
          )}
          <div ref={threadEndRef} />
        </div>

        {/* Reply box */}
        <div className="border-t border-zinc-200 bg-white p-4">
          <div className="flex items-end gap-2">
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  submitReply();
                }
              }}
              placeholder="พิมพ์ข้อความตอบลูกค้า... (Cmd/Ctrl+Enter เพื่อส่ง)"
              rows={2}
              className="flex-1 resize-none rounded-xl border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-300)]"
            />
            <Button
              type="button"
              onClick={submitReply}
              loading={sending}
              disabled={sending || !reply.trim()}
              className="shrink-0"
              aria-label="ส่งข้อความ"
            >
              <Send className="size-4" />
              ส่ง
            </Button>
          </div>
          <p className="mt-1.5 text-[11px] text-zinc-400">
            ข้อความจะถูกส่งออกทาง {isLine ? "LINE" : "Facebook"} ของช่องทางนี้
          </p>
        </div>
      </div>

      {/* Contact panel */}
      <aside className="border-t border-zinc-200 bg-zinc-50/60 p-4 lg:w-72 lg:shrink-0 lg:border-l lg:border-t-0">
        <h3 className="font-display text-sm font-bold text-zinc-900">ข้อมูลลูกค้า</h3>
        <p className="mt-0.5 text-[11px] text-zinc-500">
          บันทึกเบอร์โทรและโน้ตไว้ติดตามทีหลัง
        </p>

        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-1 flex items-center gap-1 text-xs font-semibold text-zinc-600">
              <Phone className="size-3.5" /> เบอร์โทร
            </label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="08x-xxx-xxxx"
              inputMode="tel"
              className="h-10 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 flex items-center gap-1 text-xs font-semibold text-zinc-600">
              <StickyNote className="size-3.5" /> โน้ต
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={4}
              placeholder="เช่น สนใจรุ่น X · นัดติดต่อกลับพรุ่งนี้"
              className="w-full resize-none rounded-xl border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-300)]"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            fullWidth
            onClick={saveContact}
            loading={savingContact}
            disabled={savingContact}
          >
            บันทึกข้อมูลลูกค้า
          </Button>
        </div>
      </aside>
    </div>
  );
}
