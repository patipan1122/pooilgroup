// /recruit/tasks — งานต้องตาม (HR follow-up queue)
// Redesigned per Recruit Redesign canvas principle:
// - KPI strip · grouped by urgency · quick-action contact buttons
// - Pulls in scheduled interviews too (recruit_interviews)
// - Each row = one HR task with clear "next action" hint

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
import {
  ListChecks,
  Clock,
  Phone,
  MessageCircle,
  CalendarCheck,
  AlertTriangle,
  ChevronRight,
} from "lucide-react";

export const dynamic = "force-dynamic";

// Threshold in days before flagging as "ค้างนาน"
const SLA_DAYS: Partial<Record<ApplicationStatus, number>> = {
  NEW: 3,
  SCREENING: 5,
  INTERVIEW: 7,
  OFFERED: 5,
};

const NEXT_ACTION: Partial<Record<ApplicationStatus, string>> = {
  NEW: "อ่านโปรไฟล์ + ตัดสิน → คัดผ่าน/ไม่ผ่าน",
  SCREENING: "โทร/ส่ง LINE สอบถามเพิ่ม → นัดสัมภาษณ์",
  INTERVIEW: "นัดสัมภาษณ์/ทำสัมภาษณ์ → ตัดสิน",
  OFFERED: "ส่ง offer letter → รอตอบรับ",
};

