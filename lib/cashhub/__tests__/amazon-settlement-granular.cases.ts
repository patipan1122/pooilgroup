// Shared, runner-agnostic assertion cases for CashHub Amazon settlement-group splits
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
//
// Context (2026-08-15, same day, later): CEO approved a 3RD group (POS_EXTRACT_GROUPS,
// key "qrcredit") after DB-verifying 12 real KBank statement lines (description "...AMZ
// A_SD4097...", July+Aug 2026): QRCredit(API) (raw label inside cvar c2) and
// blueplus+ credit(API) (raw label inside cvar c15) settle THIRD, separately from qrapi/qrstd
// AND separately from the plain "blueplus credit" (c15) line, net of a ~0.9-0.913% card-style
// fee (matches the already-established "เครดิต EDC" c12 fee formula almost exactly). This is
// WHY test (a2) below changed: QRCredit(API) money used to force qrapi/qrstd to fall back to
// 1 combined row (it broke the tie-out sum) — now it gets extracted into "qrcredit" FIRST, so
// the qr-group remainder ties out again and qrapi/qrstd split succeeds too (fixes the "blank
// split columns" CEO saw live on days QRCredit(API)≠0, e.g. 2026-08-05/08-09).

import type { ChannelConfig } from "../amazon-settlement";
import { computeSendRows, legacyRefsForDay, resolveSendChannels } from "../amazon-settlement";

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

// ── shared test config: qr group members (c2, c13, c14) + standalone c15 — c14 given a
//    nonzero fee (5%) specifically so split-line fee math is actually exercised, not just
//    0*x=0 · c15 given feePercent=0 (matches real DEFAULT_CHANNELS) so qrcredit's OWN 0.9%
//    fee (from POS_EXTRACT_GROUPS, not configByCvar) is what's actually being exercised ──
function cfg(overrides: Partial<Record<string, Partial<ChannelConfig>>> = {}): Map<string, ChannelConfig> {
  const base: Record<string, ChannelConfig> = {
    c2: { cvar: "c2", label: "QR", isSettle: true, feePercent: 0, minSettleBaht: 0, companyId: "co-1", bankAccountId: "bank-1" },
    c13: { cvar: "c13", label: "QR Manual", isSettle: true, feePercent: 0, minSettleBaht: 0, companyId: "co-1", bankAccountId: "bank-1" },
    c14: { cvar: "c14", label: "blueplus wallet", isSettle: true, feePercent: 5, minSettleBaht: 0, companyId: "co-1", bankAccountId: "bank-1" },
    c15: { cvar: "c15", label: "blueplus credit", isSettle: true, feePercent: 0, minSettleBaht: 0, companyId: "co-1", bankAccountId: "bank-1" },
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
  name: "(a2) QRCredit(API) nonzero → extracted into 'qrcredit' FIRST (own ~0.9% fee), then the qr-group REMAINDER ties out again → qrapi/qrstd split succeeds too (supersedes pre-qrcredit behavior)",
  check: () => {
    // DB-verified 2026-08-15 against real bank data (08-05/08-09, updated same-day after the
    // qrapi/qrstd-only version of this file shipped): QRCredit(API) settles via a THIRD separate
    // bank line (account "...AMZ A_SD4097..."), not bundled with qrapi, NOT part of the "qr"
    // SETTLEMENT_GROUPS at all — POS_EXTRACT_GROUPS pulls its money OUT of c2's settled gross
    // before the "qr" group's tie-out check runs. Once removed, the c2 remainder (4570) matches
    // qrapi/qrstd's raw-label sum again exactly like the QRCredit(API)-free case (a) → the split
    // now ALSO succeeds. This is the exact fix for the "blank qrapi/qrstd columns" CEO saw live
    // on 08-05/08-09 (previously QRCredit(API) broke tie-out for the WHOLE qr group, not just
    // its own slice).
    const channels = { c2: 4570 + 230, c14: 70 }; // QRCredit(API)=230, matching the real 08-05 gap
    const posBreakdown = {
      "QRPayment(API)": 4505,
      QRPayment: 65,
      "QRCredit(API)": 230,
      "blueplus+ wallet": 70,
    };
    const { rows, splitGroupKeys } = computeSendRows(channels, cfg(), posBreakdown);
    const byKey = new Map(rows.map((r) => [r.key, r]));
    let err: string | null = null;
    err ??= eq("3 rows total (qrcredit + qrapi + qrstd)", rows.length, 3);
    err ??= eq("qr group still reported as split", splitGroupKeys, ["qr"]);
    err ??= eq("qrcredit gross == 230 (QRCredit(API) alone, blueplus+ credit(API) absent today)", byKey.get("qrcredit")?.gross, 230);
    err ??= eq("qrcredit fee == 230*0.9% = 2.07", byKey.get("qrcredit")?.fee, 2.07);
    err ??= eq("qrcredit net == 227.93", byKey.get("qrcredit")?.net, 227.93);
    err ??= eq("qrcredit label", byKey.get("qrcredit")?.label, "QRCredit + blueplus Credit (API)");
    err ??= eq("qrcredit channelCode == card", byKey.get("qrcredit")?.channelCode, "card");
    err ??= eq("qrcredit flagged split", byKey.get("qrcredit")?.split, true);
    err ??= eq("qrapi ties out again on the remainder (unchanged from case (a))", byKey.get("qrapi")?.gross, 4505);
    err ??= eq("qrstd ties out again on the remainder (unchanged from case (a))", byKey.get("qrstd")?.gross, 135);
    err ??= eq(
      "no money lost/created: qrcredit+qrapi+qrstd gross == full original total incl. QRCredit(API)",
      round2sum([byKey.get("qrcredit")?.gross, byKey.get("qrapi")?.gross, byKey.get("qrstd")?.gross]),
      4570 + 230 + 70,
    );
    return err;
  },
});

