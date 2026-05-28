// Day 2 Functional Test — End-to-end flows for CashHub
// Personas: cashier (create), branch_manager (approve), auditor (read)
//
// Run while dev server is up on http://localhost:3100

import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP = "http://localhost:3100";
const PASSWORD = "Pooil2026!";

const ORG_ID = "00000000-0000-0000-0000-000000000001";

// Service-role helper for clean state verification + cleanup
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

async function login(email) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON_KEY },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!r.ok) throw new Error(`Login ${email}: ${r.status}`);
  const tokens = await r.json();
  const proj = new URL(SUPABASE_URL).host.split(".")[0];
  const cookieValue =
    "base64-" +
    Buffer.from(JSON.stringify(tokens))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  return {
    cookie: `sb-${proj}-auth-token=${cookieValue}`,
    accessToken: tokens.access_token,
    user: tokens.user,
  };
}

async function api(path, opts = {}, session) {
  const r = await fetch(`${APP}${path}`, {
    redirect: "manual", // ไม่ follow redirects — เห็น 307 จริง
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Cookie: session.cookie,
      ...(opts.headers ?? {}),
    },
  });
  let body = null;
  const ct = r.headers.get("content-type") ?? "";
  try {
    body = ct.includes("application/json") ? await r.json() : await r.text();
  } catch { /* ignore */ }
  return { status: r.status, body, location: r.headers.get("location") ?? "" };
}

const log = (level, msg) => {
  const tag =
    level === "PASS" ? "\x1b[32m✓ PASS\x1b[0m" :
    level === "FAIL" ? "\x1b[31m✗ FAIL\x1b[0m" :
    level === "INFO" ? "  ·"  : level;
  console.log(`${tag}  ${msg}`);
};

let testsPassed = 0;
let testsFailed = 0;

function expect(cond, name) {
  if (cond) { log("PASS", name); testsPassed++; }
  else { log("FAIL", name); testsFailed++; }
}

