// Shared, runner-agnostic assertion cases for conceptForChannel/bankNameMatches.
// Regression: "QRCredit + blueplus Credit (API)" (CashHub Amazon channel) contains "qr" as a
// substring of "qrcredit" — conceptForChannel used to route it to the QR concept instead of
// card/EDC, so auto-match's name-check silently failed forever even when amount+date matched
// exactly (store 4097, 07-02/07-03 — see cashhub-amazon-qrcredit-branch-bankaccount-fix memory).
// Mirrors lib/ledger/__tests__/reconcile-combo-match.cases.ts pattern.

import { conceptForChannel, bankNameMatches, MATCH_CONCEPTS } from "../reconcile-match-keywords";

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

cases.push({
  name: "conceptForChannel: 'QRCredit + blueplus Credit (API)' → card (not qr, despite containing 'qr')",
  check: () => eq("concept.key", conceptForChannel("QRCredit + blueplus Credit (API)").key, "card"),
});

cases.push({
  name: "conceptForChannel: 'blueplus credit' → card (English 'credit', no Thai เครดิต)",
  check: () => eq("concept.key", conceptForChannel("blueplus credit").key, "card"),
});

cases.push({
  name: "conceptForChannel: existing 'เครดิต EDC' still → card (unaffected by the fix)",
  check: () => eq("concept.key", conceptForChannel("เครดิต EDC").key, "card"),
});

cases.push({
  name: "conceptForChannel: 'QR + Wallet (API)' still → qr (unaffected — no 'credit' substring)",
  check: () => eq("concept.key", conceptForChannel("QR + Wallet (API)").key, "qr"),
});

cases.push({
  name: "bankNameMatches: real store-4097 bank text now matches card concept for QRCredit channel",
  check: () => {
    const concept = conceptForChannel("QRCredit + blueplus Credit (API)");
    const bankText =
      "รับเงินจากการขาย เต็มจำนวน/ผ่อนชำระ/คะแนนสะสม จาก 401223250375001 amz a_sd4097 chakkarat";
    return bankNameMatches(concept, bankText) ? null : "expected bank text to match card concept keywords";
  },
});

cases.push({
  name: "bankNameMatches: same bank text does NOT match the (wrong) qr concept — proves old routing broke matching",
  check: () => {
    const bankText =
      "รับเงินจากการขาย เต็มจำนวน/ผ่อนชำระ/คะแนนสะสม จาก 401223250375001 amz a_sd4097 chakkarat";
    return bankNameMatches(MATCH_CONCEPTS.qr, bankText) === false
      ? null
      : "expected qr concept keywords to NOT be found in this bank text";
  },
});
