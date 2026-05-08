#!/usr/bin/env node
// scripts/line-rich-menu.mjs
//
// Upload + register Pooilgroup LINE Rich Menu for staff/branch_manager.
// Spec: ดีเทลv1/CLAUDE.md PART 3 — Channels Architecture
//
// Buttons (2×2 grid, 2500×1686):
//   [📝 กรอกรายงาน]  [📊 ยอดสาขา]
//   [✅ สถานะวันนี้]  [❓ ช่วยเหลือ]
//
// Each button opens the LIFF mini app at the matching path.
//
// Usage:
//   LINE_CHANNEL_ACCESS_TOKEN=... \
//   NEXT_PUBLIC_LIFF_ID=... \
//   node scripts/line-rich-menu.mjs ./scripts/rich-menu-staff.png
//
// Steps:
//   1. POST /v2/bot/richmenu        → create menu, get richMenuId
//   2. POST /v2/bot/richmenu/{id}/content → upload image (2500×1686 PNG, ≤1MB)
//   3. POST /v2/bot/user/all/richmenu/{id} → set as default for every user
//
// Idempotent-ish: lists existing menus and deletes any with the same name
// before creating the new one. Safe to re-run after editing config below.

import fs from "node:fs";
import path from "node:path";

const TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID;
const API = "https://api.line.me";
const DATA_API = "https://api-data.line.me";
const MENU_NAME = "Pooilgroup-Staff-v1";

if (!TOKEN) {
  console.error("ERROR: LINE_CHANNEL_ACCESS_TOKEN env not set");
  process.exit(1);
}
if (!LIFF_ID) {
  console.error("ERROR: NEXT_PUBLIC_LIFF_ID env not set (needed for button URLs)");
  process.exit(1);
}

const imagePath = process.argv[2] ?? path.join(process.cwd(), "scripts/rich-menu-staff.png");
if (!fs.existsSync(imagePath)) {
  console.error(`ERROR: image not found at ${imagePath}`);
  console.error("       Provide a 2500×1686 PNG ≤1MB. Designer note:");
  console.error("       - top-left  📝 กรอกรายงาน  → /liff/report");
  console.error("       - top-right 📊 ยอดสาขา     → /liff/dashboard");
  console.error("       - bot-left  ✅ สถานะวันนี้   → /liff/status");
  console.error("       - bot-right ❓ ช่วยเหลือ     → /liff/help");
  process.exit(1);
}

// Image dimensions per LINE spec — buttons split the canvas in half × half.
const W = 2500;
const H = 1686;
const HALF_W = W / 2;
const HALF_H = H / 2;

const MENU = {
  size: { width: W, height: H },
  selected: false,
  name: MENU_NAME,
  chatBarText: "เมนูพนักงาน",
  areas: [
    {
      bounds: { x: 0, y: 0, width: HALF_W, height: HALF_H },
      action: { type: "uri", label: "กรอกรายงาน", uri: `https://liff.line.me/${LIFF_ID}/report` },
    },
    {
      bounds: { x: HALF_W, y: 0, width: HALF_W, height: HALF_H },
      action: { type: "uri", label: "ยอดสาขา", uri: `https://liff.line.me/${LIFF_ID}/dashboard` },
    },
    {
      bounds: { x: 0, y: HALF_H, width: HALF_W, height: HALF_H },
      action: { type: "uri", label: "สถานะวันนี้", uri: `https://liff.line.me/${LIFF_ID}/status` },
    },
    {
      bounds: { x: HALF_W, y: HALF_H, width: HALF_W, height: HALF_H },
      action: { type: "uri", label: "ช่วยเหลือ", uri: `https://liff.line.me/${LIFF_ID}/help` },
    },
  ],
};

async function api(method, urlPath, body, contentType = "application/json") {
  const res = await fetch(`${API}${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(body && contentType === "application/json" ? { "Content-Type": "application/json" } : {}),
    },
    body: body && contentType === "application/json" ? JSON.stringify(body) : body,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`${method} ${urlPath} → ${res.status} ${t}`);
  }
  return res.status === 204 ? null : res.json();
}

async function dataApi(method, urlPath, body, contentType) {
  const res = await fetch(`${DATA_API}${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": contentType,
    },
    body,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`${method} ${urlPath} → ${res.status} ${t}`);
  }
  return res.status === 204 ? null : res.json();
}

(async () => {
  // 1. Find + delete any old menu with the same name (idempotent re-run)
  const list = await api("GET", "/v2/bot/richmenu/list");
  for (const m of list.richmenus ?? []) {
    if (m.name === MENU_NAME) {
      console.log(`▾ Deleting old menu ${m.richMenuId} (${m.name})`);
      await api("DELETE", `/v2/bot/richmenu/${m.richMenuId}`);
    }
  }

  // 2. Create the new menu
  console.log("▾ Creating Rich Menu config...");
  const created = await api("POST", "/v2/bot/richmenu", MENU);
  const richMenuId = created.richMenuId;
  console.log(`  → richMenuId = ${richMenuId}`);

  // 3. Upload image
  console.log(`▾ Uploading image ${imagePath}...`);
  const buf = fs.readFileSync(imagePath);
  await dataApi("POST", `/v2/bot/richmenu/${richMenuId}/content`, buf, "image/png");
  console.log("  → uploaded");

  // 4. Set as default for all users
  console.log("▾ Setting as default for all users...");
  await api("POST", `/v2/bot/user/all/richmenu/${richMenuId}`);
  console.log("  → done");

  console.log("\n✓ Rich Menu deployed");
  console.log(`  ID: ${richMenuId}`);
  console.log("  Test: open LINE → tap chat with bot → keyboard area shows menu");
})().catch((err) => {
  console.error("\n✗ Failed:", err.message);
  process.exit(1);
});
