"use client";

// ชิ้นส่วนแถวผู้สมัครที่ใช้ร่วมกันระหว่าง "ตาราง" (desktop) และ "การ์ด" (มือถือ)
// — StatusSelect · VerdictButtons · InterviewNoteCell
// เก็บ logic เปลี่ยนสถานะ/คัดกรอง/บันทึกสัมภาษณ์ ไว้ที่เดียว (source of truth เดียว)

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  APPLICATION_STATUSES,
  STATUS_LABELS,
  STATUS_TONE,
  SCREENING_VERDICTS,
  SCREENING_VERDICT_LABELS,
  SCREENING_VERDICT_ACTIVE_CLASS,
  type ApplicationStatus,
  type ScreeningVerdict,
} from "@/lib/recruit/types";
import {
  changeApplicationStatus,
  setScreeningVerdict,
  addApplicationNote,
} from "@/lib/recruit/actions";
import {
  ThumbsUp,
  ThumbsDown,
  Meh,
  MessageSquarePlus,
  Check,
  X,
  type LucideIcon,
} from "lucide-react";

// ไอคอนต่อผลคัดกรอง (Lucide-only ตาม tokens)
export const VERDICT_ICON: Record<ScreeningVerdict, LucideIcon> = {
  INTERESTING: ThumbsUp,
  MAYBE: Meh,
  NOT_INTERESTED: ThumbsDown,
};

// สีจุดสถานะ (มองปราดเดียวรู้)
export const TONE_DOT: Record<string, string> = {
  brand: "bg-[var(--color-brand-500)]",
  warning: "bg-amber-500",
  orange: "bg-orange-500",
  purple: "bg-purple-500",
  success: "bg-green-500",
  danger: "bg-red-500",
  neutral: "bg-zinc-400",
};

export interface LatestNote {
  body: string;
  atLabel: string; // จัดรูปแบบไทยแล้ว เช่น "22 ก.ค. 69"
  author: string;
}

// =============================================================
// สถานะ — จุดสี + dropdown
// =============================================================
export function StatusSelect({
  applicationId,
  fullName,
  initial,
  canWrite,
}: {
  applicationId: string;
  fullName: string;
  initial: ApplicationStatus;
  canWrite: boolean;
}) {
  const [status, setStatus] = useState<ApplicationStatus>(initial);
  const [isPending, startTransition] = useTransition();
  useEffect(() => setStatus(initial), [initial]);

  function change(next: ApplicationStatus) {
    if (next === status) return;
    const prev = status;
    setStatus(next);
    startTransition(async () => {
      try {
        await changeApplicationStatus(applicationId, next);
        toast.success(`${fullName} → ${STATUS_LABELS[next]}`);
      } catch (e) {
        setStatus(prev);
        toast.error((e as Error).message);
      }
    });
  }

  if (!canWrite) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-zinc-700">
        <span
          className={`size-2 rounded-full ${TONE_DOT[STATUS_TONE[status]] ?? "bg-zinc-400"}`}
        />
        {STATUS_LABELS[status]}
      </span>
    );
  }

  return (
    <div className="inline-flex items-center gap-1.5">
      <span
        className={`size-2 rounded-full shrink-0 ${TONE_DOT[STATUS_TONE[status]] ?? "bg-zinc-400"}`}
      />
      <select
        value={status}
        onChange={(e) => change(e.target.value as ApplicationStatus)}
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
  );
}

