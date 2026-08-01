"use client";

// มุมมอง "การ์ด" สำหรับมือถือ — 1 คน = 1 การ์ด (สลับจากตารางได้ที่แถบบน)
// จัดลำดับข้อมูลตามที่ CEO ใช้คัดจริง: เพศ · อายุ · ประวัติงาน (สรุป AI) เด่นก่อน
// ชื่อเป็นข้อมูลรอง (ตัวเล็ก) · รายละเอียดอื่น (ไฟล์/บันทึก/ป้าย/คำตอบ) พับเก็บกันการ์ดยาว
// ใช้ชิ้นส่วนควบคุมชุดเดียวกับตาราง (StatusSelect / VerdictButtons / InterviewNoteCell)

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, Star, ChevronDown } from "lucide-react";
import {
  GENDER_LABELS,
  TAG_COLOR_CHIP,
  parseTag,
  type ScreeningVerdict,
} from "@/lib/recruit/types";
import { aiVerdict } from "@/lib/recruit/answers";
import { FileQuickOpen } from "./file-quick-open";
import {
  StatusSelect,
  VerdictButtons,
  InterviewNoteCell,
} from "./application-row-controls";
import type { TableRow, AnswerColumnMeta } from "./applications-table";

const VERDICT_TEXT: Record<"green" | "amber" | "red", string> = {
  green: "text-green-700",
  amber: "text-amber-600",
  red: "text-red-600",
};

// อายุมาจากคำตอบในฟอร์ม (string) — ถ้าเป็นตัวเลขล้วนเติม "ปี" ให้อ่านง่าย
function formatAge(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const t = raw.trim();
  if (!t) return null;
  return /^\d{1,3}$/.test(t) ? `${t} ปี` : t;
}

// ตัดป้ายที่มา "[จากเรซูเม่] ..." ออกจากสรุป AI (โชว์ป้ายแยกเล็ก ๆ)
function splitSummary(summary: string | null): { source: string | null; text: string } {
  if (!summary) return { source: null, text: "" };
  const m = summary.match(/^\[(.+?)\]\s*([\s\S]*)$/);
  return m ? { source: m[1], text: m[2] } : { source: null, text: summary };
}

