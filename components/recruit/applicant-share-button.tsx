"use client";

// "แชร์รายชื่อผู้สมัคร" — generates (or reuses) a public, no-login share link
// scoped to ONE posting (same trust model as RentSpace's bill share link —
// the random token itself is the credential). Lives next to ShareKitButton /
// CopyLinkButton on the postings list (same modal shell + shape).
//
// Revoke uses <ConfirmDialog> (not window.confirm) per this codebase's
// "no native browser modals" convention (see components/ui/confirm-dialog.tsx).

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Copy, Check, Users, X, Ban } from "lucide-react";
import {
  generateApplicantShareLink,
  revokeApplicantShareLink,
} from "@/lib/recruit/actions";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface Props {
  postingId: string;
}

export function ApplicantShareButton({ postingId }: Props) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [copied, setCopied] = useState(false);

  function openDialog() {
    setOpen(true);
    // Lazily creates the token if it doesn't exist yet, or just returns the
    // existing one — safe to call every time the dialog opens.
    startLoading(async () => {
      try {
        const res = await generateApplicantShareLink(postingId);
        setUrl(res.url);
      } catch (e) {
        toast.error((e as Error).message);
        setOpen(false);
      }
    });
  }

  function copy() {
    if (!url) return;
    navigator.clipboard.writeText(url).then(
      () => {
        setCopied(true);
        toast.success("คัดลอกลิงก์แล้ว");
        setTimeout(() => setCopied(false), 2000);
      },
      () => toast.error("คัดลอกไม่สำเร็จ"),
    );
  }

  async function revoke() {
    try {
      await revokeApplicantShareLink(postingId);
      toast.success("ยกเลิกลิงก์แล้ว · ลิงก์เดิมเปิดไม่ได้อีก");
      setUrl(null);
      setOpen(false);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        title="สร้างลิงก์ดูรายชื่อผู้สมัคร (เปิดดูได้เลย ไม่ต้องล็อกอิน)"
        className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white text-xs font-bold text-zinc-700 hover:bg-zinc-50 whitespace-nowrap"
      >
        <Users className="size-3.5" />
        แชร์รายชื่อ
      </button>
      {open && (
        <div
          className="fixed inset-0 z-[60] bg-black/50 flex items-end sm:items-center justify-center sm:p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl max-h-[92vh] overflow-y-auto shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-white/95 backdrop-blur border-b border-zinc-100 px-5 py-4 flex items-center justify-between gap-3 rounded-t-3xl">
              <div className="min-w-0">
                <p className="text-[11px] font-bold text-[var(--color-brand-700)] uppercase tracking-wide">
                  แชร์รายชื่อผู้สมัคร
                </p>
                <p className="text-[11px] text-zinc-500 mt-0.5">
                  ใครมีลิงก์นี้ก็เปิดดูรายชื่อได้เลย ไม่ต้องล็อกอิน (ดูอย่างเดียว) — ส่งต่อเท่าที่จำเป็น
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="size-9 shrink-0 inline-flex items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100"
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {loading || !url ? (
                <div className="h-11 rounded-xl bg-zinc-100 animate-pulse" />
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <span className="flex-1 min-w-0 truncate font-mono text-[11px] text-zinc-600 bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2.5">
                      {url}
                    </span>
                    <button
                      type="button"
                      onClick={copy}
                      className="h-10 px-3 shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 text-xs font-bold text-zinc-700 hover:bg-zinc-50"
                    >
                      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                      คัดลอก
                    </button>
                  </div>

                  <ConfirmDialog
                    title="ยกเลิกลิงก์แชร์นี้?"
                    body="ลิงก์เดิมจะเปิดไม่ได้อีกทันที · กด “แชร์รายชื่อ” ใหม่เพื่อสร้างลิงก์ใหม่ (คนละลิงก์กับของเดิม)"
                    confirmLabel="ยกเลิกลิงก์"
                    onConfirm={revoke}
                    trigger={
                      <button
                        type="button"
                        className="w-full h-11 inline-flex items-center justify-center gap-2 rounded-xl border border-red-200 text-sm font-bold text-red-600 hover:bg-red-50"
                      >
                        <Ban className="size-4" />
                        ยกเลิกลิงก์แชร์
                      </button>
                    }
                  />
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
