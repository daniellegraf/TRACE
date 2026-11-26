/* KOSMOSSCAN LIFE ENGINE 5
   Multi-scale artificial-life laboratory: biology, learning, culture, technology,
   settlement and society. This is a simulation, NOT a reconstruction of Earth.
   Every organism retains its own state. No death, no archive, no fixed population cap.
   Biology updates in complete population ticks distributed across CPU slices.
   Reproduction follows wall time independently of population tick completion.
*/
'use strict';
const W=168,H=100,NC=W*H,PI=Math.PI,TWO=PI*2,MAX_NODES=24;
const BIRTHS_PER_SECOND=100;
const KNOWLEDGE=['signaler','samarbete','verktyg','skydd','odling','handel','symboler','organisation','vetenskap','maskiner'];
const REQUIRE=[
 [],[0],[0],[1,2],[2,3],[1,2],[0,5],[3,5,6],[4,6,7],[7,8]
];
let seed=1,randomState=1,nextID=1,agents=[],sites=[];
let nutrients=new Float32Array(NC),signal=new Float32Array(NC),signalNext=new Float32Array(NC);
let head=new Int32Array(NC),nextLinks=new Int32Array(0);
let ticks=0,births=0,genMax=0,highestBrain=0,mutations=0,appearanceMutations=0;
let ideas=0,teaching=0,buildings=0,cultureKinds=0,sharedResources=0,phenotypes=new Set();
let birthBalance=0,lastTime=0,lastFrame=0,lastReport=0,lastRateTime=0,birthRateCount=0,observedRate=0;
let tickCursor=0,tickTotal=0,tickRunning=false;
let paused=true,alive=false,stage=0,events=[],maxObservedCells=1,peakCulture=0;
let lastMilestone=0,renderMode='individual',avgComplexity=0,avgBrains=0;
let timeBudget=7;
const now=()=>performance.now();
function rand(){let t=randomState|0;t^=t<<13;t^=t>>>17;t^=t<<5;randomState=t|0;return(t>>>0)/4294967296;}
function rr(a,b){return a+(b-a)*rand();}
function clamp(x,a,b){return x<a?a:x>b?b:x;}
function at(x,y){return (((y|0)%H+H)%H)*W+(((x|0)%W+W)%W);}
function bit(n){return(1<<n);}
function has(mask,k){return(mask&bit(k))!==0;}
function countBits(n){let c=0;while(n){n&=n-1;c++;}return c;}
function say(text){events.unshift({step:ticks,text});if(events.length>12)events.pop();}
function newNode(){return [rr(-.8,.8),rr(-.8,.8),rr(-.8,.8),rr(-.8,.8),rr(-.8,.8),rr(-.8,.8)];}
function initialGenome(){
 return {speed:rr(.38,1.2),sensor:rr(.2,1.1),cooperation:rr(.1,.55),
 innovation:rr(.03,.26),metabolism:rr(.14,.75),mobility:rr(.25,1),
 hue:rr(0,360),form:(rand()*6)|0,size:rr(.45,1.15),appendages:rr(0,.3),
 limbs:rr(0,.3),cells:1,learning:rr(.2,.8),social:rr(.2,.8),
 brain:[newNode(),newNode(),newNode()],adapt:rr(.25,.65)};
}
function cloneGenome(p){
 const g={...p,brain:p.brain.map(node=>node.map(v=>clamp(v+(rand()<.12?rr(-.18,.18):0),-3,3)))};
 const params=['speed','sensor','cooperation','innovation','metabolism','mobility','hue','size','appendages','limbs','learning','social','adapt'];
 for(const prop of params)if(rand()<.18){
  g[prop]+=prop==='hue'?rr(-40,40):rr(-.21,.21);
  if(prop!=='hue')g[prop]=clamp(g[prop],0,2);
  else g.hue=(g.hue+360)%360;
  mutations++;if(['hue','size','appendages','limbs'].includes(prop))appearanceMutations++;
 }
 if(rand()<.11){g.form=(g.form+1+((rand()*5)|0))%6;mutations++;appearanceMutations++;}
 // Multicellularity is not granted by a timer; successive heritable genome changes
 // depend on reproduction, parent performance, and stochastic variation.
 const cellGain=.15+(p.cooperation>.5?.035:0)+(p.innovation>.55?.025:0);
 if(g.cells<20&&rand()<cellGain){g.cells++;mutations++;appearanceMutations++;}
 if(rand()<.17&&g.brain.length<MAX_NODES){g.brain.push(newNode());mutations++;}
 return g;
}
function spawn(parent){
 const g=parent?cloneGenome(parent.g):initialGenome();
 const x=parent?(parent.x+rr(-2.6,2.6)+W)%W:rr(0,W);
 const y=parent?(parent.y+rr(-2.6,2.6)+H)%H:rr(0,H);
 const newCulture=parent&&rand()<clamp(.64+g.social*.22,0,.94)?parent.culture:0;
 const a={id:nextID++,x,y,heading:rr(0,TWO),g,gen:parent?parent.gen+1:0,
 energy:parent?.65:rr(.65,1.2),age:0,mood:0,experience:0,fitness:0,
 culture:newCulture,clan:parent?parent.clan:((rand()*14)|0),
 neurons:new Float32Array(g.brain.length),memory:new Float32Array(4),
 signal:0,links:0,settlement:-1,cellEnergy:0};
 agents.push(a);births+=parent?1:0;genMax=Math.max(genMax,a.gen);
 highestBrain=Math.max(highestBrain,g.brain.length);
 maxObservedCells=Math.max(maxObservedCells,g.cells);
 phenotypes.add([g.form,Math.floor(g.hue/22),Math.min(8,g.cells)].join('-'));
 if(parent&&a.gen>0&&a.gen%8===0&&a.gen>lastMilestone){
  lastMilestone=a.gen;say('Generation '+a.gen+' har uppstått genom mutationer och arv');
 }
 return a;
}
function prepare(){
 agents=[];sites=[];nutrients.fill(0);signal.fill(0);signalNext.fill(0);
 head.fill(-1);nextLinks=new Int32Array(0);tickCursor=0;tickTotal=0;tickRunning=false;
 ticks=0;births=0;genMax=0;highestBrain=0;mutations=0;appearanceMutations=0;
 ideas=0;teaching=0;buildings=0;cultureKinds=0;sharedResources=0;phenotypes.clear();
 events=[];stage=0;maxObservedCells=1;peakCulture=0;lastMilestone=0;
 birthBalance=0;lastTime=0;lastFrame=0;lastReport=0;lastRateTime=0;birthRateCount=0;observedRate=0;
 for(let i=0;i<NC;i++)nutrients[i]=rr(.30,.85);
 for(let i=0;i<125;i++)spawn(null);
 say('Livets början: 125 enkla, encelliga digitala organismer');
}
function selectedParent(){
 // Fitness tournament with a diversity lane prevents one optimized lineage
 // from deterministically taking over the population.
 let pick=agents[(rand()*agents.length)|0];
 if(rand()<.19)return pick;
 for(let i=0;i<4;i++){
  const other=agents[(rand()*agents.length)|0];
  const score=a=>a.energy*.23+a.fitness*.65+a.experience*.012+
   a.g.cells*.04+countBits(a.culture)*.035+a.g.brain.length*.02;
  if(score(other)>score(pick))pick=other;
 }
 return pick;
}
function reproduce(wallMs){
 birthBalance+=Math.min(wallMs,900)*BIRTHS_PER_SECOND/1000;
 const n=Math.min(90,birthBalance|0);
 birthBalance-=n;
 for(let i=0;i<n;i++){spawn(selectedParent());birthRateCount++;}
}
function startTick(){
 tickRunning=true;tickCursor=0;tickTotal=agents.length;
 // Rebuild compact spatial lookup in O(N), no quadratic pairwise comparisons.
 if(nextLinks.length<tickTotal)nextLinks=new Int32Array(Math.max(tickTotal,(nextLinks.length*1.6+256)|0));
 head.fill(-1);
 for(let i=0;i<tickTotal;i++){
  const a=agents[i],ci=at(a.x,a.y);
  nextLinks[i]=head[ci];head[ci]=i;
 }
 // Renewable nutrients + periodic chemical signalling.
 for(let i=0;i<NC;i++){
  nutrients[i]=clamp(nutrients[i]+.003*(.82-nutrients[i]),0,1);
  if((ticks&1)===0){
   const x=i%W,y=(i/W)|0,l=at(x-1,y),r=at(x+1,y),u=at(x,y-1),d=at(x,y+1);
   signalNext[i]=clamp(signal[i]*.86+(signal[l]+signal[r]+signal[u]+signal[d])*.026,0,1);
  }
 }
 if((ticks&1)===0){const tmp=signal;signal=signalNext;signalNext=tmp;}
}
function neighbour(a){
 // Bounded local social search. The cost per organism remains O(1) on average.
 for(let trial=0;trial<4;trial++){
  const center=at(a.x+rr(-4,4),a.y+rr(-4,4));
  let j=head[center],i=0;
  while(j!==-1&&i++<3){const n=agents[j];if(n.id!==a.id)return n;j=nextLinks[j];}
 }
 return null;
}
function neuralTurn(a,near,food){
 const g=a.g,mem=a.memory,brain=g.brain,brainLen=brain.length;
 let previous=0,sum=0;
 const stimuli=[food,signal[at(a.x,a.y)],near?near.g.cooperation:0,
  a.energy*.34,mem[0],mem[1]];
 for(let i=0;i<brainLen;i++){
  const node=brain[i],before=a.neurons[i];
  let v=node[0]*stimuli[0]+node[1]*stimuli[1]+node[2]*stimuli[2]+
    node[3]*stimuli[3]+node[4]*before+node[5]*previous;
  const z=Math.tanh(v);
  a.neurons[i]=before*.71+z*.29;previous=a.neurons[i];
  sum+=(i&1?-1:1)*a.neurons[i];
  if((ticks+i)%4===0){
   // Local reward-modulated plasticity: synapse changes are not the same as intelligence.
   const reward=food-a.cellEnergy;
   node[0]=clamp(node[0]+reward*g.learning*.006*z,-3,3);
   node[4]=clamp(node[4]+reward*g.learning*.004*before,-3,3);
  }
 }
 return Math.tanh(sum/Math.sqrt(brainLen));
}
function culturallyLearn(a,n){
 const diff=n.culture&~a.culture;
 if(diff&&rand()<.09*a.g.social*(.5+a.g.cooperation)){
  const bitPick=diff&-diff;
  a.culture|=bitPick;teaching++;a.experience+=.12;
  if((teaching%400)===0)say('Kulturell kunskap har spridits '+teaching+' gånger');
 }
 if(has(a.culture,1)&&a.energy<.58&&n.energy>1.25&&rand()<.035){
  const share=Math.min(.06,n.energy-.9);n.energy-=share;a.energy+=share;sharedResources++;
 }
}
function canDiscover(a,k){
 if(has(a.culture,k))return false;
 const g=a.g;
 for(const dep of REQUIRE[k])if(!has(a.culture,dep))return false;
 if(k===0)return g.cells>=2||g.brain.length>=4;
 if(k===1)return g.cooperation>.38&&g.brain.length>=4;
 if(k===2)return g.cells>=3&&g.appendages>.15&&g.brain.length>=5;
 if(k===3)return has(a.culture,1)&&g.cells>=3;
 if(k===4)return g.cells>=4&&g.learning>.34;
 if(k===5)return g.cells>=4&&g.social>.4;
 if(k===6)return g.brain.length>=8&&a.experience>.5;
 if(k===7)return sites.length>0&&g.brain.length>=9;
 if(k===8)return sites.some(s=>s.level>=2)&&g.brain.length>=10;
 return sites.some(s=>s.level>=3)&&g.brain.length>=12;
}
function innovate(a){
 if(rand()>(.013+a.g.innovation*.025+a.experience*.001))return;
 const possible=[];
 for(let k=0;k<KNOWLEDGE.length;k++)if(canDiscover(a,k))possible.push(k);
 if(!possible.length)return;
 const k=possible[(rand()*possible.length)|0];
 a.culture|=bit(k);ideas++;a.experience+=1.2;
 peakCulture=Math.max(peakCulture,countBits(a.culture));
 if((ideas<12||ideas%70===0))say('Upptäckt: '+KNOWLEDGE[k]+' (individ #'+a.id+')');
}
function settlement(a,near){
 if(!has(a.culture,3)||!has(a.culture,1)||!near)return;
 if(!has(near.culture,1))return;
 let candidate=null;
 for(const s of sites)if(Math.hypot(s.x-a.x,s.y-a.y)<7){candidate=s;break;}
 if(!candidate){
  if(sites.length>=110||rand()>.018)return;
  candidate={id:sites.length+1,x:a.x,y:a.y,clan:a.clan,
   level:1,power:0,food:0,knowledge:a.culture,members:0,color:a.g.hue};
  sites.push(candidate);buildings++;say('De första gemensamma skydden byggdes');
 }
 if(rand()<.038){
  candidate.power+=.1+a.g.cooperation*.15;
  candidate.members++;
  candidate.knowledge|=a.culture;
  if(candidate.level<5&&candidate.power>candidate.level*8&&has(candidate.knowledge,6)){
   candidate.power=0;candidate.level++;
   buildings++;say('Bosättning #'+candidate.id+' utvecklades till nivå '+candidate.level);
  }
  a.settlement=candidate.id;
  a.experience+=.016;
 }
}
function updateOrganism(a){
 const g=a.g,pos=at(a.x,a.y),near=neighbour(a);
 const supply=nutrients[pos];
 const neural=neuralTurn(a,near,supply);
 const ahead=nutrients[at(a.x+Math.cos(a.heading)*g.sensor*4,a.y+Math.sin(a.heading)*g.sensor*4)];
 const left=nutrients[at(a.x+Math.cos(a.heading-.7)*g.sensor*4,a.y+Math.sin(a.heading-.7)*g.sensor*4)];
 const right=nutrients[at(a.x+Math.cos(a.heading+.7)*g.sensor*4,a.y+Math.sin(a.heading+.7)*g.sensor*4)];
 a.heading+=(right-left)*.45+neural*.17+rr(-.11,.11);
 a.x=(a.x+Math.cos(a.heading)*g.speed*(.35+g.mobility*.4)+W)%W;
 a.y=(a.y+Math.sin(a.heading)*g.speed*(.35+g.mobility*.4)+H)%H;
 const j=at(a.x,a.y),f=Math.min(nutrients[j],.008*(1+g.cells*.045));
 nutrients[j]-=f;
 const aid=has(a.culture,2)?.0013:0;
 const farmer=has(a.culture,4)?.002:0;
 a.energy=clamp(a.energy+f*.6+aid+farmer-.0025*g.metabolism,.001,3);
 a.cellEnergy=f;
 a.fitness=a.fitness*.985+(f+aid+farmer)*.015;
 a.age++;a.experience+=f*.012;
 a.memory[0]=a.memory[0]*.92+(right-left)*.08;
 a.memory[1]=a.memory[1]*.93+neural*.07;
 if(has(a.culture,0)&&rand()<.13)signal[j]=clamp(signal[j]+.025,0,1);
 if(near){
  culturallyLearn(a,near);
  if(g.cooperation>.55&&near.clan===a.clan&&rand()<.09){
   a.links++;a.experience+=.003;
  }
  if(near.g.cooperation<.2&&g.cooperation<.2&&rand()<.02){
   // Contest changes allocation of energy, but no organism dies.
   const d=Math.min(.01,near.energy*.006);near.energy-=d;a.energy+=d;
  }
 }
 if(a.age%11===0)innovate(a);
 if(a.age%13===0)settlement(a,near);
 if(a.age%140===0&&g.brain.length<MAX_NODES&&rand()<.025){
  g.brain.push(newNode());
  const st=new Float32Array(g.brain.length);st.set(a.neurons);a.neurons=st;
  highestBrain=Math.max(highestBrain,g.brain.length);mutations++;
 }
}
function evolveChunk(){
 if(!tickRunning)startTick();
 const deadline=now()+timeBudget;let operations=0;
 while(tickCursor<tickTotal){
  updateOrganism(agents[tickCursor++]);operations++;
  if((operations&63)===0&&now()>=deadline)break;
 }
 if(tickCursor===tickTotal){
  tickRunning=false;ticks++;
  if((ticks%12)===0)evaluateStage();
 }
}
function evaluateStage(){
 let sampled=0,cells3=0,cultured=0,community=0,tech=0,socialSum=0,complexity=0,brains=0;
 const stride=Math.max(1,Math.floor(agents.length/900));
 for(let i=0;i<agents.length;i+=stride){
  const a=agents[i];sampled++;
  if(a.g.cells>=3)cells3++;
  if(a.culture)cultured++;
  if(countBits(a.culture)>=3)community++;
  if(has(a.culture,4))tech++;
  socialSum+=a.links;complexity+=a.g.cells;brains+=a.g.brain.length;
 }
 avgComplexity=sampled?complexity/sampled:1;avgBrains=sampled?brains/sampled:3;
 let newStage=0;
 if(cells3>sampled*.014)newStage=1;
 if(newStage>=1&&community>sampled*.003&&teaching>=10)newStage=2;
 if(newStage>=2&&sites.length>=1)newStage=3;
 if(newStage>=3&&sites.some(s=>s.level>=2)&&tech>sampled*.004)newStage=4;
 if(newStage>=4&&sites.filter(s=>s.level>=3).length>=2&&ideas>50&&peakCulture>=8)newStage=5;
 if(newStage>stage){stage=newStage;say(['Encelligt liv','Flercellig utveckling','Delad kultur','Gemensamma bosättningar','Tekniska samhällen','Civilisationsliknande nätverk'][stage]+' har uppstått');}
 cultureKinds=0;
 const x=agents.length;const sampleLimit=Math.min(4000,x);
 const known=new Set();
 for(let i=0;i<sampleLimit;i++){const a=agents[(i*(x-1)/(sampleLimit||1))|0];if(a.culture)known.add(a.culture);}
 cultureKinds=known.size;
}
function snapshot(){
 const n=agents.length;
 const metrics={pop:n,births,rate:observedRate,gen:genMax,brain:highestBrain,
  mutants:mutations,appearanceMutations,phenotypes:phenotypes.size,sites:sites.length,
  buildings,ideas,teaching,sharedResources,stage,ticks,cycleProgress:tickRunning?tickCursor:tickTotal,
  cycleTotal:tickRunning?tickTotal:tickTotal,meanCells:avgComplexity,meanBrain:avgBrains,
  peakCells:maxObservedCells,knowledge:peakCulture,cultures:cultureKinds,youngestId:nextID-1};
 const sitesData=sites.map(s=>[s.x,s.y,s.level,s.color,s.members]).slice(0,110);
 const examples=[];
 for(let k=0;k<4;k++){
  const a=k===0?agents[0]:k===1?agents[(n/3)|0]:k===2?agents[(n*.73)|0]:agents[n-1];
  if(!a)continue;
  examples.push({id:a.id,gen:a.gen,hue:a.g.hue,form:a.g.form,cells:a.g.cells,
   limbs:a.g.limbs,append:a.g.appendages,size:a.g.size,brain:a.g.brain.length,
   culture:countBits(a.culture),experience:a.experience,clan:a.clan});
 }
 const threshold=22000;
 if(n<=threshold){
  const points=new Uint8Array(n*6);
  for(let i=0;i<n;i++){
   const a=agents[i],k=i*6;
   points[k]=clamp(Math.floor(a.x/W*255),0,255);
   points[k+1]=clamp(Math.floor(a.y/H*255),0,255);
   points[k+2]=clamp(Math.floor(a.g.hue/360*255),0,255);
   points[k+3]=a.g.form;
   points[k+4]=Math.min(255,a.g.cells);
   points[k+5]=clamp(Math.floor((a.heading/TWO)*255),0,255);
  }
  postMessage({type:'frame',metrics,examples,sites:sitesData,mode:'individual',points},[points.buffer]);
 }else{
  const pixels=new Uint16Array(NC),hues=new Uint32Array(NC);
  for(const a of agents){
   const i=at(a.x,a.y);
   if(pixels[i]<65535)pixels[i]++;
   hues[i]+=a.g.hue;
  }
  const image=new Uint8Array(NC*3);
  for(let i=0;i<NC;i++){const k=i*3;image[k]=Math.min(255,pixels[i]);image[k+1]=pixels[i]?((hues[i]/pixels[i])/360*255)|0:0;image[k+2]=Math.min(255,Math.log1p(pixels[i])*28);}
  postMessage({type:'frame',metrics,examples,sites:sitesData,mode:'density',density:image},[image.buffer]);
 }
}
function heartbeat(){
 if(!alive||paused)return;
 const current=now();
 const elapsed=lastTime?Math.min(1000,Math.max(0,current-lastTime)):40;
 lastTime=current;
 // Births occur BEFORE individual processing: slow population cycles cannot choke reproduction.
 reproduce(elapsed);
 if(lastRateTime===0)lastRateTime=current;
 if(current-lastRateTime>=1000){
  observedRate=Math.round(birthRateCount/((current-lastRateTime)/1000));
  birthRateCount=0;lastRateTime=current;
 }
 try{evolveChunk();}
 catch(e){paused=true;postMessage({type:'error',error:'Fel i livsmotorn: '+e.message});return;}
 if(current-lastFrame>=130){snapshot();lastFrame=current;}
 if(current-lastReport>=2500&&events.length){postMessage({type:'events',events:events.slice(0,6)});lastReport=current;}
 setTimeout(heartbeat,12);
}
onmessage=function(ev){
 const m=ev.data||{};
 if(m.type==='start'){
  seed=(m.seed||((Math.random()*4294967295)>>>0))>>>0;
  randomState=seed||123456789;nextID=1;
  prepare();paused=false;alive=true;lastTime=0;lastRateTime=0;lastFrame=0;
  postMessage({type:'ready',seed,goal:BIRTHS_PER_SECOND});
  heartbeat();
 }else if(m.type==='pause'){
  paused=true;postMessage({type:'paused'});
 }else if(m.type==='resume'){
  if(!alive)return;paused=false;lastTime=0;lastRateTime=0;lastFrame=0;heartbeat();
 }else if(m.type==='touch'){
  const x=clamp(m.x||0,0,W-1),y=clamp(m.y||0,0,H-1);
  for(let dy=-6;dy<=6;dy++)for(let dx=-6;dx<=6;dx++){
   if(dx*dx+dy*dy<=36){const p=at(x+dx,y+dy);nutrients[p]=clamp(nutrients[p]+.45,0,1);}
  }
 }else if(m.type==='budget'){
  timeBudget=clamp(+m.ms||7,3,12);
 }
};
