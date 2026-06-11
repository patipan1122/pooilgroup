"use client";

// Searchable select: a native <select> with a small toggle-search button on the right.
// Pressing 🔍 shows/hides a text input that filters the option list in real time.
// The extra input only appears when the user actively wants to search — no permanent
// extra height in the normal (collapsed) state.
import { useState, useMemo, useRef } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export interface SelectOpt {
  id: string;
  name: string;
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "— เลือก —",
  disabled = false,
  className,
  selectClassName,
  searchPlaceholder = "ค้นหา...",
  label,
}: {
  options: SelectOpt[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Extra classes forwarded to the <select> element (e.g. error highlight ring). */
  selectClassName?: string;
  searchPlaceholder?: string;
  /** Accessible name for the <select> (aria-label). Falls back to placeholder. */
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.name.toLowerCase().includes(q));
  }, [options, search]);

  function toggleSearch() {
    if (open) {
      setOpen(false);
      setSearch("");
    } else {
      setOpen(true);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  return (
    <div className={cn(disabled && "pointer-events-none opacity-50", className)}>
      {/* Search input — only shown after toggling the 🔍 button */}
      {open && (
        <div className="relative mb-1.5">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400" />
          <input
            ref={inputRef}
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-9 w-full rounded-lg border border-zinc-200 bg-zinc-50 pl-8 pr-7 text-sm outline-none focus:bg-white focus:ring-2 focus:ring-[var(--color-brand-200)]"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
              aria-label="ล้างการค้นหา"
            >
              <X className="size-3.5" />
            </button>
          )}
          {open && filtered.length === 0 && search && (
            <p className="mt-0.5 text-[11px] text-zinc-500">ไม่พบรายการที่ค้นหา</p>
          )}
        </div>
      )}

      {/* Select + small search-toggle button side by side */}
      <div className="flex gap-1.5">
        <select
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label ?? placeholder}
          className={cn(
            "h-11 flex-1 rounded-lg border border-zinc-200 bg-white px-2 text-base outline-none focus:ring-2 focus:ring-[var(--color-brand-200)] disabled:bg-zinc-50 disabled:text-zinc-500 sm:h-9 sm:text-sm",
            selectClassName,
          )}
        >
          <option value="">{placeholder}</option>
          {filtered.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>

        {/* Small 🔍 toggle button — same height as the select, width fixed 36px */}
        <button
          type="button"
          onClick={toggleSearch}
          aria-label={open ? "ปิดการค้นหา" : "ค้นหา"}
          title={open ? "ปิดการค้นหา" : "ค้นหา"}
          className={cn(
            "inline-flex h-11 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors sm:h-9",
            open
              ? "border-[var(--color-brand-300)] bg-[var(--color-brand-50)] text-[var(--color-brand-600)]"
              : "border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50",
          )}
        >
          {open ? <X className="size-3.5" /> : <Search className="size-3.5" />}
        </button>
      </div>
    </div>
  );
}
