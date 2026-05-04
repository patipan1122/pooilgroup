"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Mail, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { browserClient } from "@/lib/db/client";

export function ForgotPasswordForm() {
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    startTransition(async () => {
      const sb = browserClient();
      const baseUrl =
        typeof window !== "undefined" ? window.location.origin : "";
      const { error } = await sb.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${baseUrl}/login`,
      });
      if (error) {
        toast.error("ส่งไม่สำเร็จ", { description: error.message });
        return;
      }
      setSent(true);
      toast.success("ส่งลิงก์รีเซ็ตแล้ว");
    });
  }

  if (sent) {
    return (
      <div className="text-center py-4">
        <div className="size-12 rounded-full bg-green-100 text-green-600 flex items-center justify-center mx-auto mb-3">
          <CheckCircle2 className="size-6" />
        </div>
        <h3 className="font-semibold mb-1">ตรวจสอบอีเมลของคุณ</h3>
        <p className="text-sm text-zinc-500 mb-4">
          เราส่งลิงก์รีเซ็ตรหัสผ่านไปที่
          <br />
          <span className="font-medium text-zinc-900">{email}</span>
        </p>
        <p className="text-xs text-zinc-400">
          ไม่เห็นอีเมล? ตรวจ Spam หรือ ลองส่งอีกครั้งใน 1 นาที
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <Field label="อีเมล" required>
        <Input
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="เช่น owner@poolgroup.com"
          prefixSlot={<Mail className="size-4" />}
          required
        />
      </Field>
      <Button
        type="submit"
        size="lg"
        fullWidth
        loading={pending}
        disabled={!email.trim() || pending}
      >
        ส่งลิงก์รีเซ็ตรหัสผ่าน
      </Button>
    </form>
  );
}
