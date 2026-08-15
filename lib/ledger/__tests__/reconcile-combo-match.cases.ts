// Shared, runner-agnostic assertion cases for findBankCombo (N:1 bank-line matching) AND
// findBookCombo (1:M — the reverse direction, added 2026-08-15 for CashHub Amazon granular
// sending, where a bank statement may still post one lump settlement even though the book
// side now sends several rows). Used by BOTH reconcile-combo-match.test.ts (vitest) and
// reconcile-combo-match.run.ts (tsx today) — pure, no DB. Mirrors
// lib/ledger/__tests__/completeness.cases.ts pattern.

import { findBankCombo, findBookCombo, type ComboBankCandidate, type ComboBookCandidate } from "../reconcile-combo-match";
import { MATCH_CONCEPTS } from "../reconcile-match-keywords";

export interface Case {
  name: string;
  /** returns an error string on failure, or null on pass */
  check: () => string | null;
}

export const cases: Case[] = [];

const DAY = 86400000;
const day = (n: number) => n * DAY; // fake epoch-ms anchored at day n

function eq(label: string, actual: unknown, expected: unknown): string | null {
  return JSON.stringify(actual) === JSON.stringify(expected)
    ? null
    : `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
}

function idsEqualUnordered(a: string[], b: string[]): boolean {
  return a.length === b.length && [...a].sort().join(",") === [...b].sort().join(",");
}

// --- case 1: real CEO scenario — 2 QR bank lines sum to 1 book entry ------
// 2026-08-01: ฿135.00 + ฿4,505.00 = ฿4,640.00 (verified real bank data, exact to satang)
cases.push({
  name: "2-line sum: ฿135 + ฿4,505 = ฿4,640 QR settlement matches (pair)",
  check: () => {
    const candidates: ComboBankCandidate[] = [
      { id: "bk-135", amountSatang: 13_500, dateMs: day(1), text: "thai qr payment settle a" },
      { id: "bk-4505", amountSatang: 450_500, dateMs: day(1), text: "thai qr payment settle b" },
    ];
    const res = findBankCombo(464_000, day(1), MATCH_CONCEPTS.qr, candidates, []);
    if (!res) return "expected a combo, got null";
    if (!idsEqualUnordered(res.ids, ["bk-135", "bk-4505"]))
      return `expected ids [bk-135, bk-4505], got ${JSON.stringify(res.ids)}`;
    return null;
  },
});

// --- case 2: no valid pair, but a valid triple exists ----------------------
cases.push({
  name: "3-line sum: no pair sums to target, but all 3 lines together do (triple)",
  check: () => {
    const candidates: ComboBankCandidate[] = [
      { id: "a", amountSatang: 100_000, dateMs: day(2), text: "qr payment a" },
      { id: "b", amountSatang: 100_000, dateMs: day(2), text: "qr payment b" },
      { id: "c", amountSatang: 100_000, dateMs: day(2), text: "qr payment c" },
    ];
    // any 2 sum to 200,000 (≠ 300,000 target, way outside ±100 tol) → no pair
    // all 3 sum to 300,000 exactly → the one triple
    const res = findBankCombo(300_000, day(2), MATCH_CONCEPTS.qr, candidates, []);
    if (!res) return "expected a triple combo, got null";
    if (!idsEqualUnordered(res.ids, ["a", "b", "c"]))
      return `expected ids [a,b,c], got ${JSON.stringify(res.ids)}`;
    return null;
  },
});

// --- case 3: ambiguous pairs → must NOT auto-match --------------------------
cases.push({
  name: "ambiguous: 2 different valid pairs both sum to target → returns null (no guess)",
  check: () => {
    const candidates: ComboBankCandidate[] = [
      { id: "a", amountSatang: 100_000, dateMs: day(3), text: "" }, // cash: requireName=false
      { id: "b", amountSatang: 400_000, dateMs: day(3), text: "" },
      { id: "c", amountSatang: 200_000, dateMs: day(3), text: "" },
      { id: "d", amountSatang: 300_000, dateMs: day(3), text: "" },
    ];
    // a+b = 500,000 AND c+d = 500,000 → both valid, ambiguous → must skip
    const res = findBankCombo(500_000, day(3), MATCH_CONCEPTS.cash, candidates, []);
    return eq("ambiguous pair result", res, null);
  },
});

// --- case 4: ambiguous pairs must NOT fall through to triples --------------
cases.push({
  name: "ambiguous pairs skip triple search entirely (per spec: only try triples if 0 pairs found)",
  check: () => {
    const candidates: ComboBankCandidate[] = [
      { id: "a", amountSatang: 100_000, dateMs: day(4), text: "" },
      { id: "b", amountSatang: 400_000, dateMs: day(4), text: "" },
      { id: "c", amountSatang: 200_000, dateMs: day(4), text: "" },
      { id: "d", amountSatang: 300_000, dateMs: day(4), text: "" },
      { id: "e", amountSatang: 0, dateMs: day(4), text: "" }, // makes a+b+e also = 500,000 (would-be triple)
    ];
    const res = findBankCombo(500_000, day(4), MATCH_CONCEPTS.cash, candidates, []);
    // must be null (ambiguous pairs short-circuit) — NOT the a+b+e triple
    return eq("must not fall through to triple when pairs are ambiguous", res, null);
  },
});

// --- case 5: single candidate (< 2) never matches ---------------------------
cases.push({
  name: "fewer than 2 candidates never produces a combo",
  check: () => {
    const res = findBankCombo(
      100_000,
      day(5),
      MATCH_CONCEPTS.qr,
      [{ id: "only-one", amountSatang: 100_000, dateMs: day(5), text: "qr payment" }],
      [],
    );
    return eq("single-candidate result", res, null);
  },
});

// --- case 6: opposite sign is excluded even if |sum| matches ----------------
cases.push({
  name: "opposite-sign candidate excluded (in-money book must not combine with an out-money bank line)",
  check: () => {
    const candidates: ComboBankCandidate[] = [
      { id: "pos", amountSatang: 250_000, dateMs: day(6), text: "qr payment" },
      { id: "neg", amountSatang: -250_000, dateMs: day(6), text: "qr payment" }, // wrong side
      { id: "pos2", amountSatang: 250_000, dateMs: day(6), text: "qr payment" },
    ];
    // only "pos" + "pos2" are same-side and sum to 500,000
    const res = findBankCombo(500_000, day(6), MATCH_CONCEPTS.qr, candidates, []);
    if (!res) return "expected pos+pos2 combo, got null";
    return eq("opposite-sign excluded from combo", res.ids.includes("neg"), false);
  },
});

// --- case 7: concept keyword mismatch excludes a candidate even if sum matches --
cases.push({
  name: "concept name-lock: candidate without required keyword excluded (grab must say grab/แกร็บ)",
  check: () => {
    const candidates: ComboBankCandidate[] = [
      { id: "grab1", amountSatang: 100_000, dateMs: day(7), text: "แกร็บ payout" },
      { id: "other1", amountSatang: 100_000, dateMs: day(7), text: "random transfer, no keyword" },
    ];
    // sum would be 200,000 but "other1" fails the grab name-lock → filtered out → <2 candidates → null
    const res = findBankCombo(200_000, day(7), MATCH_CONCEPTS.grab, candidates, []);
    return eq("name-lock filters non-matching candidate → no combo", res, null);
  },
});

// --- case 8: outside date window excludes a candidate -----------------------
cases.push({
  name: "date-window: candidate outside concept.dateWindowDays excluded even if sum matches",
  check: () => {
    const candidates: ComboBankCandidate[] = [
      { id: "near", amountSatang: 100_000, dateMs: day(8), text: "qr payment" },
      { id: "far", amountSatang: 100_000, dateMs: day(8 + 10), text: "qr payment" }, // qr window = 2 days
    ];
    const res = findBankCombo(200_000, day(8), MATCH_CONCEPTS.qr, candidates, []);
    return eq("out-of-window candidate excluded → no combo", res, null);
  },
});

// --- case 9: candidate cap (MAX_COMBO_CANDIDATES) skips search entirely -----
cases.push({
  name: "candidate cap: exceeding MAX_COMBO_CANDIDATES skips N:1 search for this book entry",
  check: () => {
    const candidates: ComboBankCandidate[] = [];
    for (let i = 0; i < 26; i++) {
      candidates.push({ id: `c${i}`, amountSatang: 1000, dateMs: day(9), text: "qr payment" });
    }
    // any 2 sum to 2000 — would normally be wildly ambiguous anyway, but the cap must
    // short-circuit BEFORE the combinatorial search even runs (26 > 25)
    const res = findBankCombo(2000, day(9), MATCH_CONCEPTS.qr, candidates, []);
    return eq("over-cap candidate list returns null", res, null);
  },
});

// --- case 10: tolerance is the SAME per-concept rule, not loosened for sums --
cases.push({
  name: "tolerance: qr concept tolAbsSatang=100 applies to the SUM, not a looser rule",
  check: () => {
    const candidates: ComboBankCandidate[] = [
      { id: "a", amountSatang: 100_000, dateMs: day(10), text: "qr payment" },
      { id: "b", amountSatang: 100_150, dateMs: day(10), text: "qr payment" }, // sum diff = 150 > tol 100
    ];
    const res = findBankCombo(200_000, day(10), MATCH_CONCEPTS.qr, candidates, []);
    return eq("sum outside tolerance must not match", res, null);
  },
});

// ═════════════════════════════════════════════════════════════════════════════
// findBookCombo — reverse direction (1 bank txn : 2-3 book entries), added
// 2026-08-15 for CashHub Amazon granular sending. Reuses findBankCombo as its
// combinatorial/tolerance/ambiguity core (see reconcile-combo-match.ts) — these
// cases exercise the NEW part: grouping book candidates by concept, and treating
// "more than one concept group finds a valid combo" as ambiguous too.
// ═════════════════════════════════════════════════════════════════════════════

function refsEqualUnordered(
  a: { bookType: string; bookId: string }[],
  b: { bookType: string; bookId: string }[],
): boolean {
  const norm = (xs: { bookType: string; bookId: string }[]) =>
    [...xs].map((x) => `${x.bookType}:${x.bookId}`).sort().join(",");
  return norm(a) === norm(b);
}

// --- case 11: real CashHub Amazon scenario — 2 granular book rows sum to 1 bank txn ---
cases.push({
  name: "findBookCombo: 2-line sum — ฿4,505 (QRPayment(API) row) + ฿65 (QRPayment row) = ฿4,570 bank settlement matches (pair)",
  check: () => {
    const candidates: ComboBookCandidate[] = [
      { bookType: "revenue", bookId: "b-qrapi", amountSatang: 450_500, dateMs: day(20), channel: "QR" },
      { bookType: "revenue", bookId: "b-qr", amountSatang: 6_500, dateMs: day(20), channel: "QR" },
    ];
    const res = findBookCombo(457_000, day(20), "thai qr payment settle", candidates, {});
    if (!res) return "expected a combo, got null";
    if (!refsEqualUnordered(res, [
      { bookType: "revenue", bookId: "b-qrapi" },
      { bookType: "revenue", bookId: "b-qr" },
    ])) return `expected [b-qrapi, b-qr], got ${JSON.stringify(res)}`;
    return null;
  },
});

// --- case 12: no valid pair, but a valid triple exists (mirrors findBankCombo case 2) ---
cases.push({
  name: "findBookCombo: 3-line sum — no pair sums to target, but all 3 book lines together do (triple)",
  check: () => {
    const candidates: ComboBookCandidate[] = [
      { bookType: "revenue", bookId: "x", amountSatang: 100_000, dateMs: day(21), channel: "เงินสด" },
      { bookType: "revenue", bookId: "y", amountSatang: 100_000, dateMs: day(21), channel: "เงินสด" },
      { bookType: "revenue", bookId: "z", amountSatang: 100_000, dateMs: day(21), channel: "เงินสด" },
    ];
    // any 2 sum to 200,000 (≠ 300,000, way outside cash tol) → no pair · all 3 = 300,000 exactly
    const res = findBookCombo(300_000, day(21), "cash deposit", candidates, {});
    if (!res) return "expected a triple combo, got null";
    if (!refsEqualUnordered(res, [
      { bookType: "revenue", bookId: "x" },
      { bookType: "revenue", bookId: "y" },
      { bookType: "revenue", bookId: "z" },
    ])) return `expected [x,y,z], got ${JSON.stringify(res)}`;
    return null;
  },
});

// --- case 13: ambiguous WITHIN one concept → must NOT auto-match ---
cases.push({
  name: "findBookCombo: ambiguous within same concept — 2 different valid pairs both sum to target → null (no guess)",
  check: () => {
    const candidates: ComboBookCandidate[] = [
      { bookType: "revenue", bookId: "a", amountSatang: 100_000, dateMs: day(22), channel: "เงินสด" },
      { bookType: "revenue", bookId: "b", amountSatang: 400_000, dateMs: day(22), channel: "เงินสด" },
      { bookType: "revenue", bookId: "c", amountSatang: 200_000, dateMs: day(22), channel: "เงินสด" },
      { bookType: "revenue", bookId: "d", amountSatang: 300_000, dateMs: day(22), channel: "เงินสด" },
    ];
    // a+b = 500,000 AND c+d = 500,000 → both valid, ambiguous → must skip
    const res = findBookCombo(500_000, day(22), "cash deposit", candidates, {});
    return eq("ambiguous same-concept pair result", res, null);
  },
});

// --- case 14: ambiguous ACROSS concepts (new: only findBookCombo has this concern) ---
cases.push({
  name: "findBookCombo: ambiguous across concepts — a QR pair AND a cash pair both sum to target → null (not just first-found)",
  check: () => {
    const candidates: ComboBookCandidate[] = [
      // qr concept: keywords required, bank text below contains "qr" so this group passes
      { bookType: "revenue", bookId: "qr1", amountSatang: 100_000, dateMs: day(23), channel: "QR" },
      { bookType: "revenue", bookId: "qr2", amountSatang: 100_000, dateMs: day(23), channel: "QR" },
      // cash concept: requireName=false → always passes the name check regardless of bank text
      { bookType: "revenue", bookId: "cash1", amountSatang: 100_000, dateMs: day(23), channel: "เงินสด" },
      { bookType: "revenue", bookId: "cash2", amountSatang: 100_000, dateMs: day(23), channel: "เงินสด" },
    ];
    const res = findBookCombo(200_000, day(23), "qr payment settle", candidates, {});
    return eq("ambiguous across concept groups → must not match either", res, null);
  },
});

// --- case 15: single candidate (< 2) never produces a combo ---
cases.push({
  name: "findBookCombo: fewer than 2 same-concept candidates never produces a combo",
  check: () => {
    const res = findBookCombo(
      100_000,
      day(24),
      "qr payment",
      [{ bookType: "revenue", bookId: "only-one", amountSatang: 100_000, dateMs: day(24), channel: "QR" }],
      {},
    );
    return eq("single-candidate result", res, null);
  },
});

// --- case 16: opposite sign excluded (expense/payment book lines are negative) ---
cases.push({
  name: "findBookCombo: opposite-sign book line excluded even if |sum| matches (in-money bank must not combine with an out-money book entry)",
  check: () => {
    const candidates: ComboBookCandidate[] = [
      { bookType: "revenue", bookId: "pos", amountSatang: 250_000, dateMs: day(25), channel: "QR" },
      { bookType: "expense", bookId: "neg", amountSatang: -250_000, dateMs: day(25), channel: "QR" }, // wrong side
      { bookType: "revenue", bookId: "pos2", amountSatang: 250_000, dateMs: day(25), channel: "QR" },
    ];
    const res = findBookCombo(500_000, day(25), "qr payment", candidates, {});
    if (!res) return "expected pos+pos2 combo, got null";
    return eq("opposite-sign excluded from combo", res.some((r) => r.bookId === "neg"), false);
  },
});

// --- case 17: extraKeywords (account keyword map) are honored per concept, same as pass 1/2 ---
cases.push({
  name: "findBookCombo: account-learned keyword (kwMap) lets a bank text pass a concept it wouldn't by default",
  check: () => {
    const candidates: ComboBookCandidate[] = [
      { bookType: "revenue", bookId: "g1", amountSatang: 100_000, dateMs: day(26), channel: "Grab" },
      { bookType: "revenue", bookId: "g2", amountSatang: 100_000, dateMs: day(26), channel: "Grab" },
    ];
    // bank text has neither "แกร็บ" nor "grab" — default keywords fail
    const noKw = findBookCombo(200_000, day(26), "food delivery payout xyz corp", candidates, {});
    const withKw = findBookCombo(200_000, day(26), "food delivery payout xyz corp", candidates, {
      grab: ["xyz corp"],
    });
    let err: string | null = null;
    err ??= eq("without learned keyword: no match", noKw, null);
    err ??= eq("with learned keyword: matches", withKw !== null, true);
    return err;
  },
});

// --- case 18: Pass-1/Pass-2 regression guard — findBankCombo itself is untouched by the
//     findBookCombo addition; re-run the original real-CEO 2-line scenario to prove it ---
cases.push({
  name: "regression guard: findBankCombo (pass 2, N-bank:1-book) unaffected by findBookCombo addition",
  check: () => {
    const candidates: ComboBankCandidate[] = [
      { id: "bk-135", amountSatang: 13_500, dateMs: day(27), text: "thai qr payment settle a" },
      { id: "bk-4505", amountSatang: 450_500, dateMs: day(27), text: "thai qr payment settle b" },
    ];
    const res = findBankCombo(464_000, day(27), MATCH_CONCEPTS.qr, candidates, []);
    if (!res) return "expected a combo, got null";
    return eq("still finds [bk-135, bk-4505]", [...res.ids].sort(), ["bk-135", "bk-4505"]);
  },
});
