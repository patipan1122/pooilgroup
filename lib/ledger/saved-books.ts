// LedgerLine · "เซฟเล่ม" (saved analytics books) — read + config shape.
//
// A book = a saved FILTER SET for /ledger/ledger-book (LEDGER_ANALYTICS_V1),
// shared per company. Stores the ticks, not a number snapshot → reopening
// recomputes live. Mutations live in the page's _actions.ts ("use server").

import { prisma } from "@/lib/prisma";
import type { RowAxis, TimeGrain, AmountBasis } from "@/lib/ledger/spend-analytics";

/** The saved filter set (the URL params of the analytics view).
 *  Multi-select facets are arrays (a book can pin several สาขา/หมวด/ผู้ขาย). */
export interface SavedBookConfig {
  axis: RowAxis;
  categoryIds: string[];
  branchIds: string[];
  vendors: string[];
  grain: TimeGrain;
  basis: AmountBasis;
  q: string | null;
}

export interface SavedBook {
  id: string;
  name: string;
  config: SavedBookConfig;
  createdBy: string | null;
}

const AXES: ReadonlyArray<RowAxis> = ["branch", "category", "vendor", "person"];

/** Coerce arbitrary JSON (or raw input) into a safe SavedBookConfig.
 *  Backward-compatible: books saved before multi-select stored single
 *  `categoryId`/`branchId` strings → folded into the arrays. */
export function normalizeBookConfig(raw: unknown): SavedBookConfig {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const axis = typeof o.axis === "string" && (AXES as readonly string[]).includes(o.axis)
    ? (o.axis as RowAxis)
    : "category";
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim() ? v.trim() : null;
  // Accept an array of strings OR a single legacy string; de-dupe, drop blanks.
  const arr = (v: unknown, legacy?: unknown): string[] => {
    const out: string[] = [];
    if (Array.isArray(v)) {
      for (const x of v) if (typeof x === "string" && x.trim()) out.push(x.trim());
    } else if (typeof v === "string" && v.trim()) {
      out.push(v.trim());
    }
    if (out.length === 0) {
      const l = str(legacy);
      if (l) out.push(l);
    }
    return [...new Set(out)];
  };
  return {
    axis,
    categoryIds: arr(o.categoryIds, o.categoryId),
    branchIds: arr(o.branchIds, o.branchId),
    vendors: arr(o.vendors),
    grain: o.grain === "year" ? "year" : "month",
    basis: o.basis === "gross" ? "gross" : "net",
    q: str(o.q),
  };
}

/**
 * Every saved book for a company (shared — not filtered by createdBy).
 * Always org+company scoped (one org = many legal entities).
 */
export async function listSavedBooks(
  orgId: string,
  companyId: string,
): Promise<SavedBook[]> {
  const rows = await prisma.ledgerSavedBook.findMany({
    where: { orgId, companyId },
    orderBy: [{ sort: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, config: true, createdBy: true },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    config: normalizeBookConfig(r.config),
    createdBy: r.createdBy,
  }));
}

/** Build the /ledger/ledger-book query string for a saved book's config
 *  (so opening a book restores the exact view). Keeps company from the caller. */
export function bookConfigToQuery(
  config: SavedBookConfig,
  company: string | null,
): string {
  const p = new URLSearchParams();
  if (company) p.set("company", company);
  // Multi-select facets → repeated params (cat=a&cat=b) so vendor names with
  // commas/special chars never break a CSV split.
  for (const c of config.categoryIds) p.append("cat", c);
  for (const b of config.branchIds) p.append("b", b);
  for (const v of config.vendors) p.append("ven", v);
  // Always pin the axis explicitly so reopening restores the exact view (the page
  // would otherwise default a category-filtered book to the branch breakdown).
  p.set("ax", config.axis);
  if (config.grain === "year") p.set("grain", "year");
  if (config.basis === "gross") p.set("basis", "gross");
  if (config.q) p.set("q", config.q);
  return p.toString();
}
