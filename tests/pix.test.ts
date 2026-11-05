import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fixture } from "./operations.test";
import { pixValue } from "../src/pix";
import { hashPassword } from "../src/security";

test("Pix: validates each type and checksum, retains the exact bank payload",()=>{
 const part=(k:string,s:string)=>k+String(s.length).padStart(2,"0")+s;
 const base="000201"+part("26",part("00","br.gov.bcb.pix")+part("01","teste@example.org"))+"5204000053039865802BR"+part("59","TESTE")+part("60","PORTO ALEGRE")+"6304";
 let crc=65535;for(const c of base){crc^=c.charCodeAt(0)<<8;for(let i=0;i<8;i++)crc=((crc<<1)^((crc&32768)?4129:0))&65535;}
 const payload=base+crc.toString(16).toUpperCase().padStart(4,"0");
 assert.equal(pixValue("payload",payload),payload);
 assert.throws(()=>pixValue("payload",payload.slice(0,-4)+"0000"));
 assert.throws(()=>pixValue("payload","https://bank.example/checkout"));
 assert.equal(pixValue("cpf","529.982.247-25"),"52998224725");
 assert.throws(()=>pixValue("cpf","529.982.247-26"));
 assert.equal(pixValue("cnpj","11.222.333/0001-81"),"11222333000181");
 assert.equal(pixValue("cnpj","12.ABC.345/01DE-35"),"12ABC34501DE35");
 assert.equal(pixValue("phone","(51) 99999-1234"),"+5551999991234");
 assert.equal(pixValue("random","f15c05ed-54ff-4fe6-adde-e1c55b398fa3"),"f15c05ed-54ff-4fe6-adde-e1c55b398fa3");
 assert.equal(pixValue("email","teste@example.org"),"teste@example.org");
});
test("Pix: ADMIN-only management; public NFC URL survives edits; private data excluded from list, audit and HTML",async()=>{
 const f=await fixture();
 f.db.sql.exec(readFileSync(new URL("../migrations/0004_pix_links.sql",import.meta.url),"utf8"));
 const pw="Test-only-strong-password";
 f.db.sql.prepare("UPDATE users SET password_hash=? WHERE id='admin'").run(await hashPassword(pw,f.env.PASSWORD_PEPPER));
 const api="/api/pix-links", b={store:"Loja privada",recipient:"Nome <teste>",kind:"email",pix_value:"first@example.org"};
 for(const who of ["seller-a","seller-b","anonymous"]){
  for(const [path,method] of [[api,"GET"],[api,"POST"],[api+"/1","GET"],[api+"/1","PATCH"]]){
   const r=await f.call(path,method,method==="GET"?undefined:b,who);
   assert.equal(r.r.status,who==="anonymous"?401:403);
  }
 }
 const created=await f.call(api,"POST",b);assert.equal(created.r.status,201);
 const path=api+"/"+created.b.id;
 const detail=(await f.call(path)).b;
 assert.match(detail.url,/^https:\/\/app\.geargo\.com\.br\/pix\/[\da-f]{48}$/);
 const publicPath=new URL(detail.url).pathname;
 const first=await f.call(publicPath,"GET",undefined,"anonymous");
 assert.equal(first.r.status,200);assert.match(first.b,/Nome &lt;teste&gt;/);
 assert.match(first.b,/Copiar chave Pix/);assert.doesNotMatch(first.b,/Loja privada/);
 assert.equal(first.r.headers.get("cache-control"),"no-store"); assert.match(first.r.headers.get("x-robots-tag")!,/noindex/);
 const list=(await f.call(api)).b;assert.deepEqual(list.items,[{id:created.b.id,store:b.store}]);
 const edit={...b,recipient:"Novo recebedor",pix_value:"new@example.org",version:1};
 assert.equal((await f.call(path,"PATCH",{...edit,current_password:"errada"})).r.status,403);
 assert.equal((await f.call(path,"PATCH",{...edit,current_password:pw})).r.status,200);
 assert.equal((await f.call(path,"PATCH",{...edit,current_password:pw})).r.status,409);
 assert.equal((await f.call(path)).b.url,detail.url);
 const updated=await f.call(publicPath,"GET",undefined,"anonymous");assert.match(updated.b,/new@example.org/);assert.doesNotMatch(updated.b,/first@example.org/);
 assert.equal((await f.call("/pix/1","GET",undefined,"anonymous")).r.status,404);
 const logs=JSON.stringify(f.db.sql.prepare("SELECT * FROM audit_log WHERE entity_type='pix_link'").all());
 assert.doesNotMatch(logs,/example.org|Loja privada|Novo recebedor/);assert.ok(!logs.includes(publicPath.slice(5)));
});
