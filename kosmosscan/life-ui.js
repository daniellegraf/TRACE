/* KOSMOSSCAN LIFE ENGINE V5 — responsive main-thread renderer.
   The simulation lives in life-worker.js; the UI never simulates a proxy population.
   Snapshots preserve every organism's position/color at up to 22,000 organisms,
   then include every organism in an exact position-density raster.
*/
(function(){
'use strict';
const $=id=>document.getElementById(id);
const stage=$('life-stage');if(!stage)return;
const stageCtx=stage.getContext('2d',{alpha:false});
const portrait=$('life-gallery'),portraitCtx=portrait.getContext('2d');
const STAGES=[
 ['URSPRUNG','Encelligt liv','Enkla autonoma celler förbrukar energi och navigerar.'],
 ['BIOLOGI','Flercellighet','Ärftliga förändringar ger kroppar med flera celler.'],
 ['KULTUR','Lärande & tradition','Kunskap kan kopieras mellan individer, inte bara ärvas genetiskt.'],
 ['SAMHÄLLE','Gemensamma platser','Samarbetande individer börjar förändra sin miljö och bygga skydd.'],
 ['TEKNIK','Tekniska samhällen','Bosättningar, verktyg, odling och fler kulturella färdigheter samspelar.'],
 ['CIVILISATION','Civilisationsliknande nätverk','Flera avancerade bosättningar är förenade av komplex kultur och teknik.']
];
const posNames=['URCELL','DOTTER','UTVECKLAD','SENASTE FÖDSEL'];
let worker=null,running=false,paused=false,started=false,state=null,events=[],dirty=false,lastDraw=0;
let frameCount=0,lastFps=0,drawFps=0,canvasSize={w:0,h:0,r:1},portraitSize={w:0,h:0,r:1};
let birthAvg=0,sessionSeed=0;
const palette=Array.from({length:256},(_,i)=>{
 const h=i/255*360,s=.86,l=.63;
 const a=s*Math.min(l,1-l),f=n=>{
  const k=(n+h/30)%12;return Math.round(255*(l-a*Math.max(-1,Math.min(k-3,9-k,1))));
 };
 return [f(0),f(8),f(4)];
});
function text(id,value){const el=$(id);if(el)el.textContent=value;}
function nfmt(x){return Math.round(x||0).toLocaleString('sv-SE');}
function badgeStatus(label,active){text('life-status',label);$('life-status').classList.toggle('life-live',Boolean(active));}
function addLog(message,tick){
 if(!message)return;
 const box=$('life-log');if(!box)return;
 const item=document.createElement('div');item.className='life-logitem';
 const time=document.createElement('span');time.textContent='T+'+nfmt(tick||0)+' ';
 item.append(time,document.createTextNode(message));
 box.prepend(item);while(box.children.length>10)box.lastChild.remove();
}
function setStage(level){
 const s=STAGES[Math.max(0,Math.min(5,level|0))];
 text('life-era',s[0]+' · '+s[1]);text('life-era-desc',s[2]);
 for(let i=0;i<6;i++){
  const el=$('life-stage-'+i);if(!el)continue;
  el.classList.toggle('done',i<=level);el.classList.toggle('current',i===level);
  el.querySelector('.stage-state').textContent=i<=level?'UPPNÅTT':'INTE UPPNÅTT';
 }
}
function resizeOne(canvas,ctx,which){
 const rect=canvas.getBoundingClientRect(),w=Math.max(1,rect.width),h=Math.max(1,rect.height),r=Math.min(1.7,window.devicePixelRatio||1);
 const rw=Math.round(w*r),rh=Math.round(h*r);
 if(canvas.width!==rw||canvas.height!==rh){canvas.width=rw;canvas.height=rh;}
 ctx.setTransform(r,0,0,r,0,0);
 if(which==='world')canvasSize={w,h,r};else portraitSize={w,h,r};
}
function drawBackground(ctx,w,h){
 ctx.fillStyle='#020c18';ctx.fillRect(0,0,w,h);
 const grad=ctx.createRadialGradient(w*.55,h*.45,1,w*.55,h*.45,w*.8);
 grad.addColorStop(0,'#11344a');grad.addColorStop(.45,'#071b30');grad.addColorStop(1,'#020713');
 ctx.fillStyle=grad;ctx.fillRect(0,0,w,h);
 ctx.strokeStyle='#3f6d822c';ctx.lineWidth=.65;
 for(let k=1;k<13;k++){const x=k*w/13;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();}
 for(let k=1;k<8;k++){const y=k*h/8;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
}
function shape(ctx,form,x,y,sz,angle,color,cells,append,limbs,detail){
 ctx.save();ctx.translate(x,y);ctx.rotate(angle);ctx.fillStyle=color;
 const shapeForm=form%6,body=Math.max(.28,sz);
 if(shapeForm===0){ctx.beginPath();ctx.arc(0,0,body,0,Math.PI*2);ctx.fill();}
 else if(shapeForm===1){ctx.beginPath();ctx.moveTo(body*1.3,0);ctx.lineTo(-body,-body*.83);ctx.lineTo(-body*.45,0);ctx.lineTo(-body,body*.83);ctx.closePath();ctx.fill();}
 else if(shapeForm===2){ctx.beginPath();ctx.ellipse(0,0,body*1.5,body*.64,0,0,Math.PI*2);ctx.fill();}
 else if(shapeForm===3)ctx.fillRect(-body,-body*.65,2*body,1.3*body);
 else if(shapeForm===4){ctx.beginPath();for(let i=0;i<10;i++){let a=i*Math.PI/5,r=(i&1)?body*.62:body*1.35;let px=Math.cos(a)*r,py=Math.sin(a)*r;i?ctx.lineTo(px,py):ctx.moveTo(px,py);}ctx.closePath();ctx.fill();}
 else{ctx.beginPath();ctx.moveTo(-body,-body);ctx.lineTo(body*1.5,0);ctx.lineTo(-body,body);ctx.lineTo(-body*.2,0);ctx.closePath();ctx.fill();}
 if(detail&&cells>1){
  const limit=Math.min(cells,16);
  for(let j=1;j<limit;j++){
   const a=j*2.399,rr=body*.36*Math.sqrt(j);
   ctx.beginPath();ctx.arc(Math.cos(a)*rr,Math.sin(a)*rr,body*.24,0,Math.PI*2);ctx.fill();
  }
 }
 if(detail){
  ctx.strokeStyle=color;ctx.lineWidth=Math.max(.65,body*.11);
  const num=Math.min(7,Math.floor(limbs*7));
  for(let j=0;j<num;j++){
   const dir=j%2?-1:1,offset=(j/7)*body;
   ctx.beginPath();ctx.moveTo(offset,-dir*body*.2);
   ctx.lineTo(offset+body*(.5+append),dir*body*(.75+append*.7));ctx.stroke();
  }
  if(append>.1){ctx.beginPath();ctx.moveTo(-body,0);ctx.lineTo(-body*(1.25+append),body*.3);ctx.stroke();}
 }
 ctx.restore();
}
function drawWorld(){
 resizeOne(stage,stageCtx,'world');
 const {w,h}=canvasSize,ctx=stageCtx;drawBackground(ctx,w,h);
 if(!state){
  ctx.font='13px ui-monospace,monospace';ctx.textAlign='center';ctx.fillStyle='#8dadc2';
  ctx.fillText('Världen väntar på ett första livstecken',w/2,h/2);return;
 }
 const m=state.metrics,sites=state.sites||[];
 ctx.save();
 ctx.strokeStyle='rgba(109,233,184,.3)';
 for(const s of sites){
  const [sx,sy,lev,hue]=s,x=sx/168*w,y=sy/100*h,size=3+lev*2;
  ctx.fillStyle='hsla('+hue+',95%,70%,.13)';ctx.beginPath();ctx.arc(x,y,size*3,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='hsl('+hue+',85%,69%)';ctx.fillRect(x-size/2,y-size/2,size,size);
  ctx.strokeRect(x-size*.8,y-size*.8,size*1.6,size*1.6);
  if(lev>=3){ctx.beginPath();ctx.moveTo(x,y-size*2);ctx.lineTo(x+size*.7,y-size*.8);ctx.lineTo(x-size*.7,y-size*.8);ctx.closePath();ctx.fill();}
 }
 ctx.restore();
 if(state.mode==='individual'){
  const p=state.points,n=p.length/6;
  const dot=Math.max(.18,Math.min(2.8,3*Math.sqrt(850/(n||1))));
  const shapes=n<=1800;
  if(shapes){
   for(let i=0;i<n;i++){
    const k=i*6,x=p[k]/255*w,y=p[k+1]/255*h,co=p[k+2],shapeType=p[k+3],cells=p[k+4],angle=p[k+5]/255*Math.PI*2;
    shape(ctx,shapeType,x,y,dot*(.8+Math.min(12,cells)*.02),angle,'hsl('+Math.round(co/255*360)+',90%,68%)',cells,0,0,false);
   }
  }else{
   // Draw every individual. Group-by-hue reduces fillStyle changes; dot shrinks with growth.
   const groups=Array.from({length:24},()=>[]);
   for(let i=0;i<n;i++)groups[Math.min(23,(p[i*6+2]/256*24)|0)].push(i);
   for(let g=0;g<24;g++){
    const list=groups[g];if(!list.length)continue;
    ctx.fillStyle='hsl('+(g*15)+',85%,71%)';
    for(const i of list){const k=i*6;ctx.fillRect(p[k]/255*w,p[k+1]/255*h,dot,dot);}
   }
  }
 }else if(state.density){
  const data=state.density,image=document.createElement('canvas');image.width=168;image.height=100;
  const cc=image.getContext('2d'),pixels=cc.createImageData(168,100);
  for(let i=0;i<168*100;i++){
   const p=i*3,k=i*4,num=data[p],clr=palette[data[p+1]],brightness=data[p+2]/255;
   pixels.data[k]=num?Math.min(255,clr[0]*(.35+brightness)):0;
   pixels.data[k+1]=num?Math.min(255,clr[1]*(.35+brightness)):0;
   pixels.data[k+2]=num?Math.min(255,clr[2]*(.35+brightness)):0;
   pixels.data[k+3]=num?255:0;
  }
  cc.putImageData(pixels,0,0);
  ctx.imageSmoothingEnabled=false;ctx.drawImage(image,0,0,w,h);ctx.imageSmoothingEnabled=true;
 }
 ctx.font='11px ui-monospace,monospace';ctx.textAlign='left';
 ctx.fillStyle='#b8f7e8';ctx.fillText('INDIVIDER: '+nfmt(m.pop),13,21);
 ctx.fillStyle='#8eb8ca';ctx.fillText('STEG: '+nfmt(m.ticks),13,38);
}
function drawGallery(){
 if(!portraitCtx||!portrait)return;
 resizeOne(portrait,portraitCtx,'gallery');const ctx=portraitCtx,{w,h}=portraitSize;
 ctx.clearRect(0,0,w,h);ctx.fillStyle='#061a2b';ctx.fillRect(0,0,w,h);
 const specimens=state?.examples||[],gap=w/4;
 for(let i=0;i<4;i++){
  const a=specimens[i],x=gap*(i+.5),color=a?'hsl('+Math.round(a.hue)+',88%,70%)':'#537687';
  ctx.strokeStyle='#24465c';ctx.lineWidth=1;
  if(i){ctx.beginPath();ctx.moveTo(gap*i,8);ctx.lineTo(gap*i,h-8);ctx.stroke();}
  ctx.font='9px ui-monospace,monospace';ctx.fillStyle='#9dbad0';ctx.textAlign='center';
  ctx.fillText(posNames[i],x,15);
  if(a){
   const rad=Math.min(gap*.24,h*.21)*(0.8+Math.min(a.cells,15)*.04);
   shape(ctx,a.form,x,h*.51,rad,0,color,a.cells,a.append,a.limbs,true);
   ctx.font='10px ui-monospace,monospace';ctx.fillStyle='#c2e8ef';
   ctx.fillText('GEN '+a.gen+' · '+a.cells+'C',x,h-22);
   ctx.fillStyle='#76ceb9';ctx.fillText(a.culture+' LÄRDOMAR',x,h-9);
  }else{ctx.fillText('—',x,h/2);}
 }
}
function updateMetrics(){
 const m=state?.metrics;if(!m)return;
 for(const [id,v] of Object.entries({
  'life-pop':nfmt(m.pop),'life-rate':nfmt(m.rate)+' /s',
  'life-gen':nfmt(m.gen),'life-brain':nfmt(m.brain),'life-cells':nfmt(m.peakCells),
  'life-species':nfmt(m.phenotypes),'life-culture':nfmt(m.teaching),
  'life-innovations':nfmt(m.ideas),'life-sites':nfmt(m.sites),
  'life-mutants':nfmt(m.appearanceMutations),'life-tick':nfmt(m.ticks),
  'life-work':nfmt(m.cycleProgress)+' / '+nfmt(m.cycleTotal)
 }))text(id,v);
 text('life-complexity','Ø '+(+m.meanCells||1).toFixed(1)+' celler · Ø '+(+m.meanBrain||3).toFixed(1)+' neuroner');
 setStage(m.stage);
 const rate=$('life-rate');rate.style.color=m.rate>85?'#7ef3cf':m.rate>55?'#ffcc85':'#ff9c94';
}
function setRunning(flag){
 running=flag;paused=!flag;
 $('life-pause').disabled=!started;
 $('life-pause').textContent=flag?'⏸ PAUSA':'▶ FORTSÄTT';
 badgeStatus(flag?'EVOLUTION PÅGÅR':started?'PAUSAD':'EJ STARTAD',flag);
}
function makeWorker(){
 if(typeof Worker==='undefined'){throw Error('Din webbläsare saknar Web Worker-stöd. Öppna länken i Safari eller Chrome.');}
 if(worker){worker.terminate();worker=null;}
 worker=new Worker('./life-worker.js');
 worker.onerror=e=>{
  setRunning(false);addLog('Arbetstråden kunde inte laddas. Öppna webblänken direkt i Safari/Chrome.');
  badgeStatus('FEL VID START',false);
 };
 worker.onmessage=ev=>{
  const msg=ev.data||{};
  if(msg.type==='ready'){sessionSeed=msg.seed;addLog('Världen har startats. Slumpfrö: '+msg.seed);setRunning(true);}
  else if(msg.type==='frame'){
   state=msg;dirty=true;
   updateMetrics();
   if(!drawQueued){drawQueued=true;requestAnimationFrame(()=>{drawQueued=false;drawWorld();drawGallery();});}
  }else if(msg.type==='events'){
   for(const evn of msg.events.slice(0,5)){
    const key=evn.step+':'+evn.text;
    if(!seenEvents.has(key)){seenEvents.add(key);addLog(evn.text,evn.step);}
   }
  }else if(msg.type==='paused')setRunning(false);
  else if(msg.type==='error'){badgeStatus('BERÄKNINGSFEL',false);addLog(msg.error);}
 };
}
let drawQueued=false,seenEvents=new Set();
function start(){
 try{
  seenEvents.clear();state=null;makeWorker();started=true;setRunning(true);
  text('life-pop','125');text('life-rate','—');text('life-work','0 / 125');
  $('life-log').innerHTML='';
  addLog('Startar den nya livsmotorn…');
  worker.postMessage({type:'start'});
  $('life-start').textContent='↻ NYTT UNIVERSUM';
 }catch(err){started=false;setRunning(false);badgeStatus('KUNDE INTE STARTA',false);addLog(err.message);}
}
$('life-start').addEventListener('click',start);
$('life-pause').addEventListener('click',()=>{
 if(!worker||!started)return;
 if(running){worker.postMessage({type:'pause'});setRunning(false);}
 else{worker.postMessage({type:'resume'});setRunning(true);}
});
stage.addEventListener('pointerdown',e=>{
 if(!worker||!started)return;
 const rect=stage.getBoundingClientRect();
 const x=(e.clientX-rect.left)/rect.width*168,y=(e.clientY-rect.top)/rect.height*100;
 if(!Number.isFinite(x)||!Number.isFinite(y))return;
 worker.postMessage({type:'touch',x,y});
 addLog('Näring tillfördes i området.');
});
window.addEventListener('resize',()=>{
 if(state){drawWorld();drawGallery();}
 else{drawWorld();drawGallery();}
},{passive:true});
setStage(0);drawWorld();drawGallery();
})();
