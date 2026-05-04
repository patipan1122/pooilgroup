import Link from "next/link";
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
      <div className="mb-8 text-center">
        <div className="inline-flex items-center justify-center size-14 rounded-2xl bg-[--color-brand-600] text-white mb-4 shadow-lg">
          <span className="text-2xl font-bold font-display">P</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 font-display">
          {isFirstUser ? "ตั้งค่า Owner" : "สมัครสมาชิก"}
        </h1>
        <p className="text-sm text-zinc-500 mt-1">
          {isFirstUser
            ? "บัญชีแรก = Super Admin ของ Pool Group"
            : "Admin จะกำหนดสาขาให้คุณหลังสร้างบัญชี"}
        </p>
      </div>
      <div className="bg-white rounded-2xl border border-zinc-200 shadow-soft p-6 sm:p-8">
        {isFirstUser && (
          <div className="mb-5 rounded-xl bg-[--color-brand-50] border border-[--color-brand-200] px-4 py-3 text-sm">
            <div className="font-medium text-[--color-brand-800] mb-0.5">
              👑 บัญชีแรกในระบบ
            </div>
            <div className="text-[--color-brand-700] text-xs">
              คุณจะได้สิทธิ์ Super Admin โดยอัตโนมัติ —
              จัดการทุกสาขา/ทุกผู้ใช้
            </div>
          </div>
        )}
        <SignupForm isFirstUser={isFirstUser} />
      </div>
      <p className="text-center text-sm text-zinc-500 mt-6">
        มีบัญชีอยู่แล้ว?{" "}
        <Link
          href="/login"
          className="font-medium text-[--color-brand-700] hover:underline"
        >
          เข้าสู่ระบบ
        </Link>
      </p>
    </div>
  );
}
