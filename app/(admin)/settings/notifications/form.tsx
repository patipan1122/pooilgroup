"use client";

// Notifications form — Telegram chat IDs, audience, channels, email recipients.
// PATCHes /api/admin/settings/notifications and refreshes the page on success.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bell, Clock, Mail, Send, Trash2, Plus } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils/cn";

export type AudienceKey =
  | "super_admin_only"
  | "with_org_admin"
  | "with_branch_managers";

export interface NotificationsConfig {
  morningBriefAt: string;
  eveningCheckAt: string;
  audience: AudienceKey;
  channels: { telegram: boolean; email: boolean };
  telegramChatIds: string[];
  emailRecipients: string[];
}

const AUDIENCE_OPTIONS: { value: AudienceKey; label: string; hint: string }[] = [
  {
    value: "super_admin_only",
    label: "เจ้าของเท่านั้น",
    hint: "Super Admin เห็นสรุปวันละ 2 ครั้ง",
  },
  {
    value: "with_org_admin",
    label: "+ Admin องค์กร",
    hint: "Super Admin + Org Admin",
  },
  {
    value: "with_branch_managers",
    label: "+ ผู้จัดการสาขา",
    hint: "ทุกคนที่มี Telegram Chat ID ผูกไว้",
  },
];

interface Props {
  initial: NotificationsConfig;
}

