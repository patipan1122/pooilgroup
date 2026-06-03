"use client";

// ผูก LINE Official Account สำหรับรับรูปใบเสร็จในกลุ่ม LINE → AI สร้าง "ร่าง" ให้บัญชี
// ตรวจ (ห้าม auto-post). Channel Secret / Access Token เก็บแบบ "เข้ารหัส" ในฐานข้อมูล
// (lib/recruit/channel-crypto) — ฟอร์มนี้ส่งค่าเข้าไปได้อย่างเดียว ดึงกลับมาแสดงไม่ได้.
//
// Webhook URL ที่ถูกต้องต้องมี <channelId> ต่อท้าย + ห้ามมี "/" ปิดท้าย (มิฉะนั้น
// Next.js เด้ง 308 redirect → LINE Verify ไม่ผ่าน). การ์ดนี้สร้าง URL จริงให้ copy.
import { MessageSquare, Copy, Check, Loader2, AlertTriangle, Plug, PlugZap, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  connectLineChannel,
  disconnectLineChannel,
  toggleLineChannel,
} from "../../_actions";
import type { LineChannelInfo } from "../../_data";

export function LineChannelCard({
  companyId,
  companyName,
  channel,
}: {
  companyId: string;
  companyName: string;
  channel: LineChannelInfo | null;
}) {
  const connected = !!channel;

  const base =
    typeof window !== "undefined" ? window.location.origin : "https://pooilgroup.vercel.app";
  // URL จริง = มีรหัสช่องต่อท้าย + ไม่มี "/" ปิดท้าย (จุดที่ทำให้ก่อนหน้านี้ error 308)
  const webhookUrl = channel
    ? `${base}/api/webhooks/ledger/line/${channel.id}`
    : null;

  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // ฟอร์ม — ตอน "เชื่อมแล้ว" Channel ID/Group ID เติมค่าเดิมไว้, secret/token เว้นว่าง
  // (เว้นว่าง = ใช้ค่าเดิม). ตอนยังไม่เชื่อม ต้องกรอก secret + token.
  const [lineChannelId, setLineChannelId] = useState(channel?.lineChannelId ?? "");
  const [channelSecret, setChannelSecret] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [groupId, setGroupId] = useState(channel?.groupId ?? "");

  function copy() {
    if (!webhookUrl) return;
    navigator.clipboard?.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function save() {
    setMsg(null);
    if (!lineChannelId.trim()) {
      setMsg({ kind: "err", text: "ใส่ Channel ID ก่อน" });
      return;
    }
    if (!connected && (!channelSecret.trim() || !accessToken.trim())) {
      setMsg({ kind: "err", text: "ครั้งแรกต้องใส่ทั้ง Channel Secret และ Access Token" });
      return;
    }
    startTransition(async () => {
      const res = await connectLineChannel({
        companyId,
        lineChannelId: lineChannelId.trim(),
        channelSecret: channelSecret.trim(),
        accessToken: accessToken.trim(),
        groupId: groupId.trim(),
      });
      if (!res.ok) {
        setMsg({ kind: "err", text: res.error ?? "บันทึกไม่สำเร็จ" });
        return;
      }
      // เคลียร์ secret/token ออกจากหน้าจอทันทีหลังบันทึก (ไม่เก็บค้างใน state)
      setChannelSecret("");
      setAccessToken("");
      setMsg({ kind: "ok", text: connected ? "อัปเดตแล้ว" : "เชื่อมต่อแล้ว · คัดลอก URL ด้านล่างไปวางใน LINE" });
    });
  }

  function disconnect() {
    if (!confirm("ยกเลิกการเชื่อมต่อ LINE? ระบบจะหยุดรับรูปใบเสร็จจากกลุ่มนี้")) return;
    setMsg(null);
    startTransition(async () => {
      const res = await disconnectLineChannel(companyId);
      if (!res.ok) {
        setMsg({ kind: "err", text: res.error ?? "ยกเลิกไม่สำเร็จ" });
        return;
      }
      setLineChannelId("");
      setGroupId("");
      setMsg({ kind: "ok", text: "ยกเลิกการเชื่อมต่อแล้ว" });
    });
  }

  function toggleActive() {
    if (!channel) return;
    startTransition(async () => {
      const res = await toggleLineChannel(companyId, !channel.active);
      if (!res.ok) setMsg({ kind: "err", text: res.error ?? "ทำรายการไม่สำเร็จ" });
    });
  }

  const inputCls =
    "h-9 w-full rounded-lg border border-zinc-200 bg-white px-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-brand-200)]";

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-lg bg-green-100 text-green-700">
            <MessageSquare className="size-4" aria-hidden />
          </span>
          <h2 className="text-sm font-bold text-zinc-800">กลุ่ม LINE รับใบเสร็จ</h2>
        </div>
        {connected ? (
          <span
            className={
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold " +
              (channel!.active
                ? "bg-emerald-50 text-emerald-700"
                : "bg-zinc-100 text-zinc-500")
            }
          >
            <PlugZap className="size-3" aria-hidden />
            {channel!.active ? "เชื่อมแล้ว" : "พักการใช้งาน"}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
            <Plug className="size-3" aria-hidden />
            ยังไม่เชื่อม
          </span>
        )}
      </div>

      <p className="mb-3 text-sm text-zinc-500">
        ถ่ายใบเสร็จในกลุ่ม LINE ของ{companyName ? ` ${companyName}` : "บริษัท"} →
        ระบบสร้าง &quot;ร่าง&quot; ให้บัญชีตรวจ (ห้าม auto-post)
      </p>

      {/* คำแนะนำหาค่าใน LINE Developers */}
      <div className="mb-3 rounded-lg bg-zinc-50 p-3 text-xs text-zinc-600">
        หาได้ที่ <strong>LINE Developers</strong> → ช่อง Messaging API ของคุณ:
        <ul className="ml-4 mt-1 list-disc space-y-0.5">
          <li><strong>Channel ID</strong> · <strong>Channel secret</strong> — แท็บ Basic settings</li>
          <li><strong>Channel access token</strong> (long-lived) — แท็บ Messaging API</li>
          <li><strong>Group ID</strong> (ถ้ามี) — รหัสกลุ่มที่ให้พิมพ์ถาม &quot;สรุปเดือนนี้&quot; ได้ · เว้นว่างไว้ก่อนได้</li>
        </ul>
      </div>

      {/* ฟอร์มกรอกค่า */}
      <div className="space-y-2">
        <div>
          <label className="mb-1 block text-xs font-semibold text-zinc-600">
            Channel ID
          </label>
          <input
            value={lineChannelId}
            onChange={(e) => setLineChannelId(e.target.value)}
            placeholder="เช่น 2007211439"
            inputMode="numeric"
            className={inputCls}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-zinc-600">
            Channel secret {connected && <span className="font-normal text-zinc-400">(ตั้งแล้ว · เว้นว่าง = ใช้ค่าเดิม)</span>}
          </label>
          <input
            type="password"
            value={channelSecret}
            onChange={(e) => setChannelSecret(e.target.value)}
            placeholder={channel?.hasSecret ? "••••••••  (ตั้งค่าไว้แล้ว)" : "วาง Channel secret"}
            autoComplete="off"
            className={inputCls}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-zinc-600">
            Channel access token {connected && <span className="font-normal text-zinc-400">(ตั้งแล้ว · เว้นว่าง = ใช้ค่าเดิม)</span>}
          </label>
          <input
            type="password"
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            placeholder={channel?.hasAccessToken ? "••••••••  (ตั้งค่าไว้แล้ว)" : "วาง Channel access token (long-lived)"}
            autoComplete="off"
            className={inputCls}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-zinc-600">
            Group ID <span className="font-normal text-zinc-400">(ไม่บังคับ)</span>
          </label>
          <input
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
            placeholder="Cxxxxxxxx… (รหัสกลุ่มที่ให้ถามยอดได้)"
            autoComplete="off"
            className={inputCls}
          />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={save} disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Plug className="size-4" aria-hidden />}
          {connected ? "บันทึก" : "เชื่อมต่อ"}
        </Button>
        {connected && (
          <>
            <Button variant="ghost" onClick={toggleActive} disabled={pending}>
              {channel!.active ? "พักการใช้งาน" : "เปิดใช้งาน"}
            </Button>
            <Button variant="ghost" onClick={disconnect} disabled={pending} className="text-rose-600 hover:bg-rose-50">
              <Trash2 className="size-4" aria-hidden />
              ยกเลิกการเชื่อมต่อ
            </Button>
          </>
        )}
      </div>

      {msg && (
        <div
          className={
            "mt-3 flex items-start gap-1.5 rounded-lg px-3 py-2 text-sm " +
            (msg.kind === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800")
          }
          role="status"
          aria-live="polite"
        >
          {msg.kind === "ok" ? (
            <Check className="mt-0.5 size-4 shrink-0" aria-hidden />
          ) : (
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          )}
          <span>{msg.text}</span>
        </div>
      )}

      {/* Webhook URL จริง — โชว์เฉพาะตอนเชื่อมแล้ว (มีรหัสช่อง) */}
      {connected && webhookUrl && (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
          <label className="mb-1 block text-xs font-semibold text-emerald-800">
            Webhook URL — วางใน LINE Developers (แท็บ Messaging API)
          </label>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-white px-2 py-1.5 font-mono text-xs text-zinc-700">
              {webhookUrl}
            </code>
            <button
              onClick={copy}
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50"
              aria-label="คัดลอก"
            >
              {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
            </button>
          </div>
          <p className="mt-1.5 text-xs text-emerald-700">
            วางทั้งบรรทัด → เปิด &quot;Use webhook&quot; → กด Verify (ต้องได้ Success).
            <strong> ห้ามมี &quot;/&quot; ปิดท้าย</strong>
          </p>
        </div>
      )}
    </div>
  );
}
