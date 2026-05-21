// /recruit/calendar — interview calendar view
// Reads INTERVIEW notes from recruit_application_notes (no new schema needed)
// Per Recruit Redesign canvas screens 09A/09B (Calendar Desktop + Mobile)
//
// Format: notes with prefix [INTERVIEW] contain interview details · we parse
// what we can (date/time/branch) from the note body and from the application's
// posting + applicant info.

import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { requireRecruitAccess } from "@/lib/recruit/role-guard";
import { prisma } from "@/lib/prisma";
import { Section } from "@/components/ui/section";
import { CalendarCheck, Phone, MessageCircle, ChevronRight } from "lucide-react";

export const dynamic = "force-dynamic";

const POSITION_COLORS: Record<string, string> = {
  default: "border-l-[var(--color-brand-500)] bg-[var(--color-brand-50)]/40",
};

interface InterviewEvent {
  noteId: string;
  applicationId: string;
  applicantName: string;
  phone: string;
  postingTitle: string;
  noteText: string;
  parsedDate: Date | null;
  createdAt: Date;
  status: string;
}

// Parse Thai dates from note text · best-effort
// Recognizes: "24 พ.ค.", "วันที่ 24/5", "พฤหัสที่ 25", "14:00", etc.
// Falls back to the createdAt of the note if no future date found.
function parseInterviewDate(text: string, fallback: Date): Date | null {
  // Look for time pattern HH:MM
  const timeMatch = text.match(/(\d{1,2}):(\d{2})/);
  // Look for date pattern DD/MM or DD เดือน
  const monthMap: Record<string, number> = {
    "ม.ค.": 0,
    มกราคม: 0,
    "ก.พ.": 1,
    กุมภาพันธ์: 1,
    "มี.ค.": 2,
    มีนาคม: 2,
    "เม.ย.": 3,
    เมษายน: 3,
    "พ.ค.": 4,
    พฤษภาคม: 4,
    "มิ.ย.": 5,
    มิถุนายน: 5,
    "ก.ค.": 6,
    กรกฎาคม: 6,
    "ส.ค.": 7,
    สิงหาคม: 7,
    "ก.ย.": 8,
    กันยายน: 8,
    "ต.ค.": 9,
    ตุลาคม: 9,
    "พ.ย.": 10,
    พฤศจิกายน: 10,
    "ธ.ค.": 11,
    ธันวาคม: 11,
  };

  let day: number | null = null;
  let month: number | null = null;

  for (const [name, idx] of Object.entries(monthMap)) {
    const re = new RegExp(`(\\d{1,2})\\s*${name.replace(/\./g, "\\.")}`);
    const m = text.match(re);
    if (m) {
      day = parseInt(m[1], 10);
      month = idx;
      break;
    }
  }

  if (day == null) {
    const dm = text.match(/(\d{1,2})\/(\d{1,2})/);
    if (dm) {
      day = parseInt(dm[1], 10);
      month = parseInt(dm[2], 10) - 1;
    }
  }

  if (day == null) return fallback;

  const year = fallback.getFullYear();
  const hour = timeMatch ? parseInt(timeMatch[1], 10) : 9;
  const min = timeMatch ? parseInt(timeMatch[2], 10) : 0;
  const d = new Date(year, month ?? fallback.getMonth(), day, hour, min);

  // If date already passed by > 30 days, assume next year
  if (d.getTime() < fallback.getTime() - 30 * 24 * 60 * 60 * 1000) {
    d.setFullYear(year + 1);
  }
  return d;
}

