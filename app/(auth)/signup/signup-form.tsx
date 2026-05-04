"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Mail, Lock, User, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { browserClient } from "@/lib/db/client";

interface Props {
  isFirstUser: boolean;
}

export function SignupForm({ isFirstUser }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [error, setError] = useState<string | null>(null);

  function validate(): string | null {
    if (!name.trim()) return "กรุณากรอกชื่อ-นามสกุล";
    if (!email.trim()) return "กรุณากรอกอีเมล";
    if (!password) return "กรุณากรอกรหัสผ่าน";
    if (password.length < 8) return "รหัสผ่านอย่างน้อย 8 ตัว";
    if (password !== confirmPwd) return "รหัสผ่านไม่ตรงกัน";
    return null;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const v = validate();
    if (v) {
      setError(v);
      return;
    }

    startTransition(async () => {
      // Step 1: create account via API
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim() || undefined,
          password,
        }),
      });
      const json = await res.json();

      if (!res.ok) {
        setError(json.error || "สร้างบัญชีไม่ได้");
        toast.error(json.error || "สร้างบัญชีไม่ได้");
        return;
      }

      // Step 2: auto sign-in
      const sb = browserClient();
      const { error: signInErr } = await sb.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInErr) {
        toast.warning("สร้างบัญชีสำเร็จ แต่เข้าสู่ระบบไม่ได้", {
          description: signInErr.message,
        });
        router.push("/login");
        return;
      }

      toast.success(
        isFirstUser
          ? "🎉 ตั้งค่า Super Admin สำเร็จ"
          : "สร้างบัญชีสำเร็จ",
        { description: "กำลังเข้าสู่ระบบ..." },
      );

      router.refresh();
      router.push("/");
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <Field label="ชื่อ-นามสกุล" required htmlFor="name">
        <Input
          id="name"
          type="text"
          autoComplete="name"
          placeholder="เช่น สมชาย ใจดี"
          value={name}
          onChange={(e) => setName(e.target.value)}
          prefixSlot={<User className="size-4" />}
          disabled={pending}
          required
        />
      </Field>

      <Field label="อีเมล" required htmlFor="email">
        <Input
          id="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="เช่น owner@pooilgroup.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          prefixSlot={<Mail className="size-4" />}
          disabled={pending}
          required
        />
      </Field>

      <Field label="เบอร์โทร" optional htmlFor="phone" hint="ใช้สำหรับ Telegram bot — กรอกหรือเพิ่มทีหลังก็ได้">
        <Input
          id="phone"
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          placeholder="เช่น 081-234-5678"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          prefixSlot={<Phone className="size-4" />}
          disabled={pending}
        />
      </Field>

      <Field label="รหัสผ่าน" required htmlFor="password" hint="อย่างน้อย 8 ตัว">
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          prefixSlot={<Lock className="size-4" />}
          disabled={pending}
          required
          minLength={8}
        />
      </Field>

      <Field label="ยืนยันรหัสผ่าน" required htmlFor="confirm-password">
        <Input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          placeholder="••••••••"
          value={confirmPwd}
          onChange={(e) => setConfirmPwd(e.target.value)}
          prefixSlot={<Lock className="size-4" />}
          disabled={pending}
          required
          minLength={8}
          invalid={confirmPwd.length > 0 && confirmPwd !== password}
        />
      </Field>

      {error && (
        <div className="text-sm text-[--color-danger] bg-red-50 border border-red-100 rounded-lg px-3 py-2">
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
        {pending
          ? "กำลังสร้างบัญชี..."
          : isFirstUser
            ? "สร้างบัญชี Owner"
            : "สมัครสมาชิก"}
      </Button>
    </form>
  );
}
