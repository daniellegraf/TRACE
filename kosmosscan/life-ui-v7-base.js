/* KOSMOSSCAN LIFE V7 — society map and language analysis, enhanced by v7 instrument panel. */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const canvas=$('society-canvas');if(!canvas)return;
const ctx=canvas.getContext('2d',{alpha:false});
if(!ctx){$('society-status').textContent='GRAFIKFEL';return;}
const WW=180,WH=112,DOMAINS=['Signaler','Samarbete','Verktyg','Skydd','Odling','Symboler','Handel','Organisation','Material','Energi','Optik','Beräkning','Astronomi','Navigation','Automation','Framdrift'];
let worker=null,active=false,running=false,snapshot=null,selected=null,cityDetail=null,messageSelected=null,mode='society';
let languageFilter='alla',lastInfo=0,lastInspect=0,lastEvent='',requestID=0,paintQueued=false,worldSeed=1,fastResearch=false;
const topocanvas=document.createElement('canvas');topocanvas.width=WW;topocanvas.height=WH;
const topctx=topocanvas.getContext('2d');
const fmt=v=>Math.round(+v||0).toLocaleString('sv-SE');
const put=(id,val)=>{const el=$(id);if(el)el.textContent=String(val);};
function node(type,cls,value){const e=document.createElement(type);if(cls)e.className=cls;if(value!==undefined)e.textContent=String(value);return e;}
function empty(e){while(e.firstChild)e.removeChild(e.firstChild);}
function status(s,on){put('society-status',s);$('society-status').classList.toggle('running',!!on);}
function log(s,t){const box=$('society-log'),item=node('div','society-log-entry');item.append(node('b','', 'T+'+fmt(t||0)),node('span','',s));box.prepend(item);while(box.children.length>12)box.lastChild.removeChild(box.lastChild);}
function report(s){put('society-analysis',s);}
function background(seed){
 const img=topctx.createImageData(WW,WH);
 for(let y=0;y<WH;y++)for(let x=0;x<WW;x++){
  const field=Math.sin(x*.069+seed*.00000007)*.39+Math.cos(y*.083)*.28+Math.sin((x+y)*.039)*.19+Math.sin(x*.15-y*.12)*.17;
  const co=field<-.38?[12,38,60]:field<.05?[13,49,56]:field<.35?[21,54,47]:[47,57,56];
  const v=Math.sin(x*1.31+y*.79)*3+4,z=(y*WW+x)*4;
  img.data[z]=co[0]+v;img.data[z+1]=co[1]+v;img.data[z+2]=co[2]+v;img.data[z+3]=255;
 }
 topctx.putImageData(img,0,0);
}
function size(){
 const rect=canvas.getBoundingClientRect(),w=Math.max(1,rect.width),h=Math.max(1,rect.height),r=Math.min(1.6,window.devicePixelRatio||1);
 const cw=Math.round(w*r),ch=Math.round(h*r);
 if(canvas.width!==cw||canvas.height!==ch){canvas.width=cw;canvas.height=ch;}
 ctx.setTransform(r,0,0,r,0,0);return {w,h};
}
function label(x,y,text,focus,w,h){
 ctx.font=focus?'bold 11px system-ui':'10px system-ui';ctx.textAlign='left';
 const width=ctx.measureText(text).width+12,xx=Math.min(w-width-3,Math.max(3,x)),yy=Math.max(16,Math.min(h-3,y));
 ctx.fillStyle=focus?'rgba(12,56,55,.94)':'rgba(4,21,34,.83)';
 ctx.fillRect(xx-4,yy-12,width,17);
 ctx.fillStyle=focus?'#d6ffef':'#c7d9df';ctx.fillText(text,xx,yy);
}
function cityShape(city,w,h){
 const x=city.x/WW*w,y=city.y/WH*h,sel=selected===city.id;
 const rad=6+city.level*1.15;
 ctx.beginPath();ctx.arc(x,y,rad*2.5,0,Math.PI*2);
 ctx.fillStyle='hsla('+city.hue+',75%,65%,'+(sel?.2:.065)+')';ctx.fill();
 ctx.lineWidth=sel?2:1;ctx.strokeStyle=sel?'#d7fff2':'hsla('+city.hue+',90%,72%,.7)';
 ctx.beginPath();ctx.arc(x,y,rad,0,Math.PI*2);ctx.stroke();
 const unit=rad*.24;
 if(city.level<3){
  ctx.fillStyle='#64b8ac';ctx.beginPath();ctx.moveTo(x,y-unit*2.7);ctx.lineTo(x+unit*2,y+unit*2);ctx.lineTo(x-unit*2,y+unit*2);ctx.closePath();ctx.fill();
 }else{
  for(let i=-1;i<=1;i++){
   ctx.fillStyle=i===0?'#c3f6e9':'#78aeb3';
   ctx.fillRect(x+i*unit*2.4-unit,y-unit*(3+i+3),unit*2,unit*(4+i+3));
  }
 }
 return{x,y,rad};
}
function drawMap(){
 if(!ctx)return;
 const sz=size(),w=sz.w,h=sz.h;ctx.drawImage(topocanvas,0,0,w,h);
 ctx.fillStyle='rgba(3,15,26,.2)';ctx.fillRect(0,0,w,h);
 if(!snapshot){
  ctx.font='13px system-ui';ctx.fillStyle='#a7cbd0';ctx.textAlign='center';
  ctx.fillText('Starta livsfröet för att väcka en ny värld',w/2,h/2);return;
 }
 const sites=snapshot.sites||[],samp=snapshot.sample||[];
 const citiesById=new Map(sites.map(s=>[s.id,s]));
 ctx.strokeStyle='rgba(116,208,177,.20)';ctx.lineWidth=1;
 for(const road of snapshot.paths||[]){
  const a=citiesById.get(road[0]),b=citiesById.get(road[1]);if(!a||!b)continue;
  ctx.beginPath();ctx.moveTo(a.x/WW*w,a.y/WH*h);ctx.lineTo(b.x/WW*w,b.y/WH*h);ctx.stroke();
 }
 if(mode==='life'){
  for(let i=0;i<samp.length;i+=4){
   const hue=samp[i+2]*360/11;
   ctx.fillStyle='hsla('+hue+',75%,76%,.60)';
   ctx.fillRect(samp[i]/255*w,samp[i+1]/255*h,1.65,1.65);
  }
 }else{
  ctx.fillStyle='rgba(149,209,196,.18)';
  for(let i=0;i<samp.length;i+=12){ctx.fillRect(samp[i]/255*w,samp[i+1]/255*h,1,1);}
 }
 const ranked=[...sites].sort((a,b)=>b.level-a.level);
 const titles=new Set(ranked.slice(0,w<600?5:12).map(s=>s.id));if(selected)titles.add(selected);
 for(const city of sites){
  const loc=cityShape(city,w,h);
  if(titles.has(city.id)){
   const caption=city.name.length>17?city.name.slice(0,15)+'…':city.name;
   label(loc.x+loc.rad+4,loc.y-loc.rad-2,caption,selected===city.id,w,h);
  }
 }
 for(const ship of snapshot.craft||[]){
  const x=ship.x/WW*w,y=ship.y/WH*h;
  ctx.save();ctx.translate(x,y);ctx.rotate(ship.progress*TAU);
  ctx.fillStyle='#ffe0a8';ctx.beginPath();ctx.moveTo(0,-7);ctx.lineTo(5,5);ctx.lineTo(0,2);ctx.lineTo(-5,5);ctx.closePath();ctx.fill();ctx.restore();
 }
 ctx.fillStyle='#b6e7da';ctx.font='10px ui-monospace,monospace';ctx.textAlign='left';
 ctx.fillText('SAMHÄLLEN '+fmt(sites.length)+' • ORGANISMER '+fmt(snapshot.metrics.count),11,19);
}
const TAU=Math.PI*2;
function stats(){
 if(!snapshot)return;const m=snapshot.metrics;
 const items={'society-pop':fmt(m.count),'society-rate':(+m.rate||0).toLocaleString('sv-SE',{maximumFractionDigits:1})+'/s',
 'society-cities':fmt(m.cities),'society-inventions':fmt(m.inventions),
 'society-messages-total':fmt(m.messages),'society-space':fmt(m.launchCount),
 'society-gen':fmt(m.gen),'society-cells':fmt(m.cells),
 'society-teaching':fmt(m.teaching),'society-updates':fmt(m.updates)+'/s'};
 for(const [id,val] of Object.entries(items))put(id,val);
 put('society-step','STEG '+fmt(m.ticks));
 put('society-processing',fmt(m.progress)+' / '+fmt(m.progressTotal));
}
function translate(m){
 const container=$('society-translation');empty(container);
 container.append(node('b','',m.clanName+' • '+m.purpose+' • steg '+fmt(m.tick)));
 container.append(node('div','society-alien-quote',m.text));
 container.append(node('p','',m.meaning));
 container.append(node('small','society-disclaimer','Symbolerna är ett konstruerat simulatorspråk. Betydelsen är känd från händelsen som skapade meddelandet; detta är inte en oberoende dechiffrering.'));
}
function listMessages(){
 const root=$('society-messages');if(!snapshot)return;empty(root);
 const msgs=(snapshot.messages||[]).filter(m=>languageFilter==='alla'||m.purpose===languageFilter).slice(0,20);
 if(!msgs.length){root.append(node('p','society-empty','Inga meddelanden i den kategorin ännu.'));return;}
 for(const m of msgs){
  const button=node('button','society-msg');button.type='button';
  if(m.id===messageSelected)button.classList.add('selected');
  button.append(node('b','',m.clanName+' · '+m.purpose),node('span','',m.text));
  button.addEventListener('click',()=>{messageSelected=m.id;translate(m);listMessages();});
  root.append(button);
 }
 if(!msgs.some(m=>m.id===messageSelected)){messageSelected=msgs[0].id;translate(msgs[0]);}
}
function listDiscoveries(){
 const root=$('society-discoveries');empty(root);if(!snapshot)return;
 const items=(snapshot.discoveries||[]).slice(0,15);
 if(!items.length){root.append(node('p','society-empty','Ingen kombinationsuppfinning har skapats ännu.'));return;}
 for(const item of items){
  const button=node('button','society-invention');button.type='button';
  button.append(node('b','',item.name),node('small','',item.detail+' · komplexitet '+item.complexity));
  button.addEventListener('click',()=>report('UPPFINNING #'+item.id+': '+item.name+'\n\n'+item.detail+'\nSkapad under steg '+item.tick+'.\nDelar: '+item.parts.join(' + ')+'.\nKomplexitetsindex: '+item.complexity+'.\nFaktiska funktionskrav i verkligheten är inte verifierade.'));
  root.append(button);
 }
}
function cityOptions(){
 const sel=$('society-city-select'),sites=snapshot?.sites||[];
 if(sel.options.length-1!==sites.length){
  while(sel.options.length>1)sel.remove(1);
  for(const city of sites){const op=document.createElement('option');op.value=city.id;op.textContent=city.name+' · nivå '+city.level;sel.append(op);}
 }
 if(!selected&&sites.length){selected=sites[0].id;inspect();}
 if(selected)sel.value=String(selected);
}
function inspect(){if(!worker||!selected)return;lastInspect=Date.now();worker.postMessage({type:'inspect',id:selected,request:++requestID});}
function selectCity(id){
 selected=+id||null;cityDetail=null;
 if(selected){$('society-city-select').value=String(selected);inspect();}
 else renderDetail();
 drawMap();
}
function renderDetail(){
 const root=$('society-city-detail');empty(root);
 if(!cityDetail){root.append(node('p','society-empty','Välj en bosättning på kartan eller i listan för att studera dess språk, bibliotek och uppfinningar.'));return;}
 const c=cityDetail;
 root.append(node('h4','',c.name+' · nivå '+c.level));
 root.append(node('p','',c.clanName+' · '+fmt(c.people)+' gruppmedlemmar · '+fmt(c.discoveries)+' uppfinningar'));
 const grid=node('div','society-detail-grid');
 for(const [key,val] of Object.entries({Byggnader:c.structures,Bibliotek:c.library,Verkstäder:c.workshops,Kraftverk:c.power,Material:Math.round(c.resources.material),Språkändringar:c.language})){
  const item=node('div','');item.append(node('small','',key),node('b','',val));grid.append(item);
 }root.append(grid);
 root.append(node('p','society-dialect','Ord ur samhällets symbolförråd: '+(c.languageWords||[]).slice(0,9).join(' · ')));
 const btn=node('button','society-action','✦ ANALYSERA SAMHÄLLET');btn.type='button';btn.addEventListener('click',()=>analyze(c));root.append(btn);
 root.append(node('h5','', 'Samhällets senaste uppfinningar'));
 if(!(c.recentInventions||[]).length)root.append(node('p','society-empty','Inga uppfinningar ännu.'));
 for(const inv of (c.recentInventions||[]).slice(0,8)){
  const line=node('div','society-detail-invention');line.append(node('strong','',inv.name),node('span','',inv.detail));root.append(line);
 }
}
function analyze(c){
 const structures=['byggnader: '+c.structures,'bibliotek: '+c.library,'verkstäder: '+c.workshops,'kraftverk: '+c.power].join(', ');
 const top=(c.tech||[]).map((v,i)=>({v,name:DOMAINS[i]})).sort((a,b)=>b.v-a.v).filter(x=>x.v>.15).slice(0,7).map(x=>x.name).join(', ')||'tidig samverkan';
 const examples=(c.recentInventions||[]).slice(0,5).map(v=>v.name+' ('+v.parts.join(' + ')+')').join('; ')||'inga ännu';
 const comm=(c.messages||[]).slice(0,4).map(m=>m.meaning).join(' ')||'inga nya registrerade';
 report('SAMHÄLLSANALYS: '+c.name.toUpperCase()+'\n\n'+
 'Grupp: '+c.clanName+' med '+fmt(c.people)+' medlemmar. Stadsnivå: '+c.level+'.\n'+
 'Institutioner: '+structures+'.\n'+
 'Dokumenterade kunskapsområden: '+top+'.\n'+
 'Framtagna kombinationer: '+examples+'.\n'+
 'Språk: '+c.language+' förändringshändelser, exempelord '+c.languageWords.slice(0,7).join(', ')+'.\n'+
 'Senaste budskap: '+comm+'.\n\n'+
 'Slutsats: Dessa framsteg representerar registrerade regler och interaktioner i en konstgjord värld. De kan visa samordning och teknisk komplexitet, men är inte bevis för medvetande eller praktiskt fungerande fysik.');
}
function events(){
 const root=$('society-log'),rows=(snapshot?.events||[]).filter(x=>x.kind!=='start').slice(0,10);
 const key=rows.map(x=>x.tick+':'+x.description).join('|');if(key===lastEvent)return;lastEvent=key;
 empty(root);
 for(const e of rows){const line=node('div','society-log-entry');line.append(node('b','','T+'+fmt(e.tick)),node('span','',e.description));root.append(line);}
}
function update(){
 if(!snapshot)return;stats();
 const t=Date.now();
 if(t-lastInfo>1150){
  lastInfo=t;cityOptions();listMessages();listDiscoveries();events();
  if(selected&&t-lastInspect>2300)inspect();
 }
 if(!paintQueued){paintQueued=true;requestAnimationFrame(()=>{paintQueued=false;drawMap();});}
}
function openWorker(){
 if(worker){worker.terminate();worker=null;}
 if(typeof Worker==='undefined')throw Error('Din webbläsare stöder inte Web Workers.');
 worker=new Worker('./life-worker-v7.js');
 worker.onerror=()=>{running=false;status('MOTORFEL',false);log('Livsmotorns JavaScript kunde inte läsas. Prova Safari/Chrome direkt.');};
 worker.onmessage=event=>{
  const m=event.data||{};
  if(typeof CustomEvent!=='undefined')window.dispatchEvent(new CustomEvent('kosmosv7:message',{detail:m}));
  if(m.type==='ready'){worldSeed=m.seed;background(worldSeed);status('LIVET UTVECKLAS',true);log(m.restored?'Värld återställd från sparning.':'Livsfrö '+m.seed+' har aktiverats.');running=true;}
  else if(m.type==='frame'){snapshot=m;update();}
  else if(m.type==='detail'&&m.request===requestID){cityDetail=m.city;renderDetail();}
  else if(m.type==='error'){running=false;status('BERÄKNINGSFEL',false);log(m.message);}
  else if(m.type==='paused'){running=false;status('PAUSAD',false);}
  else if(m.type==='journal'){
   try{
    const json=JSON.stringify(m.data,null,2);
    const blob=new Blob([json],{type:'application/json;charset=utf-8'});
    const uri=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=uri;a.download='KOSMOSSCAN_forskningsjournal_'+(m.data.seed||'world')+'.json';
    a.style.display='none';document.body.appendChild(a);a.click();
    setTimeout(()=>{a.remove();URL.revokeObjectURL(uri);},1600);
    log('Forskningsjournalen har genererats med uppfinningarnas föräldra-ID och händelser.');
   }catch(error){log('Kunde inte spara forskningsjournalen: '+error.message);}
  }
  else if(m.type==='speed'){fastResearch=m.value===4;$('society-fast').textContent=fastResearch?'⚡ FORSKNING ×4 AKTIV':'⚡ SNABBARE FORSKNING ×4';$('society-fast').classList.toggle('active',fastResearch);}
 };
}
window.KosmosV7Bridge={
 send(payload){if(worker)worker.postMessage(payload);},
 getWorker(){return worker;},
 latest(){return snapshot;},
 running(){return running;},
 restoreWorld(data){
  try{
   openWorker();active=true;running=true;fastResearch=false;snapshot=null;selected=null;cityDetail=null;
   lastInfo=0;lastInspect=0;lastEvent='';messageSelected=null;requestID=0;
   $('society-pause').disabled=false;$('society-pause').textContent='⏸ PAUSA';
   $('society-fast').disabled=false;$('society-start').textContent='↻ NYTT LIVSFRÖ';
   status('ÅTERSTÄLLER VÄRLD…',true);worker.postMessage({type:'restore',data});
  }catch(err){status('ÅTERSTÄLLNINGSFEL',false);log(err.message);}
 }
};
function start(){
 try{
  openWorker();active=true;running=true;fastResearch=false;snapshot=null;selected=null;cityDetail=null;lastInfo=0;lastInspect=0;lastEvent='';messageSelected=null;requestID=0;
  empty($('society-log'));empty($('society-messages'));empty($('society-translation'));empty($('society-discoveries'));
  while($('society-city-select').options.length>1)$('society-city-select').remove(1);
  report('Välj en bosättning och tryck på Analysera samhället. Här kan du studera språk, teknik och historiska upptäckter.');
  $('society-start').textContent='↻ NYTT LIVSFRÖ';
  $('society-pause').disabled=false;$('society-pause').textContent='⏸ PAUSA';
  $('society-fast').disabled=false;$('society-fast').textContent='⚡ SNABBARE FORSKNING ×4';$('society-fast').classList.remove('active');
  status('VÄCKER LIV…',true);worker.postMessage({type:'start'});renderMap();renderDetail();
 }catch(e){running=false;status('KUNDE INTE STARTA',false);log(e.message);}
}
$('society-start').addEventListener('click',start);
$('society-pause').addEventListener('click',()=>{
 if(!active||!worker)return;
 running=!running;worker.postMessage({type:running?'resume':'pause'});
 $('society-pause').textContent=running?'⏸ PAUSA':'▶ FORTSÄTT';status(running?'SAMHÄLLEN VÄXER':'PAUSAD',running);
});
$('society-fast').addEventListener('click',()=>{
 if(!worker||!active)return;
 worker.postMessage({type:'setSpeed',fast:!fastResearch});
});
$('society-map-view').addEventListener('click',()=>{mode='society';$('society-map-view').classList.add('active');$('society-life-view').classList.remove('active');drawMap();});
$('society-life-view').addEventListener('click',()=>{mode='life';$('society-life-view').classList.add('active');$('society-map-view').classList.remove('active');drawMap();});
$('society-city-select').addEventListener('change',e=>selectCity(e.target.value));
$('society-message-filter').addEventListener('change',e=>{languageFilter=e.target.value;messageSelected=null;listMessages();});
$('society-global-analysis').addEventListener('click',()=>{
 if(cityDetail)analyze(cityDetail);
 else{
  const m=snapshot?.metrics;
  if(!m)report('Starta simuleringen först.');
  else report('GLOBAL ANALYS\n\n'+fmt(m.count)+' organismer, '+fmt(m.cities)+' städer, '+fmt(m.inventions)+' uppfinningar och '+fmt(m.messages)+' symbolmeddelanden. När en stad har grundats kan du välja den och läsa en mer detaljerad analys.');
 }
});
$('society-export').addEventListener('click',()=>{
 if(!worker||!active){report('Starta livsfröet innan du exporterar.');return;}
 worker.postMessage({type:'export'});
});
$('society-copy').addEventListener('click',async()=>{
 try{await navigator.clipboard.writeText($('society-analysis').textContent);$('society-copy').textContent='KOPIERAT';}
 catch(e){$('society-copy').textContent='KAN INTE KOPIERA';}
});
canvas.addEventListener('pointerdown',e=>{
 if(!snapshot||!worker)return;
 const r=canvas.getBoundingClientRect(),x=(e.clientX-r.left)/r.width*WW,y=(e.clientY-r.top)/r.height*WH;
 let found=null,best=Infinity;
 for(const s of snapshot.sites||[]){
  const dist=((s.x-x)/WW*r.width)**2+((s.y-y)/WH*r.height)**2;
  if(dist<best){best=dist;found=s;}
 }
 if(found&&best<1000)selectCity(found.id);
 else{worker.postMessage({type:'addFood',x,y});log('Extra näring lades till.');}
});
window.addEventListener('resize',drawMap,{passive:true});
background(1);drawMap();renderDetail();
})();
