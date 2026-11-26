/* KOSMOSSCAN V7 instrument layer
   Scientific observations use real worker data. Save/restore is a complete
   IndexedDB structured-clone snapshot, not a screenshot or a generation seed.
*/
(function(){
'use strict';
const $=id=>document.getElementById(id),bridge=()=>window.KosmosV7Bridge;
const canvas=$('v7-micro-canvas');if(!canvas)return;
const ctx=canvas.getContext('2d');
let exemplars=[],selected=-1,latest=null,waitingSave=false,pendingSave=false;
let rAF=0,lastDraw=0;
const fnum=(n,dp=0)=>Number(n||0).toLocaleString('sv-SE',{maximumFractionDigits:dp});
const write=(id,t)=>{const n=$(id);if(n)n.textContent=String(t);};
const report=t=>write('v7-save-status',t);
function dbOpen(){
 return new Promise((resolve,reject)=>{
  if(typeof indexedDB==='undefined'){reject(Error('IndexedDB saknas. Använd Safari eller Chrome direkt.'));return;}
  const req=indexedDB.open('kosmosscan-life-v7',1);
  req.onupgradeneeded=()=>{const d=req.result;if(!d.objectStoreNames.contains('worlds'))d.createObjectStore('worlds');};
  req.onsuccess=()=>resolve(req.result);
  req.onerror=()=>reject(req.error||Error('Databasen kunde inte öppnas.'));
 });
}
async function saveWorld(state){
 const db=await dbOpen();
 try{await new Promise((resolve,reject)=>{
  const tx=db.transaction('worlds','readwrite');
  tx.objectStore('worlds').put({data:state,savedAt:new Date().toISOString()},'latest');
  tx.oncomplete=resolve;
  tx.onerror=()=>reject(tx.error||Error('Sparningen misslyckades'));
  tx.onabort=()=>reject(tx.error||Error('Sparningen avbröts'));
 });}finally{db.close();}
}
async function loadWorld(){
 const db=await dbOpen();
 try{return await new Promise((resolve,reject)=>{
  const tx=db.transaction('worlds','readonly');
  const req=tx.objectStore('worlds').get('latest');
  req.onsuccess=()=>resolve(req.result||null);
  req.onerror=()=>reject(req.error);
 });}finally{db.close();}
}
function makeSelection(){
 const root=$('v7-specimen-buttons');root.innerHTML='';
 const titles=['URCELL','TIDIG ÄTTLING','SENARE ÄTTLING','SENASTE FÖDELSE'];
 exemplars.forEach((s,i)=>{
  const button=document.createElement('button');button.type='button';
  button.textContent=(s.role||titles[i])+' · #'+s.id;
  if(s.id===selected)button.classList.add('selected');
  button.addEventListener('click',()=>{
   selected=s.id;makeSelection();
   bridge()?.send({type:'inspectOrganism',id:s.id});
   draw();
  });
  root.appendChild(button);
 });
}
function strokeLine(c,x1,y1,x2,y2,stroke,width){
 c.strokeStyle=stroke;c.lineWidth=width;c.beginPath();c.moveTo(x1,y1);c.lineTo(x2,y2);c.stroke();
}
function morphology(spec,ox,oy,scale){
 const nodes=spec.nodes||[],baseHue=spec.color||150;
 if(!nodes.length)return;
 let ext=0;
 for(const n of nodes)ext=Math.max(ext,Math.abs(n.x)+(n.r||0),Math.abs(n.y)+(n.r||0));
 const ratio=scale/Math.max(1.1,ext);
 ctx.save();ctx.translate(ox,oy);
 // Show real parent-child developmental topology, not six canned silhouettes.
 for(let i=1;i<nodes.length;i++){
  const n=nodes[i],p=nodes[n.parent]||nodes[0];
  const hue=Math.round(n.hue||baseHue);
  strokeLine(ctx,(p.x||0)*ratio,(p.y||0)*ratio,n.x*ratio,n.y*ratio,
   'hsla('+hue+',70%,69%,.72)',Math.max(.55,n.r*ratio*.55));
 }
 for(let i=0;i<nodes.length;i++){
  const n=nodes[i],x=n.x*ratio,y=n.y*ratio,r=Math.max(1.3,n.r*ratio);
  const hue=Math.round(n.hue||baseHue);
  ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);
  ctx.fillStyle='hsl('+hue+',78%,'+(n.type==='sensor'?79:62)+'%)';ctx.fill();
  if(n.type==='plate'){
   ctx.strokeStyle='hsl('+hue+',89%,91%)';ctx.lineWidth=1.2;ctx.stroke();
  }
  if(n.type==='sensor'||n.type==='antenna'){
   ctx.beginPath();ctx.arc(x,y,Math.max(1,r*.35),0,Math.PI*2);
   ctx.fillStyle='#081a2b';ctx.fill();
   ctx.beginPath();ctx.arc(x-.6,y-.5,1,0,Math.PI*2);ctx.fillStyle='#f2f9ff';ctx.fill();
  }
  if(n.type==='motor'||n.type==='fin'){
   const dir=Math.atan2(y,x);strokeLine(ctx,x,y,x+Math.cos(dir)*r*1.25,y+Math.sin(dir)*r*1.25,'#adfae4',1.4);
  }
 }
 ctx.restore();
}
function draw(){
 if(!ctx)return;
 const rect=canvas.getBoundingClientRect(),w=Math.max(1,rect.width),h=Math.max(1,rect.height);
 const ratio=Math.min(1.7,window.devicePixelRatio||1);
 if(canvas.width!==Math.round(w*ratio)||canvas.height!==Math.round(h*ratio)){
  canvas.width=Math.round(w*ratio);canvas.height=Math.round(h*ratio);
 }
 ctx.setTransform(ratio,0,0,ratio,0,0);
 ctx.fillStyle='#031320';ctx.fillRect(0,0,w,h);
 const tw=w/Math.max(1,exemplars.length||4);
 const captions=['URCELL','ÄTTLING I','ÄTTLING II','SENASTE'];
 if(!exemplars.length){
  ctx.textAlign='center';ctx.font='12px system-ui';ctx.fillStyle='#93b2c5';
  ctx.fillText('Väntar på arvsmassa och utvecklingsgener',w/2,h/2);return;
 }
 exemplars.forEach((s,i)=>{
  const xx=(i+.5)*tw,yy=h*.53,focus=s.id===selected;
  if(i){ctx.strokeStyle='#284a59';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(i*tw,10);ctx.lineTo(i*tw,h-10);ctx.stroke();}
  if(focus){ctx.fillStyle='rgba(42,145,115,.13)';ctx.fillRect(i*tw,1,tw,h-1);}
  ctx.textAlign='center';ctx.fillStyle='#9ad9cd';ctx.font='bold 10px ui-monospace,monospace';
  ctx.fillText(s.role||captions[i]||'MUTATION',xx,18);
  morphology(s,xx,yy,Math.min(tw*.38,h*.34));
  ctx.fillStyle='#b1e9de';ctx.font='10px ui-monospace,monospace';
  ctx.fillText('GEN '+s.gen+' · '+s.segments+' SEG',xx,h-30);
  ctx.fillStyle='#7dbea9';ctx.fillText(s.genes+' GEN · '+s.brain+' NERV',xx,h-14);
 });
}
function updateMetrics(m){
 if(!m)return;
 const values={
  'v7-body':fnum(m.bodyComplexity),'v7-genes':fnum(m.geneticParts),
  'v7-lineages':fnum(m.lineageBranches),'v7-sexual':fnum(m.sexualBirths),
  'v7-asexual':fnum(m.clonalBirths),'v7-learning':((m.benchmark?.improvement||0)>=0?'+':'')+fnum(m.benchmark?.improvement,3),
  'v7-signals':fnum(m.signalsShared),'v7-signal-success':fnum(m.signalSuccess),'v7-fail':fnum(m.failedPrototypes)
 };
 for(const [id,val]of Object.entries(values))write(id,val);
 const b=m.benchmark||{};
 const t='Födosöksprov med samma förenklade miljö:\n'+
  'Tränad strategi: '+fnum(b.trained,3)+' · Slumpkontroll: '+fnum(b.control,3)+
  ' · Skillnad: '+fnum(b.improvement,3)+'\n'+
  'Observerade nerv- och minnesuppdateringar: '+fnum(m.biologicalCycles)+
  ' kompletta biologiska cykler · '+fnum(m.environmentChanges)+' miljöförändringar.\n'+
  'Detta är ett kontrollerat deltest av en inlärningsregel, inte ett mått på allmän intelligens.';
 write('v7-science-result',t);
}
function onMessage(m){
 if(m.type==='frame'){
  latest=m;
  updateMetrics(m.metrics);
  const specimens=m.specimens||[];
  if(specimens.length){
   const was=exemplars.map(s=>s.id).join(':');
   exemplars=specimens;
   const ids=specimens.map(s=>s.id);
   if(!ids.includes(selected))selected=ids[ids.length-1];
   if(was!==ids.join(':'))makeSelection();
   if(!rAF)rAF=requestAnimationFrame(()=>{rAF=0;draw();});
  }
 }else if(m.type==='ready'){
  if(m.restored){
   report('Världen återställd. Individernas arvsmassor, nervnät och historia finns kvar.');
   if(latest?.metrics){$('v7-repro').value=String(latest.metrics.rateFactor);$('v7-biology').value=String(latest.metrics.biologyFactor);}
  }else report('Ett nytt livsfrö har startat. Världen kan sparas lokalt när du vill.');
 }else if(m.type==='organismDetail'){
  const a=m.agent;
  if(!a){write('v7-organism-info','Individen hittades inte i aktuell värld.');return;}
  const b=a.body;
  const parts=(a.genome.development||[]).map(g=>g.kind).join(', ')||'Encelligt ursprung';
  write('v7-organism-info','INDIVID #'+a.id+' · generation '+a.gen+' · släktlinje '+a.lineage+
   '\nFöräldrar: '+(a.parents.filter(Boolean).map(x=>'#'+x).join(' + ')||'ursprungsorganism')+
   '\nUtvecklingsgener: '+parts+
   '\nKroppssegment: '+b.segments+' · sensorer: '+b.eyes+' · motoriska utskott: '+b.appendages+
   '\nFunktion: sensorisk förmåga '+fnum(b.functions.sensing,2)+
   ' · rörelse '+fnum(b.functions.motor,2)+' · skydd '+fnum(b.functions.armor,2)+
   ' · energikostnad '+fnum(b.functions.cost,2)+
   '\nNeuronkopplingar: '+a.brain.length+
   ' · energiinlärning '+fnum(a.learning.success,3)+
   ' · arbetsminne: '+a.memory.map(x=>fnum(x,2)).join(' / ')+
   '\nVerifierad förfäderskedja: '+(a.lineagePath||[]).map(x=>'#'+x.id+' (gen '+x.gen+')').join(' → '));
 }else if(m.type==='checkpoint'){
  waitingSave=false;
  saveWorld(m.data).then(()=>report('✓ Världen sparad lokalt i IndexedDB: '+fnum(m.data.agents.length)+' individuella organismer, med nervnät, arvsmassa och historik.'))
   .catch(e=>report('Kunde inte spara: '+e.message));
 }else if(m.type==='integrity'){
  const x=m.result;
  write('v7-audit-result','Individer: '+fnum(x.count)+' · unika ID: '+(x.uniqueSequentialIDs?'OK':'FEL')+
   ' · arvsmassa: '+(x.genomesPresent?'OK':'FEL')+
   ' · föräldralänkar: '+(x.validParentLinks?'OK':'FEL')+
   ' · separata neuronminnen: '+(x.individualNeuralArrays?'OK':'FEL')+
   ' · evolutionära förgreningar: '+fnum(x.mutatedLineages));
 }else if(m.type==='error'){report('Motorfel: '+m.message);waitingSave=false;}
}
$('v7-repro').addEventListener('change',e=>bridge()?.send({type:'setRate',value:+e.target.value}));
$('v7-biology').addEventListener('change',e=>bridge()?.send({type:'setBiology',value:+e.target.value}));
for(const [id,key]of [['v7-use-learning','learning'],['v7-use-mutation','mutation'],['v7-use-culture','culture']]){
 $(id).addEventListener('change',e=>bridge()?.send({type:'ablation',key,enabled:e.target.checked}));
}
$('v7-save').addEventListener('click',()=>{
 if(waitingSave)return;
 if(!bridge()?.getWorker()){report('Starta en värld innan du sparar.');return;}
 waitingSave=true;report('Packar världens individuella tillstånd för lokal sparning…');
 bridge().send({type:'checkpoint'});
});
$('v7-restore').addEventListener('click',async()=>{
 try{
  report('Öppnar lokal sparad värld…');
  const record=await loadWorld();
  if(!record?.data){report('Ingen sparad V7-värld finns i denna webbläsare.');return;}
  bridge()?.restoreWorld(record.data);
  report('Återställning pågår. Sparad: '+new Date(record.savedAt).toLocaleString('sv-SE')+'.');
 }catch(e){report('Kunde inte återställa: '+e.message);}
});
$('v7-audit').addEventListener('click',()=>{
 if(!bridge()?.getWorker()){write('v7-audit-result','Starta en värld först.');return;}
 bridge().send({type:'integrity'});
});
window.addEventListener('kosmosv7:message',ev=>onMessage(ev.detail||{}));
window.addEventListener('resize',draw,{passive:true});
draw();
})();
