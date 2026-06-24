"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Box, Grid3x3, Move, Save, X, ArrowRight } from "lucide-react";
import { formatBaht } from "@/lib/rentspace/format";
import { actSaveUnitPositions } from "@/app/(admin)/rentspace/_actions";

export type MapUnit = {
  id: string;
  code: string;
  name: string | null;
  building: string | null;
  status: string;
  baseRentThb: number;
  tenantName: string | null;
  outstanding: number;
  hasOverdue: boolean;
  mapX: number | null;
  mapY: number | null;
  mapW: number | null;
  mapH: number | null;
};

type Placed = MapUnit & { x: number; y: number; w: number; h: number };

const COLS = 6;
const CELL_W = 15.5; // % width
const CELL_H = 70; // px (logical) per unit row
const GAP_X = 1; // %
const GAP_Y = 14; // px
const ROW_LABEL = 26; // px band per building label

function colorFor(u: MapUnit): { fill: string; edge: string; ink: string } {
  if (u.hasOverdue || u.outstanding > 0)
    return { fill: "#fee2e2", edge: "#dc2626", ink: "#991b1b" };
  if (u.status === "occupied") return { fill: "#dcfce7", edge: "#16a34a", ink: "#15803d" };
  if (u.status === "reserved") return { fill: "#fef3c7", edge: "#d97706", ink: "#92400e" };
  if (u.status === "inactive") return { fill: "#f1f5f9", edge: "#cbd5e1", ink: "#94a3b8" };
  return { fill: "#f1f5f9", edge: "#94a3b8", ink: "#64748b" };
}

/** Auto-layout units grouped by building when they have no saved position. */
function autoLayout(units: MapUnit[]): { placed: Placed[]; stageH: number } {
  const groups = new Map<string, MapUnit[]>();
  for (const u of units) {
    const b = u.building || u.code.split("/")[0] || "อื่นๆ";
    if (!groups.has(b)) groups.set(b, []);
    groups.get(b)!.push(u);
  }
  const buildings = [...groups.keys()].sort();
  const placed: Placed[] = [];
  let cursorY = GAP_Y;
  for (const b of buildings) {
    cursorY += ROW_LABEL;
    const list = groups.get(b)!;
    list.forEach((u, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const x = u.mapX ?? col * (CELL_W + GAP_X) + 2;
      const y = u.mapY != null ? u.mapY : cursorY + row * (CELL_H + GAP_Y);
      placed.push({
        ...u,
        x,
        y,
        w: u.mapW ?? CELL_W,
        h: u.mapH ?? CELL_H,
      });
    });
    const rows = Math.ceil(list.length / COLS);
    cursorY += rows * (CELL_H + GAP_Y) + GAP_Y;
  }
  return { placed, stageH: cursorY + 10 };
}

