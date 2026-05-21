// Maid home — greeting · today's drift · big "บันทึกการเก็บเงิน" CTA · recent collections
import Link from "next/link";
import { requireRole, requireExactRole } from "@/lib/chairops/auth/session";
import { prisma } from "@/lib/prisma";
import { Card, CardContent } from "@/components/chairops/ui/card";
import { Button } from "@/components/chairops/ui/button";
import { Badge } from "@/components/chairops/ui/badge";
import { baht, thaiDateTime, thaiRelative } from "@/lib/chairops/utils/format";
import { recomputeDriftForBranch } from "@/lib/chairops/reconcile/drift-engine";
import { Wallet, CircleAlert } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function CollectHomePage() {
  const session = await requireExactRole("MAID");

  if (!session.user.primaryBranchId) {
    return (
      <Card className="border-warning/40 bg-warning/5">
        <CardContent className="space-y-2 p-5 text-sm">
          <div className="flex items-center gap-2 font-semibold">
            <CircleAlert className="h-5 w-5 text-warning" />
            ยังไม่ได้ผูกสาขา
          </div>
          <p className="text-muted-foreground">
            บัญชีของคุณยังไม่ได้กำหนดสาขา · กรุณาติดต่อออฟฟิศก่อนเริ่มใช้งาน
          </p>
        </CardContent>
      </Card>
    );
  }

  const branchId = session.user.primaryBranchId;

  const [branch, drift, recent] = await Promise.all([
    prisma.chairopsBranch.findUniqueOrThrow({
      where: { id: branchId },
      select: { name: true, slug: true },
    }),
    recomputeDriftForBranch(branchId),
    prisma.chairopsCashCollection.findMany({
      where: { branchId, maidId: session.user.id },
      orderBy: { collectedAt: "desc" },
      take: 5,
      select: {
        id: true,
        collectedAt: true,
        createdAt: true,
        countedAmount: true,
        depositedAmount: true,
        lockedAt: true,
        unlockedAt: true,
      },
    }),
  ]);

  const driftLabel =
    drift.status === "shortage"
      ? { variant: "danger" as const, text: "เงินขาด" }
      : drift.status === "missed"
        ? { variant: "warning" as const, text: "เก็บล่าช้า" }
        : drift.status === "surplus"
          ? { variant: "warning" as const, text: "เงินเกิน" }
          : drift.status === "watch"
            ? { variant: "warning" as const, text: "เฝ้าดู" }
            : { variant: "success" as const, text: "ปกติ" };

  return (
    <div className="space-y-4">
      <section className="space-y-1">
        <h1 className="text-2xl font-bold leading-tight">
          สวัสดี {session.user.displayName}
        </h1>
        <p className="text-sm text-muted-foreground">สาขา {branch.name}</p>
      </section>

      <Card>
        <CardContent className="space-y-3 p-5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-muted-foreground">สรุปวันนี้</span>
            <Badge variant={driftLabel.variant}>{driftLabel.text}</Badge>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-muted-foreground">ยอด POS รวม</div>
              <div className="text-lg font-semibold tabular-nums">
                {baht(drift.posTotal)}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">ฝากแล้ว</div>
              <div className="text-lg font-semibold tabular-nums">
                {baht(drift.depositTotal)}
              </div>
            </div>
            <div className="col-span-2 border-t border-border pt-3">
              <div className="text-muted-foreground">ผลต่างสะสม</div>
              <div
                className={
                  "text-2xl font-bold tabular-nums " +
                  (drift.driftAmount > 0
                    ? "text-danger"
                    : drift.driftAmount < 0
                      ? "text-warning"
                      : "text-success")
                }
              >
                {baht(drift.driftAmount, true)}
              </div>
            </div>
          </div>
          <div className="border-t border-border pt-3 text-xs text-muted-foreground">
            เก็บล่าสุด:{" "}
            <span className="font-medium text-foreground">
              {drift.lastCollectionAt ? thaiRelative(drift.lastCollectionAt) : "ยังไม่เคย"}
            </span>
          </div>
        </CardContent>
      </Card>

      <Link href="/chairops/collect/new" className="block">
        <Button size="xl" className="h-16 w-full text-lg">
          <Wallet className="mr-2 h-6 w-6" aria-hidden />
          บันทึกการเก็บเงิน
        </Button>
      </Link>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">
          รายการล่าสุด ({recent.length})
        </h2>
        {recent.length === 0 ? (
          <Card>
            <CardContent className="p-5 text-center text-sm text-muted-foreground">
              ยังไม่มีรายการ · กดปุ่มข้างบนเพื่อเริ่มบันทึก
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-2">
            {recent.map((r) => {
              const diff = r.countedAmount - r.depositedAmount;
              const lockUntil = new Date(r.createdAt.getTime() + 30 * 60_000);
              // B-001 fix: locked WHILE within window
              const isLocked = !r.unlockedAt && new Date() < lockUntil;
              return (
                <li key={r.id}>
                  <Link href={`/chairops/collect/${r.id}`} className="block">
                    <Card className="transition-colors active:bg-muted/50">
                      <CardContent className="flex items-center justify-between gap-3 p-4">
                        <div className="min-w-0">
                          <div className="text-xs text-muted-foreground">
                            {thaiDateTime(r.collectedAt)}
                          </div>
                          <div className="font-semibold tabular-nums">
                            ฝาก {baht(r.depositedAmount)}
                          </div>
                          {diff !== 0 && (
                            <div className="text-xs text-muted-foreground">
                              นับ {baht(r.countedAmount)} · ต่าง {baht(diff, true)}
                            </div>
                          )}
                        </div>
                        {isLocked && <Badge variant="secondary">ล็อค</Badge>}
                      </CardContent>
                    </Card>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
