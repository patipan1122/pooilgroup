"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Lock, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { browserClient } from "@/lib/db/client";

interface Props {
  token: string;
  email: string | null;
  userId: string;
}

export function InviteAcceptForm({ token, email: initialEmail, userId }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState(initialEmail ?? "");
  const [password, setPassword] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!email.trim()) return setError("กรุณากรอกอีเมล");
    if (password.length < 8) return setError("รหัสผ่านอย่างน้อย 8 ตัว");
    if (password !== confirmPwd) return setError("รหัสผ่านไม่ตรงกัน");

    startTransition(async () => {
      const res = await fetch("/api/auth/invite/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          userId,
          email: email.trim(),
          password,
        }),
      });
      const json = await res.json();

      if (!res.ok) {
        setError(json.error ?? "Activate ไม่สำเร็จ");
        return;
      }

      // Auto sign-in
      const sb = browserClient();
      const { error: signErr } = await sb.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signErr) {
        toast.warning("Activate สำเร็จ แต่ login ไม่ได้", {
          description: signErr.message,
        });
        router.push("/login");
        return;
      }

      // Record session + audit LOGIN
      await fetch("/api/auth/post-login", { method: "POST" }).catch(() => {});

      toast.success("ยินดีต้อนรับ!");
      router.refresh();
      router.push("/");
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <Field label="อีเมล" required>
        <Input
          type="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          prefixSlot={<Mail className="size-4" />}
          required
          disabled={pending}
        />
      </Field>
      <Field label="รหัสผ่าน" required hint="อย่างน้อย 8 ตัว">
        <Input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          prefixSlot={<Lock className="size-4" />}
          required
          minLength={8}
          disabled={pending}
        />
      </Field>
      <Field label="ยืนยันรหัสผ่าน" required>
        <Input
          type="password"
          autoComplete="new-password"
          value={confirmPwd}
          onChange={(e) => setConfirmPwd(e.target.value)}
          prefixSlot={<Lock className="size-4" />}
          required
          minLength={8}
          invalid={confirmPwd.length > 0 && confirmPwd !== password}
          disabled={pending}
        />
      </Field>

      {error && (
        <div className="text-sm text-[var(--color-danger)] bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      <Button
        type="submit"
        size="lg"
        fullWidth
        loading={pending}
        disabled={pending}
      >
        เริ่มใช้งาน →
      </Button>
    </form>
  );
}
