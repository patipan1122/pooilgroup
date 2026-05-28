// Maid mobile parts request · /chairops/m/parts/new (mockup Phone "PartsForm").
// Loads the org's spare-part catalog (for typeahead) → renders client form that
// calls requestPartFromMaid (creates a PENDING ChairopsSparePartMovement).
import { requireExactRole } from "@/lib/chairops/auth/session";
import { prisma } from "@/lib/prisma";
import { Card, CardBody } from "@/components/ui/card";
import { ChevronLeft, CircleAlert } from "lucide-react";
import Link from "next/link";
import { MaidPartsForm } from "./form";

export const dynamic = "force-dynamic";

export default async function MaidPartsNewPage() {
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
          <p className="text-amber-700">ติดต่อออฟฟิศก่อนเบิกของ</p>
        </CardBody>
      </Card>
    );
  }

  const [branch, parts] = await Promise.all([
    prisma.chairopsBranch.findUniqueOrThrow({
      where: { id: branchId },
      select: { name: true },
    }),
    prisma.chairopsSparePart.findMany({
      where: { orgId: session.user.orgId },
      orderBy: { name: "asc" },
      take: 300,
      select: { id: true, partCode: true, name: true, unit: true },
    }),
  ]);

  return (
    <div className="space-y-4">
      <Link
        href="/chairops/m"
        className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-zinc-600 hover:text-zinc-900"
      >
        <ChevronLeft className="h-5 w-5" aria-hidden /> กลับหน้าหลัก
      </Link>
      <header className="space-y-1">
        <h1 className="text-xl font-bold text-zinc-900">📦 เบิกของจากคลัง</h1>
        <p className="text-sm text-zinc-500">สาขา {branch.name}</p>
      </header>

      <MaidPartsForm parts={parts} />
    </div>
  );
}
