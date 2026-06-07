// probe TRCloud company 45 — find department + project master lists
import { createHash } from "node:crypto";
const C=process.env.TRCLOUD_JPS_COMPANY_ID, P=process.env.TRCLOUD_JPS_PASSKEY, E=process.env.TRCLOUD_JPS_ENCRYPT_HEAD;
const BASE="https://pooil.trcloud.co/application/api-connector2/end-point", ORIGIN="https://pooil.trcloud.co";
function auth(){const t=Math.floor(Date.now()/1000);return{company_id:C,passkey:P,timestamp:t,securekey:createHash("md5").update(E+"t"+t).digest("hex")};}
async function post(path,p={}){
  try {
    const b=new URLSearchParams({json:JSON.stringify({...auth(),...p})});
    const r=await fetch(BASE+"/"+path,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded",Origin:ORIGIN},body:b.toString()});
    const raw=await r.text();
    return {status:r.status,raw:raw.slice(0,600)};
  } catch(e) { return {status:"ERR",raw:e.message}; }
}

const paths = [
  "department/search.php",
  "department/list.php",
  "department/read.php",
  "setup/department.php",
  "project/search.php",
  "project/list.php",
  "project/read.php",
  "setup/project.php",
  "staff/department.php",
  "hr/department.php",
];

console.log("=== TRCloud company 45 — department/project master probe ===\n");
for(const path of paths){
  const r=await post(path,{limit:"100",start:"0"});
  const preview=r.raw.replace(/\s+/g," ").slice(0,200);
  const ok = r.status===200 && !r.raw.includes('"success":0') && !r.raw.includes('"success":"0"') && !r.raw.startsWith("<!") && r.raw.length>10;
  console.log(`[${ok?"✅":"❌"}] ${path} → HTTP ${r.status} | ${preview}`);
}
