// Public candidate tracking page — /my/<refId>
// Applicant uses the ref ID they received in confirmation email to track status.
// No auth · no OTP · ref ID is the key (random 8-char base32 suffix · ~40 bits entropy).
// Per Recruit Redesign canvas screen 06B (MyApplicationDetail).
//
// SECURITY (quality pass 2026-05-28):
//  - validate refId format BEFORE DB hit so bots scanning random paths get a
//    cheap notFound() instead of round-tripping Prisma
//  - keep noindex (root layout sets robots: noindex) so search engines don't
//    cache applicant data even if URL leaks

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  STATUS_LABELS,
  type ApplicationStatus,
} from "@/lib/recruit/types";
import { isValidApplicationRefId } from "@/lib/recruit/slug";
import { Phone, MessageCircle, CalendarCheck, Mail, StickyNote, CheckCircle2, XCircle, Building } from "lucide-react";
import { ErasureForm } from "./erasure-form";

export const dynamic = "force-dynamic";

// Always block search engines · this page contains personal applicant data.
export const metadata: Metadata = {
  title: "สถานะใบสมัคร",
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
};

const FLOW_STATUSES: ApplicationStatus[] = [
  "NEW",
  "SCREENING",
  "INTERVIEW",
  "OFFERED",
  "HIRED",
];

const STATUS_PILL: Record<
  ApplicationStatus,
  { label: string; bg: string; text: string; emoji: string }
> = {
  NEW: { label: "ใหม่", bg: "bg-blue-100", text: "text-blue-800", emoji: "🆕" },
  SCREENING: {
    label: "กำลังคัดกรอง",
    bg: "bg-amber-100",
    text: "text-amber-800",
    emoji: "🔍",
  },
  INTERVIEW: {
    label: "นัดสัมภาษณ์",
    bg: "bg-orange-100",
    text: "text-orange-800",
    emoji: "📅",
  },
  OFFERED: {
    label: "เสนองาน",
    bg: "bg-purple-100",
    text: "text-purple-800",
    emoji: "📜",
  },
  HIRED: {
    label: "รับเข้าทำงาน",
    bg: "bg-green-100",
    text: "text-green-800",
    emoji: "🎉",
  },
  REJECTED: {
    label: "ไม่ผ่าน",
    bg: "bg-red-100",
    text: "text-red-800",
    emoji: "❌",
  },
  WITHDRAWN: {
    label: "ถอนใบสมัคร",
    bg: "bg-zinc-100",
    text: "text-zinc-700",
    emoji: "↩️",
  },
};

const NEXT_STEP_HINT: Partial<Record<ApplicationStatus, string>> = {
  NEW: "เรากำลังตรวจสอบใบสมัครของคุณ · จะติดต่อกลับทาง LINE/โทรในไม่ช้า",
  SCREENING: "HR กำลังตรวจสอบประวัติเพิ่มเติม · อาจมีการขอข้อมูลเสริม",
  INTERVIEW: "เรานัดสัมภาษณ์แล้ว · กรุณายืนยันเวลาผ่าน LINE/โทร",
  OFFERED: "ขอแสดงความยินดี! · กรุณาตอบรับงาน หรือสอบถามรายละเอียดเพิ่ม",
  HIRED: "ยินดีต้อนรับสู่ทีม! · ติดต่อ HR เพื่อรับเอกสารวันแรก",
  REJECTED: "ขอบคุณที่สนใจ · ในรอบนี้ยังไม่เหมาะกับตำแหน่ง · ขอเก็บประวัติไว้รอบหน้า",
  WITHDRAWN: "คุณถอนใบสมัครแล้ว · หากต้องการสมัครใหม่ ติดต่อ HR ได้",
};

const NOTE_TYPE_META: Record<
  string,
  { label: string; icon: React.ComponentType<{ className?: string }>; chip: string }
