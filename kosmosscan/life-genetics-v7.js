/* KOSMOSSCAN V7 — developmental genetics and local neural evaluation.
   Deterministic under caller-supplied RNG. No fixed library of whole body shapes:
   phenotype grows by interpreting modular developmental genes.
   Gene categories constrain physics-inspired simulated functions, not real biology.
*/
(function(root){
'use strict';
function create(random){
 const R=random;
 const between=(a,b)=>a+(b-a)*R();
 const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
 const wrap=(x,m)=>((x%m)+m)%m;
 const TYPES=['axis','branch','sensor','fin','plate','antenna','motor','storage','filter'];
 const addGene=(kind)=>({kind,angle:between(-1.8,1.8),len:between(.24,1.18),
  width:between(.12,.75),sym:R()<.65,repeat:1+((R()*3)|0),on:between(.2,.95),
  regulator:between(-.55,.55),pigment:between(-.5,.5),elastic:between(.05,1)});
 function founder(hue){
  return {development:[],regulators:[between(.2,.8),between(.2,.8)],
   pigment:wrap(hue,360),saturation:between(.5,1),bilateral:R()<.5,
   reproduction:R()<.5?'clonal':'facultative',mating:between(.25,.8),
   latency:between(12,36),plasticity:between(.2,.8),brainGrowth:between(.3,.8),
   sensoryBias:between(-1,1),metabolicTradeoff:between(.25,.8),mutations:0};
 }
 function modifyGene(g){
  const p={...g},keys=['angle','len','width','on','regulator','pigment','elastic'];
  const key=keys[(R()*keys.length)|0],amp=key==='angle'?.35:.16;
  p[key]=clamp(p[key]+between(-amp,amp),key==='angle'?-3.14:key==='pigment'?-1:key==='regulator'?-1:0,
   key==='angle'?3.14:key==='pigment'?1:key==='regulator'?1:2);
  if(R()<.08)p.sym=!p.sym;
  if(R()<.09)p.repeat=clamp(p.repeat+(R()<.5?-1:1),1,6);
  return p;
 }
 function child(parent,other){
  const x=parent||founder(between(0,360)),y=other&&R()<.65?other:x;
  const genes=[];
  const max=Math.max(x.development.length,y.development.length);
  for(let i=0;i<max;i++){
   const source=(R()<.5?x:y).development[i]||x.development[i]||y.development[i];
   if(!source)continue;
   if(R()<.04&&genes.length>2)continue; // deletion
   genes.push(R()<.28?modifyGene(source):{...source});
   if(genes.length<34&&R()<.09)genes.push(modifyGene(source)); // duplication
  }
  if(R()<.13&&genes.length<34)genes.push(addGene(TYPES[(R()*TYPES.length)|0]));
  if(!genes.length)genes.push(addGene('axis'));
  if(!genes.some(g=>g.kind==='axis'))genes.unshift(addGene('axis'));
  const regs=x.regulators.map((p,i)=>clamp((R()<.5?p:y.regulators[i]??p)+(R()<.19?between(-.18,.18):0),0,1.5));
  return {development:genes.slice(0,36),regulators:regs,
   pigment:wrap((R()<.5?x.pigment:y.pigment)+(R()<.22?between(-24,24):0),360),
   saturation:clamp((x.saturation+y.saturation)/2+between(-.11,.11),.25,1),
   bilateral:R()<.03?!x.bilateral:x.bilateral,
   reproduction:R()<.025?(x.reproduction==='clonal'?'facultative':'clonal'):x.reproduction,
   mating:clamp((x.mating+y.mating)/2+between(-.08,.08),0,1),
   latency:clamp((x.latency+y.latency)/2+between(-3,3),5,75),
   plasticity:clamp((x.plasticity+y.plasticity)/2+between(-.12,.12),0,1),
   brainGrowth:clamp((x.brainGrowth+y.brainGrowth)/2+between(-.08,.08),0,1),
   sensoryBias:clamp((x.sensoryBias+y.sensoryBias)/2+between(-.2,.2),-1.5,1.5),
   metabolicTradeoff:clamp((x.metabolicTradeoff+y.metabolicTradeoff)/2+between(-.08,.08),0,1),
   mutations:(x.mutations||0)+1+(genes.length!==x.development.length?1:0)};
 }
 function phenotype(genome,stage=1){
  const g=genome||founder(190),genes=g.development||[];
  const maturity=clamp(stage,.2,1.5);
  const nodes=[{x:0,y:0,r:.38,type:'core',hue:g.pigment,parent:-1}];
  let tips=[{x:0,y:0,dir:0,parent:0}];
  let sensing=.25,motor=.35,armor=0,storage=.12,communication=.1,cost=.12,forage=.2;
  let eyeCount=0,appendages=0;
  for(let i=0;i<genes.length;i++){
   const gene=genes[i];
   const signal=(g.regulators?.[i%2]||.5)+(gene.regulator||0)*.33;
   if(signal<gene.on*.38)continue;
   const count=Math.min(gene.repeat||1,4),fork=gene.sym&&g.bilateral?2:1;
   const starting=tips[(i*13)%tips.length]||tips[0];
   for(let k=0;k<count;k++)for(let side=0;side<fork;side++){
    if(nodes.length>=110)break;
    const direction=starting.dir+(gene.angle||0)*(side===0?1:-1)+k*.22;
    const distance=(.27+(gene.len||.5)*.62)*maturity;
    const xx=starting.x+Math.cos(direction)*distance;
    const yy=starting.y+Math.sin(direction)*distance;
    const idx=nodes.length;
    nodes.push({x:xx,y:yy,r:Math.max(.08,(gene.width||.25)*.4)*maturity,
     type:gene.kind,hue:wrap(g.pigment+gene.pigment*65,360),parent:starting.parent});
    if((gene.kind==='axis'||gene.kind==='branch'||gene.kind==='fin')&&tips.length<30)tips.push({x:xx,y:yy,dir:direction,parent:idx});
    const weight=.04+(gene.len||0)*.07;
    cost+=weight;
    if(gene.kind==='sensor'||gene.kind==='antenna'){sensing+=.24*distance;eyeCount++;}
    if(gene.kind==='fin'||gene.kind==='motor'){motor+=.19*distance;appendages++;}
    if(gene.kind==='plate')armor+=.24*distance;
    if(gene.kind==='storage')storage+=.21*distance;
    if(gene.kind==='filter')forage+=.20*distance;
    if(gene.kind==='antenna')communication+=.18*distance;
   }
  }
  const symmetry=!!g.bilateral,segments=nodes.length;
  const functions={sensing:clamp(sensing,.1,4),motor:clamp(motor,.08,4),
    armor:clamp(armor,0,4),storage:clamp(storage,.1,3),forage:clamp(forage,.1,3),
    communication:clamp(communication,0,3),cost:clamp(cost,.08,6)};
  // Functional tradeoffs: larger bodies consume more, and better senses cost energy.
  functions.cost+=segments*.011+functions.sensing*.035;
  return{nodes,functions,segments,eyes:eyeCount,appendages,symmetry,
    color:g.pigment,score:segments+eyeCount*2+appendages*3,geneticComplexity:genes.length};
 }
 function distance(a,b){
  const p=a?.development||[],q=b?.development||[];
  const m=Math.max(p.length,q.length),n=Math.min(p.length,q.length);
  let diff=Math.abs(p.length-q.length)*1.6;
  for(let i=0;i<n;i++){
   diff+=(p[i].kind===q[i].kind?0:1.2);
   diff+=Math.abs(p[i].angle-q[i].angle)*.21;
   diff+=Math.abs(p[i].len-q[i].len)*.4;
  }
  diff+=Math.abs((a?.pigment||0)-(b?.pigment||0))/170;
  return diff/(m||1);
 }
 function evaluateForage(adapt,seedValue){
  // Controlled two-choice resource cue task. Two policies face the SAME
  // evaluation trials: one was trained using reward feedback, the other
  // chooses randomly. No direct access to the correct action when learning.
  let state=(seedValue||1)|0;
  function r(){state^=state<<13;state^=state>>>17;state^=state<<5;return(state>>>0)/4294967296;}
  const Q=[[0,0],[0,0]],rate=clamp(adapt,.05,.9);
  for(let t=0;t<160;t++){
   const target=r()<.5?0:1;
   const sensed=r()<.78?target:1-target; // fallible scent measurement
   const action=r()<.25?(r()<.5?0:1):(Q[sensed][1]>Q[sensed][0]?1:0);
   const reward=action===target?1:0; // feedback arrives AFTER action
   Q[sensed][action]+=rate*(reward-Q[sensed][action]);
  }
  let trained=0,control=0;
  const n=240;
  for(let i=0;i<n;i++){
   const target=r()<.5?0:1,sensed=r()<.78?target:1-target;
   const learnedAction=Q[sensed][1]>Q[sensed][0]?1:0;
   const randomAction=r()<.5?0:1;
   trained+=learnedAction===target?1:0;
   control+=randomAction===target?1:0;
  }
  trained/=n;control/=n;
  return{trained:+trained.toFixed(3),control:+control.toFixed(3),
   improvement:+(trained-control).toFixed(3),seed:seedValue,
   task:'reward-driven cue classification',trials:n};
 }
 return{founder,child,phenotype,distance,evaluateForage};
}
root.V7Genetics={create};
})(typeof self!=='undefined'?self:globalThis);
