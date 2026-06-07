// Map department → projects from live AP docs
import { createHash } from "node:crypto";
const C=process.env.TRCLOUD_JPS_COMPANY_ID, P=process.env.TRCLOUD_JPS_PASSKEY, E=process.env.TRCLOUD_JPS_ENCRYPT_HEAD;
const BASE="https://pooil.trcloud.co/application/api-connector2/end-point", ORIGIN="https://pooil.trcloud.co";
function auth(){const t=Math.floor(Date.now()/1000);return{company_id:C,passkey:P,timestamp:t,securekey:createHash("md5").update(E+"t"+t).digest("hex")};}
async function post(path,p){const b=new URLSearchParams({json:JSON.stringify({...auth(),...p})});const r=await fetch(BASE+"/"+path,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded",Origin:ORIGIN},body:b.toString()});return JSON.parse(await r.text());}

// Map: dept → Set of projects seen with it
const map = new Map();
for(let start=0; start<=200; start+=100){
  const r=await post("ap/search.php",{limit:"100",start:String(start)});
  const docs=r.result??[];
  if(!docs.length) break;
  docs.forEach(d=>{
    const dept=d.department||"(none)", proj=d.project||"(none)";
    if(!map.has(dept)) map.set(dept, new Set());
    map.get(dept).add(proj);
  });
}
console.log("\n=== Department → Projects mapping ===\n");
[...map.entries()].sort((a,b)=>b[1].size-a[1].size).forEach(([dept,projs])=>{
  console.log(`[${dept}] (${projs.size} projects):`);
  [...projs].sort().forEach(p=>console.log(`   ${p}`));
  console.log();
});
