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
//
// Context (2026-08-19): CEO confirmed 2 corrections while reviewing a redesigned CashHub
// Amazon table (previously an unconfirmed symmetry guess — see old comment this replaces):
//   1) "QR Manual(API)" (and by the same cvar, plain "QRManual") does NOT fold into qrapi —
//      it settles as its OWN standalone bank line, same as c12/c20/c21/c22. Removed from
//      QR_POS_GROUPS.rawLabels AND removed c13 from SETTLEMENT_GROUPS["qr"].cvars entirely —
//      c13 now flows through the normal single-channel path automatically (no group at all).
//   2) "blueplus+ wallet Manual" (a raw POS label the parser never recognized before today —
//      distinct from plain "blueplus+ wallet") IS real money and belongs in qrstd alongside
//      QRPayment + blueplus+ wallet. Added to CHANNEL_CVAR (maps to c14, same as the other
//      wallet variants) and to qrstd's rawLabels.

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

// ── shared test config: qr group members (c2, c14) + standalone c13, c15 — c14 given a
//    nonzero fee (5%) specifically so split-line fee math is actually exercised, not just
//    0*x=0 · c15 given feePercent=0 (matches real DEFAULT_CHANNELS) · no "qrcredit" entry in
//    `base` below → cfgFor("qrcredit") falls through to DEFAULT_CHANNELS' 0.91% (2026-08-20:
//    now config-driven, no longer hardcoded-only in POS_EXTRACT_GROUPS — see case below testing
//    an explicit per-org override) ──
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
  name: "(a) QR Manual(API)/QRManual do NOT fold into qrapi/qrstd — c13 settles as its own standalone row (CEO 2026-08-19 correction)",
  check: () => {
    // QR Manual(API)=20 + QRManual=10 → both land on c13, sent standalone, untouched by the
    // qrapi/qrstd split (which still ties out fine on JUST c2/c14, unaffected by c13's money)
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
    err ??= eq("qrapi unaffected by c13's money", byKey.get("qrapi")?.gross, 4505);
    err ??= eq("qrstd unaffected by c13's money", byKey.get("qrstd")?.gross, 135);
    err ??= eq("c13 sent as its own standalone row (label 'QR Manual')", byKey.get("c13")?.gross, 30);
    err ??= eq("c13 channelCode == qr (still QR-type money for bank matching)", byKey.get("c13")?.channelCode, "qr");
    err ??= eq("c13 not flagged split (it's a plain standalone channel, not a group)", byKey.get("c13")?.split, undefined);
    return err;
  },
});

cases.push({
  name: "(a) blueplus+ wallet Manual joins qrstd alongside QRPayment + blueplus+ wallet (CEO 2026-08-19 correction — previously an unrecognized raw label)",
  check: () => {
    const channels = { c2: 4570, c14: 70 + 15 }; // blueplus+ wallet 70 + blueplus+ wallet Manual 15
    const posBreakdown = {
      "QRPayment(API)": 4505,
      QRPayment: 65,
      "blueplus+ wallet": 70,
      "blueplus+ wallet Manual": 15,
    };
    const { rows } = computeSendRows(channels, cfg(), posBreakdown);
    const byKey = new Map(rows.map((r) => [r.key, r]));
    let err: string | null = null;
    err ??= eq("qrapi unaffected", byKey.get("qrapi")?.gross, 4505);
    err ??= eq("qrstd includes blueplus+ wallet Manual (65+70+15=150)", byKey.get("qrstd")?.gross, 150);
    return err;
  },
});

