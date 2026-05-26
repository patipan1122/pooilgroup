// ClawFleet Hub — GreetingHeader
// Light page header (NOT a card) · greets user + shows Thai date + time.
// Server-rendered timestamp; no client interval needed (page is force-dynamic).

import { thaiDateLong, bkkTime } from "@/lib/utils/format";
import { Sun, Moon, Sunset, Sunrise } from "lucide-react";

interface GreetingHeaderProps {
  userName: string;
  /** Optional override — defaults to "now". Useful for testing. */
  now?: Date;
}

function greetingFor(hour: number): { text: string; Icon: typeof Sun } {
  if (hour < 5) return { text: "ราตรีสวัสดิ์คุณ", Icon: Moon };
  if (hour < 11) return { text: "อรุณสวัสดิ์คุณ", Icon: Sunrise };
  if (hour < 16) return { text: "สวัสดีตอนบ่ายคุณ", Icon: Sun };
  if (hour < 19) return { text: "สวัสดีตอนเย็นคุณ", Icon: Sunset };
  return { text: "สวัสดีตอนค่ำคุณ", Icon: Moon };
}

export function GreetingHeader({ userName, now }: GreetingHeaderProps) {
  const dt = now ?? new Date();
  // Use Bangkok hour for greeting decision
  const bkkHour = parseInt(
    new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      hour12: false,
      timeZone: "Asia/Bangkok",
    }).format(dt),
    10,
  );
  const { text, Icon } = greetingFor(bkkHour);
  const dateLabel = thaiDateLong(dt);
  const timeLabel = bkkTime(dt);

  return (
    <div className="pb-6">
      <div className="flex items-center gap-2 text-zinc-500 mb-1.5">
        <Icon className="h-4 w-4" />
        <span className="text-sm">
          {dateLabel} · {timeLabel} น.
        </span>
      </div>
      <h1 className="text-2xl sm:text-3xl font-bold text-zinc-900 tracking-tight">
        {text} <span className="text-[var(--color-brand-700)]">{userName}</span>
      </h1>
    </div>
  );
}
