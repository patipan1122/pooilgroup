"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, X, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

export function RequestActions({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmReject, setConfirmReject] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function approve() {
    startTransition(async () => {
      const res = await fetch(`/api/admin/register-requests/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "อนุมัติไม่สำเร็จ");
        return;
      }
      setInviteUrl(json.inviteUrl);
      toast.success("อนุมัติเรียบร้อย · Copy ลิงก์ส่งให้ผู้ใช้ใน LINE");
      router.refresh();
    });
  }

  function reject() {
    setConfirmReject(false);
    startTransition(async () => {
      const res = await fetch(`/api/admin/register-requests/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reject",
          rejectReason: rejectReason.trim() || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error || "ปฏิเสธไม่สำเร็จ");
        return;
      }
      toast.success("ปฏิเสธคำขอแล้ว");
      setRejectReason("");
      router.refresh();
    });
  }

  function copyLink() {
    if (!inviteUrl) return;
    navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    toast.success("Copy แล้ว");
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="md"
          onClick={() => setConfirmReject(true)}
          disabled={pending}
        >
          <X className="size-4" />
          ปฏิเสธ
        </Button>
        <Button size="md" onClick={approve} loading={pending}>
          <CheckCircle2 className="size-4" />
          อนุมัติ
        </Button>
      </div>

      {/* Approval result — show invite link */}
      {inviteUrl && (
        <Dialog open onClose={() => setInviteUrl(null)} title="อนุมัติแล้ว">
          <div className="space-y-3">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="size-5 text-green-600 mt-0.5" />
              <div className="text-sm">
                <p className="font-bold">สร้าง User pending แล้ว</p>
                <p className="text-zinc-500 mt-0.5">
                  ส่งลิงก์นี้ใน LINE ให้ผู้ใช้กดตั้ง password — หมดอายุ 48 ชม.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs font-mono bg-zinc-50 rounded-lg px-3 py-2 border border-zinc-200 truncate">
                {inviteUrl}
              </code>
              <Button onClick={copyLink} size="md">
                {copied ? (
                  <Check className="size-4" />
                ) : (
                  <Copy className="size-4" />
                )}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <Button variant="ghost" fullWidth onClick={() => setInviteUrl(null)}>
              ปิด
            </Button>
          </div>
        </Dialog>
      )}

      {/* Reject confirmation */}
      {confirmReject && (
        <Dialog
          open
          onClose={() => setConfirmReject(false)}
          title="ปฏิเสธคำขอนี้?"
        >
          <div className="space-y-3">
            <p className="text-sm text-zinc-600">
              เหตุผลสำหรับเก็บอ้างอิง — ผู้ใช้จะไม่เห็นข้อความนี้
            </p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="เช่น ข้อมูลไม่ครบ · ไม่ใช่พนักงาน · ส่งซ้ำ"
              rows={3}
              maxLength={500}
              className="w-full rounded-xl border-2 border-zinc-200 bg-white p-3 text-sm focus:border-[--color-brand-500] focus:outline-none transition-colors resize-none"
            />
            <div className="flex gap-2">
              <Button
                variant="ghost"
                fullWidth
                onClick={() => setConfirmReject(false)}
              >
                ยกเลิก
              </Button>
              <Button
                variant="danger"
                fullWidth
                onClick={reject}
                loading={pending}
              >
                ยืนยันปฏิเสธ
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}
