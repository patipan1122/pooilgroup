// ConfidenceTag — แสดงความมั่นใจของ AI ต่อค่าที่อ่านได้ (per-field).
// ocr_confidence เก็บเป็น jsonb { vendor: 0.9, total: 0.95, ... } (0..1).
// สีเตือนเมื่อ AI ไม่มั่นใจ → บัญชีต้องตรวจช่องนั้นเป็นพิเศษ (ห้าม auto-post).
import { cn } from "@/lib/utils/cn";

type Level = "high" | "mid" | "low";

function levelOf(score: number): Level {
  if (score >= 0.85) return "high";
  if (score >= 0.6) return "mid";
  return "low";
}

const STYLE: Record<Level, { cls: string; label: string }> = {
  high: { cls: "bg-emerald-50 text-emerald-700 ring-emerald-200", label: "มั่นใจสูง" },
  mid: { cls: "bg-amber-50 text-amber-700 ring-amber-200", label: "ควรตรวจ" },
  low: { cls: "bg-rose-50 text-rose-700 ring-rose-200", label: "ไม่มั่นใจ" },
};

export function ConfidenceTag({
  score,
  showLabel = false,
  className,
}: {
  /** 0..1 — null/undefined = ไม่มีข้อมูล (ไม่แสดง). */
  score: number | null | undefined;
  showLabel?: boolean;
  className?: string;
}) {
  if (score == null || Number.isNaN(score)) return null;
  const clamped = Math.max(0, Math.min(1, score));
  const lv = levelOf(clamped);
  const s = STYLE[lv];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ring-1",
        s.cls,
        className,
      )}
      title={`AI ${s.label} · ${Math.round(clamped * 100)}%`}
    >
      {Math.round(clamped * 100)}%
      {showLabel && <span className="font-medium">· {s.label}</span>}
    </span>
  );
}
