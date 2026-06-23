"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { RefreshCw, Search, MapPin, Navigation, X, Truck } from "lucide-react";
import { cn } from "@/lib/fuelos/utils/cn";
import type { FleetSnapshot, FleetVehicle } from "@/lib/fuelos/gps/types";

// Leaflet ทำงานเฉพาะฝั่ง browser → โหลดแบบ ssr:false กัน "window is not defined"
const MapCanvas = dynamic(() => import("./map-canvas"), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full grid place-items-center bg-surface-2 text-sm text-zinc-400">
      กำลังโหลดแผนที่…
    </div>
  ),
});

// pure (ไม่พึ่ง leaflet) — ใช้กับ legend/รายการ
function statusOf(v: FleetVehicle): { label: string; dot: string } {
  if (v.moving) return { label: "วิ่ง", dot: "bg-leaf-500" };
  if (v.engineOn) return { label: "จอดติดเครื่อง", dot: "bg-warning" };
  if (v.engineOn === false) return { label: "ดับเครื่อง", dot: "bg-zinc-400" };
  return { label: "ไม่ทราบ", dot: "bg-zinc-300" };
}

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function fmtKm(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} ม.` : `${km.toFixed(1)} กม.`;
}

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("th-TH", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" });
}

export function FleetView({ initial }: { initial: FleetSnapshot }) {
  const [snap, setSnap] = useState<FleetSnapshot>(initial);
  const [group, setGroup] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [dest, setDest] = useState<{ lat: number; lng: number } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    setRefreshing(true);
    try {
      const res = await fetch("/api/fuelos/gps/live", { cache: "no-store" });
      if (res.ok) setSnap((await res.json()) as FleetSnapshot);
    } catch {
      /* เงียบ — รอบหน้า poll ใหม่ */
    } finally {
      setRefreshing(false);
    }
  }

  // auto-refresh ทุก 30 วินาที
  useEffect(() => {
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, []);

  const vehicles = snap.vehicles;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return vehicles.filter((v) => {
      if (group && v.groupName !== group) return false;
      if (!q) return true;
      return (
        (v.plate ?? "").toLowerCase().includes(q) ||
        (v.driverName ?? "").toLowerCase().includes(q) ||
        v.name.toLowerCase().includes(q)
      );
    });
  }, [vehicles, group, query]);

  // นับสถานะ (จากชุดที่กรองแล้ว)
  const counts = useMemo(() => {
    let moving = 0, idle = 0, off = 0, noSignal = 0;
    for (const v of filtered) {
      if (v.lat == null || v.lng == null) noSignal++;
      else if (v.moving) moving++;
      else if (v.engineOn) idle++;
      else off++;
    }
    return { moving, idle, off, noSignal };
  }, [filtered]);

  // รถใกล้จุดส่งสุด (ระยะตรง) — เมื่อมีการปักจุดส่ง
  const nearest = useMemo(() => {
    if (!dest) return [];
    return filtered
      .filter((v) => v.lat != null && v.lng != null)
      .map((v) => ({ v, km: haversineKm(dest.lat, dest.lng, v.lat as number, v.lng as number) }))
      .sort((a, b) => a.km - b.km)
      .slice(0, 8);
  }, [filtered, dest]);

  const highlight = useMemo(() => new Set(nearest.map((n) => n.v.name)), [nearest]);

  const sourceBadge =
    snap.source === "live"
      ? { text: "ข้อมูลสด", cls: "bg-leaf-100 text-leaf-700" }
      : snap.source === "stored"
        ? { text: "ค่าล่าสุด (xsense ตอบช้า)", cls: "bg-warning/15 text-warning" }
        : snap.source === "unconfigured"
          ? { text: "ยังไม่ได้ตั้งกุญแจ xsense", cls: "bg-zinc-100 text-zinc-500" }
          : { text: "ดึงข้อมูลไม่ได้", cls: "bg-danger/10 text-danger" };

  return (
    <div className="space-y-3">
      {snap.source === "unconfigured" && (
        <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-zinc-700">
          ยังไม่ได้ตั้งกุญแจ xsense — ใส่ <span className="font-mono">FUELOS_XSENSE_API_ID</span> และ{" "}
          <span className="font-mono">FUELOS_XSENSE_API_KEY</span> ใน Vercel แล้วรถจะขึ้นบนแผนที่สด ๆ อัตโนมัติ
        </div>
      )}

      {/* แถบสถานะ + รีเฟรช */}
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium", sourceBadge.cls)}>
          {sourceBadge.text}
        </span>
        <span className="text-xs text-zinc-400">อัปเดต {fmtTime(snap.updatedAt)}</span>
        <div className="ml-auto flex items-center gap-3 text-xs text-zinc-500">
          <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-leaf-500" /> วิ่ง {counts.moving}</span>
          <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-warning" /> จอดติดเครื่อง {counts.idle}</span>
          <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-zinc-400" /> ดับ {counts.off}</span>
          <button
            onClick={refresh}
            className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg border border-border hover:bg-surface-2 transition-colors"
          >
            <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} /> รีเฟรช
          </button>
        </div>
      </div>

      {/* filter บริษัท + ค้นหา */}
      <div className="flex flex-wrap items-center gap-2">
        {snap.groups.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setGroup(null)}
              className={cn(
                "h-8 px-3 inline-flex items-center rounded-full text-sm font-medium transition-colors",
                group === null ? "bg-brand-600 text-white" : "bg-surface-2 text-zinc-600 hover:bg-surface-3",
              )}
            >
              ทุกบริษัท ({vehicles.length})
            </button>
            {snap.groups.map((g) => (
              <button
                key={g}
                onClick={() => setGroup(g)}
                className={cn(
                  "h-8 px-3 inline-flex items-center rounded-full text-sm font-medium transition-colors",
                  group === g ? "bg-brand-600 text-white" : "bg-surface-2 text-zinc-600 hover:bg-surface-3",
                )}
              >
                {g}
              </button>
            ))}
          </div>
        )}
        <div className="relative ml-auto">
          <Search className="size-4 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ค้นทะเบียน / คนขับ"
            className="h-9 pl-8 pr-3 rounded-xl border border-border bg-surface text-sm w-48 focus:outline-none focus:ring-2 focus:ring-brand-200"
          />
        </div>
      </div>

      {/* แผนที่ + แผงข้าง */}
      <div className="grid lg:grid-cols-[1fr_320px] gap-3">
        <div className="h-[60vh] lg:h-[68vh] rounded-2xl overflow-hidden border border-border">
          <MapCanvas vehicles={filtered} destination={dest} onMapClick={(lat, lng) => setDest({ lat, lng })} highlight={highlight} />
        </div>

        <div className="rounded-2xl border border-border bg-surface p-3 h-[60vh] lg:h-[68vh] overflow-y-auto">
          {dest ? (
            <>
              <div className="flex items-center gap-2 mb-2">
                <Navigation className="size-4 text-brand-600" />
                <h3 className="font-bold text-sm">รถใกล้จุดส่งสุด</h3>
                <button
                  onClick={() => setDest(null)}
                  className="ml-auto inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-600"
                >
                  <X className="size-3.5" /> ล้างจุด
                </button>
              </div>
              {nearest.length === 0 ? (
                <p className="text-sm text-zinc-400">ไม่มีรถที่มีพิกัด</p>
              ) : (
                <div className="space-y-1.5">
                  {nearest.map((n, i) => {
                    const st = statusOf(n.v);
                    return (
                      <div
                        key={n.v.name}
                        className={cn(
                          "flex items-center gap-2 rounded-xl border px-2.5 py-2",
                          i === 0 ? "border-brand-300 bg-brand-50" : "border-border bg-surface",
                        )}
                      >
                        <span className="text-xs font-bold tabular-nums text-zinc-400 w-4">{i + 1}</span>
                        <span className={cn("size-2 rounded-full shrink-0", st.dot)} />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold truncate">{n.v.plate ?? n.v.name}</div>
                          <div className="text-[11px] text-zinc-500 truncate">
                            {n.v.driverName ?? "ไม่ระบุคนขับ"} · {st.label}
                          </div>
                        </div>
                        <span className="text-sm font-bold tabular-nums text-brand-700">{fmtKm(n.km)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              <p className="text-[11px] text-zinc-400 mt-2">* ระยะตรง (เส้นบรรทัด) ไม่ใช่ระยะถนนจริง</p>
            </>
          ) : (
            <div className="text-sm text-zinc-500">
              <div className="flex items-center gap-2 mb-2">
                <MapPin className="size-4 text-brand-600" />
                <h3 className="font-bold text-sm text-zinc-700">หารถที่ใกล้ที่สุด</h3>
              </div>
              <p className="leading-relaxed">
                แตะตำแหน่งบนแผนที่ (จุดส่ง) แล้วระบบจะเรียงรถที่อยู่ใกล้ที่สุดให้ — ช่วยเลือกคันที่ส่งคุ้มสุด
              </p>
              <div className="mt-3 pt-3 border-t border-border flex items-center gap-2 text-zinc-500">
                <Truck className="size-4" /> ทั้งหมด {filtered.length} คัน
                {counts.noSignal > 0 && <span className="text-zinc-400">· ไม่มีพิกัด {counts.noSignal}</span>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
