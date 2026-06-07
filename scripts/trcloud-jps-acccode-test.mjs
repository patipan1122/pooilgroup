// scripts/trcloud-jps-acccode-test.mjs
// ทดสอบ: ap/create บน company 45 (JPS GROUP) ด้วย acc_code บน AP line
// คำถามหลัก: TRCloud บันทึก GL จาก acc_code ที่เราส่งไป หรือสูตร JPS_AP override?
//
// Run: node --env-file=.env.local scripts/trcloud-jps-acccode-test.mjs
// Cleanup: ลบ AP + Contact test ทั้งหมด (ไม่ลบ JPS-101 SKU เพราะใช้ของจริง)

import { createHash } from "node:crypto";

const COMPANY_ID = process.env.TRCLOUD_JPS_COMPANY_ID;   // 45
const PASSKEY    = process.env.TRCLOUD_JPS_PASSKEY;
const ENC_HEAD   = process.env.TRCLOUD_JPS_ENCRYPT_HEAD;
const ORIGIN     = process.env.TRCLOUD_JPS_ORIGIN ?? "https://pooil.trcloud.co";
const BASE       = "https://pooil.trcloud.co/application/api-connector2/end-point";

if (!COMPANY_ID || !PASSKEY || !ENC_HEAD) {
  console.error("❌ ขาด TRCLOUD_JPS_* env vars ใน .env.local");
  process.exit(1);
}

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
const ok   = (d) => d && (d.success === 1 || d.success === "1" || d.success === true || (typeof d.HTTP === "string" && d.HTTP.startsWith("2")));
const pick = (o, ...ks) => { if (!o) return null; for (const k of ks) { const v = o[k]; if (v != null && String(v).trim()) return String(v); } return null; };

const stamp = String(Math.floor(Date.now() / 1000)).slice(-6);
const today = new Date().toISOString().slice(0, 10);

console.log(`\n${"=".repeat(60)}`);
console.log("TRCloud JPS company 45 — acc_code test");
console.log(`company_id=${COMPANY_ID} | enc_head=${ENC_HEAD} | passkey=***${String(PASSKEY).slice(-4)}`);
console.log(`${"=".repeat(60)}\n`);

// ── 1) ยืนยัน JPS-101 มีอยู่จริงใน company 45 ──
console.log("[1] ค้นหา JPS-101 ใน inventory …");
const skuRes = await post("inventory/search.php", { keyword: "JPS-101", limit: "5" });
console.log("  status:", skuRes.status);
console.log("  raw:", skuRes.raw.slice(0, 400));
// หา product_id จริงจาก search result
const skuList = skuRes.data?.data ?? skuRes.data?.result ?? [];
const jps101  = Array.isArray(skuList) ? skuList.find(p => String(p.product_id ?? p.code ?? "").includes("JPS-101")) : null;
const jps101Id = jps101 ? (jps101.product_id ?? jps101.code ?? "JPS-101") : "JPS-101";
console.log("  JPS-101 found:", jps101Id, jps101 ? `(system id: ${jps101.id ?? "?"})` : "(ไม่พบ — จะลองส่งตรง)");

// ── 2) สร้าง vendor ทดสอบ ──
console.log("\n[2] contact/create.php (vendor ทดสอบ — ลบตอนจบ) …");
const cRes = await post("contact/create.php", {
  date: today, group_code: "S", code_number: "", name: `TEST LEDGERLINE ${stamp}`,
  organization: `ทดสอบระบบ ${stamp}`, branch: "00000", address: "-",
  email: "", telephone: "", tax_id: `09988${stamp}11`, contact_type: "normal", contact_for: "buy",
});
console.log("  →", cRes.status, cRes.raw.slice(0, 300));
const cInner    = cRes.data?.data ?? cRes.data?.head ?? cRes.data;
const contactId = pick(cInner, "contact_id", "id") ?? pick(cRes.data, "contact_id", "id");
const contactCode = pick(cInner, "last", "title", "code_number") ?? pick(cRes.data, "last", "title", "code_number");
console.log("  contactId =", contactId, "| code =", contactCode);

