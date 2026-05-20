"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Copy, QrCode, ExternalLink } from "lucide-react";

interface Props {
  slug: string;
  title: string;
}

export function PostingShareCard({ slug, title }: Props) {
  const [showQR, setShowQR] = useState(false);
  const url = `${getOrigin()}/apply/${slug}`;
  // QR via free public API (no library dependency)
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(url)}`;

  function copyLink() {
    navigator.clipboard.writeText(url);
    toast.success("คัดลอกลิ้งค์แล้ว");
  }

  return (
    <div className="rounded-3xl border-2 border-[var(--color-brand-200)] bg-gradient-to-br from-[var(--color-brand-50)]/40 to-white p-5">
      <div className="flex items-start gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase tracking-[0.18em] font-bold text-[var(--color-brand-700)]">
            ลิ้งค์รับสมัคร
          </p>
          <p className="font-mono text-sm text-zinc-900 mt-2 break-all bg-white rounded-lg border border-zinc-200 px-3 py-2">
            {url}
          </p>
          <p className="text-xs text-zinc-500 mt-2">
            เอาลิ้งค์นี้ไปแปะ Facebook · LINE · หน้าร้าน · ใครก็กรอกได้ ไม่ต้อง login
          </p>

          <div className="mt-3 flex gap-2 flex-wrap">
            <button
              type="button"
              onClick={copyLink}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-white bg-[var(--color-brand-600)] px-3 py-2 rounded-lg hover:bg-[var(--color-brand-700)]"
            >
              <Copy className="size-3.5" />
              คัดลอก
            </button>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-bold text-zinc-700 border border-zinc-300 px-3 py-2 rounded-lg hover:bg-zinc-50"
            >
              <ExternalLink className="size-3.5" />
              เปิดดู
            </a>
            <button
              type="button"
              onClick={() => setShowQR(!showQR)}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-zinc-700 border border-zinc-300 px-3 py-2 rounded-lg hover:bg-zinc-50"
            >
              <QrCode className="size-3.5" />
              {showQR ? "ซ่อน QR" : "ดู QR"}
            </button>
          </div>
        </div>

        {showQR && (
          <div className="text-center">
            <img
              src={qrUrl}
              alt="QR code สำหรับลิ้งค์รับสมัคร"
              width={180}
              height={180}
              className="rounded-2xl border border-zinc-200 bg-white p-2"
            />
            <a
              href={qrUrl}
              download={`qr-${slug}.png`}
              className="block text-xs text-[var(--color-brand-700)] mt-2 hover:underline"
            >
              ⬇ โหลด QR
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

function getOrigin(): string {
  if (typeof window !== "undefined") return window.location.origin;
  return "https://pooilgroup.vercel.app";
}
