"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Box, Grid3x3, X, ArrowRight } from "lucide-react";
import { formatBaht } from "@/lib/rentspace/format";
import { TALAYTOWN_SCENE, placeUnits, type SlotUnit, type Scene } from "@/lib/rentspace/site-layout";

const ISO_X = 0.866;
const ISO_Y = 0.5;
const FLOOR_H = 3.2; // meters per floor

function iso(x: number, y: number, z: number, S: number): [number, number] {
  return [(x - y) * ISO_X * S, (x + y) * ISO_Y * S - z * S];
}
const pt = (p: [number, number]) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;

function boxFaces(x: number, y: number, w: number, d: number, h: number, S: number) {
  const A = iso(x, y, h, S), B = iso(x + w, y, h, S), C = iso(x + w, y + d, h, S), D = iso(x, y + d, h, S);
  const Bb = iso(x + w, y, 0, S), Cb = iso(x + w, y + d, 0, S), Db = iso(x, y + d, 0, S);
  return {
    top: [A, B, C, D].map(pt).join(" "),
    east: [B, C, Cb, Bb].map(pt).join(" "),
    south: [D, C, Cb, Db].map(pt).join(" "),
  };
}

function colorFor(u: { status: string; outstanding: number; hasOverdue: boolean }) {
  if (u.hasOverdue || u.outstanding > 0) return { fill: "#fecaca", edge: "#dc2626", ink: "#991b1b" };
  if (u.status === "occupied") return { fill: "#bbf7d0", edge: "#16a34a", ink: "#166534" };
  if (u.status === "reserved") return { fill: "#fde68a", edge: "#d97706", ink: "#92400e" };
  if (u.status === "inactive") return { fill: "#e2e8f0", edge: "#cbd5e1", ink: "#94a3b8" };
  return { fill: "#e2e8f0", edge: "#94a3b8", ink: "#64748b" };
}
function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 0xff) + amt));
  const b = Math.max(0, Math.min(255, (n & 0xff) + amt));
  return `rgb(${r},${g},${b})`;
}

