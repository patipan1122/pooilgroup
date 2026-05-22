// Application Detail panel — server component shown inside inbox right pane
// Or full-page at /recruit/applications/[id]
//
// Redesigned per Recruit Redesign canvas (2026-05-21):
// - Hero with avatar + name + AI score ring side-by-side (3-col grid)
// - Big horizontal stepper (5 steps · current highlighted with glow)
// - Action bar with primary "ขั้นต่อไป" + secondary actions + prev/next nav
// - Client-side tabs (Profile / IQ / Answers / Timeline) via <ApplicationTabs>

import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import {
  APPLICATION_STATUSES,
  STATUS_LABELS,
  STATUS_TONE,
  FormSchemaSchema,
  TAG_COLOR_CHIP,
  parseTag,
  type ApplicationStatus,
  type FormSchema,
} from "@/lib/recruit/types";
import { ApplicationActions } from "./application-actions";
import { ApplicationNotes } from "./application-notes";
import { ApplicationFiles } from "./application-files";
import { ApplicationTabs } from "./application-tabs";
import { thaiDateLong } from "@/lib/utils/format";
import { Phone, Mail, MapPin, ShieldAlert } from "lucide-react";

interface Props {
  applicationId: string;
  canWrite: boolean;
}

export async function ApplicationDetail({ applicationId, canWrite }: Props) {
  const app = await prisma.recruitApplication.findUnique({
    where: { id: applicationId },
    include: {
      applicant: true,
      posting: { select: { id: true, title: true, fieldSchema: true, description: true } },
      notes: {
        include: { user: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!app) {
    return <div className="p-10 text-center text-sm text-zinc-500">ไม่พบใบสมัคร</div>;
  }

  let schema: FormSchema | null = null;
  try {
    schema = FormSchemaSchema.parse(app.posting.fieldSchema);
  } catch {
    schema = null;
  }

  const answers = (app.answers ?? {}) as Record<string, unknown>;
  const files = ((app.files ?? []) as Array<{
    key: string;
    name: string;
    size: number;
    mime: string;
  }>) ?? [];

  const status = app.status as ApplicationStatus;
  const initials = app.applicant.fullName.trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="max-w-4xl">
      {/* Blacklist banner */}
      {app.flaggedBlacklist && (
        <div className="m-5 sm:mx-7 sm:mt-7 mb-0 rounded-2xl border-l-4 border-red-500 bg-red-50 p-4 flex items-start gap-3">
          <ShieldAlert className="size-5 text-red-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-bold text-red-900 text-sm">ผู้สมัครนี้ตรงกับ Blacklist</p>
            {app.blacklistReason && (
              <p className="text-xs text-red-700 mt-1">{app.blacklistReason}</p>
            )}
            <Link
              href="/recruit/blacklist"
              className="text-xs text-red-600 underline hover:text-red-900 mt-2 inline-block"
            >
              ดู Blacklist
            </Link>
          </div>
        </div>
      )}

      {/* HERO — avatar + name + AI ring */}
      <div className="p-5 sm:p-7 pb-3">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4 lg:gap-6">
          {/* Left: identity */}
          <div className="flex items-start gap-4">
            <div className="size-16 sm:size-20 rounded-full bg-gradient-to-br from-zinc-400 to-zinc-600 text-white font-bold font-display flex items-center justify-center text-2xl sm:text-3xl shrink-0">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className="font-mono text-[11px] text-zinc-500" title={app.refId}>
                  #{app.refId?.slice(-6) ?? ""}
                </span>
                <span className="text-zinc-300">·</span>
                <span className="text-xs text-zinc-600">{app.posting.title}</span>
                <Badge tone={STATUS_TONE[status]}>
                  <span className="size-1.5 rounded-full bg-current opacity-70" />
                  {STATUS_LABELS[status]}
                </Badge>
              </div>
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-zinc-900 font-display leading-tight">
                {app.applicant.fullName}
              </h1>
              <div className="flex items-center gap-x-3 gap-y-1 mt-2 flex-wrap text-xs text-zinc-600">
                <span className="inline-flex items-center gap-1">
                  <Phone className="size-3" />
                  {app.applicant.phone}
                </span>
                {app.applicant.email && (
                  <span className="inline-flex items-center gap-1">
                    <Mail className="size-3" />
                    {app.applicant.email}
                  </span>
                )}
                {app.applicant.lineId && (
                  <span className="inline-flex items-center gap-1">
                    LINE {app.applicant.lineId}
                  </span>
                )}
              </div>
              {/* Header tag chips */}
              {app.tags && app.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {app.tags.map((raw) => {
                    const { color, label } = parseTag(raw);
                    return (
                      <span
                        key={raw}
                        className={`inline-flex items-center text-xs font-bold px-2.5 py-1 rounded-full ${TAG_COLOR_CHIP[color]}`}
                      >
                        {label}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Right: AI score card */}
          <AIScoreCard
            score={app.aiScore}
            summary={app.aiSummary}
            evaluatedAt={app.aiEvaluatedAt}
            applicationId={app.id}
            canWrite={canWrite}
          />
        </div>

        {/* BIG STEPPER */}
        <BigStepper currentStatus={status} />

        {/* ACTION BAR */}
        {canWrite && <ActionBar applicationId={app.id} currentStatus={status} />}
      </div>

      {/* TABS */}
      <ApplicationTabs
        applicationId={app.id}
        canWrite={canWrite}
        currentStatus={status}
        currentRating={app.starRating}
        currentTags={app.tags ?? []}
        aiStrengths={(app.aiStrengths as string[] | null) ?? null}
        aiRisks={(app.aiRisks as string[] | null) ?? null}
        answersBySection={
          schema?.sections.map((section) => ({
            id: section.id,
            title: section.title,
            fields: section.fields.map((f) => ({
              id: f.id,
              label: f.label,
              required: !!f.required,
              type: f.type,
              correctAnswer: f.correctAnswer ?? null,
              hasCorrectAnswer: !!f.hasCorrectAnswer,
              value: formatAnswer(answers[f.id]),
              rawValue: serializeRaw(answers[f.id]),
            })),
          })) ?? []
        }
        filesNode={files.length > 0 ? <ApplicationFiles files={files} /> : null}
        notes={app.notes.map((n) => ({
          id: n.id,
          body: n.body,
          rating: n.rating,
          userName: n.user.name,
          createdAt: n.createdAt.toISOString(),
        }))}
        submittedAt={app.submittedAt ? thaiDateLong(app.submittedAt) : "ยังไม่ส่ง"}
      />
    </div>
  );
}

// AI score ring card — sized to match design canvas
function AIScoreCard({
  score,
  summary,
  evaluatedAt,
  applicationId,
  canWrite,
}: {
  score: number | null;
  summary: string | null;
  evaluatedAt: Date | null;
  applicationId: string;
  canWrite: boolean;
}) {
  if (score == null) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--color-brand-200)] bg-[var(--color-brand-50)]/40 p-4">
        <p className="text-[11px] font-bold text-[var(--color-brand-700)]">
          ✨ AI ยังไม่ประเมิน
        </p>
        <p className="text-xs text-zinc-600 mt-1 leading-relaxed">
          กดปุ่ม &ldquo;ประเมิน&rdquo; ใน Profile tab — AI อ่านคำตอบ + JD แล้วให้คะแนน 0-100
        </p>
      </div>
    );
  }
  const color =
    score >= 75 ? "text-green-600" : score >= 50 ? "text-amber-500" : "text-red-600";
  const ringColor =
    score >= 75 ? "#16a34a" : score >= 50 ? "#f5b800" : "#dc2626";
  const verdict =
    score >= 75 ? "เหมาะกับตำแหน่ง" : score >= 50 ? "พิจารณาเพิ่ม" : "ต่ำกว่าเกณฑ์";

  const circumference = 2 * Math.PI * 30;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className="rounded-2xl border border-[var(--color-brand-100)] bg-gradient-to-br from-[var(--color-brand-50)] to-white p-4">
      <div className="flex items-center gap-3">
        <div className="relative size-16 shrink-0">
          <svg viewBox="0 0 68 68" className="size-16 -rotate-90">
            <circle cx="34" cy="34" r="30" fill="none" stroke="#eef2f7" strokeWidth="6" />
            <circle
              cx="34"
              cy="34"
              r="30"
              fill="none"
              stroke={ringColor}
              strokeWidth="6"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              strokeLinecap="round"
            />
          </svg>
          <span
            className={`absolute inset-0 flex items-center justify-center text-xl font-extrabold font-display ${color}`}
          >
            {score}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-zinc-600 font-medium">✨ AI ประเมิน</p>
          <p className={`text-sm font-bold ${color}`}>{verdict}</p>
          {evaluatedAt && (
            <p className="text-[10px] text-zinc-400 mt-0.5">
              เมื่อ {evaluatedAt.toLocaleDateString("th-TH")}
            </p>
          )}
        </div>
      </div>
      {summary && (
        <p className="text-[11px] text-zinc-700 mt-3 pt-3 border-t border-zinc-100 leading-relaxed line-clamp-3">
          {summary}
        </p>
      )}
    </div>
  );
}

// Big horizontal stepper — 5 main statuses with current highlighted
function BigStepper({ currentStatus }: { currentStatus: ApplicationStatus }) {
  const flowStatuses: ApplicationStatus[] = [
    "NEW",
    "SCREENING",
    "INTERVIEW",
    "OFFERED",
    "HIRED",
  ];
  // If REJECTED or WITHDRAWN, show full path as inactive
  const isOutOfPipeline = !flowStatuses.includes(currentStatus);
  const currentIdx = flowStatuses.indexOf(currentStatus);

  return (
    <div className="mt-5 mb-2 px-1">
      <div className="flex items-center">
        {flowStatuses.map((s, i) => {
          const isCurrent = !isOutOfPipeline && i === currentIdx;
          const isDone = !isOutOfPipeline && i < currentIdx;
          const isLast = i === flowStatuses.length - 1;
          return (
            <div key={s} className="flex items-center flex-1 last:flex-initial">
              <div className="flex flex-col items-center gap-1.5 shrink-0">
                <div
                  className={`size-8 rounded-full grid place-items-center font-bold text-xs border-2 transition-shadow ${
                    isCurrent
                      ? "bg-[var(--color-brand-600)] border-[var(--color-brand-600)] text-white shadow-[0_0_0_4px_var(--color-brand-100)]"
                      : isDone
                        ? "bg-green-100 border-green-600 text-green-700"
                        : "bg-white border-zinc-300 text-zinc-400"
                  }`}
                >
                  {isDone ? "✓" : i + 1}
                </div>
                <span
                  className={`text-[11px] whitespace-nowrap ${
                    isCurrent
                      ? "font-bold text-[var(--color-brand-700)]"
                      : isDone
                        ? "font-medium text-green-700"
                        : "text-zinc-400"
                  }`}
                >
                  {STATUS_LABELS[s]}
                </span>
              </div>
              {!isLast && (
                <div
                  className={`flex-1 h-0.5 mx-2 -mt-5 ${
                    isDone ? "bg-green-500" : "bg-zinc-200"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>
      {isOutOfPipeline && (
        <p className="text-center text-[11px] text-zinc-500 mt-3">
          สถานะปัจจุบัน: <b>{STATUS_LABELS[currentStatus]}</b> — นอก pipeline ปกติ
        </p>
      )}
    </div>
  );
}

// Action bar — primary next-stage CTA + secondary actions
function ActionBar({
  applicationId: _applicationId,
  currentStatus,
}: {
  applicationId: string;
  currentStatus: ApplicationStatus;
}) {
  const flow: ApplicationStatus[] = [
    "NEW",
    "SCREENING",
    "INTERVIEW",
    "OFFERED",
    "HIRED",
  ];
  const idx = flow.indexOf(currentStatus);
  const next = idx >= 0 && idx < flow.length - 1 ? flow[idx + 1] : null;

  return (
    <div className="mt-4 flex items-center gap-2 flex-wrap">
      {next && (
        <ActionBarHint nextStatus={next} />
      )}
      <p className="text-[11px] text-zinc-400 ml-auto hidden sm:block">
        ใช้ปุ่ม &ldquo;เปลี่ยนสถานะ&rdquo; ใน Profile tab ↓
      </p>
    </div>
  );
}

function ActionBarHint({ nextStatus }: { nextStatus: ApplicationStatus }) {
  return (
    <div className="inline-flex items-center gap-1.5 text-xs text-[var(--color-brand-800)] bg-[var(--color-brand-50)] border border-[var(--color-brand-200)] rounded-lg px-3 h-9 font-medium">
      <span className="text-[var(--color-brand-600)]">→</span>
      ขั้นถัดไป: <b>{STATUS_LABELS[nextStatus]}</b>
    </div>
  );
}

function formatAnswer(val: unknown): string {
  if (val == null || val === "") return "";
  if (Array.isArray(val)) return val.join(", ");
  if (typeof val === "boolean") return val ? "ใช่" : "ไม่ใช่";
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}

function serializeRaw(val: unknown): string {
  if (val == null) return "";
  return typeof val === "string" ? val : JSON.stringify(val);
}

// Export to support re-use elsewhere
export { ApplicationActions, ApplicationNotes };