// ── 3) สร้าง AP — คำถามหลัก: acc_code="5220020" จะถูก honor ไหม? ──
console.log("\n[3] ap/create.php — ค่าไฟ 214.95 บาท (VAT-in) acc_code=5220020 …");
const apPayload = {
  issue_date: today, due_date: today, tax_date: today,
  company_format: "JPS_AP",       // ✅ custom format ของ JP Sync
  document_number: "",             // auto-run
  payment_term: "0",
  reference: `LDGTEST-${stamp}`,
  discount: "0", wht: "0",
  tax_option: "in",                // ✅ VAT-inclusive (แบบที่ JP Sync ใช้จริง)
  tax_report: "1",                 // include in ภพ.30 (ค่าไฟขอคืนได้)
  type: "Cash[AP]",                // จ่ายแล้ว (CFO แนะนำ)
  approve_status: "wait",          // draft เสมอ
  department: "JPS_00001",         // BU code จาก live AP docs
  project: "AMAZON-001-สาขาเทศบาลจักราช",   // สาขา (branch = project field)
  invoice_note: `[TEST LedgerLine ${stamp}] ค่าไฟฟ้า - ทดสอบ acc_code — ลบได้`,
  customer: {
    group_code: "S",
    code_number: (contactCode ?? "").replace(/^\D+/, ""),
    name: `TEST LEDGERLINE ${stamp}`,
    organization: `ทดสอบระบบ ${stamp}`,
    branch: "00000", address: "-", email: "", telephone: "",
    tax_id: `09988${stamp}11`, contact_type: "normal",
    contact_id: contactId ?? "0",
    add_contact: contactId ? "0" : "1",
  },
  product: [{
    product_id: jps101Id,           // JPS-101 ซื้อบริการ
    product: `ค่าไฟฟ้า - ทดสอบ acc_code ${stamp}`,
    price: "214.95",
    quantity: "1",
    vat: "7",
    acc_code: "5220020",            // 🔑 ค่าไฟฟ้า GL — นี่คือสิ่งที่ทดสอบ
  }],
};
console.log("  payload (product line):", JSON.stringify(apPayload.product, null, 2));
const apRes  = await post("ap/create.php", apPayload);
console.log("  status:", apRes.status);
console.log("  raw (full):", apRes.raw.slice(0, 600));
const apInner = apRes.data?.data ?? apRes.data?.head ?? apRes.data;
const apId    = pick(apInner, "id", "document_id") ?? pick(apRes.data, "id");
const apNo    = pick(apInner, "document_number", "no") ?? pick(apRes.data, "document_number", "no");
console.log("  AP id =", apId, "| AP no =", apNo, "| success =", ok(apRes.data));

// ── 4) READ BACK — ดู acc_code กลับมาไหม + journal entries ──
if (apId) {
  console.log("\n[4] ap/read.php — ตรวจว่า acc_code ถูก save กลับมา …");
  const back = await post("ap/read.php", { id: apId });
  console.log("  status:", back.status);
  console.log("  raw (full):", back.raw.slice(0, 1500));

  // พยายามหา acc_code และ journal entries ใน response
  const docData = back.data?.data ?? back.data?.head ?? back.data;
  const lines   = docData?.product ?? docData?.lines ?? docData?.items ?? [];
  if (Array.isArray(lines) && lines.length > 0) {
    console.log("\n  📋 Product lines:");
    lines.forEach((l, i) => console.log(`    [${i}]`, JSON.stringify(l)));
    const lineAccCode = lines[0]?.acc_code;
    console.log("\n  🔑 acc_code บน line[0] =", lineAccCode ?? "(ไม่มีใน response)");
    if (lineAccCode === "5220020") {
      console.log("  ✅ acc_code HONORED — TRCloud รับ GL จาก line.acc_code ได้");
    } else if (lineAccCode) {
      console.log("  ⚠️  acc_code มีค่า แต่เปลี่ยนเป็น", lineAccCode, "— สูตร JPS_AP อาจ override");
    } else {
      console.log("  ❓ acc_code ไม่ return กลับมาใน read — ต้องตรวจใน TRCloud UI");
    }
  }

  // หา journal entries ถ้ามี
  const journals = docData?.journal ?? docData?.journal_entries ?? docData?.journals ?? docData?.accounting ?? [];
  if (Array.isArray(journals) && journals.length > 0) {
    console.log("\n  📒 Journal entries:");
    journals.forEach((j, i) => console.log(`    [${i}]`, JSON.stringify(j)));
  } else {
    console.log("\n  📒 ไม่มี journal_entries ใน ap/read response");
    console.log("  → ต้องตรวจ Dr/Cr ใน TRCloud UI: เปิดเอกสาร AP no.", apNo, "→ ดูสมุดรายวัน");
  }
}

// ── 5) CLEANUP — ลบ AP + Contact test (ไม่แตะ JPS-101 SKU) ──
console.log("\n[5] cleanup …");
if (apId) {
  const delAp = await post("ap/delete.php", { id: apId });
  console.log("  ap/delete:", delAp.raw.slice(0, 200), ok(delAp.data) ? "✅" : "⚠️");
}
if (contactId) {
  const delC = await post("contact/delete.php", { id: contactId, contact_id: contactId });
  console.log("  contact/delete:", delC.raw.slice(0, 200), ok(delC.data) ? "✅" : "⚠️");
}

console.log("\nDONE.");
console.log("\n📌 สรุป:");
console.log(`  AP no.     = ${apId ? apNo + " (ลบแล้ว)" : "ไม่สำเร็จ"}`);
console.log(`  ต้องทำต่อ  = ถ้า acc_code ไม่ return → เปิด TRCloud UI ดู AP ก่อนลบ`);
