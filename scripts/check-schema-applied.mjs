#!/usr/bin/env node
/**
 * Guardrail · Prisma schema ↔ ACTUAL database column drift.
 * Added 2026-06-19 after the ChairOps whole-module outage: a migration that
 * added `ChairopsUser.lineDisplayName`/`linePictureUrl` was COMMITTED (file +
 * schema.prisma) and the code shipped, but the SQL was never APPLIED to the
 * prod DB. `getSession()` does a default-select `findFirst` (= SELECT every
 * scalar column), so the generated SQL referenced two columns that did not
 * exist → Prisma threw on EVERY ChairOps page → "This page could not load",
 * the whole program down. It shipped because the existing table-map guard only
 * compares FILES to FILES — nothing checked the schema against the LIVE DB.
 *
 * This script makes "schema ahead of DB" impossible to deploy. It parses every
 * model in schema.prisma into its real (schema, table, column) tuples (honoring
 * @map / @@map / @@schema, skipping relation fields & enums-are-columns), then
 * asks the live DB which columns actually exist. A column declared in the schema
 * but missing from an EXISTING table = unapplied migration = HARD FAIL.
 *
 * SAFETY — designed to NEVER falsely block another program's deploy:
 *   • Only a column missing on a table that DOES exist is a hard error. That case
 *     is unambiguous (the model maps to a real table; a declared column isn't
 *     there) — it is exactly the forgotten-migration bug, zero interpretation.
 *   • A whole table missing is reported as a WARNING only (could be a model not
 *     yet pushed / created another way) — never blocks.
 *   • Enforcement (exit 1) happens ONLY on Vercel (process.env.VERCEL). Local
 *     and CI builds run in WARN-only mode, so no developer's local `next build`
 *     is ever blocked by this. Override with SCHEMA_GUARD=enforce|warn|off.
 *   • No DB credentials, or a connection failure → skip with a warning (exit 0).
 *     A transient DB blip during a Vercel build never breaks the deploy; a real
 *     forgotten migration produces a reliably-missing column every build.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA = join(ROOT, "prisma/schema.prisma");

const C = {
  red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m",
  dim: "\x1b[2m", bold: "\x1b[1m", reset: "\x1b[0m",
};

// --- mode resolution -------------------------------------------------------
const override = (process.env.SCHEMA_GUARD || "").toLowerCase();
const onVercel = !!process.env.VERCEL;
let mode; // "enforce" | "warn" | "off"
if (override === "off" || override === "enforce" || override === "warn") mode = override;
else mode = onVercel ? "enforce" : "warn";

if (mode === "off") {
  console.log(`${C.dim}[check-schema-applied] SCHEMA_GUARD=off — skipped.${C.reset}`);
  process.exit(0);
}

const SCALAR = new Set([
  "String", "Boolean", "Int", "BigInt", "Float", "Decimal",
  "DateTime", "Json", "Bytes",
]);

// --- parse schema.prisma ---------------------------------------------------
const src = readFileSync(SCHEMA, "utf8");
const lines = src.split("\n");

// Pass 1: collect model + enum names (needed to tell relation fields from columns).
const modelNames = new Set();
const enumNames = new Set();
for (const raw of lines) {
  const m = raw.match(/^\s*model\s+(\w+)\s*\{/);
  if (m) modelNames.add(m[1]);
  const e = raw.match(/^\s*enum\s+(\w+)\s*\{/);
  if (e) enumNames.add(e[1]);
}

// Pass 2: walk each model block → expected (schema, table, column) tuples.
const expected = []; // { schema, table, column, model, field }
let cur = null; // { model, columns: [{column, field}], table, schema, ignore }

function flush() {
  if (!cur) return;
  if (!cur.ignore && cur.schema) {
    for (const c of cur.columns) {
      expected.push({ schema: cur.schema, table: cur.table, column: c.column, model: cur.model, field: c.field });
    }
  }
  cur = null;
}

for (const raw of lines) {
  const line = raw.trim();
  const mh = line.match(/^model\s+(\w+)\s*\{/);
  if (mh) { flush(); cur = { model: mh[1], table: mh[1], schema: null, columns: [], ignore: false }; continue; }
  if (!cur) continue;
  if (line === "}") { flush(); continue; }
  if (line === "" || line.startsWith("//")) continue;

  // block-level attributes
  if (line.startsWith("@@")) {
    const map = line.match(/@@map\(\s*"([^"]+)"\s*\)/);
    if (map) cur.table = map[1];
    const sch = line.match(/@@schema\(\s*"([^"]+)"\s*\)/);
    if (sch) cur.schema = sch[1];
    if (/@@ignore\b/.test(line)) cur.ignore = true;
    continue;
  }

  // field line: "<name> <Type...> <attrs...>"
  const fm = line.match(/^(\w+)\s+([A-Za-z0-9_]+)(\[\])?(\?)?/);
  if (!fm) continue;
  const field = fm[1];
  const baseType = fm[2];
  if (/@ignore\b/.test(line) && !/@@ignore/.test(line)) continue; // field-level @ignore
  if (baseType === "Unsupported") continue;

  const isColumn = SCALAR.has(baseType) || enumNames.has(baseType);
  const isRelation = modelNames.has(baseType);
  if (!isColumn || isRelation) continue; // relation / virtual field → not a DB column

  const map = line.match(/@map\(\s*"([^"]+)"\s*\)/);
  const column = map ? map[1] : field;
  cur.columns.push({ column, field });
}
flush();

const schemasUsed = [...new Set(expected.map((e) => e.schema))];
console.log(`${C.dim}[check-schema-applied] parsed ${modelNames.size} models · ${expected.length} columns across schemas: ${schemasUsed.join(", ")}${C.reset}`);

// --- query the live DB -----------------------------------------------------
const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) {
  console.log(`${C.yellow}[check-schema-applied] no DIRECT_URL/DATABASE_URL — skipped (cannot verify).${C.reset}`);
  process.exit(0);
}

let pg;
try { ({ default: pg } = await import("pg")); }
catch { console.log(`${C.yellow}[check-schema-applied] 'pg' not installed — skipped.${C.reset}`); process.exit(0); }

// `new pg.Client({ connectionString, ssl })` does NOT let our ssl win: pg does
// `Object.assign({}, config, parse(connectionString))` (pg/lib/connection-parameters.js),
// so whatever `sslmode=` is in the URL OVERWRITES the ssl object we pass. Supabase URLs
// carry `sslmode=require`, which pg-connection-string turns into `ssl: {}` (= verify the
// chain) — and Supabase serves a self-signed chain, so every connect died with
// SELF_SIGNED_CERT_IN_CHAIN and this guard skipped itself on EVERY Vercel build from the
// day it was added. It only ever "worked" locally because .env.local sets
// NODE_TLS_REJECT_UNAUTHORIZED=0, which Vercel does not have. Strip the ssl params out of
// the URL so our explicit ssl config is the one that actually takes effect.
let connectionString = url;
try {
  const u = new URL(url);
  for (const p of ["sslmode", "ssl", "sslcert", "sslkey", "sslrootcert", "uselibpqcompat"]) {
    u.searchParams.delete(p);
  }
  connectionString = u.toString();
} catch { /* not a parseable URL — hand it to pg as-is */ }

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false }, statement_timeout: 20000 });

