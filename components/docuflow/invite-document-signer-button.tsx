"use client";

// เชิญผู้เซ็นภายนอก (ไม่มีบัญชีในระบบ) ให้เซ็นเอกสารนี้โดยเฉพาะ — CEO 2026-10-08.
// แยกจาก InviteProgramStaffButton (components/users/invite-program-staff-button.tsx)
// เพราะคนละบริบท: ที่นี่คือคู่ค้า/ลูกค้าภายนอกที่ไม่ได้เป็นพนักงาน ไม่ใช่การรับ
// พนักงานเข้าโปรแกรม — เลยใช้ถ้อยคำที่เป็นกลาง ไม่บอกว่า "เป็นพนักงาน" หรือ
// "เริ่มใช้งาน ERP" (item 5). รูปแบบ dialog/form เดียวกันเพื่อความคุ้นเคย.

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Copy, Check, UserPlus2, Mail, User, Phone } from "lucide-react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { inviteDocumentSigner } from "@/lib/docuflow/invite-signer";

export function InviteDocumentSignerButton({
  placementId,
  onInvited,
}: {
  placementId: string;
  /** Called once with the newly-created (or reused-pending) signer so the
   *  parent can patch its local placement state without a full reload. */
  onInvited: (signer: { id: string; name: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("กรุณากรอกชื่อผู้เซ็น");
      return;
    }
    startTransition(async () => {
      const res = await inviteDocumentSigner({
        placementId,
        name: name.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setInviteUrl(res.inviteUrl);
      onInvited({ id: res.userId, name: res.userName });
      toast.success(
        res.reused
          ? "มีคำเชิญที่ยังรอตอบรับอยู่แล้ว — ใช้ลิงก์เดิม"
          : "สร้างลิงก์เชิญผู้เซ็นสำเร็จ",
      );
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
    setPhone("");
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full inline-flex items-center justify-center gap-2 h-10 px-4 text-sm rounded-xl bg-white text-zinc-900 border border-zinc-200 hover:bg-zinc-50 font-medium"
      >
        <UserPlus2 className="size-4" />
        เชิญเซ็นเอกสาร (คนนอก ยังไม่มีบัญชี)
      </button>

      <Dialog open={open} onClose={reset} title="เชิญเซ็นเอกสาร">
        {inviteUrl ? (
          <div className="space-y-3">
            <p className="text-sm text-zinc-600">
              ส่งลิงก์นี้ให้ผู้เซ็น — กดเข้าไปตั้งรหัสผ่านแล้วจะเห็นเอกสารนี้
              ให้เซ็นได้ทันที (เข้าได้เฉพาะเอกสารนี้เท่านั้น ไม่เห็นเอกสารอื่น
              ในระบบ)
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-[11px] font-mono bg-zinc-50 rounded-lg px-2 py-1.5 border border-zinc-200 truncate">
                {inviteUrl}
              </code>
              <Button onClick={copy} size="sm">
                {copied ? (
                  <Check className="size-3.5" />
                ) : (
                  <Copy className="size-3.5" />
                )}
              </Button>
            </div>
            <div className="flex justify-end pt-2 border-t border-zinc-100">
              <Button variant="ghost" size="sm" onClick={reset}>
                ปิด
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <p className="text-xs text-zinc-500">
              สำหรับคนนอกองค์กร (คู่ค้า/ลูกค้า) ที่ยังไม่มีบัญชีในระบบ —
              ระบบจะสร้างบัญชีให้เฉพาะเซ็นเอกสารนี้เท่านั้น ไม่เห็นเอกสาร
              หรือโปรแกรมอื่นของ Pooilgroup
            </p>
            <Field label="ชื่อผู้เซ็น" required>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="เช่น คุณสมชาย ใจดี"
                prefixSlot={<User className="size-4" />}
                required
              />
            </Field>
            <Field
              label="อีเมล"
              optional
              hint="ไม่กรอกก็ได้ ระบบให้แค่ลิงก์เชิญ"
            >
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="เช่น partner@example.com"
                prefixSlot={<Mail className="size-4" />}
              />
            </Field>
            <Field label="เบอร์โทร" optional>
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="เช่น 081-234-5678"
                prefixSlot={<Phone className="size-4" />}
              />
            </Field>
            <div className="flex gap-2 pt-1">
              <Button
                type="submit"
                loading={pending}
                disabled={!name.trim()}
                size="sm"
              >
                สร้างลิงก์เชิญ
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={reset}
              >
                ยกเลิก
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}
