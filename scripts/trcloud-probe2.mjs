// scripts/trcloud-probe2.mjs — discover create endpoints + their REQUIRED fields.
// Posting an (almost) empty payload to a *create* endpoint returns 406 listing the
// missing required fields WITHOUT creating anything (proven by contact/read earlier).
// 404 = endpoint doesn't exist. Run: node --env-file=.env.local scripts/trcloud-probe2.mjs
import { createHash } from "node:crypto";

const COMPANY_ID = process.env.TRCLOUD_COMPANY_ID;
const PASSKEY = process.env.TRCLOUD_PASSKEY;
const ENCRYPT_HEAD = process.env.TRCLOUD_ENCRYPT_HEAD;
const ORIGIN = process.env.TRCLOUD_ORIGIN ?? "https://pooil.trcloud.co";
const BASE = process.env.TRCLOUD_BASE ?? "https://pooil.trcloud.co/application/api-connector2/end-point";

function auth() {
  const timestamp = Math.floor(Date.now() / 1000);
  const securekey = createHash("md5").update(`${ENCRYPT_HEAD}t${timestamp}`).digest("hex");
  return { company_id: COMPANY_ID, passkey: PASSKEY, timestamp, securekey };
}
async function post(path, payload) {
  const body = new URLSearchParams({ json: JSON.stringify({ ...auth(), ...payload }) });
  const res = await fetch(`${BASE}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: ORIGIN },
    body: body.toString(),
  });
  const raw = await res.text();
  return { status: res.status, raw: raw.slice(0, 600) };
}

// All EMPTY-ish payloads → existence + required-field discovery. No real data = no create.
const probes = [
  ["inventory/create.php", {}],
  ["product/create.php", {}],
  ["inventory/list.php", {}],
  ["inventory/search.php", {}],
  ["contact/create.php", {}],
  ["contact/search.php", {}],
  ["ap/delete.php", {}],
];
for (const [path, payload] of probes) {
  const r = await post(path, payload);
  console.log(`\n=== ${path} (status ${r.status}) ===`);
  console.log(r.raw);
}
