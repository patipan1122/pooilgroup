"use client";

// Application detail tabs — client component for tab state
// Tabs: Profile / IQ test / Answers / Timeline
// Profile contains ApplicationActions (status pills + tags + rating)

import { useState, type ReactNode } from "react";
import { ApplicationActions } from "./application-actions";
import { ApplicationNotes } from "./application-notes";
import { ApplicationAIPanel } from "./application-ai-panel";
import {
  type ApplicationStatus,
  type ScreeningVerdict,
} from "@/lib/recruit/types";
import { partitionIqSections } from "@/lib/recruit/iq-sections";
import { User, Brain, FileText, Clock, Check, X, Info } from "lucide-react";

type TabKey = "profile" | "iq" | "answers" | "timeline";

interface FieldAnswer {
  id: string;
  label: string;
  required: boolean;
  type: string;
  correctAnswer: string | string[] | null;
  hasCorrectAnswer: boolean;
  value: string;
  rawValue: string;
}

interface Section {
  id: string;
  title: string;
  fields: FieldAnswer[];
}

interface Note {
  id: string;
  body: string;
  rating: number | null;
  userName: string;
  createdAt: string;
}

interface Props {
  applicationId: string;
  canWrite: boolean;
  currentStatus: ApplicationStatus;
  currentRating: number | null;
  currentTags: string[];
  currentVerdict: ScreeningVerdict | null;
  aiStrengths: string[] | null;
  aiRisks: string[] | null;
  hasResumeFile: boolean;
  answersBySection: Section[];
  filesNode: ReactNode;
  notes: Note[];
  submittedAt: string;
}

