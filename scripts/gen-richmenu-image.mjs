// Generate the ChairOps LINE Rich Menu background image (2500×1686, 4 quadrants).
// Uses Playwright (full Thai + emoji font support) → PNG.
// Run: node scripts/gen-richmenu-image.mjs [outPath]
import { chromium } from "playwright";

const out = process.argv[2] || "/tmp/chairops-richmenu.png";

const html = `<!doctype html><html lang="th"><head><meta charset="utf-8"><style>
  *{margin:0;box-sizing:border-box}
  body{width:2500px;height:1686px}
  .grid{width:2500px;height:1686px;display:grid;
    grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:10px;background:#ffffff;
    font-family:-apple-system,"Thonburi","IBM Plex Sans Thai","Noto Sans Thai",sans-serif}
  .cell{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:70px;color:#fff}
  .emoji{font-size:360px;line-height:1}
  .label{font-size:168px;font-weight:800;letter-spacing:2px}
  .c1{background:#059669}/*เก็บเงิน emerald*/
  .c2{background:#0284c7}/*เช็คคลีน sky*/
  .c3{background:#ea580c}/*แจ้งซ่อม orange*/
  .c4{background:#6d28d9}/*เบิกของ violet*/
</style></head><body>
  <div class="grid">
    <div class="cell c1"><div class="emoji">💰</div><div class="label">เก็บเงิน</div></div>
    <div class="cell c2"><div class="emoji">🧹</div><div class="label">เช็คคลีน</div></div>
    <div class="cell c3"><div class="emoji">🔧</div><div class="label">แจ้งซ่อม</div></div>
    <div class="cell c4"><div class="emoji">📦</div><div class="label">เบิกของ</div></div>
  </div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 2500, height: 1686 },
  deviceScaleFactor: 1,
});
await page.setContent(html, { waitUntil: "networkidle" });
await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 2500, height: 1686 } });
await browser.close();
console.log(`✓ wrote ${out} (2500×1686)`);
