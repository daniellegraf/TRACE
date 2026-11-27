/* KOSMOSSCAN V9 — individual ecology camera and causally driven civilization scene. */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const canvas=$('society-canvas');if(!canvas)return;
const ctx=canvas.getContext('2d',{alpha:false});
if(!ctx){$('society-status').textContent='GRAFIKFEL';return;}
const WW=180,WH=112,DOMAINS=['Signaler','Samarbete','Verktyg','Skydd','Odling','Symboler','Handel','Organisation','Material','Energi','Optik','Beräkning','Astronomi','Navigation','Automation','Framdrift'];
let worker=null,active=false,running=false,snapshot=null,selected=null,cityDetail=null,messageSelected=null,mode='life';
let languageFilter='alla',lastInfo=0,lastInspect=0,lastEvent='',requestID=0,paintQueued=false,worldSeed=1,fastResearch=false;
let lifeCam={x:140,y:65,zoom:4},growth=[],lastGrowthN=-1,followingBirth=false,drag=null;
const cameraBounds=()=>{
 const spanW=WW/lifeCam.zoom,spanH=WH/lifeCam.zoom;
 lifeCam.x=Math.max(spanW/2,Math.min(WW-spanW/2,lifeCam.x));
 lifeCam.y=Math.max(spanH/2,Math.min(WH-spanH/2,lifeCam.y));
 return{left:lifeCam.x-spanW/2,top:lifeCam.y-spanH/2,w:spanW,h:spanH};
};
function coords(x,y,w,h){
 if(mode!=='life')return{x:x/WW*w,y:y/WH*h};
 const c=cameraBounds();return{x:(x-c.left)/c.w*w,y:(y-c.top)/c.h*h};
}
function sendCamera(){
 cameraBounds();if(worker)worker.postMessage({type:'camera',view:{...lifeCam}});
 put('v8-zoom',lifeCam.zoom.toFixed(1)+'×');drawMap();
}

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
 const pt=coords(city.x,city.y,w,h),x=pt.x,y=pt.y;
 if(x< -80||y< -80||x>w+80||y>h+80)return null;
 const focus=selected===city.id;
 const zoom=mode==='life'?lifeCam.zoom:1;
 const homes=city.homes||2,other=(city.library||0)+(city.workshops||0)+(city.power||0)+(city.farms||0);
 const count=Math.min(28,Math.ceil(Math.log2(2+homes+other)*3.3));
 const r=Math.min(mode==='life'?46:26, (6+Math.log2(2+homes)*2.5)*Math.sqrt(zoom));
 ctx.beginPath();ctx.arc(x,y,r+4,0,Math.PI*2);
 ctx.fillStyle='hsla('+city.hue+',63%,64%,'+(focus?.16:.065)+')';ctx.fill();
 ctx.lineWidth=focus?2.3:1;ctx.strokeStyle=focus?'#e8fff0':'hsla('+city.hue+',75%,66%,.25)';
 ctx.stroke();
 // Each building icon represents an actual portion of the city stock.
 // The visible neighborhood expands with real city construction counters.
 for(let i=0;i<count;i++){
  const a=i*2.39996+(city.id*.27),rr=Math.sqrt(i+.65)/Math.sqrt(count+1)*r*.84;
  const px=x+Math.cos(a)*rr,py=y+Math.sin(a)*rr;
  const sq=mode==='life'?Math.max(2.8,3.9+.13*zoom):Math.max(1.4,1.8+r*.014);
  const cls=(i+city.style)%9;
  ctx.fillStyle=cls<3?'#a1d9c6':cls<6?'#72aebb':'#b6b8a3';
  ctx.fillRect(px-sq*.5,py-sq*.55,sq,sq*1.05);
  ctx.strokeStyle='rgba(3,27,33,.72)';ctx.lineWidth=.5;ctx.strokeRect(px-sq*.5,py-sq*.55,sq,sq*1.05);
  if(i<city.farms){ctx.fillStyle='#78d49b';ctx.fillRect(px-sq*.5,py+sq*.3,sq,sq*.4);}
  if(i<city.power){ctx.strokeStyle='#f4d596';ctx.beginPath();ctx.moveTo(px,py-sq);ctx.lineTo(px+sq*.3,py-sq*1.65);ctx.stroke();}
 }
 if(focus){ctx.fillStyle='#b9f9e0';ctx.font='bold 10px ui-monospace,monospace';ctx.textAlign='center';
  ctx.fillText((city.homes||0)+' HEM',x,y-r-8);}
 return{x,y,r};
}
function drawCreature(o,w,h){
 const pt=coords(o.x,o.y,w,h);
 if(pt.x< -32||pt.y< -32||pt.x>w+32||pt.y>h+32)return;
 const ns=o.nodes||[],n=ns.length,hue=(o.color||180);
 const r=Math.min(25,7+Math.sqrt(n)*3+Math.min(6,o.gen*.55));
 const norm=Math.max(1,...ns.map(z=>Math.hypot(z.x,z.y)+(z.r||0)));
 const scale=r/norm;
 ctx.save();ctx.translate(pt.x,pt.y);ctx.rotate((o.heading||0)*.6);
 const ca='hsla('+hue+',83%,72%,.78)';
 ctx.shadowBlur=10;ctx.shadowColor='hsla('+hue+',88%,65%,.55)';
 // Actual connected developmental nodes; no preset type shapes or random squares.
 for(let i=1;i<ns.length;i++){
  const v=ns[i],p=ns[v.parent]||ns[0];
  ctx.beginPath();ctx.moveTo((p.x||0)*scale,(p.y||0)*scale);
  ctx.lineTo(v.x*scale,v.y*scale);
  ctx.strokeStyle=ca;ctx.lineWidth=Math.max(.85,(v.r||.2)*scale*.65);ctx.stroke();
 }
 for(let i=0;i<ns.length;i++){
  const v=ns[i],xx=(v.x||0)*scale,yy=(v.y||0)*scale,rad=Math.max(2,(v.r||.25)*scale);
  ctx.beginPath();ctx.arc(xx,yy,rad,0,Math.PI*2);
  ctx.fillStyle='hsl('+(v.hue||hue)+',75%,'+(v.type==='sensor'?76:58)+'%)';ctx.fill();
  ctx.shadowBlur=0;
  if(v.type==='core'||v.type==='sensor'||v.type==='antenna'){
   ctx.beginPath();ctx.arc(xx,yy,Math.max(.9,rad*.36),0,Math.PI*2);
   ctx.fillStyle='#09283a';ctx.fill();
   if(v.type==='sensor'){ctx.beginPath();ctx.arc(xx-1,yy-1,1,0,Math.PI*2);ctx.fillStyle='#f3fff9';ctx.fill();}
  }
  if(v.type==='plate'){ctx.strokeStyle='#dafff3';ctx.lineWidth=1;ctx.stroke();}
  if(v.type==='fin'||v.type==='motor'){
   ctx.strokeStyle='rgba(160,255,222,.75)';ctx.lineWidth=1.2;
   ctx.beginPath();ctx.moveTo(xx,yy);ctx.lineTo(xx+Math.cos(i*2.4)*rad*1.7,yy+Math.sin(i*2.4)*rad*1.7);ctx.stroke();
  }
 }
 ctx.restore();
}
function drawMap(){
 if(!ctx)return;
 const {w,h}=size(),lens=mode==='life'?cameraBounds():null;
 if(lens){
  ctx.drawImage(topocanvas,Math.max(0,lens.left/WW*topocanvas.width),Math.max(0,lens.top/WH*topocanvas.height),
   Math.min(topocanvas.width, lens.w/WW*topocanvas.width),
   Math.min(topocanvas.height, lens.h/WH*topocanvas.height),0,0,w,h);
 }else ctx.drawImage(topocanvas,0,0,w,h);
 ctx.fillStyle='rgba(0,10,19,.16)';ctx.fillRect(0,0,w,h);
 if(!snapshot){
  ctx.textAlign='center';ctx.font='14px system-ui';ctx.fillStyle='#acd8d6';
  ctx.fillText('Väck livsfröet och se verkliga kroppar växa',w/2,h/2);
  return;
 }
 const sites=snapshot.sites||[],byID=new Map(sites.map(a=>[a.id,a]));
 const worldPoint=(a)=>coords(a.x,a.y,w,h);
 ctx.strokeStyle='rgba(120,226,178,.2)';ctx.lineWidth=1;
 for(const link of snapshot.paths||[]){
  const a=byID.get(link[0]),b=byID.get(link[1]);if(!a||!b)continue;
  const aa=worldPoint(a),bb=worldPoint(b);
  ctx.beginPath();ctx.moveTo(aa.x,aa.y);ctx.lineTo(bb.x,bb.y);ctx.stroke();
 }
 if(mode==='life'){
  // A high-fidelity lens: every rendered creature has its own developmental
  // anatomy. The HUD states precisely how many individuals are outside view.
  for(const o of snapshot.creatures||[])drawCreature(o,w,h);
  for(const birth of snapshot.births||[]){
   const p=coords(birth.x,birth.y,w,h);
   if(p.x<0||p.y<0||p.x>w||p.y>h)continue;
   ctx.strokeStyle='rgba(184,255,203,.48)';ctx.lineWidth=1.2;
   ctx.beginPath();ctx.arc(p.x,p.y,10+Math.sin(Date.now()/300+birth.id)*3,0,Math.PI*2);ctx.stroke();
  }
 }
 const ranked=[...sites].sort((a,b)=>(b.level*10+b.homes*.03)-(a.level*10+a.homes*.03));
 let renderSites=sites;
 if(mode==='society'&&sites.length>68){
  // EVERY real city contributes to a territorial district; only strongest
  // city glyphs are drawn individually to keep the map legible.
  const districts=new Map(),gridX=12,gridY=8;
  if(Array.isArray(snapshot.districts)){
   for(const d of snapshot.districts)if(d.cities>0)districts.set(d.x+d.y*gridX,d);
  }else{
   for(const c of sites){
    const cellX=Math.max(0,Math.min(gridX-1,Math.floor(c.x/WW*gridX)));
    const cellY=Math.max(0,Math.min(gridY-1,Math.floor(c.y/WH*gridY)));
    const key=cellX+cellY*gridX;
    const d=districts.get(key)||{x:cellX,y:cellY,cities:0,homes:0,level:0,hue:c.hue};
    d.cities++;d.homes+=c.homes||0;d.level=Math.max(d.level,c.level);districts.set(key,d);
   }
  }
  for(const d of districts.values()){
   const cx=(d.x+.5)*w/gridX,cy=(d.y+.5)*h/gridY;
   const rx=Math.min(w/gridX*.48,4+Math.sqrt(d.homes)*1.35);
   const ry=Math.min(h/gridY*.48,4+Math.sqrt(d.homes)*.85);
   ctx.save();ctx.fillStyle='hsla('+d.hue+',55%,55%,.15)';
   ctx.strokeStyle='hsla('+d.hue+',65%,69%,.3)';ctx.lineWidth=.8;
   ctx.beginPath();ctx.ellipse(cx,cy,rx,ry,0,0,TAU);ctx.fill();ctx.stroke();ctx.restore();
   if(d.cities>=5){
    ctx.fillStyle='rgba(196,252,231,.7)';ctx.font='9px ui-monospace,monospace';ctx.textAlign='center';
    ctx.fillText(d.cities+' BYAR',cx,cy+3);
   }
  }
  renderSites=ranked.slice(0,w<600?24:55);
  if(selected&&!renderSites.some(c=>c.id===selected)){
   const chosen=sites.find(c=>c.id===selected);if(chosen)renderSites.push(chosen);
  }
 }
 const titles=new Set(renderSites.slice(0,mode==='life'?2:(w<600?4:9)).map(a=>a.id));
 if(selected)titles.add(selected);
 for(const city of renderSites){
  const place=cityShape(city,w,h);
  if(place&&titles.has(city.id)){
   const name=city.name.length>16?city.name.slice(0,15)+'…':city.name;
   label(place.x+place.r+2,place.y-place.r-5,name,selected===city.id,w,h);
  }
 }
 for(const craft of snapshot.craft||[]){
  const p=worldPoint(craft);ctx.save();ctx.translate(p.x,p.y);
  ctx.rotate(craft.progress*TAU);ctx.beginPath();ctx.moveTo(0,-7);
  ctx.lineTo(5,4);ctx.lineTo(0,1);ctx.lineTo(-5,4);ctx.closePath();
  ctx.fillStyle='#ffe0ae';ctx.fill();ctx.restore();
 }
 const m=snapshot.metrics;
 ctx.fillStyle='rgba(3,24,35,.91)';ctx.fillRect(0,0,Math.min(w,440),49);
 ctx.fillStyle='#c4fff0';ctx.font='bold 13px ui-monospace,monospace';ctx.textAlign='left';
 ctx.fillText('LEVANDE '+fmt(m.count)+'   +'+fmt(m.births||0)+' FÖDDA',12,20);
 ctx.font='11px ui-monospace,monospace';ctx.fillStyle='#9cd2c8';
 ctx.fillText(mode==='life'?'SYNLIGA I LINSEN '+fmt(m.inView)+' · ZOOM '+lifeCam.zoom.toFixed(1)+'×':
  'BOSÄTTNINGAR '+fmt(m.cities)+' · HEM '+fmt(m.totalHomes||0),12,36);
}
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
 if(selected){$('society-city-select').value=String(selected);inspect();
  worker?.postMessage({type:'watchCity',id:selected});}
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
 const m=snapshot.metrics;
 put('v8-population',fmt(m.count));
 put('v8-born',fmt(m.births||0));
 put('v8-homes',fmt(m.totalHomes||0));
 put('v8-districts',fmt(m.cities));
 put('v8-in-view',fmt(m.inView)+' av '+fmt(m.count));
 put('v8-zoom',lifeCam.zoom.toFixed(1)+'×');
 if(m.count!==lastGrowthN){
  growth.push(m.count);lastGrowthN=m.count;if(growth.length>70)growth.shift();
 }
 const chart=$('v8-growth-canvas');
 if(chart&&growth.length>1){
  const c=chart.getContext('2d'),rect=chart.getBoundingClientRect(),cw=Math.max(1,rect.width),ch=Math.max(1,rect.height);
  const ratio=Math.min(1.5,window.devicePixelRatio||1);
  if(chart.width!==Math.round(cw*ratio)||chart.height!==Math.round(ch*ratio)){
   chart.width=Math.round(cw*ratio);chart.height=Math.round(ch*ratio);
  }
  c.setTransform(ratio,0,0,ratio,0,0);c.clearRect(0,0,cw,ch);
  const low=growth[0],hi=Math.max(low+1,growth[growth.length-1]);
  c.strokeStyle='#70f1bd';c.lineWidth=2;c.beginPath();
  growth.forEach((n,i)=>{const x=i/(growth.length-1)*cw,y=ch-5-(n-low)/(hi-low)*(ch-10);
   if(i===0)c.moveTo(x,y);else c.lineTo(x,y);
  });c.stroke();
 }

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
 worker=new Worker('./life-worker-v9.js');
 worker.onerror=()=>{running=false;status('MOTORFEL',false);log('Livsmotorns JavaScript kunde inte läsas. Prova Safari/Chrome direkt.');};
 worker.onmessage=event=>{
  const m=event.data||{};
  if(m.type==='ready'&&m.restored){lifeCam={x:140,y:65,zoom:4};}
  if(typeof CustomEvent!=='undefined')window.dispatchEvent(new CustomEvent('kosmosv7:message',{detail:m}));
  if(m.type==='ready'){worldSeed=m.seed;background(worldSeed);status('BIOLOGI OCH SAMHÄLLEN UTVECKLAS',true);log(m.restored?'Värld återställd från sparning.':'Livsfrö '+m.seed+' har aktiverats.');running=true;}
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
   openWorker();active=true;running=true;fastResearch=false;snapshot=null;
  lifeCam={x:140,y:65,zoom:4};growth=[];lastGrowthN=-1;selected=null;cityDetail=null;
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
$('society-life-view').addEventListener('click',()=>{mode='life';$('society-life-view').classList.add('active');$('society-map-view').classList.remove('active');sendCamera();drawMap();});
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
function changeZoom(delta){
 mode='life';$('society-life-view').classList.add('active');$('society-map-view').classList.remove('active');
 lifeCam.zoom=Math.max(1,Math.min(14,lifeCam.zoom*delta));sendCamera();
}
$('v8-zoom-in').addEventListener('click',()=>changeZoom(1.45));
$('v8-zoom-out').addEventListener('click',()=>changeZoom(1/1.45));
$('v8-follow').addEventListener('click',()=>{
 if(!snapshot)return;
 const recent=(snapshot.births||[]).at(-1),latest=recent||(snapshot.creatures||[]).at(-1);
 if(latest){lifeCam.x=latest.x;lifeCam.y=latest.y;lifeCam.zoom=Math.max(4.5,lifeCam.zoom);sendCamera();}
});
canvas.addEventListener('wheel',e=>{
 if(mode!=='life')return;
 e.preventDefault();changeZoom(e.deltaY<0?1.22:1/1.22);
},{passive:false});
canvas.addEventListener('pointerdown',e=>{
 if(!snapshot||!worker)return;
 const rect=canvas.getBoundingClientRect(),rx=(e.clientX-rect.left),ry=(e.clientY-rect.top);
 drag={x:rx,y:ry,originalX:lifeCam.x,originalY:lifeCam.y,moved:false};
 try{canvas.setPointerCapture(e.pointerId);}catch(error){}
});
canvas.addEventListener('pointermove',e=>{
 if(!drag||mode!=='life')return;
 const rect=canvas.getBoundingClientRect(),dx=e.clientX-rect.left-drag.x,dy=e.clientY-rect.top-drag.y;
 if(Math.abs(dx)+Math.abs(dy)>7)drag.moved=true;
 if(!drag.moved)return;
 lifeCam.x=drag.originalX-dx/rect.width*WW/lifeCam.zoom;
 lifeCam.y=drag.originalY-dy/rect.height*WH/lifeCam.zoom;cameraBounds();drawMap();
});
canvas.addEventListener('pointerup',e=>{
 if(!snapshot||!worker||!drag)return;
 const wasDrag=drag.moved;drag=null;
 if(wasDrag){sendCamera();return;}
 const r=canvas.getBoundingClientRect(),px=e.clientX-r.left,py=e.clientY-r.top;
 const lens=mode==='life'?cameraBounds():{left:0,top:0,w:WW,h:WH};
 const x=lens.left+px/r.width*lens.w,y=lens.top+py/r.height*lens.h;
 if(mode==='life'){
  let nearest=null,best=99999;
  for(const a of snapshot.creatures||[]){
   const pt=coords(a.x,a.y,r.width,r.height);
   const ds=(pt.x-px)**2+(pt.y-py)**2;
   if(ds<best){best=ds;nearest=a;}
  }
  if(nearest&&best<620){
   worker.postMessage({type:'inspectOrganism',id:nearest.id});
   put('v8-selected','Individ #'+nearest.id+' · generation '+nearest.gen+' · '+nearest.segments+' kroppssegment');
   return;
  }
 }
 let nearestCity=null,bestCity=Infinity;
 for(const city of snapshot.sites||[]){
  const pt=coords(city.x,city.y,r.width,r.height),ds=(pt.x-px)**2+(pt.y-py)**2;
  if(ds<bestCity){nearestCity=city;bestCity=ds;}
 }
 if(nearestCity&&bestCity<1200){selectCity(nearestCity.id);}
 else{worker.postMessage({type:'addFood',x,y});log('Du tillförde näring i livsmiljön.');}
});
window.addEventListener('resize',drawMap,{passive:true});
background(1);drawMap();renderDetail();
})();
