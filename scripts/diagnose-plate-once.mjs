// Read-only incident diagnostic. Never print email, tokens, credentials or rows.
import {createHash} from 'node:crypto';
const hash = x => createHash('sha256').update(x).digest('hex');
const emailHash = '831fc30d8316a35444f7ff953a565005ccffc89a02b75fd4d5db99f463bab5a4';
const qrHash = '1e744b4f70471441110d29d6f6d6172b31405952a646cdbe7a10b3690dccd78e';
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!account || !/^[a-f0-9]{32}$/.test(account) || !token) throw Error('Missing diagnostic credentials');
async function query(sql,params=[]) {
  if(!sql.startsWith('SELECT ')) throw Error('Only SELECT permitted');
  const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/bc6f8a86-9019-4fbb-ba3f-eaaf79d5378e/query`,{
    method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({sql,params}),signal:AbortSignal.timeout(15000)
  });
  if(!r.ok) throw Error(`D1 read failed HTTP ${r.status}`);
  const b=await r.json(); if(!b.success || !b.result?.[0]?.success) throw Error('D1 read failed');
  return b.result[0].results;
}
try {
  const plates=await query('SELECT p.id,p.code,p.token,p.physical_code,p.status,p.blocked,p.owner_id,p.batch_id,b.generation_state,b.archived_at,b.is_test,b.product FROM plates p JOIN batches b ON b.id=p.batch_id WHERE p.physical_code=? OR p.code=?',['A0810-H64P','A00025']);
  const users=await query('SELECT id,email,role,commercial_type,state,archived_at,must_change_password FROM users WHERE substr(lower(email),1,3)=?',['102']);
  const matches=users.filter(u=>hash(u.email.toLowerCase().trim())===emailHash);
  if(matches.length!==1) {console.log(JSON.stringify({diagnostic:{userMatches:matches.length,plateRows:plates.length}}));process.exit(0);}
  const u=matches[0];
  const output={user:{role:u.role,type:u.commercial_type,state:u.state,archived:!!u.archived_at,mustChangePassword:!!u.must_change_password},plates:[]};
  for(const p of plates){
    const [a]=await query('SELECT COUNT(*) AS allocations,COALESCE(SUM(quantity),0) AS quantity,COALESCE(SUM(consumed),0) AS consumed,COALESCE(SUM(quantity-consumed),0) AS available FROM allocations WHERE user_id=? AND batch_id=? AND product=?',[u.id,p.batch_id,p.product]);
    output.plates.push({matchesPrintedCode:p.physical_code==='A0810-H64P',matchesPhotoQR:hash(p.code+'-'+p.token)===qrHash,status:p.status,blocked:!!p.blocked,assigned:!!p.owner_id,assignedToTarget:p.owner_id===u.id,batch:{state:p.generation_state,archived:!!p.archived_at,test:!!p.is_test,product:p.product},allocation:a});
  }
  console.log('PLATE_DIAGNOSTIC '+JSON.stringify(output));
}catch{console.error('Diagnostic failed; no data was written.');process.exitCode=1;}
