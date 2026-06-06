// Shared, runner-agnostic assertion cases for the completeness engine.
// Used by BOTH completeness.test.ts (vitest) and completeness.run.ts (tsx today),
// so the two entry points exercise identical checks. Pure: engine + fixtures only.

import { gradeCompleteness } from "../recheck";
import type { CompletenessInput, CompletenessResult } from "../recheck";
import type {
  CompletenessStatus,
  BuyerMatchStatus,
  InputVatBlockReason,
} from "../types";
import { OUR_BUYER } from "../group-identity";
import { zUUID } from "../../chairops/schemas/zod-helpers";
import receiptsData from "./fixtures/receipts.json";

export interface Fixture {
  name: string;
  desc: string;
  input: CompletenessInput;
  expect: {
    status: CompletenessStatus;
    buyerMatch: BuyerMatchStatus;
    blockReason: InputVatBlockReason | null;
  };
}

export const fixtures = (receiptsData as { fixtures: Fixture[] }).fixtures;

// Per task rule #3: use zUUID() (non-RFC-strict) not z.string().uuid().
// Fixtures carry slug names, not UUIDs, so we only assert the helper resolves to
// the lenient one we were told to use — guarding against a future drift back to
// z.string().uuid() in the harness.
const zUUIDSchema = zUUID();
const SAMPLE_SEED_ID = "abcdef01-2345-6789-abcd-ef0123456789"; // non-RFC-strict variant bits
const slugRe = /^[A-Z]\d{2}_[a-z0-9_]+$/;

function eq(label: string, actual: unknown, expected: unknown): string | null {
  return actual === expected
    ? null
    : `${label}: expected ${JSON.stringify(actual)} === ${JSON.stringify(expected)}`;
}

export interface Case {
  name: string;
  /** returns an error string on failure, or null on pass */
  check: () => string | null;
}

export const cases: Case[] = [];

// --- guard: contract constants -------------------------------------------
cases.push({
  name: "contract: OUR_BUYER.taxId === 0305564001581 and zUUID() is lenient",
  check: () => {
    if (OUR_BUYER.taxId !== "0305564001581") {
      return "OUR_BUYER.taxId drift — golden fixtures assume 0305564001581";
    }
    if (!zUUIDSchema.safeParse(SAMPLE_SEED_ID).success) {
      return "zUUID() rejected a non-RFC-strict seed id — wrong helper in harness";
    }
    return null;
  },
});

// --- per-fixture {status, buyerMatch, blockReason} (+ suggestedClaimable) --
for (const f of fixtures) {
  cases.push({
    name: `${f.name}: ${f.desc}`,
    check: () => {
      if (!slugRe.test(f.name)) return `bad fixture name slug: ${f.name}`;
      const r: CompletenessResult = gradeCompleteness(f.input);
      return (
        eq("status", r.status, f.expect.status) ??
        eq("buyerMatch", r.buyerMatch, f.expect.buyerMatch) ??
        eq("blockReason", r.blockReason, f.expect.blockReason) ??
        // suggestedClaimable must follow green exactly (defense-in-depth).
        eq("suggestedClaimable", r.suggestedClaimable, f.expect.status === "green_full")
      );
    },
  });
}

// --- HARD GATE (PLAN §7) --------------------------------------------------
cases.push({
  name: "HARD GATE: every lure grades red_invalid (zero false-accept)",
  check: () => {
    const lures = fixtures.filter((x) => x.name.startsWith("L"));
    if (lures.length === 0) return "no lure fixtures present";
    for (const f of lures) {
      const r = gradeCompleteness(f.input);
      const e =
        eq(`${f.name}.status`, r.status, "red_invalid") ??
        eq(`${f.name}.suggestedClaimable`, r.suggestedClaimable, false);
      if (e) return e;
    }
    return null;
  },
});

cases.push({
  name: "HARD GATE: vat=0 (no 'อย่างย่อ' keyword) is never green",
  check: () => {
    const zeros = fixtures.filter(
      (x) => (x.input.vat ?? 0) <= 0 && !(x.input.rawText ?? "").includes("อย่างย่อ"),
    );
    if (zeros.length === 0) return "no vat<=0 non-abbreviated fixtures present";
    for (const f of zeros) {
      const r = gradeCompleteness(f.input);
      if (r.status === "green_full") return `${f.name} graded green with vat<=0`;
    }
    return null;
  },
});

cases.push({
  name: "HARD GATE: abbreviated invoices grade yellow_partial / abbreviated_86_6",
  check: () => {
    const abbr = fixtures.filter((x) => (x.input.rawText ?? "").includes("อย่างย่อ"));
    if (abbr.length === 0) return "no abbreviated fixtures present";
    for (const f of abbr) {
      const r = gradeCompleteness(f.input);
      const e =
        eq(`${f.name}.status`, r.status, "yellow_partial") ??
        eq(`${f.name}.blockReason`, r.blockReason, "abbreviated_86_6");
      if (e) return e;
    }
    return null;
  },
});

cases.push({
  name: "HARD GATE: buyer name wrong but tax id exact -> NOT red (decided on the 13-digit id)",
  check: () => {
    const f = fixtures.find((x) => x.name === "F03_full_buyer_name_wrong_but_taxid_right");
    if (!f) return "F03 fixture missing";
    const r = gradeCompleteness(f.input);
    if (r.status === "red_invalid") {
      return "name-wrong-taxid-right was graded red — engine trusted the name, not the id";
    }
    return eq("status", r.status, "green_full") ?? eq("buyerMatch", r.buyerMatch, "matched");
  },
});

cases.push({
  name: "HARD GATE: one-digit-off buyer id never matches (anti false-accept)",
  check: () => {
    const f = fixtures.find((x) => x.name === "L19_one_digit_off");
    if (!f) return "L19 fixture missing";
    const r = gradeCompleteness(f.input);
    return eq("buyerMatch", r.buyerMatch, "mismatch") ?? eq("status", r.status, "red_invalid");
  },
});