// =============================================================
// คัดกรอง — 3 ปุ่มไอคอน (น่าสนใจ / พอใช้ได้ / ไม่สนใจ)
// =============================================================
export function VerdictButtons({
  applicationId,
  initial,
  canWrite,
  onChange,
}: {
  applicationId: string;
  initial: ScreeningVerdict | null;
  canWrite: boolean;
  onChange?: (value: ScreeningVerdict | null) => void; // แจ้ง parent (ไฮไลต์แถวสด)
}) {
  const [verdict, setVerdict] = useState<ScreeningVerdict | null>(initial);
  const [isPending, startTransition] = useTransition();
  useEffect(() => setVerdict(initial), [initial]);

  function change(next: ScreeningVerdict) {
    const prev = verdict;
    const value = verdict === next ? null : next;
    setVerdict(value);
    onChange?.(value);
    startTransition(async () => {
      try {
        await setScreeningVerdict(applicationId, value);
      } catch (e) {
        setVerdict(prev);
        onChange?.(prev);
        toast.error((e as Error).message);
      }
    });
  }

  if (!canWrite) {
    const Icon = verdict ? VERDICT_ICON[verdict] : null;
    return Icon ? (
      <Icon className="size-4 text-zinc-500" />
    ) : (
      <span className="text-zinc-300">—</span>
    );
  }

  return (
    <div className="flex items-center gap-1">
      {SCREENING_VERDICTS.map((v) => {
        const Icon = VERDICT_ICON[v];
        return (
          <button
            key={v}
            type="button"
            onClick={() => change(v)}
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
  );
}

// =============================================================
// ช่องบันทึกสัมภาษณ์ — จดต่อเนื่อง (เก็บประวัติ) · โชว์อันล่าสุด + กดเพิ่มได้เลย
// เพิ่ม 1 ครั้ง = 1 โน้ต (append) → ดูประวัติทั้งหมดที่หน้าประวัติรายคน
// =============================================================
export function InterviewNoteCell({
  applicationId,
  initialLatest,
  initialCount,
  canWrite,
  applicationHref,
  variant = "cell",
}: {
  applicationId: string;
  initialLatest: LatestNote | null;
  initialCount: number;
  canWrite: boolean;
  applicationHref: string;
  variant?: "cell" | "card";
}) {
  const [latest, setLatest] = useState<LatestNote | null>(initialLatest);
  const [count, setCount] = useState<number>(initialCount);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [isPending, startTransition] = useTransition();
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setLatest(initialLatest);
    setCount(initialCount);
  }, [initialLatest, initialCount]);

  useEffect(() => {
    if (editing) taRef.current?.focus();
  }, [editing]);

  function save() {
    const text = draft.trim();
    if (!text) {
      setEditing(false);
      setDraft("");
      return;
    }
    startTransition(async () => {
      try {
        const note = await addApplicationNote(applicationId, text);
        setLatest({
          body: note.body,
          atLabel: note.atLabel,
          author: note.authorName,
        });
        setCount((c) => c + 1);
        setDraft("");
        setEditing(false);
        toast.success("บันทึกสัมภาษณ์แล้ว");
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  // Ctrl/Cmd+Enter = บันทึกเร็ว · Esc = ยกเลิก
  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      save();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setEditing(false);
      setDraft("");
    }
  }

  const widthClass = variant === "cell" ? "min-w-[200px] max-w-[260px]" : "w-full";

  if (editing) {
    return (
      <div className={widthClass}>
        <textarea
          ref={taRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          rows={variant === "card" ? 3 : 2}
          disabled={isPending}
          placeholder="สัมภาษณ์แล้วเป็นยังไง เช่น พูดจาดี ตรงงาน ขอเงินเดือน 18k…"
          className="w-full resize-y rounded-lg border border-[var(--color-brand-300)] bg-white px-2 py-1.5 text-[13px] text-zinc-800 focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-300)] disabled:opacity-50"
        />
        <div className="mt-1 flex items-center gap-1.5">
          <button
            type="button"
            onClick={save}
            disabled={isPending || !draft.trim()}
            className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg bg-[var(--color-brand-600)] text-white text-[11px] font-bold hover:bg-[var(--color-brand-700)] disabled:opacity-40"
          >
            <Check className="size-3" />
            บันทึก
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setDraft("");
            }}
            disabled={isPending}
            className="inline-flex items-center gap-1 h-7 px-2 rounded-lg border border-zinc-200 text-zinc-500 text-[11px] font-bold hover:border-zinc-300"
          >
            <X className="size-3" />
            ยกเลิก
          </button>
          <span className="text-[10px] text-zinc-400 hidden sm:inline">
            ⌘/Ctrl+Enter
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={widthClass}>
      {latest ? (
        <div className="space-y-0.5">
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            title={expanded ? "กดเพื่อย่อ" : latest.body}
            className={`block text-left text-[13px] leading-snug text-zinc-700 hover:text-zinc-900 ${
              expanded ? "" : "line-clamp-2"
            }`}
          >
            {latest.body}
          </button>
          <div className="flex items-center gap-1.5 text-[10px] text-zinc-400">
            <span className="truncate max-w-[110px]">{latest.author}</span>
            <span>·</span>
            <span className="whitespace-nowrap">{latest.atLabel}</span>
            {count > 1 && (
              <Link
                href={applicationHref}
                className="ml-0.5 font-bold text-[var(--color-brand-700)] hover:underline whitespace-nowrap"
              >
                ดูทั้งหมด {count}
              </Link>
            )}
          </div>
          {canWrite && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-bold text-[var(--color-brand-700)] hover:underline"
            >
              <MessageSquarePlus className="size-3" />
              เพิ่มบันทึก
            </button>
          )}
        </div>
      ) : canWrite ? (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-dashed border-zinc-300 text-[11px] font-bold text-zinc-500 hover:border-[var(--color-brand-400)] hover:text-[var(--color-brand-700)]"
        >
          <MessageSquarePlus className="size-3.5" />
          บันทึกสัมภาษณ์
        </button>
      ) : (
        <span className="text-zinc-300">—</span>
      )}
    </div>
  );
}