export default async function TasksPage() {
  const session = await requireSession();
  requireRecruitAccess(session.user.role);

  const [apps, todayInterviews] = await Promise.all([
    prisma.recruitApplication.findMany({
      where: {
        orgId: session.user.org_id,
        draft: false,
        status: { in: FOLLOWUP_STATUSES },
      },
      orderBy: { updatedAt: "asc" },
      include: {
        applicant: { select: { fullName: true, phone: true, email: true } },
        posting: { select: { title: true } },
      },
      take: 200,
    }),
    prisma.recruitInterview.findMany({
      where: {
        orgId: session.user.org_id,
        scheduledAt: {
          gte: new Date(new Date().setHours(0, 0, 0, 0)),
          lt: new Date(new Date().setHours(23, 59, 59, 999)),
        },
        status: { in: ["SCHEDULED", "CONFIRMED"] },
      },
      include: {
        application: {
          select: {
            id: true,
            applicant: { select: { fullName: true, phone: true } },
            posting: { select: { title: true } },
          },
        },
      },
      orderBy: { scheduledAt: "asc" },
    }),
  ]);

  const now = Date.now();

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

  // KPI by status
  const counts = {
    new: tasks.filter((t) => t.status === "NEW").length,
    screening: tasks.filter((t) => t.status === "SCREENING").length,
    interview: tasks.filter((t) => t.status === "INTERVIEW").length,
    offered: tasks.filter((t) => t.status === "OFFERED").length,
  };

  return (
    <div className="p-5 sm:p-8 max-w-[1600px] mx-auto">
      <Section
        number="02"
        label="Tasks"
        title="งานต้องตาม"
        description="ใบสมัครที่ค้างอยู่ในกระบวนการ + นัดสัมภาษณ์วันนี้ · เรียงจากเร่งด่วนก่อน"
      >
        {/* KPI strip */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
          <KpiCard label="ค้างเกินกำหนด" value={overdue.length} accent="danger" />
          <KpiCard label="ใหม่รออ่าน" value={counts.new} accent="brand" />
          <KpiCard label="คัดกรอง" value={counts.screening} accent="warning" />
          <KpiCard label="สัมภาษณ์" value={counts.interview} accent="orange" />
          <KpiCard label="เสนอแล้ว" value={counts.offered} accent="purple" />
        </div>

        {/* Today's interviews block */}
        {todayInterviews.length > 0 && (
          <div className="rounded-2xl bg-gradient-to-br from-orange-50 to-white border border-orange-200 p-4 mb-6">
            <div className="flex items-center gap-2 mb-3">
              <CalendarCheck className="size-5 text-orange-700" />
              <p className="font-bold text-orange-900">
                สัมภาษณ์วันนี้ · {todayInterviews.length} คน
              </p>
            </div>
            <div className="space-y-2">
              {todayInterviews.map((iv) => (
                <Link
                  key={iv.id}
                  href={`/recruit/applications/${iv.application.id}`}
                  className="flex items-center gap-3 p-3 rounded-xl bg-white hover:bg-orange-50/30 transition-colors group border border-orange-100"
                >
                  <div className="text-center w-16 shrink-0">
                    <p className="text-lg font-extrabold font-display text-orange-700 leading-none">
                      {new Date(iv.scheduledAt).toLocaleTimeString("th-TH", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                    <p className="text-[10px] text-zinc-500 mt-1">
                      {iv.kind === "ONSITE"
                        ? "📍 สถานที่"
                        : iv.kind === "PHONE"
                          ? "📞 โทร"
                          : "💻 วิดีโอ"}
                    </p>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-zinc-900">
                      {iv.application.applicant.fullName}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {iv.application.posting.title}
                      {iv.location && ` · ${iv.location}`}
                    </p>
                  </div>
                  <ChevronRight className="size-4 text-zinc-300 group-hover:text-orange-500" />
                </Link>
              ))}
            </div>
          </div>
        )}

        {tasks.length === 0 ? (
          <div className="rounded-3xl border-2 border-dashed border-zinc-200 bg-white p-12 text-center">
            <ListChecks className="size-12 mx-auto text-zinc-300" />
            <p className="mt-4 font-bold text-zinc-900">ไม่มีงานค้าง 🎉</p>
            <p className="text-sm text-zinc-500 mt-1">
              ใบสมัครทุกใบอยู่ใน status สุดท้าย หรือยังไม่มี
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {overdue.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle className="size-5 text-red-600" />
                  <p className="text-sm font-bold text-red-700">
                    ค้างเกินกำหนด ({overdue.length})
                  </p>
                </div>
                <div className="space-y-2">
                  {overdue.map((t) => (
                    <TaskRow key={t.id} task={t} />
                  ))}
                </div>
              </div>
            )}
            {upcoming.length > 0 && (
              <div>
                <p className="text-sm font-bold text-zinc-700 mb-3">
                  ยังอยู่ในกำหนด ({upcoming.length})
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

function KpiCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: "danger" | "brand" | "warning" | "orange" | "purple";
}) {
  const cls = {
    danger: "text-red-700",
    brand: "text-[var(--color-brand-700)]",
    warning: "text-amber-700",
    orange: "text-orange-700",
    purple: "text-purple-700",
  }[accent];
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
      <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide">
        {label}
      </p>
      <p className={`text-2xl sm:text-3xl font-extrabold font-display tabular-num mt-2 ${cls}`}>
        {value}
      </p>
    </div>
  );
}

type Task = {
  id: string;
  refId: string;
  applicant: { fullName: string; phone: string; email: string | null };
  posting: { title: string };
  status: string;
  days: number;
  overdue: number;
};

function TaskRow({ task }: { task: Task }) {
  const isOverdue = task.overdue > 0;
  const phoneClean = task.applicant.phone.replace(/[^0-9+]/g, "");
  return (
    <div
      className={`rounded-2xl border-2 bg-white p-4 transition-colors ${
        isOverdue
          ? "border-red-200 bg-gradient-to-r from-red-50/40 to-white"
          : "border-zinc-200"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <Link
          href={`/recruit/applications/${task.id}`}
          className="flex-1 min-w-0 group"
        >
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-bold text-zinc-900 text-sm group-hover:text-[var(--color-brand-700)]">
              {task.applicant.fullName}
            </p>
            <Badge tone={STATUS_TONE[task.status as ApplicationStatus]}>
              {STATUS_LABELS[task.status as ApplicationStatus]}
            </Badge>
          </div>
          <p className="text-xs text-zinc-500 mt-1">
            {task.posting.title} · {task.applicant.phone}
          </p>
          <p className="text-xs text-zinc-700 mt-2 font-medium">
            <span className="text-zinc-400">ขั้นต่อไป: </span>
            {NEXT_ACTION[task.status as ApplicationStatus] ?? "ตรวจสอบ"}
          </p>
        </Link>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <div className="text-right">
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
              <p className="text-[10px] text-red-600 mt-0.5">
                เกิน {task.overdue} วัน
              </p>
            )}
          </div>
          <div className="flex items-center gap-1">
            <a
              href={`tel:${phoneClean}`}
              title="โทรหา"
              className="size-8 rounded-lg border border-zinc-200 text-zinc-600 hover:bg-green-50 hover:text-green-700 hover:border-green-300 flex items-center justify-center"
            >
              <Phone className="size-3.5" />
            </a>
            <Link
              href={`/recruit/messages?app=${task.id}`}
              title="ส่งข้อความ"
              className="size-8 rounded-lg border border-zinc-200 text-zinc-600 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-300 flex items-center justify-center"
            >
              <MessageCircle className="size-3.5" />
            </Link>
            <Link
              href={`/recruit/applications/${task.id}`}
              className="h-8 px-3 rounded-lg bg-[var(--color-brand-50)] text-[var(--color-brand-700)] text-xs font-bold hover:bg-[var(--color-brand-100)] flex items-center"
            >
              ดู
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
