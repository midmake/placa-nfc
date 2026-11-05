// Administrative audit is already scoped and paginated on the server.
const chartClock = new Intl.DateTimeFormat("en-GB", {
  timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",hourCycle:"h23"
});
function chartTime(date) {
  const f=Object.fromEntries(chartClock.formatToParts(date).map(p=>[p.type,p.value]));
  return {day:Date.UTC(+f.year,+f.month-1,+f.day), hour:+f.hour};
}
function mountActivationChart(panel) {
  if(!panel || me?.role!=="ADMIN") return;
  panel.innerHTML='<h2>Ritmo de ativações</h2><p class="hint">Ativações reais por dia da semana ou hora, no horário de Brasília. O horário é o da ativação da placa.</p><div class="chart-controls"><label>Período<select id="chart-days"><option value="7">Últimos 7 dias</option><option value="30" selected>Últimos 30 dias</option><option value="90">Últimos 90 dias</option></select></label><label>Agrupar por<select id="chart-group"><option value="day">Dia da semana</option><option value="hour">Hora do dia</option></select></label></div><div id="chart-output" aria-live="polite"></div>';
  const period=panel.querySelector("#chart-days"),group=panel.querySelector("#chart-group"),out=panel.querySelector("#chart-output");
  let revision=0,counts=null;
  function draw(){
    if(!counts)return;
    const daily=group.value==="day", bars=daily?counts.days:counts.hours, max=Math.max(...bars);
    const labels=daily?["Seg","Ter","Qua","Qui","Sex","Sáb","Dom"]:bars.map((_,i)=>String(i).padStart(2,"0")+"h");
    out.replaceChildren();
    const summary=document.createElement("p");
    summary.textContent=counts.total?counts.total+" ativações no período. Pico: "+labels.filter((_,i)=>bars[i]===max).join(", ")+" ("+max+").":"Nenhuma ativação real registrada neste período.";
    out.append(summary);if(!max)return;
    bars.forEach((n,i)=>{
      if(!daily&&!n)return;
      const row=document.createElement("div");row.className="activation-bar";
      const label=document.createElement("span"), bar=document.createElement("progress"), value=document.createElement("strong");
      label.textContent=labels[i];bar.max=max;bar.value=n;bar.setAttribute("aria-label",labels[i]+": "+n+" ativações");value.textContent=String(n);
      row.append(label,bar,value);out.append(row);
    });
  }
  async function load(){
    const request=++revision,current=()=>panel.isConnected && revision===request && me?.role==="ADMIN";
    const now=new Date(),cut=chartTime(now).day-(Number(period.value)-1)*86400000;
    const bucket={days:Array(7).fill(0),hours:Array(24).fill(0),total:0};
    counts=null;out.textContent="Carregando ativações…";
    let cursor=null;
    try{
      do{
        const query=new URLSearchParams({category:"activations"});if(cursor) query.set("before",String(cursor));
        const data=await api("/audit?"+query);if(!current())return;
        let older=false;
        for(const entry of data.entries){
          const date=new Date(entry.created_at);
          if(!Number.isFinite(+date)) continue;
          const {day,hour}=chartTime(date);
          if(day<cut){older=true;continue;}
          if(date>now||entry.action!=="activated"||entry.entity_type!=="plate")continue;
          const info=typeof entry.new_data==="string"?JSON.parse(entry.new_data):entry.new_data;
          if(info?.is_test!==false && info?.is_test!==0)continue;
          bucket.days[(new Date(day).getUTCDay()+6)%7]++;bucket.hours[hour]++;bucket.total++;
        }
        if(older||!data.next_before)break;
        if(cursor!==null && Number(data.next_before)>=cursor)throw Error();
        cursor=Number(data.next_before);
      }while(current());
      if(current()){counts=bucket;draw();}
    }catch{if(current())out.textContent="Não foi possível carregar o histórico. Tente novamente alterando o período.";}
  }
  period.onchange=load;group.onchange=draw;load();
}
