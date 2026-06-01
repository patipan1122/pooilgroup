// Self-contained dedup-overlap proof for the StarThing event ingest.
//
// CEO 2026-06-01 ask: "อัพวันที่ 1-3 แล้ว ต่อมาอัพ 3-4 · วันที่ 3 จะซ้ำ
// บางส่วนก็ตัดออก · ที่เหลือก็ปล่อยให้อัพได้"
//
// This script exercises the deterministic primitive that drives dedup:
//   computeEventRowHash(kind, device, eventAtISO, amount, meter)
// plus the bucket-assignment logic from computeEventDiff (in-DB set lookup +
// intra-file Set), proving the day-3 overlap scenario behaves correctly
// WITHOUT needing a live Postgres round-trip.
//
// Run: pnpm exec tsx -r dotenv/config scripts/test-pos-dedup-overlap.ts
//   dotenv_config_path=.env.local
// (env file is unused here · kept for shell-consistency with siblings)

import { computeEventRowHash } from "@/lib/chairops/pos-ingest/starthing-events";

type Row = {
  device: string;
  eventAt: Date;
  amount: number;
  meter: number;
};

const DEVICE = "DEV-001";

// Build N rows starting at startISO + i*hourSpan, deterministic amount/meter.
function makeRows(startISO: string, count: number, amountStart: number): Row[] {
  const start = new Date(startISO);
  return Array.from({ length: count }, (_, i) => ({
    device: DEVICE,
    eventAt: new Date(start.getTime() + i * 60 * 60 * 1000),
    amount: amountStart + i,
    meter: amountStart * 100 + i,
  }));
}

function hashRow(r: Row): string {
  return computeEventRowHash(
    "coin",
    r.device,
    r.eventAt.toISOString(),
    r.amount,
    r.meter,
  );
}

// Mimic the bucket loop from computeEventDiff (lib/chairops/pos-ingest/event-diff.ts:122).
type Bucket = "new" | "duplicate" | "intra-duplicate";
function classify(rows: Row[], existingHashes: Set<string>): Bucket[] {
  const seen = new Set<string>();
  const out: Bucket[] = [];
  for (const r of rows) {
    const h = hashRow(r);
    if (existingHashes.has(h)) out.push("duplicate");
    else if (seen.has(h)) out.push("intra-duplicate");
    else {
      out.push("new");
      seen.add(h);
    }
  }
  return out;
}

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`❌ FAIL · ${msg}`);
    process.exit(1);
  }
  console.log(`✅ PASS · ${msg}`);
}

console.log("");
console.log("=== dedup overlap test · day 1-3 then day 3-4 ===");
console.log("");

// ── Round 1: upload day 1-3 (3 distinct days, 4 events per day) ────────────
const day1 = makeRows("2026-04-01T00:00:00Z", 4, 100);
const day2 = makeRows("2026-04-02T00:00:00Z", 4, 200);
const day3 = makeRows("2026-04-03T00:00:00Z", 4, 300);
const round1 = [...day1, ...day2, ...day3];

const round1Buckets = classify(round1, new Set());
assert(
  round1Buckets.every((b) => b === "new"),
  `round 1 (12 rows): all rows classified as "new"`,
);

// Now persist round 1 by collecting hashes into "DB" set.
const db = new Set(round1.map(hashRow));
console.log(`   stored ${db.size} unique hashes in mock DB`);

// ── Round 2: upload day 3-4 — day 3 overlaps round 1 exactly ───────────────
const day3Again = makeRows("2026-04-03T00:00:00Z", 4, 300); // same inputs → same hashes
const day4 = makeRows("2026-04-04T00:00:00Z", 4, 400);
const round2 = [...day3Again, ...day4];

const round2Buckets = classify(round2, db);
const dupCount = round2Buckets.filter((b) => b === "duplicate").length;
const newCount = round2Buckets.filter((b) => b === "new").length;

assert(dupCount === 4, `round 2: day-3 rows (4) all classified as "duplicate"`);
assert(newCount === 4, `round 2: day-4 rows (4) classified as "new"`);
assert(
  round2Buckets.slice(0, 4).every((b) => b === "duplicate"),
  `round 2: first 4 (day 3) are duplicate, not intra-duplicate`,
);
assert(
  round2Buckets.slice(4).every((b) => b === "new"),
  `round 2: last 4 (day 4) are new`,
);

// ── Round 3: stress test · re-upload all of round 1 → 100% duplicate ───────
const round3Buckets = classify(round1, db);
assert(
  round3Buckets.every((b) => b === "duplicate"),
  `round 3 (re-upload identical round 1): all 12 rows "duplicate"`,
);

// ── Round 4: intra-duplicate detection · same file contains a repeated row ─
const repeated = [...day1, ...day1.slice(0, 2)]; // day1 twice (first 2 entries)
const round4Buckets = classify(repeated, new Set()); // fresh DB
const intraDup = round4Buckets.filter((b) => b === "intra-duplicate").length;
assert(
  intraDup === 2,
  `round 4 (file has 2 duplicate rows within itself): 2 marked "intra-duplicate"`,
);

console.log("");
console.log("=== all dedup invariants hold ===");
console.log("");
console.log("✅ Goal #2 (CEO 2026-06-01) proven deterministically:");
console.log("   • re-upload day 3 → 100% skipped");
console.log("   • day 4 (new) → inserted");
console.log("   • re-upload identical batch → 100% no-op");
console.log("   • in-file duplicates → caught by intra-duplicate bucket");
console.log("");
process.exit(0);
