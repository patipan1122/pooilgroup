// Public — anyone can self-register a request to join Pooilgroup.
// Admin reviews at /admin/users/requests.

import Link from "next/link";
import { adminClient } from "@/lib/db/server";
import { JoinForm } from "./join-form";

export const dynamic = "force-dynamic";

const POOILGROUP_ORG_ID = "00000000-0000-0000-0000-000000000001";

export default async function JoinPage() {
  const admin = adminClient();

  const { data: branches } = await admin
    .from("branches")
    .select("id, code, name, business_type")
    .eq("org_id", POOILGROUP_ORG_ID)
    .eq("is_active", true)
    .order("code");

  return (
    <div className="min-h-screen flex flex-col bg-white relative overflow-hidden">
      {/* Background — radial blue glow + dot grid */}
      <div className="absolute inset-0 -z-10 pointer-events-none">
        <div
          className="absolute -top-40 left-1/2 -translate-x-1/2 w-225 h-150 rounded-full opacity-25 blur-3xl animate-drift"
          style={{
            background:
              "radial-gradient(circle, oklch(0.50 0.28 263) 0%, transparent 65%)",
          }}
        />
        <div className="absolute inset-0 bg-grid-dots opacity-40" />
      </div>

      <main className="flex-1 flex items-center justify-center p-4 sm:p-8 py-12">
        <div className="w-full max-w-lg">
          {/* Hero */}
          <div className="text-center mb-10 animate-slide-up-soft">
            <div className="size-16 rounded-2xl bg-[var(--color-brand-600)] text-white flex items-center justify-center font-bold font-display text-2xl shadow-blue glow-blue mx-auto mb-6">
              P
            </div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--color-brand-700)] font-bold mb-3">
              <span className="brand-gradient-text">Pooilgroup</span>{" "}
              · JOIN US
            </p>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-[-0.04em] font-display leading-[1.05] text-zinc-900">
              ขอเข้า <span className="text-gradient-blue">ใช้งาน</span>
            </h1>
            <p className="text-sm sm:text-base text-zinc-600 mt-4 max-w-md mx-auto leading-relaxed">
              กรอกข้อมูลด้านล่าง · Admin จะอนุมัติภายใน 1-2 วันทำการ และส่งลิงก์ตั้ง password ให้ใน LINE/SMS
            </p>
          </div>

          <div className="animate-fade-up delay-100">
            <JoinForm branches={branches ?? []} />
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
      </main>
    </div>
  );
}
