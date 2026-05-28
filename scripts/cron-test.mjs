// Cron auth + idempotency E2E test
// Triggers each cron with valid CRON_SECRET, verifies cron_runs entries,
// then re-triggers and verifies idempotency skips.

import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const APP = "http://localhost:3100";

if (!CRON_SECRET) {
  console.error("CRON_SECRET not set");
  process.exit(1);
}

let pass = 0, fail = 0;
const log = (level, msg) => {
  const t = level === "PASS" ? "\x1b[32m✓ PASS\x1b[0m" : level === "FAIL" ? "\x1b[31m✗ FAIL\x1b[0m" : "  ·";
  console.log(`${t}  ${msg}`);
};
const expect = (cond, name) => { if (cond) { log("PASS", name); pass++; } else { log("FAIL", name); fail++; } };

async function db(path, opts = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(opts.headers ?? {}),
    },
  });
  return { status: r.status, body: r.ok ? await r.json() : await r.text() };
}

async function callCron(name, opts = {}) {
  const url = opts.force ? `${APP}/api/cron/${name}?force=1` : `${APP}/api/cron/${name}`;
  return fetch(url, {
    method: "GET",
    headers: opts.noAuth
      ? {}
      : { Authorization: `Bearer ${CRON_SECRET}` },
  });
}

const today = new Date().toISOString().slice(0, 10);

async function main() {
  console.log("\n⏰ Cron Test Suite\n");

  // Cleanup today's cron_runs entries (start fresh)
  const cronNames = ["morning-brief", "evening-check", "access-review", "health-score", "docuflow-expiry"];
  for (const n of cronNames) {
    await db(`cron_runs?cron_name=eq.${n}&run_date=eq.${today}`, { method: "DELETE" });
  }

  // ──────────────────────────────────────────────
  // Test 1: Reject without CRON_SECRET
  // ──────────────────────────────────────────────
  console.log("🔐 Auth gate");
  const noAuth = await callCron("morning-brief", { noAuth: true });
  expect(noAuth.status === 401, `Cron without auth → ${noAuth.status} (expected 401)`);

  // ──────────────────────────────────────────────
  // Test 2: Reject wrong secret
  // ──────────────────────────────────────────────
  const wrongAuth = await fetch(`${APP}/api/cron/morning-brief`, {
    method: "GET",
    headers: { Authorization: `Bearer wrong-secret-xxx` },
  });
  expect(wrongAuth.status === 401, `Wrong secret → ${wrongAuth.status} (expected 401)`);

  // ──────────────────────────────────────────────
  // Test 3: First run succeeds + creates cron_runs row
  // ──────────────────────────────────────────────
  console.log("\n▶️  First run (should succeed)");
  const run1 = await callCron("access-review");
  expect(run1.status === 200, `access-review first run → ${run1.status} (expected 200)`);

  const row1 = await db(`cron_runs?cron_name=eq.access-review&run_date=eq.${today}&select=status,duration_ms`);
  const row1Data = Array.isArray(row1.body) ? row1.body[0] : null;
  expect(row1Data?.status === "success", `cron_runs row created with status=success`);
  if (row1Data?.duration_ms) log("INFO", `Duration: ${row1Data.duration_ms}ms`);

  // ──────────────────────────────────────────────
  // Test 4: Second run skips (idempotency)
  // ──────────────────────────────────────────────
  console.log("\n🔁 Second run (should skip)");
  const run2 = await callCron("access-review");
  expect(run2.status === 200, `access-review second run → ${run2.status}`);
  const body2 = await run2.json();
  expect(
    body2.skipped === "already_ran_today" || body2.skipped === "already_running_today",
    `Idempotency: skipped=${body2.skipped}`,
  );

  // ──────────────────────────────────────────────
  // Test 5: Force run bypasses runWithMonitor idempotency
  // (note: access-review has its own per-org idempotency via audit_logs;
  //  runWithMonitor skip = string "already_ran_today", not array)
  // ──────────────────────────────────────────────
  console.log("\n💪 Force run (bypass runWithMonitor skip)");
  // Use docuflow-expiry — no internal idempotency
  await db(`cron_runs?cron_name=eq.docuflow-expiry&run_date=eq.${today}`, { method: "DELETE" });
  await callCron("docuflow-expiry"); // populate cron_runs
  const skipBody = await callCron("docuflow-expiry").then((r) => r.json());
  expect(
    skipBody.skipped === "already_ran_today",
    `Without force: skipped=${skipBody.skipped} (expected "already_ran_today")`,
  );
  const forceBody = await callCron("docuflow-expiry", { force: true }).then((r) => r.json());
  expect(
    forceBody.skipped !== "already_ran_today",
    `With force=1: skipped=${forceBody.skipped ?? "no"} (NOT "already_ran_today")`,
  );

  // ──────────────────────────────────────────────
  // Test 6: deadline-reminder allows multiple runs per day
  // ──────────────────────────────────────────────
  console.log("\n🔔 deadline-reminder (no idempotency)");
  await db(`cron_runs?cron_name=eq.deadline-reminder&run_date=eq.${today}`, { method: "DELETE" });
  const dr1 = await callCron("deadline-reminder");
  const dr2 = await callCron("deadline-reminder");
  expect(dr1.status === 200, `deadline-reminder run 1 → ${dr1.status}`);
  expect(dr2.status === 200, `deadline-reminder run 2 → ${dr2.status}`);
  const dr2Body = await dr2.json();
  expect(!dr2Body.skipped, `deadline-reminder doesn't skip on 2nd run`);

  // ──────────────────────────────────────────────
  // Summary
  // ──────────────────────────────────────────────
  console.log(`\n${"─".repeat(50)}`);
  console.log(`Passed: \x1b[32m${pass}\x1b[0m   Failed: \x1b[31m${fail}\x1b[0m`);
  console.log(`${"─".repeat(50)}\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
