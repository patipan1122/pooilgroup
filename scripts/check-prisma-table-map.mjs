#!/usr/bin/env node
/**
 * Guardrail · Prisma model ↔ migration table-name consistency.
 * Added 2026-06-16 after the ChairOps Gmail outage: a hand-written raw SQL
 * migration created `chairops.chairops_gmail_connection` (snake_case) but the
 * Prisma model `ChairopsGmailConnection` had no `@@map`, so Prisma queried
 * `chairops.ChairopsGmailConnection` (the model name) — which does not exist.
 * That P2021 crashed the whole POS-Ingest Server Component and broke uploads,
 * silently, for ALL of ChairOps. It shipped because nothing checked it.
 *
 * This script makes that bug class impossible to ship again, for every program
 * (chairops / ledger / playland / fuel / public). It runs in the build BEFORE
 * `next build`, so a mismatch fails the build loudly instead of reaching prod.
 *
 * It is intentionally PRECISE (zero false positives): it only errors when a raw
 * migration creates a table whose name clearly corresponds to an existing model
 * (snake_case of the model name) but no model actually resolves to that name.
 * Tables created via `prisma db push` (no raw SQL) are not flagged.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA = join(ROOT, "prisma/schema.prisma");
const MIG_DIR = join(ROOT, "prisma/migrations");

function walkSql(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walkSql(p));
    else if (e.endsWith(".sql")) out.push(p);
  }
  return out;
}

// 1) Every table name created in raw SQL migrations (name only, case-sensitive).
const created = new Set();
const CT = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?[A-Za-z_][\w]*"?\s*\.\s*)?"?([A-Za-z_][\w]*)"?/gi;
for (const f of walkSql(MIG_DIR)) {
  const txt = readFileSync(f, "utf8");
  let m;
  while ((m = CT.exec(txt))) created.add(m[1]);
}

// 2) Resolved table name for every Prisma model (= @@map value, else model name).
const schemaTxt = readFileSync(SCHEMA, "utf8");
const modelRe = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
const resolvedNames = new Set(); // every name a model will actually query
const models = []; // { name, resolved, hasMap }
let mm;
while ((mm = modelRe.exec(schemaTxt))) {
  const name = mm[1];
  const body = mm[2];
  const map = body.match(/@@map\(\s*"([^"]+)"\s*\)/);
  const resolved = map ? map[1] : name;
  resolvedNames.add(resolved);
  models.push({ name, resolved, hasMap: !!map });
}

const snake = (s) => s.replace(/(?<!^)(?=[A-Z])/g, "_").toLowerCase();

// 3) Flag the hard class: a created table that a model obviously corresponds to
//    (snake_case of model name) but which NO model resolves to.
const errors = [];
for (const { name, resolved } of models) {
  const expectedSnake = snake(name);
  // If a snake_case table matching this model was created in raw SQL, but the
  // model does NOT resolve to it AND no other model claims it (via @@map), then
  // this model will query a non-existent table — the exact Gmail bug class.
  if (created.has(expectedSnake) && resolved !== expectedSnake && !resolvedNames.has(expectedSnake)) {
    errors.push(
      `  ✗ model ${name}\n` +
        `      Prisma will query : "${resolved}"  (does not exist)\n` +
        `      migration created : "${expectedSnake}"\n` +
        `      FIX: add  @@map("${expectedSnake}")  to model ${name}`
    );
  }
}

if (errors.length) {
  console.error(
    "\n✗ Prisma table-map check FAILED — model(s) query a table name the migrations never created:\n"
  );
  console.error(errors.join("\n\n"));
  console.error(
    "\nThis is the ChairOps-Gmail bug class (2026-06-16). A snake_case table was\n" +
      "created by a raw migration but the model lacks a matching @@map, so Prisma\n" +
      "queries the wrong name and crashes the page. Add the @@map shown above.\n"
  );
  process.exit(1);
}

console.log(`✓ prisma table-map check passed (${models.length} models, ${created.size} migration tables)`);
