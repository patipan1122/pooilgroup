import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function ClawfleetIndexPage() {
  const session = await requireSession();
  // ตู้คีบ OS (redesign 2026-06-28) — UI ใหม่อยู่ใต้ /clawfleet/os
  // พนักงานเก็บเงิน → แอปหน้าบ้าน (มือถือ) · ผู้บริหาร/หัวหน้า → ภาพรวม
  if (session.user.role === "staff") {
    redirect("/clawfleet/os/app");
  }
  redirect("/clawfleet/os/dashboard");
}