export function ProjectMap({
  units,
  planImageUrl,
  view3dEnabled,
  canEdit,
}: {
  units: MapUnit[];
  planImageUrl?: string | null;
  view3dEnabled: boolean;
  canEdit: boolean;
}) {
  const [mode, setMode] = useState<"2d" | "3d">("2d");
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<MapUnit | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragId = useRef<string | null>(null);

  const base = useMemo(() => autoLayout(units), [units]);
  const [pos, setPos] = useState<Record<string, { x: number; y: number }>>({});

  const placed: Placed[] = base.placed.map((p) =>
    pos[p.id] ? { ...p, x: pos[p.id].x, y: pos[p.id].y } : p,
  );

  // building label bands (computed from auto layout, only shown in 2d)
  const labels = useMemo(() => {
    const seen = new Map<string, number>();
    for (const p of base.placed) {
      const b = p.building || p.code.split("/")[0] || "อื่นๆ";
      if (!seen.has(b)) seen.set(b, p.y - ROW_LABEL + 4);
    }
    return [...seen.entries()];
  }, [base.placed]);

  function onPointerDown(e: React.PointerEvent, u: Placed) {
    if (!editing || mode !== "2d") return;
    e.preventDefault();
    dragId.current = u.id;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!editing || !dragId.current || !stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(85, ((e.clientX - rect.left) / rect.width) * 100 - 7));
    const y = Math.max(0, Math.min(base.stageH - 20, e.clientY - rect.top - 20));
    setPos((prev) => ({ ...prev, [dragId.current!]: { x, y } }));
    setDirty(true);
  }
  function onPointerUp(e: React.PointerEvent) {
    dragId.current = null;
  }

  async function save() {
    setSaving(true);
    try {
      const positions = placed.map((p) => ({
        id: p.id,
        mapX: p.x,
        mapY: p.y,
        mapW: p.w,
        mapH: p.h,
      }));
      await actSaveUnitPositions(positions);
      toast.success("บันทึกผังแล้ว");
      setDirty(false);
      setEditing(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  const is3d = mode === "3d";

  return (
    <div className="relative">
      {/* toolbar */}
      <div className="flex items-center gap-2 px-4 pb-3 flex-wrap">
        <div className="inline-flex rounded-lg p-0.5" style={{ background: "var(--rs-bg-3)" }}>
          <button
            onClick={() => setMode("2d")}
            className="inline-flex items-center gap-1.5 px-3.5 min-h-[40px] sm:min-h-0 sm:py-1.5 rounded-md text-[13px] font-semibold"
            style={mode === "2d" ? { background: "#fff", color: "var(--rs-brand)" } : { color: "var(--rs-text-2)" }}
          >
            <Grid3x3 className="h-3.5 w-3.5" /> 2D
          </button>
          {view3dEnabled && (
            <button
              onClick={() => { setMode("3d"); setEditing(false); }}
              className="inline-flex items-center gap-1.5 px-3.5 min-h-[40px] sm:min-h-0 sm:py-1.5 rounded-md text-[13px] font-semibold"
              style={mode === "3d" ? { background: "#fff", color: "var(--rs-brand)" } : { color: "var(--rs-text-2)" }}
            >
              <Box className="h-3.5 w-3.5" /> 3D
            </button>
          )}
        </div>

        {canEdit && mode === "2d" && (
          <button
            onClick={() => setEditing((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3.5 min-h-[40px] sm:min-h-0 sm:py-1.5 rounded-md text-[13px] font-semibold"
            style={{ background: editing ? "var(--rs-brand)" : "var(--rs-bg-3)", color: editing ? "#fff" : "var(--rs-text-2)" }}
          >
            <Move className="h-3.5 w-3.5" /> {editing ? "กำลังจัดผัง" : "จัดผัง"}
          </button>
        )}
        {editing && dirty && (
          <button onClick={save} disabled={saving} className="rs-btn h-11 sm:h-9 text-[13px]">
            <Save className="h-3.5 w-3.5" /> {saving ? "กำลังบันทึก…" : "บันทึกผัง"}
          </button>
        )}

        {/* legend */}
        <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]" style={{ color: "var(--rs-text-3)" }}>
          <Legend color="#16a34a" label="เช่าอยู่" />
          <Legend color="#dc2626" label="ค้างจ่าย" />
          <Legend color="#d97706" label="จอง" />
          <Legend color="#94a3b8" label="ว่าง" />
        </div>
      </div>

      {/* stage */}
      <div
        className="relative overflow-x-auto overflow-y-hidden px-4 pb-5"
        style={{ background: "linear-gradient(180deg, var(--rs-bg-2), #fff)" }}
      >
        <div className={is3d ? "rs-stage" : ""} style={{ minWidth: 560 }}>
          <div
            ref={stageRef}
            className={is3d ? "rs-iso" : ""}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            style={{
              position: "relative",
              height: base.stageH,
              margin: is3d ? "40px auto 90px" : "4px auto 8px",
              maxWidth: is3d ? 620 : 760,
              backgroundImage: planImageUrl && !is3d ? `url(${planImageUrl})` : undefined,
              backgroundSize: "cover",
              backgroundPosition: "center",
              borderRadius: 12,
            }}
          >
            {/* building labels (2d only) */}
            {!is3d &&
              labels.map(([b, y]) => (
                <div
                  key={b}
                  style={{ position: "absolute", left: 4, top: y, fontSize: 12, fontWeight: 700, color: "var(--rs-text-3)" }}
                >
                  อาคาร {b}
                </div>
              ))}

            {placed.map((u) => {
              const c = colorFor(u);
              const eh = is3d ? Math.round(20 + Math.min(34, (u.baseRentThb / 80000) * 34)) : 0;
              return (
                <button
                  key={u.id}
                  onPointerDown={(e) => onPointerDown(e, u)}
                  onClick={() => !editing && setSelected(u)}
                  className="rs-unit3d group"
                  style={{
                    position: "absolute",
                    left: `${u.x}%`,
                    top: u.y,
                    width: `${u.w}%`,
                    height: u.h,
                    cursor: editing ? "grab" : "pointer",
                    transformStyle: is3d ? "preserve-3d" : undefined,
                    // @ts-expect-error custom prop
                    "--h": `${eh}px`,
                  }}
                  title={`${u.code} ${u.name ?? ""}`}
                >
                  {/* walls (3d only) */}
                  {is3d && (
                    <>
                      <span
                        aria-hidden
                        className="face-side-x"
                        style={{ position: "absolute", inset: 0, width: eh, height: "100%", background: shade(c.edge, -10), borderRadius: 4 }}
                      />
                      <span
                        aria-hidden
                        className="face-side-y"
                        style={{ position: "absolute", inset: 0, width: "100%", height: eh, background: shade(c.edge, -28), borderRadius: 4 }}
                      />
                    </>
                  )}
                  {/* top / face */}
                  <span
                    className={is3d ? "face-top" : ""}
                    style={{
                      position: "absolute",
                      inset: 0,
                      background: c.fill,
                      border: `1.5px solid ${c.edge}`,
                      borderRadius: 8,
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "center",
                      alignItems: "center",
                      padding: 4,
                      boxShadow: is3d ? "0 6px 12px rgba(2,8,40,.18)" : "0 1px 2px rgba(2,8,40,.06)",
                    }}
                  >
                    <span style={{ fontSize: 12.5, fontWeight: 800, color: c.ink, lineHeight: 1.05 }}>{u.code}</span>
                    {!is3d && u.name && (
                      <span style={{ fontSize: 9.5, color: c.ink, opacity: 0.8, textAlign: "center", lineHeight: 1.1, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", width: "100%" }}>
                        {u.name}
                      </span>
                    )}
                    {!is3d && u.outstanding > 0 && (
                      <span style={{ fontSize: 9, fontWeight: 700, color: "#dc2626" }}>ค้าง {formatBaht(u.outstanding)}</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* detail drawer */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={() => setSelected(null)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="relative w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl p-5 shadow-2xl"
            style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}
            onClick={(e) => e.stopPropagation()}
          >
            <button aria-label="ปิด" onClick={() => setSelected(null)} className="absolute right-2 top-2 inline-flex h-11 w-11 items-center justify-center rounded-md text-zinc-400">
              <X className="h-5 w-5" />
            </button>
            <div className="text-xs font-semibold pr-12" style={{ color: "var(--rs-brand)" }}>
              อาคาร {selected.building || selected.code.split("/")[0]}
            </div>
            <div className="text-xl font-bold" style={{ color: "var(--rs-text)" }}>
              {selected.code} {selected.name ? `· ${selected.name}` : ""}
            </div>
            <div className="mt-3 space-y-2 text-sm">
              <Row label="สถานะ" value={statusLabel(selected)} />
              <Row label="ผู้เช่า" value={selected.tenantName || "— ว่าง —"} />
              <Row label="ค่าเช่า/เดือน" value={formatBaht(selected.baseRentThb)} />
              {selected.outstanding > 0 && (
                <Row label="ค้างชำระ" value={formatBaht(selected.outstanding)} danger />
              )}
            </div>
            <Link
              href={`/rentspace/units/${selected.id}`}
              className="rs-btn w-full mt-4"
            >
              เปิดข้อมูลห้อง <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} /> {label}
    </span>
  );
}
function Row({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span style={{ color: "var(--rs-text-3)" }}>{label}</span>
      <span className="font-semibold" style={{ color: danger ? "var(--rs-danger)" : "var(--rs-text)" }}>{value}</span>
    </div>
  );
}
function statusLabel(u: MapUnit): string {
  if (u.hasOverdue) return "เกินกำหนดชำระ";
  if (u.outstanding > 0) return "ค้างชำระ";
  if (u.status === "occupied") return "มีผู้เช่า";
  if (u.status === "reserved") return "จอง";
  if (u.status === "inactive") return "ปิดใช้งาน";
  return "ว่าง";
}
function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) + amt, g = ((n >> 8) & 0xff) + amt, b = (n & 0xff) + amt;
  r = Math.max(0, Math.min(255, r)); g = Math.max(0, Math.min(255, g)); b = Math.max(0, Math.min(255, b));
  return `rgb(${r},${g},${b})`;
}
