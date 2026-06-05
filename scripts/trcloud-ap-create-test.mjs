// scripts/trcloud-ap-create-test.mjs — ONE test AP: create → read-back → DELETE (cleanup).
// Run: node --env-file=.env.local scripts/trcloud-ap-create-test.mjs
// Purpose: learn the create RESPONSE shape — does it return the AP doc id + the new
// contact_id (so LedgerLine can store them for dedup)? tax_report=0 (kept out of the
// VAT report) + immediate delete so the shared test company stays clean.
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
  let json = null; try { json = JSON.parse(raw); } catch {}
  return { status: res.status, json, raw };
}
function today(offset = 0) {
  const d = new Date(Date.now() + offset * 86400000);
  return d.toISOString().slice(0, 10);
}

const payload = {
  issue_date: today(),
  due_date: today(30),
  tax_date: today(),
  company_format: "AP",
  document_number: "", // autorun
  payment_term: "30",
  reference: "LEDGER-TEST",
  discount: "0",
  wht: "0",
  tax_option: "ex",
  tax_report: "0", // keep OUT of the VAT report (this is a throwaway test)
  type: "Credit[AP]",
  approve_status: "wait",
  invoice_note: "TEST ระบบบัญชี (LedgerLine) — auto-created by probe, safe to delete",
  customer: {
    group_code: "S",
    code_number: "",
    name: "ทดสอบ LedgerLine",
    organization: "ร้านทดสอบ LedgerLine (ลบได้)",
    branch: "00000",
    address: "-",
    email: "",
    telephone: "",
    tax_id: "0000000000000",
    contact_type: "normal",
    contact_id: "0",
    add_contact: "1",
  },
  product: [
    { product_id: "LEDGER-TEST", product: "รายการทดสอบ LedgerLine", price: "100", quantity: "1", vat: "7" },
  ],
};

console.log("=== 1) CREATE ap/create.php ===");
const created = await post("ap/create.php", payload);
console.log("status:", created.status);
console.log("raw:", created.raw.slice(0, 1200));

// Try to find the new doc id in the response (probe several shapes).
const j = created.json ?? {};
const docId =
  j.id ?? j.document_id ?? j?.data?.id ?? j?.head?.id ?? j?.response?.id ?? null;
const contactId =
  j.contact_id ?? j?.customer?.contact_id ?? j?.data?.contact_id ?? j?.head?.contact_id ?? null;
console.log("\nparsed docId:", docId, "| parsed contactId:", contactId);

if (docId) {
  console.log("\n=== 2) READ BACK ap/read.php id=" + docId + " ===");
  const back = await post("ap/read.php", { id: String(docId) });
  console.log("raw:", back.raw.slice(0, 1500));

  console.log("\n=== 3) DELETE ap/delete.php id=" + docId + " (cleanup) ===");
  const del = await post("ap/delete.php", { id: String(docId) });
  console.log("status:", del.status, "raw:", del.raw.slice(0, 400));
} else {
  console.log("\n⚠️ could not parse a doc id — NOT deleting. Inspect raw above; manual cleanup may be needed.");
}