cases.push({
  name: "(a3) blueplus+ credit(API) nonzero (c15) → extracted into 'qrcredit', plain 'blueplus credit' (c15) row disappears entirely when it was the ONLY c15 money that day (no double count)",
  check: () => {
    // Real 08-03 shape: blueplus+ credit(API)=190 is the ONLY money in c15 that day (this store's
    // POS this month has no non-API "blueplus+ Credit" column at all — see amazon-parse.ts).
    const channels = { c2: 4570, c14: 70, c15: 190 };
    const posBreakdown = {
      "QRPayment(API)": 4505,
      QRPayment: 65,
      "blueplus+ wallet": 70,
      "blueplus+ credit(API)": 190,
    };
    const { rows, extractedStandaloneCvars } = computeSendRows(channels, cfg(), posBreakdown);
    const byKey = new Map(rows.map((r) => [r.key, r]));
    let err: string | null = null;
    err ??= eq("qrcredit gross == 190 (blueplus+ credit(API) alone)", byKey.get("qrcredit")?.gross, 190);
    // fee: measured real ratio ~0.9105% on this exact day (08-03) — our flat 0.9% gives 1.71,
    // net 188.29 (real bank line was 188.27 — 2 satang off, within any reasonable match tolerance)
    err ??= eq("qrcredit fee == 190*0.9% = 1.71", byKey.get("qrcredit")?.fee, 1.71);
    err ??= eq("qrcredit net == 188.29", byKey.get("qrcredit")?.net, 188.29);
    err ??= eq("no standalone c15 row this day (fully extracted, not double-counted)", byKey.has("c15"), false);
    err ??= eq("c15 flagged for legacy-ref cleanup (old full-amount ref may be stale)", extractedStandaloneCvars, ["c15"]);
    // qr group (c2/c14) unaffected — c15 money never touched it in the first place
    err ??= eq("qrapi unaffected", byKey.get("qrapi")?.gross, 4505);
    err ??= eq("qrstd unaffected", byKey.get("qrstd")?.gross, 135);
    return err;
  },
});

cases.push({
  name: "(a4) blueplus+ credit(API) is only PART of c15's money that day → remainder still sent as a (smaller) standalone 'c15' row, not lost",
  check: () => {
    // Simulates a future/other-store month where c15 also carries non-API "blueplus+ Credit"
    // money alongside blueplus+ credit(API) — channels.c15 (200) > the extracted raw label (190)
    // by 10, representing that other (non-extracted) money, which must still be sent.
    const channels = { c15: 200 };
    const posBreakdown = { "blueplus+ credit(API)": 190 };
    const { rows, extractedStandaloneCvars } = computeSendRows(channels, cfg(), posBreakdown);
    const byKey = new Map(rows.map((r) => [r.key, r]));
    let err: string | null = null;
    err ??= eq("qrcredit gross == 190 (only the (API) raw label)", byKey.get("qrcredit")?.gross, 190);
    err ??= eq("c15 standalone row == remainder (200-190=10), not the full 200 (no double count)", byKey.get("c15")?.gross, 10);
    err ??= eq("c15 fee recomputed on the REMAINDER using c15's own configPercent (0%)", byKey.get("c15")?.fee, 0);
    err ??= eq("c15 flagged for legacy-ref cleanup (amount changed from 200→10)", extractedStandaloneCvars, ["c15"]);
    return err;
  },
});

