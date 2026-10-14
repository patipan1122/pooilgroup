"use client";

// Reusable "connect my Telegram" widget — shared by /profile (any signed-in
// user, no module gating) and /docuflow/settings/telegram (admin overview +
// instructions page, which embeds this same widget for the viewing admin's
// own account). Deliberately built on the generic components/ui primitives
// (Button, Badge) rather than DocuFlow's `.df-*` tokens, since it has to
// render correctly OUTSIDE `.df-root` too (the profile page isn't DocuFlow).
//
// Talks to POST /api/telegram/connect (mint a token) and POST
// /api/telegram/disconnect (unlink) — see those routes for the account-level
// pairing mechanism (lib/telegram/pairing.ts).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Send, Copy, ExternalLink, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface ConnectResult {
  token: string;
  deepLink: string | null;
  expiresAt: string;
}

export function ConnectTelegramButton({
  connected,
}: {
  connected: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ConnectResult | null>(null);

  function connect() {
    startTransition(async () => {
      const res = await fetch("/api/telegram/connect", { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as Partial<ConnectResult> & {
        error?: string;
      };
      if (!res.ok) {
        toast.error(json.error || "สร้างลิงก์เชื่อมบัญชีไม่สำเร็จ");
        return;
      }
      setResult(json as ConnectResult);
    });
  }

  function disconnect() {
    if (!window.confirm("ยกเลิกการเชื่อม Telegram? คุณจะไม่ได้รับแจ้งเตือนทาง Telegram อีก")) {
      return;
    }
    startTransition(async () => {
      const res = await fetch("/api/telegram/disconnect", { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(json.error || "ยกเลิกการเชื่อมไม่สำเร็จ");
        return;
      }
      setResult(null);
      toast.success("ยกเลิกการเชื่อม Telegram แล้ว");
      router.refresh();
    });
  }

  function copyToken() {
    if (!result) return;
    navigator.clipboard?.writeText(`/start ${result.token}`);
    toast.success("คัดลอกแล้ว — เปิดแชทกับบอท แล้ววางในแชทได้เลย");
  }

  if (connected && !result) {
    return (
      <div className="flex items-center gap-2">
        <Badge tone="success">เชื่อมแล้ว</Badge>
        <Button variant="outline" size="sm" onClick={disconnect} loading={pending}>
          <Unlink className="size-3.5" />
          ยกเลิกการเชื่อม
        </Button>
      </div>
    );
  }

  if (result) {
    return (
      <div className="space-y-2">
        {result.deepLink ? (
          <a
            href={result.deepLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex"
          >
            <Button variant="primary" size="sm">
              <ExternalLink className="size-3.5" />
              เปิดใน Telegram เพื่อเชื่อมบัญชี
            </Button>
          </a>
        ) : (
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
            <p className="text-xs text-zinc-600 mb-1">
              เปิดแชทกับบอทที่แอดมินตั้งไว้ แล้วพิมพ์ข้อความนี้ส่งไป:
            </p>
            <div className="flex items-center gap-2">
              <code className="text-sm font-mono text-zinc-900">
                /start {result.token}
              </code>
              <button
                type="button"
                onClick={copyToken}
                className="text-zinc-400 hover:text-zinc-700"
                aria-label="คัดลอก"
              >
                <Copy className="size-3.5" />
              </button>
            </div>
          </div>
        )}
        <p className="text-xs text-zinc-500">
          ลิงก์นี้ใช้ได้ 15 นาที — กดแล้วบอทจะเชื่อมบัญชีให้อัตโนมัติ
        </p>
      </div>
    );
  }

  return (
    <Button variant="primary" size="sm" onClick={connect} loading={pending}>
      <Send className="size-3.5" />
      เชื่อมบัญชี Telegram
    </Button>
  );
}
