"use client";

// Excel-style table view — ผู้สมัครทั้งหมดเป็นแถว · กดเปลี่ยนสถานะ/คัดกรองในตารางได้เลย
// เรียงคอลัมน์ (server-side) · แบ่งหน้าที่หน้าแม่ · สรุปคะแนนอยู่แถบบน (หน้าแม่)

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  APPLICATION_STATUSES,
  STATUS_LABELS,
  STATUS_TONE,
  SCREENING_VERDICTS,
  SCREENING_VERDICT_LABELS,
  SCREENING_VERDICT_ACTIVE_CLASS,
  TAG_COLOR_CHIP,
  GENDER_LABELS,
  parseTag,
  type ApplicationStatus,
  type ScreeningVerdict,
  type Gender,
} from "@/lib/recruit/types";
import {
  changeApplicationStatus,
  setScreeningVerdict,
} from "@/lib/recruit/actions";
import {
  Star,
  ArrowDown,
  ArrowUp,
  ExternalLink,
  ThumbsUp,
  ThumbsDown,
  Meh,
  type LucideIcon,
} from "lucide-react";

export interface TableRow {
  id: string;
  refId: string | null;
  fullName: string;
  phone: string;
  gender: Gender | null;
  postingTitle: string;
  iq: { correct: number; total: number } | null;
  aiScore: number | null;
  starRating: number | null;
  verdict: ScreeningVerdict | null;
  status: ApplicationStatus;
  tags: string[];
  flagged: boolean;
  submittedAt: string | null;
}

interface Props {
  rows: TableRow[];
  canWrite: boolean;
  currentSort: string;
  sortLinks: { name: string; ai: string; star: string; recent: string };
}

// Lucide icon per verdict (แทนอิโมจิ · โปร + คงความหมาย · ตาม tokens Lucide-only)
const VERDICT_ICON: Record<ScreeningVerdict, LucideIcon> = {
  INTERESTING: ThumbsUp,
  MAYBE: Meh,
  NOT_INTERESTED: ThumbsDown,
};

// สีจุดสถานะ (มองปราดเดียวรู้ · เรียงตาม tone เดิม)
const TONE_DOT: Record<string, string> = {
  brand: "bg-[var(--color-brand-500)]",
  warning: "bg-amber-500",
  orange: "bg-orange-500",
  purple: "bg-purple-500",
  success: "bg-green-500",
  danger: "bg-red-500",
  neutral: "bg-zinc-400",
};

export function ApplicationsTable({
  rows,
  canWrite,
  currentSort,
  sortLinks,
}: Props) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white">
      <table className="w-full min-w-[1080px] text-sm border-collapse">
        <thead className="sticky top-0 z-20 bg-white border-b border-zinc-200 shadow-sm">
          <tr className="text-left text-[11px] text-zinc-500">
            <SortableTh
              label="ชื่อ / ประวัติ"
              href={sortLinks.name}
              active={currentSort === "name"}
              dir="asc"
              className="pl-4"
            />
            <th className="px-3 py-2.5 font-bold whitespace-nowrap">ตำแหน่ง</th>
            <th className="px-3 py-2.5 font-bold whitespace-nowrap">เพศ</th>
            <th className="px-3 py-2.5 font-bold whitespace-nowrap">IQ</th>
            <SortableTh
              label="AI"
              href={sortLinks.ai}
              active={currentSort === "ai"}
              dir="desc"
            />
            <SortableTh
              label="ดาว"
              href={sortLinks.star}
              active={currentSort === "star"}
              dir="desc"
            />
            <th className="px-3 py-2.5 font-bold whitespace-nowrap">คัดกรอง</th>
            <th className="px-3 py-2.5 font-bold whitespace-nowrap">สถานะ</th>
            <th className="px-3 py-2.5 font-bold whitespace-nowrap">ป้าย</th>
            <SortableTh
              label="วันสมัคร"
              href={sortLinks.recent}
              active={currentSort === "recent"}
              dir="desc"
            />
            <th className="px-3 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <Row key={row.id} row={row} canWrite={canWrite} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SortableTh({
  label,
  href,
  active,
  dir,
  className = "",
}: {
  label: string;
  href: string;
  active: boolean;
  dir: "asc" | "desc";
  className?: string;
}) {
  return (
    <th className={`px-3 py-2.5 font-bold whitespace-nowrap ${className}`}>
      <Link
        href={href}
        className={`inline-flex items-center gap-1 hover:text-zinc-900 ${
          active ? "text-[var(--color-brand-700)]" : ""
        }`}
      >
        {label}
        {active ? (
          dir === "asc" ? (
            <ArrowUp className="size-3" />
          ) : (
            <ArrowDown className="size-3" />
          )
        ) : (
          <ArrowDown className="size-3 opacity-30" />
        )}
      </Link>
    </th>
  );
}

