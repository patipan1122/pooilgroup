// Batch deposit — maid picks 1+ pending collection rounds + types actual
// deposited amount + bank fee + attaches one slip. Replaces the old
// per-collection /m/collect/[id]/deposit page.
//
// CEO 2026-05-30: "เก็บวันที่ 1 ยังไม่ฝาก, เก็บวันที่ 2 ยังไม่ฝาก, มาเก็บวันที่ 3
// แล้วฝาก สามารถเลือก 1-2-3 แล้วกดฝากก้อนใหญ่ได้ครับ ประหยัดค่าฝากเงินด้วย".

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireExactRole } from "@/lib/chairops/auth/session";
import { prisma } from "@/lib/prisma";
import { Card, CardBody } from "@/components/ui/card";
import { CircleAlert } from "lucide-react";
import { BatchDepositForm } from "./form";

export const dynamic = "force-dynamic";

export default async function MaidBatchDepositPage() {
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
          <p className="text-amber-700">ติดต่อออฟฟิศก่อนเริ่มบันทึก</p>
        </CardBody>
      </Card>
    );
  }

  const [branch, pending] = await Promise.all([
    prisma.chairopsBranch.findUniqueOrThrow({
      where: { id: branchId },
      select: { name: true },
    }),
    prisma.chairopsCashCollection.findMany({
      where: {
        branchId,
        maidId: session.user.id,
        depositId: null,
      },
      orderBy: { collectedAt: "asc" },
      take: 50,
      select: {
        id: true,
        countedAmount: true,
        collectedAt: true,
        notes: true,
      },
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
        <h1 className="text-xl font-bold text-zinc-900">ฝากเงินก้อน · เลือกรอบ</h1>
        <p className="text-sm text-zinc-500">
          สาขา {branch.name} · เลือกได้หลายรอบ → ฝากครั้งเดียว ประหยัดค่าธรรมเนียม
        </p>
      </header>

      {pending.length === 0 ? (
        <Card className="border-emerald-200 bg-emerald-50">
          <CardBody className="space-y-1 p-4 text-sm text-emerald-800">
            <div className="font-semibold">ไม่มีรอบที่ค้างฝาก ✨</div>
            <p className="text-xs text-emerald-700">
              ทุกรอบที่นับไว้ ฝากเข้าธนาคารแล้วครบ · กลับไปหน้าหลักเพื่อเก็บเงินรอบใหม่
            </p>
          </CardBody>
        </Card>
      ) : (
        <BatchDepositForm
          pendingCollections={pending.map((p) => ({
            id: p.id,
            countedAmount: p.countedAmount,
            collectedAt: p.collectedAt.toISOString(),
            notes: p.notes,
          }))}
        />
      )}
    </div>
  );
}
