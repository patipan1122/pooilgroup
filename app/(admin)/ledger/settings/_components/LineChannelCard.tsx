"use client";

// ผูกกลุ่ม LINE สำหรับรับรูปใบเสร็จ — STUB (Phase 1).
// TODO[ledger-secret]: ต้องตั้ง LINE OA + channel secret/access token ก่อน
// (เก็บแบบเข้ารหัสใน ledger_line_channel.webhook_secret_enc / access_token_enc).
// การเชื่อมต่อจริง + webhook อยู่ใน Partition B/D — การ์ดนี้แค่อธิบาย + เก็บที่อยู่.
import { MessageSquare, Copy, Check } from "lucide-react";
import { useState } from "react";

export function LineChannelCard({ companyName }: { companyName: string }) {
  const [copied, setCopied] = useState(false);
  // Webhook URL pattern (Partition B/D implements the route).
  const base =
    typeof window !== "undefined" ? window.location.origin : "https://pooilgroup.vercel.app";
  const webhookUrl = `${base}/api/webhooks/ledger/line/<channelId>`;

  function copy() {
    navigator.clipboard?.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="grid size-8 place-items-center rounded-lg bg-green-100 text-green-700">
          <MessageSquare className="size-4" />
        </span>
        <h2 className="text-sm font-bold text-zinc-800">กลุ่ม LINE รับใบเสร็จ</h2>
      </div>
      <p className="mb-3 text-sm text-zinc-500">
        ถ่ายใบเสร็จในกลุ่ม LINE ของ{companyName ? ` ${companyName}` : "บริษัท"} →
        ระบบสร้าง &quot;ร่าง&quot; ให้บัญชีตรวจ (ห้าม auto-post)
      </p>

      <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
        <strong>ยังไม่เปิดใช้งาน</strong> — ต้องตั้ง LINE Official Account +
        ใส่ Channel Secret / Access Token ก่อน (CEO เตรียมให้ · ดู
        <code className="mx-1">docs/LEDGER_SETUP.md</code>)
      </div>

      <div className="mt-3">
        <label className="mb-1 block text-xs font-semibold text-zinc-600">
          Webhook URL (ใส่ใน LINE Developers)
        </label>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-lg bg-zinc-50 px-2 py-1.5 font-mono text-xs text-zinc-600">
            {webhookUrl}
          </code>
          <button
            onClick={copy}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 hover:bg-zinc-50"
            aria-label="คัดลอก"
          >
            {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
