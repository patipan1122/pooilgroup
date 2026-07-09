"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  APPLICATION_STATUSES,
  STATUS_LABELS,
  SCREENING_VERDICTS,
  SCREENING_VERDICT_LABELS,
  SCREENING_VERDICT_ACTIVE_CLASS,
  TAG_COLORS,
  TAG_COLOR_CHIP,
  TAG_COLOR_LABELS,
  TAG_COLOR_SWATCH,
  parseTag,
  serializeTag,
  type ApplicationStatus,
  type ScreeningVerdict,
  type TagColor,
} from "@/lib/recruit/types";
import {
  changeApplicationStatus,
  setApplicationRating,
  setApplicationTags,
  setScreeningVerdict,
} from "@/lib/recruit/actions";
import { applyRulesToApplication } from "@/lib/recruit/rule-actions";
import {
  Star,
  X,
  Plus,
  Zap,
  Loader2,
  ThumbsUp,
  ThumbsDown,
  Meh,
  type LucideIcon,
} from "lucide-react";
import { ScheduleInterviewButton } from "./schedule-interview-button";

// ไอคอน Lucide ต่อผลคัดกรอง (แทนอิโมจิ · ตาม tokens Lucide-only · ความหมายเดิม)
const VERDICT_ICON: Record<ScreeningVerdict, LucideIcon> = {
  INTERESTING: ThumbsUp,
  MAYBE: Meh,
  NOT_INTERESTED: ThumbsDown,
};

interface Props {
  applicationId: string;
  currentStatus: ApplicationStatus;
  currentRating: number | null;
  currentTags: string[];
  currentVerdict: ScreeningVerdict | null;
}