export function NotificationsForm({ initial }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [morningBriefAt, setMorningBriefAt] = useState(initial.morningBriefAt);
  const [eveningCheckAt, setEveningCheckAt] = useState(initial.eveningCheckAt);
  const [audience, setAudience] = useState<AudienceKey>(initial.audience);
  const [telegramOn, setTelegramOn] = useState(initial.channels.telegram);
  const [emailOn, setEmailOn] = useState(initial.channels.email);
  const [chatIds, setChatIds] = useState<string[]>(initial.telegramChatIds);
  const [emails, setEmails] = useState<string[]>(initial.emailRecipients);
  const [newChatId, setNewChatId] = useState("");
  const [newEmail, setNewEmail] = useState("");

  function addChatId() {
    const v = newChatId.trim();
    if (!v) return;
    if (chatIds.includes(v)) {
      toast.error("Chat ID นี้มีในรายการแล้ว");
      return;
    }
    setChatIds((arr) => [...arr, v]);
    setNewChatId("");
  }
  function removeChatId(id: string) {
    setChatIds((arr) => arr.filter((x) => x !== id));
  }
  function addEmail() {
    const v = newEmail.trim().toLowerCase();
    if (!v) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      toast.error("รูปแบบ Email ไม่ถูกต้อง เช่น name@company.com");
      return;
    }
    if (emails.includes(v)) {
      toast.error("Email นี้มีในรายการแล้ว");
      return;
    }
    setEmails((arr) => [...arr, v]);
    setNewEmail("");
  }
  function removeEmail(em: string) {
    setEmails((arr) => arr.filter((x) => x !== em));
  }

  function save() {
    if (emailOn && emails.length === 0) {
      toast.error("เปิด Email แล้วต้องเพิ่มอย่างน้อย 1 Email");
      return;
    }
    if (!telegramOn && !emailOn) {
      toast.error("เลือกอย่างน้อย 1 ช่องทาง (Telegram หรือ Email)");
      return;
    }
    startTransition(async () => {
      const res = await fetch("/api/admin/settings/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          morningBriefAt,
          eveningCheckAt,
          audience,
          channels: { telegram: telegramOn, email: emailOn },
          telegramChatIds: chatIds,
          emailRecipients: emails,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        toast.error(json.error || "บันทึกไม่สำเร็จ");
        return;
      }
      toast.success("บันทึกการแจ้งเตือนแล้ว");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {/* Schedule */}
      <Card className="animate-fade-up">
        <CardHeader>
          <CardTitle>เวลาส่งสรุปประจำวัน</CardTitle>
          <Badge tone="brand">Telegram Cron</Badge>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Morning Brief" hint="สรุปยอดเมื่อวาน · ค่าเริ่มต้น 07:00">
              <Input
                type="time"
                value={morningBriefAt}
                onChange={(e) => setMorningBriefAt(e.target.value)}
                prefixSlot={<Clock className="size-4" />}
              />
            </Field>
            <Field label="Evening Check" hint="ตรวจสถานะรายงาน · ค่าเริ่มต้น 18:00">
              <Input
                type="time"
                value={eveningCheckAt}
                onChange={(e) => setEveningCheckAt(e.target.value)}
                prefixSlot={<Clock className="size-4" />}
              />
            </Field>
          </div>
        </CardBody>
      </Card>

      {/* Audience */}
      <Card className="animate-fade-up delay-75">
        <CardHeader>
          <CardTitle>ส่งให้ใคร</CardTitle>
        </CardHeader>
        <CardBody className="space-y-2">
          {AUDIENCE_OPTIONS.map((opt) => {
            const active = audience === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setAudience(opt.value)}
                className={cn(
                  "w-full text-left flex items-start gap-3 rounded-xl border-2 p-3 transition-colors",
                  active
                    ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)]"
                    : "border-zinc-200 hover:border-zinc-300 bg-white",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 size-4 rounded-full border-2 shrink-0",
                    active
                      ? "border-[var(--color-brand-600)] bg-[var(--color-brand-600)]"
                      : "border-zinc-300",
                  )}
                />
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-zinc-900">
                    {opt.label}
                  </div>
                  <div className="text-xs text-zinc-500 mt-0.5">{opt.hint}</div>
                </div>
              </button>
            );
          })}
        </CardBody>
      </Card>

      {/* Channels */}
      <Card className="animate-fade-up delay-100">
        <CardHeader>
          <CardTitle>ช่องทาง</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          <ToggleRow
            icon={<Send className="size-4" />}
            label="Telegram"
            sublabel="แนะนำ — ฟรี + Inline Approve"
            active={telegramOn}
            onToggle={() => setTelegramOn((v) => !v)}
          />
          <ToggleRow
            icon={<Mail className="size-4" />}
            label="Email"
            sublabel="ส่งสรุป + PDF รายเดือนผ่าน Resend"
            active={emailOn}
            onToggle={() => setEmailOn((v) => !v)}
          />
        </CardBody>
      </Card>

      {/* Telegram Chat IDs */}
      {telegramOn && (
        <Card className="animate-fade-up delay-150">
          <CardHeader>
            <CardTitle>Telegram Chat IDs</CardTitle>
            <Badge tone="neutral">{chatIds.length} รายการ</Badge>
          </CardHeader>
          <CardBody className="space-y-3">
            <Field
              label="เพิ่ม Chat ID"
              hint="ดู Chat ID ได้ที่ @userinfobot · ผู้ใช้ต้อง opt-in กดเริ่ม Bot ก่อน"
            >
              <div className="flex gap-2">
                <Input
                  value={newChatId}
                  onChange={(e) => setNewChatId(e.target.value)}
                  placeholder="เช่น 123456789"
                  prefixSlot={<Bell className="size-4" />}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addChatId();
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={addChatId}
                  disabled={!newChatId.trim()}
                >
                  <Plus className="size-4" />
                  เพิ่ม
                </Button>
              </div>
            </Field>
            {chatIds.length > 0 ? (
              <ul className="space-y-1.5">
                {chatIds.map((id) => (
                  <li
                    key={id}
                    className="flex items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2"
                  >
                    <span className="text-sm tabular-nums font-medium text-zinc-900">
                      {id}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeChatId(id)}
                      className="text-zinc-400 hover:text-[var(--color-danger)] transition-colors"
                      aria-label="ลบ"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-zinc-500">ยังไม่มี Chat ID</p>
            )}
          </CardBody>
        </Card>
      )}

      {/* Email recipients */}
      {emailOn && (
        <Card className="animate-fade-up delay-200">
          <CardHeader>
            <CardTitle>ผู้รับ Email</CardTitle>
            <Badge tone="neutral">{emails.length} รายการ</Badge>
          </CardHeader>
          <CardBody className="space-y-3">
            <Field label="เพิ่ม Email">
              <div className="flex gap-2">
                <Input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="เช่น ceo@poolgroup.com"
                  prefixSlot={<Mail className="size-4" />}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addEmail();
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={addEmail}
                  disabled={!newEmail.trim()}
                >
                  <Plus className="size-4" />
                  เพิ่ม
                </Button>
              </div>
            </Field>
            {emails.length > 0 ? (
              <ul className="space-y-1.5">
                {emails.map((em) => (
                  <li
                    key={em}
                    className="flex items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2"
                  >
                    <span className="text-sm font-medium text-zinc-900 truncate">
                      {em}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeEmail(em)}
                      className="text-zinc-400 hover:text-[var(--color-danger)] transition-colors shrink-0"
                      aria-label="ลบ"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-zinc-500">ยังไม่มี Email</p>
            )}
          </CardBody>
        </Card>
      )}

      {/* Sticky save */}
      <div className="sticky bottom-4 z-10 mt-6">
        <div className="rounded-2xl border-2 border-zinc-200 bg-white/95 backdrop-blur shadow-pop p-3 flex items-center justify-between gap-3">
          <p className="text-xs text-zinc-500">
            ทุกการแก้ไขจะถูกบันทึกใน Audit Log
          </p>
          <Button onClick={save} loading={pending}>
            บันทึก
          </Button>
        </div>
      </div>
    </div>
  );
}

function ToggleRow({
  icon,
  label,
  sublabel,
  active,
  onToggle,
}: {
  icon: React.ReactNode;
  label: string;
  sublabel: string;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-xl border-2 p-3 transition-colors",
        active
          ? "border-[var(--color-brand-200)] bg-[var(--color-brand-50)]/40"
          : "border-zinc-200 bg-zinc-50",
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="size-9 rounded-lg bg-white border border-zinc-200 flex items-center justify-center text-[var(--color-brand-700)]">
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-zinc-900">{label}</div>
          <div className="text-xs text-zinc-500 truncate">{sublabel}</div>
        </div>
      </div>
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "relative inline-flex shrink-0 h-7 w-12 rounded-full transition-colors",
          active ? "bg-[var(--color-brand-600)]" : "bg-zinc-300",
        )}
        aria-label={`Toggle ${label}`}
      >
        <span
          className={cn(
            "inline-block size-5 rounded-full bg-white shadow transition-transform absolute top-1",
            active ? "translate-x-6" : "translate-x-1",
          )}
        />
      </button>
    </div>
  );
}
