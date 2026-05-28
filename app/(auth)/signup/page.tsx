import Link from "next/link";
import { redirect } from "next/navigation";
import { Crown } from "lucide-react";
import { adminClient } from "@/lib/db/server";
import { SignupForm } from "./signup-form";

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

// Public signup is BOOTSTRAP-ONLY — once a super_admin exists this page
// redirects to /join (the admin-approved request flow).
// See feedback_user_creation_rules.md (hierarchical approval rule).
export default async function SignupPage() {
  const isFirstUser = await checkFirstUser();

  if (!isFirstUser) {
    redirect("/join");
  }

  return (
    <div className="w-full max-w-md">
      <div className="mb-10 flex flex-col items-center text-center animate-slide-up-soft">
        <div className="inline-flex items-center justify-center size-16 rounded-2xl bg-[var(--color-brand-600)] text-white mb-6 font-display font-extrabold text-2xl shadow-blue glow-blue">
          P
        </div>
        <p className="text-xs uppercase tracking-[0.18em] font-bold text-[var(--color-brand-700)] mb-3">
          <span className="brand-gradient-text">Pooilgroup</span>{" "}
          ERP
        </p>
        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-[-0.04em] text-zinc-900 font-display leading-[0.95]">
          {isFirstUser ? (
            <>
              ตั้งค่า <span className="text-gradient-blue">Owner</span>
            </>
          ) : (
            <>
              สร้าง<span className="text-gradient-blue">บัญชีใหม่</span>
            </>
          )}
        </h1>
        <p className="text-base text-zinc-600 mt-4 max-w-xs leading-relaxed">
          {isFirstUser
            ? "บัญชีแรก = Super Admin สูงสุดของ Pooilgroup"
            : "Admin จะกำหนดสาขาให้หลังจากสร้างบัญชี"}
        </p>
      </div>

      <div className="bg-white rounded-3xl border-2 border-zinc-200 shadow-lg p-6 sm:p-8 animate-fade-up delay-100">
        {isFirstUser && (
          <div className="mb-5 rounded-xl bg-gradient-to-br from-[var(--color-brand-50)] to-white border-2 border-[var(--color-brand-200)] px-4 py-3.5 text-sm">
            <div className="flex items-start gap-2.5">
              <Crown className="size-5 text-[var(--color-brand-600)] shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-[var(--color-brand-800)]">
                  บัญชีแรกในระบบ
                </div>
                <div className="text-xs text-[var(--color-brand-700)] mt-0.5">
                  คุณจะได้สิทธิ์ Super Admin โดยอัตโนมัติ — จัดการทุกสาขา/ทุกผู้ใช้
                </div>
              </div>
            </div>
          </div>
        )}
        <SignupForm isFirstUser={isFirstUser} />
      </div>

      <p className="text-center text-sm text-zinc-500 mt-7 animate-fade-up delay-200">
        มีบัญชีอยู่แล้ว?{" "}
        <Link
          href="/login"
          className="font-bold text-[var(--color-brand-700)] hover:text-[var(--color-brand-800)] underline underline-offset-2"
        >
          เข้าสู่ระบบ →
        </Link>
      </p>
    </div>
  );
}
