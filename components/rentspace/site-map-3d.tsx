"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Box, Grid3x3, X, ArrowRight, RotateCw, RotateCcw, Plus, Minus, Move, Save } from "lucide-react";
import { formatBaht } from "@/lib/rentspace/format";
import { actSaveUnitPositions } from "@/app/(admin)/rentspace/_actions";
import { TALAYTOWN_SCENE, placeUnits, type SlotUnit, type Scene } from "@/lib/rentspace/site-layout";

const ISO_X = 0.866;
const ISO_Y = 0.5;
const FLOOR_H = 3.2;
const S = 3.0;

type Rect = { x: number; y: number; w: number; d: number };
type Item = {
  kind: "flat" | "box";
  rect: Rect;
  z?: number; // elevation for flat
  h?: number; // height for box
  fill: string;
  edge: string;
  sideFill?: string;
  label?: string;
  ink?: string;
  big?: boolean;
  hatch?: boolean;
  unit?: SlotUnit;
};

function iso(x: number, y: number, z: number): [number, number] {
  return [(x - y) * ISO_X * S, (x + y) * ISO_Y * S - z * S];
}
const pp = (p: [number, number]) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;

/** rotate a rect by `steps`×90° CCW about (cx,cy); 90° multiples stay axis-aligned */
function rotRect(r: Rect, steps: number, cx: number, cy: number): Rect {
  const s = ((steps % 4) + 4) % 4;
  const corners = [
    [r.x, r.y],
    [r.x + r.w, r.y],
    [r.x + r.w, r.y + r.d],
    [r.x, r.y + r.d],
  ].map(([px, py]) => {
    let dx = px - cx, dy = py - cy;
    for (let i = 0; i < s; i++) [dx, dy] = [dy, -dx]; // 90° CCW
    return [cx + dx, cy + dy];
  });
  const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), d: Math.max(...ys) - Math.min(...ys) };
}

function colorFor(u: { status: string; outstanding: number; hasOverdue: boolean }) {
  if (u.hasOverdue || u.outstanding > 0) return { fill: "#fecaca", edge: "#dc2626", ink: "#991b1b" };
  if (u.status === "occupied") return { fill: "#bbf7d0", edge: "#16a34a", ink: "#166534" };
  if (u.status === "reserved") return { fill: "#fde68a", edge: "#d97706", ink: "#92400e" };
  return { fill: "#e2e8f0", edge: "#94a3b8", ink: "#64748b" };
}
function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 0xff) + amt));
  const b = Math.max(0, Math.min(255, (n & 0xff) + amt));
  return `rgb(${r},${g},${b})`;
}

