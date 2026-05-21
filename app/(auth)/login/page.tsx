import Link from "next/link";
import { adminClient } from "@/lib/db/server";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

const POOILGROUP_ORG_ID = "00000000-0000-0000-0000-000000000001";

async function checkFirstUser(): Promise<boolean> {
  try {
    const admin = adminClient();
    const { count } = await admin
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("org_id", POOILGROUP_ORG_ID)
      .eq("role", "super_admin")
      .eq("is_active", true);
    return !count || count === 0;
  } catch {
    return false;
  }
}

export default async function LoginPage() {
  const isFirstRun = await checkFirstUser();

  return (
    <div className="w-full max-w-md">
      {/* Hero — Anuphan heavy display + gradient blue */}
      <div className="mb-10 flex flex-col items-center text-center animate-slide-up-soft">
        <div className="inline-flex items-center justify-center size-16 rounded-2xl bg-[var(--color-brand-600)] text-white mb-6 font-display font-extrabold text-2xl shadow-blue glow-blue">
          P
        </div>
        <p className="text-xs uppercase tracking-[0.18em] font-bold text-[var(--color-brand-700)] mb-3">
          <span className="brand-gradient-text">Pooilgroup</span>{" "}
          ERP
        </p>
        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-[-0.04em] text-zinc-900 font-display leading-[0.95]">
          เข้าสู่ <span className="text-gradient-blue">ระบบ</span>
        </h1>
        <p className="text-base text-zinc-600 mt-4 max-w-xs leading-relaxed">
          จัดการยอดสาขา · เอกสาร · ขนส่งน้ำมัน — รวมในที่เดียว
        </p>
      </div>

      {isFirstRun && (
        <div className="mb-5 rounded-2xl bg-[var(--color-brand-50)] border-2 border-[var(--color-brand-200)] px-4 py-3.5 animate-fade-up delay-100">
          <div className="flex items-start gap-3">
            <span className="text-2xl shrink-0">👋</span>
            <div className="min-w-0">
              <div className="text-sm font-bold text-[var(--color-brand-800)]">
                ยังไม่มี Owner ในระบบ
              </div>
              <div className="text-xs text-[var(--color-brand-700)] mt-0.5">
                สร้างบัญชี Super Admin บัญชีแรก{" "}
                <Link
                  href="/signup"
                  className="font-bold underline underline-offset-2"
                >
                  ที่นี่ →
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-3xl border-2 border-zinc-200 shadow-lg p-6 sm:p-8 animate-fade-up delay-150">
        <LoginForm />
      </div>

      <p className="text-center text-sm text-zinc-500 mt-7 animate-fade-up delay-200">
        ยังไม่มีบัญชี?{" "}
        <Link
          href="/join"
          className="font-bold text-[var(--color-brand-700)] hover:text-[var(--color-brand-800)] underline underline-offset-2"
        >
          ขอเข้าใช้งาน →
        </Link>
      </p>
    </div>
  );
}
