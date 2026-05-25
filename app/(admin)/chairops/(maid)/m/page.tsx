// Maid home · today's drift summary + recent collections + big collect CTA.
// W6 §maid-home: KpiTile-style summary (using ChairopsKpiTile primitive) +
// recent collections list (max 5) + sticky CTA "เก็บเงินรอบใหม่".

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireExactRole } from "@/lib/chairops/auth/session";
import { prisma } from "@/lib/prisma";
import { recomputeDriftForBranch } from "@/lib/chairops/reconcile/drift-engine";
import { ChairopsKpiTile } from "@/components/chairops/_kit";
import { Card, CardContent } from "@/components/chairops/ui/card";
import { Badge } from "@/components/chairops/ui/badge";
import { Button } from "@/components/chairops/ui/button";
import { baht, thaiDateTime, thaiRelative } from "@/lib/chairops/utils/format";
import {
  AlertTriangle,
  CircleAlert,
  History,
  Lock,
  Plus,
  Wallet,
} from "lucide-react";

export const dynamic = "force-dynamic";

export default async function MaidHomePage() {
  const session = await requireExactRole("MAID");

  if (!session.user.primaryBranchId) {
    return (
      <Card className="border-amber-200 bg-amber-50">
        <CardContent className="space-y-2 p-5 text-sm">
          <div className="flex items-center gap-2 font-semibold text-amber-800">
            <CircleAlert className="h-5 w-5" />
            ยังไม่ได้ผูกสาขา
          </div>
          <p className="text-amber-700">
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

  const driftTone: "neutral" | "warning" | "danger" =
    drift.status === "shortage"
      ? "danger"
      : drift.status === "surplus" ||
          drift.status === "watch" ||
          drift.status === "missed"
        ? "warning"
        : "neutral";

  const driftLabel: { variant: "danger" | "warning" | "success"; text: string } =
    drift.status === "shortage"
      ? { variant: "danger", text: "เงินขาด" }
      : drift.status === "missed"
        ? { variant: "warning", text: "เก็บล่าช้า" }
        : drift.status === "surplus"
          ? { variant: "warning", text: "เงินเกิน" }
          : drift.status === "watch"
            ? { variant: "warning", text: "เฝ้าดู" }
            : { variant: "success", text: "ปกติ" };

  const driftDirection: "up" | "down" | "flat" =
    drift.driftAmount > 0 ? "up" : drift.driftAmount < 0 ? "down" : "flat";

  return (
    <div className="space-y-4">
      {/* Greeting */}
      <section className="space-y-1">
        <h1 className="text-xl font-bold leading-tight text-zinc-900">
          สวัสดี {session.user.displayName}
        </h1>
        <p className="text-sm text-zinc-500">สาขา {branch.name}</p>
      </section>

      {/* Drift status badge row */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-600">สรุปวันนี้</span>
        <Badge variant={driftLabel.variant}>{driftLabel.text}</Badge>
      </div>

      {/* KPI tiles (2x2 on 360px) */}
      <div className="grid grid-cols-2 gap-3">
        <ChairopsKpiTile
          label="ยอด POS รวม"
          value={baht(drift.posTotal)}
          tone="neutral"
          icon={<Wallet className="size-4" aria-hidden />}
        />
        <ChairopsKpiTile
          label="ฝากแล้ว"
          value={baht(drift.depositTotal)}
          tone="success"
          icon={<History className="size-4" aria-hidden />}
        />
        <ChairopsKpiTile
          label="ผลต่างสะสม"
          value={baht(drift.driftAmount, true)}
          tone={driftTone}
          delta={
            drift.driftAmount === 0
              ? "ตรงเป๊ะ"
              : drift.driftAmount > 0
                ? "ขาด"
                : "เกิน"
          }
          deltaDirection={driftDirection}
          icon={<AlertTriangle className="size-4" aria-hidden />}
          className="col-span-2"
        />
      </div>

      {/* Last submitted hint */}
      <div className="rounded-lg border border-zinc-200 bg-white p-3 text-xs text-zinc-600">
        เก็บล่าสุด:{" "}
        <span className="font-medium text-zinc-900">
          {drift.lastCollectionAt
            ? thaiRelative(drift.lastCollectionAt)
            : "ยังไม่เคย"}
        </span>
      </div>

      {/* Primary CTA · sticky-feel via h-14 mt-2 mb-4 */}
      <Link href="/chairops/m/collect/new" className="block">
        <Button
          size="xl"
          className="h-14 w-full text-base font-semibold"
          aria-label="บันทึกการเก็บเงินรอบใหม่"
        >
          <Plus className="mr-2 h-5 w-5" aria-hidden />
          เก็บเงินรอบใหม่
        </Button>
      </Link>

      {/* Recent collections */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-zinc-700">
          รายการล่าสุด ({recent.length})
        </h2>
        {recent.length === 0 ? (
          <Card>
            <CardContent className="p-5 text-center text-sm text-zinc-500">
              ยังไม่มีรายการ · กดปุ่มข้างบนเพื่อเริ่มบันทึก
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-2">
            {recent.map((r) => {
              const diff = r.countedAmount - r.depositedAmount;
              const lockUntil = new Date(
                r.createdAt.getTime() + 30 * 60_000,
              );
              const isLocked = !r.unlockedAt && new Date() < lockUntil;
              return (
                <li key={r.id}>
                  <Link
                    href={`/chairops/m/collect/${r.id}`}
                    className="block"
                  >
                    <Card className="transition-colors active:bg-zinc-100">
                      <CardContent className="flex items-center justify-between gap-3 p-4">
                        <div className="min-w-0">
                          <div className="text-xs text-zinc-500">
                            {thaiDateTime(r.collectedAt)}
                          </div>
                          <div className="font-semibold tabular-nums text-zinc-900">
                            ฝาก {baht(r.depositedAmount)}
                          </div>
                          {diff !== 0 && (
                            <div className="text-xs text-zinc-500">
                              นับ {baht(r.countedAmount)} · ต่าง {baht(diff, true)}
                            </div>
                          )}
                        </div>
                        {isLocked && (
                          <Badge variant="secondary" className="gap-1">
                            <Lock className="h-3 w-3" aria-hidden /> ล็อค
                          </Badge>
                        )}
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
