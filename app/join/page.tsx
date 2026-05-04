// Public — anyone can self-register a request to join Pooilgroup.
// Admin reviews at /admin/users/requests.

import Link from "next/link";
import { adminClient } from "@/lib/db/server";
import { JoinForm } from "./join-form";

export const dynamic = "force-dynamic";

const POOL_GROUP_ORG_ID = "00000000-0000-0000-0000-000000000001";

export default async function JoinPage() {
  const admin = adminClient();

  const { data: branches } = await admin
    .from("branches")
    .select("id, code, name, business_type")
    .eq("org_id", POOL_GROUP_ORG_ID)
    .eq("is_active", true)
    .order("code");

  return (
    <div className="min-h-screen flex flex-col bg-zinc-50 bg-grid-dots/30">
      <main className="flex-1 flex items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-lg animate-fade-up">
          <div className="text-center mb-8">
            <div className="size-14 rounded-2xl bg-[--color-brand-600] text-white flex items-center justify-center font-bold font-display text-2xl shadow-blue mx-auto mb-4">
              P
            </div>
            <p className="text-xs uppercase tracking-[0.18em] text-[--color-brand-600] font-bold">
              Pooilgroup · Join us
            </p>
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight font-display mt-2">
              ขอเข้า <span className="accent">ใช้งานระบบ</span>
            </h1>
            <p className="text-zinc-600 mt-3 max-w-md mx-auto">
              กรอกข้อมูลด้านล่าง · Admin จะอนุมัติและส่งลิงก์ตั้ง password ให้ใน LINE
            </p>
          </div>

          <JoinForm branches={branches ?? []} />

          <p className="text-center text-xs text-zinc-400 mt-6">
            มีบัญชีอยู่แล้ว?{" "}
            <Link href="/login" className="text-[--color-brand-700] hover:underline">
              เข้าสู่ระบบที่นี่
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