export function SiteMap3D({
  units,
  view3dEnabled,
  scene = TALAYTOWN_SCENE,
}: {
  units: SlotUnit[];
  view3dEnabled: boolean;
  scene?: Scene;
}) {
  const [is3d, setIs3d] = useState(view3dEnabled);
  const [selected, setSelected] = useState<SlotUnit | null>(null);
  const S = 3.0;

  const { placed, toilets } = useMemo(() => placeUnits(scene, units), [scene, units]);

  // depth-sort drawables (painter's algo): smaller x+y first
  const sortKey = (x: number, y: number, w: number, d: number) => x + y + (w + d) / 2;

  // compute viewBox from all geometry
  const bounds = useMemo(() => {
    const xs: number[] = [];
    const ys: number[] = [];
    const push = (x: number, y: number, z: number) => {
      const [sx, sy] = iso(x, y, z, S);
      xs.push(sx);
      ys.push(sy);
    };
    const maxZ = 2 * FLOOR_H + 1;
    if (is3d) {
      push(0, 0, 0); push(scene.site.w, 0, 0); push(0, scene.site.d, 0); push(scene.site.w, scene.site.d, 0);
      push(0, 0, maxZ); push(scene.site.w, 0, maxZ);
    } else {
      xs.push(0, scene.site.w * S); ys.push(0, scene.site.d * S);
    }
    const pad = 28;
    const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad;
    const minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad;
    return { minX, minY, w: maxX - minX, h: maxY - minY };
  }, [is3d, scene, S]);

  function FlatPoly({ x, y, w, d, fill, stroke, label, hatch }: { x: number; y: number; w: number; d: number; fill: string; stroke: string; label?: string; hatch?: boolean }) {
    if (is3d) {
      const A = iso(x, y, 0, S), B = iso(x + w, y, 0, S), C = iso(x + w, y + d, 0, S), D = iso(x, y + d, 0, S);
      const cx = (A[0] + C[0]) / 2, cy = (A[1] + C[1]) / 2;
      return (
        <g>
          <polygon points={[A, B, C, D].map(pt).join(" ")} fill={hatch ? "url(#rs-hatch)" : fill} stroke={stroke} strokeWidth={0.8} />
          {label && <text x={cx} y={cy} textAnchor="middle" fontSize={9} fill="#475569" fontWeight={600}>{label}</text>}
        </g>
      );
    }
    return (
      <g>
        <rect x={x * S} y={y * S} width={w * S} height={d * S} rx={3} fill={hatch ? "url(#rs-hatch)" : fill} stroke={stroke} strokeWidth={1} />
        {label && <text x={(x + w / 2) * S} y={(y + d / 2) * S} textAnchor="middle" fontSize={9} fill="#475569" fontWeight={600}>{label}</text>}
      </g>
    );
  }

  function UnitBox({ u }: { u: (typeof placed)[number] }) {
    const c = colorFor(u);
    const h = u.floors * FLOOR_H;
    const wide = u.w >= 9;
    if (is3d) {
      const f = boxFaces(u.x, u.y, u.w, u.d, h, S);
      const center = iso(u.x + u.w / 2, u.y + u.d / 2, h, S);
      return (
        <g style={{ cursor: "pointer" }} onClick={() => setSelected(u)}>
          <polygon points={f.south} fill={shade(c.edge, -50)} stroke={shade(c.edge, -70)} strokeWidth={0.6} />
          <polygon points={f.east} fill={shade(c.edge, -25)} stroke={shade(c.edge, -70)} strokeWidth={0.6} />
          <polygon points={f.top} fill={c.fill} stroke={c.edge} strokeWidth={1} />
          {wide && <text x={center[0]} y={center[1] + 3} textAnchor="middle" fontSize={9} fontWeight={800} fill={c.ink}>{u.code}</text>}
        </g>
      );
    }
    return (
      <g style={{ cursor: "pointer" }} onClick={() => setSelected(u)}>
        <rect x={u.x * S} y={u.y * S} width={u.w * S} height={u.d * S} rx={2} fill={c.fill} stroke={c.edge} strokeWidth={1.2} />
        {wide && <text x={(u.x + u.w / 2) * S} y={(u.y + u.d / 2) * S + 3} textAnchor="middle" fontSize={9} fontWeight={800} fill={c.ink}>{u.code}</text>}
      </g>
    );
  }

  function ToiletBox({ t }: { t: (typeof toilets)[number] }) {
    return <FlatPoly x={t.x} y={t.y} w={t.w} d={t.d} fill="#dbeafe" stroke="#60a5fa" label="ห้องน้ำ" />;
  }

  function FuelIsland({ f }: { f: Extract<Scene["features"][number], { kind: "fuel" }> }) {
    // canopy (raised flat) + island boxes
    const items: React.ReactNode[] = [];
    const islandW = 3, gap = (f.w - f.islands * islandW) / (f.islands + 1);
    for (let i = 0; i < f.islands; i++) {
      const ix = f.x + gap + i * (islandW + gap);
      if (is3d) {
        const ff = boxFaces(ix, f.y + f.d / 2 - 1.5, islandW, 3, 1.2, S);
        items.push(<g key={i}><polygon points={ff.east} fill="#94a3b8" /><polygon points={ff.south} fill="#64748b" /><polygon points={ff.top} fill="#cbd5e1" stroke="#64748b" strokeWidth={0.6} /></g>);
      } else {
        items.push(<rect key={i} x={ix * S} y={(f.y + f.d / 2 - 1.5) * S} width={islandW * S} height={3 * S} rx={2} fill="#cbd5e1" stroke="#64748b" />);
      }
    }
    const canopyTop = is3d ? boxFaces(f.x, f.y, f.w, f.d, 5, S).top : null;
    const lbl = is3d ? iso(f.x + f.w / 2, f.y + f.d / 2, 5.5, S) : [(f.x + f.w / 2) * S, (f.y - 1) * S];
    return (
      <g>
        <FlatPoly x={f.x} y={f.y} w={f.w} d={f.d} fill="#f1f5f9" stroke="#cbd5e1" />
        {items}
        {is3d && canopyTop && <polygon points={canopyTop} fill="rgba(203,213,225,.5)" stroke="#94a3b8" strokeWidth={0.8} />}
        <text x={lbl[0]} y={lbl[1]} textAnchor="middle" fontSize={9} fontWeight={700} fill="#475569">⛽ {f.label}</text>
      </g>
    );
  }

  // assemble drawables in depth order
  const flatFeatures = scene.features.filter((f) => f.kind === "lawn" || f.kind === "parking");

  return (
    <div className="relative">
      <div className="flex items-center gap-2 px-4 pb-3 flex-wrap">
        <div className="inline-flex rounded-lg p-0.5" style={{ background: "var(--rs-bg-3)" }}>
          <button onClick={() => setIs3d(false)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-semibold" style={!is3d ? { background: "#fff", color: "var(--rs-brand)" } : { color: "var(--rs-text-2)" }}>
            <Grid3x3 className="h-3.5 w-3.5" /> 2D
          </button>
          {view3dEnabled && (
            <button onClick={() => setIs3d(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-semibold" style={is3d ? { background: "#fff", color: "var(--rs-brand)" } : { color: "var(--rs-text-2)" }}>
              <Box className="h-3.5 w-3.5" /> 3D
            </button>
          )}
        </div>
        <div className="ml-auto flex items-center gap-3 text-[11.5px]" style={{ color: "var(--rs-text-3)" }}>
          <Lg color="#16a34a" label="เช่าอยู่" /><Lg color="#dc2626" label="ค้างจ่าย" /><Lg color="#d97706" label="จอง" /><Lg color="#94a3b8" label="ว่าง" />
        </div>
      </div>

      <div className="overflow-x-auto px-2 pb-4" style={{ background: "linear-gradient(180deg,#eef2f7,#fff)" }}>
        <svg
          viewBox={`${bounds.minX} ${bounds.minY} ${bounds.w} ${bounds.h}`}
          style={{ width: "100%", minWidth: 540, maxWidth: 980, margin: "0 auto", display: "block" }}
        >
          <defs>
            <pattern id="rs-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="#eef2f7" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="#cbd5e1" strokeWidth="1" />
            </pattern>
          </defs>

          {/* ground */}
          <FlatPoly x={0} y={0} w={scene.site.w} d={scene.site.d} fill="#f8fafc" stroke="#e2e8f0" />

          {/* flat features: lawns (green) + parking (hatch) */}
          {flatFeatures.map((f, i) =>
            f.kind === "lawn" ? (
              <FlatPoly key={`lawn${i}`} x={f.x} y={f.y} w={f.w} d={f.d} fill="#a7e05b" stroke="#86c63f" label={f.label} />
            ) : (
              <FlatPoly key={`park${i}`} x={f.x} y={f.y} w={f.w} d={f.d} fill="#eef2f7" stroke="#cbd5e1" label={f.label} hatch />
            ),
          )}

          {/* fuel islands */}
          {scene.features.filter((f) => f.kind === "fuel").map((f, i) => (
            <FuelIsland key={`fuel${i}`} f={f as Extract<Scene["features"][number], { kind: "fuel" }>} />
          ))}

          {/* toilet feature + goodtime block */}
          {scene.features.filter((f) => f.kind === "toilet").map((f, i) => (
            <FlatPoly key={`t${i}`} x={f.x} y={f.y} w={f.w} d={f.d} fill="#dbeafe" stroke="#60a5fa" label={f.label} />
          ))}
          {scene.features.filter((f) => f.kind === "block").map((f, i) => {
            const bf = f as Extract<Scene["features"][number], { kind: "block" }>;
            if (!is3d) return <FlatPoly key={`b${i}`} x={bf.x} y={bf.y} w={bf.w} d={bf.d} fill={bf.color ?? "#e2e8f0"} stroke="#94a3b8" label={bf.label} />;
            const ff = boxFaces(bf.x, bf.y, bf.w, bf.d, bf.floors * FLOOR_H, S);
            const ctr = iso(bf.x + bf.w / 2, bf.y + bf.d / 2, bf.floors * FLOOR_H, S);
            return (
              <g key={`b${i}`}>
                <polygon points={ff.south} fill="#94a3b8" /><polygon points={ff.east} fill="#b8c2cf" />
                <polygon points={ff.top} fill={bf.color ?? "#e2e8f0"} stroke="#94a3b8" strokeWidth={0.8} />
                <text x={ctr[0]} y={ctr[1] + 3} textAnchor="middle" fontSize={9} fontWeight={700} fill="#475569">{bf.label}</text>
              </g>
            );
          })}

          {/* toilets between units */}
          {toilets.map((t, i) => <ToiletBox key={`tt${i}`} t={t} />)}

          {/* building labels (under each cluster) */}
          {scene.buildings.map((b) => {
            const p = is3d ? iso(b.x, b.y + b.d + 3, 0, S) : [b.x * S, (b.y + b.d + 6) * S];
            return <text key={b.id} x={p[0]} y={p[1]} fontSize={10} fontWeight={800} fill="#1e3aff">{b.label}</text>;
          })}

          {/* units — depth sorted */}
          {[...placed].sort((a, b) => sortKey(a.x, a.y, a.w, a.d) - sortKey(b.x, b.y, b.w, b.d)).map((u) => (
            <UnitBox key={u.id} u={u} />
          ))}
        </svg>
      </div>

      <div className="px-4 pb-2 text-[11px]" style={{ color: "var(--rs-text-3)" }}>
        มาตราส่วนจริง (เมตร) · A1 60×10 · A2 ห้องละ 5×12 · A3 อาคาร 2 ชั้น · เกาะจ่ายน้ำมัน · ปรับขนาดอาคารได้ภายหลัง
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={() => setSelected(null)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setSelected(null)} className="absolute right-4 top-4 text-zinc-400"><X className="h-5 w-5" /></button>
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
