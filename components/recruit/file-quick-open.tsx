"use client";

// ปุ่ม/ชิป "เปิดไฟล์แนบเร็ว" — โชว์บนการ์ดรายชื่อ + ในแถวตาราง
// กดแล้วเปิดไฟล์หลัก (เรซูเม่ PDF ก่อน · ไม่มีก็ไฟล์แรก) ในแท็บใหม่ทันที
// ใช้ <button> + window.open เพราะการ์ดถูกครอบด้วย <Link> อยู่แล้ว (ห้าม <a> ซ้อน <a>)

import { Paperclip } from "lucide-react";
import type { AppFileMeta } from "@/lib/recruit/answers";

const R2_PUBLIC_URL = process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? "";

function fileHref(f: AppFileMeta): string {
  if (f.url) return f.url; // Drive share link
  return R2_PUBLIC_URL ? `${R2_PUBLIC_URL}/${f.key}` : "";
}

/** ไฟล์หลักที่จะเปิด: PDF (เรซูเม่) ก่อน → ไฟล์แรกที่เหลือ */
function primaryFile(files: AppFileMeta[]): AppFileMeta {
  return files.find((f) => f.mime === "application/pdf") ?? files[0];
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

  const primary = primaryFile(files);
  const url = fileHref(primary);
  const count = files.length;
  const disabled = !url;

  const base =
    variant === "cell"
      ? "inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-bold whitespace-nowrap transition-colors"
      : "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold whitespace-nowrap transition-colors";
  const tone = disabled
    ? "border-zinc-200 text-zinc-400 cursor-not-allowed"
    : "border-[var(--color-brand-200)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)] hover:bg-[var(--color-brand-100)]";

  return (
    <button
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
          ? "เปิดไฟล์ไม่ได้ (ไม่มีลิงก์) — กดเข้าดูในประวัติ"
          : `เปิดไฟล์แนบ: ${primary.name}${count > 1 ? ` (+${count - 1} ไฟล์)` : ""}`
      }
      className={`${base} ${tone}`}
    >
      <Paperclip className={variant === "cell" ? "size-3.5" : "size-3"} />
      {count > 1 ? `${count} ไฟล์` : "ไฟล์"}
    </button>
  );
}
