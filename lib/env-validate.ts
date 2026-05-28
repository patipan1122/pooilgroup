// Production environment validator — runs at startup.
// Fails-closed if critical vars are missing or dev-only flags leaked into prod.
//
// Imported by lib/db/server.ts so it runs on first DB call (server boot).

const REQUIRED_VARS = [
  "DATABASE_URL",
  "DIRECT_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "CRON_SECRET",
  // JWT_SECRET is NOT in this list — Supabase Auth handles JWT signing
  // (kept in .env.example for future custom-JWT use cases)
];

const PRODUCTION_FORBIDDEN = [
  "NODE_TLS_REJECT_UNAUTHORIZED", // dev-only — must NOT be set to 0 in prod
];

const SECRET_MIN_LENGTH = 32;

let validated = false;

export function validateProductionEnv(): void {
  if (validated) return;
  validated = true;

  // Strict checks เฉพาะตอน VERCEL_ENV=production (Vercel runtime)
  // NODE_ENV=production จะถูก set ตอน `next build` ปกติ → ห้าม fail
  const isProd = process.env.VERCEL_ENV === "production";

  // 1. Required vars
  const missing = REQUIRED_VARS.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    const msg = `[env-validate] Missing required env vars: ${missing.join(", ")}`;
    console.error(msg);
    if (isProd) {
      throw new Error(msg);
    }
  }

  // 2. Production-forbidden flags
  if (isProd) {
    for (const k of PRODUCTION_FORBIDDEN) {
      const v = process.env[k];
      if (v === "0" || v === "false") {
        const msg = `[env-validate] FATAL: ${k}=${v} is set in production. This is a dev-only workaround that disables TLS verification. Remove from Vercel env vars immediately.`;
        console.error(msg);
        throw new Error(msg);
      }
    }
  }

  // 3. Secret length checks (warn in dev, fail in prod) — only if set
  const SECRETS_TO_CHECK = ["CRON_SECRET", "TELEGRAM_WEBHOOK_SECRET"];
  for (const k of SECRETS_TO_CHECK) {
    const v = process.env[k];
    if (v && v.length < SECRET_MIN_LENGTH) {
      const msg = `[env-validate] ${k} is too short (${v.length} chars, min ${SECRET_MIN_LENGTH})`;
      console.warn(msg);
      if (isProd) throw new Error(msg);
    }
  }

  // 4. LINE LIFF channel ID format check
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
  if (liffId && !liffId.includes("-")) {
    const msg = `[env-validate] NEXT_PUBLIC_LIFF_ID format invalid: expected "{channelId}-{liffAppId}", got "${liffId}"`;
    console.warn(msg);
    if (isProd) throw new Error(msg);
  }

  // 5. App URL must be HTTPS in prod
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (isProd && appUrl && !appUrl.startsWith("https://")) {
    const msg = `[env-validate] NEXT_PUBLIC_APP_URL must be HTTPS in production (got: ${appUrl})`;
    console.error(msg);
    throw new Error(msg);
  }
}
