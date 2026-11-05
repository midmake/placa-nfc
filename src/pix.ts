import { admin, audit, body, fail, guard, json, mutate, text, type Env, type Row, type User } from "./core";
import { randomToken } from "./security";
import { reauthenticate } from "./professional";

const invalid = (): never => fail(400,"Confira o tipo e o dado Pix. Cole uma chave válida ou o código Pix Copia e Cola completo do banco, não um endereço de site.");
function taxId(s:string, corporate:boolean) {
  const n = s.toUpperCase().replace(/[./-]/g,"");
  if (!(corporate ? /^[0-9A-Z]{12}[0-9]{2}$/ : /^[0-9]{11}$/).test(n)) return invalid();
  if (n.length !== (corporate ? 14 : 11) || /^(\d)\1+$/.test(n)) return invalid();
  for(let i=n.length-2;i<n.length;i++) {
    let sum=0;
    for(let j=0;j<i;j++) sum+=(n.charCodeAt(j)-48)*(corporate ? ((i-j-1)%8)+2 : i+1-j);
    if(Number(n[i]) !== (11-sum%11)%11%10) return invalid();
  }
  return n;
}
function fields(s:string) {
  const out=new Map<string,string>();
  for(let i=0;i<s.length;) {
    if(!/^\d{4}/.test(s.slice(i))) return invalid();
    const tag=s.slice(i,i+2), size=Number(s.slice(i+2,i+4)); i+=4;
    if(!size || i+size>s.length || out.has(tag)) return invalid();
    out.set(tag,s.slice(i,i+size)); i+=size;
  }
  return out;
}
export function pixValue(kind:string,raw:unknown) {
  const s=text(raw,"Dado Pix",1024);
  if(kind==="cpf" || kind==="cnpj") return taxId(s,kind==="cnpj");
  if(kind==="email" && s.length<=77 && /^[^\s@/:]+@[^\s@/:]+\.[^\s@/:]+$/.test(s)) return s;
  if(kind==="phone" && /^\+?[\d() .-]+$/.test(s)) {
    let n=s.replace(/\D/g,"");
    if(!s.startsWith("+") && /^\d{10,11}$/.test(n)) n="55"+n;
    if(/^55[1-9]\d9\d{8}$/.test(n) || (s.startsWith("+")&&!n.startsWith("55")&&/^[1-9]\d{7,14}$/.test(n))) return "+"+n;
  }
  if(kind==="random" && /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(s)) return s.toLowerCase();
  if(kind==="payload" && raw===s && /^[\x20-\x7e]+$/.test(s) && /^000201/.test(s) && /6304[\dA-F]{4}$/i.test(s)) {
    let crc=0xffff;
    for(const c of s.slice(0,-4)) {
      crc^=c.charCodeAt(0)<<8;
      for(let bit=0;bit<8;bit++) crc=((crc<<1)^((crc&0x8000)?0x1021:0))&0xffff;
    }
    const f=fields(s);
    const pix=[...f].filter(([k])=>Number(k)>=26&&Number(k)<=51).map(([,v])=>fields(v)).filter(m=>m.get("00")?.toLowerCase()==="br.gov.bcb.pix");
    if(crc===parseInt(s.slice(-4),16) && pix.length===1 && (pix[0].get("01")||pix[0].get("25")) && f.get("53")==="986" && f.get("58")==="BR" && f.get("59") && f.get("60")) return s;
  }
  return invalid();
}
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
export async function publicPix(req:Request, env:Env,path:string) {
  const match=/^\/pix\/([0-9a-f]{48})$/.exec(path);
  if(!match || !["GET","HEAD"].includes(req.method)) fail(404,"Página Pix não encontrada.");
  const row=await env.DB.prepare("SELECT recipient,kind,pix_value FROM pix_links WHERE public_id=?").bind(match[1]).first<Row>();
  if(!row) fail(404,"Página Pix não encontrada.");
  const payload=row.kind==="payload";
  const html=`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>Dados para Pix · Gear Go</title><link rel="stylesheet" href="/pix-public.css"><link rel="stylesheet" href="/pix-feedback.css"><script defer src="/pix-copy.js"></script></head><body><main><p class="brand">GEAR GO DIGITAL</p><h1>Pagamento via Pix</h1><p>Recebedor informado</p><h2>${escape(row.recipient)}</h2><label for="value">${payload?"Pix Copia e Cola":"Chave Pix"}</label><textarea id="value" readonly spellcheck="false">${escape(row.pix_value)}</textarea><button id="copy" data-copied-text="${payload?"Código Pix copiado":"Chave Pix copiada"}">${payload?"Copiar código Pix":"Copiar chave Pix"}</button><p role="status" class="pix-copy-feedback" id="feedback"></p><small>No aplicativo do seu banco, escolha ${payload?"Pix Copia e Cola":"pagar com chave Pix"}. Confira o nome do recebedor antes de confirmar.</small></main></body></html>`;
  return new Response(req.method==="HEAD"?null:html,{headers:{"Content-Type":"text/html; charset=utf-8","X-Robots-Tag":"noindex, nofollow, noarchive"}});
}
export async function adminPix(req:Request,env:Env,user:User,path:string) {
  admin(user);
  const m=/^\/api\/pix-links(?:\/([1-9]\d{0,14}))?$/.exec(path);
  if(!m) fail(404,"Cadastro Pix não encontrado.");
  const db=env.DB, id=m[1];
  if(req.method==="GET" && !id) {
    const before=Number(new URL(req.url).searchParams.get("cursor")||Number.MAX_SAFE_INTEGER);
    if(!Number.isSafeInteger(before)||before<=0) fail(400,"Página inválida.");
    const rows=(await db.prepare("SELECT id,store FROM pix_links WHERE id<? ORDER BY id DESC LIMIT 51").bind(before).all<Row>()).results;
    return json({items:rows.slice(0,50),next:rows.length>50?rows[49].id:null});
  }
  if(req.method==="GET" && id) {
    const row=await db.prepare("SELECT * FROM pix_links WHERE id=?").bind(id).first<Row>();
    if(!row) fail(404,"Cadastro Pix não encontrado.");
    const { public_id,...data }=row;
    return json({...data,url:"https://app.geargo.com.br/pix/"+public_id});
  }
  if(!(req.method==="POST"&&!id || req.method==="PATCH"&&id)) fail(405,"Método não permitido.");
  const b=await body(req), store=text(b.store,"Loja",120), recipient=text(b.recipient,"Recebedor",120), kind=text(b.kind,"Tipo",12), value=pixValue(kind,b.pix_value);
  if(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(store+recipient)) fail(400,"Nome inválido.");
  if(id) {
    await reauthenticate(req,env,user,b);
    if(!Number.isSafeInteger(b.version)) fail(400,"Versão inválida.");
    await mutate(db,[db.prepare("UPDATE pix_links SET store=?,recipient=?,kind=?,pix_value=?,version=version+1 WHERE id=? AND version=?").bind(store,recipient,kind,value,id,b.version),guard(db),audit(db,user,"pix_link",id,"pix_updated",null,null)]);
    return json({id:Number(id)});
  }
  const token=randomToken(24);
  const [created]=await db.batch([db.prepare("INSERT INTO pix_links(public_id,store,recipient,kind,pix_value) VALUES(?,?,?,?,?) RETURNING id").bind(token,store,recipient,kind,value),db.prepare("INSERT INTO audit_log(actor_id,entity_type,entity_id,action) SELECT ?,'pix_link',id,'pix_created' FROM pix_links WHERE public_id=?").bind(user.id,token)]);
  return json({id:(created.results[0] as Row).id},201);
}
