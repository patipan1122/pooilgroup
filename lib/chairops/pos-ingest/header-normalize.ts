// Robust header-text normalization for StarThing / Excel POS exports.
//
// Root cause (2026-06-16): an uploaded daily file failed with "missing date
// column" even though the date header was clearly in the header row. Every
// OTHER Thai header on the same file matched its alias fine -- only the FIRST
// column failed. Cause: Excel/StarThing exports frequently inject an invisible
// character on the first cell (BOM, zero-width space, bidi mark, NBSP).
// `trim().toLowerCase()` removes a leading BOM (U+FEFF is in the trim whitespace
// set) but NOT a zero-width space (U+200B) or bidi/format chars -- so the alias
// lookup missed.
//
// These helpers defend against ALL of that, and (as a fallback) against Thai
// vowel/tone composition or reorder variants. Regexes are built from \u escapes
// (ASCII source) on purpose -- never paste literal invisible chars into source.

// soft-hyphen(00AD), zero-width space/joiners + LRM/RLM(200B-200F),
// bidi embeddings/overrides(202A-202E), word-joiner(2060), BOM/ZWNBSP(FEFF).
const INVISIBLE_RE = new RegExp("[\\u00AD\\u200B-\\u200F\\u202A-\\u202E\\u2060\\uFEFF]", "g");
// Thai combining marks: mai-han-akat(0E31), above/below vowels(0E34-0E3A),
// tone marks & friends(0E47-0E4E). Excludes 0E33 (sara am, a base vowel).
const THAI_MARKS_RE = new RegExp("[\\u0E31\\u0E34-\\u0E3A\\u0E47-\\u0E4E]", "g");

/**
 * Clean a header cell into a stable lookup key:
 * NFC-normalize -> strip invisible/format chars -> fold any whitespace (incl.
 * NBSP) to a single space -> trim -> lowercase.
 */
export function cleanHeaderText(s: string): string {
  return s
    .normalize("NFC")
    .replace(INVISIBLE_RE, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Like cleanHeaderText but also strips Thai combining marks, so
 * composition/reorder variants of a word still match. Use ONLY as a fallback
 * after an exact cleanHeaderText match fails.
 */
export function baseHeaderText(s: string): string {
  return cleanHeaderText(s).replace(THAI_MARKS_RE, "");
}

/**
 * Diagnostic: render a header cell as `"text" [U+XXXX,...]` so a future failure
 * pinpoints the exact (possibly invisible) bytes without guesswork.
 */
export function headerCodepoints(s: string): string {
  const cps = [...s].map((c) => "U+" + c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0"));
  return `${JSON.stringify(s)} [${cps.join(",")}]`;
}
