// RentSpace — โครงการทะเลทาวน์ site layout (metric, meters). Data-driven so building
// sizes are parameters (resizable later). Coordinates: origin top-left, x→right, y→down.
// Matches the real sales plan + CEO dimensions:
//  A1 ชาบูซี้ด 60×10 (600 m²) · เกาะจ่ายน้ำมัน ~10m ใต้ A1 · A2 สองก้อน ห้องละ 5×12 +ห้องน้ำ
//  A3 อาคาร 2 ชั้น ห้องแรก ~15w×20d (300 m²) ที่เหลือ 5×10

export type SceneFeature =
  | { kind: "fuel"; label: string; x: number; y: number; w: number; d: number; islands: number }
  | { kind: "lawn"; label: string; x: number; y: number; w: number; d: number }
  | { kind: "parking"; label: string; x: number; y: number; w: number; d: number }
  | { kind: "toilet"; label: string; x: number; y: number; w: number; d: number }
  | { kind: "block"; label: string; x: number; y: number; w: number; d: number; floors: number; color?: string };

export type SceneBuilding = {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  d: number;
  floors: number;
  building: string; // matches RentalUnit.building (A1/A2/A3)
  half?: "first" | "second"; // for splitting A2 into two blocks
  firstW?: number; // wider first room (A3) in meters
  toilet?: boolean; // append a toilet slot
  orient?: "h" | "v"; // rooms run horizontally (default) or vertically
};

export type Scene = {
  site: { w: number; d: number };
  features: SceneFeature[];
  buildings: SceneBuilding[];
};

export const TALAYTOWN_SCENE: Scene = {
  site: { w: 232, d: 104 },
  features: [
    { kind: "fuel", label: "เกาะจ่ายน้ำมัน", x: 18, y: 28, w: 34, d: 14, islands: 3 },
    { kind: "lawn", label: "ลานอีเว้น 1", x: 102, y: 22, w: 60, d: 38 },
    { kind: "lawn", label: "ลานอีเว้น 2", x: 16, y: 63, w: 46, d: 7 },
    { kind: "toilet", label: "ห้องน้ำ", x: 150, y: 22, w: 10, d: 8 },
    { kind: "block", label: "Goodtime", x: 165, y: 26, w: 20, d: 26, floors: 1, color: "#e2e8f0" },
    { kind: "parking", label: "ที่จอดรถ", x: 194, y: 10, w: 30, d: 84 },
    { kind: "parking", label: "ที่จอดรถ", x: 44, y: 90, w: 110, d: 10 },
  ],
  buildings: [
    { id: "A1", label: "A1 ชาบูซี้ด", x: 18, y: 8, w: 60, d: 10, floors: 1, building: "A1" },
    { id: "A2L", label: "A2", x: 18, y: 47, w: 30, d: 12, floors: 1, building: "A2", half: "first", toilet: true },
    { id: "A2R", label: "A2", x: 54, y: 47, w: 30, d: 12, floors: 1, building: "A2", half: "second", toilet: true },
    { id: "A3", label: "A3 (2 ชั้น)", x: 18, y: 73, w: 104, d: 14, floors: 2, building: "A3", firstW: 15 },
  ],
};

/** natural-sort the numeric part of a unit code like A2/10 after A2/2 */
export function naturalCodeKey(code: string): number {
  const m = code.match(/(\d+)/g);
  return m ? parseInt(m[m.length === 1 ? 0 : 1] ?? m[0], 10) : 0;
}

export type SlotUnit = {
  id: string;
  code: string;
  name: string | null;
  status: string;
  baseRentThb: number;
  tenantName: string | null;
  outstanding: number;
  hasOverdue: boolean;
  /** active contract end date (ISO string) — drives near-expiry status color */
  endDate?: string | null;
  /** saved drag position in METERS (overrides auto-slot placement) */
  mapX?: number | null;
  mapY?: number | null;
};

export type PlacedUnit = SlotUnit & { x: number; y: number; w: number; d: number; floors: number; buildingId: string };
export type PlacedToilet = { x: number; y: number; w: number; d: number; buildingId: string };

/** Assign real units to building slots, to scale. Returns metric rects. */
export function placeUnits(scene: Scene, units: SlotUnit[]): { placed: PlacedUnit[]; toilets: PlacedToilet[] } {
  const placed: PlacedUnit[] = [];
  const toilets: PlacedToilet[] = [];
  const byBuilding = new Map<string, SlotUnit[]>();
  for (const u of units) {
    const b = u.code.split("/")[0] || "?";
    if (!byBuilding.has(b)) byBuilding.set(b, []);
    byBuilding.get(b)!.push(u);
  }
  for (const arr of byBuilding.values()) arr.sort((a, b) => naturalCodeKey(a.code) - naturalCodeKey(b.code));

  for (const bld of scene.buildings) {
    let list = byBuilding.get(bld.building) ?? [];
    // split A2 into two halves
    if (bld.half) {
      const mid = Math.ceil(list.length / 2);
      list = bld.half === "first" ? list.slice(0, mid) : list.slice(mid);
    }
    if (bld.id === "A1") {
      // single big unit fills the footprint
      if (list[0]) placed.push({ ...list[0], x: bld.x, y: bld.y, w: bld.w, d: bld.d, floors: bld.floors, buildingId: bld.id });
      continue;
    }
    const slots = list.length + (bld.toilet ? 1 : 0);
    if (slots === 0) continue;
    // total width split: A3 first room wider
    const firstW = bld.firstW ?? 0;
    const remainingW = bld.w - firstW;
    const restCount = slots - (firstW ? 1 : 0);
    const cellW = restCount > 0 ? remainingW / restCount : bld.w;
    let cx = bld.x;
    list.forEach((u, i) => {
      const w = firstW && i === 0 ? firstW : cellW;
      placed.push({ ...u, x: cx, y: bld.y, w, d: bld.d, floors: bld.floors, buildingId: bld.id });
      cx += w;
    });
    if (bld.toilet) {
      toilets.push({ x: cx, y: bld.y, w: cellW, d: bld.d, buildingId: bld.id });
    }
  }
  // saved drag positions (meters) override the auto-slot
  const withOverrides = placed.map((p) =>
    p.mapX != null && p.mapY != null ? { ...p, x: p.mapX, y: p.mapY } : p,
  );
  return { placed: withOverrides, toilets };
}
