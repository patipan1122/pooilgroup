// Bank adapter registry — auto-detect bank format from file content.

import { ttbAdapter } from "./ttb";
import { scbAdapter } from "./scb";
import { kbankAdapter } from "./kbank";
import { bblAdapter } from "./bbl";
import { templateAdapter } from "./template";
import type { BankAdapter, ParseResult } from "./types";

export * from "./types";
export { parseBaacManual } from "./baac-manual";
export type { BaacManualEntry } from "./baac-manual";
export { templateAdapter, TEMPLATE_FORMAT } from "./template";

const ADAPTERS: BankAdapter[] = [
  kbankAdapter, // detect first (most distinctive header format)
  bblAdapter,
  ttbAdapter,
  scbAdapter,
  templateAdapter, // LAST — generic fallback for any account (incl. banks w/o a dedicated parser)
];

/**
 * Auto-detect the bank format from file content and parse.
 * Returns null if no adapter recognizes the file.
 */
export function detectAndParse(content: string): ParseResult | null {
  for (const adapter of ADAPTERS) {
    if (adapter.detect(content)) {
      return adapter.parse(content);
    }
  }
  return null;
}

/**
 * Parse with a specific bank adapter.
 * Use when the bank is known (e.g. user selected it manually).
 */
export function parseByBank(
  bankCode: string,
  content: string,
): ParseResult | null {
  const adapter = ADAPTERS.find((a) => a.bankCode === bankCode);
  return adapter ? adapter.parse(content) : null;
}

export { ADAPTERS };
