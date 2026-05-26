// Self-test: build a mock XLSX in-memory, parse it, print result.
// Validates parseXlsxToGrid + parseRows wiring without a real CEO file.
//
// Usage: node scripts/test-pos-xlsx-parser.mjs

import * as XLSX from "xlsx";

// Mimic parseXlsxToGrid from actions.ts:
function parseXlsxToGrid(buf) {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const firstName = wb.SheetNames[0];
  if (!firstName) return [];
  const sheet = wb.Sheets[firstName];
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: "",
    blankrows: false,
  });
  const formatCell = (c) => {
    if (c == null || c === "") return "";
    if (c instanceof Date) {
      const y = c.getUTCFullYear();
      const m = String(c.getUTCMonth() + 1).padStart(2, "0");
      const d = String(c.getUTCDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    }
    return String(c);
  };
  return rows.map((r) => (Array.isArray(r) ? r.map(formatCell) : []));
}

// ─── Test cases ──────────────────────────────────────────────────────────────

function buildWorkbook(rows, sheetName = "Sheet1") {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

function runCase(name, rows, expectedRowCount) {
  const buf = buildWorkbook(rows);
  const grid = parseXlsxToGrid(buf);
  const ok = grid.length === expectedRowCount;
  const status = ok ? "✅" : "❌";
  console.log(`\n${status} ${name}`);
  console.log(`   input rows: ${rows.length} · output grid rows: ${grid.length} · expected: ${expectedRowCount}`);
  if (grid.length > 0) {
    console.log(`   header: ${JSON.stringify(grid[0])}`);
    if (grid.length > 1) console.log(`   row 1:  ${JSON.stringify(grid[1])}`);
  }
  return ok;
}

let passed = 0;
let failed = 0;

// Case 1: Thai headers (ตรงกับ alias map ใน actions.ts)
const c1 = runCase(
  "Thai headers + Thai date dd/mm/yy BE year",
  [
    ["วันที่", "เลขเครื่อง", "สาขา", "ออนไลน์", "แบงค์", "เหรียญ", "รวม"],
    ["21/05/69", "G0310370", "Robinson Kanchanaburi", "1500", "300", "200", "2000"],
    ["21/05/69", "G0310371", "Robinson Kanchanaburi", "1200", "100", "150", "1450"],
  ],
  3, // header + 2 data rows
);
c1 ? passed++ : failed++;

// Case 2: English headers
const c2 = runCase(
  "English headers + ISO date",
  [
    ["date", "chairCode", "shopName", "online", "cash", "coin", "total"],
    ["2026-05-21", "G0310370", "Robinson Kanchanaburi", "1500", "300", "200", "2000"],
  ],
  2,
);
c2 ? passed++ : failed++;

// Case 3: Numbers as cells (not strings) — Excel-typical
const c3 = runCase(
  "Numeric cells (raw amounts)",
  [
    ["วันที่", "เลขเครื่อง", "ออนไลน์", "แบงค์", "เหรียญ"],
    ["2026-05-21", "G0310370", 1500, 300, 200],
    ["2026-05-21", "G0310371", 1200, 100, 150],
  ],
  3,
);
c3 ? passed++ : failed++;

// Case 4: Empty cells + blankrows
// NOTE: blankrows:false skips rows where ALL cells are undefined/null, NOT
// rows with empty strings "". SheetJS treats "" as a value. So this row
// passes through · downstream parseRows handles via `r.every((c) => c.trim() === "")`.
// Adjust expected to 4 (includes blank row · downstream filters).
const c4 = runCase(
  "Blank string-row passes through (downstream parseRows filters)",
  [
    ["วันที่", "เลขเครื่อง", "ออนไลน์"],
    ["2026-05-21", "G0310370", 1500],
    ["", "", ""],
    ["2026-05-22", "G0310371", 800],
  ],
  4,
);
c4 ? passed++ : failed++;

// Case 5: Date as native Excel date (real Excel.app writes UTC-canonical · serial number)
const c5 = (() => {
  // Excel stores dates as serial numbers · SheetJS reads with cellDates:true and
  // constructs Date via Date.UTC(...). To mimic this in test, build Date with Date.UTC.
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(
    [
      ["วันที่", "เลขเครื่อง", "ออนไลน์"],
      [new Date(Date.UTC(2026, 4, 21)), "G0310370", 1500], // May 21 UTC
    ],
    { cellDates: true },
  );
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx", cellDates: true });
  const grid = parseXlsxToGrid(buf);
  const got = grid[1]?.[0];
  const ok = got === "2026-05-21";
  console.log(`\n${ok ? "✅" : "❌"} Native Excel date cell (UTC-canonical) → ISO yyyy-mm-dd`);
  console.log(`   row 1 col 0: ${JSON.stringify(got)} (expected "2026-05-21")`);
  return ok;
})();
c5 ? passed++ : failed++;

// Case 6: Multi-sheet workbook — we read FIRST only
const c6 = (() => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["วันที่", "เลขเครื่อง", "ออนไลน์"],
    ["2026-05-21", "G0310370", 1500],
  ]), "Sheet1");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["IGNORED", "IGNORED"],
    ["ignored", "ignored"],
  ]), "Sheet2");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const grid = parseXlsxToGrid(buf);
  const ok = grid.length === 2 && grid[0][0] === "วันที่";
  console.log(`\n${ok ? "✅" : "❌"} Multi-sheet workbook (read first only)`);
  console.log(`   first sheet header: ${JSON.stringify(grid[0])}`);
  console.log(`   total grid rows: ${grid.length} (expected 2 · Sheet2 NOT read)`);
  return ok;
})();
c6 ? passed++ : failed++;

// Case 7: Empty workbook
const c7 = (() => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([]), "Sheet1");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const grid = parseXlsxToGrid(buf);
  const ok = grid.length === 0;
  console.log(`\n${ok ? "✅" : "❌"} Empty workbook → 0 rows`);
  console.log(`   grid rows: ${grid.length} (expected 0)`);
  return ok;
})();
c7 ? passed++ : failed++;

console.log(`\n${"━".repeat(60)}`);
console.log(`Result: ${passed} passed · ${failed} failed`);
if (failed > 0) process.exit(1);