cases.push({
  name: "(a5) BOTH QRCredit(API) and blueplus+ credit(API) nonzero same day (never observed in real data yet, but must be architecturally correct) → single 'qrcredit' row = their SUM, one shared fee",
  check: () => {
    const channels = { c2: 4570 + 100, c14: 70, c15: 50 };
    const posBreakdown = {
      "QRPayment(API)": 4505,
      QRPayment: 65,
      "blueplus+ wallet": 70,
      "QRCredit(API)": 100,
      "blueplus+ credit(API)": 50,
    };
    const { rows } = computeSendRows(channels, cfg(), posBreakdown);
    const byKey = new Map(rows.map((r) => [r.key, r]));
    let err: string | null = null;
    err ??= eq("qrcredit gross == 150 (100+50 combined)", byKey.get("qrcredit")?.gross, 150);
    err ??= eq("qrcredit fee == 150*0.9% = 1.35 (one fee on the combined sum, not two separate fees)", byKey.get("qrcredit")?.fee, 1.35);
    err ??= eq("qrcredit net == 148.65", byKey.get("qrcredit")?.net, 148.65);
    err ??= eq("qrcredit spans both cvars", byKey.get("qrcredit")?.memberCvars.sort(), ["c15", "c2"]);
    err ??= eq("no standalone c15 row (fully extracted)", byKey.has("c15"), false);
    err ??= eq("qr group still ties out on the c2/c14 remainder", byKey.get("qrapi")?.gross, 4505);
    return err;
  },
});

cases.push({
  name: "(a6) no posBreakdown at all → POS_EXTRACT_GROUPS never fires (can't isolate raw labels) → QRCredit(API)/blueplus+credit(API) money stays baked into c2/c15 exactly like before 2026-08-15's qrcredit group existed",
  check: () => {
    const channels = { c2: 4800, c15: 190 }; // c2 already includes whatever QRCredit(API) portion existed
    const { rows, extractedStandaloneCvars, splitGroupKeys } = computeSendRows(channels, cfg(), undefined);
    const byKey = new Map(rows.map((r) => [r.key, r]));
    let err: string | null = null;
    err ??= eq("no qrcredit row", byKey.has("qrcredit"), false);
    err ??= eq("c15 sent in full (190), nothing extracted", byKey.get("c15")?.gross, 190);
    err ??= eq("qr group falls back to combined (no breakdown to split on)", byKey.get("qr")?.gross, 4800);
    err ??= eq("no extraction cleanup needed", extractedStandaloneCvars, []);
    err ??= eq("no qr-group split reported", splitGroupKeys, []);
    return err;
  },
});

cases.push({
  name: "(a7) qrcredit ties out independently of qrapi/qrstd — qrcredit extracts fine even on a day where the REST of c2 does NOT tie out (TRCloud reclassification-style gap unrelated to QRCredit(API))",
  check: () => {
    // channels.c2 has an extra unexplained 500 on top of QRCredit(API)+QRPayment(API)+QRPayment —
    // simulates iv_channels reclassifying money into c2 from elsewhere. qrcredit only cares about
    // its own 2 raw labels tying out against THEMSELVES (there's nothing to "tie out" against for
    // an extract group beyond "the raw label has money" — unlike qrapi/qrstd's group-wide check),
    // so it must still extract correctly while qr falls back to combined for the remainder.
    const channels = { c2: 4570 + 230 + 500, c14: 70 };
    const posBreakdown = {
      "QRPayment(API)": 4505,
      QRPayment: 65,
      "QRCredit(API)": 230,
      "blueplus+ wallet": 70,
    };
    const { rows, splitGroupKeys } = computeSendRows(channels, cfg(), posBreakdown);
    const byKey = new Map(rows.map((r) => [r.key, r]));
    let err: string | null = null;
    err ??= eq("qrcredit still extracts correctly", byKey.get("qrcredit")?.gross, 230);
    err ??= eq("no qrapi row (qr group's remainder doesn't tie out — the extra 500 breaks it)", byKey.has("qrapi"), false);
    err ??= eq("qr group falls back to combined for the remainder (4570+70+500=5140)", byKey.get("qr")?.gross, 5140);
    err ??= eq("qr group not reported as split", splitGroupKeys, []);
    return err;
  },
});

