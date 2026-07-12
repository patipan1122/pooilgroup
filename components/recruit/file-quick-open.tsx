"use client";

// ชิป "เปิดไฟล์แนบเร็ว" — โชว์บนการ์ดรายชื่อ + ในแถวตาราง
// แต่ละไฟล์ = ชิปของตัวเอง กดเปิดตรง (ไม่ใช้ popover → ไม่โดน overflow ตารางบัง · หลายไฟล์กดได้ทุกไฟล์)
// ใช้ <button> + window.open เพราะการ์ดถูกครอบด้วย <Link> (ห้าม <a> ซ้อน <a>)

import { Paperclip, FileText, Image as ImageIcon } from "lucide-react";
import type { AppFileMeta } from "@/lib/recruit/answers";

const R2_PUBLIC_URL = process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? "";

function fileHref(f: AppFileMeta): string {
  if (f.url) return f.url; // Drive share link
  return R2_PUBLIC_URL ? `${R2_PUBLIC_URL}/${f.key}` : "";
}

/** ป้ายสั้น ๆ ของไฟล์ (ให้ CEO รู้ว่าเป็นอะไร) */
function fileLabel(f: AppFileMeta): string {
  if (f.mime === "application/pdf") return "PDF";
  if (f.mime.startsWith("image/")) return "รูป";
  const ext = f.name.split(".").pop();
  return ext && ext.length <= 5 ? ext.toUpperCase() : "ไฟล์";
}

export function FileQuickOpen({
  files,
  variant = "chip",
}: {
  files: AppFileMeta[];
  variant?: "chip" | "cell";
}) {
  if (!files || files.length === 0) {
    return variant === "cell" ? <span className="text-zinc-300">—</span> : null;
  }

  const shown = files.slice(0, 3); // อัปโหลดได้สูงสุด 3 ไฟล์อยู่แล้ว
  const extra = files.length - shown.length;

  const base =
    variant === "cell"
      ? "inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-bold whitespace-nowrap transition-colors"
      : "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold whitespace-nowrap transition-colors";
  const tone =
    "border-[var(--color-brand-200)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)] hover:bg-[var(--color-brand-100)]";
  const iconSize = variant === "cell" ? "size-3.5" : "size-3";

  return (
    <span className="inline-flex items-center gap-1 flex-wrap">
      {shown.map((f, i) => {
        const url = fileHref(f);
        const disabled = !url;
        const isImage = f.mime.startsWith("image/");
        const Icon = isImage ? ImageIcon : files.length === 1 ? Paperclip : FileText;
        return (
          <button
            key={f.key || i}
            type="button"
            disabled={disabled}
            onClick={(e) => {
              // การ์ดเป็น <Link> — กันไม่ให้ไปหน้ารายละเอียด แล้วเปิดไฟล์แทน
              e.preventDefault();
              e.stopPropagation();
              if (url) window.open(url, "_blank", "noopener,noreferrer");
            }}
            title={
              disabled
                ? `เปิดไฟล์ไม่ได้: ${f.name} — กดเข้าดูในประวัติ`
                : `เปิด: ${f.name}`
            }
            className={`${base} ${disabled ? "border-zinc-200 text-zinc-400 cursor-not-allowed" : tone}`}
          >
            <Icon className={iconSize} />
            {files.length === 1 ? "ไฟล์" : fileLabel(f)}
          </button>
        );
      })}
      {extra > 0 && (
        <span className="text-[10px] text-zinc-400">+{extra}</span>
      )}
    </span>
  );
}
