// Maid mobile damage landing · /chairops/m/damage.
// Was a bare redirect to the desktop form; now the "ตรวจของเสีย" hub the home
// card + bottom-nav point at: open tickets for this branch + report-new CTA.
import Link from "next/link";
import { requireExactRole } from "@/lib/chairops/auth/session";
import { prisma } from "@/lib/prisma";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { thaiRelative } from "@/lib/chairops/utils/format";
import { CircleAlert, Plus, Wrench } from "lucide-react";

export const dynamic = "force-dynamic";

const OPEN_STATUSES = ["OPEN", "ASSIGNED", "IN_PROGRESS", "WAITING_PARTS"] as const;

const STATUS_LABEL: Record<string, { text: string; tone: "warning" | "neutral" | "danger" }> = {
  OPEN: { text: "รอช่าง", tone: "warning" },
  ASSIGNED: { text: "มอบหมายแล้ว", tone: "neutral" },
  IN_PROGRESS: { text: "กำลังซ่อม", tone: "neutral" },
  WAITING_PARTS: { text: "รออะไหล่", tone: "warning" },
};

export default async function MaidDamageLandingPage() {
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
          <p className="text-amber-700">ติดต่อออฟฟิศก่อนแจ้งซ่อม</p>
        </CardBody>
      </Card>
    );
  }

  const tickets = await prisma.chairopsDamageTicket.findMany({
    where: {
      branchId,
      orgId: session.user.orgId,
      status: { in: [...OPEN_STATUSES] },
    },
    orderBy: { openedAt: "desc" },
    take: 20,
    select: {
      id: true,
      ticketCode: true,
      category: true,
      priority: true,
      status: true,
      openedAt: true,
      chair: { select: { chairCode: true } },
    },
  });

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-bold text-zinc-900">🔧 แจ้งซ่อม</h1>
        <p className="text-sm text-zinc-500">
          {tickets.length === 0
            ? "ไม่มีรายการซ่อมค้าง"
            : `${tickets.length} รายการกำลังดำเนินการ`}
        </p>
      </header>

      <Link
        href="/chairops/m/damage/new"
        className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 text-base font-semibold text-white transition-colors active:bg-emerald-700"
      >
        <Plus className="size-5" aria-hidden /> แจ้งซ่อมใหม่
      </Link>

      {tickets.length === 0 ? (
        <Card>
          <CardBody className="flex flex-col items-center gap-2 p-8 text-center text-sm text-zinc-500">
            <Wrench className="size-8 text-zinc-300" aria-hidden />
            ไม่มีเก้าอี้ที่รอซ่อมในสาขานี้
          </CardBody>
        </Card>
      ) : (
        <ul className="space-y-2">
          {tickets.map((t) => {
            const label = STATUS_LABEL[t.status] ?? { text: t.status, tone: "neutral" as const };
            return (
              <li key={t.id}>
                <Card>
                  <CardBody className="flex items-center gap-3 p-3.5">
                    <div className="min-w-0 grow space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-semibold text-zinc-900">
                          {t.ticketCode}
                        </span>
                        {t.priority === "URGENT" && (
                          <Badge tone="danger">ด่วน</Badge>
                        )}
                      </div>
                      <div className="truncate text-sm text-zinc-700">
                        {t.chair?.chairCode ? `${t.chair.chairCode} · ` : ""}
                        {t.category}
                      </div>
                      <div className="text-xs text-zinc-400">
                        แจ้งเมื่อ {thaiRelative(t.openedAt)}
                      </div>
                    </div>
                    <Badge tone={label.tone} className="shrink-0">
                      {label.text}
                    </Badge>
                  </CardBody>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
