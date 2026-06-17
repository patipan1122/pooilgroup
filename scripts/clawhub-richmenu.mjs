#!/usr/bin/env node
// ClawHub (JOLLY PLAY) LINE OA Rich Menu — one-time registration (CEO runs once).
//
// Creates the 6-button customer menu (สมัครสมาชิก / ขอคืนเงิน / แต้มของฉัน /
// แลกตุ๊กตา / ช่วยเหลือ / เงื่อนไข) where each button opens the customer LIFF app
// deep-linked to a screen, uploads the menu image, and sets it as the default for
// all users.
//
// Prereqs:
//   1. LINE OA business verification complete
//   2. env CLAWHUB_LINE_CHANNEL_ACCESS_TOKEN  (Messaging API channel token)
//   3. env NEXT_PUBLIC_CLAWHUB_LIFF_ID         (LIFF app id, "{channelId}-{liffId}")
//   4. LIFF endpoint URL set to https://<your-domain>/liff/clawhub
//   5. A menu image PNG, 2500×1686 px (defaults to public/clawhub/richmenu.png)
//
// Usage:
//   CLAWHUB_LINE_CHANNEL_ACCESS_TOKEN=xxx NEXT_PUBLIC_CLAWHUB_LIFF_ID=1234-abcd \
//     node scripts/clawhub-richmenu.mjs [./public/clawhub/richmenu.png]
//
// Idempotency: re-running creates a NEW menu + sets it default. To replace, delete
// old menus first: GET /v2/bot/richmenu/list then DELETE per id.

import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const TOKEN = process.env.CLAWHUB_LINE_CHANNEL_ACCESS_TOKEN;
const LIFF_ID = process.env.NEXT_PUBLIC_CLAWHUB_LIFF_ID;
const imagePath =
  process.argv[2] || resolve(__dirname, "../public/clawhub/richmenu.png");

if (!TOKEN) fail("Missing env CLAWHUB_LINE_CHANNEL_ACCESS_TOKEN");
if (!LIFF_ID) fail("Missing env NEXT_PUBLIC_CLAWHUB_LIFF_ID");

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

// LIFF deep-link → /liff/clawhub?screen=<x>. The customer LIFF bootstrap reads
// `screen` and routes accordingly.
function liff(screen) {
  return `https://liff.line.me/${LIFF_ID}?screen=${encodeURIComponent(screen)}`;
}

const richMenu = {
  size: { width: 2500, height: 1686 },
  selected: true,
  name: "JOLLY PLAY Menu",
  chatBarText: "เมนู JOLLY PLAY",
  areas: [
    // Row 1
    {
      bounds: { x: 0, y: 0, width: 833, height: 843 },
      action: { type: "uri", label: "สมัครสมาชิก", uri: liff("register") },
    },
    {
      bounds: { x: 833, y: 0, width: 834, height: 843 },
      action: { type: "uri", label: "ขอคืนเงิน", uri: liff("refund") },
    },
    {
      bounds: { x: 1667, y: 0, width: 833, height: 843 },
      action: { type: "uri", label: "แต้มของฉัน", uri: liff("points") },
    },
    // Row 2
    {
      bounds: { x: 0, y: 843, width: 833, height: 843 },
      action: { type: "uri", label: "แลกตุ๊กตา", uri: liff("rewards") },
    },
    {
      bounds: { x: 833, y: 843, width: 834, height: 843 },
      action: { type: "uri", label: "ช่วยเหลือ", uri: liff("help") },
    },
    {
      bounds: { x: 1667, y: 843, width: 833, height: 843 },
      action: { type: "uri", label: "เงื่อนไข", uri: liff("help") },
    },
  ],
};

async function api(path, { method = "POST", json, body, contentType } = {}) {
  const headers = { Authorization: `Bearer ${TOKEN}` };
  if (json) headers["Content-Type"] = "application/json";
  if (contentType) headers["Content-Type"] = contentType;
  const res = await fetch(`https://api.line.me${path}`, {
    method,
    headers,
    body: json ? JSON.stringify(json) : body,
  });
  const text = await res.text();
  if (!res.ok) fail(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

async function uploadImage(richMenuId) {
  const buf = await readFile(imagePath);
  const ext = extname(imagePath).toLowerCase();
  const contentType = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";
  // Image upload goes to api-data.line.me, not api.line.me
  const res = await fetch(
    `https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": contentType },
      body: buf,
    },
  );
  if (!res.ok) fail(`upload image → ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

async function main() {
  console.log(`→ using image ${imagePath}`);
  console.log("→ creating rich menu…");
  const { richMenuId } = await api("/v2/bot/richmenu", { json: richMenu });
  console.log(`  richMenuId = ${richMenuId}`);

  console.log("→ uploading image…");
  await uploadImage(richMenuId);

  console.log("→ setting as default for all users…");
  await api(`/v2/bot/user/all/richmenu/${richMenuId}`, { method: "POST" });

  console.log("\n✓ Done. JOLLY PLAY Rich Menu is live.");
  console.log(`  richMenuId = ${richMenuId}`);
}

main().catch((e) => fail(e.message));