// A connect failure is only safe to ignore when it is TRANSIENT (a blip during one build).
// A misconfiguration — bad TLS, bad credentials, missing database — fails identically on
// every future build, so "skip" there means the guard is permanently dead while still
// printing a reassuring line. That is exactly how the unapplied RentSpace migration
// (2026-09-06) reached production and took the whole module down. Transient → skip;
// deterministic → treat as a guard failure and block, same as real drift.
const TRANSIENT = new Set([
  "ETIMEDOUT", "ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "EPIPE", "EHOSTUNREACH",
]);
try {
  await client.connect();
} catch (err) {
  const code = err.code || err.message;
  if (TRANSIENT.has(err.code)) {
    console.log(`${C.yellow}[check-schema-applied] could not connect to DB (${code}) — transient, skipped, NOT blocking the build.${C.reset}`);
    process.exit(0);
  }
  console.log(`\n${C.red}${C.bold}✗ [check-schema-applied] cannot connect to the DB: ${code}${C.reset}`);
  console.log(`  ${C.dim}This is a configuration error, not a blip — it will fail on every build, leaving`);
  console.log(`  the forgotten-migration guard permanently blind. Fix the connection, do not skip it.${C.reset}`);
  if (mode === "enforce") process.exit(1);
  console.log(`${C.yellow}⚠ WARN-only mode (not on Vercel) — would BLOCK on a real deploy.${C.reset}`);
  process.exit(0);
}

