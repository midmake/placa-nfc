document.querySelector("#copy").onclick=async()=>{
  const field=document.querySelector("#value"), status=document.querySelector("#feedback");
  try { await navigator.clipboard.writeText(field.value); status.textContent="Copiado. Abra o aplicativo do seu banco."; }
  catch {field.focus();field.select();status.textContent="Selecione Copiar no menu do seu celular.";}
};