export default async function CalendarPage() {
  const session = await requireSession();
  requireRecruitAccess(session.user.role);

  const sixtyDaysAgo = new Date();
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
  const sixtyDaysAhead = new Date();
  sixtyDaysAhead.setDate(sixtyDaysAhead.getDate() + 60);

  // Read structured interviews (Phase 2) + legacy notes (Phase 1 backwards compat)
  const [interviewsRaw, notes] = await Promise.all([
    prisma.recruitInterview.findMany({
      where: {
        orgId: session.user.org_id,
        scheduledAt: { gte: sixtyDaysAgo, lte: sixtyDaysAhead },
      },
      include: {
        application: {
          select: {
            id: true,
            status: true,
            applicant: { select: { fullName: true, phone: true } },
            posting: { select: { title: true } },
          },
        },
      },
      orderBy: { scheduledAt: "desc" },
    }),
    prisma.recruitApplicationNote.findMany({
      where: {
        orgId: session.user.org_id,
        body: { startsWith: "[INTERVIEW]" },
        createdAt: { gte: sixtyDaysAgo },
      },
      include: {
        application: {
          select: {
            id: true,
            status: true,
            applicant: { select: { fullName: true, phone: true } },
            posting: { select: { title: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  // Prefer structured interviews · skip legacy notes if app already has structured
  const structuredAppIds = new Set(interviewsRaw.map((iv) => iv.applicationId));

  const fromInterviews: InterviewEvent[] = interviewsRaw.map((iv) => ({
    noteId: iv.id,
    applicationId: iv.application.id,
    applicantName: iv.application.applicant.fullName,
    phone: iv.application.applicant.phone,
    postingTitle: iv.application.posting.title,
    noteText:
      (iv.kind === "PHONE"
        ? "📞 โทร"
        : iv.kind === "VIDEO"
          ? "💻 วิดีโอ"
          : "📍 ที่สถานที่") +
      (iv.location ? ` · ${iv.location}` : "") +
      (iv.notes ? ` · ${iv.notes}` : "") +
      ` · สถานะ: ${iv.status}`,
    parsedDate: iv.scheduledAt,
    createdAt: iv.createdAt,
    status: iv.application.status,
  }));

  const fromNotes: InterviewEvent[] = notes
    .filter((n) => !structuredAppIds.has(n.application.id))
    .map((n) => {
      const text = n.body.replace(/^\[INTERVIEW\]\s*/, "");
      return {
        noteId: n.id,
        applicationId: n.application.id,
        applicantName: n.application.applicant.fullName,
        phone: n.application.applicant.phone,
        postingTitle: n.application.posting.title,
        noteText: text,
        parsedDate: parseInterviewDate(text, n.createdAt),
        createdAt: n.createdAt,
        status: n.application.status,
      };
    });

  const events: InterviewEvent[] = [...fromInterviews, ...fromNotes];

  // Group by day
  const byDay = new Map<string, InterviewEvent[]>();
  for (const e of events) {
    const key = (e.parsedDate ?? e.createdAt).toISOString().slice(0, 10);
    const list = byDay.get(key) ?? [];
    list.push(e);
    byDay.set(key, list);
  }

  // Build calendar window: today − 7d to today + 21d
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const windowStart = new Date(today);
  windowStart.setDate(today.getDate() - 7);
  const days: Date[] = [];
  for (let i = 0; i < 28; i++) {
    const d = new Date(windowStart);
    d.setDate(windowStart.getDate() + i);
    days.push(d);
  }

  // Stats
  const upcomingCount = events.filter(
    (e) => e.parsedDate && e.parsedDate.getTime() > today.getTime(),
  ).length;
  const todayCount = byDay.get(today.toISOString().slice(0, 10))?.length ?? 0;
  const conflicts: string[] = []; // TODO: detect time overlap if needed

  return (
    <div className="p-5 sm:p-8 max-w-6xl mx-auto">
      <Section
        number="08"
        label="ปฏิทิน"
        title="ปฏิทินสัมภาษณ์งาน"
        description="นัดสัมภาษณ์ทั้งหมดในช่วงนี้ · ข้อมูลจาก Timeline ของใบสมัครแต่ละใบ"
      >
        {/* KPI strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <KpiBox label="วันนี้" value={todayCount} accent="brand" />
          <KpiBox label="กำลังจะมาถึง" value={upcomingCount} accent="warning" />
          <KpiBox label="รวม 60 วัน" value={events.length} accent="neutral" />
          <KpiBox label="ชนกัน" value={conflicts.length} accent={conflicts.length > 0 ? "danger" : "success"} />
        </div>

        {events.length === 0 ? (
          <EmptyCalendar />
        ) : (
          <div className="space-y-4">
            {/* Upcoming list */}
            <div>
              <h2 className="text-sm font-bold text-zinc-900 mb-3">นัดสัมภาษณ์ที่กำลังจะมาถึง</h2>
              <UpcomingList events={events.filter((e) => e.parsedDate && e.parsedDate.getTime() >= today.getTime())} />
            </div>

            {/* Mini 28-day grid */}
            <div>
              <h2 className="text-sm font-bold text-zinc-900 mb-3">ภาพรวม 4 สัปดาห์</h2>
              <CalendarGrid days={days} byDay={byDay} today={today} />
            </div>

            {/* Past */}
            <div>
              <h2 className="text-sm font-bold text-zinc-900 mb-3">นัดสัมภาษณ์ที่ผ่านมา</h2>
              <PastList events={events.filter((e) => e.parsedDate && e.parsedDate.getTime() < today.getTime()).slice(0, 10)} />
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}

function KpiBox({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: "brand" | "warning" | "success" | "danger" | "neutral";
}) {
  const accentClass = {
    brand: "text-[var(--color-brand-700)]",
    warning: "text-amber-700",
    success: "text-green-700",
    danger: "text-red-700",
    neutral: "text-zinc-900",
  }[accent];
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
      <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide">
        {label}
      </p>
      <p
        className={`text-3xl font-extrabold font-display tabular-num mt-2 ${accentClass}`}
      >
        {value}
      </p>
    </div>
  );
}

function UpcomingList({ events }: { events: InterviewEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="text-sm text-zinc-400 text-center py-6 border-2 border-dashed border-zinc-200 rounded-2xl">
        ไม่มีนัดที่กำลังจะมาถึง
      </p>
    );
  }
  // Sort by parsedDate ascending
  const sorted = [...events].sort(
    (a, b) => (a.parsedDate?.getTime() ?? 0) - (b.parsedDate?.getTime() ?? 0),
  );
  return (
    <div className="space-y-2">
      {sorted.slice(0, 10).map((e) => (
        <EventCard key={e.noteId} event={e} variant="upcoming" />
      ))}
    </div>
  );
}

function PastList({ events }: { events: InterviewEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="text-sm text-zinc-400 text-center py-4">ไม่มีนัดในอดีต</p>
    );
  }
  return (
    <div className="space-y-2">
      {events.map((e) => (
        <EventCard key={e.noteId} event={e} variant="past" />
      ))}
    </div>
  );
}

function EventCard({
  event,
  variant,
}: {
  event: InterviewEvent;
  variant: "upcoming" | "past";
}) {
  const colorClass =
    variant === "upcoming"
      ? POSITION_COLORS.default
      : "border-l-zinc-300 bg-zinc-50/40";

  const dateStr = event.parsedDate
    ? event.parsedDate.toLocaleDateString("th-TH", {
        weekday: "short",
        day: "numeric",
        month: "short",
      })
    : "ไม่ระบุวัน";
  const timeStr = event.parsedDate
    ? event.parsedDate.toLocaleTimeString("th-TH", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

  return (
    <div
      className={`rounded-2xl border-l-4 ${colorClass} border-y border-r border-zinc-200 p-4 flex items-center gap-4`}
    >
      <div className="text-center w-16 shrink-0">
        <p className="text-[10px] font-bold text-zinc-500 uppercase">{dateStr.split(" ")[0]}</p>
        <p className="text-xl font-extrabold font-display text-zinc-900 leading-none mt-1">
          {dateStr.split(" ").slice(1).join(" ")}
        </p>
        <p className="text-[10px] text-zinc-500 mt-1 tabular-num">{timeStr}</p>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-zinc-500">{event.postingTitle}</p>
        <p className="text-sm font-bold text-zinc-900 mt-0.5">{event.applicantName}</p>
        <p className="text-xs text-zinc-600 mt-1 line-clamp-1">{event.noteText}</p>
      </div>
      <div className="flex items-center gap-1">
        <a
          href={`tel:${event.phone.replace(/[^0-9+]/g, "")}`}
          title="โทรหาผู้สมัคร"
          className="size-9 rounded-lg border border-zinc-300 bg-white text-zinc-600 hover:bg-green-50 hover:text-green-700 hover:border-green-300 flex items-center justify-center"
        >
          <Phone className="size-4" />
        </a>
        <a
          href={`sms:${event.phone.replace(/[^0-9+]/g, "")}`}
          title="ส่ง SMS"
          className="size-9 rounded-lg border border-zinc-300 bg-white text-zinc-600 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-300 flex items-center justify-center"
        >
          <MessageCircle className="size-4" />
        </a>
        <Link
          href={`/recruit/applications/${event.applicationId}`}
          title="ดูใบสมัคร"
          className="h-9 px-3 rounded-lg bg-[var(--color-brand-600)] text-white text-xs font-bold flex items-center gap-1 hover:bg-[var(--color-brand-700)]"
        >
          ดู
          <ChevronRight className="size-3" />
        </Link>
      </div>
    </div>
  );
}

function CalendarGrid({
  days,
  byDay,
  today,
}: {
  days: Date[];
  byDay: Map<string, InterviewEvent[]>;
  today: Date;
}) {
  const dayLabels = ["จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส.", "อา."];
  // Pad start of grid to Monday
  const firstDay = days[0];
  const dow = firstDay.getDay(); // 0 = Sun, 1 = Mon, ...
  const padCount = (dow + 6) % 7; // days before Monday
  const padded: (Date | null)[] = [
    ...Array.from({ length: padCount }, () => null),
    ...days,
  ];
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white overflow-hidden">
      <div className="grid grid-cols-7 border-b border-zinc-200">
        {dayLabels.map((d) => (
          <div
            key={d}
            className="text-center text-[11px] font-bold text-zinc-500 uppercase py-2"
          >
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {padded.map((d, i) => {
          if (!d)
            return (
              <div key={`pad-${i}`} className="aspect-square border-r border-b border-zinc-100 bg-zinc-50/30" />
            );
          const key = d.toISOString().slice(0, 10);
          const events = byDay.get(key) ?? [];
          const isToday = d.getTime() === today.getTime();
          const isPast = d.getTime() < today.getTime();
          return (
            <div
              key={key}
              className={`aspect-square border-r border-b border-zinc-100 p-1.5 flex flex-col ${
                isToday
                  ? "bg-[var(--color-brand-50)]"
                  : isPast
                    ? "bg-zinc-50/50"
                    : "bg-white"
              }`}
            >
              <p
                className={`text-[10px] font-bold ${
                  isToday
                    ? "text-[var(--color-brand-700)]"
                    : isPast
                      ? "text-zinc-400"
                      : "text-zinc-700"
                }`}
              >
                {d.getDate()}
              </p>
              {events.length > 0 && (
                <div className="mt-auto flex flex-col gap-0.5">
                  {events.slice(0, 2).map((e) => (
                    <Link
                      key={e.noteId}
                      href={`/recruit/applications/${e.applicationId}`}
                      className="text-[9px] bg-[var(--color-brand-600)] text-white px-1 py-0.5 rounded truncate hover:bg-[var(--color-brand-700)]"
                      title={`${e.applicantName} — ${e.postingTitle}`}
                    >
                      {e.applicantName.split(" ")[0]}
                    </Link>
                  ))}
                  {events.length > 2 && (
                    <span className="text-[9px] text-zinc-500 pl-1">
                      +{events.length - 2}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EmptyCalendar() {
  return (
    <div className="rounded-3xl border-2 border-dashed border-zinc-200 bg-white p-12 text-center">
      <CalendarCheck className="size-12 mx-auto text-zinc-300" />
      <p className="mt-4 font-bold text-zinc-900">ยังไม่มีนัดสัมภาษณ์</p>
      <p className="text-sm text-zinc-500 mt-1 max-w-md mx-auto leading-relaxed">
        เปิดใบสมัครที่อยากนัด → คลิก &ldquo;📅 นัดสัมภาษณ์&rdquo; ใน Timeline →
        ระบุวัน-เวลา-สถานที่ → จะมาแสดงในปฏิทินนี้
      </p>
      <Link
        href="/recruit"
        className="inline-flex items-center gap-2 mt-5 rounded-xl bg-[var(--color-brand-600)] text-white px-5 h-11 font-bold hover:bg-[var(--color-brand-700)]"
      >
        ไปที่กล่องใบสมัคร
      </Link>
    </div>
  );
}
