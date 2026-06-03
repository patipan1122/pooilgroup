import type { DataGridColumn } from "./types";

/**
 * Excel/Sheets put TAB between columns and \r\n (or \n) between rows.
 * Cells with embedded tabs/newlines/quotes are wrapped in double quotes
 * with internal quotes doubled (RFC 4180 style).
 */
function escapeTsvCell(s: string): string {
  if (s == null) return "";
  const needsQuote = /[\t\n\r"]/.test(s);
  if (!needsQuote) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

export function rowsToTsv<T>(
  rows: T[],
  columns: DataGridColumn<T>[],
  options?: { includeHeader?: boolean },
): string {
  const cols = columns;
  const lines: string[] = [];
  if (options?.includeHeader !== false) {
    lines.push(cols.map((c) => escapeTsvCell(c.label)).join("\t"));
  }
  for (const row of rows) {
    const cells = cols.map((c) => {
      if (c.format) return escapeTsvCell(c.format(row));
      const raw = c.getValue
        ? c.getValue(row)
        : (row as Record<string, unknown>)[c.key];
      if (raw == null) return "";
      return escapeTsvCell(String(raw));
    });
    lines.push(cells.join("\t"));
  }
  return lines.join("\n");
}

/**
 * Auto-detect delimiter (Tab from Excel/Numbers, Comma from Sheets).
 * If first line contains a tab, prefer tab. Otherwise comma.
 */
function detectDelimiter(text: string): "\t" | "," {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  if (firstLine.includes("\t")) return "\t";
  return ",";
}

/**
 * Parse a TSV/CSV-ish string into a 2D array.
 * Handles quoted cells with embedded delimiters/newlines.
 */
export function parseTabular(text: string): string[][] {
  const delim = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    // not in quotes
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === delim) {
      row.push(cell);
      cell = "";
      i++;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
      // swallow \r\n as a single newline
      if (ch === "\r" && text[i + 1] === "\n") i += 2;
      else i++;
      continue;
    }
    cell += ch;
    i++;
  }
  // flush last
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/**
 * Map pasted rows onto columns. Tries (1) header match by label,
 * (2) header match by key, (3) positional fallback.
 *
 * Returns `{ headers, data }` where each data row is keyed by column.key.
 */
export function mapPastedRows<T>(
  text: string,
  columns: DataGridColumn<T>[],
): { headers: string[]; data: Record<string, string>[] } {
  const matrix = parseTabular(text);
  if (matrix.length === 0) return { headers: [], data: [] };

  const labelToKey = new Map<string, string>();
  for (const c of columns) {
    labelToKey.set(c.label.trim().toLowerCase(), c.key);
    labelToKey.set(c.key.toLowerCase(), c.key);
  }

  const headerCandidates = matrix[0].map((h) => h.trim().toLowerCase());
  const headerHits = headerCandidates.filter((h) => labelToKey.has(h)).length;
  const useHeader = headerHits >= Math.max(1, Math.ceil(matrix[0].length / 2));

  let headers: string[];
  let body: string[][];
  if (useHeader) {
    headers = matrix[0].map(
      (h, idx) => labelToKey.get(h.trim().toLowerCase()) ?? `__col_${idx}`,
    );
    body = matrix.slice(1);
  } else {
    headers = columns.map((c) => c.key);
    body = matrix;
  }

  const data: Record<string, string>[] = [];
  for (const row of body) {
    const obj: Record<string, string> = {};
    headers.forEach((key, idx) => {
      obj[key] = row[idx] ?? "";
    });
    data.push(obj);
  }
  return { headers, data };
}