> = {
  CALL: { label: "HR โทรคุย", icon: CheckCircle2, chip: "bg-green-100 text-green-800" },
  CALL_NO_ANSWER: {
    label: "HR โทรไม่รับ",
    icon: XCircle,
    chip: "bg-red-100 text-red-800",
  },
  MSG: { label: "ส่ง LINE / ข้อความ", icon: MessageCircle, chip: "bg-blue-100 text-blue-800" },
  INTERVIEW: { label: "นัดสัมภาษณ์", icon: CalendarCheck, chip: "bg-purple-100 text-purple-800" },
  EMAIL: { label: "ส่งอีเมล", icon: Mail, chip: "bg-amber-100 text-amber-800" },
  NOTE: { label: "บันทึก", icon: StickyNote, chip: "bg-zinc-100 text-zinc-700" },
};

const NOTE_PREFIX_RE = /^\[(CALL|CALL_NO_ANSWER|MSG|INTERVIEW|EMAIL|NOTE)\]\s*/;

function parseNote(body: string): { type: string; text: string } {
  const m = body.match(NOTE_PREFIX_RE);
  if (m) return { type: m[1], text: body.slice(m[0].length) };
  return { type: "NOTE", text: body };
}

export default async function MyApplicationPage({
  params,
}: {
  params: Promise<{ refId: string }>;
}) {
  const { refId } = await params;

  // Cheap format check before DB hit · blocks scanners + garbage paths.
  if (!isValidApplicationRefId(refId)) return notFound();

  const app = await prisma.recruitApplication.findUnique({
    where: { refId },
    include: {
      applicant: { select: { id: true, fullName: true, phone: true } },
      posting: {
        select: {
          title: true,
          description: true,
          company: { select: { name: true } },
          org: { select: { name: true } },
        },
      },
      notes: {
        orderBy: { createdAt: "desc" },
        take: 20,
      },
    },
  });

  if (!app) return notFound();

  // Check for pending erasure request
  const pendingErasure = await prisma.recruitErasureRequest.findFirst({
    where: {
      orgId: app.orgId,
      applicantId: app.applicant.id,
      status: "PENDING",
    },
    select: { id: true },
  });

  const status = app.status as ApplicationStatus;
  const meta = STATUS_PILL[status];
  const flowIdx = FLOW_STATUSES.indexOf(status);
  const isOutOfPipeline = flowIdx < 0;
  const companyName = app.posting.company?.name ?? app.posting.org.name;

  // Filter visible notes: show ALL typed notes (CALL/MSG/INTERVIEW/EMAIL)
  // but exclude generic [NOTE] which are HR-internal.
  const visibleNotes = app.notes
    .map((n) => ({ ...n, parsed: parseNote(n.body) }))
    .filter((n) => n.parsed.type !== "NOTE");

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="max-w-md mx-auto pb-12">
        {/* Hero gradient */}
        <div
          className={`px-6 pt-10 pb-12 text-white bg-gradient-to-br ${
            status === "HIRED"
              ? "from-green-600 to-green-800"
              : status === "REJECTED" || status === "WITHDRAWN"
                ? "from-zinc-500 to-zinc-700"
                : "from-[var(--color-brand-600)] to-[var(--color-brand-900)]"
          }`}
        >
          <p className="text-xs opacity-80">ใบสมัครของคุณ</p>
          <p className="text-2xl mt-2 leading-tight">
            <span className="opacity-90">{meta.emoji}</span>{" "}
            <span className="font-extrabold font-display">{meta.label}</span>
          </p>
          <p className="text-sm opacity-90 mt-3 leading-relaxed">
            ตำแหน่ง <b>{app.posting.title}</b>
            <br />
            {companyName}
          </p>
          <div className="mt-4 inline-block px-3 py-1.5 rounded-lg bg-white/15 font-mono text-xs">
            #{app.refId}
          </div>
        </div>

        {/* Stepper card */}
        <div className="mx-4 -mt-6 rounded-2xl bg-white shadow-lg p-5">
          <p className="text-[11px] text-zinc-500 mb-3 font-bold">ความคืบหน้า</p>
          <Stepper status={status} isOutOfPipeline={isOutOfPipeline} />
        </div>

        {/* Next step CTA */}
        <div className="px-4 mt-4">
          <div
            className={`rounded-2xl p-4 border ${
              status === "INTERVIEW"
                ? "bg-gradient-to-br from-orange-50 to-white border-orange-200"
                : status === "OFFERED"
                  ? "bg-gradient-to-br from-purple-50 to-white border-purple-200"
                  : status === "HIRED"
                    ? "bg-gradient-to-br from-green-50 to-white border-green-200"
                    : "bg-zinc-50 border-zinc-200"
            }`}
          >
            <p className={`text-sm font-bold ${meta.text}`}>ขั้นถัดไป</p>
            <p className="text-sm text-zinc-700 mt-1 leading-relaxed">
              {NEXT_STEP_HINT[status]}
            </p>
          </div>
        </div>

        {/* Timeline */}
        {visibleNotes.length > 0 && (
          <div className="px-4 mt-6">
            <h2 className="text-sm font-bold text-zinc-900 mb-3">
              อัปเดตจาก HR · {visibleNotes.length} รายการ
            </h2>
            <ol className="space-y-2 pl-3 border-l-2 border-zinc-200">
              {visibleNotes.map((n) => {
                const m = NOTE_TYPE_META[n.parsed.type] ?? NOTE_TYPE_META.NOTE;
                const Icon = m.icon;
                return (
                  <li key={n.id} className="relative">
                    <span
                      className={`absolute -left-[18px] top-2 size-3 rounded-full ${m.chip} border border-current/20 flex items-center justify-center`}
                    >
                      <Icon className="size-2" />
                    </span>
                    <div className="rounded-2xl border border-zinc-200 bg-white p-3">
                      <div className="flex items-center justify-between text-[10px] text-zinc-400 mb-1.5 gap-2">
                        <span
                          className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded ${m.chip}`}
                        >
                          <Icon className="size-2.5" />
                          {m.label}
                        </span>
                        <span>
                          {new Date(n.createdAt).toLocaleString("th-TH", {
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      <p className="text-sm text-zinc-900 whitespace-pre-wrap">
                        {n.parsed.text}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        )}

        {/* Contact card */}
        <div className="px-4 mt-6">
          <h2 className="text-sm font-bold text-zinc-900 mb-3">ติดต่อ HR</h2>
          <div className="rounded-2xl bg-white border border-zinc-200 p-4 flex items-center gap-3">
            <span className="size-10 rounded-xl bg-[var(--color-brand-50)] text-[var(--color-brand-700)] flex items-center justify-center">
              <Building className="size-5" />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-zinc-900">{companyName}</p>
              <p className="text-xs text-zinc-500">
                หากมีคำถาม โทรหา HR หรือทักไลน์ของบริษัท
              </p>
            </div>
            <a
              href={`tel:${app.applicant.phone.replace(/[^0-9+]/g, "")}`}
              aria-label="โทรหา HR"
              className="min-h-11 min-w-11 size-11 rounded-xl bg-green-500 text-white flex items-center justify-center hover:bg-green-600"
              title="โทรหา HR"
            >
              <Phone className="size-4" />
            </a>
          </div>
        </div>

        {/* Right to erasure (PDPA) */}
        <ErasureForm refId={app.refId} hasPendingRequest={!!pendingErasure} />

        {/* PDPA footer */}
        <div className="px-4 mt-6 text-center">
          <p className="text-[11px] text-zinc-400 leading-relaxed">
            ข้อมูลในใบสมัครเก็บตาม PDPA · ใช้เฉพาะการพิจารณาจ้างงาน
          </p>
        </div>
      </div>
    </div>
  );
}

function Stepper({
  status,
  isOutOfPipeline,
}: {
  status: ApplicationStatus;
  isOutOfPipeline: boolean;
}) {
  const idx = FLOW_STATUSES.indexOf(status);
  return (
    <>
      <div className="flex items-center">
        {FLOW_STATUSES.map((s, i) => {
          const isCurrent = !isOutOfPipeline && i === idx;
          const isDone = !isOutOfPipeline && i < idx;
          const isLast = i === FLOW_STATUSES.length - 1;
          return (
            <div key={s} className="flex items-center flex-1 last:flex-initial">
              <div className="flex flex-col items-center gap-1 shrink-0">
                <div
                  className={`size-7 rounded-full grid place-items-center font-bold text-[11px] border-2 ${
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
                  className={`text-[9.5px] whitespace-nowrap ${
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
                  className={`flex-1 h-0.5 mx-1.5 -mt-4 ${
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
          สถานะ: <b className="text-zinc-800">{STATUS_LABELS[status]}</b>
        </p>
      )}
    </>
  );
}
