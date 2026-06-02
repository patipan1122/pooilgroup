"use client";

// Slip uploader for vendor bills · presigns to R2 via /api/chairops/r2/presign,
// PUTs the file directly from the browser, then surfaces the public URL up
// via onChange so the parent form persists it into ChairopsVendorBill.slipPhotoUrl.

import { useState, useTransition } from "react";
import { ImageIcon, Trash2 } from "lucide-react";

interface Props {
  branchSlug: string;
  billId: string;
  value: string | null;
  onChange: (url: string | null) => void;
}

export function SlipUploader({ branchSlug, billId, value, onChange }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("ใช้ไฟล์รูปภาพเท่านั้น (jpg/png/heic/webp)");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("ขนาดไฟล์ต้องไม่เกิน 10 MB");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const presignRes = await fetch("/api/chairops/r2/presign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: "bill-slip",
            branchSlug,
            contextId: billId,
            contentType: file.type,
            ext: file.name.split(".").pop()?.toLowerCase() ?? undefined,
          }),
        });
        if (!presignRes.ok) {
          const body = await presignRes.json().catch(() => null);
          setError(body?.error ?? "ขออัปโหลดไม่สำเร็จ");
          return;
        }
        const presign = (await presignRes.json()) as {
          url: string;
          publicUrl: string;
        };
        const put = await fetch(presign.url, {
          method: "PUT",
          headers: { "Content-Type": file.type },
          body: file,
        });
        if (!put.ok) {
          setError(`อัปโหลดล้มเหลว (HTTP ${put.status})`);
          return;
        }
        onChange(presign.publicUrl);
      } catch {
        setError("เกิดข้อผิดพลาดระหว่างอัปโหลด");
      }
    });
  };

  return (
    <div className="space-y-2">
      {value ? (
        <div className="flex items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value}
            alt="สลิป"
            className="size-24 rounded-md border border-zinc-200 object-cover"
          />
          <div className="flex flex-col gap-1 text-xs">
            <a
              href={value}
              target="_blank"
              rel="noreferrer"
              className="text-blue-700 underline"
            >
              เปิดในแท็บใหม่
            </a>
            <button
              type="button"
              onClick={() => onChange(null)}
              className="inline-flex w-fit items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-zinc-600 hover:bg-zinc-50"
            >
              <Trash2 className="size-3" aria-hidden="true" />
              เอาออก
            </button>
          </div>
        </div>
      ) : null}
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50">
        <ImageIcon className="size-3.5" aria-hidden="true" />
        {isPending
          ? "กำลังอัปโหลด…"
          : value
            ? "เปลี่ยนรูป"
            : "เลือกรูปสลิป"}
        <input
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={onFile}
          disabled={isPending}
        />
      </label>
      {error ? (
        <p className="text-xs text-rose-600">{error}</p>
      ) : null}
    </div>
  );
}
