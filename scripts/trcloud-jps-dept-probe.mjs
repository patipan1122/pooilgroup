// probe unique department + project codes in company 45
import { createHash } from "node:crypto";
const C=process.env.TRCLOUD_JPS_COMPANY_ID, P=process.env.TRCLOUD_JPS_PASSKEY, E=process.env.TRCLOUD_JPS_ENCRYPT_HEAD;
const BASE="https://pooil.trcloud.co/application/api-connector2/end-point", ORIGIN="https://pooil.trcloud.co";
function auth(){const t=Math.floor(Date.now()/1000);return{company_id:C,passkey:P,timestamp:t,securekey:createHash("md5").update(E+"t"+t).digest("hex")};}
async function post(path,payload){const b=new URLSearchParams({json:JSON.stringify({...auth(),...payload})});const r=await fetch(BASE+"/"+path,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded",Origin:ORIGIN},body:b.toString()});return JSON.parse(await r.text());}
const r=await post("ap/search.php",{limit:"100",start:"0"});
const docs=r.result??r.data??r.head??[];
const depts=new Map(), projs=new Set();
docs.forEach(d=>{
  if(d.department) depts.set(d.department, (depts.get(d.department)||0)+1);
  if(d.project) projs.add(d.project);
});
console.log("Total docs:", docs.length);
console.log("\nDepartment codes (code: count):");
[...depts.entries()].sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>console.log(" ",k,":",v));
console.log("\nAll unique projects:");
[...projs].sort().forEach(p=>console.log(" ",p));
