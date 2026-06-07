// Read each project and extract the 'category' field + full schema from first result
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

// Show full schema of first project
const first = await post("project/read.php", { project_code: PROJECT_CODES[0] });
console.log("=== FULL SCHEMA (first project) ===");
console.log(JSON.stringify(first.result ?? first, null, 2));
console.log("\n=== ALL PROJECTS: category field ===\n");

const rows = [];
for(const code of PROJECT_CODES){
  const r = await post("project/read.php", { project_code: code });
  const d = r.result ?? {};
  rows.push({ code, category: d.category ?? "", name: d.project_name ?? "" });
  await new Promise(r=>setTimeout(r,120));
}

// Group by category
const byCategory = new Map();
rows.forEach(({code, category, name})=>{
  if(!byCategory.has(category)) byCategory.set(category,[]);
  byCategory.get(category).push({code, name});
});

console.log("ประเภทธุรกิจ (category) → สาขา (project codes)\n");
[...byCategory.entries()].sort().forEach(([cat, projects])=>{
  console.log(`[${cat || "(ไม่มี category)"}]`);
  projects.forEach(p=>console.log(`  → ${p.code}`));
  console.log();
});
