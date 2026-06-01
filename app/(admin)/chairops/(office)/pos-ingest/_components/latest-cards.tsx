// Wave-2 (CEO 2026-06-01) · 3 cards summarising "latest data per StarThing
// file type" on the /pos-ingest landing. Showing IN-DATA timestamp (newest
// bizDate / eventAt) PLUS upload-side timestamp + uploader filename — so the
// admin can tell whether they're behind on a particular feed at a glance.
//
// Tone:
//   - green   = fresh (< 24h)
//   - amber   = stale (24h–48h)
//   - rose    = very stale (> 48h)
//   - neutral = no data yet

import { Banknote, Coins, FileSpreadsheet, History } from "lucide-react";
import type { LatestPerType } from "@/app/(admin)/chairops/pos-ingest/multi-actions";

const FRESH_MS = 24 * 60 * 60 * 1000;
const STALE_MS = 48 * 60 * 60 * 1000;

function tone(latest: Date | null, nowMs: number): "fresh" | "stale" | "rotten" | "empty" {
  if (!latest) return "empty";
  const age = nowMs - latest.getTime();
  if (age <= FRESH_MS) return "fresh";
  if (age <= STALE_MS) return "stale";
  return "rotten";
}

function toneClass(t: "fresh" | "stale" | "rotten" | "empty"): string {
  switch (t) {
    case "fresh":
      return "border-emerald-300 bg-emerald-50/60";
    case "stale":
      return "border-amber-300 bg-amber-50/60";
    case "rotten":
      return "border-rose-300 bg-rose-50/60";
    case "empty":
      return "border-zinc-200 bg-white";
  }
}

function ageLabel(latest: Date | null, nowMs: number): string {
  if (!latest) return "ยังไม่มีข้อมูล";
  const ageMs = nowMs - latest.getTime();
  const hours = Math.floor(ageMs / (60 * 60 * 1000));
  if (hours < 1) return "เพิ่งอัปเดต";
  if (hours < 24) return `${hours} ชม.ก่อน`;
  const days = Math.floor(hours / 24);
  return `${days} วันก่อน`;
}

function fmtTime(d: Date | null): string {
  if (!d) return "—";
  // Thai locale + Bangkok TZ · matches the rest of /chairops surfaces.
  return d.toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function LatestDataCards({ data }: { data: LatestPerType }) {
  // Server component · single render-time snapshot per request.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();

  const dailyLatest = data.daily.latestDate ? new Date(`${data.daily.latestDate}T23:59:59+07:00`) : null;

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <LatestCard
        icon={<FileSpreadsheet className="h-5 w-5" aria-hidden />}
        title="POS รายวัน"
        subtitle="ยอดขายรวมต่อสาขา (daily)"
        latestPretty={data.daily.latestDate ?? "—"}
        latestSecondary={ageLabel(dailyLatest, now)}
        toneKey={tone(dailyLatest, now)}
        lastUploadAt={data.daily.lastUploadAt}
        lastUploadName={data.daily.lastUploadName}
      />
      <LatestCard
        icon={<Banknote className="h-5 w-5" aria-hidden />}
        title="ประวัติเงินสด"
        subtitle="cash event — ลูกค้าหยอด timestamped"
        latestPretty={fmtTime(data.cash.latestEventAt)}
        latestSecondary={ageLabel(data.cash.latestEventAt, now)}
        toneKey={tone(data.cash.latestEventAt, now)}
        lastUploadAt={data.cash.lastUploadAt}
        lastUploadName={data.cash.lastUploadName}
      />
      <LatestCard
        icon={<Coins className="h-5 w-5" aria-hidden />}
        title="ประวัติเหรียญ"
        subtitle="coin event — เหรียญหยอด timestamped"
        latestPretty={fmtTime(data.coin.latestEventAt)}
        latestSecondary={ageLabel(data.coin.latestEventAt, now)}
        toneKey={tone(data.coin.latestEventAt, now)}
        lastUploadAt={data.coin.lastUploadAt}
        lastUploadName={data.coin.lastUploadName}
      />
    </div>
  );
}

function LatestCard({
  icon,
  title,
  subtitle,
  latestPretty,
  latestSecondary,
  toneKey,
  lastUploadAt,
  lastUploadName,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  latestPretty: string;
  latestSecondary: string;
  toneKey: "fresh" | "stale" | "rotten" | "empty";
  lastUploadAt: Date | null;
  lastUploadName: string | null;
}) {
  return (
    <div className={`rounded-xl border p-4 ${toneClass(toneKey)}`}>
      <div className="flex items-center gap-2 text-zinc-700">
        {icon}
        <span className="text-sm font-semibold">{title}</span>
      </div>
      <div className="mt-0.5 text-[11px] text-zinc-500">{subtitle}</div>

      <div className="mt-3">
        <div className="text-[11px] uppercase tracking-wide text-zinc-500">
          ข้อมูลล่าสุดถึง
        </div>
        <div className="text-base font-bold tabular-nums text-zinc-900">
          {latestPretty}
        </div>
        <div className="text-[11px] text-zinc-600">{latestSecondary}</div>
      </div>

      <div className="mt-3 flex items-start gap-1.5 border-t border-zinc-200/70 pt-2 text-[11px] text-zinc-500">
        <History className="h-3.5 w-3.5 shrink-0 translate-y-0.5" aria-hidden />
        <div className="flex flex-col leading-tight">
          <span>
            อัปโหลดล่าสุด: <span className="font-medium text-zinc-700">{fmtTime(lastUploadAt)}</span>
          </span>
          {lastUploadName && (
            <span className="truncate" title={lastUploadName}>
              ไฟล์: {lastUploadName}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
