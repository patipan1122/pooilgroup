// Cleanliness home (maid) · recent reports + button to add a new one.
import Link from "next/link";
import { requireRole, requireExactRole } from "@/lib/chairops/auth/session";
import { prisma } from "@/lib/prisma";
import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { thaiDateTime } from "@/lib/chairops/utils/format";
import { Sparkles, CircleAlert } from "lucide-react";

export const dynamic = "force-dynamic";

const gradeMap = {
  PASS: { tone: "success" as const, label: "ผ่าน" },
  WARN: { tone: "warning" as const, label: "เฝ้าดู" },
  FAIL: { tone: "danger" as const, label: "ไม่ผ่าน" },
};

export default async function CleanlinessPage() {
  const session = await requireExactRole("MAID");
  const branchId = session.user.primaryBranchId;
  if (!branchId) {
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

  const recent = await prisma.chairopsCleanlinessReport.findMany({
    where: { branchId, byMaidId: session.user.id },
    orderBy: { reportedAt: "desc" },
    take: 10,
    select: {
      id: true,
      reportedAt: true,
      grade: true,
      notes: true,
      photoUrls: true,
    },
  });

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">ความสะอาด</h1>
        <p className="text-sm text-muted-foreground">บันทึกประจำวันของแม่บ้าน</p>
      </header>

      <Link href="/chairops/cleanliness/new" className="block">
        <Button size="xl" className="h-16 w-full text-lg">
          <Sparkles className="mr-2 h-6 w-6" /> บันทึกความสะอาดวันนี้
        </Button>
      </Link>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">
          รายงานล่าสุด ({recent.length})
        </h2>
        {recent.length === 0 ? (
          <Card>
            <CardBody className="p-5 text-center text-sm text-muted-foreground">
              ยังไม่มีรายงาน · กดปุ่มข้างบนเพื่อเริ่มบันทึก
            </CardBody>
          </Card>
        ) : (
          <ul className="space-y-2">
            {recent.map((r) => {
              const g = gradeMap[r.grade];
              return (
                <li key={r.id}>
                  <Card>
                    <CardBody className="flex items-center justify-between gap-3 p-4">
                      <div className="min-w-0">
                        <div className="text-xs text-muted-foreground">
                          {thaiDateTime(r.reportedAt)}
                        </div>
                        {r.notes && (
                          <p className="line-clamp-1 text-sm text-muted-foreground">
                            {r.notes}
                          </p>
                        )}
                        <div className="text-xs text-muted-foreground">
                          {r.photoUrls.length} รูป
                        </div>
                      </div>
                      <Badge tone={g.tone}>{g.label}</Badge>
                    </CardBody>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
