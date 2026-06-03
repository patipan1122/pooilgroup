"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/fuelos/ui/button";
import { cn } from "@/lib/fuelos/utils/cn";
import { Plus, MessageSquare, Bot, Pencil } from "lucide-react";
import { upsertChannel, toggleChannelBot } from "./actions";
import type { SettingsChannel } from "@/lib/fuelos/settings-data";

export function LineTab({ channels }: { channels: SettingsChannel[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<SettingsChannel | "new" | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function onSubmit(formData: FormData) {
    start(async () => {
      const res = await upsertChannel(formData);
      if (res.ok) {
        toast.success("บันทึกช่องทางแล้ว");
        formRef.current?.reset();
        setEditing(null);
        router.refresh();
      } else {
        toast.error(res.error ?? "บันทึกไม่สำเร็จ");
      }
    });
  }

  function onToggleBot(id: string, next: boolean) {
    start(async () => {
      const res = await toggleChannelBot(id, next);
      if (res.ok) { toast.success(next ? "เปิดบอทช่องทางนี้แล้ว" : "ปิดบอทช่องทางนี้แล้ว"); router.refresh(); }
      else toast.error(res.error ?? "ทำรายการไม่สำเร็จ");
    });
  }

  const edit = editing && editing !== "new" ? editing : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="font-bold">ช่องทาง LINE <span className="text-zinc-400 font-normal">({channels.length})</span></h2>
        <Button size="sm" className="ml-auto" onClick={() => setEditing(editing === "new" ? null : "new")}>
          <Plus className="size-4" /> เพิ่มช่องทาง
        </Button>
      </div>

      {editing && (
        <form ref={formRef} action={onSubmit} className="rounded-2xl border border-border bg-surface p-4 grid sm:grid-cols-2 gap-3">
          {edit && <input type="hidden" name="id" value={edit.id} />}
          <div>
            <label className="text-xs text-zinc-500">ชื่อช่องทาง</label>
            <input name="displayName" required defaultValue={edit?.displayName ?? ""} className="mt-1 h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm" placeholder="เช่น LINE OA หลัก" />
          </div>
          <div>
            <label className="text-xs text-zinc-500">Channel ID (LINE)</label>
            <input name="externalId" defaultValue={edit?.externalId ?? ""} className="mt-1 h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm font-[family-name:var(--font-plex-mono)]" placeholder="1234567890" />
          </div>
          <div>
            <label className="text-xs text-zinc-500">Channel Access Token {edit?.hasAccessToken && <span className="text-zinc-400">(มีอยู่แล้ว · เว้นว่างเพื่อคงเดิม)</span>}</label>
            <input name="accessToken" type="password" className="mt-1 h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm" placeholder={edit?.hasAccessToken ? "••••••••••" : "วางโทเค็นจาก LINE Developers"} />
          </div>
          <div>
            <label className="text-xs text-zinc-500">Webhook Secret {edit?.hasWebhookSecret && <span className="text-zinc-400">(มีอยู่แล้ว · เว้นว่างเพื่อคงเดิม)</span>}</label>
            <input name="webhookSecret" type="password" className="mt-1 h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm" placeholder={edit?.hasWebhookSecret ? "••••••••••" : "Channel secret"} />
          </div>
          <div className="sm:col-span-2 rounded-xl bg-surface-2 border border-border px-3 py-2 text-[11px] text-zinc-500">
            ตั้ง Webhook URL ใน LINE Developers ชี้มาที่ระบบนี้ เพื่อให้ข้อความเข้ากล่องข้อความรวมอัตโนมัติ (ผู้ดูแลระบบจะแจ้ง URL ให้)
          </div>
          <div className="sm:col-span-2 flex gap-2 justify-end">
            <Button type="button" variant="ghost" onClick={() => setEditing(null)}>ยกเลิก</Button>
            <Button type="submit" loading={pending}>{edit ? "บันทึกการแก้ไข" : "เพิ่มช่องทาง"}</Button>
          </div>
        </form>
      )}

      <div className="grid gap-2">
        {channels.length === 0 && <div className="text-center text-zinc-400 py-10 text-sm">ยังไม่มีช่องทาง LINE</div>}
        {channels.map((c) => (
          <div key={c.id} className="rounded-2xl border border-border bg-surface p-3.5 flex items-center gap-3">
            <div className="size-10 rounded-xl bg-leaf-50 text-leaf-600 grid place-items-center shrink-0"><MessageSquare className="size-5" /></div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold truncate">{c.displayName}</span>
                <StatusPill status={c.status} hasToken={c.hasAccessToken} />
              </div>
              <div className="text-xs text-zinc-500 mt-0.5 truncate">
                {c.externalId ? `Channel ${c.externalId}` : "ยังไม่ระบุ Channel ID"} · {c.hasAccessToken ? "มีโทเค็น" : "ยังไม่มีโทเค็น"}
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                <span className="text-[10px] text-zinc-400 shrink-0">Webhook:</span>
                <code className="text-[10px] truncate bg-surface-2 px-1.5 py-0.5 rounded min-w-0">{`…/api/webhooks/line/${c.id}`}</code>
                <button
                  type="button"
                  onClick={() => { navigator.clipboard?.writeText(`${window.location.origin}/api/webhooks/line/${c.id}`); toast.success("คัดลอก Webhook URL แล้ว — เอาไปวางใน LINE Console"); }}
                  className="shrink-0 text-brand-600 text-[11px] font-medium"
                >คัดลอก</button>
              </div>
            </div>
            <button
              onClick={() => onToggleBot(c.id, !c.botEnabled)}
              disabled={pending}
              title="เปิด/ปิดบอทตอบอัตโนมัติ"
              className={cn(
                "inline-flex items-center gap-1 h-8 px-2.5 rounded-lg border text-xs shrink-0",
                c.botEnabled ? "border-leaf-300 bg-leaf-50 text-leaf-700" : "border-border bg-surface text-zinc-400",
              )}
            >
              <Bot className="size-3.5" /> {c.botEnabled ? "บอทเปิด" : "บอทปิด"}
            </button>
            <button onClick={() => setEditing(c)} disabled={pending} className="size-8 grid place-items-center rounded-lg border border-border text-zinc-500 shrink-0" title="แก้ไข">
              <Pencil className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusPill({ status, hasToken }: { status: string; hasToken: boolean }) {
  const ok = status === "active" && hasToken;
  return (
    <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full", ok ? "bg-leaf-500/15 text-leaf-700" : "bg-warning/15 text-warning")}>
      {ok ? "พร้อมใช้งาน" : "ตั้งค่าค้าง"}
    </span>
  );
}
