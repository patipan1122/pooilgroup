import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function RootPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  if (session.user.role === "staff" || session.user.role === "driver") {
    // พนักงานที่ผูกกับสาขา "ตู้คีบ" → แอปเก็บเงิน ClawOS (บันทึกเข้า cfCollectionEvent +
    // ระบบกระทบยอด/กันโกงของตู้คีบ). พนักงานอื่น → ฟอร์มรายงาน CashHub (/liff/status).
    // แยกด้วย business_type ของสาขาที่ผูก เพื่อไม่ให้เงินตู้คีบหลงไปคนละตาราง.
    const ubs = await prisma.userBranch.findMany({
      where: { userId: session.user.id, isActive: true },
      select: { branchId: true },
    });
    if (ubs.length > 0) {
      const clawBranch = await prisma.branch.findFirst({
        where: {
          id: { in: ubs.map((u) => u.branchId) },
          orgId: session.user.org_id,
          businessType: "claw_machine",
          isActive: true,
        },
        select: { id: true },
      });
      if (clawBranch) redirect("/clawfleet/os/app");
    }
    redirect("/liff/status");
  }
  redirect("/home");
}
