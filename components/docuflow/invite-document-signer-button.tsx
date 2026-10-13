"use client";

// เชิญผู้เซ็นภายนอก (ไม่มีบัญชีในระบบ) ให้เซ็นเอกสารนี้โดยเฉพาะ — CEO 2026-10-08.
// แยกจาก InviteProgramStaffButton (components/users/invite-program-staff-button.tsx)
// เพราะคนละบริบท: ที่นี่คือคู่ค้า/ลูกค้าภายนอกที่ไม่ได้เป็นพนักงาน ไม่ใช่การรับ
// พนักงานเข้าโปรแกรม — เลยใช้ถ้อยคำที่เป็นกลาง ไม่บอกว่า "เป็นพนักงาน" หรือ
// "เริ่มใช้งาน ERP" (item 5). รูปแบบ dialog/form เดียวกันเพื่อความคุ้นเคย.

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Copy,
  Check,
  UserPlus2,
  Mail,
  User,
  Phone,
  CheckCircle2,
  Clock,
  UserX,
} from "lucide-react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/utils/cn";
import { inviteDocumentSigner } from "@/lib/docuflow/invite-signer";

export function InviteDocumentSignerButton({
  placementId,
  signerUser,
  onInvited,
  onRequestRevoke,
}: {
  placementId: string;
  /** Current signer attached to this placement, if any. When it's already
   *  an external signer (isExternalSigner: true), we show a status card
   *  ("invited, waiting" / "active, can revoke") instead of the invite
   *  form — UNLESS this component itself just generated a fresh invite
   *  link this session (see `inviteUrl` below), in which case the link
   *  dialog takes priority so the admin can still copy it.
   *
   *  BUG FIX (2026-10-13): this used to be branched on by the PARENT,
   *  which conditionally rendered either this component or the status
   *  card — so the instant `onInvited` flipped `signerUser.isExternalSigner`
   *  to true, the parent's ternary swapped branches and unmounted this
   *  whole component, wiping its local `open`/`inviteUrl` state and
   *  closing the just-created invite-link dialog before the admin could
   *  copy the link. Now the parent always keeps this component mounted
   *  (keyed only on placementId), and the status-card-vs-form decision
   *  lives in here instead, gated on local `inviteUrl` state that
   *  survives the `isExternalSigner` flag flip. */
  signerUser?: {
    id: string;
    name: string;
    isActive: boolean;
    isExternalSigner: boolean;
  } | null;
  /** Called once with the newly-created (or reused-pending) signer so the
   *  parent can patch its local placement state without a full reload. */
  onInvited: (signer: { id: string; name: string }) => void;
  /** Ask the parent to open its revoke-access confirm dialog for this
   *  placement (parent owns that confirm modal + the actual revoke call). */
  onRequestRevoke?: () => void;
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

  // Already has an external signer attached (prior session, or a prior
  // invite this session that the admin has since closed via `reset()`) —
  // show the status card instead of the invite button/form. `!inviteUrl`
  // keeps this from taking over the instant an invite succeeds: `submit()`
  // sets `inviteUrl` in the same tick it calls `onInvited()`, so the
  // just-generated link dialog (rendered below) still wins that render.
  if (signerUser?.isExternalSigner && !inviteUrl) {
    return (
      <div className="space-y-2">
        <div
          className={cn(
            "flex items-center gap-2 text-sm rounded-xl px-3 py-2 border",
            signerUser.isActive
              ? "text-green-700 bg-green-50 border-green-200"
              : "text-amber-700 bg-amber-50 border-amber-200",
          )}
        >
          {signerUser.isActive ? (
            <CheckCircle2 className="size-4 shrink-0" />
          ) : (
            <Clock className="size-4 shrink-0" />
          )}
          <span>
            {signerUser.isActive
              ? `${signerUser.name} ตั้งรหัสผ่านแล้ว — เข้าเซ็นได้`
              : `เชิญ ${signerUser.name} แล้ว รอตั้งรหัสผ่าน`}
          </span>
        </div>
        {signerUser.isActive && onRequestRevoke && (
          <button
            type="button"
            onClick={onRequestRevoke}
            className="w-full inline-flex items-center justify-center gap-2 h-9 px-3 text-xs rounded-xl bg-white text-red-600 border border-red-200 hover:bg-red-50 font-medium"
          >
            <UserX className="size-3.5" />
            ปิดสิทธิ์เข้าถึงผู้เซ็นนี้
          </button>
        )}
      </div>
    );
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