cases.push({
  name: "(a2) QRCredit(API) nonzero → extracted into 'qrcredit' FIRST (own ~0.91% fee), then the qr-group REMAINDER ties out again → qrapi/qrstd split succeeds too (supersedes pre-qrcredit behavior)",
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
    err ??= eq("qrcredit fee == 230*0.91% = 2.09", byKey.get("qrcredit")?.fee, 2.09);
    err ??= eq("qrcredit net == 227.91", byKey.get("qrcredit")?.net, 227.91);
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
    // fee: measured real ratio ~0.9105% on this exact day (08-03) — our flat 0.91% gives 1.73,
    // net 188.27 (matches the real bank line exactly)
    err ??= eq("qrcredit fee == 190*0.91% = 1.73", byKey.get("qrcredit")?.fee, 1.73);
    err ??= eq("qrcredit net == 188.27", byKey.get("qrcredit")?.net, 188.27);
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
    err ??= eq("qrcredit fee == 150*0.91% = 1.37 (one fee on the combined sum, not two separate fees)", byKey.get("qrcredit")?.fee, 1.37);
    err ??= eq("qrcredit net == 148.63", byKey.get("qrcredit")?.net, 148.63);
    err ??= eq("qrcredit spans both cvars", byKey.get("qrcredit")?.memberCvars.sort(), ["c15", "c2"]);
    err ??= eq("no standalone c15 row (fully extracted)", byKey.has("c15"), false);
    err ??= eq("qr group still ties out on the c2/c14 remainder", byKey.get("qrapi")?.gross, 4505);
    return err;
  },
});

cases.push({
  name: "(a5b) 2026-08-20: qrcredit's feePercent/companyId/bankAccountId come from configByCvar.get('qrcredit') when a CEO override exists — not just the DEFAULT_CHANNELS/POS_EXTRACT_GROUPS fallback",
  check: () => {
    const channels = { c15: 190 };
    const posBreakdown = { "blueplus+ credit(API)": 190 };
    const overriddenCfg = cfg({
      // base has no "qrcredit" entry to spread onto → supply the full shape here (cfg()'s merge
      // is `{...base[k], ...patch}`; base["qrcredit"] is undefined for a brand-new key)
      qrcredit: {
        cvar: "qrcredit",
        label: "QRCredit + blueplus Credit (API)",
        isSettle: true,
        feePercent: 2,
        minSettleBaht: 0,
        companyId: "co-qrcredit-special",
        bankAccountId: "bank-qrcredit-special",
      },
    });
    const { rows } = computeSendRows(channels, overriddenCfg, posBreakdown);
    const byKey = new Map(rows.map((r) => [r.key, r]));
    let err: string | null = null;
    err ??= eq("qrcredit fee uses the 2% override, not the 0.91% default (190*2%=3.8)", byKey.get("qrcredit")?.fee, 3.8);
    err ??= eq("qrcredit net == 186.2", byKey.get("qrcredit")?.net, 186.2);
    err ??= eq("qrcredit companyId uses the override, not the member cvar's", byKey.get("qrcredit")?.companyId, "co-qrcredit-special");
    err ??= eq("qrcredit bankAccountId uses the override, not the member cvar's", byKey.get("qrcredit")?.bankAccountId, "bank-qrcredit-special");
    return err;
  },
});

