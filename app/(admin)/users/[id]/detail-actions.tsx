"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Edit3,
  Trash2,
  RotateCcw,
  Send,
  Copy,
  CheckCircle2,
  X,
  Eye,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

interface Props {
  userId: string;
  isActive: boolean;
  isPendingInvite: boolean;
  isSelf: boolean;
  /** Real (not impersonated) admin role — shown the "เข้าใช้แทน" button only when super_admin. */
  canImpersonate: boolean;
}

export function UserDetailActions({
  userId,
  isActive,
  isPendingInvite,
  isSelf,
  canImpersonate,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function deactivate() {
    setConfirmDeactivate(false);
    startTransition(async () => {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        toast.error(json.error || "ปิดบัญชีไม่สำเร็จ");
        return;
      }
      toast.success("ปิดบัญชีแล้ว · ผู้ใช้ออกจากทุกอุปกรณ์");
      router.refresh();
    });
  }

  function reactivate() {
    startTransition(async () => {
      const res = await fetch(`/api/admin/users/${userId}/reactivate`, {
        method: "POST",
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        toast.error(json.error || "เปิดบัญชีไม่สำเร็จ");
        return;
      }
      toast.success("เปิดบัญชีแล้ว");
      router.refresh();
    });
  }

  function resendInvite() {
    startTransition(async () => {
      const res = await fetch(`/api/admin/users/${userId}/resend-invite`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "ส่งลิงก์ใหม่ไม่สำเร็จ");
        return;
      }
      setInviteUrl(json.inviteUrl);
      toast.success("สร้างลิงก์ใหม่สำเร็จ");
    });
  }

  function impersonate() {
    startTransition(async () => {
      const res = await fetch(`/api/admin/users/${userId}/impersonate`, {
        method: "POST",
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        toast.error(json.error || "เข้าใช้แทนไม่สำเร็จ");
        return;
      }
      toast.success("กำลังเปลี่ยนเป็นบัญชีนี้...");
      router.refresh();
      router.push("/");
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
      <div className="flex flex-wrap gap-2 items-center">
        {!isSelf && isActive && canImpersonate && (
          <Button
            variant="outline"
            size="md"
            onClick={impersonate}
            loading={pending}
          >
            <Eye className="size-4" />
            เข้าใช้แทน
          </Button>
        )}
        {!isSelf && isActive && (
          <Button
            variant="outline"
            size="md"
            onClick={() => setConfirmDeactivate(true)}
            disabled={pending}
          >
            <Trash2 className="size-4" />
            ปิดบัญชี
          </Button>
        )}
        {!isActive && isPendingInvite && (
          <Button
            variant="outline"
            size="md"
            onClick={resendInvite}
            loading={pending}
          >
            <Send className="size-4" />
            ส่งลิงก์ใหม่
          </Button>
        )}
        {!isActive && !isPendingInvite && (
          <Button
            variant="outline"
            size="md"
            onClick={reactivate}
            loading={pending}
          >
            <RotateCcw className="size-4" />
            เปิดบัญชีอีกครั้ง
          </Button>
        )}
        {isActive && (
          <a href={`/users/${userId}/edit`} className="contents">
            <Button size="md" disabled={pending}>
              <Edit3 className="size-4" />
              แก้ไข
            </Button>
          </a>
        )}
      </div>

      {/* Resend-invite result */}
      {inviteUrl && (
        <Dialog open onClose={() => setInviteUrl(null)} title="ลิงก์ Invite ใหม่">
          <div className="space-y-3">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="size-5 text-green-600 mt-0.5" />
              <div>
                <h3 className="font-bold">ลิงก์ Invite ใหม่</h3>
                <p className="text-xs text-zinc-500 mt-0.5">
                  ส่งให้ผู้ใช้คลิก — หมดอายุ 48 ชม.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs font-mono bg-zinc-50 rounded-lg px-3 py-2 border border-zinc-200 truncate">
                {inviteUrl}
              </code>
              <Button onClick={copyLink} size="md">
                {copied ? (
                  <CheckCircle2 className="size-4" />
                ) : (
                  <Copy className="size-4" />
                )}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <Button
              variant="ghost"
              fullWidth
              onClick={() => setInviteUrl(null)}
            >
              ปิด
            </Button>
          </div>
        </Dialog>
      )}

      {/* Deactivate confirmation */}
      {confirmDeactivate && (
        <Dialog
          open
          onClose={() => setConfirmDeactivate(false)}
          title="ปิดบัญชีผู้ใช้นี้?"
        >
          <div className="space-y-3">
            <div className="flex items-start gap-2">
              <X className="size-5 text-red-600 mt-0.5" />
              <div>
                <h3 className="font-bold">ปิดบัญชีผู้ใช้นี้?</h3>
                <p className="text-xs text-zinc-500 mt-0.5">
                  ผู้ใช้จะออกจากทุกอุปกรณ์ · เข้าใช้ระบบไม่ได้อีก ·
                  ข้อมูลและรายงานยังอยู่ครบ
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                fullWidth
                onClick={() => setConfirmDeactivate(false)}
              >
                ยกเลิก
              </Button>
              <Button
                variant="danger"
                fullWidth
                onClick={deactivate}
                loading={pending}
              >
                ยืนยันปิด
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}
