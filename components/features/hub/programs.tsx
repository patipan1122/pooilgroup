// Hub program launcher — shared, presentational (server-component friendly).
// Used by /home (favorites row) and /programs (full grouped grid).
// Design tokens: dense 2-col tiles · emoji as brand glyph (aria-hidden) +
// leaf-green status dot · rounded-2xl p-4 · ≥44px tap target · Thai-first.
// HARD RULE: ห้ามมี module-specific data ในนี้ — แค่ launcher tile เท่านั้น.

import Link from "next/link";
import { Lock } from "lucide-react";
import { MODULES } from "@/lib/modules";

type Slug = keyof typeof MODULES;

// 3 role-adaptive groups (audit §5). costctrl is super_admin-only.
const GROUPS: ReadonlyArray<{ title: string; slugs: readonly Slug[] }> = [
  { title: "การเงิน & บัญชี", slugs: ["cashhub", "ledger", "costctrl"] },
  {
    title: "ปฏิบัติการสาขา",
    slugs: ["chairops", "clawfleet", "playland", "hotelbook", "repairs"],
  },
  {
    title: "คน · เอกสาร · สื่อสาร · ขาย",
    slugs: ["recruit", "docuflow", "inbox", "fuelos"],
  },
] as const;

// Landing path overrides (modules whose home isn't basePath).
const LANDING: Partial<Record<Slug, string>> = {
  cashhub: "/cashhub/dashboard",
  chairops: "/chairops/dashboard",
  fuelos: "/fuelos/dashboard",
};

// Static "ใช้บ่อย" priority order for the home favorites row (no DB — audit C5).
const FAVORITE_ORDER: readonly Slug[] = [
  "cashhub",
  "ledger",
  "docuflow",
  "chairops",
  "clawfleet",
  "inbox",
];

export interface ProgramEntry {
  slug: Slug;
  name: string;
  tagline: string;
  emoji: string;
  landingPath: string;
  active: boolean;
}

export interface ProgramGroup {
  title: string;
  items: ProgramEntry[];
}

function toEntry(
  slug: Slug,
  moduleEnabled: Record<string, boolean>,
): ProgramEntry {
  const m = MODULES[slug];
  const enabled = moduleEnabled[slug] ?? true;
  return {
    slug,
    name: m.name,
    tagline: m.tagline,
    emoji: m.emoji,
    landingPath: LANDING[slug] ?? m.basePath,
    active: enabled && m.status === "active",
  };
}

/** Build the grouped, access-filtered program list for a given user. */
export function buildProgramGroups(
  canSee: (slug: string) => boolean,
  moduleEnabled: Record<string, boolean>,
  isSuperAdmin: boolean,
): { groups: ProgramGroup[]; total: number } {
  let total = 0;
  const groups: ProgramGroup[] = [];
  for (const g of GROUPS) {
    const items: ProgramEntry[] = [];
    for (const slug of g.slugs) {
      if (slug === "costctrl" && !isSuperAdmin) continue; // CEO-only
      if (!canSee(slug)) continue;
      items.push(toEntry(slug, moduleEnabled));
      total += 1;
    }
    if (items.length > 0) groups.push({ title: g.title, items });
  }
  return { groups, total };
}

/** Top-N most-used programs for the home favorites row (static order). */
export function buildFavorites(
  canSee: (slug: string) => boolean,
  moduleEnabled: Record<string, boolean>,
  isSuperAdmin: boolean,
  limit = 6,
): ProgramEntry[] {
  const out: ProgramEntry[] = [];
  for (const slug of FAVORITE_ORDER) {
    if (slug === "costctrl" && !isSuperAdmin) continue;
    if (!canSee(slug)) continue;
    out.push(toEntry(slug, moduleEnabled));
    if (out.length >= limit) break;
  }
  return out;
}

/** One compact program tile. Whole tile is the tap target (≥44px). */
export function ModuleTile({ entry }: { entry: ProgramEntry }) {
  const base =
    "group relative flex items-center gap-3 rounded-2xl border bg-white p-4 shadow-sm min-h-[72px] transition-all";
  const inner = (
    <>
      <div
        aria-hidden
        className="size-10 shrink-0 rounded-xl bg-[var(--color-brand-50)] border border-[var(--color-brand-200)] flex items-center justify-center text-xl"
      >
        {entry.emoji}
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="text-base font-semibold tracking-tight font-display text-zinc-900 truncate">
          {entry.name}
        </h3>
        <p className="text-xs text-zinc-500 line-clamp-1 mt-0.5">
          {entry.tagline}
        </p>
      </div>
      {entry.active ? (
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-full bg-[var(--color-leaf-500)]"
          title="ใช้งานอยู่"
        />
      ) : (
        <Lock aria-hidden className="size-3.5 shrink-0 text-zinc-300" />
      )}
    </>
  );

  if (entry.active) {
    return (
      <Link
        href={entry.landingPath}
        aria-label={`${entry.name} — ${entry.tagline}`}
        className={`${base} border-zinc-200 hover:border-[var(--color-brand-400)] hover:shadow-md cursor-pointer`}
      >
        {inner}
      </Link>
    );
  }
  return (
    <div
      aria-label={`${entry.name} — ยังไม่เปิดใช้งาน`}
      className={`${base} border-zinc-200 bg-zinc-50 text-zinc-400`}
    >
      {inner}
    </div>
  );
}

/** A dense 2-col grid of tiles. */
export function TileGrid({ items }: { items: ProgramEntry[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {items.map((e) => (
        <ModuleTile key={e.slug} entry={e} />
      ))}
    </div>
  );
}

/**
 * Full launcher grid. Groups when the user sees >4 programs; otherwise a flat
 * grid with no group headers (sparse viewer/program-admin — audit C3/C8).
 * Empty-state when the user has access to nothing.
 */
export function ProgramGrid({
  groups,
  total,
}: {
  groups: ProgramGroup[];
  total: number;
}) {
  if (total === 0) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-zinc-200 bg-zinc-50 p-10 text-center">
        <p className="font-bold text-zinc-900">ยังไม่ได้รับสิทธิ์ใช้โปรแกรม</p>
        <p className="text-sm text-zinc-500 mt-1.5">
          ติดต่อผู้ดูแลระบบเพื่อขอเปิดสิทธิ์เข้าใช้งานโปรแกรม
        </p>
      </div>
    );
  }

  // Sparse view → flat grid, no headers.
  if (total <= 4) {
    return <TileGrid items={groups.flatMap((g) => g.items)} />;
  }

  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <div key={g.title}>
          <h3 className="text-sm font-semibold text-zinc-700 mb-2.5">
            {g.title}
          </h3>
          <TileGrid items={g.items} />
        </div>
      ))}
    </div>
  );
}
