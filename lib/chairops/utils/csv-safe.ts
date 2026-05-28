// CSV cell escaping — prevent formula injection when CSV opens in Excel/Sheets
// HIGH-004 fix from SECURITY-REVIEW.md
//
// Cells starting with `=`, `+`, `-`, `@`, `\t`, `\r` can be interpreted as formula
// by spreadsheet apps. Prefix with `'` to neutralize.

const DANGEROUS_PREFIXES = new Set(["=", "+", "-", "@", "\t", "\r"]);

export function safeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (s.length === 0) return "";
  if (DANGEROUS_PREFIXES.has(s[0]!)) {
    s = "'" + s;
  }
  // Quote if contains comma / quote / newline
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    s = '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export function csvRow(values: unknown[]): string {
  return values.map(safeCsvCell).join(",") + "\n";
}
