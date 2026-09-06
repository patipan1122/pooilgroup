"use client";

// Recruit · self-serve teammate invite card — compact form + result state.
// Calls the recruit-scoped server action (team-actions.ts); the invited person
// is always granted program_admin scoped to recruit only (no role/program
// picker here — that's the point of the carve-out staying narrow).

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Copy, Check, UserPlus, Mail, User } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { inviteRecruitTeammate } from "../team-actions";

export function InviteTeammateCard() {
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
      const res = await inviteRecruitTeammate({
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
    setInviteUrl(null);
    setName("");
    setEmail("");
  }

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserPlus className="size-5 text-[var(--color-brand-700)]" />
          เชิญทีมงานเข้า Recruit
        </CardTitle>
      </CardHeader>
      <CardBody>
        {inviteUrl ? (
          <div className="space-y-3">
            <div className="rounded-xl bg-[var(--color-brand-50)] border-2 border-[var(--color-brand-200)] p-3">
              <p className="text-xs text-[var(--color-brand-700)] font-semibold mb-2">
                Invite Link · หมดอายุ 48 ชม.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs font-mono bg-white rounded-lg px-3 py-2 border border-[var(--color-brand-200)] truncate">
                  {inviteUrl}
                </code>
                <Button onClick={copy} size="md">
                  {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            </div>
            <p className="text-xs text-zinc-600">
              ✉️ ส่งลิงก์นี้ให้พนักงานทาง LINE หรืออีเมล — เขากดเข้าไปตั้งรหัสเอง แล้วจะเป็น
              <b> แอดมิน Recruit</b> ทันที (สร้าง/แก้ประกาศเองได้ แต่มองไม่เห็นโปรแกรมอื่น)
            </p>
            <Button variant="outline" onClick={reset} fullWidth>
              เชิญคนถัดไป
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <Field label="ชื่อ-นามสกุล" required>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="เช่น สมชาย ใจดี"
                prefixSlot={<User className="size-4" />}
                required
              />
            </Field>
            <Field label="อีเมล" optional hint="ถ้าไม่กรอก ระบบจะให้แค่ลิงก์เชิญ">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="เช่น staff@pooilgroup.com"
                prefixSlot={<Mail className="size-4" />}
              />
            </Field>
            <Button type="submit" loading={pending} disabled={!name.trim()} fullWidth>
              สร้างลิงก์เชิญ
            </Button>
          </form>
        )}
      </CardBody>
    </Card>
  );
}
