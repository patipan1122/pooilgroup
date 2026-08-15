// Shared, runner-agnostic assertion cases for CashHub Amazon "qr" settlement-group split
// (computeSendRows + legacyRefsForDay). Pure, no DB.
// Used by BOTH amazon-settlement-granular.test.ts (vitest) and
// amazon-settlement-granular.run.ts (tsx today) — mirrors
// lib/ledger/__tests__/reconcile-combo-match.cases.ts pattern.
//
// Context (2026-08-15): CEO gave the EXACT real business rule for how the bank posts the
// "QR + Wallet" settlement group (verified against real 2026-08-01 data: QRPayment=฿65,
// QRPayment(API)=฿4,505, blueplus+wallet=฿70, blueplus+wallet(API)=฿0):
//   Group "qrapi" = QRPayment(API) + blueplus+ wallet (API) → ฿4,505 (matches the real large
//     bank deposit line exactly)
//   Group "qrstd" = QRPayment + blueplus+ wallet → ฿135 (matches the real small bank deposit
//     line exactly)
// This REPLACES an earlier same-day attempt (send 1 row per raw POS label, let a generic
// N:M combo-matcher figure out the grouping) — this file was rewritten to test the 2-group
// rule instead of full per-label granularity. When posBreakdown is missing or doesn't tie
// out, computeSendRows falls back to EXACTLY the old (pre-2026-08-15) single combined row.

import type { ChannelConfig } from "../amazon-settlement";
import { computeSendRows, legacyRefsForDay } from "../amazon-settlement";

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
//    (5%) specifically so split-line fee math is actually exercised, not just 0*x=0 ──
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
// (a) day WITH posBreakdown that ties out → exactly 2 rows: "qrapi" + "qrstd"
//     (real 2026-08-01-shaped data, per CEO's own worked example)
// ─────────────────────────────────────────────────────────────────────────────
cases.push({
  name: '(a) 2026-08-01-shaped data → exactly groups "qrapi"=4505 and "qrstd"=135, correct fee math',
  check: () => {
    const channels = { c2: 4570, c13: 0, c14: 70 }; // QRPayment(API) 4505 + QRPayment 65 = c2 4570 · wallet 70
    const posBreakdown = {
      "QRPayment(API)": 4505,
      QRPayment: 65,
      "blueplus+ wallet": 70,
      // "blueplus+ wallet (API)" absent (₿0 that day — real parser omits 0-amount labels)
    };
    const { rows, splitGroupKeys } = computeSendRows(channels, cfg(), posBreakdown);
    if (rows.length !== 2) return `expected 2 split rows, got ${rows.length}: ${JSON.stringify(rows)}`;
    const byKey = new Map(rows.map((r) => [r.key, r]));
    const api = byKey.get("qrapi");
    const std = byKey.get("qrstd");
    if (!api || !std) return `missing expected keys, got ${JSON.stringify([...byKey.keys()])}`;
    let err: string | null = null;
    err ??= eq("qrapi gross", api.gross, 4505);
    err ??= eq("qrapi label", api.label, "QR + Wallet (API)");
    err ??= eq("qrapi fee (c2 feePercent=0)", api.fee, 0);
    err ??= eq("qrapi net", api.net, 4505);
    err ??= eq("qrapi flagged split", api.split, true);
    err ??= eq("qrstd gross (65 QRPayment + 70 wallet)", std.gross, 135);
    err ??= eq("qrstd label", std.label, "QR + Wallet");
    // fee: QRPayment(c2, 0%) contributes 0 · blueplus wallet(c14, 5%) contributes 70*5%=3.5
    err ??= eq("qrstd fee (only c14 portion has fee: 70*5%=3.5)", std.fee, 3.5);
    err ??= eq("qrstd net (135-3.5)", std.net, 131.5);
    err ??= eq("qrstd flagged split", std.split, true);
    err ??= eq("splitGroupKeys", splitGroupKeys, ["qr"]);
    return err;
  },
});

