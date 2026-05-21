// Damage report shell · Server Component.
// Loads chair list (filtered to maid's branch) and passes it to the client form.
import { requireRole, requireExactRole } from "@/lib/chairops/auth/session";
import { prisma } from "@/lib/prisma";
import { Card, CardContent } from "@/components/chairops/ui/card";
import { CircleAlert } from "lucide-react";
import { DamageNewForm } from "./form";

export const dynamic = "force-dynamic";

export default async function DamageNewPage() {
  const session = await requireExactRole("MAID");
  if (!session.user.primaryBranchId) {
    return (
      <Card className="border-warning/40 bg-warning/5">
        <CardContent className="space-y-2 p-5 text-sm">
          <div className="flex items-center gap-2 font-semibold">
            <CircleAlert className="h-5 w-5 text-warning" /> ยังไม่ได้ผูกสาขา
          </div>
          <p className="text-muted-foreground">ติดต่อออฟฟิศก่อนเริ่มแจ้งซ่อม</p>
        </CardContent>
      </Card>
    );
  }

  const [branch, chairs] = await Promise.all([
    prisma.chairopsBranch.findUniqueOrThrow({
      where: { id: session.user.primaryBranchId },
      select: { name: true },
    }),
    prisma.chairopsChair.findMany({
      where: { branchId: session.user.primaryBranchId, isActive: true },
      orderBy: { chairCode: "asc" },
      select: { id: true, chairCode: true, generation: true },
    }),
  ]);

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">แจ้งซ่อม</h1>
        <p className="text-sm text-muted-foreground">สาขา {branch.name}</p>
      </header>

      <DamageNewForm chairs={chairs} />
    </div>
  );
}
