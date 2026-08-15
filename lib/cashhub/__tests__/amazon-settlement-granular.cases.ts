// Shared, runner-agnostic assertion cases for CashHub Amazon granular POS-column
// sending (computeSendRows + sanitizeRefLabel + legacyRefsForDay). Pure, no DB.
// Used by BOTH amazon-settlement-granular.test.ts (vitest) and
// amazon-settlement-granular.run.ts (tsx today) — mirrors
// lib/ledger/__tests__/reconcile-combo-match.cases.ts pattern.
//
// Context (2026-08-15): CEO decision — send the MAXIMALLY GRANULAR real POS sub-column
// numbers (one ledger_revenue_entry row per raw POS label) instead of guessing a
// bank-settlement grouping rule, whenever a day's real posBreakdown is available and its
// sum ties out with the cvar totals actually being sent (channels/iv_channels) — otherwise
// fall back to EXACTLY the old single combined-row behavior, unchanged.

import type { ChannelConfig } from "../amazon-settlement";
import { computeSendRows, sanitizeRefLabel, legacyRefsForDay } from "../amazon-settlement";

export interface Case {
  name: string;
  check: () => string | null;
}

export const cases: Case[] = [];

function eq(label: string, actual: unknown, expected: unknown): string | null {
  return JSON.stringify(actual) === JSON.stringify(expected)
    ? null
    : `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
}

// ── shared test config: qr group members (c2, c13, c14) — c14 given a nonzero fee
//    (5%) specifically so granular-line fee math is actually exercised, not just 0*x=0 ──
function cfg(overrides: Partial<Record<string, Partial<ChannelConfig>>> = {}): Map<string, ChannelConfig> {
  const base: Record<string, ChannelConfig> = {
    c2: { cvar: "c2", label: "QR", isSettle: true, feePercent: 0, minSettleBaht: 0, companyId: "co-1", bankAccountId: "bank-1" },
    c13: { cvar: "c13", label: "QR Manual", isSettle: true, feePercent: 0, minSettleBaht: 0, companyId: "co-1", bankAccountId: "bank-1" },
    c14: { cvar: "c14", label: "blueplus wallet", isSettle: true, feePercent: 5, minSettleBaht: 0, companyId: "co-1", bankAccountId: "bank-1" },
  };
  for (const [k, patch] of Object.entries(overrides)) base[k] = { ...base[k], ...patch };
  return new Map(Object.entries(base));
}

// ─────────────────────────────────────────────────────────────────────────────
// (a) day WITH posBreakdown → N granular rows, correct per-line amount + fee
// ─────────────────────────────────────────────────────────────────────────────
cases.push({
  name: "(a) day with posBreakdown that ties out → sends 3 granular rows, not 1 combined",
  check: () => {
    const channels = { c2: 4570, c14: 70 }; // QRPayment(API) 4505 + QRPayment 65 = c2 4570 · wallet 70
    const posBreakdown = { "QRPayment(API)": 4505, QRPayment: 65, "blueplus+ wallet": 70 };
    const { rows, granularGroupKeys } = computeSendRows(channels, cfg(), posBreakdown);
    if (rows.length !== 3) return `expected 3 granular rows, got ${rows.length}: ${JSON.stringify(rows)}`;
    const byKey = new Map(rows.map((r) => [r.key, r]));
    const e1 = byKey.get("qr-c2-qrpayment-api");
    const e2 = byKey.get("qr-c2-qrpayment");
    const e3 = byKey.get("qr-c14-blueplus-wallet");
    if (!e1 || !e2 || !e3) return `missing expected granular keys, got ${JSON.stringify([...byKey.keys()])}`;
    let err: string | null = null;
    err ??= eq("QRPayment(API) gross", e1.gross, 4505);
    err ??= eq("QRPayment(API) fee (c2 feePercent=0)", e1.fee, 0);
    err ??= eq("QRPayment(API) net", e1.net, 4505);
    err ??= eq("QRPayment gross", e2.gross, 65);
    err ??= eq("QRPayment net", e2.net, 65);
    err ??= eq("wallet gross", e3.gross, 70);
    err ??= eq("wallet fee (c14 feePercent=5% of 70 = 3.5)", e3.fee, 3.5);
    err ??= eq("wallet net (70-3.5)", e3.net, 66.5);
    err ??= eq("all 3 rows flagged granular", rows.every((r) => r.granular === true), true);
    err ??= eq("granularGroupKeys", granularGroupKeys, ["qr"]);
    return err;
  },
});

cases.push({
  name: "(a) granular row gross sums back to the exact group total (no money lost/created in the split)",
  check: () => {
    const channels = { c2: 4570, c14: 70 };
    const posBreakdown = { "QRPayment(API)": 4505, QRPayment: 65, "blueplus+ wallet": 70 };
    const { rows } = computeSendRows(channels, cfg(), posBreakdown);
    const sumGross = rows.reduce((a, r) => a + r.gross, 0);
    return eq("sum of granular gross == 4640 (4570+70)", Math.round(sumGross * 100) / 100, 4640);
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// (b) day WITHOUT posBreakdown → exactly the old single combined row, unchanged
// ─────────────────────────────────────────────────────────────────────────────
cases.push({
  name: "(b) day without posBreakdown (undefined) → 1 combined row, same as pre-granular behavior",
  check: () => {
    const channels = { c2: 4570, c14: 70 };
    const { rows, granularGroupKeys } = computeSendRows(channels, cfg(), undefined);
    if (rows.length !== 1) return `expected 1 combined row, got ${rows.length}: ${JSON.stringify(rows)}`;
    const r = rows[0];
    let err: string | null = null;
    err ??= eq("combined key", r.key, "qr");
    err ??= eq("combined gross", r.gross, 4640);
    err ??= eq("combined fee (only c14 has fee: 70*5%=3.5)", r.fee, 3.5);
    err ??= eq("combined net", r.net, 4636.5);
    err ??= eq("not flagged granular", r.granular, undefined);
    err ??= eq("granularGroupKeys empty", granularGroupKeys, []);
    return err;
  },
});

cases.push({
  name: "(b) day with posBreakdown=null (historical row, DB null) → same combined row as undefined",
  check: () => {
    const channels = { c2: 4570, c14: 70 };
    const a = computeSendRows(channels, cfg(), null);
    const b = computeSendRows(channels, cfg(), undefined);
    return eq("null posBreakdown == undefined posBreakdown result", a, b);
  },
});

cases.push({
  name: "(b) day with posBreakdown={} (empty object) → falls back to combined (nothing to split)",
  check: () => {
    const channels = { c2: 4570, c14: 70 };
    const { rows, granularGroupKeys } = computeSendRows(channels, cfg(), {});
    return eq("empty breakdown → 1 combined row, no granular groups", [rows.length, granularGroupKeys], [1, []]);
  },
});

// ── safety net beyond the literal spec: posBreakdown present but does NOT tie out with
//    the channels actually being sent (e.g. iv_channels reclassified money after TRCloud
//    posted — see amazon-settlement-data.ts comment on iv_channels vs raw POS channels) ──
cases.push({
  name: "(safety net) posBreakdown present but sum mismatches channels gross → falls back to combined (does not silently split wrong numbers)",
  check: () => {
    // channels says c2=5000 (e.g. iv_channels reclassified some money INTO c2) but the raw
    // POS breakdown for that day only accounts for 4570 worth of c2-mapped labels — a 430
    // baht gap that must NOT be silently absorbed into a granular split of stale numbers.
    const channels = { c2: 5000, c14: 70 };
    const posBreakdown = { "QRPayment(API)": 4505, QRPayment: 65, "blueplus+ wallet": 70 };
    const { rows, granularGroupKeys } = computeSendRows(channels, cfg(), posBreakdown);
    if (rows.length !== 1) return `expected fallback to 1 combined row on mismatch, got ${rows.length} rows`;
    let err: string | null = null;
    err ??= eq("fallback combined gross uses the real (channels) total, not the stale breakdown sum", rows[0].gross, 5070);
    err ??= eq("no granular groups reported", granularGroupKeys, []);
    return err;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// sanitizeRefLabel — deterministic, ref-safe, non-empty
// ─────────────────────────────────────────────────────────────────────────────
cases.push({
  name: "sanitizeRefLabel: real POS labels sanitize to distinct, stable, lowercase-dash strings",
  check: () => {
    const pairs: [string, string][] = [
      ["QRPayment(API)", "qrpayment-api"],
      ["QRPayment", "qrpayment"],
      ["QRCredit(API)", "qrcredit-api"],
      ["QRManual", "qrmanual"],
      ["QR Manual(API)", "qr-manual-api"],
      ["blueplus+ wallet", "blueplus-wallet"],
      ["blueplus+ wallet (API)", "blueplus-wallet-api"],
    ];
    for (const [input, expected] of pairs) {
      const got = sanitizeRefLabel(input);
      if (got !== expected) return `sanitizeRefLabel(${JSON.stringify(input)}) = ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`;
    }
    // all distinct (no accidental collisions among real labels)
    const outputs = pairs.map(([input]) => sanitizeRefLabel(input));
    if (new Set(outputs).size !== outputs.length) return `sanitizeRefLabel produced duplicate outputs: ${JSON.stringify(outputs)}`;
    return null;
  },
});

cases.push({
  name: "sanitizeRefLabel: symbols-only label never produces an empty ref segment",
  check: () => eq("fallback placeholder", sanitizeRefLabel("!!!"), "x"),
});

cases.push({
  name: "sanitizeRefLabel: deterministic across repeated calls (idempotent for re-send)",
  check: () => eq("same input → same output twice", sanitizeRefLabel("QRPayment(API)"), sanitizeRefLabel("QRPayment(API)")),
});

// ─────────────────────────────────────────────────────────────────────────────
// (c) legacyRefsForDay — old-shape cleanup ref list (ref selection only; the SQL
// WHERE match_state='unmatched' AND NOT EXISTS match_item guard in
// amazon-settlement-data.ts::sendDaysToReconcile is unchanged and is what actually
// protects matched/confirmed rows — that guard is not re-tested here, see report)
// ─────────────────────────────────────────────────────────────────────────────
cases.push({
  name: "(c) granular day → legacy refs include the OLD combined-group ref for cleanup",
  check: () => {
    const refs = legacyRefsForDay("4097", "2026-08-01", ["qr"]);
    let err: string | null = null;
    err ??= eq("includes old combined ref", refs.includes("amz-4097-2026-08-01-qr"), true);
    err ??= eq("includes old per-cvar legacy refs (pre-2026-06 shape)", [
      refs.includes("amz-4097-2026-08-01-c2"),
      refs.includes("amz-4097-2026-08-01-c13"),
      refs.includes("amz-4097-2026-08-01-c14"),
    ], [true, true, true]);
    return err;
  },
});

cases.push({
  name: "(c) combined-mode day (no granular groups) → legacy refs do NOT include the combined ref (must not self-delete the row just sent)",
  check: () => {
    const refs = legacyRefsForDay("4097", "2026-08-01", []);
    return eq("combined ref absent when day is not granular", refs.includes("amz-4097-2026-08-01-qr"), false);
  },
});

cases.push({
  name: "(c) legacy refs are scoped to the exact store+date (no cross-day/cross-store leakage)",
  check: () => {
    const refs = legacyRefsForDay("4097", "2026-08-01", ["qr"]);
    const bad = refs.filter((r) => !r.startsWith("amz-4097-2026-08-01-"));
    return eq("no ref outside this store+date prefix", bad, []);
  },
});