cases.push({
  name: "(a) split row gross sums back to the exact group total (no money lost/created in the split)",
  check: () => {
    const channels = { c2: 4570, c14: 70 };
    const posBreakdown = { "QRPayment(API)": 4505, QRPayment: 65, "blueplus+ wallet": 70 };
    const { rows } = computeSendRows(channels, cfg(), posBreakdown);
    const sumGross = rows.reduce((a, r) => a + r.gross, 0);
    return eq("sum of split gross == 4640 (4570+70)", Math.round(sumGross * 100) / 100, 4640);
  },
});

cases.push({
  name: "(a) QR Manual(API)/QRManual fold into the correct bucket by (API) symmetry (QRCredit(API) excluded — see next case)",
  check: () => {
    // QR Manual(API)=20 (→ qrapi), QRManual=10 (→ qrstd) — no QRCredit(API) here so the split still ties out
    const channels = { c2: 4570, c13: 30, c14: 70 };
    const posBreakdown = {
      "QRPayment(API)": 4505,
      QRPayment: 65,
      "QR Manual(API)": 20,
      QRManual: 10,
      "blueplus+ wallet": 70,
    };
    const { rows } = computeSendRows(channels, cfg(), posBreakdown);
    const byKey = new Map(rows.map((r) => [r.key, r]));
    let err: string | null = null;
    err ??= eq("qrapi includes QR Manual(API)", byKey.get("qrapi")?.gross, 4505 + 20);
    err ??= eq("qrstd includes QRManual", byKey.get("qrstd")?.gross, 65 + 70 + 10);
    return err;
  },
});

