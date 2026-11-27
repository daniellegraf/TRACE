/* KOSMOSSCAN V10 — independently timed camera renderer.
 * No population is fabricated or collapsed in the worker. Only the
 * on-screen level of detail changes, using real individual IDs and counts.
 */
(function(){
'use strict';
const base=document.getElementById('society-canvas');
if(!base||!window.KosmosV7Bridge)return;
const WW=180,WH=112;
const overlay=document.createElement('canvas');
overlay.id='v10-fluid-map';overlay.setAttribute('aria-hidden','true');
overlay.style.cssText='position:absolute;z-index:2;pointer-events:none;display:block;';
base.parentElement.style.position='relative';
base.insertAdjacentElement('afterend',overlay);
const ctx=overlay.getContext('2d',{alpha:true});
if(!ctx)return;
window.KosmosV10Overlay=true;
const agents=new Map();
let frame=null,densityMap=null,playing=false,visible=true,queued=false,previous=0,lastDraw=0,lastDensity=0;
const motionReduced=!!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const cam=()=>window.KosmosV10Camera?.()||{mode:'life',zoom:4,x:140,y:65};
function dimensions(){
 const w=base.clientWidth,h=base.clientHeight;
 if(w<1||h<1)return null;
 const ratio=Math.min(1.7,window.devicePixelRatio||1);
 const cw=Math.round(w*ratio),ch=Math.round(h*ratio);
 if(overlay.width!==cw||overlay.height!==ch){overlay.width=cw;overlay.height=ch;}
 overlay.style.left=base.offsetLeft+'px';
 overlay.style.top=base.offsetTop+'px';
 overlay.style.width=w+'px';overlay.style.height=h+'px';
 ctx.setTransform(ratio,0,0,ratio,0,0);
 return{w,h};
}
function project(x,y,c,w,h){
 const z=clamp(c.zoom||1,1,14),spanW=WW/z,spanH=WH/z;
 const centerX=clamp(c.x,spanW*.5,WW-spanW*.5),centerY=clamp(c.y,spanH*.5,WH-spanH*.5);
 return{x:(x-centerX+spanW*.5)/spanW*w,y:(y-centerY+spanH*.5)/spanH*h};
}
function densityCloud(msg){
 if(!msg.density||!Array.isArray(msg.densitySize))return;
 const now=performance.now();
 if(densityMap&&now-lastDensity<460)return;
 lastDensity=now;
 const [gw,gh]=msg.densitySize;
 const low=document.createElement('canvas');low.width=gw;low.height=gh;
 const lowCtx=low.getContext('2d'),pixels=lowCtx.createImageData(gw,gh);
 let peak=1;for(const count of msg.density)if(count>peak)peak=count;
 for(let i=0;i<Math.min(msg.density.length,gw*gh);i++){
  const count=msg.density[i];if(!count)continue;
  const strength=Math.pow(Math.log1p(count)/Math.log1p(peak),.85),p=i*4;
  pixels.data[p]=25+Math.round(64*strength);
  pixels.data[p+1]=103+Math.round(121*strength);
  pixels.data[p+2]=117+Math.round(78*strength);
  pixels.data[p+3]=Math.round(219*strength);
 }
 lowCtx.putImageData(pixels,0,0);
 if(!densityMap){densityMap=document.createElement('canvas');densityMap.width=720;densityMap.height=448;}
 const dc=densityMap.getContext('2d');dc.clearRect(0,0,720,448);
 dc.save();dc.filter='blur(11px)';dc.imageSmoothingEnabled=true;dc.drawImage(low,0,0,720,448);dc.restore();
}
function accept(msg){
 if(msg.type==='ready'&&!msg.restored){agents.clear();densityMap=null;frame=null;}
 if(msg.type==='paused'){playing=false;request();return;}
 if(msg.type==='ready'){playing=true;request();return;}
 if(msg.type!=='frame')return;
 frame=msg;playing=true;densityCloud(msg);
 const present=new Set();
 for(const a of msg.creatures||[]){
  present.add(a.id);
  let v=agents.get(a.id);
  if(!v){
   v={source:a,x:a.x,y:a.y,tx:a.x,ty:a.y,alpha:0,missing:false};
   agents.set(a.id,v);
  }else{
   v.source=a;v.tx=a.x;v.ty=a.y;v.missing=false;
  }
 }
 for(const [id,v] of agents)if(!present.has(id))v.missing=true;
 request();
}
function glyph(o,p,c){
 const a=o.source,nodes=a.nodes||[],hue=a.color||165;
 const zoom=c.zoom;
 ctx.save();ctx.globalAlpha=clamp(o.alpha,0,1);
 if(zoom<2.1){
  const r=clamp(1.55+Math.sqrt(nodes.length)*.66,2.1,5.4);
  ctx.fillStyle='hsla('+hue+',88%,77%,.85)';
  ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.fill();
  if(nodes.length>3){
   ctx.strokeStyle='hsla('+hue+',83%,74%,.54)';ctx.lineWidth=1;
   ctx.beginPath();ctx.moveTo(p.x-r*1.3,p.y+r*.8);ctx.lineTo(p.x+r*1.3,p.y-r*.8);ctx.stroke();
  }
  ctx.restore();return;
 }
 const norm=Math.max(1,...nodes.map(v=>Math.hypot(v.x||0,v.y||0)+(v.r||0)));
 const radius=clamp((6+Math.sqrt(nodes.length)*2.3)*Math.sqrt(zoom/3),7,30),s=radius/norm;
 ctx.translate(p.x,p.y);ctx.rotate((a.heading||0)*.6);
 ctx.shadowColor='hsla('+hue+',85%,63%,.52)';ctx.shadowBlur=zoom>4?6:2;
 for(let i=1;i<nodes.length;i++){
  const n=nodes[i],parent=nodes[n.parent]||nodes[0];
  ctx.beginPath();ctx.moveTo((parent.x||0)*s,(parent.y||0)*s);
  ctx.lineTo((n.x||0)*s,(n.y||0)*s);
  ctx.strokeStyle='hsla('+hue+',80%,76%,.8)';
  ctx.lineWidth=Math.max(.75,(n.r||.15)*s*.58);ctx.stroke();
 }
 ctx.shadowBlur=0;
 for(const n of nodes){
  const x=(n.x||0)*s,y=(n.y||0)*s,r=Math.max(1.5,(n.r||.2)*s);
  ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);
  ctx.fillStyle='hsl('+(n.hue||hue)+',78%,'+(n.type==='sensor'?76:57)+'%)';ctx.fill();
  if(n.type==='sensor'||n.type==='core'){
   ctx.beginPath();ctx.arc(x,y,Math.max(.9,r*.36),0,Math.PI*2);
   ctx.fillStyle='#072b38';ctx.fill();
  }
  if(n.type==='fin'||n.type==='motor'){
   ctx.strokeStyle='#c3f5e7';ctx.lineWidth=.9;
   ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+r*1.9,y-r);ctx.stroke();
  }
 }
 ctx.restore();
}
function paint(now){
 const s=dimensions();if(!s)return;
 const {w,h}=s,c=cam();ctx.clearRect(0,0,w,h);
 if(!frame||c.mode!=='life')return;
 const pop=frame.metrics?.count||0,z=clamp(c.zoom,1,14);
 if(densityMap){
  const alpha=clamp((pop-155)/950,0,.83)*clamp((3.45-z)/2.45,0,1);
  if(alpha>.01){
   const sw=WW/z,sh=WH/z,left=clamp(c.x,sw*.5,WW-sw*.5)-sw*.5;
   const top=clamp(c.y,sh*.5,WH-sh*.5)-sh*.5;
   ctx.save();ctx.globalAlpha=alpha;ctx.imageSmoothingEnabled=true;
   ctx.drawImage(densityMap,left/WW*720,top/WH*448,sw/WW*720,sh/WH*448,0,0,w,h);
   ctx.restore();
  }
 }
 for(const v of agents.values()){
  if(v.alpha<.012)continue;
  const p=project(v.x,v.y,c,w,h);
  if(p.x< -35||p.x>w+35||p.y< -35||p.y>h+35)continue;
  glyph(v,p,c);
 }
 // Only genuine recorded births are highlighted.
 if(z>1.8)for(const b of (frame.births||[]).slice(-18)){
  const p=project(b.x,b.y,c,w,h);
  if(p.x<0||p.x>w||p.y<0||p.y>h)continue;
  ctx.strokeStyle='rgba(177,255,204,.24)';ctx.lineWidth=1;
  ctx.beginPath();ctx.arc(p.x,p.y,10+Math.sin(now*.003+b.id)*2,0,Math.PI*2);ctx.stroke();
 }
 // Overview tells the user why individuals have become too small to inspect.
 if(z<1.55&&pop>450){
  const message=pop>1300?'ÖVERSIKT · BEFOLKNING & SAMHÄLLEN — ZOOMA IN FÖR INDIVIDER':
   'ÖVERSIKT · ORGANISMER ÖVERGÅR TILL BEFOLKNINGSTÄTHET';
  ctx.font='10px ui-monospace,monospace';ctx.textAlign='right';
  const tw=ctx.measureText(message).width+17;
  ctx.fillStyle='rgba(4,27,37,.81)';ctx.fillRect(Math.max(4,w-tw-9),h-34,tw,20);
  ctx.fillStyle='#b8e9d9';ctx.fillText(message,w-17,h-20);
 }
}
function advance(t){
 queued=false;
 if(document.hidden||!visible)return;
 const dt=previous?Math.min(95,t-previous):16;previous=t;
 const easing=motionReduced?1:1-Math.exp(-dt/150);
 for(const [id,o] of agents){
  o.x+=(o.tx-o.x)*easing;o.y+=(o.ty-o.y)*easing;
  o.alpha=clamp(o.alpha+(o.missing?-1:1)*dt/370,0,1);
  if(o.missing&&o.alpha<.01)agents.delete(id);
 }
 if(t-lastDraw>=38||motionReduced){lastDraw=t;paint(t);}
 if(playing&&window.KosmosV7Bridge?.running?.())request();
}
function request(){
 if(queued||document.hidden||!visible)return;
 queued=true;requestAnimationFrame(advance);
}
window.addEventListener('kosmosv7:message',event=>accept(event.detail||{}));
window.addEventListener('resize',()=>{previous=0;request();},{passive:true});
document.addEventListener('visibilitychange',()=>{previous=0;if(!document.hidden)request();});
if(typeof IntersectionObserver!=='undefined'){
 const observer=new IntersectionObserver(entries=>{visible=entries.some(e=>e.isIntersecting);
  previous=0;if(visible)request();},{rootMargin:'100px'});
 observer.observe(base);
}
request();
})();