cases.push({
  name: "(a5c) 2026-08-20: with NO configByCvar entry for 'qrcredit' at all (org that never touched settings), feePercent falls back to DEFAULT_CHANNELS' 0.91% — never silently 0%",
  check: () => {
    const channels = { c15: 190 };
    const posBreakdown = { "blueplus+ credit(API)": 190 };
    const { rows } = computeSendRows(channels, cfg(), posBreakdown); // cfg() base has no "qrcredit" key at all
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return eq("qrcredit fee falls back to 0.91% default (190*0.91%=1.73)", byKey.get("qrcredit")?.fee, 1.73);
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
    // c13 removed from SETTLEMENT_GROUPS["qr"].cvars 2026-08-19 (QR Manual settles standalone
    // now, not as a legacy pre-2026-06 shape to clean up) — its ref must NOT appear here, else
    // the currently-valid standalone "c13" row sent today would get deleted right after being
    // created (same self-delete bug class the "(d) combined-mode day" test below guards against)
    err ??= eq("includes old per-cvar legacy refs (pre-2026-06 shape) — c2/c14 only, not c13", [
      refs.includes("amz-4097-2026-08-01-c2"),
      refs.includes("amz-4097-2026-08-01-c13"),
      refs.includes("amz-4097-2026-08-01-c14"),
    ], [true, false, true]);
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
// (f) resolveSendChannels
//
// History (2026-08-16/17): sendDaysToReconcile used to prefer iv_channels (an already-issued
// TRCloud invoice) over the raw POS file whenever an invoice existed, on the theory that a
// confirmed invoice is more trustworthy than the raw file. Two bugs came from that: (1) a
// double-subtract when the invoice reclassified money into a channel POS_EXTRACT_GROUPS didn't
// expect (06-14: QRCredit(API) ฿80 filed under "Grab" in the invoice → booked ฿6,939 instead of
// the real ฿7,019), and (2) losing a legitimate same-domain split when the invoice just merged
// two POS cvars together (06-02: c15's blueplus+ credit(API) ฿70 folded into c14 in the
// invoice → lumped ฿9,823 instead of the real ฿9,468+฿285 split). Both were eventually patched
// with increasingly careful iv_channels-vs-posBreakdown tie-out guards inside computeSendRows.
//
// ✅ CEO decision 2026-08-20: stop preferring iv_channels for sending ENTIRELY. Always use the
// raw POS file — "POS จะตรงกว่าแม่นกว่า" (POS is more accurate). Any mismatch between POS and a
// later TRCloud invoice is now purely informational (the small yellow "IV X (±Y)" number in
// amazon-excel-grid.tsx), never used to decide what actually gets sent. This makes the whole
// iv_channels-preference bug class above moot from this call site — resolveSendChannels now
// unconditionally returns day.channels, so channels and posBreakdown always come from the same
// POS parse and can never disagree with each other. The safety guards inside computeSendRows
// (wide-domain tie-out, per-cvar guard) are left in place — harmless, and still relevant if any
// other call site ever passes iv_channels into computeSendRows directly (e.g. a future
// "what would change vs the confirmed invoice" preview).
// ─────────────────────────────────────────────────────────────────────────────
cases.push({
  name: "(f) resolveSendChannels: iv_channels present+non-empty → STILL uses raw POS channels (2026-08-20: CEO says POS 100%, iv_channels no longer preferred for sending)",
  check: () => {
    const day = {
      channels: { c1: 100, c2: 200 },
      iv_channels: { c1: 100, c2: 190, c20: 10 },
      posBreakdown: { QRPayment: 200 },
    };
    const { channels, posBreakdown, usingIvChannels } = resolveSendChannels(day);
    let err: string | null = null;
    err ??= eq("channels == day.channels (NOT iv_channels, even though iv_channels exists)", channels, day.channels);
    err ??= eq("posBreakdown passed through unchanged", posBreakdown, day.posBreakdown);
    err ??= eq("usingIvChannels flag always false now", usingIvChannels, false);
    return err;
  },
});

cases.push({
  name: "(f) resolveSendChannels: iv_channels null/absent → uses raw POS channels, keeps posBreakdown (same as above — no branching left at all)",
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
  name: "(f) resolveSendChannels: iv_channels={} (empty object) → uses raw POS + posBreakdown",
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
  name: "(f) real-world regression — store 4097 2026-06-14, REVISITED for the 2026-08-20 POS-only policy: the invoice once filed QRCredit(API) ฿80 under Grab(c20), but we now ignore iv_channels entirely — that ฿80 sends as 'qrcredit' (from raw POS) same as any other day, and NO Grab row is created at all (raw POS never had Grab money that day)",
  check: () => {
    // exact real data pulled from prod (cashhub_amazon_daily, store 4097, 2026-06-14) — iv_channels
    // kept in the fixture only to prove resolveSendChannels ignores it now (see (f) unit tests above)
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
    const byKey = new Map(rows.map((r) => [r.key, r]));
    let err: string | null = null;
    err ??= eq("channels came from raw POS, not iv_channels", channels, day.channels);
    err ??= eq(
      "qrcredit extracts the QRCredit(API) ฿80 straight from POS (no more per-cvar guard blocking it — channels/posBreakdown always agree now)",
      byKey.get("qrcredit")?.gross,
      80,
    );
    err ??= eq("no Grab(c20) row at all — raw POS never had Grab money this day, iv_channels' phantom c20 is ignored", rows.some((r) => r.key === "c20"), false);
    err ??= eq("qrapi absorbs the remainder (QRPayment(API) 6734 + blueplus wallet(API) 285 = 7019)", byKey.get("qrapi")?.gross, 7019);
    err ??= eq(
      "money conserved: c1+c12+qrcredit+qrapi == full settled total (14319, excludes non-settling Redeem/ส่วนลด TRUE)",
      round2sum([byKey.get("c1")?.gross, byKey.get("c12")?.gross, byKey.get("qrcredit")?.gross, byKey.get("qrapi")?.gross]),
      14319,
    );
    return err;
  },
});

cases.push({
  name: "(g) real-world regression — store 4097 2026-06-02, REVISITED for the 2026-08-20 POS-only policy: the invoice once merged c15's blueplus+ credit(API) INTO c14's blueplus wallet, but since we ignore iv_channels entirely now, raw POS's already-correct c15=70 is used directly — straightforward split, no 'recovery' step needed at all: qrcredit=70, qrapi=9468, qrstd=285",
  check: () => {
    // exact real data pulled from prod (cashhub_amazon_daily, store 4097, 2026-06-02) — iv_channels
    // kept in the fixture only to prove resolveSendChannels ignores it (channels below == day.channels,
    // NOT the merged iv_channels shape) — this used to require the wide-domain tie-out (step -1)
    // recovery mechanism to un-merge; now channels/posBreakdown agree from the start (both raw POS),
    // so the normal step-0 path handles it with no "recovery" involved.
    const day = {
      channels: { c1: 11079, c2: 9683, c11: 260, c12: 120, c14: 70, c15: 70 },
      iv_channels: { c1: 11079, c2: 9683, c11: 260, c12: 120, c14: 140 },
      posBreakdown: {
        Redeem: 260,
        QRPayment: 215,
        "QRPayment(API)": 9468,
        "blueplus+ wallet": 70,
        "blueplus+ credit(API)": 70,
        "เครดิต EDC": 120,
        "ยอดชำระด้วยเงินสด": 11079,
      },
    };
    const { channels, posBreakdown } = resolveSendChannels(day);
    // c14 feePercent=0 to match real production config for this branch (same override as the
    // 06-14 case above — cfg()'s 5% default is only there to exercise fee math elsewhere).
    const { rows, splitGroupKeys } = computeSendRows(channels, cfg({ c14: { feePercent: 0 } }), posBreakdown);
    const byKey = new Map(rows.map((r) => [r.key, r]));
    let err: string | null = null;
    err ??= eq("channels came from raw POS (c15=70), not the merged iv_channels (c14=140)", channels, day.channels);
    err ??= eq("posBreakdown passed through (not dropped)", posBreakdown, day.posBreakdown);
    err ??= eq("qr group reported as split", splitGroupKeys, ["qr"]);
    err ??= eq("qrcredit gross == 70 (blueplus+ credit(API) alone — QRCredit(API) absent today)", byKey.get("qrcredit")?.gross, 70);
    err ??= eq("qrcredit fee == 70*0.91% = 0.64", byKey.get("qrcredit")?.fee, 0.64);
    err ??= eq("qrcredit net == 69.36 — the CEO's expected 3rd (small) bank line", byKey.get("qrcredit")?.net, 69.36);
    err ??= eq("qrapi gross == 9468 — matches the real bank deposit CEO pointed at exactly", byKey.get("qrapi")?.gross, 9468);
    err ??= eq("qrstd gross == 285 (215 QRPayment + 70 blueplus wallet) — CEO's other expected bank line", byKey.get("qrstd")?.gross, 285);
    err ??= eq("no leftover standalone c15/c14 row (fully absorbed into qrcredit/qrstd)", [byKey.has("c15"), byKey.has("c14")], [false, false]);
    err ??= eq(
      "money conserved: qrcredit+qrapi+qrstd+c1+c12 gross == full settled total (21022, excludes non-settling Redeem 260)",
      round2sum([byKey.get("qrcredit")?.gross, byKey.get("qrapi")?.gross, byKey.get("qrstd")?.gross, byKey.get("c1")?.gross, byKey.get("c12")?.gross]),
      21022,
    );
    return err;
  },
});