cases.push({
  name: "(a8) c15 isSettle=false → qrcredit skips the blueplus+ credit(API) slice entirely (config off = no money reported at all, same as any other disabled channel)",
  check: () => {
    const channels = { c15: 190 };
    const posBreakdown = { "blueplus+ credit(API)": 190 };
    const { rows, extractedStandaloneCvars } = computeSendRows(
      channels,
      cfg({ c15: { isSettle: false } }),
      posBreakdown,
    );
    let err: string | null = null;
    err ??= eq("no rows at all (c15 disabled)", rows.length, 0);
    err ??= eq("no extraction cleanup (nothing was extracted)", extractedStandaloneCvars, []);
    return err;
  },
});

function round2sum(vals: (number | undefined)[]): number {
  return Math.round(vals.reduce((a: number, v) => a + (v ?? 0), 0) * 100) / 100;
}

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

// ─────────────────────────────────────────────────────────────────────────────
// (e) legacyRefsForDay's new 4th param (extractedStandaloneCvars) — cleanup for standalone
// cvars (e.g. "c15") touched by POS_EXTRACT_GROUPS today, which the g.cvars loop above never
// covers (c15 is not a member of any SETTLEMENT_GROUPS)
// ─────────────────────────────────────────────────────────────────────────────
cases.push({
  name: "(e) extractedStandaloneCvars adds the standalone cvar's plain ref for cleanup (e.g. c15) — NOT covered by the SETTLEMENT_GROUPS g.cvars loop",
  check: () => {
    const withoutExtract = legacyRefsForDay("4097", "2026-08-03", []);
    const withExtract = legacyRefsForDay("4097", "2026-08-03", [], ["c15"]);
    let err: string | null = null;
    err ??= eq("c15 ref absent without extraction info", withoutExtract.includes("amz-4097-2026-08-03-c15"), false);
    err ??= eq("c15 ref present once extraction touched it", withExtract.includes("amz-4097-2026-08-03-c15"), true);
    return err;
  },
});

cases.push({
  name: "(e) extractedStandaloneCvars defaults to [] when omitted (backward-compatible call signature)",
  check: () => eq("no 4th arg == same result as []", legacyRefsForDay("4097", "2026-08-03", ["qr"]), legacyRefsForDay("4097", "2026-08-03", ["qr"], [])),
});

cases.push({
  name: "(e) legacy refs never include 'qrcredit' itself (same precedent as qrapi/qrstd — brand new key, no prior ref of that name ever existed to clean up)",
  check: () => {
    const refs = legacyRefsForDay("4097", "2026-08-03", ["qr"], ["c15"]);
    return eq("no qrcredit ref in legacy list", refs.includes("amz-4097-2026-08-03-qrcredit"), false);
  },
});

