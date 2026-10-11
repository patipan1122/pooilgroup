"use client";

/* ============================================================
   TagCombobox — dropdown-first tag picker with an explicit "add new"
   action (CEO click-report item 4, 2026-10-10).
   ------------------------------------------------------------
   Before: a free-text <Input> with a floating autocomplete panel where
   pressing Enter/comma (or blurring the field) silently committed
   whatever was typed as a brand-new tag — indistinguishable from picking
   an existing one, and easy to create near-duplicate tags by typo.

   Now: typing filters a dropdown of EXISTING org tags (click to select —
   same behavior as before). Creating a genuinely new tag requires a
   separate, visually distinct row ("+ เพิ่ม tag ใหม่: "...") that only
   appears when the typed text doesn't exactly match an existing tag, and
   the user must deliberately click it. Enter no longer creates anything
   (it's `preventDefault`-ed only, so it can't also submit the outer
   upload form).

   Pattern reused from SignerPicker in signature-placement-editor.tsx
   (shipped recently in this same module) for visual/interaction
   consistency — same shape: a text input that opens a dropdown of
   filtered matches on focus/typing, closes on outside click, and uses
   onMouseDown+preventDefault on dropdown rows so a blur doesn't fire
   (and no stray "create" side effect run) before the click handler.
   ============================================================ */

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export interface TagComboboxProps {
  id?: string;
  /** Tags already attached to this document — rendered as removable chips. */
  selected: string[];
  /** Org-wide tags to offer in the dropdown (already excludes `selected`). */
  availableTags: string[];
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

const MAX_TAG_LENGTH = 40;
const MAX_SUGGESTIONS = 20;

export function TagCombobox({
  id,
  selected,
  availableTags,
  onAdd,
  onRemove,
  disabled,
  placeholder,
}: TagComboboxProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const selectedLower = useMemo(
    () => new Set(selected.map((t) => t.toLowerCase())),
    [selected],
  );

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    const pool = availableTags.filter((t) => !selectedLower.has(t.toLowerCase()));
    if (!q) return pool.slice(0, MAX_SUGGESTIONS);
    return pool.filter((t) => t.toLowerCase().includes(q)).slice(0, MAX_SUGGESTIONS);
  }, [availableTags, selectedLower, q]);

  const trimmed = query.trim();
  // "+ เพิ่ม tag ใหม่" only shows when the typed text is non-empty AND doesn't
  // exactly match an existing (or already-selected) tag — exact match means
  // the user is just finding/re-picking something that already exists.
  const exactMatch =
    trimmed.length === 0 ||
    availableTags.some((t) => t.toLowerCase() === q) ||
    selectedLower.has(q);
  const showCreateNew = trimmed.length > 0 && !exactMatch;

  function pick(tag: string) {
    const clean = tag.trim().slice(0, MAX_TAG_LENGTH);
    if (!clean) return;
    onAdd(clean);
    setQuery("");
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="space-y-2">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[var(--color-brand-50)] border-2 border-[var(--color-brand-200)] text-xs"
            >
              #{t}
              <button
                type="button"
                onClick={() => onRemove(t)}
                disabled={disabled}
                className="text-zinc-400 hover:text-zinc-700"
                aria-label={`ลบ tag ${t}`}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="relative">
        <input
          id={id}
          type="text"
          value={query}
          disabled={disabled}
          placeholder={placeholder ?? "พิมพ์ค้นหา tag เดิม…"}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            // Deliberately no create-on-Enter anymore — creating a tag is
            // now ONLY possible via the explicit "+ เพิ่ม tag ใหม่" row
            // below. Still preventDefault so Enter doesn't fall through
            // and submit the outer upload form.
            if (e.key === "Enter") e.preventDefault();
          }}
          className="w-full h-10 px-3 text-sm rounded-xl border-2 border-zinc-200 bg-white focus:border-[var(--color-brand-500)] focus:outline-none disabled:bg-zinc-50 disabled:text-zinc-400"
        />
        {open && (filtered.length > 0 || showCreateNew || q.length > 0) && (
          <div className="absolute left-0 right-0 top-full mt-1 rounded-xl border-2 border-zinc-200 bg-white shadow-pop z-20 max-h-56 overflow-y-auto">
            {filtered.map((t) => (
              <button
                key={t}
                type="button"
                // onMouseDown (not onClick) fires before the input's blur —
                // same ordering trick SignerPicker/the old tag panel used —
                // so nothing else (e.g. a future onBlur handler) runs first.
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(t);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-50 transition-colors border-b border-zinc-50 last:border-b-0"
              >
                <span className="text-zinc-400">#</span>
                <span className="flex-1 truncate text-zinc-800">{t}</span>
              </button>
            ))}
            {filtered.length === 0 && !showCreateNew && (
              <p className="px-3 py-2 text-xs text-zinc-500">ไม่พบ tag ที่ค้นหา</p>
            )}
            {showCreateNew && (
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(trimmed);
                }}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2.5 text-left text-sm font-medium",
                  "text-[var(--color-brand-700)] hover:bg-[var(--color-brand-50)] transition-colors",
                  filtered.length > 0 && "border-t border-zinc-100",
                )}
              >
                <Plus size={14} className="shrink-0" />
                <span className="truncate">
                  เพิ่ม tag ใหม่: &quot;{trimmed}&quot;
                </span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
