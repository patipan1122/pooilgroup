// Pool Group ERP — Env validation script
// Run before build/deploy: `node scripts/check-env.mjs`
// Exit 0 = OK; Exit 1 = missing required vars

import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

const REQUIRED = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
];

const RECOMMENDED = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
  "R2_PUBLIC_URL",
  "NEXT_PUBLIC_APP_URL",
];

const OPTIONAL_PHASE2 = [
  "LINE_CHANNEL_ACCESS_TOKEN",
  "LINE_CHANNEL_SECRET",
  "NEXT_PUBLIC_LIFF_ID",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET",
];

let hasErrors = false;
const missing = { required: [], recommended: [], optional: [] };

for (const key of REQUIRED) {
  if (!process.env[key]) {
    missing.required.push(key);
    hasErrors = true;
  }
}
for (const key of RECOMMENDED) if (!process.env[key]) missing.recommended.push(key);
for (const key of OPTIONAL_PHASE2) if (!process.env[key]) missing.optional.push(key);

console.log("Pool Group ERP — Environment Check\n");

if (missing.required.length === 0) {
  console.log("✓ Required env vars: all present");
} else {
  console.log("✗ Required env vars MISSING:");
  for (const k of missing.required) console.log(`  - ${k}`);
}

if (missing.recommended.length > 0) {
  console.log("\n⚠ Recommended env vars missing (some features may fail):");
  for (const k of missing.recommended) console.log(`  - ${k}`);
}

if (missing.optional.length > 0) {
  console.log("\n· Optional Phase 2 env vars not set (LINE/Telegram):");
  for (const k of missing.optional) console.log(`  - ${k}`);
}

if (hasErrors) {
  console.error("\n❌ Build cannot proceed. Add missing required vars to .env.local");
  process.exit(1);
}

console.log("\n✅ Environment OK");
