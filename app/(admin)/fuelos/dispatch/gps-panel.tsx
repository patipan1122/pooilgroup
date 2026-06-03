import { bkkRelative } from "@/lib/fuelos/utils/format";
import { cn } from "@/lib/fuelos/utils/cn";
import { googleMapsLink, type TruckGps } from "@/lib/fuelos/dispatch-data";
import { ExternalLink, Power, PowerOff, Gauge } from "lucide-react";

const STATUS_LABEL: Record<string, string> = {
  IDLE: "ว่าง",
  LOADED: "บรรจุน้ำมัน",
  DISPATCHED: "ออกวิ่ง",
  MAINTENANCE: "ซ่อมบำรุง",
};

const STATUS_TONE: Record<string, string> = {
  IDLE: "bg-zinc-500/10 text-zinc-600",
  LOADED: "bg-info/10 text-info",
  DISPATCHED: "bg-brand-600/10 text-brand-700",
  MAINTENANCE: "bg-warning/15 text-warning",
};

function TruckRow({ truck }: { truck: TruckGps }) {
  const hasCoords = truck.lastLat != null && truck.lastLng != null;
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-start gap-3">
        {/* จุดสี: เขียวกระพริบ = กำลังวิ่ง · เทา = จอด/ดับ */}
        <span className="relative flex size-3 mt-1.5 shrink-0">
          {truck.isMoving && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-leaf-500/70" />
          )}
          <span
            className={cn(
              "relative inline-flex size-3 rounded-full",
              truck.isMoving ? "bg-leaf-500" : truck.lastEngineOn ? "bg-warning" : "bg-zinc-400",
            )}
          />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold font-[family-name:var(--font-plex-mono)]">{truck.plate}</span>
            <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full", STATUS_TONE[truck.status] ?? "bg-zinc-500/10 text-zinc-600")}>
              {STATUS_LABEL[truck.status] ?? truck.status}
            </span>
            {truck.lastEngineOn != null && (
              <span className={cn(
                "inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full",
                truck.lastEngineOn ? "bg-leaf-500/15 text-leaf-700" : "bg-zinc-500/10 text-zinc-500",
              )}>
                {truck.lastEngineOn ? <Power className="size-3" /> : <PowerOff className="size-3" />}
                {truck.lastEngineOn ? "ติดเครื่อง" : "ดับ"}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 mt-1 text-xs text-zinc-500">
            <span className="inline-flex items-center gap-1 tabular-nums">
              <Gauge className="size-3.5" />
              {truck.lastSpeedKmh != null ? `${truck.lastSpeedKmh.toFixed(0)} กม./ชม.` : "—"}
            </span>
            {truck.driverName && <span className="truncate">คนขับ {truck.driverName}</span>}
            <span className="ml-auto whitespace-nowrap">
              {truck.lastSeenAt ? bkkRelative(truck.lastSeenAt) : "ยังไม่มีสัญญาณ"}
            </span>
          </div>

          {/* coordinate chip + ลิงก์แผนที่ */}
          <div className="flex items-center gap-2 mt-2">
            {hasCoords ? (
              <>
                <span className="inline-flex items-center rounded-lg bg-surface-2 px-2 py-1 text-[11px] text-zinc-600 tabular-nums font-[family-name:var(--font-plex-mono)]">
                  {truck.lastLat!.toFixed(5)}, {truck.lastLng!.toFixed(5)}
                </span>
                <a
                  href={googleMapsLink(truck.lastLat!, truck.lastLng!)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-brand-700 hover:underline"
                >
                  <ExternalLink className="size-3.5" /> ดูบนแผนที่
                </a>
              </>
            ) : (
              <span className="text-[11px] text-zinc-400">ยังไม่มีพิกัด GPS</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function GpsPanel({ trucks }: { trucks: TruckGps[] }) {
  if (trucks.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-6 text-center text-sm text-zinc-500">
        ยังไม่มีรถในระบบ
      </div>
    );
  }
  return (
    <div className="grid gap-2">
      {trucks.map((t) => (
        <TruckRow key={t.id} truck={t} />
      ))}
    </div>
  );
}
