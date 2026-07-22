"use client";

// มุมมอง "การ์ด" สำหรับมือถือ — 1 คน = 1 การ์ด (แทนตารางที่ต้องปัดแนวนอน)
// ใช้ชิ้นส่วนควบคุมชุดเดียวกับตาราง (StatusSelect / VerdictButtons / InterviewNoteCell)
// เพื่อให้พฤติกรรม + ข้อมูลตรงกันเป๊ะทั้งสองมุมมอง

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, Star } from "lucide-react";
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

export function ApplicationCard({
  row,
  canWrite,
  answerColumns,
  selected,
  onToggleSelect,
}: {
  row: TableRow;
  canWrite: boolean;
  answerColumns: AnswerColumnMeta[];
  selected: boolean;
  onToggleSelect: (id: string) => void;
}) {
  const verdictAi = aiVerdict(row.aiScore);
  const appHref = `/recruit/applications/${row.id}`;
  // ไฮไลต์ = คนที่เล็งไว้ (👍 น่าสนใจ) · อัปเดตสดเมื่อกดปุ่มคัดกรอง
  const [verdict, setVerdict] = useState<ScreeningVerdict | null>(row.verdict);
  // sync เมื่อข้อมูลใหม่มา (เช่น กด "เล็ง" จากผลค้นหา AI แล้ว refresh) → ไฮไลต์ขึ้นทันที
  useEffect(() => setVerdict(row.verdict), [row.verdict]);
  const highlighted = verdict === "INTERESTING";

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
      className={`rounded-2xl border p-3 transition-colors ${
        selected
          ? "border-[var(--color-brand-300)] bg-[var(--color-brand-50)]/50"
          : highlighted
            ? "border-amber-300 bg-amber-50/50 border-l-4 border-l-amber-400"
            : "border-zinc-200 bg-white"
      }`}
    >
      {/* หัวการ์ด — ติ๊กเลือก + ชื่อ + เปิดเต็มหน้า */}
      <div className="flex items-start gap-2">
        {canWrite && (
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect(row.id)}
            className="mt-1 size-4 shrink-0 accent-[var(--color-brand-600)] cursor-pointer"
            aria-label={`เลือก ${row.fullName}`}
          />
        )}
        <div className="min-w-0 flex-1">
          <Link
            href={appHref}
            className="font-bold text-zinc-900 hover:text-[var(--color-brand-700)]"
          >
            {row.fullName}
          </Link>
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-400 mt-0.5">
            <span className="tabular-nums">{row.phone}</span>
            {row.refId && <span className="font-mono">#{row.refId.slice(-6)}</span>}
            {row.gender && <span>· {GENDER_LABELS[row.gender]}</span>}
            {row.flagged && (
              <span className="text-red-600 font-bold" title="ตรงกับ Blacklist">
                ⚠
              </span>
            )}
          </div>
          <p
            className="text-[12px] text-zinc-600 mt-0.5 truncate"
            title={row.postingTitle}
          >
            {row.postingTitle}
          </p>
        </div>
        <Link
          href={appHref}
          className="shrink-0 inline-flex items-center gap-1 text-[11px] font-bold text-[var(--color-brand-700)]"
        >
          ประวัติ
          <ExternalLink className="size-3" />
        </Link>
      </div>

      {/* แถบคะแนน — IQ / AI / ดาว */}
      {(row.iq || row.aiScore != null || row.starRating != null) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {row.iq && (
            <Stat label="IQ" value={`${row.iq.correct}/${row.iq.total}`} tone={iqTone} />
          )}
          {row.aiScore != null && (
            <Stat
              label="AI"
              value={String(row.aiScore)}
              tone={aiTone}
              sub={verdictAi ? verdictAi.label : undefined}
              subTone={verdictAi ? VERDICT_TEXT[verdictAi.tone] : undefined}
            />
          )}
          {row.starRating != null && (
            <span className="inline-flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-1 text-[12px] font-bold text-amber-700">
              <Star className="size-3 fill-amber-400 text-amber-400" />
              {row.starRating}
            </span>
          )}
        </div>
      )}

      {/* คัดกรอง + สถานะ */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
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

      {/* ไฟล์แนบ */}
      {row.files.length > 0 && (
        <div className="mt-2">
          <FileQuickOpen files={row.files} variant="cell" />
        </div>
      )}

      {/* บันทึกสัมภาษณ์ */}
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

      {/* ป้าย */}
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

      {/* คำตอบทั้งหมด — ซ่อนไว้ กดกางดู (กันการ์ดยาว) */}
      {answerColumns.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] font-bold text-[var(--color-brand-700)] select-none">
            ดูคำตอบ {answerColumns.length} ข้อ
          </summary>
          <div className="mt-2 space-y-2">
            {answerColumns.map((c) => (
              <div key={c.id}>
                <p className="text-[10px] font-bold text-zinc-400">{c.label}</p>
                <p className="text-[13px] text-zinc-700 whitespace-pre-wrap">
                  {row.answers[c.id] || "—"}
                </p>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  sub,
  subTone,
}: {
  label: string;
  value: string;
  tone: string;
  sub?: string;
  subTone?: string;
}) {
  return (
    <span className="inline-flex flex-col rounded-lg bg-zinc-50 px-2 py-1 leading-tight">
      <span className="text-[9px] font-bold text-zinc-400">{label}</span>
      <span className={`text-[13px] font-bold tabular-nums ${tone}`}>
        {value}
        {sub && (
          <span className={`ml-1 text-[10px] font-bold ${subTone ?? ""}`}>
            {sub}
          </span>
        )}
      </span>
    </span>
  );
}
