"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Mail, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { browserClient } from "@/lib/db/client";

export function LoginForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!email || !password) {
      setError("กรุณากรอก Email และรหัสผ่าน");
      return;
    }

    startTransition(async () => {
      const sb = browserClient();
      const { error: err } = await sb.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (err) {
        const msg =
          err.message === "Invalid login credentials"
            ? "Email หรือรหัสผ่านไม่ถูกต้อง"
            : err.message;
        setError(msg);
        toast.error("เข้าสู่ระบบไม่สำเร็จ", { description: msg });
        return;
      }
      toast.success("เข้าสู่ระบบสำเร็จ");
      router.refresh();
      router.push("/");
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <Field label="อีเมล" required htmlFor="email">
        <Input
          id="email"
          type="email"
          name="email"
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

      <Field label="รหัสผ่าน" required htmlFor="password">
        <Input
          id="password"
          type="password"
          name="password"
          autoComplete="current-password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          prefixSlot={<Lock className="size-4" />}
          disabled={pending}
          required
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
        disabled={pending || !email || !password}
      >
        {pending ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}
      </Button>

      <div className="pt-2 text-center">
        <p className="text-xs text-zinc-400">
          การ Login ทาง LIFF (LINE) ใช้ที่ Rich Menu บนแอป LINE
        </p>
      </div>
    </form>
  );
}
