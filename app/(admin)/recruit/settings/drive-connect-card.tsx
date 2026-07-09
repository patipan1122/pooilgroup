"use client";

// Recruit settings · Google Drive connect card. Shows connection status and a
// "เชื่อม Google Drive" button that starts the OAuth handshake (returns here).

import { useState } from "react";
import { toast } from "sonner";
import { HardDrive, CheckCircle2, ExternalLink } from "lucide-react";
import { startRecruitDriveConnect } from "./drive-actions";

export function DriveConnectCard({ connected }: { connected: boolean }) {
  const [loading, setLoading] = useState(false);

  async function connect() {
    setLoading(true);
    try {
      const res = await startRecruitDriveConnect();
      if (!res.ok) {
        toast.error(res.error);
        setLoading(false);
        return;
      }
      // redirect to Google consent
      window.location.href = res.url;
    } catch (e) {
      toast.error((e as Error).message);
      setLoading(false);
    }
  }

  return (
    <div className="rounded-2xl border-2 border-zinc-200 bg-white p-5">
      <div className="flex items-start gap-3">
        <div
          className={`size-12 rounded-xl flex items-center justify-center shrink-0 ${
            connected ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"
          }`}
        >
          <HardDrive className="size-6" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-bold text-zinc-900 text-base">
              เก็บไฟล์ผู้สมัครใน Google Drive
            </p>
            {connected && (
              <span className="inline-flex items-center gap-1 text-[11px] font-bold bg-green-50 text-green-700 px-2 py-0.5 rounded-full">
                <CheckCircle2 className="size-3" /> เชื่อมแล้ว
              </span>
            )}
          </div>
          <p className="text-xs text-zinc-600 mt-1 leading-relaxed">
            เรซูเม่ที่ผู้สมัครแนบจะไปเก็บในโฟลเดอร์ &quot;Recruit&quot; ใน Google
            Drive ของบริษัท เปิดดูได้จากลิงก์ในใบสมัคร
            <br />
            <span className="text-zinc-400">
              เป็นการล็อกอิน Google ครั้งเดียวของทั้งบริษัท (ใช้ร่วมทุกโปรแกรม) ·
              เฉพาะเจ้าของระบบเชื่อมได้
            </span>
          </p>

          <button
            type="button"
            onClick={connect}
            disabled={loading}
            className="mt-3 inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-[var(--color-brand-600)] text-white text-sm font-bold hover:bg-[var(--color-brand-700)] disabled:opacity-60 transition-colors"
          >
            <ExternalLink className="size-4" />
            {loading
              ? "กำลังเปิด Google..."
              : connected
                ? "เชื่อมใหม่ / เปลี่ยนบัญชี Google"
                : "เชื่อม Google Drive"}
          </button>
        </div>
      </div>
    </div>
  );
}