export function ApplicationTabs({
  applicationId,
  canWrite,
  currentStatus,
  currentRating,
  currentTags,
  currentVerdict,
  aiStrengths,
  aiRisks,
  hasResumeFile,
  answersBySection,
  filesNode,
  notes,
  submittedAt,
}: Props) {
  const [tab, setTab] = useState<TabKey>("profile");

  // แยกหมวด: "ทุกหมวด IQ" vs คำตอบทั่วไป — ใช้ helper กลาง (ห้าม .find หมวดเดียว)
  // ประกาศเดียวมี IQ ได้หลายหมวด (ตัวหนังสือ + ไอคิวจากรูป ง่าย/กลาง/ยาก) ต้องนับให้ครบทุกหมวด
  const { iqSections, otherSections } = partitionIqSections(answersBySection);
  const hasIq = iqSections.length > 0;

  // นับ IQ ถูก/ทั้งหมด ข้ามทุกหมวด IQ
  const iqStats = hasIq
    ? iqSections
        .flatMap((s) => s.fields)
        .reduce(
          (acc, f) => {
            if (!f.hasCorrectAnswer) return acc;
            acc.total++;
            if (isCorrect(f)) acc.correct++;
            return acc;
          },
          { correct: 0, total: 0 },
        )
    : null;

  return (
    <div>
      {/* Tab nav */}
      <div className="border-b border-zinc-200 bg-white sticky top-0 z-10">
        <div className="flex gap-1 px-5 sm:px-7 overflow-x-auto">
          <TabButton
            active={tab === "profile"}
            onClick={() => setTab("profile")}
            Icon={User}
            label="โปรไฟล์"
          />
          {hasIq && (
            <TabButton
              active={tab === "iq"}
              onClick={() => setTab("iq")}
              Icon={Brain}
              label={`IQ ${iqStats ? `${iqStats.correct}/${iqStats.total}` : ""}`}
              badgeTone={
                iqStats && iqStats.total > 0
                  ? iqStats.correct >= iqStats.total * 0.7
                    ? "good"
                    : iqStats.correct >= iqStats.total * 0.5
                      ? "mid"
                      : "bad"
                  : undefined
              }
            />
          )}
          <TabButton
            active={tab === "answers"}
            onClick={() => setTab("answers")}
            Icon={FileText}
            label={`คำตอบ ${otherSections.reduce((s, sec) => s + sec.fields.length, 0)}`}
          />
          <TabButton
            active={tab === "timeline"}
            onClick={() => setTab("timeline")}
            Icon={Clock}
            label={`Timeline ${notes.length}`}
          />
        </div>
      </div>

      {/* Tab body */}
      <div className="p-5 sm:p-7 bg-zinc-50/40 min-h-[400px]">
        {tab === "profile" && (
          <div className="space-y-4">
            {canWrite && (
              <ApplicationActions
                applicationId={applicationId}
                currentStatus={currentStatus}
                currentRating={currentRating}
                currentTags={currentTags}
                currentVerdict={currentVerdict}
              />
            )}
            <ApplicationAIPanel
              applicationId={applicationId}
              aiScore={null}
              aiSummary={null}
              aiStrengths={aiStrengths}
              aiRisks={aiRisks}
              aiEvaluatedAt={null}
              canWrite={canWrite}
              hasResumeFile={hasResumeFile}
            />
            {filesNode}
          </div>
        )}

        {tab === "iq" && hasIq && (
          <IQTab sections={iqSections} stats={iqStats} />
        )}

        {tab === "answers" && (
          <div className="space-y-4">
            {otherSections.length === 0 ? (
              <p className="text-center text-sm text-zinc-400 py-8">ไม่มีข้อมูล</p>
            ) : (
              otherSections.map((section) => (
                <div key={section.id}>
                  <p className="text-xs text-zinc-500 font-bold mb-2">{section.title}</p>
                  <div className="rounded-2xl border border-zinc-200 bg-white divide-y divide-zinc-100">
                    {section.fields.map((field) => (
                      <div
                        key={field.id}
                        className="px-4 py-2.5 grid grid-cols-1 sm:grid-cols-3 gap-2 items-start"
                      >
                        <p className="text-xs font-medium text-zinc-600 sm:col-span-1">
                          {field.label}
                          {field.required && (
                            <span className="text-red-500 ml-0.5">*</span>
                          )}
                        </p>
                        <p className="text-sm text-zinc-900 sm:col-span-2 break-words">
                          {field.value || (
                            <span className="text-zinc-400 italic">— ไม่ตอบ —</span>
                          )}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {tab === "timeline" && (
          <div className="space-y-3">
            <h2 className="text-sm font-bold text-zinc-900">
              Timeline · บันทึกกิจกรรม ({notes.length})
            </h2>
            <ApplicationNotes
              applicationId={applicationId}
              notes={notes}
              canWrite={canWrite}
            />
            <p className="text-xs text-zinc-400 text-center pt-2">
              ส่งใบสมัครเมื่อ {submittedAt}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  Icon,
  label,
  badgeTone,
}: {
  active: boolean;
  onClick: () => void;
  Icon: React.ComponentType<{ className?: string }>;
  label: string;
  badgeTone?: "good" | "mid" | "bad";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-4 py-3 text-sm font-bold border-b-2 transition-colors whitespace-nowrap ${
        active
          ? "border-[var(--color-brand-600)] text-[var(--color-brand-700)]"
          : "border-transparent text-zinc-500 hover:text-zinc-900"
      }`}
    >
      <Icon className="size-4" />
      {label}
      {badgeTone && active && (
        <span
          className={`size-1.5 rounded-full ${
            badgeTone === "good"
              ? "bg-green-500"
              : badgeTone === "mid"
                ? "bg-amber-500"
                : "bg-red-500"
          }`}
        />
      )}
    </button>
  );
}

function isCorrect(f: FieldAnswer): boolean {
  if (!f.hasCorrectAnswer || f.correctAnswer == null) return false;
  if (Array.isArray(f.correctAnswer)) {
    return f.correctAnswer.includes(f.rawValue);
  }
  return (
    String(f.correctAnswer).trim().toLowerCase() ===
    String(f.rawValue).trim().toLowerCase()
  );
}

function IQTab({
  sections,
  stats,
}: {
  sections: Section[];
  stats: { correct: number; total: number } | null;
}) {
  const passingPct = stats && stats.total > 0 ? stats.correct / stats.total : 0;
  const verdict =
    passingPct >= 0.8
      ? { text: "ผ่านเกณฑ์", color: "text-green-700", bg: "bg-green-50" }
      : passingPct >= 0.5
        ? { text: "พอใช้", color: "text-amber-700", bg: "bg-amber-50" }
        : { text: "ต่ำกว่าเกณฑ์", color: "text-red-700", bg: "bg-red-50" };

  return (
    <div className="space-y-3">
      {/* Fairness/PDPA posture — IQ result is advisory, never the sole criterion */}
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 flex items-start gap-2">
        <Info className="size-3.5 text-amber-600 shrink-0 mt-0.5" />
        <p className="text-[11px] text-amber-800 leading-relaxed">
          ผลไอคิวเป็น <b>ข้อมูลประกอบ</b> เท่านั้น ไม่ใช่เกณฑ์ตัดสินเดียว · ควรใช้ร่วมกับการสัมภาษณ์
          ประสบการณ์ และทัศนคติ · เลือกระดับความยากของข้อสอบให้เหมาะกับตำแหน่งงาน
        </p>
      </div>
      {stats && stats.total > 0 && (
        <div className={`rounded-2xl ${verdict.bg} p-4 flex items-center gap-4`}>
          <div className="text-3xl font-extrabold font-display text-zinc-900">
            {stats.correct}
            <span className="text-zinc-400">/{stats.total}</span>
          </div>
          <div className="flex-1">
            <p className={`text-sm font-bold ${verdict.color}`}>{verdict.text}</p>
            <p className="text-xs text-zinc-600 mt-0.5">
              คำถามตอบถูก {stats.correct} ข้อ จากทั้งหมด {stats.total} ข้อ
            </p>
          </div>
        </div>
      )}
      {sections.map((section) => (
        <div key={section.id} className="space-y-1.5">
          {sections.length > 1 && (
            <p className="text-xs text-zinc-500 font-bold">{section.title}</p>
          )}
          <div className="rounded-2xl border border-zinc-200 bg-white divide-y divide-zinc-100">
            {section.fields.map((f) => {
              const correct = f.hasCorrectAnswer ? isCorrect(f) : null;
              return (
                <div key={f.id} className="p-4">
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <p className="text-sm font-medium text-zinc-900 flex-1 min-w-0 break-words">
                  {f.label}
                </p>
                {correct === true && (
                  <span className="inline-flex items-center gap-1 text-xs font-bold text-green-700 bg-green-100 px-2 py-0.5 rounded-full shrink-0">
                    <Check className="size-3" />
                    ถูก
                  </span>
                )}
                {correct === false && (
                  <span className="inline-flex items-center gap-1 text-xs font-bold text-red-700 bg-red-100 px-2 py-0.5 rounded-full shrink-0">
                    <X className="size-3" />
                    ผิด
                  </span>
                )}
              </div>
              <p
                className={`text-sm pl-3 border-l-2 break-words ${
                  correct === true
                    ? "border-green-500 text-zinc-900"
                    : correct === false
                      ? "border-red-500 text-zinc-700"
                      : "border-zinc-300 text-zinc-700"
                }`}
              >
                {f.value || (
                  <span className="text-zinc-400 italic">— ไม่ตอบ —</span>
                )}
              </p>
              {correct === false && f.correctAnswer != null && (
                <p className="text-xs text-zinc-500 mt-1.5 pl-3">
                  เฉลย:{" "}
                  <b className="text-green-700">
                    {Array.isArray(f.correctAnswer)
                      ? f.correctAnswer.join(", ")
                      : String(f.correctAnswer)}
                  </b>
                </p>
              )}
            </div>
          );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
