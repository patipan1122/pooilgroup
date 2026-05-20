// Bug Report Modal — opened from AI floating button's "แจ้งบัค" section.
// 2026-05-20 (CEO request): พนักงานเจอบัค → กรอก + แนบ screenshot → ส่งเข้า DB
// → admin ดูที่ /bugs

"use client";

import { useState, useRef, useEffect } from "react";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import { Bug, X, Upload, Image as ImageIcon, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

interface Props {
  open: boolean;
  onClose: () => void;
}

const MAX_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export function BugReportModal({ open, onClose }: Props) {
  const pathname = usePathname();
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset form when modal closes
  useEffect(() => {
    if (!open) {
      const t = setTimeout(() => {
        setDescription("");
        setFile(null);
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewUrl(null);
        setSubmitted(false);
        setSubmitting(false);
      }, 300);
      return () => clearTimeout(t);
    }
  }, [open, previewUrl]);

  // Paste-from-clipboard support — gives screenshot UX a 1-step path
  useEffect(() => {
    if (!open) return;
    function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const blob = item.getAsFile();
          if (blob) {
            handleFile(blob);
            e.preventDefault();
            return;
          }
        }
      }
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleFile(f: File) {
    if (!ALLOWED_MIME.has(f.type)) {
      toast.error("รับเฉพาะรูป (JPG/PNG/WebP/GIF)");
      return;
    }
    if (f.size > MAX_BYTES) {
      toast.error("รูปใหญ่เกินไป (สูงสุด 10MB)");
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
  }

  function onFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  }

  async function uploadScreenshot(): Promise<string | null> {
    if (!file) return null;

    // 1) get signed URL
    const signRes = await fetch("/api/r2/sign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: file.name || `bug-${Date.now()}.png`,
        contentType: file.type,
        size: file.size,
      }),
    });
    if (!signRes.ok) {
      const j = (await signRes.json().catch(() => ({}))) as { error?: string };
      throw new Error(j.error || "ขอ upload URL ไม่สำเร็จ");
    }
    const { uploadUrl, key } = (await signRes.json()) as {
      uploadUrl: string;
      key: string;
    };

    // 2) PUT to R2
    const putRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": file.type },
      body: file,
    });
    if (!putRes.ok) {
      throw new Error(`อัปโหลดล้มเหลว (${putRes.status})`);
    }

    return key;
  }

  async function handleSubmit() {
    if (submitting) return;
    if (description.trim().length < 3) {
      toast.error("กรุณาอธิบายบัคอย่างน้อย 3 ตัวอักษร");
      return;
    }
    setSubmitting(true);
    try {
      const screenshotKey = await uploadScreenshot();
      const url =
        typeof window !== "undefined"
          ? window.location.pathname + window.location.search
          : pathname || "/";
      const userAgent =
        typeof navigator !== "undefined" ? navigator.userAgent : undefined;

      const res = await fetch("/api/bugs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          description: description.trim(),
          screenshotKey: screenshotKey ?? undefined,
          userAgent,
        }),
      });

      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || "ส่งบัคไม่สำเร็จ");
      }
      setSubmitted(true);
      toast.success("ส่งรายงานบัคเรียบร้อย", {
        description: "ทีมจะรีบดูให้ครับ ขอบคุณที่ช่วยแจ้ง 🙏",
      });
      // auto-close after 1.5s
      setTimeout(() => onClose(), 1500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "เกิดข้อผิดพลาด";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 px-4 pb-4 sm:p-6"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-lg bg-white rounded-2xl shadow-pop border-2 border-zinc-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b-2 border-zinc-100 flex items-center justify-between bg-gradient-to-br from-amber-50 to-white">
          <div className="flex items-center gap-2.5">
            <div className="size-9 rounded-xl bg-amber-500 text-white flex items-center justify-center shadow-soft">
              <Bug className="size-4" />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-amber-700 font-bold">
                BUG REPORT
              </p>
              <p className="text-base font-extrabold font-display leading-tight">
                แจ้งบัค <span className="accent">หน้านี้</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="size-9 rounded-xl hover:bg-zinc-100 flex items-center justify-center"
            aria-label="ปิด"
          >
            <X className="size-5" />
          </button>
        </div>

        {submitted ? (
          <div className="p-8 text-center">
            <div className="text-5xl mb-3">✅</div>
            <p className="text-lg font-extrabold font-display mb-1">
              ส่งเรียบร้อย
            </p>
            <p className="text-sm text-zinc-500">
              ทีมจะรีบดูให้ครับ ขอบคุณที่ช่วยแจ้ง
            </p>
          </div>
        ) : (
          <div className="p-5 space-y-4">
            {/* Current URL preview */}
            <div className="flex items-start gap-2 text-xs text-zinc-500 bg-zinc-50 rounded-xl px-3 py-2 border border-zinc-100">
              <span className="font-bold text-zinc-700">หน้า:</span>
              <code className="text-zinc-600 break-all">
                {typeof window !== "undefined"
                  ? window.location.pathname + window.location.search
                  : pathname}
              </code>
            </div>

            {/* Description */}
            <div>
              <label
                htmlFor="bug-desc"
                className="block text-sm font-bold text-zinc-900 mb-1.5"
              >
                เกิดอะไรขึ้น? <span className="text-red-500">*</span>
              </label>
              <textarea
                id="bug-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="กดอะไรแล้วเกิดอะไร · ขั้นตอนทำซ้ำ · ที่คาดหวัง vs ที่ได้จริง"
                rows={4}
                maxLength={2000}
                className="w-full px-3 py-2 rounded-xl border-2 border-zinc-200 focus:border-amber-500 focus:outline-none text-sm resize-none"
              />
              <p className="text-[10px] text-zinc-400 mt-1 text-right">
                {description.length} / 2000
              </p>
            </div>

            {/* Screenshot */}
            <div>
              <label className="block text-sm font-bold text-zinc-900 mb-1.5">
                แนบรูป (Screenshot · ไม่บังคับ)
              </label>
              <input
                ref={inputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={onFileInput}
                className="hidden"
              />
              {previewUrl ? (
                <div className="relative rounded-xl border-2 border-zinc-200 overflow-hidden bg-zinc-50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={previewUrl}
                    alt="Screenshot preview"
                    className="w-full max-h-64 object-contain"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (previewUrl) URL.revokeObjectURL(previewUrl);
                      setPreviewUrl(null);
                      setFile(null);
                    }}
                    className="absolute top-2 right-2 size-8 rounded-full bg-black/60 text-white hover:bg-black flex items-center justify-center"
                    aria-label="ลบรูป"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  className={cn(
                    "w-full px-4 py-6 rounded-xl border-2 border-dashed border-zinc-300",
                    "hover:border-amber-400 hover:bg-amber-50/50 transition-colors",
                    "flex flex-col items-center justify-center gap-2 text-zinc-500",
                  )}
                >
                  <ImageIcon className="size-6" />
                  <span className="text-sm font-medium">
                    เลือกรูปหรือลาก/วาง (Ctrl+V)
                  </span>
                  <span className="text-[10px] text-zinc-400">
                    JPG/PNG/WebP/GIF · สูงสุด 10MB
                  </span>
                </button>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                onClick={onClose}
                className="flex-1"
                disabled={submitting}
              >
                ยกเลิก
              </Button>
              <Button
                onClick={handleSubmit}
                className="flex-1 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white"
                disabled={submitting || description.trim().length < 3}
              >
                {submitting ? (
                  <>
                    <Loader2 className="size-4 mr-2 animate-spin" />
                    กำลังส่ง...
                  </>
                ) : (
                  <>
                    <Upload className="size-4 mr-2" />
                    ส่งรายงาน
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
