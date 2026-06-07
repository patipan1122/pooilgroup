// LedgerLine — receipt-text ↔ SKU matching helpers (PURE · client-safe, no server deps).
//
// Two jobs:
//   normalizeAlias — the canonical key used for EXACT alias lookup (must match the DB).
//   suggestSkus    — local fuzzy RANKING for the "ช่วยเดาชื่อ" picker. It NEVER auto-
//                    commits — it only sorts candidates so the human confirms 1-tap.
//                    Compares against BOTH the SKU code and the TRCloud product name,
//                    so a receipt line that's close to the real product name floats up.
//
// No AI, no network — runs in <1ms over a few hundred SKUs. Correctness for stock/money
// comes from the human confirm + the exact-alias path; this is only ergonomics.

/** Canonical alias key (lower / trim / collapse internal whitespace). Keep in lockstep
 *  with the value stored in ledger_sku_alias.alias_key. */
export function normalizeAlias(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 200);
}

export type SkuLite = {
  id: string;
  productId: string;
  productName: string | null;
};

export type ScoredSku<T extends SkuLite = SkuLite> = T & { score: number };

function norm(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}
function tokenize(s: string): Set<string> {
  return new Set(norm(s).split(/[\s\-_/.,()|]+/).filter(Boolean));
}
function trigrams(s: string): Set<string> {
  const t = norm(s).replace(/\s/g, "");
  const g = new Set<string>();
  for (let i = 0; i <= t.length - 3; i++) g.add(t.slice(i, i + 3));
  return g;
}
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}
function numbersOf(s: string): string[] {
  return s.match(/\d+/g) ?? [];
}

/** Similarity of `text` against a single target string, 0..1. */
function scoreAgainst(text: string, target: string): number {
  const t = norm(text);
  const g = norm(target);
  if (!t || !g) return 0;
  if (t === g) return 1;
  let s = 0;
  if (g.includes(t) || t.includes(g)) s += 0.6;
  s += 0.5 * jaccard(tokenize(t), tokenize(g));
  s += 0.4 * jaccard(trigrams(t), trigrams(g));
  // number agreement (e.g. "95", "4t" → "4") — strong signal for fuel/oil grades.
  const nt = numbersOf(t);
  const ng = numbersOf(g);
  if (nt.length && ng.length && nt.some((x) => ng.includes(x))) s += 0.2;
  return Math.min(s, 0.99);
}

/** Best similarity of the receipt text against a SKU (its code OR its product name). */
export function scoreSku(text: string, sku: SkuLite): number {
  return Math.max(scoreAgainst(text, sku.productId), scoreAgainst(text, sku.productName ?? ""));
}

/** Rank SKUs by closeness to a receipt line text. Returns the top `limit`, best first.
 *  When `text` is empty, returns the list unchanged (score 0) so the picker still works. */
export function suggestSkus<T extends SkuLite>(text: string, skus: T[], limit = 8): ScoredSku<T>[] {
  const key = text.trim();
  if (!key) return skus.slice(0, limit).map((s) => ({ ...s, score: 0 }));
  return skus
    .map((s) => ({ ...s, score: scoreSku(key, s) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** A score the UI can label "น่าจะใช่" (confident enough to surface as a top suggestion). */
export const LIKELY_THRESHOLD = 0.45;

// ── pack units (multi-unit purchase: โหล=12, ลัง=24) ──────────────────────────

export type PackUnit = { name: string; factor: number };

/** Parse the ledger_trcloud_sku.pack_units JSON into a clean, validated list.
 *  Tolerant of bad rows (drops them). factor must be a finite number > 0. */
export function parsePackUnits(raw: unknown): PackUnit[] {
  if (!Array.isArray(raw)) return [];
  const out: PackUnit[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name.trim() : "";
    const factor = Number(o.factor);
    if (name && Number.isFinite(factor) && factor > 0) out.push({ name, factor });
  }
  return out.slice(0, 12); // sane cap
}

