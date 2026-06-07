// Read each known project code from TRCloud company 45
import { createHash } from "node:crypto";
const C=process.env.TRCLOUD_JPS_COMPANY_ID, P=process.env.TRCLOUD_JPS_PASSKEY, E=process.env.TRCLOUD_JPS_ENCRYPT_HEAD;
const BASE="https://pooil.trcloud.co/application/api-connector2/end-point", ORIGIN="https://pooil.trcloud.co";
function auth(){const t=Math.floor(Date.now()/1000);return{company_id:C,passkey:P,timestamp:t,securekey:createHash("md5").update(E+"t"+t).digest("hex")};}
async function post(path,p={}){
  const b=new URLSearchParams({json:JSON.stringify({...auth(),...p})});
  const r=await fetch(BASE+"/"+path,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded",Origin:ORIGIN},body:b.toString()});
  return JSON.parse(await r.text());
}

const PROJECT_CODES = [
  "62 STATION-001-สาขา หลังโลตัสหัวทะเล",
  "AMAZON-001-สาขาเทศบาลจักราช",
  "ANAZON-002 สาขา ชุมชนหัวทะเล",
  "B-0001-พื่นที่ให้เช่า ข้างปั้ม 62 สเตชั่น",
  "DOLL-000-สาขา ปตท.ชุมพวง",
  "DOLL-001-สาขา ปตท.แคนดง",
  "DOLL-002-สาขา ปตท.ลำทะเมนชัย",
  "DOLL-003-สาขา ปตท.โนนคอย",
  "DOLL-004-สาขา ปตท.โนนแดง",
  "DOLL-005-สาขา ปตท.เมืองยาง",
  "DOLL-006-สาขา ปตท.ประทาย",
  "DOLL-008-เก็บรายวัน",
  "DOLL-009-ต่างอำเภอ",
  "DOLL-010-รายสัปดาห์",
  "Hotel_001-โรงแรม MIX",
  "Massage Chair",
  "MRWOOF-001-สาขา ปตท.โนนแดง",
  "OWLCHA-001-สาขา ปตท.โนนคอย",
  "OWLCHA-002-สาขา ปตท.ชุมพวง",
  "OWLCHA-003OWLCHA-003-สาขา ปตท.พิมาย",
  "OWLCHA-004-สาขา ปตท.ลำทะเมนชัย",
  "OWLCHA-005-สาขา ปตท.รังกาใหญ่",
  "PUNTHAI-001-สาขา โคกสูง 2",
  "SNOWDIP-001-สาขา ปตท.แคนดง",
  "SNOWDIP-002-สาขา ปตท..ตลาดแค",
  "Swen-001-สาขา ปตท.โนนคอย จักราช",
  "ลูกชิ้นไจ้แอน-จักราช",
  "ลูกชิ้นไจ้แอน-ชุมพวง",
  "ลูกชิ้นไจ้แอน-ตลาดแค1",
  "ลูกชิ้นไจ้แอน-ตลาดแค2",
  "ลูกชิ้นไจ้แอน-โนนแดง",
];

console.log("=== TRCloud project/read — ทุก project ใน company 45 ===\n");
const results = [];
for(const code of PROJECT_CODES){
  try {
    const r = await post("project/read.php", { project_code: code });
    const d = r.data ?? r.head ?? r;
    results.push({ code, department: d?.department ?? d?.dept ?? "(ไม่มี)", name: d?.name ?? d?.project_name ?? "", raw_keys: Object.keys(d||{}).join(",") });
    console.log(`[${code}]`);
    console.log(`  department = ${d?.department ?? "(ไม่มี)"}`);
    console.log(`  name = ${d?.name ?? d?.project_name ?? ""}`);
    console.log(`  keys: ${Object.keys(d||{}).slice(0,12).join(", ")}`);
    // show full first result to understand schema
    if(code === PROJECT_CODES[0]) console.log("  FULL:", JSON.stringify(r).slice(0,800));
    console.log();
  } catch(e) { console.log(`[${code}] ERROR: ${e.message}\n`); }
  await new Promise(r=>setTimeout(r,120)); // rate limit
}

console.log("\n=== SUMMARY TABLE ===");
console.log("Project Code | Department");
console.log("-------------|----------");
results.forEach(r=>console.log(`${r.code} | ${r.department}`));