cases.push({
  name: "(e) end-to-end: a real qrcredit-extraction day's computeSendRows output feeds legacyRefsForDay correctly (c15 flagged, qrcredit itself not, qr group flagged since it split)",
  check: () => {
    const channels = { c2: 4570 + 230, c14: 70, c15: 190 };
    const posBreakdown = {
      "QRPayment(API)": 4505,
      QRPayment: 65,
      "blueplus+ wallet": 70,
      "QRCredit(API)": 230,
      "blueplus+ credit(API)": 190,
    };
    const { splitGroupKeys, extractedStandaloneCvars } = computeSendRows(channels, cfg(), posBreakdown);
    const refs = legacyRefsForDay("4097", "2026-08-05", splitGroupKeys, extractedStandaloneCvars);
    let err: string | null = null;
    err ??= eq("qr (old combined ref) flagged — it split this run", refs.includes("amz-4097-2026-08-05-qr"), true);
    err ??= eq("c15 (old standalone ref) flagged — qrcredit extracted its money", refs.includes("amz-4097-2026-08-05-c15"), true);
    err ??= eq("qrcredit itself not flagged (brand new key)", refs.includes("amz-4097-2026-08-05-qrcredit"), false);
    err ??= eq("qrapi/qrstd not flagged (brand new sub-keys, same precedent)", [
      refs.includes("amz-4097-2026-08-05-qrapi"),
      refs.includes("amz-4097-2026-08-05-qrstd"),
    ], [false, false]);
    return err;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// (f) resolveSendChannels — bug 2026-08-16: sendDaysToReconcile used to pass POS-raw
// posBreakdown into computeSendRows even on days where the CHANNELS actually being sent
// came from iv_channels (an already-issued TRCloud invoice) instead of the live POS file.
// When the invoice's own categorization already differs from the raw POS split (e.g. an
// old invoice filed "QRCredit(API)" money under the "Grab" cvar instead of leaving it in
// the QR cvar), POS_EXTRACT_GROUPS subtracted that same money a SECOND time from
// iv_channels's QR total — real store 4097 case: booked ฿6,939 instead of the real
// ฿7,019 bank deposit, plus a phantom "Grab ฿67.20" line. Fix: posBreakdown may only ride
// along with channels that came from the live POS file — never with iv_channels.
// ─────────────────────────────────────────────────────────────────────────────
cases.push({
  name: "(f) resolveSendChannels: iv_channels present+non-empty → uses iv_channels, drops posBreakdown",
  check: () => {
    const day = {
      channels: { c1: 100, c2: 200 },
      iv_channels: { c1: 100, c2: 190, c20: 10 },
      posBreakdown: { QRPayment: 200 },
    };
    const { channels, posBreakdown, usingIvChannels } = resolveSendChannels(day);
    let err: string | null = null;
    err ??= eq("channels == iv_channels", channels, day.iv_channels);
    err ??= eq("posBreakdown dropped (undefined)", posBreakdown, undefined);
    err ??= eq("usingIvChannels flag true", usingIvChannels, true);
    return err;
  },
});

cases.push({
  name: "(f) resolveSendChannels: iv_channels null/absent → uses raw POS channels, keeps posBreakdown",
  check: () => {
    const day = { channels: { c1: 100, c2: 200 }, iv_channels: null, posBreakdown: { QRPayment: 200 } };
    const { channels, posBreakdown, usingIvChannels } = resolveSendChannels(day);
    let err: string | null = null;
    err ??= eq("channels == day.channels", channels, day.channels);
    err ??= eq("posBreakdown passed through unchanged", posBreakdown, day.posBreakdown);
    err ??= eq("usingIvChannels flag false", usingIvChannels, false);
    return err;
  },
});

cases.push({
  name: "(f) resolveSendChannels: iv_channels={} (empty object) → treated same as absent, uses raw POS + posBreakdown",
  check: () => {
    const day = { channels: { c1: 100 }, iv_channels: {}, posBreakdown: { QRPayment: 100 } };
    const { channels, posBreakdown, usingIvChannels } = resolveSendChannels(day);
    let err: string | null = null;
    err ??= eq("channels == day.channels", channels, day.channels);
    err ??= eq("posBreakdown passed through unchanged", posBreakdown, day.posBreakdown);
    err ??= eq("usingIvChannels flag false", usingIvChannels, false);
    return err;
  },
});

cases.push({
  name: "(f) real-world regression — store 4097 2026-06-14: old invoice mis-filed QRCredit(API) money under Grab(c20) → resolveSendChannels+computeSendRows must NOT double-subtract; qr group must net exactly ฿7,019 (matches the real bank deposit), not the buggy ฿6,939",
  check: () => {
    // exact real data pulled from prod (cashhub_amazon_daily, store 4097, 2026-06-14)
    const day = {
      channels: { c1: 7100, c2: 6814, c8: 10, c11: 700, c12: 120, c14: 285 },
      iv_channels: { c1: 7100, c2: 6734, c7: 10, c11: 700, c12: 120, c14: 285, c20: 80 },
      posBreakdown: {
        Redeem: 700,
        "QRCredit(API)": 80,
        "QRPayment(API)": 6734,
        "blueplus+ wallet (API)": 285,
        "เครดิต EDC": 120,
        "ส่วนลด 10 บาท TRUE - DTAC": 10,
        "ยอดชำระด้วยเงินสด": 7100,
      },
    };
    const { channels, posBreakdown } = resolveSendChannels(day);
    // c14 feePercent=0 here to match the REAL production config for this branch (the shared
    // cfg() fixture uses 5% for other tests' fee-math coverage — irrelevant to this case).
    const { rows } = computeSendRows(channels, cfg({ c14: { feePercent: 0 } }), posBreakdown);
    const qr = rows.find((r) => r.key === "qr" || r.key === "qrapi");
    let err: string | null = null;
    err ??= eq("posBreakdown dropped because this day used iv_channels", posBreakdown, undefined);
    err ??= eq("no qrcredit extraction row (posBreakdown was dropped)", rows.some((r) => r.key === "qrcredit"), false);
    err ??= eq("qr group net == real bank deposit (฿7,019), not the old buggy ฿6,939", qr?.net, 7019);
    return err;
  },
});
