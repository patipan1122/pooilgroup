import Link from "next/link";
import { Crown, UserPlus } from "lucide-react";
import { adminClient } from "@/lib/db/server";
import { SignupForm } from "./signup-form";

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

export default async function SignupPage() {
  const isFirstUser = await checkFirstUser();

  return (
    <div className="w-full max-w-md">
      <div className="mb-8 flex flex-col items-center text-center animate-fade-up">
        <div className="inline-flex items-center justify-center size-14 rounded-2xl bg-[--color-brand-600] text-white mb-5 shadow-blue">
          {isFirstUser ? (
            <Crown className="size-7" strokeWidth={2.5} />
          ) : (
            <UserPlus className="size-7" strokeWidth={2.5} />
          )}
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight text-zinc-900 font-display">
          {isFirstUser ? (
            <>ตั้งค่า <span className="accent">Owner</span></>
          ) : (
            <>สร้างบัญชี<span className="accent">ใหม่</span></>
          )}
        </h1>
        <p className="text-sm text-zinc-500 mt-2 max-w-xs">
          {isFirstUser
            ? "บัญชีแรก = Super Admin ของ Pooilgroup"
            : "Admin จะกำหนดสาขาให้คุณหลังสร้างบัญชี"}
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-zinc-200 shadow-md p-6 sm:p-8 animate-fade-up delay-100">
        {isFirstUser && (
          <div className="mb-5 rounded-xl bg-gradient-to-br from-[--color-brand-50] to-white border-2 border-[--color-brand-200] px-4 py-3.5 text-sm">
            <div className="flex items-start gap-2.5">
              <Crown className="size-5 text-[--color-brand-600] shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-[--color-brand-800]">
                  บัญชีแรกในระบบ
                </div>
                <div className="text-xs text-[--color-brand-700] mt-0.5">
                  คุณจะได้สิทธิ์ Super Admin โดยอัตโนมัติ — จัดการทุกสาขา/ทุกผู้ใช้
                </div>
              </div>
            </div>
          </div>
        )}
        <SignupForm isFirstUser={isFirstUser} />
      </div>

      <p className="text-center text-sm text-zinc-500 mt-6 animate-fade-up delay-200">
        มีบัญชีอยู่แล้ว?{" "}
        <Link
          href="/login"
          className="font-semibold text-[--color-brand-700] hover:text-[--color-brand-800]"
        >
          เข้าสู่ระบบ →
        </Link>
      </p>
    </div>
  );
}
