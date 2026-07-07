"use client";

// "ชุดโพสต์รับสมัคร" — per-posting share kit on the postings list.
// Gives HR a ready-to-paste caption (edit + save + copy) + the cover image
// to download + the apply link — everything needed to post on Facebook/LINE.

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { updatePosting } from "@/lib/recruit/actions";
import {
  Megaphone,
  Copy,
  Download,
  X,
  ImageIcon,
  Link as LinkIcon,
  Sparkles,
  Check,
} from "lucide-react";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "";

interface Props {
  postingId: string;
  slug: string;
  title: string;
  companyName?: string | null;
  description?: string | null;
  caption?: string | null;
  coverImageUrl?: string | null;
}

function buildTemplate(p: Props): string {
  const company = p.companyName?.trim() ?? "";
  const jd = (p.description ?? "").trim();
  const applyUrl = APP_URL ? `${APP_URL}/apply/${p.slug}` : "";
  const lines = [
    `🔔 รับสมัคร ${p.title.trim() || "พนักงาน"}`,
    company ? `📍 ${company}` : "",
    "",
    jd,
    "",
    "✅ สนใจสมัคร กรอกใบสมัครออนไลน์ (ไม่ต้องล็อกอิน · ใช้เวลา 3-5 นาที):",
    applyUrl,
    "",
    "📱 สอบถามเพิ่มเติม ทักแชทเพจได้เลย",
    company ? `#รับสมัครงาน #${company.replace(/\s+/g, "")}` : "#รับสมัครงาน",
  ];
  return lines
    .filter((l, i) => !(l === "" && lines[i - 1] === ""))
    .join("\n")
    .trim();
}

