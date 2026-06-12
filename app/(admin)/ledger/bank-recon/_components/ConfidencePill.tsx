"use client";

// ConfidencePill — visual indicator for auto-match confidence level.
// 3 states matching PEAK Account's color logic:
//   high   = green (exact amount + date)
//   medium = amber (amount within range)
//   low    = zinc/gray (loose match)
// Used in the Match panel left column.

type Confidence = "high" | "medium" | "low" | null;

const CONFIG: Record<NonNullable<Confidence>, { label: string; className: string }> = {
  high:   { label: "ตรงกัน",    className: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  medium: { label: "ใกล้เคียง", className: "bg-amber-100 text-amber-700 border-amber-200" },
  low:    { label: "คาดเดา",   className: "bg-zinc-100 text-zinc-500 border-zinc-200" },
};

export function ConfidencePill({ confidence }: { confidence: Confidence }) {
  if (!confidence) return null;
  const { label, className } = CONFIG[confidence];
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${className}`}>
      {label}
    </span>
  );
}

// Status pill for match_state
export function MatchStatePill({ state }: { state: string }) {
  const map: Record<string, { label: string; className: string }> = {
    unmatched: { label: "รอกระทบยอด",    className: "bg-zinc-100 text-zinc-600 border-zinc-200" },
    suggested: { label: "รอยืนยัน",      className: "bg-amber-100 text-amber-700 border-amber-200" },
    confirmed: { label: "กระทบยอดแล้ว", className: "bg-emerald-100 text-emerald-700 border-emerald-200" },
    excluded:  { label: "ข้าม",          className: "bg-red-100 text-red-600 border-red-200" },
  };
  const cfg = map[state] ?? map.unmatched;
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${cfg.className}`}>
      {cfg.label}
    </span>
  );
}

// Status icon for hub (🟢🔵⚫ pattern matching PEAK Account)
export function BankAccountStatusIcon({
  status,
}: {
  status: "not_started" | "in_progress" | "completed" | "locked";
}) {
  const map = {
    not_started: { dot: "⚫", label: "ยังไม่เริ่ม",  className: "text-zinc-400" },
    in_progress: { dot: "🔵", label: "กำลังทำ",       className: "text-blue-600" },
    completed:   { dot: "🟢", label: "เสร็จแล้ว",     className: "text-emerald-600" },
    locked:      { dot: "🔒", label: "ล็อคแล้ว",      className: "text-purple-600" },
  };
  const { dot, label, className } = map[status];
  return (
    <span className={`flex items-center gap-1 text-sm font-medium ${className}`}>
      <span>{dot}</span>
      <span className="hidden sm:inline">{label}</span>
    </span>
  );
}
