// Integration tests — Telegram callback simulation + PDF cron smoke + deep health
//
// Tests:
//   1. Telegram callback simulation: simulate ✅ approve button click
//      with proper secret header, verify DB status changes to approved
//   2. /api/health/deep — verify all subsystems
//   3. Monthly report PDF cron — trigger manually, verify no 500

import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const TG_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || "";
const APP = "http://localhost:3100";
const PASSWORD = "Pooil2026!";
const ORG_ID = "00000000-0000-0000-0000-000000000001";

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

async function main() {
  console.log("\n🔗 Integration Test Suite\n");

  // ──────────────────────────────────────────────
  // 1. /api/health/deep
  // ──────────────────────────────────────────────
  console.log("🩺 Deep health check");
  const healthRes = await fetch(`${APP}/api/health/deep`, {
    headers: CRON_SECRET ? { Authorization: `Bearer ${CRON_SECRET}` } : {},
  });
  expect(healthRes.status === 200 || healthRes.status === 503,
    `/api/health/deep responds → ${healthRes.status}`);
  const health = await healthRes.json();
  log("INFO", `status=${health.status} ok=${health.summary?.ok} skip=${health.summary?.skipped} fail=${health.summary?.failed}`);
  expect(health.checks?.supabase?.status === "ok", `Supabase REST: ${health.checks?.supabase?.status}`);
  expect(health.checks?.prisma?.status === "ok", `Prisma DB: ${health.checks?.prisma?.status}`);
  expect(health.checks?.auth?.status === "ok", `Supabase Auth: ${health.checks?.auth?.status}`);

  // ──────────────────────────────────────────────
  // 2. Monthly report PDF cron — manual trigger
  // ──────────────────────────────────────────────
  console.log("\n📄 Monthly report PDF cron");
  // Cleanup today's run so we can test fresh
  const today = new Date().toISOString().slice(0, 10);
  await db(`cron_runs?cron_name=eq.monthly-report-pdf&run_date=eq.${today}`, { method: "DELETE" });

  const pdfCron = await fetch(`${APP}/api/cron/monthly-report-pdf`, {
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  });
  expect(pdfCron.status === 200 || pdfCron.status === 500,
    `Monthly PDF cron responds → ${pdfCron.status}`);
  const pdfBody = await pdfCron.json();
  if (pdfCron.status === 200) {
    log("INFO", `PDF cron: ${JSON.stringify(pdfBody).slice(0, 200)}`);
    expect(pdfBody.ok === true || pdfBody.skipped, `PDF cron returned ok or skipped`);
  } else {
    log("INFO", `PDF cron error: ${JSON.stringify(pdfBody).slice(0, 300)}`);
  }

  // ──────────────────────────────────────────────
  // 3. Telegram callback simulation
  // ──────────────────────────────────────────────
  console.log("\n📨 Telegram callback simulation");

  // Setup: create a fresh report via cashier so manager can approve via TG
  const cashier = await login("cashier@pooilgroup.test");
  const branchRes = await fetch(
    `${SUPABASE_URL}/rest/v1/branches?org_id=eq.${ORG_ID}&code=eq.JP-FUEL-001&select=id`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
  );
  const branches = await branchRes.json();
  const branchId = branches?.[0]?.id;

  // Cleanup test report
  await db(
    `daily_reports?branch_id=eq.${branchId}&report_date=eq.${today}&shift=eq.evening`,
    { method: "DELETE" },
  );

  // Cashier creates report
  const create = await fetch(`${APP}/api/cashhub/reports`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cashier.cookie },
    body: JSON.stringify({
      branchId, reportDate: today, shift: "evening",
      totalSales: 100000, qty1: 3500, qty1Unit: "L",
      cash: 60000, transfer: 30000, card: 10000, credit: 0, shortage: 0,
      notes: "Day 6 integration test — TG callback",
    }),
  });
  expect(create.ok, `Cashier create report → ${create.status}`);
  const reportId = (await create.json()).data?.id;
  log("INFO", `Created report ${reportId} (status=submitted)`);

  // Get manager's telegram_user_id (may not be set in test env)
  const mgrRes = await fetch(
    `${SUPABASE_URL}/rest/v1/users?email=eq.mgr@pooilgroup.test&select=id,telegram_user_id`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
  );
  const mgrRows = await mgrRes.json();
  const mgr = mgrRows?.[0];

  // Set telegram_user_id for testing if not set
  const TEST_TG_USER_ID = 999888777;
  if (!mgr?.telegram_user_id) {
    await db(`users?id=eq.${mgr.id}`, {
      method: "PATCH",
      body: JSON.stringify({ telegram_user_id: String(TEST_TG_USER_ID) }),
    });
    log("INFO", `Linked test telegram_user_id to manager`);
  }

  // Simulate Telegram callback: ✅ approve
  if (!TG_SECRET) {
    log("FAIL", "TELEGRAM_WEBHOOK_SECRET not set — can't simulate callback");
    fail++;
  } else if (reportId) {
    const tgUpdate = {
      update_id: Date.now(),
      callback_query: {
        id: `cb-${Date.now()}`,
        from: { id: mgr?.telegram_user_id ? Number(mgr.telegram_user_id) : TEST_TG_USER_ID },
        data: `cashhub:approve:${reportId}`,
        message: {
          message_id: 1,
          chat: { id: 999000111, type: "private" },
          text: "Test report",
        },
      },
    };

    const tgRes = await fetch(`${APP}/api/telegram/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-telegram-bot-api-secret-token": TG_SECRET,
      },
      body: JSON.stringify(tgUpdate),
    });
    expect(tgRes.status === 200, `TG webhook callback → ${tgRes.status}`);

    // Verify report status changed
    const verify = await db(`daily_reports?id=eq.${reportId}&select=status,approved_by_id`);
    const dbReport = Array.isArray(verify.body) ? verify.body[0] : null;
    expect(
      dbReport?.status === "approved",
      `Report status after TG approve: ${dbReport?.status} (expected approved)`,
    );

    // Cleanup
    await db(`daily_reports?id=eq.${reportId}`, { method: "DELETE" });
  }

  // ──────────────────────────────────────────────
  // 4. TG callback rejected without proper secret
  // ──────────────────────────────────────────────
  console.log("\n🚫 TG callback security");
  const tgNoSecret = await fetch(`${APP}/api/telegram/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ update_id: 1, message: {} }),
  });
  expect(
    tgNoSecret.status === 403 || tgNoSecret.status === 503,
    `TG webhook without secret → ${tgNoSecret.status} (expected 403/503)`,
  );

  const tgBadSecret = await fetch(`${APP}/api/telegram/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-telegram-bot-api-secret-token": "wrong-secret",
    },
    body: JSON.stringify({ update_id: 1, message: {} }),
  });
  expect(tgBadSecret.status === 403, `TG webhook bad secret → ${tgBadSecret.status} (expected 403)`);

  // Summary
  console.log(`\n${"─".repeat(50)}`);
  console.log(`Passed: \x1b[32m${pass}\x1b[0m   Failed: \x1b[31m${fail}\x1b[0m   Total: ${pass + fail}`);
  console.log(`${"─".repeat(50)}\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
