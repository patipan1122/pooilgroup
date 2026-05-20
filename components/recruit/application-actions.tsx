"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  APPLICATION_STATUSES,
  STATUS_LABELS,
  STATUS_TONE,
  type ApplicationStatus,
} from "@/lib/recruit/types";
import {
  changeApplicationStatus,
  setApplicationRating,
  setApplicationTags,
} from "@/lib/recruit/actions";
import { Badge } from "@/components/ui/badge";
import { Star, X, Plus } from "lucide-react";

interface Props {
  applicationId: string;
  currentStatus: ApplicationStatus;
  currentRating: number | null;
  currentTags: string[];
}

export function ApplicationActions({
  applicationId,
  currentStatus,
  currentRating,
  currentTags,
}: Props) {
  const [status, setStatus] = useState(currentStatus);
  const [rating, setRating] = useState(currentRating);
  const [tags, setTags] = useState(currentTags);
  const [tagInput, setTagInput] = useState("");
  const [isPending, startTransition] = useTransition();

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

  function addTag() {
    const t = tagInput.trim();
    if (!t || tags.includes(t)) return;
    const next = [...tags, t];
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
      {/* Status pill row */}
      <div>
        <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-400 font-bold mb-2">
          เปลี่ยน status
        </p>
        <div className="flex flex-wrap gap-1.5">
          {APPLICATION_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => changeStatus(s)}
              disabled={isPending}
              className={`text-xs px-2.5 py-1 rounded-full font-medium border transition-colors ${
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

      {/* Rating */}
      <div className="flex items-center gap-3">
        <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-400 font-bold">
          ดาว
        </p>
        <div className="flex gap-0.5">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => changeRating(rating === n ? null : n)}
              disabled={isPending}
              className="hover:scale-110 transition-transform"
              aria-label={`${n} ดาว`}
            >
              <Star
                className={`size-5 ${
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
            className="text-[10px] text-zinc-400 hover:text-zinc-700"
          >
            ลบ
          </button>
        )}
      </div>

      {/* Tags */}
      <div>
        <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-400 font-bold mb-1.5">
          Tag
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {tags.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 rounded-full bg-[var(--color-brand-50)] text-[var(--color-brand-800)] text-xs px-2 py-1 font-medium"
            >
              {t}
              <button
                type="button"
                onClick={() => removeTag(t)}
                className="hover:text-red-700"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
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
              placeholder="เพิ่ม tag..."
              className="text-xs rounded-lg border border-zinc-200 px-2 py-1 w-28 focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-300)]"
              maxLength={20}
            />
            {tagInput && (
              <button
                type="button"
                onClick={addTag}
                className="text-[var(--color-brand-700)] hover:text-[var(--color-brand-900)]"
              >
                <Plus className="size-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
