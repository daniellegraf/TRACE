/* V9 civilization theater: all graphics, event text and citizen profiles are
   drawn strictly from real worker state (schematic locations, not GPS).
*/
(function(){
'use strict';
const $=id=>document.getElementById(id),canvas=$('v9-scene-canvas');
if(!canvas)return;
const ctx=canvas.getContext('2d');
const DOMAIN=['Signaler','Samarbete','Verktyg','Skydd','Odling','Symboler','Handel','Organisation','Material','Energi','Optik','Beräkning','Astronomi','Navigation','Automation','Framdrift'];
const $text=(id,t)=>{const el=$(id);if(el)el.textContent=String(t);};
const human=n=>Math.round(Number(n)||0).toLocaleString('sv-SE');
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const send=m=>window.KosmosV7Bridge?.send?.(m);
let state=null,frame=null,watchCity=0,drawn=[],selectedPerson=0,lastData=0,lastCityOpts='',lastFrameTime=0;
const palette={dwelling:'#e7cba3',farm:'#85d6a0',workshop:'#b7b7ba',academy:'#a2e4e1',
 power:'#f7d89e',observatory:'#b5bfff',exchange:'#f4bc9c',archive:'#b9f5dc',
 clinic:'#faf2dc',council:'#c0e5ef',transport:'#9ad8c4',factory:'#edbba8',
 shipyard:'#f7dcaa',commons:'#82e8c1',communication:'#9bc9f1'};
function el(type,cls,content){
 const a=document.createElement(type);if(cls)a.className=cls;
 if(content!==undefined)a.textContent=String(content);
 return a;
}
function clear(root){while(root.firstChild)root.removeChild(root.firstChild);}
function box(x,y,w,h,fill){ctx.fillStyle=fill;ctx.fillRect(x,y,w,h);}
function line(x,y,xx,yy,stroke,width=1){
 ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(xx,yy);ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.stroke();
}
function circle(x,y,r,fill,stroke){
 ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);
 if(fill){ctx.fillStyle=fill;ctx.fill();}
 if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=1.2;ctx.stroke();}
}
function polygon(points,fill){
 ctx.beginPath();for(let i=0;i<points.length;i++){
  if(!i)ctx.moveTo(points[i][0],points[i][1]);else ctx.lineTo(points[i][0],points[i][1]);
 }ctx.closePath();ctx.fillStyle=fill;ctx.fill();
}
function label(t,x,y,fill='#caefdb',font='10px system-ui'){
 ctx.font=font;ctx.textAlign='center';ctx.fillStyle=fill;
 ctx.fillText(String(t),x,y);
}
function geometry(){
 const r=canvas.getBoundingClientRect(),w=Math.max(1,r.width),h=Math.max(1,r.height),
  ratio=Math.min(1.7,window.devicePixelRatio||1);
 if(canvas.width!==Math.round(w*ratio)||canvas.height!==Math.round(h*ratio)){
  canvas.width=Math.round(w*ratio);canvas.height=Math.round(h*ratio);
 }
 ctx.setTransform(ratio,0,0,ratio,0,0);return{w,h};
}
function assetPoint(asset,w,h){
 return{x:w*.5+(asset.x||0)*w*.40,y:h*.45+(asset.y||0)*h*.33};
}
function drawBuilding(asset,p,size){
 const {x,y}=p,scale=Math.min(1.4,1+(asset.workers||1)*.012);
 const w=size*scale,h=size*.75*scale,color=palette[asset.kind]||'#a8d6cc';
 ctx.save();
 ctx.shadowColor='rgba(0,0,0,.48)';ctx.shadowBlur=7;ctx.shadowOffsetY=3;
 const ground=y+h*.45;
 if(asset.kind==='farm'||asset.kind==='commons'){
  box(x-w*.7,y-h*.42,w*1.4,h*.85,'#245947');
  for(let i=0;i<4;i++){
   line(x-w*.54+i*w*.31,y-h*.32,x-w*.54+i*w*.31,y+h*.33,color,1.9);
  }
  circle(x,y-h*.32,w*.13,'#a6ffc4');
 }else if(asset.kind==='observatory'){
  box(x-w*.5,y-h*.05,w,h*.55,color);
  circle(x,y-h*.08,w*.48,color);
  circle(x+w*.1,y-h*.35,w*.08,'#102b3b');
 }else if(asset.kind==='communication'||asset.kind==='power'){
  polygon([[x-w*.3,ground],[x,ground-h*1.9],[x+w*.3,ground]],color);
  for(let j=0;j<3;j++)line(x-w*.4,ground-j*h*.42,x+w*.4,ground-j*h*.42,'#244b53');
  circle(x,ground-h*1.95,w*.11,'#f5ecb5');
 }else if(asset.kind==='factory'||asset.kind==='workshop'){
  box(x-w*.55,y-h*.2,w*1.1,h*.75,color);
  polygon([[x-w*.6,y-h*.2],[x-w*.15,y-h*.6],[x+w*.58,y-h*.2]],'#335766');
  box(x+w*.20,y-h*.9,w*.17,h*.72,'#83959e');
  box(x-w*.28,y+h*.15,w*.2,h*.24,'#123440');
 }else if(asset.kind==='archive'||asset.kind==='academy'||asset.kind==='council'){
  box(x-w*.55,y-h*.23,w*1.1,h*.68,color);
  polygon([[x-w*.67,y-h*.25],[x,y-h*.77],[x+w*.67,y-h*.25]],'#7baaaa');
  for(let j=-1;j<=1;j++)box(x+j*w*.28-w*.075,y-h*.1,w*.15,h*.46,'#2c6171');
 }else if(asset.kind==='transport'){
  line(x-w*.8,y+h*.4,x+w*.8,y-h*.4,'#c0d8b5',w*.23);
  line(x-w*.8,y+h*.4,x+w*.8,y-h*.4,'#314f56',1.1);
 }else if(asset.kind==='shipyard'){
  box(x-w*.48,y-h*.1,w,h*.55,color);
  line(x-w*.6,y-h*.6,x+w*.5,y-h*.6,'#f3dfae',2);
  line(x-w*.15,y-h*.6,x-w*.15,y+h*.4,'#f3dfae',2);
  polygon([[x,y-h],[x+w*.6,y-h*.55],[x,y-h*.55]],'#89b3bb');
 }else{
  box(x-w*.48,y-h*.15,w*.96,h*.62,color);
  polygon([[x-w*.61,y-h*.12],[x,y-h*.75],[x+w*.61,y-h*.12]],'#60879a');
  box(x-w*.12,y+h*.18,w*.22,h*.28,'#12323c');
 }
 ctx.restore();
}
function drawIndividual(p,x,y,scale){
 const nodes=p.anatomy||[],hue=p.color||160;
 const maxR=Math.max(1,...nodes.map(n=>Math.hypot(n.x||0,n.y||0)+(n.r||0)));
 const s=scale/maxR;
 ctx.save();ctx.translate(x,y);
 ctx.shadowBlur=7;ctx.shadowColor='hsla('+hue+',90%,70%,.65)';
 if(!nodes.length)circle(0,0,3,'#9ef2d4');
 for(let i=1;i<nodes.length;i++){
  const node=nodes[i],parent=nodes[node.parent]||nodes[0];
  line((parent.x||0)*s,(parent.y||0)*s,(node.x||0)*s,(node.y||0)*s,
   'hsla('+hue+',77%,74%,.9)',Math.max(1,(node.r||.15)*s*.42));
 }
 for(const node of nodes){
  const x=(node.x||0)*s,y=(node.y||0)*s,r=Math.max(1.7,(node.r||.24)*s);
  circle(x,y,r,'hsl('+(node.hue||hue)+',72%,'+(node.type==='sensor'?82:63)+'%)');
  if(node.type==='sensor'){
   circle(x,y,Math.max(1,r*.36),'#092f36');
  }
 }
 ctx.restore();
}
function worldScene(){
 if(!ctx)return;
 const {w,h}=geometry();drawn=[];
 box(0,0,w,h,'#071c28');
 // Spatially schematic district, not invented physical geography.
 for(let gy=0;gy<h;gy+=25){
  line(0,gy,w,gy,'rgba(53,114,107,.14)',.6);
 }
 for(let gx=0;gx<w;gx+=34)line(gx,0,gx,h,'rgba(53,114,107,.11)',.55);
 const city=state;
 if(!city){
  const organisms=(frame?.creatures||[]).slice(0,30);
  label('LIVET FÖRE DE FÖRSTA SAMHÄLLENA',w*.5,h*.14,'#b4e3d6','bold 13px system-ui');
  label('Dessa kroppar och nervsystem kommer från simulerade individer.',w*.5,h*.20,'#88b9b4','11px system-ui');
  for(let i=0;i<organisms.length;i++){
   const a=organisms[i],col=i%10,row=(i/10)|0;
   const px=w*(.09+col*.092),py=h*(.35+row*.18);
   drawIndividual({anatomy:a.nodes,color:a.color},px,py,clamp(w/85,4.5,9));
   if(col%2===0||w>650)label('#'+a.id+' · g'+a.gen,px,py+17,'#9bd4c8','9px ui-monospace,monospace');
   drawn.push({kind:'person',data:a,x:px,y:py});
  }
  const readiness=Math.round(clamp((frame?.metrics?.biologicalCultureReadiness||0)*100,0,100));
  label('Biologiska förutsättningar för samarbete: '+readiness+'%',w*.5,h*.93,'#b6ffda','11px ui-monospace,monospace');
  return;
 }
 const cx=w*.5,cy=h*.43;
 circle(cx,cy,Math.min(w,h)*.38,'rgba(49,102,84,.12)','rgba(82,157,123,.18)');
 // Cultural center; arcs evoke connected infrastructure without fake extra buildings.
 ctx.lineWidth=1.2;
 for(let k=0;k<5;k++){
  const a=k*Math.PI*2/5;
  line(cx,cy,cx+Math.cos(a)*w*.44,cy+Math.sin(a)*h*.31,'rgba(165,215,188,.2)',2);
 }
 const assets=city.assets||[];
 const prepared=assets.map(asset=>({asset,p:assetPoint(asset,w,h)}));
 for(const {asset,p} of prepared){
  const dx=p.x-cx,dy=p.y-cy;
  line(cx,cy,p.x,p.y,'rgba(136,197,177,.11)',1);
 }
 for(const {asset,p} of prepared){
  const s=clamp(Math.min(w/39,18),9,17);
  drawBuilding(asset,p,s);
  drawn.push({kind:'asset',data:asset,x:p.x,y:p.y});
 }
 const liveProjects=(city.active||[]).slice(0,4);
 for(let i=0;i<liveProjects.length;i++){
  const project=liveProjects[i],x=w*(.15+i*.23),y=h*.14;
  circle(x,y,7,'rgba(43,106,95,.75)','#a9ffdc');
  const progress=clamp(project.work/Math.max(1,project.required),0,1);
  ctx.strokeStyle='#90f4b8';ctx.lineWidth=3;ctx.beginPath();
  ctx.arc(x,y,12,-Math.PI/2,-Math.PI/2+Math.PI*2*progress);ctx.stroke();
  label((project.title||'Projekt').slice(0,16),x,y+26,'#b2dcc6','9px system-ui');
 }
 const citizens=(city.citizens||[]).slice(0,20);
 const time=frame?.metrics?.ticks||0;
 for(let i=0;i<citizens.length;i++){
  const p=citizens[i],col=i%10,row=(i/10)|0;
  // Place each tracked citizen near a stable schematic activity station.
  const px=w*(.09+col*.091)+(Math.sin(time*.09+p.id)*2.8);
  const py=h*(.75+row*.115)+(Math.cos(time*.085+p.id)*2);
  drawIndividual(p,px,py,clamp(w/85,4.3,8));
  if(w>470||i%2===0)label(p.name,px,py+14,'#b6e4d1','9px ui-monospace,monospace');
  drawn.push({kind:'person',data:p,x:px,y:py});
 }
 ctx.strokeStyle='rgba(162,255,209,.28)';ctx.lineWidth=1;
 ctx.beginPath();ctx.moveTo(12,h*.67);ctx.lineTo(w-12,h*.67);ctx.stroke();
 box(9,h-19,w-18,14,'rgba(3,27,35,.85)');
 ctx.font='10px ui-monospace,monospace';ctx.fillStyle='#bde5d5';ctx.textAlign='left';
 ctx.fillText((city.assetsTotal||0)+' KONSTRUKTIONER · '+human(city.people)+' INVÅNARE · '+
  (city.active||[]).length+' PÅGÅENDE PROJEKT',14,h-9);
}
function actions(){
 const c=state,m=frame?.metrics,tot=m?.social||{};
 $text('v9-city-name',c?.name||'Inget samhälle ännu');
 $text('v9-city-age',c?'SAMHÄLLE · NIVÅ '+c.level:'BIOLOGISK UTVECKLING');
 $text('v9-society-status',c?'UTVECKLING I REALTID':'BIOLOGI '+Math.round((m?.biologicalCultureReadiness||0)*100)+'%');
 $text('v9-citizens',human(c?.people||0));
 $text('v9-built',human(tot.constructed||0));
 $text('v9-active-projects',human(c?.active?.length||0));
 $text('v9-decisions',human(tot.decisions||0));
 $text('v9-knowledge',human((tot.researchSuccesses||0)+(tot.ideas||0)));
}
function projectPanel(){
 const root=$('v9-project-feed');clear(root);
 if(!state?.active?.length){root.append(el('p','v9-muted','Ingen aktiv konstruktion. Individer studerar, samlar resurser eller formulerar nya idéer.'));return;}
 for(const project of state.active.slice(0,6)){
  const e=el('div','v9-project'),b=el('b','',project.title),
   who=el('small','',project.founderName+' · '+project.workers.length+' deltagare · '+project.need);
  const prog=el('div','v9-progress'),fill=el('i','');
  fill.style.width=(clamp(project.work/project.required,0,1)*100).toFixed(1)+'%';
  prog.append(fill);e.append(b,who,prog);root.append(e);
 }
}
function citizenPanel(){
 const root=$('v9-citizen-list');clear(root);
 if(!state?.citizens?.length){root.append(el('span','v9-muted','Inga individuella samhällshandlingar registrerade ännu.'));return;}
 for(const citizen of state.citizens.slice(0,22)){
  const button=el('button',selectedPerson===citizen.id?'active':'',citizen.name+' · '+citizen.aspiration);
  button.type='button';
  button.addEventListener('click',()=>selectPerson(citizen.id));
  root.append(button);
 }
}
function selectPerson(id){selectedPerson=id;send({type:'inspectCitizen',id});
 $text('v9-person-profile','Hämtar individuell historik för organism #'+id+'…');
 citizenPanel();
}
function profile(p){
 if(!p){$text('v9-person-profile','Individen kunde inte hittas i den här världen.');return;}
 const top=p.skill.map((v,i)=>({v,name:DOMAIN[i]})).sort((a,b)=>b.v-a.v).slice(0,4);
 const mem=p.memory||[],link=p.relationships||[];
 const lines=[
  p.name.toUpperCase()+' · ORGANISM #'+p.id,
  'Temperament: '+p.role+' · Generation '+p.gen,
  'Aktuellt mål: '+p.aspiration,
  'Individuellt bidrag: '+human(p.built)+' arbetsinsatser',
  'Egna upptäckter: '+human(p.knowledge)+' · Undervisning: '+human(p.teaching),
  'Arvsmassa: '+human(p.genomeGenes||0)+' utvecklingsgener · Nervceller: '+human(p.brainSize||0),
  'Starkaste kunskaper: '+top.map(s=>s.name+' '+Math.round(s.v*100)+'%').join(', '),
  'Registrerade relationer: '+link.map(x=>'#'+x[0]).join(', '),
  '',
  'SENASTE HANDLINGAR',
  ...(mem.slice(0,6).map(x=>'T+'+x.step+' · '+x.description))
 ];
 $text('v9-person-profile',lines.join('\n'));
}
function historyPanel(){
 const root=$('v9-event-feed');clear(root);
 const entries=state?.recent?.length?state.recent:(frame?.metrics?.social?.recent||[]);
 const meaningful=entries.filter(e=>['completed','project','breakthrough','discovery','teaching','disagreement','founding','agreement'].includes(e.type));
 const selected=meaningful.length?meaningful:entries;
 if(!selected.length){root.append(el('p','v9-muted','Livet måste utveckla kunskap och förutsättningar för samarbete först.'));return;}
 for(const event of selected.slice(0,13)){
  const line=el('div','v9-event');
  const time=el('small','','T+'+human(event.step));
  const body=el('span','',event.text);
  line.append(time,body);root.append(line);
 }
}
function researchPanel(){
 const root=$('v9-research-feed');clear(root);
 if(!state){root.append(el('p','v9-muted','Väntar på språk och forskning.'));return;}
 const entries=(state.researchIdeas||[]).slice(0,10);
 if(!entries.length){
  const known=(state.tech||[]).map((v,i)=>({v,name:DOMAIN[i]})).filter(x=>x.v>=.16).sort((a,b)=>b.v-a.v);
  if(!known.length)root.append(el('p','v9-muted','Ännu inga gemensamma kunskapsområden. Individuella studier pågår.'));
  else for(const knownItem of known.slice(0,12)){
   const item=el('div','v9-event');
   item.append(el('small','',Math.round(knownItem.v*100)+'%'),el('span','',knownItem.name));root.append(item);
  }
  return;
 }
 for(const idea of entries){
  const item=el('div','v9-event');
  item.append(el('small','', 'T+'+human(idea.step)),el('span','',idea.authorName+' kombinerade '+idea.name+' → '+idea.effect));
  root.append(item);
 }
}
function updateSelect(){
 const select=$('v9-society-select'),sites=frame?.sites||[];
 const identity=sites.length+'-'+(sites.at(-1)?.id||0);
 if(identity===lastCityOpts)return;lastCityOpts=identity;
 const old=select.value;while(select.options.length>1)select.remove(1);
 for(const city of [...sites].sort((a,b)=>b.level-a.level||b.homes-a.homes).slice(0,450)){
  const option=document.createElement('option');
  option.value=String(city.id);option.textContent=city.name+' · nivå '+city.level+' · '+(city.homes||0)+' hem';
  select.append(option);
 }
 select.value=watchCity?String(watchCity):'';
}
function onFrame(msg){
 frame=msg;
 if(msg.spotlight&&(!watchCity||msg.spotlight.id===watchCity))state=msg.spotlight;
 else if(!msg.spotlight&& !watchCity)state=null;
 actions();worldScene();
 if(Date.now()-lastData>950){
  lastData=Date.now();updateSelect();projectPanel();citizenPanel();historyPanel();researchPanel();
 }
}
$('v9-society-select').addEventListener('change',e=>{
 watchCity=+(e.target.value||0);selectedPerson=0;send({type:'watchCity',id:watchCity});state=null;
});
$('v9-society-follow').addEventListener('click',()=>{
 watchCity=0;selectedPerson=0;$('v9-society-select').value='';
 send({type:'watchCity',id:0});
});
$('v9-society-next').addEventListener('click',()=>{
 const sites=frame?.sites||[];if(!sites.length)return;
 const ordered=[...sites].sort((a,b)=>b.level-a.level||b.homes-a.homes);
 let index=ordered.findIndex(x=>x.id===watchCity);index=(index+1)%ordered.length;
 watchCity=ordered[index].id;selectedPerson=0;
 $('v9-society-select').value=String(watchCity);send({type:'watchCity',id:watchCity});
});
canvas.addEventListener('pointerdown',event=>{
 const r=canvas.getBoundingClientRect(),x=event.clientX-r.left,y=event.clientY-r.top;
 let found=null,best=850;
 for(const hit of drawn){
  const ds=(hit.x-x)**2+(hit.y-y)**2;
  if(ds<best){best=ds;found=hit;}
 }
 if(!found)return;
 if(found.kind==='person')selectPerson(found.data.id);
 else $text('v9-person-profile','KONSTRUKTION\n'+found.data.title+'\nFunktion: '+found.data.function+
   '\nGrundare: individ #'+found.data.author+
   '\nDeltagare: '+found.data.workers+
   '\nTillkom i steg '+found.data.created);
});
window.addEventListener('kosmosv7:message',event=>{
 const msg=event.detail||{};
 if(msg.type==='frame')onFrame(msg);
 else if(msg.type==='ready'){
  if(!msg.restored){state=null;frame=null;watchCity=0;selectedPerson=0;lastCityOpts='';}
  $text('v9-society-status',msg.restored?'SPARAD VÄRLD ÅTERSTÄLLD':'BIOLOGI → KULTUR → SAMHÄLLEN');
 }
 else if(msg.type==='societyDetail'){
  if(msg.data){state=msg.data;actions();worldScene();projectPanel();citizenPanel();historyPanel();researchPanel();}
  else if(!watchCity)state=frame?.spotlight||null;
 }
 else if(msg.type==='citizenDetail')profile(msg.person);
});
window.addEventListener('resize',worldScene,{passive:true});
worldScene();
})();