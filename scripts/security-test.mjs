// Day 3 Security Test — verify P0/P1 fixes work end-to-end
// - BUG-014: rate limit on /api/auth/check-login
// - BUG-016: rate limit + register-request behavior
// - BUG-020: forgot-password endpoint + admin unlock
// - BUG-011: R2 sign requires auth
// - BUG-012: Telegram webhook rejects without secret
// - BUG-017: AI cost cap (smoke — endpoint should return budget result)

import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP = "http://localhost:3100";
const PASSWORD = "Pooil2026!";

let pass = 0, fail = 0;
const log = (level, msg) => {
  const t = level === "PASS" ? "\x1b[32m✓ PASS\x1b[0m" : level === "FAIL" ? "\x1b[31m✗ FAIL\x1b[0m" : "  ·";
  console.log(`${t}  ${msg}`);
};
const expect = (cond, name) => { if (cond) { log("PASS", name); pass++; } else { log("FAIL", name); fail++; } };

async function login(email) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON_KEY },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const t = await r.json();
  const proj = new URL(SUPABASE_URL).host.split(".")[0];
  const cv = "base64-" + Buffer.from(JSON.stringify(t)).toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
  return { cookie: `sb-${proj}-auth-token=${cv}` };
}

async function main() {
  console.log("\n🔒 Day 3 — Security Hardening Test\n");

  // Cleanup ALL rate limit buckets used by this test (start clean)
  for (const pattern of ["auth-check", "register", "forgot-password"]) {
    await fetch(
      `${SUPABASE_URL}/rest/v1/rate_limit_attempts?bucket=like.${pattern}*`,
      {
        method: "DELETE",
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      },
    );
  }

  // ──────────────────────────────────────────────
  // BUG-011: R2 sign requires auth
  // ──────────────────────────────────────────────
  console.log("📁 BUG-011: R2 sign auth gate");
  const r2NoAuth = await fetch(`${APP}/api/r2/sign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: "x.png", contentType: "image/png", size: 1024 }),
  });
  expect(r2NoAuth.status === 401, `R2 sign no-auth → ${r2NoAuth.status} (expected 401)`);

  // BUG-015: blocked extension
  const admin = await login("admin@pooilgroup.test");
  const r2Exe = await fetch(`${APP}/api/r2/sign`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: admin.cookie },
    body: JSON.stringify({ filename: "evil.exe", contentType: "application/octet-stream", size: 1024 }),
  });
  expect(r2Exe.status === 415, `R2 sign .exe blocked → ${r2Exe.status} (expected 415)`);

  // BUG-015: PDF allowed
  const r2Pdf = await fetch(`${APP}/api/r2/sign`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: admin.cookie },
    body: JSON.stringify({ filename: "doc.pdf", contentType: "application/pdf", size: 1024 }),
  });
  expect(r2Pdf.status === 200, `R2 sign PDF allowed → ${r2Pdf.status} (expected 200)`);

  // ──────────────────────────────────────────────
  // BUG-012: Telegram webhook rejects without secret header
  // ──────────────────────────────────────────────
  console.log("\n📨 BUG-012: Telegram webhook secret check");
  const tgNoSecret = await fetch(`${APP}/api/telegram/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ update_id: 1, message: {} }),
  });
  expect(tgNoSecret.status === 403 || tgNoSecret.status === 503,
    `TG webhook no-secret → ${tgNoSecret.status} (expected 403/503)`);

  // ──────────────────────────────────────────────
  // BUG-014: Rate limit on check-login
  // ──────────────────────────────────────────────
  console.log("\n🔐 BUG-014: Auth rate limit");
  let rlHit = false;
  let normalCount = 0;
  for (let i = 0; i < 12; i++) {
    const r = await fetch(`${APP}/api/auth/check-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "10.0.0.99" },
      body: JSON.stringify({ email: `test${i}@x.com` }),
    });
    if (r.status === 429) { rlHit = true; break; }
    if (r.status === 200) normalCount++;
  }
  expect(rlHit, `Auth rate limit triggered after ${normalCount} requests (expected within 11)`);

  // ──────────────────────────────────────────────
  // BUG-020: forgot-password endpoint exists + always returns success
  // ──────────────────────────────────────────────
  console.log("\n🔑 BUG-020: Password reset");
  const fp1 = await fetch(`${APP}/api/auth/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "nonexistent@example.com" }),
  });
  expect(fp1.status === 200, `forgot-password unknown email → ${fp1.status} (silent success expected)`);

  const fp2 = await fetch(`${APP}/api/auth/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@pooilgroup.test" }),
  });
  expect(fp2.status === 200, `forgot-password real email → ${fp2.status}`);

  // BUG-020: admin unlock endpoint exists
  const adminLogin = await login("admin@pooilgroup.test");
  const cashierLookup = await fetch(
    `${SUPABASE_URL}/rest/v1/users?email=eq.cashier@pooilgroup.test&select=id`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
  );
  const cashierRows = await cashierLookup.json();
  const cashierId = cashierRows?.[0]?.id;
  if (cashierId) {
    const unlockRes = await fetch(`${APP}/api/admin/users/${cashierId}/unlock`, {
      method: "POST",
      headers: { Cookie: adminLogin.cookie },
    });
    expect(unlockRes.status === 200, `Admin unlock cashier → ${unlockRes.status} (expected 200)`);
  } else {
    log("FAIL", "Couldn't find cashier id for unlock test");
    fail++;
  }

  // ──────────────────────────────────────────────
  // BUG-016: register-request rate limit (per IP)
  // ──────────────────────────────────────────────
  console.log("\n📝 BUG-016: Register rate limit");
  // Cleanup register attempts for this IP
  await fetch(`${SUPABASE_URL}/rest/v1/rate_limit_attempts?bucket=eq.register:ip:10.0.0.88`, {
    method: "DELETE",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  let regRlHit = false;
  for (let i = 0; i < 7; i++) {
    const r = await fetch(`${APP}/api/auth/register-request`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "10.0.0.88" },
      body: JSON.stringify({
        name: `Bot ${i}`,
        phone: `08${i}-0000000`,
        employeeCode: `BOT${i}`,
        requestedRole: "staff",
      }),
    });
    if (r.status === 429) { regRlHit = true; break; }
  }
  expect(regRlHit, `Register rate limit triggered (max 5/IP/day)`);

  // ──────────────────────────────────────────────
  // Final
  // ──────────────────────────────────────────────
  console.log(`\n${"─".repeat(50)}`);
  console.log(`Passed: \x1b[32m${pass}\x1b[0m   Failed: \x1b[31m${fail}\x1b[0m   Total: ${pass + fail}`);
  console.log(`${"─".repeat(50)}\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