export function SiteMap3D({ units, view3dEnabled, scene = TALAYTOWN_SCENE, onSelect, canEdit }: { units: SlotUnit[]; view3dEnabled: boolean; scene?: Scene; onSelect?: (unitId: string) => void; canEdit?: boolean }) {
  const [is3d, setIs3d] = useState(view3dEnabled);
  const [rot, setRot] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [selected, setSelected] = useState<SlotUnit | null>(null);
  const [editing, setEditing] = useState(false);
  const [pos, setPos] = useState<Record<string, { x: number; y: number }>>({});
  const [saving, setSaving] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ id: string; offX: number; offY: number } | null>(null);
  const pick = (u: SlotUnit) => (onSelect ? onSelect(u.id) : setSelected(u));

  function meterAt(e: React.PointerEvent): { x: number; y: number } {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return { x: 0, y: 0 };
    const p = svg.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    const u = p.matrixTransform(ctm.inverse());
    return { x: u.x / S, y: u.y / S };
  }
  function startDrag(e: React.PointerEvent, id: string, rx: number, ry: number) {
    if (!editing) return;
    e.stopPropagation();
    const m = meterAt(e);
    dragRef.current = { id, offX: m.x - rx, offY: m.y - ry };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }
  function onMove(e: React.PointerEvent) {
    if (!editing || !dragRef.current) return;
    const m = meterAt(e);
    const d = dragRef.current;
    setPos((p) => ({ ...p, [d.id]: { x: Math.round((m.x - d.offX) * 10) / 10, y: Math.round((m.y - d.offY) * 10) / 10 } }));
  }
  function onUp() {
    dragRef.current = null;
  }
  async function savePositions() {
    const positions = drawn
      .filter((it) => it.unit && pos[it.unit.id])
      .map((it) => ({ id: it.unit!.id, mapX: pos[it.unit!.id].x, mapY: pos[it.unit!.id].y, mapW: it.R.w, mapH: it.R.d }));
    if (positions.length === 0) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await actSaveUnitPositions(positions);
      toast.success(`บันทึกตำแหน่ง ${positions.length} ห้องแล้ว`);
      setEditing(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  const { placed, toilets } = useMemo(() => placeUnits(scene, units), [scene, units]);
  const cx = scene.site.w / 2, cy = scene.site.d / 2;

  // build raw items (un-rotated)
  const rawItems = useMemo<Item[]>(() => {
    const items: Item[] = [];
    for (const f of scene.features) {
      if (f.kind === "lawn") items.push({ kind: "flat", rect: f, fill: "#a7e05b", edge: "#86c63f", label: f.label });
      else if (f.kind === "parking") items.push({ kind: "flat", rect: f, fill: "#eef2f7", edge: "#cbd5e1", label: f.label, hatch: true });
      else if (f.kind === "toilet") items.push({ kind: "flat", rect: f, fill: "#dbeafe", edge: "#60a5fa", label: f.label });
      else if (f.kind === "block") items.push({ kind: "box", rect: f, h: f.floors * FLOOR_H, fill: f.color ?? "#e2e8f0", edge: "#94a3b8", sideFill: "#b8c2cf", label: f.label });
      else if (f.kind === "fuel") {
        items.push({ kind: "flat", rect: f, fill: "#f1f5f9", edge: "#cbd5e1" });
        const islandW = 3, gap = (f.w - f.islands * islandW) / (f.islands + 1);
        for (let i = 0; i < f.islands; i++) {
          items.push({ kind: "box", rect: { x: f.x + gap + i * (islandW + gap), y: f.y + f.d / 2 - 1.5, w: islandW, d: 3 }, h: 1.2, fill: "#cbd5e1", edge: "#64748b", sideFill: "#94a3b8" });
        }
        items.push({ kind: "flat", rect: f, z: 5, fill: "rgba(203,213,225,.55)", edge: "#94a3b8", label: `⛽ ${f.label}` });
      }
    }
    for (const t of toilets) items.push({ kind: "flat", rect: t, fill: "#dbeafe", edge: "#60a5fa", label: "ห้องน้ำ" });
    for (const u of placed) {
      const c = colorFor(u);
      items.push({ kind: "box", rect: u, h: u.floors * FLOOR_H, fill: c.fill, edge: c.edge, sideFill: shade(c.edge, -25), ink: c.ink, label: u.w >= 9 ? u.code : undefined, big: u.w >= 9, unit: u });
    }
    return items;
  }, [scene, placed, toilets]);

  // rotate + depth sort
  const drawn = useMemo(() => {
    const arr = rawItems.map((it) => {
      const rect = it.unit && pos[it.unit.id] ? { ...it.rect, x: pos[it.unit.id].x, y: pos[it.unit.id].y } : it.rect;
      return { ...it, R: rotRect(rect, rot, cx, cy) };
    });
    arr.sort((a, b) => {
      const ka = a.R.x + a.R.y + (a.R.w + a.R.d) / 2 + (a.kind === "box" ? 0.1 : 0);
      const kb = b.R.x + b.R.y + (b.R.w + b.R.d) / 2 + (b.kind === "box" ? 0.1 : 0);
      return ka - kb;
    });
    return arr;
  }, [rawItems, rot, cx, cy, pos]);

  const bounds = useMemo(() => {
    const site = rotRect({ x: 0, y: 0, w: scene.site.w, d: scene.site.d }, rot, cx, cy);
    const xs: number[] = [], ys: number[] = [];
    const maxZ = 2 * FLOOR_H + 6;
    const corners: [number, number, number][] = is3d
      ? [[site.x, site.y, 0], [site.x + site.w, site.y, 0], [site.x, site.y + site.d, 0], [site.x + site.w, site.y + site.d, 0], [site.x, site.y, maxZ], [site.x + site.w, site.y, maxZ]]
      : [[site.x, site.y, 0], [site.x + site.w, site.y + site.d, 0]];
    if (is3d) {
      for (const [x, y, z] of corners) { const [sx, sy] = iso(x, y, z); xs.push(sx); ys.push(sy); }
    } else { xs.push(site.x * S, (site.x + site.w) * S); ys.push(site.y * S, (site.y + site.d) * S); }
    const pad = 26;
    return { minX: Math.min(...xs) - pad, minY: Math.min(...ys) - pad, w: Math.max(...xs) - Math.min(...xs) + pad * 2, h: Math.max(...ys) - Math.min(...ys) + pad * 2 };
  }, [scene, rot, is3d, cx, cy]);

  function renderItem(it: Item & { R: Rect }, key: number) {
    const r = it.R;
    const editUnit = editing && !!it.unit;
    const onClick = it.unit && !editing ? () => pick(it.unit!) : undefined;
    const onPointerDownUnit = editUnit ? (e: React.PointerEvent) => startDrag(e, it.unit!.id, r.x, r.y) : undefined;
    if (!is3d) {
      return (
        <g
          key={key}
          style={editUnit ? { cursor: "grab" } : onClick ? { cursor: "pointer" } : undefined}
          onClick={onClick}
          onPointerDown={onPointerDownUnit}
        >
          <rect x={r.x * S} y={r.y * S} width={r.w * S} height={r.d * S} rx={it.kind === "box" ? 2 : 3} fill={it.hatch ? "url(#rs-hatch)" : it.fill} stroke={editUnit ? "#2563EB" : it.edge} strokeWidth={editUnit ? 2 : it.kind === "box" ? 1.2 : 1} />
          {it.label && it.big !== false && <text x={(r.x + r.w / 2) * S} y={(r.y + r.d / 2) * S + 3} textAnchor="middle" fontSize={9} fontWeight={it.unit ? 800 : 600} fill={it.ink ?? "#475569"}>{it.label}</text>}
        </g>
      );
    }
    if (it.kind === "flat") {
      const z = it.z ?? 0;
      const A = iso(r.x, r.y, z), B = iso(r.x + r.w, r.y, z), C = iso(r.x + r.w, r.y + r.d, z), D = iso(r.x, r.y + r.d, z);
      const ctr = iso(r.x + r.w / 2, r.y + r.d / 2, z);
      return (
        <g key={key}>
          <polygon points={[A, B, C, D].map(pp).join(" ")} fill={it.hatch ? "url(#rs-hatch)" : it.fill} stroke={it.edge} strokeWidth={0.8} />
          {it.label && <text x={ctr[0]} y={ctr[1] + 3} textAnchor="middle" fontSize={9} fontWeight={600} fill="#475569">{it.label}</text>}
        </g>
      );
    }
    // box
    const h = it.h ?? FLOOR_H;
    const A = iso(r.x, r.y, h), B = iso(r.x + r.w, r.y, h), C = iso(r.x + r.w, r.y + r.d, h), D = iso(r.x, r.y + r.d, h);
    const Bb = iso(r.x + r.w, r.y, 0), Cb = iso(r.x + r.w, r.y + r.d, 0), Db = iso(r.x, r.y + r.d, 0);
    const ctr = iso(r.x + r.w / 2, r.y + r.d / 2, h);
    return (
      <g key={key} style={onClick ? { cursor: "pointer" } : undefined} onClick={onClick}>
        <polygon points={[D, C, Cb, Db].map(pp).join(" ")} fill={shade(it.sideFill ?? it.edge, -25)} stroke={shade(it.edge, -50)} strokeWidth={0.6} />
        <polygon points={[B, C, Cb, Bb].map(pp).join(" ")} fill={it.sideFill ?? it.edge} stroke={shade(it.edge, -50)} strokeWidth={0.6} />
        <polygon points={[A, B, C, D].map(pp).join(" ")} fill={it.fill} stroke={it.edge} strokeWidth={1} />
        {it.label && <text x={ctr[0]} y={ctr[1] + 3} textAnchor="middle" fontSize={9} fontWeight={it.unit ? 800 : 700} fill={it.ink ?? "#475569"}>{it.label}</text>}
      </g>
    );
  }

  const btn = "inline-flex items-center justify-center h-8 w-8 rounded-md";

  return (
    <div className="relative">
      <div className="flex items-center gap-2 px-4 pb-3 flex-wrap">
        <div className="inline-flex rounded-lg p-0.5" style={{ background: "var(--rs-bg-3)" }}>
          <button type="button" onClick={() => { setIs3d(false); setRot(0); }} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-semibold" style={!is3d ? { background: "#fff", color: "var(--rs-brand)" } : { color: "var(--rs-text-2)" }}><Grid3x3 className="h-3.5 w-3.5" /> 2D</button>
          {view3dEnabled && <button type="button" onClick={() => setIs3d(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-semibold" style={is3d ? { background: "#fff", color: "var(--rs-brand)" } : { color: "var(--rs-text-2)" }}><Box className="h-3.5 w-3.5" /> 3D</button>}
        </div>
        {is3d && (
          <div className="inline-flex rounded-lg p-0.5 gap-0.5" style={{ background: "var(--rs-bg-3)" }}>
            <button type="button" aria-label="หมุนซ้าย" onClick={() => setRot((r) => r + 1)} className={btn} style={{ color: "var(--rs-text-2)" }}><RotateCcw className="h-4 w-4" /></button>
            <button type="button" aria-label="หมุนขวา" onClick={() => setRot((r) => r - 1)} className={btn} style={{ color: "var(--rs-text-2)" }}><RotateCw className="h-4 w-4" /></button>
          </div>
        )}
        <div className="inline-flex rounded-lg p-0.5 gap-0.5" style={{ background: "var(--rs-bg-3)" }}>
          <button type="button" aria-label="ซูมออก" onClick={() => setZoom((z) => Math.max(0.6, z - 0.25))} className={btn} style={{ color: "var(--rs-text-2)" }}><Minus className="h-4 w-4" /></button>
          <button type="button" aria-label="ซูมเข้า" onClick={() => setZoom((z) => Math.min(3, z + 0.25))} className={btn} style={{ color: "var(--rs-text-2)" }}><Plus className="h-4 w-4" /></button>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={() => { setEditing((v) => !v); if (!editing) { setIs3d(false); setRot(0); } }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-semibold"
            style={editing ? { background: "var(--rs-brand)", color: "#fff" } : { background: "var(--rs-bg-3)", color: "var(--rs-text-2)" }}
          >
            <Move className="h-3.5 w-3.5" /> {editing ? "กำลังจัดผัง" : "จัดผัง"}
          </button>
        )}
        {editing && Object.keys(pos).length > 0 && (
          <button type="button" onClick={savePositions} disabled={saving} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-semibold text-white disabled:opacity-60" style={{ background: "#16A34A" }}>
            <Save className="h-3.5 w-3.5" /> {saving ? "กำลังบันทึก…" : "บันทึกผัง"}
          </button>
        )}
        <div className="ml-auto flex items-center gap-3 text-[11.5px]" style={{ color: "var(--rs-text-3)" }}>
          <Lg color="#16a34a" label="เช่าอยู่" /><Lg color="#dc2626" label="ค้างจ่าย" /><Lg color="#d97706" label="จอง" /><Lg color="#94a3b8" label="ว่าง" />
        </div>
      </div>

      <div className="overflow-auto px-2 pb-4" style={{ background: "linear-gradient(180deg,#eef2f7,#fff)", maxHeight: 560 }}>
        <svg ref={svgRef} onPointerMove={onMove} onPointerUp={onUp} viewBox={`${bounds.minX} ${bounds.minY} ${bounds.w} ${bounds.h}`} style={{ width: `${Math.round(940 * zoom)}px`, maxWidth: zoom <= 1 ? "100%" : "none", margin: "0 auto", display: "block", touchAction: editing ? "none" : undefined }}>
          <defs>
            <pattern id="rs-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="#eef2f7" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="#cbd5e1" strokeWidth="1" />
            </pattern>
          </defs>
          {/* ground */}
          {(() => { const g = rotRect({ x: 0, y: 0, w: scene.site.w, d: scene.site.d }, rot, cx, cy); const A = iso(g.x, g.y, 0), B = iso(g.x + g.w, g.y, 0), C = iso(g.x + g.w, g.y + g.d, 0), D = iso(g.x, g.y + g.d, 0); return is3d ? <polygon points={[A, B, C, D].map(pp).join(" ")} fill="#f8fafc" stroke="#e2e8f0" /> : <rect x={g.x * S} y={g.y * S} width={g.w * S} height={g.d * S} fill="#f8fafc" stroke="#e2e8f0" />; })()}
          {drawn.map((it, i) => renderItem(it, i))}
        </svg>
      </div>

      <div className="px-4 pb-2 text-[11px]" style={{ color: "var(--rs-text-3)" }}>
        มาตราส่วนจริง (เมตร) · A1 60×10 · A2 ห้องละ 5×12 · A3 อาคาร 2 ชั้น · {is3d ? "หมุน 4 มุม + ซูมดูได้" : "กด 3D เพื่อหมุน/ซูม"} · ปรับขนาดอาคารได้ภายหลัง
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={() => setSelected(null)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <button type="button" aria-label="ปิด" onClick={() => setSelected(null)} className="absolute right-4 top-4 text-zinc-400"><X className="h-5 w-5" /></button>
            <div className="text-xl font-bold" style={{ color: "var(--rs-text)" }}>{selected.code} {selected.name ? `· ${selected.name}` : ""}</div>
            <div className="mt-3 space-y-2 text-sm">
              <Row label="ผู้เช่า" value={selected.tenantName || "— ว่าง —"} />
              <Row label="ค่าเช่า/เดือน" value={formatBaht(selected.baseRentThb)} />
              {selected.outstanding > 0 && <Row label="ค้างชำระ" value={formatBaht(selected.outstanding)} danger />}
            </div>
            <Link href={`/rentspace/units/${selected.id}`} className="rs-btn w-full mt-4">เปิดข้อมูลห้อง <ArrowRight className="h-4 w-4" /></Link>
          </div>
        </div>
      )}
    </div>
  );
}

function Lg({ color, label }: { color: string; label: string }) {
  return <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} /> {label}</span>;
}
function Row({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return <div className="flex items-center justify-between"><span style={{ color: "var(--rs-text-3)" }}>{label}</span><span className="font-semibold" style={{ color: danger ? "var(--rs-danger)" : "var(--rs-text)" }}>{value}</span></div>;
}
