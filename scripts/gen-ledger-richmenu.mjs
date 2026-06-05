// Generate the LedgerLine LINE Rich Menu image (2500×1686, 6 cells, 3 cols × 2 rows)
// matching the areas in app/api/ledger/richmenu/register/route.ts.
//
// Uses the real น้องใบเสร็จ mascot poses as cell icons (no emoji — on-brand,
// premium, per the CEO quality bar). Renders an HTML grid with Playwright's
// Chromium and screenshots it to public/ledger/brand/richmenu.png.
//
//   npx playwright install chromium   # one-time (downloads the browser binary)
//   node scripts/gen-ledger-richmenu.mjs
//
// Cell order MUST match the register endpoint's areas[] (top row L→R, bottom L→R):
//   ถ่ายใบเสร็จ · พิมพ์รายจ่าย · รายการของฉัน · จัดการทีม · วิธีใช้ · แจ้งปัญหา

import { chromium } from "playwright";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const MASCOT = join(ROOT, "public/ledger/brand/mascot");
const OUT = process.argv[2] || join(ROOT, "public/ledger/brand/richmenu.png");

/** Inline a mascot PNG as a data URI (so the headless browser needs no server). */
function pose(name) {
  const p = join(MASCOT, `${name}.png`);
  if (!existsSync(p)) throw new Error(`missing mascot pose: ${p}`);
  return `data:image/png;base64,${readFileSync(p).toString("base64")}`;
}

// label · mascot pose · accent colour (a calm Pool-palette tint per cell)
const CELLS = [
  { label: "ถ่ายใบเสร็จ", pose: "camera", accent: "#2563EB" },
  { label: "พิมพ์รายจ่าย", pose: "money", accent: "#0EA5E9" },
  { label: "รายการของฉัน", pose: "explain", accent: "#7C3AED" },
  { label: "จัดการทีม", pose: "welcome", accent: "#D97706" },
  { label: "วิธีใช้", pose: "typing", accent: "#16A34A" },
  { label: "แจ้งปัญหา", pose: "alert", accent: "#DC2626" },
];

const cellsHtml = CELLS.map(
  (c) => `
    <div class="cell">
      <span class="accent" style="background:${c.accent}"></span>
      <img class="mascot" src="${pose(c.pose)}" alt="" />
      <div class="label">${c.label}</div>
    </div>`,
).join("");

const html = `<!doctype html><html lang="th"><head><meta charset="utf-8" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: 2500px; height: 1686px;
    font-family: -apple-system, "Thonburi", "IBM Plex Sans Thai", "Noto Sans Thai", sans-serif; }
  .grid { width: 2500px; height: 1686px; display: grid;
    grid-template-columns: 1fr 1fr 1fr; grid-template-rows: 1fr 1fr;
    background: #E4E4E7; gap: 4px; }
  .cell { position: relative; background: #FFFFFF; display: flex;
    flex-direction: column; align-items: center; justify-content: center; gap: 56px; }
  .accent { position: absolute; top: 0; left: 0; right: 0; height: 14px; }
  .mascot { width: 380px; height: 380px; object-fit: contain; }
  .label { font-size: 104px; font-weight: 800; color: #18181B; letter-spacing: 1px; }
</style></head>
<body><div class="grid">${cellsHtml}</div></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 2500, height: 1686 } });
await page.setContent(html, { waitUntil: "networkidle" });
await page.screenshot({ path: OUT, clip: { x: 0, y: 0, width: 2500, height: 1686 } });
await browser.close();
console.log(`✅ wrote ${OUT}`);
