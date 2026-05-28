// Generate fresh production secrets
// Run: node scripts/generate-secrets.mjs [--copy]
//
// Outputs values for:
//   JWT_SECRET, CRON_SECRET, TELEGRAM_WEBHOOK_SECRET
// Each = 64 hex chars (256 bits) via crypto.randomBytes
// Copy/paste into Vercel env vars (or .env.local for dev)

import crypto from "node:crypto";

function hex(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
}

const SECRETS = [
  { key: "JWT_SECRET", bytes: 32, desc: "JWT signing (256 bits)" },
  { key: "CRON_SECRET", bytes: 32, desc: "Cron Bearer token" },
  { key: "TELEGRAM_WEBHOOK_SECRET", bytes: 32, desc: "Telegram webhook auth" },
];

const C = {
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  bold: "\x1b[1m",
  reset: "\x1b[0m",
};

console.log(`\n${C.bold}🔐 Production Secret Generator${C.reset}\n`);
console.log(`Generated ${SECRETS.length} fresh secrets (256-bit each)\n`);

const output = [];
for (const { key, bytes, desc } of SECRETS) {
  const value = hex(bytes);
  console.log(`${C.cyan}${key}${C.reset}=${value}`);
  console.log(`  ${C.yellow}# ${desc}${C.reset}`);
  output.push(`${key}=${value}`);
}

console.log(`\n${C.bold}How to use:${C.reset}`);
console.log(`  1. Vercel Dashboard → Project → Settings → Environment Variables`);
console.log(`  2. Add each KEY=VALUE above for the "Production" environment`);
console.log(`  3. Redeploy to apply`);
console.log(`\n${C.bold}⚠️  Important:${C.reset}`);
console.log(`  - DO NOT commit these to .env.example or git`);
console.log(`  - Rotate every 6-12 months`);
console.log(`  - For TELEGRAM_WEBHOOK_SECRET: also set in Telegram BotFather`);
console.log(`    via setWebhook with secret_token param`);
console.log();
