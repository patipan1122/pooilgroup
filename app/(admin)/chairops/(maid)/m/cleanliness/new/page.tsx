// Maid mobile cleanliness checklist · /chairops/m/cleanliness/new (mockup Phone CleanForm).
// 10-item checklist (folds onto existing 6 server keys) + 1-tap "ทุกข้อปกติ" +
// photo proof. Submits to existing `createCleanlinessReport` action.
import { requireExactRole } from "@/lib/chairops/auth/session";
import { prisma } from "@/lib/prisma";
import { Card, CardBody } from "@/components/ui/card";
import { ChevronLeft, CircleAlert } from "lucide-react";
import Link from "next/link";
import { MaidCleanlinessForm } from "./form";

export const dynamic = "force-dynamic";

export default async function MaidCleanlinessNewPage() {
  const session = await requireExactRole("MAID");
  const branchId = session.user.primaryBranchId;
  if (!branchId) {
    return (
      <Card className="border-amber-200 bg-amber-50">
        <CardBody className="space-y-2 p-5 text-sm">
          <div className="flex items-center gap-2 font-semibold text-amber-800">
            <CircleAlert className="h-5 w-5" />
            ยังไม่ได้ผูกสาขา
          </div>
          <p className="text-amber-700">ติดต่อออฟฟิศก่อนเริ่มเช็คคลีน</p>
        </CardBody>
      </Card>
    );
  }

  const branch = await prisma.chairopsBranch.findUniqueOrThrow({
    where: { id: branchId },
    select: { name: true },
  });

  return (
    <div className="space-y-4">
      <Link
        href="/chairops/m"
        className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-zinc-600 hover:text-zinc-900"
      >
        <ChevronLeft className="h-5 w-5" aria-hidden /> กลับหน้าหลัก
      </Link>
      <header className="space-y-1">
        <h1 className="text-xl font-bold text-zinc-900">🧹 Checklist ความสะอาด</h1>
        <p className="text-sm text-zinc-500">10 ข้อ · สาขา {branch.name}</p>
      </header>

      <MaidCleanlinessForm />
    </div>
  );
}
