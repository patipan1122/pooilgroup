import Link from "next/link";
import { KeyRound } from "lucide-react";
import { ForgotPasswordForm } from "./forgot-form";

export default function ForgotPasswordPage() {
  return (
    <div className="w-full max-w-md">
      <div className="mb-8 flex flex-col items-center text-center animate-fade-up">
        <div className="inline-flex items-center justify-center size-14 rounded-2xl bg-[var(--color-brand-600)] text-white mb-5 shadow-blue">
          <KeyRound className="size-7" strokeWidth={2.5} />
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight text-zinc-900 font-display">
          ลืม <span className="accent">รหัสผ่าน</span>?
        </h1>
        <p className="text-sm text-zinc-500 mt-2 max-w-xs">
          ใส่อีเมลของคุณ ระบบจะส่งลิงก์รีเซ็ตรหัสผ่านไปให้
        </p>
      </div>
      <div className="bg-white rounded-2xl border border-zinc-200 shadow-md p-6 sm:p-8 animate-fade-up delay-100">
        <ForgotPasswordForm />
      </div>
      <p className="text-center text-sm text-zinc-500 mt-6 animate-fade-up delay-200">
        จำได้แล้ว?{" "}
        <Link
          href="/login"
          className="font-semibold text-[var(--color-brand-700)] hover:text-[var(--color-brand-800)]"
        >
          กลับไป Login →
        </Link>
      </p>
    </div>
  );
}
