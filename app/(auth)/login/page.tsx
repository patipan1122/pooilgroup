import Link from "next/link";
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
      <div className="mb-8 text-center">
        <div className="inline-flex items-center justify-center size-14 rounded-2xl bg-[--color-brand-600] text-white mb-4 shadow-lg">
          <span className="text-2xl font-bold font-display">P</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 font-display">
          ยินดีต้อนรับกลับ
        </h1>
        <p className="text-sm text-zinc-500 mt-1">
          เข้าสู่ระบบเพื่อจัดการ Pool Group ERP
        </p>
      </div>

      {isFirstRun && (
        <div className="mb-4 rounded-2xl bg-[--color-brand-50] border border-[--color-brand-200] px-4 py-3.5">
          <div className="flex items-start gap-2.5">
            <span className="text-xl shrink-0">👋</span>
            <div className="min-w-0">
              <div className="text-sm font-medium text-[--color-brand-800]">
                ยังไม่มี Owner ในระบบ
              </div>
              <div className="text-xs text-[--color-brand-700] mt-0.5">
                สร้างบัญชี Super Admin บัญชีแรก{" "}
                <Link
                  href="/signup"
                  className="font-semibold underline underline-offset-2"
                >
                  ที่นี่ →
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-zinc-200 shadow-soft p-6 sm:p-8">
        <LoginForm />
      </div>

      <p className="text-center text-sm text-zinc-500 mt-6">
        ยังไม่มีบัญชี?{" "}
        <Link
          href="/signup"
          className="font-medium text-[--color-brand-700] hover:underline"
        >
          สมัครสมาชิก
        </Link>
      </p>
    </div>
  );
}
