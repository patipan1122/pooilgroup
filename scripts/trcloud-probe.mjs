// scripts/trcloud-probe.mjs — READ-ONLY probe for TRCloud api-connector2 (company 31).
// Run: node --env-file=.env.local scripts/trcloud-probe.mjs
// NEVER prints the passkey. Only hits read.php (no writes) to verify auth + discover
// which read endpoints exist (404 = no endpoint · 401 = auth fail · 503/200 = auth OK).
import { createHash } from "node:crypto";

const COMPANY_ID = process.env.TRCLOUD_COMPANY_ID;
const PASSKEY = process.env.TRCLOUD_PASSKEY;
const ENCRYPT_HEAD = process.env.TRCLOUD_ENCRYPT_HEAD;
const ORIGIN = process.env.TRCLOUD_ORIGIN ?? "https://pooil.trcloud.co";
const BASE = process.env.TRCLOUD_BASE ?? "https://pooil.trcloud.co/application/api-connector2/end-point";

if (!COMPANY_ID || !PASSKEY || !ENCRYPT_HEAD) {
  console.error("MISSING creds (TRCLOUD_COMPANY_ID / PASSKEY / ENCRYPT_HEAD) in env");
  process.exit(1);
}
console.log(`creds present: company_id=${COMPANY_ID} · encrypt_head=${ENCRYPT_HEAD} · passkey=***${String(PASSKEY).slice(-4)} · origin=${ORIGIN}`);

function auth() {
  const timestamp = Math.floor(Date.now() / 1000);
  const securekey = createHash("md5").update(`${ENCRYPT_HEAD}t${timestamp}`).digest("hex");
  return { company_id: COMPANY_ID, passkey: PASSKEY, timestamp, securekey };
}

async function post(path, payload) {
  const body = new URLSearchParams({ json: JSON.stringify({ ...auth(), ...payload }) });
  try {
    const res = await fetch(`${BASE}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: ORIGIN },
      body: body.toString(),
    });
    const raw = await res.text();
    return { status: res.status, raw: raw.slice(0, 500) };
  } catch (e) {
    return { error: String(e) };
  }
}

// READ-ONLY probes. id=1 is almost certainly empty → we only want the auth/endpoint signal.
const probes = [
  ["ap/read.php", { id: "1" }],
  ["po/read.php", { id: "1" }],
  ["contact/read.php", { id: "1" }],
  ["contact/list.php", {}],
  ["product/read.php", { id: "1" }],
  ["product/list.php", {}],
  ["inventory/read.php", { id: "1" }],
];

for (const [path, payload] of probes) {
  const r = await post(path, payload);
  console.log(`\n=== ${path} ===`);
  console.log(JSON.stringify(r));
}