export function ApplicationCard({
  row,
  canWrite,
  answerColumns,
  ageAnswerId,
  selected,
  onToggleSelect,
}: {
  row: TableRow;
  canWrite: boolean;
  answerColumns: AnswerColumnMeta[];
  ageAnswerId?: string | null;
  selected: boolean;
  onToggleSelect: (id: string) => void;
}) {
  const verdictAi = aiVerdict(row.aiScore);
  const appHref = `/recruit/applications/${row.id}`;
  // ไฮไลต์ = คนที่เล็งไว้ (👍 น่าสนใจ) · อัปเดตสดเมื่อกดปุ่มคัดกรอง
  const [verdict, setVerdict] = useState<ScreeningVerdict | null>(row.verdict);
  useEffect(() => setVerdict(row.verdict), [row.verdict]);
  const highlighted = verdict === "INTERESTING";

  const age = formatAge(ageAnswerId ? row.answers[ageAnswerId] : null);
  const gender = row.gender ? GENDER_LABELS[row.gender] : null;
  const summary = splitSummary(row.aiSummary);
  // คำตอบที่โชว์ในส่วนพับ — ตัด "อายุ" ออก (โชว์เป็นชิปด้านบนแล้ว) กันซ้ำ
  const detailAnswers = answerColumns.filter((c) => c.id !== ageAnswerId);

  const iqTone = row.iq
    ? row.iq.correct >= row.iq.total * 0.7
      ? "text-green-700"
      : row.iq.correct >= row.iq.total * 0.5
        ? "text-amber-600"
        : "text-red-600"
    : "";
  const aiTone =
    row.aiScore != null
      ? row.aiScore >= 75
        ? "text-green-700"
        : row.aiScore >= 50
          ? "text-amber-600"
          : "text-red-600"
      : "";

  return (
    <div
      className={`rounded-2xl border p-2.5 transition-colors ${
        selected
          ? "border-[var(--color-brand-300)] bg-[var(--color-brand-50)]/50"
          : highlighted
            ? "border-amber-300 bg-amber-50/50 border-l-4 border-l-amber-400"
            : "border-zinc-200 bg-white"
      }`}
    >
      {/* บรรทัดบน — ติ๊กเลือก + เพศ/อายุ (เด่น) + คะแนนย่อ + ดูประวัติ */}
      <div className="flex items-center gap-2">
        {canWrite && (
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect(row.id)}
            className="size-4 shrink-0 accent-[var(--color-brand-600)] cursor-pointer"
            aria-label={`เลือก ${row.fullName}`}
          />
        )}
        <div className="flex flex-1 min-w-0 flex-wrap items-center gap-1.5">
          {gender && (
            <span className="inline-flex items-center rounded-md bg-[var(--color-brand-100)] text-[var(--color-brand-800)] font-bold text-[13px] px-2 py-0.5">
              {gender}
            </span>
          )}
          {age && (
            <span className="inline-flex items-center rounded-md bg-zinc-100 text-zinc-800 font-bold text-[13px] px-2 py-0.5 tabular-nums">
              {age}
            </span>
          )}
          {!gender && !age && (
            <span className="font-bold text-zinc-800 text-[13px] truncate">
              {row.fullName}
            </span>
          )}
          {row.flagged && (
            <span className="text-red-600 font-bold" title="ตรงกับ Blacklist">
              ⚠
            </span>
          )}
        </div>
        <Link
          href={appHref}
          className="shrink-0 inline-flex items-center gap-1 text-[11px] font-bold text-[var(--color-brand-700)]"
        >
          ประวัติ
          <ExternalLink className="size-3" />
        </Link>
      </div>

      {/* ชื่อ (รอง) + เบอร์ + ตำแหน่งที่สมัคร */}
      <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[11px] text-zinc-400">
        <Link href={appHref} className="text-zinc-500 hover:text-[var(--color-brand-700)]">
          {row.fullName}
        </Link>
        <span className="tabular-nums">· {row.phone}</span>
        {row.refId && <span className="font-mono">#{row.refId.slice(-6)}</span>}
      </div>
      <p className="text-[11px] text-zinc-500 truncate" title={row.postingTitle}>
        {row.postingTitle}
      </p>

      {/* ประวัติงาน / สรุป AI — 2 บรรทัด (แตะ "ประวัติ" ด้านบนเพื่ออ่านเต็ม) */}
      {summary.text && (
        <p className="mt-1.5 text-[12px] leading-snug text-zinc-600 line-clamp-2">
          {summary.source && (
            <span className="mr-1 inline-block align-middle text-[9px] font-bold px-1 py-0.5 rounded bg-[var(--color-brand-100)] text-[var(--color-brand-700)]">
              {summary.source}
            </span>
          )}
          {summary.text}
        </p>
      )}

      {/* คะแนนย่อ + คัดกรอง + สถานะ */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="flex items-center gap-2 text-[11px] text-zinc-500">
          {row.iq && (
            <span>
              IQ <b className={`tabular-nums ${iqTone}`}>{row.iq.correct}/{row.iq.total}</b>
            </span>
          )}
          {row.aiScore != null && (
            <span>
              AI <b className={`tabular-nums ${aiTone}`}>{row.aiScore}</b>
              {verdictAi && (
                <b className={`ml-0.5 ${VERDICT_TEXT[verdictAi.tone]}`}>{verdictAi.label}</b>
              )}
            </span>
          )}
          {row.starRating != null && (
            <span className="inline-flex items-center gap-0.5 text-amber-600">
              <Star className="size-3 fill-amber-400 text-amber-400" />
              <b className="tabular-nums">{row.starRating}</b>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <VerdictButtons
            applicationId={row.id}
            initial={row.verdict}
            canWrite={canWrite}
            onChange={setVerdict}
          />
          <StatusSelect
            applicationId={row.id}
            fullName={row.fullName}
            initial={row.status}
            canWrite={canWrite}
          />
        </div>
      </div>

      {/* ป้าย (ถ้ามี) */}
      {row.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {row.tags.map((raw) => {
            const { color, label } = parseTag(raw);
            return (
              <span
                key={raw}
                className={`inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded ${TAG_COLOR_CHIP[color]}`}
              >
                {label}
              </span>
            );
          })}
        </div>
      )}

      {/* รายละเอียด (พับเก็บ) — ไฟล์ + บันทึกสัมภาษณ์ + คำตอบทั้งหมด */}
      <details className="mt-2 group">
        <summary className="flex items-center gap-1 cursor-pointer text-[11px] font-bold text-[var(--color-brand-700)] select-none list-none">
          <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
          ไฟล์ · บันทึกสัมภาษณ์{detailAnswers.length > 0 ? ` · คำตอบ ${detailAnswers.length} ข้อ` : ""}
        </summary>

        {row.files.length > 0 && (
          <div className="mt-2">
            <FileQuickOpen files={row.files} variant="cell" />
          </div>
        )}

        <div className="mt-2 border-t border-zinc-100 pt-2">
          <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400 mb-1">
            บันทึกสัมภาษณ์
          </p>
          <InterviewNoteCell
            applicationId={row.id}
            initialLatest={row.latestNote}
            initialCount={row.noteCount}
            canWrite={canWrite}
            applicationHref={appHref}
            variant="card"
          />
        </div>

        {detailAnswers.length > 0 && (
          <div className="mt-2 space-y-2">
            {detailAnswers.map((c) => (
              <div key={c.id}>
                <p className="text-[10px] font-bold text-zinc-400">{c.label}</p>
                <p className="text-[13px] text-zinc-700 whitespace-pre-wrap">
                  {row.answers[c.id] || "—"}
                </p>
              </div>
            ))}
          </div>
        )}
      </details>
    </div>
  );
}
