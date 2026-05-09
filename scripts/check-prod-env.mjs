// Pre-deploy environment audit
// Run: node scripts/check-prod-env.mjs [--prod]
//
// Validates env vars before deploy. Mirrors lib/env-validate.ts but as CLI tool
// so the user can audit Vercel env without booting the app.

import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const args = new Set(process.argv.slice(2));
const isProd = args.has("--prod");

const C = {
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  reset: "\x1b[0m",
  bold: "\x1b[1m",
};

const REQUIRED = [
  { key: "DATABASE_URL", desc: "Supabase pooler URL (port 6543)" },
  { key: "DIRECT_URL", desc: "Direct DB URL (port 5432) — for migrations" },
  { key: "NEXT_PUBLIC_SUPABASE_URL", desc: "Supabase project URL" },
  { key: "NEXT_PUBLIC_SUPABASE_ANON_KEY", desc: "Supabase anon key (browser)" },
  { key: "SUPABASE_SERVICE_ROLE_KEY", desc: "Supabase service role (server)" },
  { key: "CRON_SECRET", desc: "Cron Bearer token (≥32 chars)", minLen: 32 },
];

const RECOMMENDED = [
  { key: "TELEGRAM_BOT_TOKEN", desc: "Telegram bot token (for notifications)" },
  { key: "TELEGRAM_WEBHOOK_SECRET", desc: "Telegram webhook secret (≥32 chars)", minLen: 32 },
  { key: "TELEGRAM_ADMIN_CHAT_ID", desc: "Admin chat ID (for cron alerts)" },
  { key: "LINE_CHANNEL_ACCESS_TOKEN", desc: "LINE Messaging API token" },
  { key: "LINE_CHANNEL_SECRET", desc: "LINE channel secret" },
  { key: "NEXT_PUBLIC_LIFF_ID", desc: "LIFF app ID (format: channelId-appId)" },
  { key: "R2_ACCOUNT_ID", desc: "Cloudflare R2 account" },
  { key: "R2_ACCESS_KEY_ID", desc: "R2 access key" },
  { key: "R2_SECRET_ACCESS_KEY", desc: "R2 secret key" },
  { key: "R2_BUCKET", desc: "R2 bucket name" },
  { key: "R2_PUBLIC_URL", desc: "R2 public CDN URL" },
];

const PROD_FORBIDDEN = [
  {
    key: "NODE_TLS_REJECT_UNAUTHORIZED",
    desc: "Disables TLS cert verification — DEV ONLY",
    badValues: ["0", "false"],
  },
];

let errors = 0;
let warnings = 0;

console.log(`\n${C.bold}🔍 Pre-Deploy Environment Audit${C.reset}`);
console.log(`Mode: ${isProd ? "PRODUCTION" : "DEV"}\n`);

// 1. Required vars
console.log(`${C.bold}Required:${C.reset}`);
for (const { key, desc, minLen } of REQUIRED) {
  const v = process.env[key];
  if (!v) {
    console.log(`  ${C.red}✗ ${key}${C.reset} — MISSING — ${desc}`);
    errors++;
  } else if (minLen && v.length < minLen) {
    console.log(`  ${C.red}✗ ${key}${C.reset} — TOO SHORT (${v.length} chars, min ${minLen})`);
    errors++;
  } else {
    console.log(`  ${C.green}✓ ${key}${C.reset}`);
  }
}

// 2. Recommended
console.log(`\n${C.bold}Recommended:${C.reset}`);
for (const { key, desc, minLen } of RECOMMENDED) {
  const v = process.env[key];
  if (!v) {
    console.log(`  ${C.yellow}- ${key}${C.reset} — not set — ${desc}`);
    warnings++;
  } else if (minLen && v.length < minLen) {
    console.log(`  ${C.yellow}- ${key}${C.reset} — short (${v.length}, recommended ${minLen}+)`);
    warnings++;
  } else {
    console.log(`  ${C.green}✓ ${key}${C.reset}`);
  }
}

// 3. LIFF format check
const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
if (liffId && !liffId.includes("-")) {
  console.log(
    `  ${C.red}✗ NEXT_PUBLIC_LIFF_ID${C.reset} — bad format (need "channelId-appId" but got "${liffId}")`,
  );
  errors++;
}

// 4. Production-forbidden flags
console.log(`\n${C.bold}Production safety:${C.reset}`);
for (const { key, desc, badValues } of PROD_FORBIDDEN) {
  const v = process.env[key];
  if (!v) {
    console.log(`  ${C.green}✓ ${key}${C.reset} — not set (good)`);
  } else if (badValues.includes(v)) {
    if (isProd) {
      console.log(
        `  ${C.red}✗ ${key}=${v}${C.reset} — FATAL in prod — ${desc}`,
      );
      errors++;
    } else {
      console.log(
        `  ${C.yellow}⚠ ${key}=${v}${C.reset} — OK for dev, MUST REMOVE before prod deploy — ${desc}`,
      );
      warnings++;
    }
  } else {
    console.log(`  ${C.green}✓ ${key}=${v}${C.reset} (non-bad value)`);
  }
}

// 5. App URL check
const appUrl = process.env.NEXT_PUBLIC_APP_URL;
if (isProd && appUrl && !appUrl.startsWith("https://")) {
  console.log(`  ${C.red}✗ NEXT_PUBLIC_APP_URL${C.reset} — must be HTTPS in prod (got: ${appUrl})`);
  errors++;
}

// 6. AI keys (at least one)
console.log(`\n${C.bold}AI providers (at least one):${C.reset}`);
const aiKeys = ["GEMINI_API_KEY", "ANTHROPIC_API_KEY"];
const hasAi = aiKeys.some((k) => process.env[k]);
if (!hasAi) {
  console.log(`  ${C.yellow}⚠ No AI key set${C.reset} — AI Chat will return 503`);
  warnings++;
} else {
  for (const k of aiKeys) {
    if (process.env[k]) console.log(`  ${C.green}✓ ${k}${C.reset}`);
  }
}

// Summary
console.log(`\n${"─".repeat(60)}`);
const status =
  errors > 0 ? `${C.red}${C.bold}NOT READY${C.reset}` : `${C.green}${C.bold}READY${C.reset}`;
console.log(`Status: ${status}`);
console.log(`Errors:   ${errors > 0 ? C.red : C.green}${errors}${C.reset}`);
console.log(`Warnings: ${warnings > 0 ? C.yellow : C.green}${warnings}${C.reset}`);
console.log(`${"─".repeat(60)}\n`);

process.exit(errors > 0 ? 1 : 0);