export function ApplicationActions({
  applicationId,
  currentStatus,
  currentRating,
  currentTags,
  currentVerdict,
}: Props) {
  const [status, setStatus] = useState(currentStatus);
  const [rating, setRating] = useState(currentRating);
  const [verdict, setVerdict] = useState(currentVerdict);
  const [tags, setTags] = useState(currentTags);
  const [tagInput, setTagInput] = useState("");
  const [tagColor, setTagColor] = useState<TagColor>("green");
  const [isPending, startTransition] = useTransition();
  const [applyingRules, setApplyingRules] = useState(false);

  function runAllRules() {
    if (applyingRules) return;
    setApplyingRules(true);
    startTransition(async () => {
      try {
        const res = await applyRulesToApplication(applicationId);
        if (res.applied.length === 0) {
          toast.info("ไม่มีกฎที่ตรงกับใบสมัครนี้");
        } else {
          toast.success(`ใช้กฎ ${res.applied.length} ข้อ: ${res.applied.join(" · ")}`);
        }
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setApplyingRules(false);
      }
    });
  }

  function changeStatus(next: ApplicationStatus) {
    if (next === status) return;
    const prev = status;
    setStatus(next); // optimistic
    startTransition(async () => {
      try {
        await changeApplicationStatus(applicationId, next);
        toast.success(`เปลี่ยน status → ${STATUS_LABELS[next]}`);
      } catch (e) {
        setStatus(prev);
        toast.error((e as Error).message);
      }
    });
  }

  function changeRating(next: number | null) {
    const prev = rating;
    setRating(next);
    startTransition(async () => {
      try {
        await setApplicationRating(applicationId, next);
      } catch (e) {
        setRating(prev);
        toast.error((e as Error).message);
      }
    });
  }

  function changeVerdict(next: ScreeningVerdict) {
    const prev = verdict;
    // กดซ้ำอันเดิม = ยกเลิก (toggle)
    const value = verdict === next ? null : next;
    setVerdict(value);
    startTransition(async () => {
      try {
        await setScreeningVerdict(applicationId, value);
        toast.success(
          value ? `คัดกรอง: ${SCREENING_VERDICT_LABELS[value]}` : "ล้างผลคัดกรอง",
        );
      } catch (e) {
        setVerdict(prev);
        toast.error((e as Error).message);
      }
    });
  }

  function addTag() {
    const label = tagInput.trim();
    if (!label) return;
    const serialized = serializeTag(tagColor, label);
    if (tags.includes(serialized)) return;
    const next = [...tags, serialized];
    setTags(next);
    setTagInput("");
    startTransition(async () => {
      try {
        await setApplicationTags(applicationId, next);
      } catch (e) {
        setTags(tags);
        toast.error((e as Error).message);
      }
    });
  }

  function removeTag(t: string) {
    const next = tags.filter((x) => x !== t);
    setTags(next);
    startTransition(async () => {
      try {
        await setApplicationTags(applicationId, next);
      } catch (e) {
        setTags(tags);
        toast.error((e as Error).message);
      }
    });
  }

  return (
    <div className="mt-4 mb-6 rounded-2xl border border-zinc-200 bg-white p-4 space-y-3">
      {/* Quick action row */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-3 border-b border-zinc-100">
        <p className="text-xs font-bold text-zinc-700">การดำเนินการ</p>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <button
            type="button"
            onClick={runAllRules}
            disabled={applyingRules || isPending}
            title="ใช้กฎคัดอัตโนมัติทั้งหมดกับใบสมัครนี้"
            className="inline-flex items-center justify-center gap-1.5 w-full sm:w-auto h-11 px-3 rounded-lg text-xs font-bold border border-amber-200 bg-gradient-to-br from-amber-50 to-white text-amber-800 hover:bg-amber-100 disabled:opacity-50 transition-colors"
          >
            {applyingRules ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Zap className="size-3.5" />
            )}
            ใช้กฎทั้งหมด
          </button>
          <ScheduleInterviewButton applicationId={applicationId} />
        </div>
      </div>

      {/* คัดกรองเร็ว — ตัดสินรอบแรก (น่าสนใจ/พอใช้ได้/ไม่สนใจ) + ดาว · อยู่บนสุด กดง่ายสุด */}
      <div className="rounded-xl border border-[var(--color-brand-100)] bg-[var(--color-brand-50)]/40 p-3 space-y-3">
        <div>
          <p className="text-xs text-zinc-500 font-bold mb-2">คัดกรองเร็ว</p>
          <div className="flex flex-wrap gap-2">
            {SCREENING_VERDICTS.map((v) => {
              const Icon = VERDICT_ICON[v];
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => changeVerdict(v)}
                  disabled={isPending}
                  className={`inline-flex items-center gap-1.5 h-11 px-4 rounded-xl text-sm font-bold border-2 transition-colors ${
                    verdict === v
                      ? SCREENING_VERDICT_ACTIVE_CLASS[v]
                      : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
                  }`}
                  aria-pressed={verdict === v}
                >
                  <Icon className="size-4" />
                  {SCREENING_VERDICT_LABELS[v]}
                </button>
              );
            })}
          </div>
        </div>

        {/* Rating */}
        <div className="flex items-center gap-3 flex-wrap">
          <p className="text-xs text-zinc-500 font-bold">ให้ดาว</p>
          <div className="flex gap-0.5">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => changeRating(rating === n ? null : n)}
                disabled={isPending}
                className="size-10 inline-flex items-center justify-center hover:scale-110 transition-transform"
                aria-label={`${n} ดาว`}
              >
                <Star
                  className={`size-6 ${
                    rating != null && rating >= n
                      ? "fill-amber-400 text-amber-400"
                      : "text-zinc-300"
                  }`}
                />
              </button>
            ))}
          </div>
          {rating != null && (
            <button
              type="button"
              onClick={() => changeRating(null)}
              className="text-xs text-zinc-500 hover:text-zinc-900 h-10 px-2"
            >
              ลบดาว
            </button>
          )}
        </div>
      </div>

      {/* Status pill row */}
      <div>
        <p className="text-xs text-zinc-500 font-bold mb-2">
          เปลี่ยนสถานะ
        </p>
        <div className="flex flex-wrap gap-1.5">
          {APPLICATION_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => changeStatus(s)}
              disabled={isPending}
              className={`text-xs h-10 px-3 rounded-full font-medium border transition-colors ${
                status === s
                  ? `border-[var(--color-brand-500)] bg-[var(--color-brand-50)] text-[var(--color-brand-800)]`
                  : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"
              }`}
            >
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      {/* Tags */}
      <div>
        <p className="text-xs text-zinc-500 font-bold mb-1.5">
          ป้ายกำกับ
        </p>
        <div className="flex flex-wrap items-center gap-1.5 mb-2">
          {tags.map((raw) => {
            const { color, label } = parseTag(raw);
            return (
              <span
                key={raw}
                className={`inline-flex items-center gap-1 rounded-full text-xs px-2.5 py-1 font-bold ${TAG_COLOR_CHIP[color]}`}
              >
                {label}
                <button
                  type="button"
                  onClick={() => removeTag(raw)}
                  className="opacity-70 hover:opacity-100"
                  aria-label={`ลบป้าย ${label}`}
                >
                  <X className="size-3" />
                </button>
              </span>
            );
          })}
        </div>
        {/* Color picker + input */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1">
            {TAG_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setTagColor(c)}
                className={`size-7 rounded-full ${TAG_COLOR_SWATCH[c]} ring-offset-2 transition-all ${
                  tagColor === c
                    ? "ring-2 ring-zinc-900 scale-110"
                    : "ring-1 ring-zinc-200 hover:scale-105"
                }`}
                title={TAG_COLOR_LABELS[c]}
                aria-label={TAG_COLOR_LABELS[c]}
              />
            ))}
          </div>
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTag();
                }
              }}
              placeholder="เพิ่มป้าย..."
              className="text-sm rounded-lg border border-zinc-300 px-3 h-10 w-36 focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-300)]"
              maxLength={20}
            />
            <button
              type="button"
              onClick={addTag}
              disabled={!tagInput.trim()}
              aria-label="เพิ่มป้าย"
              className={`size-10 inline-flex items-center justify-center rounded-lg font-bold ${TAG_COLOR_CHIP[tagColor]} disabled:opacity-30`}
            >
              <Plus className="size-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
