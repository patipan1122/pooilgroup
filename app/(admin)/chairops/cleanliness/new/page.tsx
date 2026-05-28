// Cleanliness report shell · Server Component.
import { requireRole, requireExactRole } from "@/lib/chairops/auth/session";
import { prisma } from "@/lib/prisma";
import { Card, CardBody } from "@/components/ui/card";
import { CircleAlert } from "lucide-react";
import { CleanlinessNewForm } from "./form";

export const dynamic = "force-dynamic";

export default async function CleanlinessNewPage() {
  const session = await requireExactRole("MAID");
  if (!session.user.primaryBranchId) {
    return (
      <Card className="border-warning/40 bg-warning/5">
        <CardBody className="space-y-2 p-5 text-sm">
          <div className="flex items-center gap-2 font-semibold">
            <CircleAlert className="h-5 w-5 text-warning" /> ยังไม่ได้ผูกสาขา
          </div>
          <p className="text-muted-foreground">ติดต่อออฟฟิศก่อนเริ่มบันทึก</p>
        </CardBody>
      </Card>
    );
  }

  const branch = await prisma.chairopsBranch.findUniqueOrThrow({
    where: { id: session.user.primaryBranchId },
    select: { name: true },
  });

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">บันทึกความสะอาด</h1>
        <p className="text-sm text-muted-foreground">สาขา {branch.name}</p>
      </header>

      <CleanlinessNewForm />
    </div>
  );
}