export function ShareKitButton(props: Props) {
  const [open, setOpen] = useState(false);
  const applyUrl = APP_URL ? `${APP_URL}/apply/${props.slug}` : `/apply/${props.slug}`;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="ชุดโพสต์รับสมัคร"
        className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-brand-600)] text-white text-xs font-bold hover:bg-[var(--color-brand-700)] whitespace-nowrap"
      >
        <Megaphone className="size-3.5" />
        ชุดโพสต์
      </button>
      {open && (
        <ShareKitDialog {...props} applyUrl={applyUrl} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function ShareKitDialog(
  props: Props & { applyUrl: string; onClose: () => void },
) {
  const [caption, setCaption] = useState(
    props.caption?.trim() ? props.caption : buildTemplate(props),
  );
  const [saving, startSave] = useTransition();
  const [copied, setCopied] = useState<"caption" | "link" | null>(null);

  function copy(text: string, which: "caption" | "link") {
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(which);
        toast.success(which === "caption" ? "คัดลอกคำโพสต์แล้ว" : "คัดลอกลิงก์แล้ว");
        setTimeout(() => setCopied(null), 2000);
      },
      () => toast.error("คัดลอกไม่สำเร็จ"),
    );
  }

  function saveCaption() {
    startSave(async () => {
      try {
        await updatePosting(props.postingId, { caption });
        toast.success("บันทึกคำโพสต์แล้ว");
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  async function downloadImage() {
    if (!props.coverImageUrl) return;
    try {
      const resp = await fetch(props.coverImageUrl);
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${props.slug}-cover.jpg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("ดาวน์โหลดรูปแล้ว");
    } catch {
      window.open(props.coverImageUrl, "_blank");
      toast.info("เปิดรูปในแท็บใหม่ · กดค้างที่รูปเพื่อบันทึก");
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/50 flex items-end sm:items-center justify-center sm:p-4"
      onClick={props.onClose}
    >
      <div
        className="bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl max-h-[92vh] overflow-y-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header (sticky) */}
        <div className="sticky top-0 bg-white/95 backdrop-blur border-b border-zinc-100 px-5 py-4 flex items-center justify-between gap-3 rounded-t-3xl">
          <div className="min-w-0">
            <p className="text-[11px] font-bold text-[var(--color-brand-700)] uppercase tracking-wide">
              ชุดโพสต์รับสมัคร
            </p>
            <p className="text-sm font-extrabold text-zinc-900 truncate">
              {props.title}
            </p>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            className="size-9 shrink-0 inline-flex items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Cover image */}
          <div>
            <p className="text-xs font-bold text-zinc-700 mb-2 flex items-center gap-1.5">
              <ImageIcon className="size-3.5 text-zinc-400" />
              รูปสำหรับโพสต์
            </p>
            {props.coverImageUrl ? (
              <div className="space-y-2">
                <div className="rounded-2xl overflow-hidden border border-zinc-200 aspect-[16/9] bg-zinc-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={props.coverImageUrl}
                    alt="รูปโพสต์"
                    className="w-full h-full object-cover"
                  />
                </div>
                <button
                  type="button"
                  onClick={downloadImage}
                  className="w-full h-11 inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-300 text-sm font-bold text-zinc-700 hover:bg-zinc-50"
                >
                  <Download className="size-4" />
                  ดาวน์โหลดรูป
                </button>
              </div>
            ) : (
              <div className="rounded-2xl border-2 border-dashed border-zinc-200 p-4 text-center text-xs text-zinc-500">
                ยังไม่มีรูป — เพิ่มรูปสถานที่ทำงานได้ที่หน้า{" "}
                <span className="font-bold text-zinc-700">แก้ประกาศ</span>
              </div>
            )}
          </div>

          {/* Caption */}
          <div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="text-xs font-bold text-zinc-700 flex items-center gap-1.5">
                <Megaphone className="size-3.5 text-zinc-400" />
                คำโพสต์
              </p>
              <button
                type="button"
                onClick={() => setCaption(buildTemplate(props))}
                className="inline-flex items-center gap-1 text-[11px] font-bold text-[var(--color-brand-700)] hover:underline"
              >
                <Sparkles className="size-3" />
                สร้างใหม่จากเทมเพลต
              </button>
            </div>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={9}
              className="w-full px-3 py-2.5 rounded-xl border border-zinc-300 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-400)]"
              maxLength={2000}
            />
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => copy(caption, "caption")}
                className="h-11 inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--color-brand-600)] text-white text-sm font-bold hover:bg-[var(--color-brand-700)]"
              >
                {copied === "caption" ? <Check className="size-4" /> : <Copy className="size-4" />}
                คัดลอกคำโพสต์
              </button>
              <button
                type="button"
                onClick={saveCaption}
                disabled={saving}
                className="h-11 inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-300 text-sm font-bold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
              >
                {saving ? "กำลังบันทึก..." : "บันทึกคำโพสต์"}
              </button>
            </div>
          </div>

          {/* Apply link */}
          <div>
            <p className="text-xs font-bold text-zinc-700 mb-2 flex items-center gap-1.5">
              <LinkIcon className="size-3.5 text-zinc-400" />
              ลิงก์สมัคร
            </p>
            <div className="flex items-center gap-2">
              <span className="flex-1 min-w-0 truncate font-mono text-[11px] text-zinc-600 bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2.5">
                {props.applyUrl}
              </span>
              <button
                type="button"
                onClick={() => copy(props.applyUrl, "link")}
                className="h-10 px-3 shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 text-xs font-bold text-zinc-700 hover:bg-zinc-50"
              >
                {copied === "link" ? <Check className="size-4" /> : <Copy className="size-4" />}
                คัดลอก
              </button>
            </div>
          </div>

          <p className="text-[11px] text-zinc-400 leading-relaxed">
            วิธีโพสต์: ดาวน์โหลดรูป → เปิด Facebook/LINE เพจ → สร้างโพสต์ → แนบรูป →
            วางคำโพสต์ (คำโพสต์มีลิงก์สมัครอยู่แล้ว)
          </p>
        </div>
      </div>
    </div>
  );
}
