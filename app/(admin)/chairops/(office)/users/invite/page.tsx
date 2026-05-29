// Admin "เชิญแม่บ้าน (ลิงก์)" — one-tap LINE onboarding.
// Name + branch → signed invite link → send to maid → they LINE-login → bound.
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireRole } from "@/lib/chairops/auth/session";
import { prisma } from "@/lib/prisma";
import { InviteMaidForm } from "./invite-form";

export const dynamic = "force-dynamic";

export default async function InviteMaidPage() {
  const session = await requireRole("ADMIN");
  const branches = await prisma.chairopsBranch.findMany({
    where: { isActive: true, orgId: session.user.orgId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="mx-auto max-w-xl space-y-5 p-1">
      <Link
        href="/chairops/users"
        className="inline-flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-900"
      >
        <ArrowLeft className="size-3.5" aria-hidden /> กลับรายการผู้ใช้
      </Link>
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
          เชิญแม่บ้าน (ลิงก์ LINE)
        </h1>
        <p className="text-sm text-zinc-600">
          กรอกชื่อ + เลือกสาขา → ได้ลิงก์ → ส่งให้แม่บ้านทาง LINE → เขากดเปิดแล้ว
          ล็อกอิน LINE ในตัว เข้าใช้งานได้เลย (ไม่ต้องใส่อีเมล/รหัส)
        </p>
      </header>

      <InviteMaidForm branches={branches} />
    </div>
  );
}