function Row({ row, canWrite }: { row: TableRow; canWrite: boolean }) {
  const [status, setStatus] = useState<ApplicationStatus>(row.status);
  const [verdict, setVerdict] = useState<ScreeningVerdict | null>(row.verdict);
  const [isPending, startTransition] = useTransition();

  function changeStatus(next: ApplicationStatus) {
    if (next === status) return;
    const prev = status;
    setStatus(next);
    startTransition(async () => {
      try {
        await changeApplicationStatus(row.id, next);
        toast.success(`${row.fullName} → ${STATUS_LABELS[next]}`);
      } catch (e) {
        setStatus(prev);
        toast.error((e as Error).message);
      }
    });
  }

  function changeVerdict(next: ScreeningVerdict) {
    const prev = verdict;
    const value = verdict === next ? null : next;
    setVerdict(value);
    startTransition(async () => {
      try {
        await setScreeningVerdict(row.id, value);
      } catch (e) {
        setVerdict(prev);
        toast.error((e as Error).message);
      }
    });
  }

  const ReadonlyVerdictIcon = verdict ? VERDICT_ICON[verdict] : null;

  return (
    <tr className="border-b border-zinc-100 even:bg-zinc-50/40 hover:bg-[var(--color-brand-50)]/40 align-middle transition-colors">
      {/* ชื่อ + เบอร์ + refId */}
      <td className="pl-4 pr-3 py-2.5">
        <Link
          href={`/recruit/applications/${row.id}`}
          className="font-bold text-zinc-900 hover:text-[var(--color-brand-700)] hover:underline"
        >
          {row.fullName}
        </Link>
        <div className="flex items-center gap-1.5 text-[11px] text-zinc-400 mt-0.5">
          <span className="tabular-nums">{row.phone}</span>
          {row.refId && <span className="font-mono">#{row.refId.slice(-6)}</span>}
          {row.flagged && (
            <span className="text-red-600 font-bold" title="ตรงกับ Blacklist">
              ⚠
            </span>
          )}
        </div>
      </td>

      {/* ตำแหน่ง */}
      <td className="px-3 py-2.5 text-zinc-600 max-w-[160px] truncate" title={row.postingTitle}>
        {row.postingTitle}
      </td>

      {/* เพศ */}
      <td className="px-3 py-2.5 text-zinc-700 whitespace-nowrap">
        {row.gender ? GENDER_LABELS[row.gender] : <span className="text-zinc-300">—</span>}
      </td>

      {/* IQ ข้อถูก */}
      <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">
        {row.iq ? (
          <span
            className={`font-bold ${
              row.iq.correct >= row.iq.total * 0.7
                ? "text-green-700"
                : row.iq.correct >= row.iq.total * 0.5
                  ? "text-amber-600"
                  : "text-red-600"
            }`}
          >
            {row.iq.correct}
            <span className="text-zinc-400 font-normal">/{row.iq.total}</span>
          </span>
        ) : (
          <span className="text-zinc-300">—</span>
        )}
      </td>

      {/* AI score */}
      <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">
        {row.aiScore != null ? (
          <span
            className={`font-bold ${
              row.aiScore >= 75
                ? "text-green-700"
                : row.aiScore >= 50
                  ? "text-amber-600"
                  : "text-red-600"
            }`}
          >
            {row.aiScore}
          </span>
        ) : (
          <span className="text-zinc-300">—</span>
        )}
      </td>

      {/* ดาว */}
      <td className="px-3 py-2.5 whitespace-nowrap">
        {row.starRating != null ? (
          <span className="inline-flex items-center gap-0.5 text-amber-500">
            <Star className="size-3.5 fill-amber-400 text-amber-400" />
            <span className="tabular-nums text-zinc-700 font-medium">
              {row.starRating}
            </span>
          </span>
        ) : (
          <span className="text-zinc-300">—</span>
        )}
      </td>

      {/* คัดกรอง — inline 3 ปุ่มไอคอน */}
      <td className="px-3 py-2.5 whitespace-nowrap">
        {canWrite ? (
          <div className="flex items-center gap-1">
            {SCREENING_VERDICTS.map((v) => {
              const Icon = VERDICT_ICON[v];
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => changeVerdict(v)}
                  disabled={isPending}
                  title={SCREENING_VERDICT_LABELS[v]}
                  aria-label={SCREENING_VERDICT_LABELS[v]}
                  aria-pressed={verdict === v}
                  className={`size-7 grid place-items-center rounded-lg border transition-colors ${
                    verdict === v
                      ? SCREENING_VERDICT_ACTIVE_CLASS[v]
                      : "border-zinc-200 bg-white text-zinc-400 hover:text-zinc-700 hover:border-zinc-300"
                  }`}
                >
                  <Icon className="size-3.5" />
                </button>
              );
            })}
          </div>
        ) : ReadonlyVerdictIcon ? (
          <ReadonlyVerdictIcon className="size-4 text-zinc-500" />
        ) : (
          <span className="text-zinc-300">—</span>
        )}
      </td>

      {/* สถานะ — จุดสี + inline select */}
      <td className="px-3 py-2.5 whitespace-nowrap">
        {canWrite ? (
          <div className="inline-flex items-center gap-1.5">
            <span
              className={`size-2 rounded-full shrink-0 ${TONE_DOT[STATUS_TONE[status]] ?? "bg-zinc-400"}`}
            />
            <select
              value={status}
              onChange={(e) => changeStatus(e.target.value as ApplicationStatus)}
              disabled={isPending}
              className="h-9 rounded-lg border border-zinc-300 bg-white px-2 text-xs font-bold text-zinc-800 focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-300)] disabled:opacity-50"
            >
              {APPLICATION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-zinc-700">
            <span
              className={`size-2 rounded-full ${TONE_DOT[STATUS_TONE[status]] ?? "bg-zinc-400"}`}
            />
            {STATUS_LABELS[status]}
          </span>
        )}
      </td>

      {/* ป้าย */}
      <td className="px-3 py-2.5 max-w-[160px]">
        <div className="flex flex-wrap gap-1">
          {row.tags.slice(0, 3).map((raw) => {
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
          {row.tags.length > 3 && (
            <span className="text-[10px] text-zinc-400">+{row.tags.length - 3}</span>
          )}
          {row.tags.length === 0 && <span className="text-zinc-300">—</span>}
        </div>
      </td>

      {/* วันสมัคร */}
      <td className="px-3 py-2.5 whitespace-nowrap text-[11px] text-zinc-500">
        {row.submittedAt ?? "ยังไม่ส่ง"}
      </td>

      {/* เปิดเต็มหน้า */}
      <td className="px-3 py-2.5">
        <Link
          href={`/recruit/applications/${row.id}`}
          className="inline-flex items-center gap-1 text-[11px] font-bold text-[var(--color-brand-700)] hover:underline whitespace-nowrap"
        >
          ดูประวัติ
          <ExternalLink className="size-3" />
        </Link>
      </td>
    </tr>
  );
}
