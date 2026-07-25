// ลงทะเบียน Rich Menu ของ OA RentSpace + ตั้งเป็นเมนูเริ่มต้นให้ทุกคน
// ต้องรัน gen รูปก่อน: node scripts/rentspace-richmenu-image.mjs
// env: RENTSPACE_LINE_CHANNEL_ACCESS_TOKEN + NEXT_PUBLIC_RENTSPACE_LIFF_ID (อ่านจาก .env.local)
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const env = readFileSync(join(ROOT, ".env.local"), "utf8");
const pick = (k) => {
  const m = env.match(new RegExp("^" + k + "=(.*)$", "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : undefined;
};
const TOKEN = pick("RENTSPACE_LINE_CHANNEL_ACCESS_TOKEN");
const LIFF_ID = pick("NEXT_PUBLIC_RENTSPACE_LIFF_ID");
if (!TOKEN || !LIFF_ID) {
  console.error("missing RENTSPACE_LINE_CHANNEL_ACCESS_TOKEN or NEXT_PUBLIC_RENTSPACE_LIFF_ID");
  process.exit(1);
}
const MENU_NAME = "RentSpace Menu v1";
const liff = (screen) => `https://liff.line.me/${LIFF_ID}?screen=${encodeURIComponent(screen)}`;

async function api(method, path, body) {
  const res = await fetch(`https://api.line.me${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${txt}`);
  return txt ? JSON.parse(txt) : {};
}

// 1) ลบเมนูเดิมชื่อเดียวกัน (idempotent — รันซ้ำไม่บวม)
const list = await api("GET", "/v2/bot/richmenu/list");
for (const m of list.richmenus ?? []) {
  if (m.name === MENU_NAME) {
    await api("DELETE", `/v2/bot/richmenu/${m.richMenuId}`);
    console.log("deleted old", m.richMenuId);
  }
}

// 2) สร้างเมนูใหม่ — 2x2 · ลำดับ area ต้องตรงกับรูป (ซ้ายบน/ขวาบน/ซ้ายล่าง/ขวาล่าง)
const richMenu = {
  size: { width: 2500, height: 1686 },
  selected: true,
  name: MENU_NAME,
  chatBarText: "เมนูพื้นที่เช่า",
  areas: [
    { bounds: { x: 0, y: 0, width: 1250, height: 843 }, action: { type: "uri", label: "ใบแจ้งหนี้", uri: liff("bills") } },
    { bounds: { x: 1250, y: 0, width: 1250, height: 843 }, action: { type: "uri", label: "ประวัติ", uri: liff("history") } },
    { bounds: { x: 0, y: 843, width: 1250, height: 843 }, action: { type: "uri", label: "ข่าวสาร", uri: liff("news") } },
    { bounds: { x: 1250, y: 843, width: 1250, height: 843 }, action: { type: "message", label: "สอบถาม", text: "สอบถามยอดค้างชำระ" } },
  ],
};
const { richMenuId } = await api("POST", "/v2/bot/richmenu", richMenu);
console.log("created", richMenuId);

// 3) อัปรูป (api-data host · image/png)
const img = readFileSync(join(ROOT, "public", "rentspace", "richmenu.png"));
const up = await fetch(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`, {
  method: "POST",
  headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "image/png" },
  body: img,
});
if (!up.ok) throw new Error(`upload image → ${up.status}: ${await up.text()}`);
console.log("image uploaded");

// 4) ตั้งเป็นเมนูเริ่มต้นให้ทุกคน
await api("POST", `/v2/bot/user/all/richmenu/${richMenuId}`);
console.log("✅ set as default rich menu:", richMenuId);
