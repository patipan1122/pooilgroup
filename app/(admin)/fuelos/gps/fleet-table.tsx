"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/fuelos/utils/cn";
import { Search, ExternalLink } from "lucide-react";
import type { FleetTableRow } from "@/lib/fuelos/gps/report-data";

const ALL = "ทั้งหมด";

const STATUS_TONE: Record<string, string> = {
  "วิ่ง": "bg-leaf-500/15 text-leaf-700",
  "จอดติดเครื่อง": "bg-warning/15 text-warning",
  "ดับ": "bg-zinc-500/10 text-zinc-500",
  "—": "bg-zinc-500/10 text-zinc-400",
};

export function FleetTable({ vehicles, groups }: { vehicles: FleetTableRow[]; groups: { group: string; count: number }[] }) {
  const [q, setQ] = useState("");
  const [activeGroup, setActiveGroup] = useState<string>(ALL);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return vehicles.filter((v) => {
      if (activeGroup !== ALL && (v.groupName ?? "(ไม่มีกลุ่ม)") !== activeGroup) return false;
      if (!term) return true;
      return (
        (v.plate ?? "").toLowerCase().includes(term) ||
        v.xsenseName.toLowerCase().includes(term) ||
        (v.driverName ?? "").toLowerCase().includes(term)
      );
    });
  }, [vehicles, q, activeGroup]);

  const moving = filtered.filter((v) => v.isMoving).length;

  return (
    <div className="space-y-3">
      {/* ค้นหา */}
      <div className="relative">
        <Search className="size-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="ค้นทะเบียน / ชื่อคนขับ"
          className="h-10 w-full rounded-xl border border-border bg-surface pl-9 pr-3 text-sm"
        />
      </div>

      {/* กรองกลุ่มบริษัท */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {[{ group: ALL, count: vehicles.length }, ...groups].map((g) => {
          const active = activeGroup === g.group;
          return (
            <button
              key={g.group}
              onClick={() => setActiveGroup(g.group)}
              className={cn(
                "inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium shrink-0",
                active ? "bg-brand-600 text-white" : "bg-surface border border-border text-zinc-600",
              )}
            >
              {g.group}
              <span className={cn("tabular-nums", active ? "text-white/80" : "text-zinc-400")}>{g.count}</span>
            </button>
          );
        })}
      </div>

      <div className="text-xs text-zinc-500">
        แสดง {filtered.length} คัน · กำลังวิ่ง {moving} คัน
      </div>

      {/* ตาราง */}
      <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-zinc-500 border-b border-border">
              <th className="px-3 py-2 font-medium">ทะเบียน</th>
              <th className="px-3 py-2 font-medium">กลุ่ม</th>
              <th className="px-3 py-2 font-medium">คนขับ</th>
              <th className="px-3 py-2 font-medium">สถานะ</th>
              <th className="px-3 py-2 font-medium text-right">ความเร็ว</th>
              <th className="px-3 py-2 font-medium">ตำแหน่งล่าสุด</th>
              <th className="px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((v) => (
              <tr key={v.xsenseName} className="border-b border-border/60 last:border-0 align-top">
                <td className="px-3 py-2 font-medium font-[family-name:var(--font-plex-mono)] whitespace-nowrap">{v.plate ?? v.xsenseName}</td>
                <td className="px-3 py-2 text-zinc-500 whitespace-nowrap">{v.groupName ?? "—"}</td>
                <td className="px-3 py-2 text-zinc-600 max-w-[160px] truncate">{v.driverName ?? "—"}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <span className={cn("inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full", STATUS_TONE[v.status])}>
                    {v.isMoving && <span className="size-1.5 rounded-full bg-leaf-500 animate-pulse" />}
                    {v.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-zinc-500 whitespace-nowrap">
                  {v.speedKmh != null ? `${v.speedKmh.toFixed(0)}` : "—"}
                </td>
                <td className="px-3 py-2 text-zinc-500">
                  <div className="max-w-[220px] truncate">{v.address ?? "—"}</div>
                  <div className="text-[10px] text-zinc-400">{v.seenText}</div>
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {v.mapLink && (
                    <a href={v.mapLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-brand-700 hover:underline">
                      <ExternalLink className="size-3.5" /> แผนที่
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <div className="p-6 text-center text-sm text-zinc-500">ไม่พบรถที่ตรงกับเงื่อนไข</div>}
      </div>
    </div>
  );
}
