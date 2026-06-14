"use client";

import { useEffect, useRef, useState } from "react";
import { Info, X } from "lucide-react";
import {
  RS_STATE_LEGEND,
  RS_STATE_META,
  type RsUnitState,
} from "@/lib/rentspace/status";

/**
 * "คำอธิบายสถานะ" — compact button that opens a small panel explaining each
 * room status (color swatch + label + description). Optional `counts` shows how
 * many units sit in each state. Pure --rs-* tokens, restrained styling.
 */
export function StatusLegend({
  className,
  counts,
}: {
  className?: string;
  counts?: Partial<Record<RsUnitState, number>>;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // close on outside-click + Escape
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className={`relative inline-block ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="คำอธิบายสถานะ"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-semibold"
        style={{ background: "var(--rs-bg-3)", color: "var(--rs-text-2)" }}
      >
        <Info className="h-3.5 w-3.5" />
        คำอธิบายสถานะ
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="คำอธิบายสถานะห้อง"
          className="absolute right-0 z-50 mt-2 w-[290px] rounded-xl p-3 shadow-xl"
          style={{
            background: "#fff",
            border: "1px solid var(--rs-border)",
          }}
        >
          <div className="flex items-center justify-between pb-2">
            <span className="text-[13px] font-bold" style={{ color: "var(--rs-text)" }}>
              คำอธิบายสถานะห้อง
            </span>
            <button
              type="button"
              aria-label="ปิด"
              onClick={() => setOpen(false)}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md"
              style={{ color: "var(--rs-text-3)" }}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <ul className="space-y-2.5">
            {RS_STATE_LEGEND.map((state) => {
              const m = RS_STATE_META[state];
              const count = counts?.[state];
              return (
                <li key={state} className="flex items-start gap-2.5">
                  <span
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-[4px]"
                    style={{ background: m.soft, border: `1.5px solid ${m.color}` }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className="text-[12.5px] font-semibold leading-tight"
                        style={{ color: "var(--rs-text)" }}
                      >
                        {m.label}
                      </span>
                      {count != null && (
                        <span
                          className="shrink-0 text-[11.5px] font-bold tabular-nums"
                          style={{ color: m.color }}
                        >
                          {count}
                        </span>
                      )}
                    </div>
                    <p
                      className="mt-0.5 text-[11.5px] leading-snug"
                      style={{ color: "var(--rs-text-3)" }}
                    >
                      {m.desc}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