let dbCols, dbTables;
try {
  const res = await client.query(
    `SELECT table_schema, table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = ANY($1::text[])`,
    [schemasUsed]
  );
  dbCols = new Set(res.rows.map((r) => `${r.table_schema}.${r.table_name}.${r.column_name}`));
  dbTables = new Set(res.rows.map((r) => `${r.table_schema}.${r.table_name}`));
} catch (err) {
  console.log(`${C.yellow}[check-schema-applied] query failed (${err.code || err.message}) — skipped, NOT blocking the build.${C.reset}`);
  process.exit(0);
} finally {
  await client.end().catch(() => {});
}

// --- compare ---------------------------------------------------------------
const missingColumns = []; // table exists, column missing → DRIFT (hard fail)
const missingTablesSet = new Set(); // whole table absent → warn only
for (const e of expected) {
  const t = `${e.schema}.${e.table}`;
  if (!dbTables.has(t)) { missingTablesSet.add(t); continue; }
  if (!dbCols.has(`${t}.${e.column}`)) missingColumns.push(e);
}

if (missingColumns.length === 0 && missingTablesSet.size === 0) {
  console.log(`${C.green}✓ [check-schema-applied] DB schema is up to date — every model column exists. (mode: ${mode})${C.reset}`);
  process.exit(0);
}

if (missingTablesSet.size > 0) {
  console.log(`${C.yellow}⚠ [check-schema-applied] ${missingTablesSet.size} model table(s) not found in DB (warning only, not blocking):${C.reset}`);
  for (const t of [...missingTablesSet].sort()) console.log(`    ${C.yellow}· ${t}${C.reset}`);
}

if (missingColumns.length > 0) {
  console.log(`\n${C.red}${C.bold}✗ [check-schema-applied] DB SCHEMA DRIFT — ${missingColumns.length} column(s) declared in schema.prisma but MISSING in the database:${C.reset}`);
  const byTable = new Map();
  for (const e of missingColumns) {
    const k = `${e.schema}."${e.table}"`;
    if (!byTable.has(k)) byTable.set(k, []);
    byTable.get(k).push(e);
  }
  for (const [tbl, cols] of [...byTable.entries()].sort()) {
    console.log(`  ${C.red}${tbl}${C.reset}`);
    for (const e of cols) console.log(`      ${C.red}· "${e.column}"${C.reset} ${C.dim}(model ${e.model}.${e.field})${C.reset}`);
    console.log(`      ${C.dim}fix: ALTER TABLE ${tbl} ADD COLUMN IF NOT EXISTS "${cols[0].column}" ...; — apply the migration for this table to the DB FIRST, then deploy.${C.reset}`);
  }
  if (mode === "enforce") {
    console.log(`\n${C.red}${C.bold}Build blocked — apply the pending migration(s) to the database, then redeploy.${C.reset}`);
    console.log(`${C.dim}(This gate prevents the kind of whole-module outage caused by an unapplied migration. To bypass in an emergency, set SCHEMA_GUARD=off.)${C.reset}`);
    process.exit(1);
  } else {
    console.log(`\n${C.yellow}⚠ WARN-only mode (not on Vercel) — would BLOCK on a real deploy. Apply the migration above.${C.reset}`);
    process.exit(0);
  }
}

process.exit(0);
