// สร้างรูป Rich Menu ของ RentSpace (2500x1686 · 2x2 · 4 ปุ่ม) ด้วย sharp (SVG→PNG)
// ลำดับเซลล์ต้องตรงกับ areas[] ใน scripts/rentspace-richmenu.mjs
import sharp from "sharp";
import { mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "public", "rentspace");
const OUT = join(OUT_DIR, "richmenu.png");
mkdirSync(OUT_DIR, { recursive: true });

const W = 2500, H = 1686, cw = 1250, ch = 843;
const FONT = "Thonburi, 'Noto Sans Thai', 'IBM Plex Sans Thai', 'Sarabun', sans-serif";

// icon = simple white stroke path (24x24 viewBox scaled)
const CELLS = [
  { x: 0,    y: 0,   bg: "#1E5EFF", label: "ใบแจ้งหนี้",     sub: "ดูบิล + จ่ายเงิน", icon: "doc" },
  { x: 1250, y: 0,   bg: "#0EA5A4", label: "ประวัติการชำระ", sub: "ย้อนหลัง",         icon: "clock" },
  { x: 0,    y: 843, bg: "#7C3AED", label: "ข่าวสาร",        sub: "ประกาศ/หนังสือ",  icon: "mega" },
  { x: 1250, y: 843, bg: "#06C755", label: "สอบถามยอด",     sub: "แชทกับเรา",       icon: "chat" },
];

const ICONS = {
  // stroke paths in a 0..100 box, drawn centered
  doc:   `<path d="M32 14 h28 l14 14 v58 h-42 z M60 14 v14 h14" fill="none" stroke="white" stroke-width="5" stroke-linejoin="round"/><path d="M40 46 h30 M40 58 h30 M40 70 h20" stroke="white" stroke-width="5" stroke-linecap="round"/>`,
  clock: `<circle cx="50" cy="52" r="30" fill="none" stroke="white" stroke-width="5"/><path d="M50 34 v18 l14 10" fill="none" stroke="white" stroke-width="5" stroke-linecap="round"/>`,
  mega:  `<path d="M28 46 v14 h12 l30 16 v-46 l-30 16 z" fill="none" stroke="white" stroke-width="5" stroke-linejoin="round"/><path d="M40 60 v14 h8 v-8" fill="none" stroke="white" stroke-width="5" stroke-linejoin="round"/>`,
  chat:  `<path d="M26 32 h48 a6 6 0 0 1 6 6 v28 a6 6 0 0 1 -6 6 h-28 l-14 12 v-12 h-6 a6 6 0 0 1 -6 -6 v-28 a6 6 0 0 1 6 -6 z" fill="none" stroke="white" stroke-width="5" stroke-linejoin="round"/>`,
};

const cellSvg = (c) => {
  const cx = c.x + cw / 2;
  return `
  <rect x="${c.x}" y="${c.y}" width="${cw}" height="${ch}" fill="${c.bg}"/>
  <g transform="translate(${cx - 130}, ${c.y + 150}) scale(2.6)">${ICONS[c.icon]}</g>
  <text x="${cx}" y="${c.y + 560}" text-anchor="middle" fill="white" font-family="${FONT}" font-size="118" font-weight="800">${c.label}</text>
  <text x="${cx}" y="${c.y + 650}" text-anchor="middle" fill="rgba(255,255,255,0.85)" font-family="${FONT}" font-size="62" font-weight="500">${c.sub}</text>`;
};

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#0B1220"/>
  ${CELLS.map(cellSvg).join("\n")}
  <rect x="${cw - 3}" y="0" width="6" height="${H}" fill="rgba(0,0,0,0.12)"/>
  <rect x="0" y="${ch - 3}" width="${W}" height="6" fill="rgba(0,0,0,0.12)"/>
</svg>`;

await sharp(Buffer.from(svg)).png().toFile(OUT);
console.log("wrote", OUT);
