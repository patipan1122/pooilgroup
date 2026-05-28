// DocuFlow E2E test — upload + sign idempotency
// Run while dev server up

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
  return { cookie: `sb-${proj}-auth-token=${cv}`, accessToken: t.access_token };
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
  console.log("\n📄 DocuFlow E2E Test\n");

  const admin = await login("admin@pooilgroup.test");
  const cashier = await login("cashier@pooilgroup.test");

  // Cleanup any previous test documents
  await db("documents?name=like.*Day4-Test*", { method: "DELETE" });

  // ──────────────────────────────────────────────
  // Test 1: Cashier can't upload (403)
  // ──────────────────────────────────────────────
  console.log("🔐 Auth gate");
  const cashierUp = await fetch(`${APP}/api/docuflow/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cashier.cookie },
    body: JSON.stringify({
      name: "Day4-Test cashier blocked",
      filename: "x.pdf",
      mimeType: "application/pdf",
      fileSize: 1024,
      ownership: { level: "group" },
      tags: [],
    }),
  });
  expect(cashierUp.status === 403, `Cashier POST upload → ${cashierUp.status} (expected 403)`);

  // ──────────────────────────────────────────────
  // Test 2: Admin uploads valid metadata
  // ──────────────────────────────────────────────
  console.log("\n📤 Upload");
  const adminUp = await fetch(`${APP}/api/docuflow/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: admin.cookie },
    body: JSON.stringify({
      name: "Day4-Test contract",
      description: "Test document for Day 4 E2E",
      filename: "contract-test.pdf",
      mimeType: "application/pdf",
      fileSize: 50000,
      ownership: { level: "group" },
      tags: ["test", "day4"],
    }),
  });
  expect(adminUp.status === 200 || adminUp.status === 201,
    `Admin POST upload → ${adminUp.status} (expected 200/201)`);
  const upBody = await adminUp.json().catch(() => ({}));
  const docId = upBody?.document?.id ?? upBody?.id ?? upBody?.data?.id;
  if (docId) log("INFO", `Created document id=${docId}`);

  // ──────────────────────────────────────────────
  // Test 3: Verify DB has the document + ownership
  // ──────────────────────────────────────────────
  if (docId) {
    const docRow = await db(`documents?id=eq.${docId}&select=id,name,file_key,is_active`);
    const doc = Array.isArray(docRow.body) ? docRow.body[0] : null;
    expect(doc?.id === docId, `DB has document id`);
    expect(doc?.is_active === true, `Document is_active=true`);
    expect(doc?.file_key?.includes(docId), `file_key contains documentId`);

    const ownRow = await db(`document_ownership?document_id=eq.${docId}&select=level`);
    const ownerships = Array.isArray(ownRow.body) ? ownRow.body : [];
    expect(ownerships.length >= 1, `DB has ownership row(s) — ${ownerships.length} found`);

    const tagRow = await db(`document_tags?document_id=eq.${docId}&select=tag`);
    const tags = Array.isArray(tagRow.body) ? tagRow.body : [];
    expect(tags.length === 2, `DB has 2 tag rows — ${tags.length} found`);
  }

  // ──────────────────────────────────────────────
  // Test 4: Bad mime type via /api/r2/sign
  // ──────────────────────────────────────────────
  console.log("\n🚫 Mime allowlist (BUG-015 verify)");
  const badMime = await fetch(`${APP}/api/r2/sign`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: admin.cookie },
    body: JSON.stringify({ filename: "doc.exe", contentType: "application/octet-stream", size: 1024 }),
  });
  expect(badMime.status === 415, `R2 sign .exe → ${badMime.status} (expected 415)`);

  const badMimeShellExt = await fetch(`${APP}/api/r2/sign`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: admin.cookie },
    body: JSON.stringify({ filename: "rce.sh", contentType: "image/png", size: 1024 }),
  });
  expect(badMimeShellExt.status === 415, `R2 sign .sh blocked even with image MIME → ${badMimeShellExt.status} (expected 415)`);

  // ──────────────────────────────────────────────
  // Cleanup
  // ──────────────────────────────────────────────
  if (docId) {
    await db(`documents?id=eq.${docId}`, { method: "DELETE" });
    log("INFO", `Cleaned up test document`);
  }

  // Summary
  console.log(`\n${"─".repeat(50)}`);
  console.log(`Passed: \x1b[32m${pass}\x1b[0m   Failed: \x1b[31m${fail}\x1b[0m`);
  console.log(`${"─".repeat(50)}\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
