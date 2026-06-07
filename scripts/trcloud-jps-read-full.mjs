// scripts/trcloud-jps-read-full.mjs — create AP + show FULL read response (no truncation)
import { createHash } from "node:crypto";

const COMPANY_ID = process.env.TRCLOUD_JPS_COMPANY_ID;
const PASSKEY    = process.env.TRCLOUD_JPS_PASSKEY;
const ENC_HEAD   = process.env.TRCLOUD_JPS_ENCRYPT_HEAD;
const ORIGIN     = process.env.TRCLOUD_JPS_ORIGIN ?? "https://pooil.trcloud.co";
const BASE       = "https://pooil.trcloud.co/application/api-connector2/end-point";

function auth() {
  const t = Math.floor(Date.now() / 1000);
  return { company_id: COMPANY_ID, passkey: PASSKEY, timestamp: t, securekey: createHash("md5").update(`${ENC_HEAD}t${t}`).digest("hex") };
}
async function post(path, payload) {
  const body = new URLSearchParams({ json: JSON.stringify({ ...auth(), ...payload }) });
  const res  = await fetch(`${BASE}/${path}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: ORIGIN }, body: body.toString() });
  const raw  = await res.text();
  let data = null; try { data = JSON.parse(raw); } catch {}
  return { status: res.status, data, raw };
}

const today = new Date().toISOString().slice(0, 10);
const stamp = String(Math.floor(Date.now() / 1000)).slice(-6);

// 1. Create contact
const cRes = await post("contact/create.php", { date: today, group_code: "S", code_number: "", name: `TEST LDG2 ${stamp}`, organization: `ทดสอบ2 ${stamp}`, branch: "00000", address: "-", email: "", telephone: "", tax_id: `09977${stamp}22`, contact_type: "normal", contact_for: "buy" });
const contactId   = cRes.data?.id ?? cRes.data?.doc;
const contactCode = (cRes.data?.last ?? "").replace(/^\D+/, "");
console.log("contact:", contactId, cRes.data?.last);

// 2. Create AP with acc_code
const apRes = await post("ap/create.php", {
  issue_date: today, due_date: today, tax_date: today,
  company_format: "JPS_AP", document_number: "", payment_term: "0",
  reference: `LDGTEST2-${stamp}`, discount: "0", wht: "0",
  tax_option: "in", tax_report: "1", type: "Cash[AP]", approve_status: "wait",
  department: "JPS_00001", project: "AMAZON-001-สาขาเทศบาลจักราช",
  invoice_note: `[TEST2 ${stamp}] ค่าไฟ acc_code check — ลบได้`,
  customer: { group_code: "S", code_number: contactCode, name: `TEST LDG2 ${stamp}`, organization: `ทดสอบ2 ${stamp}`, branch: "00000", address: "-", email: "", telephone: "", tax_id: `09977${stamp}22`, contact_type: "normal", contact_id: contactId, add_contact: "0" },
  product: [{ product_id: "JPS-101", product: `ค่าไฟฟ้า ทดสอบ2 ${stamp}`, price: "214.95", quantity: "1", vat: "7", acc_code: "5220020" }],
});
const apId = apRes.data?.id ?? apRes.data?.doc;
console.log("AP id:", apId, "| no:", apRes.data?.last ?? apRes.data?.document_number);

// 3. Read FULL — no truncation
const back = await post("ap/read.php", { id: apId });
console.log("\n=== FULL ap/read RESPONSE ===");
console.log(back.raw);
console.log("=== END ===\n");

// Pretty print key fields
try {
  const d = JSON.parse(back.raw);
  const head = d.head ?? d;
  const products = d.product ?? d.head?.product ?? d.items ?? [];
  console.log("head.company_format:", head.company_format);
  console.log("head.tax_option:", head.tax_option);
  console.log("head.type:", head.type);
  console.log("head.department:", head.department);
  console.log("head.project:", head.project);
  console.log("head.total:", head.total, "| grand_total:", head.grand_total);
  console.log("\nproduct lines:", JSON.stringify(products, null, 2));
  if (Array.isArray(products) && products[0]) {
    console.log("\n🔑 line[0].acc_code =", products[0].acc_code ?? "(ไม่มี field นี้)");
  }
} catch(e) { console.log("parse error:", e.message); }

// 4. Cleanup
await post("ap/delete.php", { id: apId });
await post("contact/delete.php", { id: contactId, contact_id: contactId });
console.log("\ncleanup done.");
