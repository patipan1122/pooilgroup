import "server-only";
import { prisma } from "@/lib/prisma";
import { isRevenueChannel, type RevenueChannelCode } from "./revenue-channel-types";

// LedgerLine — Revenue GL resolution (Wave 1 foundation, SERVER-ONLY).
//
// resolveRevenueGl(...) looks up the per-business channel→GL config and returns
// the GL snapshot to STAMP on the entry. The stamp is immutable (QA gate AG-3):
// a later config edit must never re-code historical revenue.
//
// GL is posting metadata — the match engine never reads it (SA-verified).
//
// The channel taxonomy + the pure normalizeChannel() live in the CLIENT-SAFE
// sibling revenue-channel-types.ts (no prisma / no "server-only") so client
// components can import them. Re-exported here for server callers' convenience.
export * from "./revenue-channel-types";

// ── GL resolution ───────────────────────────────────────────────────────────────

export interface RevenueGlConfig {
  channelCode: RevenueChannelCode;
  glClearing: string | null;
  glIncome: string | null;
  glFee: string | null;
  categoryId: string | null;
  label: string | null;
}

export type RevenueGlState = "resolved" | "unconfigured";

export interface ResolvedRevenueGl {
  glAccount: string | null; // snapshot = the debit-side clearing GL (where the money lands)
  glState: RevenueGlState;
  categoryId: string | null;
}

/**
 * Load the full channel→GL config for one business (≤7 rows). Cache this per
 * sync/import batch and pass it to resolveRevenueGlFromConfig() to avoid a
 * round-trip per row.
 *
 * company_id is ALWAYS in the WHERE — Prisma runs as a bypass-RLS role, so a
 * missing company filter would leak another legal entity's mapping (AG-6).
 */
export async function loadRevenueChannelGl(params: {
  orgId: string;
  companyId: string;
}): Promise<Map<RevenueChannelCode, RevenueGlConfig>> {
  const rows = await prisma.$queryRaw<
    {
      channelCode: string;
      glClearing: string | null;
      glIncome: string | null;
      glFee: string | null;
      categoryId: string | null;
      label: string | null;
    }[]
  >`
    SELECT
      channel_code as "channelCode",
      gl_clearing  as "glClearing",
      gl_income    as "glIncome",
      gl_fee       as "glFee",
      category_id::text as "categoryId",
      label
    FROM ledger_revenue_channel_gl
    WHERE org_id = ${params.orgId}::uuid
      AND company_id = ${params.companyId}::uuid
      AND is_active = true
  `;
  const map = new Map<RevenueChannelCode, RevenueGlConfig>();
  for (const r of rows) {
    if (!isRevenueChannel(r.channelCode)) continue;
    map.set(r.channelCode, {
      channelCode: r.channelCode,
      glClearing: r.glClearing,
      glIncome: r.glIncome,
      glFee: r.glFee,
      categoryId: r.categoryId,
      label: r.label,
    });
  }
  return map;
}

/**
 * Resolve the GL snapshot for one entry given a preloaded config map.
 * No config / no clearing GL → unconfigured (degrades safely, never crashes —
 * the entry falls back to provisional 4999-PROV downstream; AG-10).
 */
export function resolveRevenueGlFromConfig(
  channel: RevenueChannelCode | null,
  config: Map<RevenueChannelCode, RevenueGlConfig>,
): ResolvedRevenueGl {
  if (!channel) return { glAccount: null, glState: "unconfigured", categoryId: null };
  const cfg = config.get(channel);
  if (!cfg || !cfg.glClearing) {
    return { glAccount: null, glState: "unconfigured", categoryId: cfg?.categoryId ?? null };
  }
  return { glAccount: cfg.glClearing, glState: "resolved", categoryId: cfg.categoryId };
}

/**
 * Single-row convenience: load config + resolve in one call.
 * Prefer loadRevenueChannelGl + resolveRevenueGlFromConfig in loops.
 */
export async function resolveRevenueGl(params: {
  orgId: string;
  companyId: string;
  channel: RevenueChannelCode | null;
}): Promise<ResolvedRevenueGl> {
  if (!params.channel) return { glAccount: null, glState: "unconfigured", categoryId: null };
  const config = await loadRevenueChannelGl(params);
  return resolveRevenueGlFromConfig(params.channel, config);
}
