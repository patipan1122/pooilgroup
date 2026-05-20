// /recruit/tasks — Follow-up Task List
// CEO Q4: "อาจจะมีระบบ คนมาทำงานต่อว่าสัมภาษณ์หรืออะไร"
// แสดงทุก application ที่ status รออยู่นาน · sort by urgency

import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { requireRecruitAccess } from "@/lib/recruit/role-guard";
import { prisma } from "@/lib/prisma";
import { Section } from "@/components/ui/section";
import { Badge } from "@/components/ui/badge";
import {
  FOLLOWUP_STATUSES,
  STATUS_LABELS,
  STATUS_TONE,
  type ApplicationStatus,
} from "@/lib/recruit/types";
import { ListChecks, Clock } from "lucide-react";

export const dynamic = "force-dynamic";

// Threshold in days before flagging as "ค้างนาน"
const SLA_DAYS: Partial<Record<ApplicationStatus, number>> = {
  NEW: 3,
  SCREENING: 5,
  INTERVIEW: 7,
  OFFERED: 5,
};

export default async function TasksPage() {
  const session = await requireSession();
  requireRecruitAccess(session.user.role);

  const apps = await prisma.recruitApplication.findMany({
    where: {
      orgId: session.user.org_id,
      draft: false,
      status: { in: FOLLOWUP_STATUSES },
    },
    orderBy: { updatedAt: "asc" }, // oldest first = most urgent
    include: {
      applicant: { select: { fullName: true, phone: true } },
      posting: { select: { title: true } },
    },
    take: 200,
  });

  const now = Date.now();

  // Sort: most overdue first, then by status priority
  const tasks = apps
    .map((a) => {
      const days = Math.floor((now - a.updatedAt.getTime()) / 86400000);
      const sla = SLA_DAYS[a.status as ApplicationStatus] ?? 7;
      const overdue = days - sla;
      return { ...a, days, overdue };
    })
    .sort((a, b) => b.overdue - a.overdue);

  const overdue = tasks.filter((t) => t.overdue > 0);
  const upcoming = tasks.filter((t) => t.overdue <= 0);

  return (
    <div className="p-5 sm:p-8 max-w-4xl mx-auto">
      <Section
        number="✓"
        label="งานต้องตาม"
        title="ใบสมัครที่ค้างอยู่ในกระบวนการ"
        description="ทุกใบที่ status รออยู่ · ใบที่ค้างนานเกิน SLA จะอยู่ด้านบน"
      >
        {tasks.length === 0 ? (
          <div className="rounded-3xl border-2 border-dashed border-zinc-200 bg-white p-12 text-center">
            <ListChecks className="size-12 mx-auto text-zinc-300" />
            <p className="mt-4 font-bold text-zinc-900">ไม่มีงานค้าง</p>
            <p className="text-sm text-zinc-500 mt-1">
              ใบสมัครทุกใบอยู่ใน status สุดท้าย หรือยังไม่มี
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {overdue.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-[0.18em] font-bold text-red-600 mb-3">
                  ⚠ เกิน SLA ({overdue.length})
                </p>
                <div className="space-y-2">
                  {overdue.map((t) => (
                    <TaskRow key={t.id} task={t} />
                  ))}
                </div>
              </div>
            )}
            {upcoming.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-[0.18em] font-bold text-zinc-500 mb-3">
                  ภายใน SLA ({upcoming.length})
                </p>
                <div className="space-y-2">
                  {upcoming.map((t) => (
                    <TaskRow key={t.id} task={t} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}

type Task = {
  id: string;
  refId: string;
  applicant: { fullName: string; phone: string };
  posting: { title: string };
  status: string;
  days: number;
  overdue: number;
};

function TaskRow({ task }: { task: Task }) {
  const isOverdue = task.overdue > 0;
  return (
    <Link
      href={`/recruit/applications/${task.id}`}
      className={`flex items-center justify-between gap-3 rounded-2xl border-2 bg-white p-4 hover:border-[var(--color-brand-400)] transition-colors ${
        isOverdue ? "border-red-200" : "border-zinc-200"
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-bold text-zinc-900 text-sm">
            {task.applicant.fullName}
          </p>
          <Badge tone={STATUS_TONE[task.status as ApplicationStatus]}>
            {STATUS_LABELS[task.status as ApplicationStatus]}
          </Badge>
        </div>
        <p className="text-xs text-zinc-500 mt-0.5">
          {task.posting.title} · {task.applicant.phone}
        </p>
      </div>
      <div className="text-right shrink-0">
        <div className="flex items-center justify-end gap-1 text-xs">
          <Clock
            className={`size-3 ${isOverdue ? "text-red-500" : "text-zinc-400"}`}
          />
          <span
            className={`font-bold tabular-num ${
              isOverdue ? "text-red-600" : "text-zinc-600"
            }`}
          >
            {task.days} วัน
          </span>
        </div>
        {isOverdue && (
          <p className="text-[10px] text-red-500 mt-0.5">
            เกิน SLA {task.overdue} วัน
          </p>
        )}
      </div>
    </Link>
  );
}
