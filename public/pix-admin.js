"use strict";
const pixKinds={cpf:"CPF",cnpj:"CNPJ",email:"E-mail",phone:"Celular",random:"Chave aleatória",payload:"Pix Copia e Cola"};
async function pixList(cursor) {
  const data=await api("/pix-links"+(cursor?"?cursor="+cursor:""));
  if(page!=="pix"||me?.role!=="ADMIN")return;
  app.innerHTML='<section class="panel"><h1>Links Pix</h1><button id="pix-new">Gerar novo link Pix</button><h2>Lojas cadastradas</h2><div id="pix-stores"></div></section>';
  on("pix-new","click",()=>pixForm());
  const stores=document.querySelector("#pix-stores");
  if(!data.items.length)stores.textContent="Nenhuma loja cadastrada.";
  for(const r of data.items){const btn=document.createElement("button");btn.type="button";btn.className="secondary";btn.textContent=r.store;btn.onclick=()=>pixDetail(r.id).catch(e=>message(e.message,true));stores.append(btn);}
  if(data.next){stores.insertAdjacentHTML("afterend",'<button id="pix-next">Próxima página</button>');on("pix-next","click",()=>pixList(data.next));}
  if(cursor){stores.insertAdjacentHTML("afterend",'<button id="pix-first">Voltar ao início</button>');on("pix-first","click",()=>pixList());}
}
async function pixDetail(id) {
  const r=await api("/pix-links/"+id);
  if(page!=="pix"||me?.role!=="ADMIN")return;
  app.innerHTML=`<section class="panel narrow"><h1>${esc(r.store)}</h1><p>Recebedor: <strong>${esc(r.recipient)}</strong></p><label>${esc(pixKinds[r.kind])}<textarea readonly>${esc(r.pix_value)}</textarea></label><label>Link permanente para a NFC<input id="pix-url" readonly value="${esc(r.url)}"></label><button id="pix-copy-link">Copiar link para a NFC</button> <a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">Abrir página Pix</a><p><button class="secondary" id="pix-edit">Editar</button> <button class="secondary" id="pix-back">Voltar às lojas</button></p></section>`;
  on("pix-copy-link","click",async()=>{try{await navigator.clipboard.writeText(r.url);message("Link copiado.");}catch{document.querySelector("#pix-url").select();message("Use Copiar no menu do celular.");}});
  on("pix-edit","click",()=>pixForm(r));on("pix-back","click",()=>pixList());
}
function pixForm(r={}) {
  app.innerHTML=`<section class="panel narrow"><h1>${r.id?"Editar dados Pix":"Gerar novo link Pix"}</h1><form id="pix-form"><label>Nome da loja (somente no painel)<input name="store" maxlength="120" required value="${esc(r.store)}"></label><label>Nome do recebedor conforme o banco<input name="recipient" maxlength="120" required value="${esc(r.recipient)}"></label><label>Tipo de dado Pix<select name="kind" required><option value="">Selecione</option>${Object.entries(pixKinds).map(([v,l])=>`<option value="${v}" ${v===r.kind?"selected":""}>${l}</option>`).join("")}</select></label><label>Chave ou código do banco<textarea name="pix_value" required maxlength="1024" spellcheck="false" autocapitalize="none">${esc(r.pix_value)}</textarea></label><p class="hint">Um endereço https:// não é um código Pix. Para uso contínuo, peça uma chave ou um código estático reutilizável sem valor. Quem tiver o link poderá ver e copiar o dado informado.</p>${r.id?'<label>Confirme sua senha de ADMIN<input name="current_password" type="password" autocomplete="current-password" required></label>':""}<button>${r.id?"Salvar alteração":"Gerar link Pix"}</button></form><button class="secondary" id="pix-cancel">Cancelar</button></section>`;
  on("pix-cancel","click",()=>r.id?pixDetail(r.id):pixList());
  on("pix-form","submit",async e=>{const b=values(e);if(r.id&&!confirm("Atualizar a placa de "+b.store+"?\nRecebedor: "+b.recipient+"\n"+pixKinds[b.kind]+": "+b.pix_value+"\nO link já gravado continuará o mesmo."))return;
    const result=await api("/pix-links"+(r.id?"/"+r.id:""),r.id?"PATCH":"POST",{...b,version:r.version});await pixDetail(result.id);message(r.id?"Dados Pix atualizados.":"Link Pix criado.");});
}
