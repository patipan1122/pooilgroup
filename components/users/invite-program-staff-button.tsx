"use client";

// เชิญพนักงานเข้าโปรแกรมนี้โดยตรง — ใช้บนหน้า /users/permissions โดยแอดมิน
// ของโปรแกรมนั้น (ไม่ต้องเป็นแอดมินองค์กร) ตาม CEO 2026-09-30: "ถ้าตัวเองเป็น
// แอดมินโปรแกรมนั้น ก็ควรเชิญคนอื่นเป็นได้ แต่ตำแหน่งต้องต่ำกว่าตัวเองเสมอ" —
// ผู้ถูกเชิญจะได้ตำแหน่ง "พนักงาน" (staff) + สิทธิ์สมาชิกของโปรแกรมนี้เท่านั้น
// เสมอ (ไม่ใช่แอดมินโปรแกรม) เพื่อไม่ให้ขยายกลุ่มคนที่แต่งตั้งแอดมินได้

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Copy, Check, UserPlus, Mail, User } from "lucide-react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { inviteProgramStaff } from "@/lib/auth/program-invite";

export function InviteProgramStaffButton({
  moduleSlug,
  programName,
}: {
  moduleSlug: string;
  programName: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("กรุณากรอกชื่อ");
      return;
    }
    startTransition(async () => {
      const res = await inviteProgramStaff({
        moduleSlug,
        name: name.trim(),
        email: email.trim() || undefined,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setInviteUrl(res.inviteUrl);
      toast.success("สร้างลิงก์เชิญสำเร็จ");
    });
  }

  function copy() {
    if (!inviteUrl) return;
    navigator.clipboard.writeText(inviteUrl).then(() => {
      setCopied(true);
      toast.success("คัดลอกแล้ว");
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function reset() {
    setOpen(false);
    setInviteUrl(null);
    setName("");
    setEmail("");
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-semibold text-[var(--color-brand-600)] hover:underline inline-flex items-center gap-1"
      >
        <UserPlus className="size-3.5" />
        เชิญพนักงาน →
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-xl border-2 border-zinc-200 p-3 bg-zinc-50">
      {inviteUrl ? (
        <div className="space-y-2">
          <p className="text-xs text-zinc-600">
            ✉️ ส่งลิงก์นี้ให้พนักงาน — กดเข้าไปตั้งรหัสเอง จะเป็น
            <b> พนักงานของ{programName}</b> ทันที
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-[11px] font-mono bg-white rounded-lg px-2 py-1.5 border border-zinc-200 truncate">
              {inviteUrl}
            </code>
            <Button onClick={copy} size="sm">
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            </Button>
          </div>
          <button
            type="button"
            onClick={reset}
            className="text-xs text-zinc-500 hover:underline"
          >
            ปิด
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-2">
          <Field label="ชื่อ-นามสกุล" required>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="เช่น สมชาย ใจดี"
              prefixSlot={<User className="size-4" />}
              required
            />
          </Field>
          <Field label="อีเมล" optional hint="ไม่กรอกก็ได้ ระบบให้แค่ลิงก์เชิญ">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="เช่น staff@pooilgroup.com"
              prefixSlot={<Mail className="size-4" />}
            />
          </Field>
          <div className="flex gap-2">
            <Button type="submit" loading={pending} disabled={!name.trim()} size="sm">
              สร้างลิงก์เชิญ
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              ยกเลิก
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