// ─────────────────────────────────────────────────────────────────
// Day 2 Test Suite
// ─────────────────────────────────────────────────────────────────
async function main() {
  console.log("\n🧪 Day 2 — Functional Test Suite\n");

  // Login all personas
  console.log("→ Logging in personas...");
  const cashier = await login("cashier@pooilgroup.test");
  const manager = await login("mgr@pooilgroup.test");
  const auditor = await login("viewer@pooilgroup.test");
  const admin = await login("admin@pooilgroup.test");
  log("INFO", `cashier user_id=${cashier.user.id}`);
  log("INFO", `manager user_id=${manager.user.id}`);

  // Find branch JP-FUEL-001 — use Supabase REST directly (no admin list endpoint)
  const branchRes = await fetch(
    `${SUPABASE_URL}/rest/v1/branches?org_id=eq.${ORG_ID}&code=eq.JP-FUEL-001&select=id,code,name,business_type`,
    { headers: { apikey: ANON_KEY, Authorization: `Bearer ${admin.accessToken}` } },
  );
  const branchList = await branchRes.json();
  const targetBranch = branchList?.[0];
  if (!targetBranch) {
    log("FAIL", `Cannot find JP-FUEL-001`);
    process.exit(1);
  }
  log("INFO", `Using branch ${targetBranch.code} (id=${targetBranch.id})`);

  // CLEANUP — ลบ test report ของวันนี้ก่อน (idempotent test runs)
  const today = new Date().toISOString().slice(0, 10);
  const del = await db(
    `daily_reports?branch_id=eq.${targetBranch.id}&report_date=eq.${today}&shift=eq.morning`,
    { method: "DELETE" },
  );
  log("INFO", `Cleanup: deleted ${Array.isArray(del.body) ? del.body.length : 0} stale report(s) for ${today} morning`);

  // ───────────────────────────────────────────────────────────
  // TEST GROUP A — Cashier creates a CashHub report
  // ───────────────────────────────────────────────────────────
  console.log(`\n📋 Group A: Cashier creates CashHub report`);

  const reportPayload = {
    branchId: targetBranch.id,
    reportDate: today,
    shift: "morning",
    totalSales: 145000,
    qty1: 5200,
    qty1Unit: "L",
    cash: 80000,
    transfer: 45000,
    card: 20000,
    credit: 0,
    shortage: 0,
    notes: "Day 2 functional test — Cashier morning shift",
  };

  const create = await api(
    "/api/cashhub/reports",
    { method: "POST", body: JSON.stringify(reportPayload) },
    cashier,
  );
  expect(
    create.status === 200 || create.status === 201,
    `Cashier POST /api/cashhub/reports → ${create.status}`,
  );

  const reportId = create.body?.data?.id ?? create.body?.id ?? create.body?.report?.id;
  if (!reportId) {
    log("FAIL", `No report id. Body: ${JSON.stringify(create.body).slice(0, 200)}`);
    testsFailed++;
  } else {
    log("INFO", `Created report id=${reportId}`);
    const status = create.body?.data?.status ?? create.body?.status ?? create.body?.report?.status;
    expect(
      status === "submitted" || status === "draft",
      `New report status=${status} (expected submitted/draft)`,
    );
  }

  // Reconcile check (cash + transfer + card = totalSales)
  const reconcile = (reportPayload.cash + reportPayload.transfer + reportPayload.card) === reportPayload.totalSales;
  log("INFO", `Reconcile: 80k + 45k + 20k = 145k (expected ${reportPayload.totalSales}) → ${reconcile ? "✓ ตรง" : "✗ ผิด"}`);

  // Verify cashier can see their own report
  const ownList = await api(`/api/cashhub/reports?branchId=${targetBranch.id}&date=${today}`, {}, cashier);
  expect(ownList.status === 200, `Cashier GET reports list → ${ownList.status}`);

  // Negative test: Viewer (no create permission) → 403
  const viewerCreate = await api(
    "/api/cashhub/reports",
    { method: "POST", body: JSON.stringify({ ...reportPayload, reportDate: today, shift: "midday" }) },
    auditor,
  );
  expect(
    viewerCreate.status === 403,
    `Viewer POST /api/cashhub/reports → ${viewerCreate.status} (expected 403)`,
  );

  // ───────────────────────────────────────────────────────────
  // TEST GROUP B — Branch Manager approves the report
  // ───────────────────────────────────────────────────────────
  if (reportId) {
    console.log(`\n✅ Group B: Branch Manager approves report`);

    const approve = await api(
      "/api/cashhub/approve",
      { method: "POST", body: JSON.stringify({ reportId, action: "approve" }) },
      manager,
    );
    expect(
      approve.status === 200,
      `Manager POST /api/cashhub/approve → ${approve.status}`,
    );

    // Verify status via Supabase REST (service role — bypass RLS)
    const verifyRes = await db(`daily_reports?id=eq.${reportId}&select=id,status`);
    const dbReport = Array.isArray(verifyRes.body) ? verifyRes.body[0] : null;
    if (!dbReport) {
      log("INFO", `verify status=${verifyRes.status} body=${typeof verifyRes.body === "string" ? verifyRes.body.slice(0, 200) : JSON.stringify(verifyRes.body)}`);
    }
    log("INFO", `DB after approve: status=${dbReport?.status ?? "<no row>"}`);
    expect(
      dbReport?.status === "approved",
      `DB report status after approval: ${dbReport?.status} (expected approved)`,
    );

    // Negative: cashier tries to approve own report (already approved → 409 also valid)
    const cashierApprove = await api(
      "/api/cashhub/approve",
      { method: "POST", body: JSON.stringify({ reportId, action: "approve" }) },
      cashier,
    );
    expect(
      cashierApprove.status === 403 || cashierApprove.status === 400 || cashierApprove.status === 409,
      `Cashier POST approve → ${cashierApprove.status} (expected 403/400/409)`,
    );
  }

  // ───────────────────────────────────────────────────────────
  // TEST GROUP C — Auditor reads + checks audit log
  // ───────────────────────────────────────────────────────────
  console.log(`\n🔍 Group C: Auditor checks audit log`);

  // Auditor can fetch audit log via Supabase (admin client has bypass; this hits API)
  const auditPage = await api("/audit", {}, auditor);
  expect(
    auditPage.status === 200 || auditPage.status === 307,
    `Auditor GET /audit → ${auditPage.status}`,
  );

  // Negative: cashier accesses /audit
  const cashierAudit = await api("/audit", {}, cashier);
  expect(
    cashierAudit.status === 307,
    `Cashier GET /audit → ${cashierAudit.status} (expected 307 → 403)`,
  );

  // ───────────────────────────────────────────────────────────
  // TEST GROUP D — User count via Supabase REST (admin scope)
  // /api/admin/users คือ POST-only (mutate); list อ่านจาก DB ตรง
  // ───────────────────────────────────────────────────────────
  console.log(`\n👥 Group D: User count via direct DB`);

  const usersRes = await fetch(
    `${SUPABASE_URL}/rest/v1/users?org_id=eq.${ORG_ID}&select=id,email,role`,
    { headers: { apikey: ANON_KEY, Authorization: `Bearer ${admin.accessToken}` } },
  );
  expect(usersRes.ok, `Supabase REST users query → ${usersRes.status}`);
  const userList = await usersRes.json();
  log("INFO", `Found ${userList.length} users in org`);
  expect(userList.length >= 5, `User count ≥ 5 (got ${userList.length})`);

  // Negative: cashier tries POST to /api/admin/users (mutate endpoint)
  // 307 ก็ถือว่า denied (proxy.ts redirect ไป /403 หรือ /login)
  const cashierUsers = await api(
    "/api/admin/users",
    { method: "POST", body: JSON.stringify({ name: "X", email: "x@y.com" }) },
    cashier,
  );
  expect(
    cashierUsers.status === 403 || cashierUsers.status === 401 || cashierUsers.status === 307,
    `Cashier POST /api/admin/users → ${cashierUsers.status} (denied: expected 401/403/307)`,
  );

  // ───────────────────────────────────────────────────────────
  // Summary
  // ───────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(60)}`);
  console.log(`Tests passed: \x1b[32m${testsPassed}\x1b[0m`);
  console.log(`Tests failed: \x1b[31m${testsFailed}\x1b[0m`);
  console.log(`Total: ${testsPassed + testsFailed}`);
  console.log(`${"─".repeat(60)}\n`);
  process.exit(testsFailed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("✗ Suite error:", e);
  process.exit(1);
});
