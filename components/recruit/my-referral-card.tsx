"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { getMyReferralCode } from "@/lib/recruit/referral-actions";
import { Copy, Share2, MessageCircle } from "lucide-react";

export function MyReferralCard() {
  const [code, setCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [, startTransition] = useTransition();

  useEffect(() => {
    startTransition(async () => {
      try {
        const result = await getMyReferralCode();
        if (result.ok) setCode(result.code);
        else toast.error(result.error);
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setLoading(false);
      }
    });
  }, []);

  const url = code ? `${typeof window !== "undefined" ? window.location.origin : ""}/refer/${code}` : "";

  function copy() {
    if (!url) return;
    navigator.clipboard
      .writeText(url)
      .then(() => toast.success("คัดลอกลิ้งค์แล้ว"))
      .catch(() => toast.error("คัดลอกไม่สำเร็จ"));
  }

  function lineShare() {
    if (!url) return;
    const msg = encodeURIComponent(`มาสมัครงานกับเราด้วยกัน 💪 ${url}`);
    window.open(`https://line.me/R/msg/text/?${msg}`, "_blank");
  }

  return (
    <div className="rounded-2xl bg-gradient-to-br from-purple-600 to-purple-800 text-white p-5 mb-4">
      <div className="flex items-center gap-2 text-xs opacity-80 mb-2">
        <Share2 className="size-3.5" />
        ลิ้งค์ของคุณ
      </div>
      <p className="text-xs opacity-80 mb-1">ส่งให้เพื่อนสมัครงานกับเรา</p>
      {loading ? (
        <p className="text-2xl font-extrabold font-display animate-pulse">กำลังโหลด...</p>
      ) : code ? (
        <>
          <div className="bg-white/15 rounded-xl p-3 my-3 flex items-center gap-2 backdrop-blur-sm">
            <p className="font-mono text-xs sm:text-sm truncate flex-1">{url}</p>
            <button
              type="button"
              onClick={copy}
              className="size-9 rounded-lg bg-white/20 hover:bg-white/30 flex items-center justify-center shrink-0"
            >
              <Copy className="size-4" />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={lineShare}
              className="flex-1 h-10 rounded-xl bg-green-500 hover:bg-green-600 text-white font-bold text-xs inline-flex items-center justify-center gap-1.5"
            >
              <MessageCircle className="size-3.5" />
              ส่ง LINE
            </button>
            <button
              type="button"
              onClick={copy}
              className="flex-1 h-10 rounded-xl bg-white/20 hover:bg-white/30 text-white font-bold text-xs inline-flex items-center justify-center gap-1.5"
            >
              <Copy className="size-3.5" />
              คัดลอก
            </button>
          </div>
          <p className="text-[11px] opacity-70 mt-3 leading-relaxed">
            รหัสของคุณ: <span className="font-mono font-bold">{code}</span> · ส่งให้เพื่อน →
            เพื่อนกดสมัคร → ระบบติด tag อัตโนมัติ → เมื่อรับเข้าจะได้โบนัส
          </p>
        </>
      ) : (
        <p className="text-sm opacity-80">ไม่สามารถสร้างรหัสได้</p>
      )}
    </div>
  );
}
