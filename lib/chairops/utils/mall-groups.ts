// Mall-chain display map · mirrors mockup data.jsx MALL_GROUPS.
// Keys match `ChairopsBranch.mallGroup` values from prisma/seed-chairops.ts
// (lowercase chain keys: central / lotus / robinson / top / index / ...).
//
// The Branches workspace left-rail "ห้าง" filter + branch row mall-pill both
// read from here so colors stay consistent across the screen.

export interface MallGroup {
  key: string;
  label: string;
  color: string;
}

// Canonical 8 chains shown in the mockup rail (verbatim labels).
export const MALL_GROUPS: Record<string, MallGroup> = {
  central: { key: "central", label: "Central", color: "#dc2626" },
  lotus: { key: "lotus", label: "Lotus's", color: "#16a34a" },
  robinson: { key: "robinson", label: "Robinson", color: "#7c3aed" },
  top: { key: "top", label: "Tops", color: "#0891b2" },
  index: { key: "index", label: "Index", color: "#ea580c" },
  itsquare: { key: "itsquare", label: "IT Square", color: "#0d9488" },
  ck: { key: "ck", label: "CK Plaza", color: "#a16207" },
  other: { key: "other", label: "อื่น ๆ", color: "#52525b" },
};

// Rail order — matches mockup (8 entries, "อื่น ๆ" last).
export const MALL_RAIL_ORDER: string[] = [
  "central",
  "lotus",
  "robinson",
  "top",
  "index",
  "itsquare",
  "ck",
  "other",
];

/**
 * Resolve any DB mallGroup value to a known MallGroup descriptor.
 * Unknown / null chains bucket into "other" (keeps the rail at 8 fixed chips).
 */
export function resolveMall(mallGroup: string | null | undefined): MallGroup {
  if (mallGroup && MALL_GROUPS[mallGroup]) return MALL_GROUPS[mallGroup];
  return MALL_GROUPS.other;
}