cases.push({
  name: "(a2) QRCredit(API) nonzero → does NOT fold into qrapi, breaks tie-out → safe fallback to 1 combined row",
  check: () => {
    // DB-verified 2026-08-15 against real bank data (08-05/08-09): QRCredit(API) settles via a
    // THIRD separate bank line (account "AMZ A_SD4097"), not bundled with qrapi. Forcing it into
    // qrapi overstated the send amount by exactly the QRCredit(API) value on both real days it
    // occurred. Correct behavior: it's excluded from both rawLabels arrays, so the breakdown sum
    // falls short of the cvar-level gross by that amount → tiesOut=false → fallback to 1 line,
    // exactly like a day with no posBreakdown at all (safe: never silently mis-splits).
    const channels = { c2: 4570 + 230, c14: 70 }; // QRCredit(API)=230, matching the real 08-05 gap
    const posBreakdown = {
      "QRPayment(API)": 4505,
      QRPayment: 65,
      "QRCredit(API)": 230,
      "blueplus+ wallet": 70,
    };
    const { rows, splitGroupKeys } = computeSendRows(channels, cfg(), posBreakdown);
    let err: string | null = null;
    err ??= splitGroupKeys.length === 0 ? null : `expected no split, got splitGroupKeys=${JSON.stringify(splitGroupKeys)}`;
    err ??= rows.length === 1 ? null : `expected 1 combined row, got ${rows.length}`;
    err ??= eq("combined row gross == full total incl. QRCredit(API)", rows[0]?.gross, 4570 + 230 + 70);
    return err;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// (b) day WITHOUT posBreakdown → exactly the old (pre-2026-08-15) single combined row
// ─────────────────────────────────────────────────────────────────────────────
cases.push({
  name: "(b) day without posBreakdown (undefined) → 1 combined row, exactly pre-2026-08-15 fallback behavior",
  check: () => {
    const channels = { c2: 4570, c14: 70 };
    const { rows, splitGroupKeys } = computeSendRows(channels, cfg(), undefined);
    if (rows.length !== 1) return `expected 1 combined row, got ${rows.length}: ${JSON.stringify(rows)}`;
    const r = rows[0];
    let err: string | null = null;
    err ??= eq("combined key", r.key, "qr");
    err ??= eq("combined label", r.label, "QR + Wallet");
    err ??= eq("combined gross", r.gross, 4640);
    err ??= eq("combined fee (only c14 has fee: 70*5%=3.5)", r.fee, 3.5);
    err ??= eq("combined net", r.net, 4636.5);
    err ??= eq("not flagged split", r.split, undefined);
    err ??= eq("splitGroupKeys empty", splitGroupKeys, []);
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
    const { rows, splitGroupKeys } = computeSendRows(channels, cfg(), {});
    return eq("empty breakdown → 1 combined row, no split groups", [rows.length, splitGroupKeys], [1, []]);
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// (c) posBreakdown present but does NOT tie out with the channels actually being sent
//     (e.g. iv_channels reclassified money after TRCloud posted — simulates a
//     TRCloud-reclassification day) → safe fallback to combined, same as (b)
// ─────────────────────────────────────────────────────────────────────────────
cases.push({
  name: "(c) posBreakdown present but sum mismatches channels gross → falls back to combined (does not silently split wrong numbers)",
  check: () => {
    // channels says c2=5000 (e.g. iv_channels reclassified some money INTO c2) but the raw
    // POS breakdown for that day only accounts for 4570 worth of c2-mapped labels — a 430
    // baht gap that must NOT be silently absorbed into a split of stale numbers.
    const channels = { c2: 5000, c14: 70 };
    const posBreakdown = { "QRPayment(API)": 4505, QRPayment: 65, "blueplus+ wallet": 70 };
    const { rows, splitGroupKeys } = computeSendRows(channels, cfg(), posBreakdown);
    if (rows.length !== 1) return `expected fallback to 1 combined row on mismatch, got ${rows.length} rows`;
    let err: string | null = null;
    err ??= eq("fallback combined gross uses the real (channels) total, not the stale breakdown sum", rows[0].gross, 5070);
    err ??= eq("no split groups reported", splitGroupKeys, []);
    return err;
  },
});

cases.push({
  name: "(c) posBreakdown ties out for one bucket but not the other (partial) → still safe: whole group falls back to combined",
  check: () => {
    // Only "qrapi"-shaped money present (4505) but channels c2 total is inflated to 4600 —
    // group-level tie-out (breakdownSum vs gross) must fail and fall back, not partially split.
    const channels = { c2: 4600, c14: 0 };
    const posBreakdown = { "QRPayment(API)": 4505 };
    const { rows, splitGroupKeys } = computeSendRows(channels, cfg(), posBreakdown);
    let err: string | null = null;
    err ??= eq("falls back to 1 combined row", rows.length, 1);
    err ??= eq("combined key", rows[0]?.key, "qr");
    err ??= eq("no split groups reported", splitGroupKeys, []);
    return err;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// (d) legacyRefsForDay — old-shape cleanup ref list (ref selection only; the SQL
// WHERE match_state='unmatched' AND NOT EXISTS match_item guard in
// amazon-settlement-data.ts::sendDaysToReconcile is unchanged and is what actually
// protects matched/confirmed rows — that guard is not re-tested here, see report)
// ─────────────────────────────────────────────────────────────────────────────
cases.push({
  name: "(d) split day → legacy refs include the OLD combined-group ref for cleanup",
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
  name: "(d) combined-mode day (no split groups) → legacy refs do NOT include the combined ref (must not self-delete the row just sent)",
  check: () => {
    const refs = legacyRefsForDay("4097", "2026-08-01", []);
    return eq("combined ref absent when day is not split", refs.includes("amz-4097-2026-08-01-qr"), false);
  },
});

cases.push({
  name: "(d) legacy refs are scoped to the exact store+date (no cross-day/cross-store leakage)",
  check: () => {
    const refs = legacyRefsForDay("4097", "2026-08-01", ["qr"]);
    const bad = refs.filter((r) => !r.startsWith("amz-4097-2026-08-01-"));
    return eq("no ref outside this store+date prefix", bad, []);
  },
});

cases.push({
  name: "(d) legacy refs never include the new qrapi/qrstd keys themselves (only the old combined + pre-2026-06 per-cvar shapes)",
  check: () => {
    const refs = legacyRefsForDay("4097", "2026-08-01", ["qr"]);
    return eq("no qrapi/qrstd ref in legacy list", [
      refs.includes("amz-4097-2026-08-01-qrapi"),
      refs.includes("amz-4097-2026-08-01-qrstd"),
    ], [false, false]);
  },
});
