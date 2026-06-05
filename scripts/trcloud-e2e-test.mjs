// scripts/trcloud-e2e-test.mjs — FULL push flow proof against company 31.
// Mirrors lib/ledger/trcloud-push.ts payloads EXACTLY (no prisma): create vendor →
// create service SKU → create AP → read back → DELETE everything (cleanup).
// Run: node --env-file=.env.local scripts/trcloud-e2e-test.mjs
import { createHash } from "node:crypto";

const COMPANY_ID = process.env.TRCLOUD_COMPANY_ID;
const PASSKEY = process.env.TRCLOUD_PASSKEY;
const ENCRYPT_HEAD = process.env.TRCLOUD_ENCRYPT_HEAD;
const ORIGIN = process.env.TRCLOUD_ORIGIN ?? "https://pooil.trcloud.co";
const BASE = process.env.TRCLOUD_BASE ?? "https://pooil.trcloud.co/application/api-connector2/end-point";

function auth() {
  const t = Math.floor(Date.now() / 1000);
  return { company_id: COMPANY_ID, passkey: PASSKEY, timestamp: t, securekey: createHash("md5").update(`${ENCRYPT_HEAD}t${t}`).digest("hex") };
}
async function post(path, payload) {
  const body = new URLSearchParams({ json: JSON.stringify({ ...auth(), ...payload }) });
  const res = await fetch(`${BASE}/${path}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: ORIGIN }, body: body.toString() });
  const raw = await res.text();
  let data = null; try { data = JSON.parse(raw); } catch {}
  return { status: res.status, data, raw };
}
const ok = (d) => d && (d.success === 1 || d.success === "1" || d.success === true || (typeof d.HTTP === "string" && d.HTTP.startsWith("2")));
const pick = (o, ...ks) => { if (!o) return null; for (const k of ks) { const v = o[k]; if (v != null && (typeof v === "string" || typeof v === "number") && String(v).trim()) return String(v); } return null; };
const stamp = String(Math.floor(Date.now() / 1000)).slice(-6);
const today = new Date().toISOString().slice(0, 10);

console.log("creds:", COMPANY_ID, ENCRYPT_HEAD, "***" + String(PASSKEY).slice(-4));

// 1) CREATE VENDOR (group_code S, contact_for buy)
console.log("\n[1] contact/create.php (vendor)…");
const cRes = await post("contact/create.php", {
  date: today, group_code: "S", code_number: "", name: `ทดสอบผู้ขาย ${stamp}`,
  organization: `ร้านทดสอบ LedgerLine ${stamp}`, branch: "00000", address: "-",
  email: "", telephone: "", tax_id: `09999${stamp}99`, contact_type: "normal", contact_for: "buy",
});
console.log("  →", cRes.status, cRes.raw.slice(0, 300));
const contactInner = cRes.data?.data ?? cRes.data?.head ?? cRes.data;
const contactId = pick(contactInner, "contact_id", "id") ?? pick(cRes.data, "contact_id", "id");
const contactCode = pick(contactInner, "last", "title", "code_number") ?? pick(cRes.data, "last", "title", "code_number");
console.log("  contactId =", contactId, "| code_number(title) =", contactCode);

// 1b) verify search returns the code too (needed for the reuse path)
const sRes = await post("contact/search.php", { keyword: `09999${stamp}99`, group_code: "S", limit: "5" });
console.log("  search →", sRes.raw.slice(0, 350));

// 2) CREATE SERVICE SKU (status 0)
const prodCode = `LDGTEST${stamp}`;
console.log("\n[2] inventory/create.php (service SKU)…");
const iRes = await post("inventory/create.php", {
  product_id: prodCode, product_name: `รายการทดสอบ ${stamp}`, status: "0", product_for: "buy", pvat: "7", unit: "หน่วย",
});
console.log("  →", iRes.status, iRes.raw.slice(0, 300));
const invInner = iRes.data?.data ?? iRes.data?.head ?? iRes.data;
const invSysId = pick(invInner, "id", "inventory_id") ?? pick(iRes.data, "id");
console.log("  product_id(code) =", prodCode, "| inventory system id =", invSysId);

// 3) CREATE AP referencing them
console.log("\n[3] ap/create.php …");
const apRes = await post("ap/create.php", {
  issue_date: today, due_date: today, tax_date: today, company_format: "AP", document_number: "",
  payment_term: "0", reference: `LDG-E2E-${stamp}`, discount: "0", wht: "0", tax_option: "ex",
  tax_report: "0", type: process.env.TRCLOUD_AP_TYPE_CASH ?? "Cash[AP]", approve_status: "wait",
  invoice_note: `ระบบบัญชี (LedgerLine) · E2E TEST ${stamp} — ลบได้`,
  customer: { group_code: "S", code_number: (contactCode ?? "").replace(/^\D+/, ""), name: `ทดสอบผู้ขาย ${stamp}`, organization: "", branch: "00000", address: "-", email: "", telephone: "", tax_id: `09999${stamp}99`, contact_type: "normal", contact_id: contactId ?? "0", add_contact: contactId ? "0" : "1" },
  product: [{ product_id: prodCode, product: `รายการทดสอบ ${stamp}`, price: "100", quantity: "1", vat: "7" }],
});
console.log("  →", apRes.status, apRes.raw.slice(0, 400));
const apInner = apRes.data?.data ?? apRes.data?.head ?? apRes.data;
const apId = pick(apInner, "id", "document_id") ?? pick(apRes.data, "id");
const apNo = pick(apInner, "document_number", "no") ?? pick(apRes.data, "document_number", "no");
console.log("  AP id =", apId, "| AP no =", apNo, "| success =", ok(apRes.data));

// 4) READ BACK
if (apId) {
  console.log("\n[4] ap/read.php (verify) …");
  const back = await post("ap/read.php", { id: apId });
  console.log("  →", back.raw.slice(0, 500));
}

// 5) CLEANUP — delete AP, then the test SKU + contact
console.log("\n[5] cleanup …");
if (apId) console.log("  ap/delete:", (await post("ap/delete.php", { id: apId })).raw.slice(0, 200));
if (invSysId) console.log("  inventory/delete:", (await post("inventory/delete.php", { id: invSysId })).raw.slice(0, 200));
if (contactId) console.log("  contact/delete:", (await post("contact/delete.php", { id: contactId, contact_id: contactId })).raw.slice(0, 200));
console.log("\nDONE.");
