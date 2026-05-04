import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { adminClient } from "@/lib/db/server";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

const POOL_GROUP_ORG_ID = "00000000-0000-0000-0000-000000000001";

async function checkFirstUser(): Promise<boolean> {
  try {
    const admin = adminClient();
    const { count } = await admin
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("org_id", POOL_GROUP_ORG_ID)
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
      <div className="mb-8 flex flex-col items-center text-center animate-fade-up">
        <div className="inline-flex items-center justify-center size-14 rounded-2xl bg-[--color-brand-600] text-white mb-5 shadow-blue">
          <CheckCircle2 className="size-7" strokeWidth={2.5} />
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight text-zinc-900 font-display">
          เข้าสู่ระบบ <span className="accent">Pool Group</span>
        </h1>
        <p className="text-sm text-zinc-500 mt-2 max-w-xs">
          จัดการยอดสาขา · เอกสาร · ขนส่งน้ำมัน
          <br />ครบในแพลตฟอร์มเดียว
        </p>
      </div>

      {isFirstRun && (
        <div className="mb-4 rounded-2xl bg-[--color-brand-50] border-2 border-[--color-brand-200] px-4 py-3.5 animate-fade-up delay-100">
          <div className="flex items-start gap-2.5">
            <span className="text-xl shrink-0">👋</span>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[--color-brand-800]">
                ยังไม่มี Owner ในระบบ
              </div>
              <div className="text-xs text-[--color-brand-700] mt-0.5">
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

      <div className="bg-white rounded-2xl border border-zinc-200 shadow-md p-6 sm:p-8 animate-fade-up delay-150">
        <LoginForm />
      </div>

      <p className="text-center text-sm text-zinc-500 mt-6 animate-fade-up delay-200">
        ยังไม่มีบัญชี?{" "}
        <Link
          href="/signup"
          className="font-semibold text-[--color-brand-700] hover:text-[--color-brand-800]"
        >
          สมัครสมาชิก →
        </Link>
      </p>
    </div>
  );
}
