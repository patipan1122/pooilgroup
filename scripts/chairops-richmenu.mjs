#!/usr/bin/env node
// ChairOps LINE OA Rich Menu — one-time registration (CEO runs once).
//
// Creates the 4-button menu (เก็บเงิน / เช็คคลีน / แจ้งซ่อม / เบิกของ) where each
// button opens the LIFF Mini App deep-linked to a maid screen, uploads the menu
// image, and sets it as the default for all users.
//
// Prereqs (AUDIT §5 · HW_BLOCKED until done):
//   1. LINE OA business verification complete
//   2. env LINE_CHANNEL_ACCESS_TOKEN  (Messaging API channel token)
//   3. env NEXT_PUBLIC_LIFF_ID        (LIFF app id, format "{channelId}-{liffId}")
//   4. LIFF endpoint URL set to https://<your-domain>/liff (so /chairops resolves)
//   5. A menu image PNG/JPEG, 2500×1686 px (4 quadrants labelled)
//
// Usage:
//   LINE_CHANNEL_ACCESS_TOKEN=xxx NEXT_PUBLIC_LIFF_ID=1234-abcd \
//     node scripts/chairops-richmenu.mjs ./path/to/menu-2500x1686.png
//
// Idempotency: re-running creates a NEW menu + sets it default. To replace,
// delete old menus first: GET /v2/bot/richmenu/list then DELETE per id.

import { readFile } from "node:fs/promises";
import { extname } from "node:path";

const TOKEN = process.env.CHAIROPS_LINE_CHANNEL_ACCESS_TOKEN;
const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID;
const imagePath = process.argv[2];

if (!TOKEN) fail("Missing env CHAIROPS_LINE_CHANNEL_ACCESS_TOKEN");
if (!LIFF_ID) fail("Missing env NEXT_PUBLIC_LIFF_ID");
if (!imagePath) fail("Usage: node scripts/chairops-richmenu.mjs <menu-image-2500x1686.png>");

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

// LIFF deep-link → /liff/chairops?next=<maid screen>. LiffBootstrap auto-logs
// the maid in (verified id_token) then lands them on `next`.
function liff(next) {
  return `https://liff.line.me/${LIFF_ID}/chairops?next=${encodeURIComponent(next)}`;
}

const richMenu = {
  size: { width: 2500, height: 1686 },
  selected: true,
  name: "ChairOps Maid Menu",
  chatBarText: "เมนู ChairOps",
  areas: [
    {
      bounds: { x: 0, y: 0, width: 1250, height: 843 },
      action: { type: "uri", label: "เก็บเงิน", uri: liff("/chairops/m/collect/new") },
    },
    {
      bounds: { x: 1250, y: 0, width: 1250, height: 843 },
      action: { type: "uri", label: "เช็คคลีน", uri: liff("/chairops/m/cleanliness/new") },
    },
    {
      bounds: { x: 0, y: 843, width: 1250, height: 843 },
      action: { type: "uri", label: "แจ้งซ่อม", uri: liff("/chairops/m/damage") },
    },
    {
      bounds: { x: 1250, y: 843, width: 1250, height: 843 },
      action: { type: "uri", label: "เบิกของ", uri: liff("/chairops/m/parts/new") },
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
    { method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": contentType }, body: buf },
  );
  if (!res.ok) fail(`upload image → ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

async function main() {
  console.log("→ creating rich menu…");
  const { richMenuId } = await api("/v2/bot/richmenu", { json: richMenu });
  console.log(`  richMenuId = ${richMenuId}`);

  console.log("→ uploading image…");
  await uploadImage(richMenuId);

  console.log("→ setting as default for all users…");
  await api(`/v2/bot/user/all/richmenu/${richMenuId}`, { method: "POST" });

  console.log("\n✓ Done. ChairOps Rich Menu is live.");
  console.log("  Next: invite the OA into each branch group, then read the");
  console.log("  groupId from Vercel logs (webhook JOIN event) → set LINE_GROUP_*.");
}

main().catch((e) => fail(e.message));
