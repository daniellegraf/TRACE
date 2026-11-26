/* KOSMOSSCAN LIFE ENGINE V6 — emergent societies experiment.
   One unique state per organism. No deaths/archives. Social systems on their
   own clock; reproduction low and resource-dependent; inventions and words
   generated from causal combinations. NOT a model of real biological history.
*/
'use strict';
importScripts('./life-genetics-v7.js','./life-technology-v7.js');
const G7=V7Genetics.create(rand),T7=V7Technology.create(rand);
const V7_VERSION='8.0.0';
let rateFactor=1,biologyFactor=1,mutationEnabled=true,learningEnabled=true,cultureEnabled=true;
let biologicalCycles=0,sexualBirths=0,clonalBirths=0,lineageBranches=0,bodyComplexity=1;
let maxGeneticParts=0,rewardImprovement=0,learningTrials=0,lastBenchmark=null,signalsShared=0,signalSuccess=0;
let ancestry=[],saves=0,environmentChanges=0,benchmarks={trained:0,control:0,improvement:0};
let failedPrototypes=0,failedExperiments=[];
let temperature,water,sunlight;
let dynamicCycle=0;
let camera={x:140,y:65,zoom:4},birthMarks=[],culturesFounded=0,architectureEvents=0,bodyEvents=0;

const W=180,H=112,SIZE=W*H,TAU=Math.PI*2;
temperature=new Float32Array(SIZE);water=new Float32Array(SIZE);sunlight=new Float32Array(SIZE);
const SYL=['ka','ri','ve','nu','sha','to','mi','la','zor','el','ai','um','ith','ra','vo','sen','ki','dra','no','ul','yx','en','ta','or'];
const WORDS=['vi','kunskap','föda','bygga','plats','samarbete','ljus','rörelse','energi','material','himmel','minne','tid','förändring','signal','handel','fara','verktyg','vatten','väg','forska','färdas','bevara','lära'];
const DOMAINS=['Signaler','Samarbete','Verktyg','Skydd','Odling','Symboler','Handel','Organisation','Material','Energi','Optik','Beräkning','Astronomi','Navigation','Automation','Framdrift'];
const COMPONENTS=['fibrer','sten','metall','ljus','värme','vind','vatten','rörelse','signal','minne','mönster','struktur','magnetism','tryck','cykel','kristall','våg','väv','stjärnor','ekon','friktion','fält'];
const EFFECTS=['lagring','mätning','överföring','styrning','förstärkning','omvandling','skydd','navigering','framdrift','produktion','samordning','observation','beräkning','balans'];
const seedClanNames=['Kairen','Oshari','Veyru','Nolai','Toshin','Evrana','Yxora','Miren','Ulven','Zurai','Kael'];
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
let rng=1,seed=1,id=0,agents=[],clans=[],cities=[],messages=[],inventions=[],milestones=[],flights=[];
let nutrition=new Float32Array(SIZE),signal=new Float32Array(SIZE),terrain=new Uint8Array(SIZE),occupancy=new Int32Array(SIZE);
let nextAgent=new Int32Array(512);
let birthCredit=0,cycle=null,step=0,last=0,lastFrame=0,lastStats=0,clock=0,paused=true,live=false,rate=0,rateBorn=0,lastRateAt=0;
let teaching=0,skillsFound=0,transmissions=0,sentences=0,innovations=0,buildings=0,roadCount=0;
let maxCells=1,maxBrain=3,maxGen=0,underlyingTicks=0,individualUpdates=0,updateWindow=0,updatesPerSecond=0;
let socialSpeed=1, extraPlanetary=0;
function rand(){let x=rng|0;x^=x<<13;x^=x>>>17;x^=x<<5;rng=x|0;return(x>>>0)/4294967296;}
function between(a,b){return a+(b-a)*rand();}
function pick(a){return a[(rand()*a.length)|0];}
function mod(n,m){return(n%m+m)%m;}
function pos(x,y){return mod(y|0,H)*W+mod(x|0,W);}
function bit(k){return 1<<k;}
function bits(mask){let n=0;while(mask){mask&=mask-1;n++;}return n;}
function lexeme(){return pick(SYL)+pick(SYL)+(rand()<.3?pick(SYL):'');}
function inheritBrain(source){const n=source||Array.from({length:3},()=>Array.from({length:6},()=>between(-1,1)));const b=n.map(row=>row.map(w=>clamp(w+(rand()<.14?between(-.16,.16):0),-3,3)));if(b.length<22&&rand()<.04)b.push(Array.from({length:6},()=>between(-1,1)));return b;}
function soil(x,y){const j=pos(x,y);return terrain[j]===0?.2:terrain[j]===1?.8:terrain[j]===2?.5:.6;}
function addEvent(kind,description,clan=-1){
 milestones.unshift({tick:step,kind,description,clan});if(milestones.length>40)milestones.length=40;
}
function createClan(i){
 const ang=i*TAU/11+.28,cx=W*.5+Math.cos(ang)*W*.34,cy=H*.5+Math.sin(ang)*H*.30;
 const lex=WORDS.map(()=>lexeme());const dialect=(rand()*6)|0;
 return{id:i,name:seedClanNames[i],x:cx,y:cy,hue:(i*360/11+between(-12,12)+360)%360,
 members:0,language:lex,dialect,grammar:0,knowledge:0,tech:new Float32Array(DOMAINS.length),
 inventions:[],cities:[],resources:{food:40,material:12,power:4,ideas:0},
 research:0,social:.2,trust:.2,languageAge:0,space:0,launches:0,discovery:0,lastMessage:0,
 innovationSeed:rand(),worldview:(rand()*4)|0,era:0,inventionKeys:new Set(),
 signals:new Map(),signalAttempts:0,signalRewards:0,culturalLearning:0,bioReadiness:0,educated:0,
 parentCulture:-1,architectureStyle:(rand()*8)|0};
}
function grammar(clan,words){
 const w=words.map(k=>clan.language[clamp(k|0,0,WORDS.length-1)]);
 if(clan.grammar===0)return w.join(' ');
 if(clan.grammar===1)return w.slice().reverse().join(' ');
 if(clan.grammar===2)return w.slice(1).concat(w[0]).join('-');
 if(clan.grammar===3)return w.map((x,i)=>i%2?x+'na':x).join(' ');
 if(clan.grammar===4)return w.map((x,i)=>i===1?'o'+x:x).join('.');
 return w.join(' • ');
}
function speech(clan,purpose,meaning,words,context={}){
 if(messages.length>=160)messages.pop();
 let said=grammar(clan,words);
 if(clan.languageAge>3&&rand()<.2){const p=(rand()*clan.language.length)|0;clan.language[p]=lexeme();}
 const m={id:++sentences,tick:step,clan:clan.id,clanName:clan.name,city:clan.cities[0]??null,
 text:said,meaning,purpose,...context};
 messages.unshift(m);
 clan.lastMessage=step;
 return m;
}
function organism(parent=null,clan=null,mate=null){
 const c=parent?clans[parent.clan]:clan||pick(clans);
 const g=parent?{...parent.g,brain:inheritBrain(parent.g.brain)}:
 {hue:mod(c.hue+between(-40,40),360),form:0,
 size:between(.4,1.2),limbs:rand(),cells:1,energyNeed:between(.002,.007),
 speed:between(.2,1),empathy:between(.3,.8),curiosity:between(.3,1),
 speech:between(.2,.75),inventiveness:between(.2,.8),brain:inheritBrain()};
 if(parent){
   if(mate){g.brain=g.brain.map((row,i)=>rand()<.5&&mate.g.brain[i]?
    mate.g.brain[i].map((v,j)=>clamp((v+row[j])*.5+between(-.08,.08),-3,3)):row);}
   for(const k of ['hue','size','limbs','empathy','curiosity','speech','inventiveness','speed']){
    if(mutationEnabled&&rand()<.26)g[k]=k==='hue'?mod(g[k]+between(-35,35),360):clamp(g[k]+between(-.19,.19),0,1.9);
   }
 }
 g.bio=parent?mutationEnabled?G7.child(parent.g.bio,mate?.g.bio):parent.g.bio:G7.founder(g.hue);
 const maturity=parent?.35:0.24;
 const dev=G7.phenotype(g.bio,maturity);
 g.hue=g.bio.pigment;g.cells=Math.min(256,dev.segments);g.form=dev.segments%6;
 g.limbs=dev.appendages;g.size=.45+dev.segments*.026;
 maxCells=Math.max(maxCells,g.cells);
 maxBrain=Math.max(maxBrain,g.brain.length);
 maxGeneticParts=Math.max(maxGeneticParts,g.bio.development.length);
 bodyComplexity=Math.max(bodyComplexity,dev.score);
 const x=mod((parent?.x??c.x)+between(-5,5),W),y=mod((parent?.y??c.y)+between(-5,5),H);
 const nextID=id+1;
 const root=parent?.lineage??nextID;
 let lineage=root;
 if(parent&&mutationEnabled&&G7.distance(parent.g.bio,g.bio)>.51){
  lineage=nextID;lineageBranches++;
  if(ancestry.length<10000)ancestry.push({id:nextID,parent:parent.id,step,gen:parent.gen+1,kind:'branch'});
 }
 const a={id:++id,clan:c.id,x,y,angle:between(0,TAU),g,maturity,body:dev.functions,
  bodyScore:dev.score,lineage,parents:parent?[parent.id,mate?.id||null]:[],root,
  gen:parent?parent.gen+1:0,age:0,energy:parent?.8:between(.6,1.2),xp:0,fitness:0,
  network:new Float32Array(g.brain.length),memory:new Float32Array(4),
  learning:{prediction:0,previous:0,success:0,actions:0,benchmark:0},
  known:parent?parent.known:0,role:(rand()*5)|0,
  attachments:0,production:0,language:0,intent:0,spoken:0};
 agents.push(a);c.members++;maxGen=Math.max(maxGen,a.gen);
 if(parent){
  if(dev.geneticComplexity>(parent.g.bio?.development.length||0))bodyEvents++;
  birthMarks.push({x:a.x,y:a.y,at:clock,id:a.id});
  if(birthMarks.length>50)birthMarks.shift();
 }
 return a;
}
function setup(newSeed){
 rng=(newSeed||123456789)|0;seed=newSeed>>>0;id=0;step=0;clock=0;
 messages=[];inventions=[];milestones=[];flights=[];clans=[];cities=[];agents=[];socialSpeed=1;extraPlanetary=0;
 sexualBirths=0;clonalBirths=0;lineageBranches=0;bodyComplexity=1;maxGeneticParts=0;
 rewardImprovement=0;learningTrials=0;lastBenchmark=null;signalsShared=0;signalSuccess=0;
 ancestry=[];saves=0;environmentChanges=0;benchmarks={trained:0,control:0,improvement:0};biologicalCycles=0;dynamicCycle=0;
 failedPrototypes=0;failedExperiments=[];
 camera={x:140,y:65,zoom:4};birthMarks=[];culturesFounded=0;architectureEvents=0;bodyEvents=0;
 nextAgent=new Int32Array(512);occupancy.fill(-1);nutrition.fill(0);signal.fill(0);
 teaching=0;skillsFound=0;transmissions=0;sentences=0;innovations=0;buildings=0;roadCount=0;
 maxCells=1;maxBrain=3;maxGen=0;individualUpdates=0;updatesPerSecond=0;updateWindow=0;
 birthCredit=0;cycle=null;last=0;lastFrame=0;lastStats=0;lastRateAt=0;rate=0;rateBorn=0;
 rateFactor=1;biologyFactor=1;mutationEnabled=true;learningEnabled=true;cultureEnabled=true;
 for(let i=0;i<SIZE;i++){
   const x=i%W,y=(i/W)|0;
   const field=Math.sin(x*.069+seed*.00000007)*.39+Math.cos(y*.083)*.28+
    Math.sin((x+y)*.039)*.19+Math.sin(x*.15-y*.12)*.17;
   terrain[i]=field<-.38?0:field<.05?1:field<.35?2:3;
   nutrition[i]=between(.28,.58)*soil(x,y);
   temperature[i]=clamp(.5+.4*Math.sin((y/H)*Math.PI*2)+field*.1,.02,.98);
   water[i]=clamp(.5+field*.7+.2*Math.cos(x*.11),0,1);
   sunlight[i]=clamp(.5+.5*Math.cos(y/H*Math.PI*2),.08,1);
 }
 for(let i=0;i<11;i++)clans.push(createClan(i));
 for(let i=0;i<125;i++)organism(null,clans[i%11]);
 addEvent('start','125 unika organismer skapades i elva geografiska grupper.');
}
function eligibleParent(){
 let choice=null,score=-Infinity;
 for(let j=0;j<9;j++){
  const a=agents[(rand()*agents.length)|0];
  if(!a||a.age<a.g.bio.latency||a.energy<.24)continue;
  const val=a.energy*.9+a.fitness*.6+a.xp*.15
   -(a.body.cost||.2)*.13+(a.body.forage||.2)*.18+rand()*.2;
  if(val>score){score=val;choice=a;}
 }
 return choice;
}
function pickMate(parent){
 if(parent.g.bio.reproduction==='clonal'||rand()>parent.g.bio.mating)return null;
 for(let j=0;j<12;j++){
  const mate=agents[(rand()*agents.length)|0];
  if(!mate||mate===parent||mate.age<mate.g.bio.latency||mate.energy<.24)continue;
  if(G7.distance(parent.g.bio,mate.g.bio)<.9)return mate;
 }
 return null;
}
function budgetBirths(dt){
 // Rate target 18 births/s (15–30 configurable); selection is reproductive,
 // not mortality-based. Actual births depend on fitness and eligibility.
 birthCredit+=Math.min(dt,450)*18*rateFactor/1000;
 const count=Math.min(24,Math.floor(birthCredit));
 let born=0;
 for(let j=0;j<count;j++){
  const parent=eligibleParent();
  if(!parent)break;
  const mate=pickMate(parent);
  const extraCost=.11+(parent.body.cost||.1)*.025;
  if(parent.energy<extraCost+.15)continue;
  parent.energy=Math.max(.08,parent.energy-extraCost);
  if(mate)mate.energy=Math.max(.08,mate.energy-extraCost*.4);
  organism(parent,null,mate);if(mate)sexualBirths++;else clonalBirths++;
  rateBorn++;born++;
 }
 birthCredit=Math.min(50,Math.max(0,birthCredit-born));
}
function buildSpatial(){
 if(nextAgent.length<agents.length)nextAgent=new Int32Array(Math.ceil(agents.length*1.3));
 occupancy.fill(-1);
 for(let i=0;i<agents.length;i++){
  const a=agents[i],p=pos(a.x,a.y);nextAgent[i]=occupancy[p];occupancy[p]=i;
 }
}
function near(a){
 const j=pos(a.x+between(-3,3),a.y+between(-3,3));
 let idx=occupancy[j],tries=0;
 while(idx>=0&&tries++<5){const n=agents[idx];if(n!==a)return n;idx=nextAgent[idx]}
 return null;
}
function shapeThought(a,n,food){
 let out=0,last=0,thought=a.network,brain=a.g.brain;
 const stim=[food,(n?.g.empathy||0),signal[pos(a.x,a.y)],a.memory[0],a.energy,a.g.curiosity];
 for(let i=0;i<brain.length;i++){
  const node=brain[i];let v=node[0]*stim[0]+node[1]*stim[1]+node[2]*stim[2]+node[3]*stim[3]+node[4]*thought[i]+node[5]*last;
  const val=Math.tanh(v);thought[i]=thought[i]*.78+val*.22;last=thought[i];out+=i%2?thought[i]:-thought[i];
  if(learningEnabled&&(step+i)%4===0){
   const reward=clamp(food-a.memory[2],-.3,.3);
   node[0]=clamp(node[0]+.0015*a.g.bio.plasticity*reward*val,-2,2);
   node[4]=clamp(node[4]+.0006*a.g.bio.plasticity*reward*thought[i],-2,2);
  }
 }
 a.memory[2]=food;
 return Math.tanh(out/(1+brain.length*.4));
}
function cycleStart(){
 buildSpatial();cycle={index:0,total:agents.length};
 for(let i=0;i<SIZE;i++)if((i&3)===0){
  nutrition[i]=clamp(nutrition[i]+.003*(soil(i%W,(i/W)|0)-nutrition[i]),0,1);
  signal[i]*=.955;
 }
}
function individualTick(a){
 const j=pos(a.x,a.y),food=nutrition[j],n=near(a);
 const thought=shapeThought(a,n,food);
 const envTemp=temperature[j],envWater=water[j];
 const niche=clamp(1-Math.abs(envTemp-(.3+a.g.bio.regulators[0]*.45))*.65+
    (envWater-.5)*a.body.forage*.12,.2,1.3);
 const sensorReach=2.2+a.body.sensing*2.2;
 const angleR=a.angle+.65,angleL=a.angle-.65;
 const l=nutrition[pos(a.x+Math.cos(angleL)*sensorReach,a.y+Math.sin(angleL)*sensorReach)];
 const r=nutrition[pos(a.x+Math.cos(angleR)*sensorReach,a.y+Math.sin(angleR)*sensorReach)];
 a.angle+=(r-l)*.44+thought*.22+between(-.13,.13);
 // Received location information influences real navigation. A signal's
 // usefulness is measured by later resource collection, not by its text.
 if(cultureEnabled&&a.intent&&step-a.spoken<10){
  const tx=a.intent%W,ty=(a.intent/W)|0;
  const dx=tx-a.x,dy=ty-a.y;
  const desired=Math.atan2(dy,dx);
  const difference=Math.atan2(Math.sin(desired-a.angle),Math.cos(desired-a.angle));
  a.angle+=difference*.36*a.g.speech;
 }
 const mv=(.26+a.g.speed*.58)*clamp(a.body.motor,.25,1.8)/(1+a.body.armor*.11);
 a.x=mod(a.x+Math.cos(a.angle)*mv,W);a.y=mod(a.y+Math.sin(a.angle)*mv,H);
 const k=pos(a.x,a.y),take=Math.min(nutrition[k],(.0045+a.body.forage*.002)*niche);
 nutrition[k]-=take;
 const cost=a.g.energyNeed+a.body.cost*.0003+a.g.brain.length*.000025+mv*.00004;
 // Light collection is an ecological niche with an energetic cost tradeoff.
 // Bodies with filtering structures can harvest a small amount of local sunlight.
 const filtered=Math.max(0,(a.body.forage||0)-.2);
 const photoGain=sunlight[j]*filtered*.00065;
 const adapted=take*niche*(.66+a.body.storage*.08)+photoGain;
 a.energy=clamp(a.energy+adapted-cost+.0019,.01,2.7);
 a.fitness=a.fitness*.988+take*.012;
 const outcome=clamp((adapted-cost)*85,-1,1);
 a.learning.actions++;
 a.learning.success=a.learning.success*.975+Math.max(0,outcome)*.025;
 a.learning.prediction=a.learning.prediction*.97+outcome*.03;
 rewardImprovement+=outcome;learningTrials++;
 a.age++;a.xp+=take*.4;
 a.memory[0]=a.memory[0]*.9+(r-l)*.1;
 a.memory[1]=a.memory[1]*.9+thought*.1;
 if(cultureEnabled&&n&&n.clan===a.clan){
  const c=clans[a.clan];
  if(rand()<.05*a.g.empathy){a.attachments++;c.social=clamp(c.social+.0002,0,1);}
  if(rand()<.02*a.g.speech&&c.knowledge&&((c.knowledge&~a.known)!==0)){
   const dif=c.knowledge&~a.known;a.known|=(dif&-dif);teaching++;a.language++;a.xp+=.02;
  }
  if(rand()<.01&&n.known&&!a.known){a.known=n.known;teaching++;}
 }
 const c=clans[a.clan];
 // Civilization's prerequisite is developed organism capabilities, never only elapsed time.
 if(a.age%20===0&&a.g.cells>=2&&a.g.brain.length>=4&&a.fitness>.0001){
  c.bioReadiness=Math.min(40,c.bioReadiness+.012*a.g.curiosity*(Math.min(8,a.g.cells)/3));
  c.educated++;
 }
 if(cultureEnabled&&n&&n.clan===a.clan&&rand()<.021*a.g.speech){
  // A word for a location is useful only if the recipient subsequently finds food.
  const cell=pos(a.x,a.y),key=(cell%17);
  const token=c.language[key]||'';
  const high=nutrition[cell]>.3;
  if(high){
   n.intent=cell;n.spoken=step;signalsShared++;c.signalAttempts++;
   if(signalsShared<20||signalsShared%100===0){
    speech(c,'resursignal','En individ skickade en resursposition som påverkar en annan organisms navigering.',
      [0,2,3,14,5],{speaker:a.id,listener:n.id,position:cell});
   }
   c.signals.set(token,(c.signals.get(token)||0)+1);
  }
 }
 if(a.intent&&step-a.spoken<10&&Math.abs((a.intent%W)-a.x)<2&&Math.abs(((a.intent/W)|0)-a.y)<2&&take>.0015){
  signalSuccess++;c.signalRewards++;a.intent=0;a.xp+=.16;
 }
 if(a.role===0)c.resources.food+=take*.22;
 if(a.role===1)c.resources.material+=take*.17;
 if(a.role===2)c.resources.ideas+=a.g.inventiveness*.0007;
 if(a.role===3)c.resources.power+=take*.008;
 // Somatic growth follows inherited body plan. No genetically uncaused new cells.
 if(a.age%30===0&&a.maturity<1){
  a.maturity=Math.min(1,a.maturity+.085);
  const grown=G7.phenotype(a.g.bio,a.maturity);
  a.body=grown.functions;a.bodyScore=grown.score;a.g.cells=grown.segments;
  maxCells=Math.max(maxCells,grown.segments);
 }
 if(a.age%85===0&&a.g.brain.length<28&&mutationEnabled&&rand()<(.03+.04*a.g.bio.brainGrowth)*a.g.curiosity){
  a.g.brain.push(Array.from({length:6},()=>between(-1,1)));
  const states=new Float32Array(a.g.brain.length);states.set(a.network);a.network=states;
  maxBrain=Math.max(maxBrain,a.g.brain.length);
 }
 if(a.age%70===0&&rand()<.11){a.role=(a.role+1+((rand()*4)|0))%5;}
}
function stepIndividuals(){
 if(!cycle)cycleStart();
 const start=performance.now();
 let done=0;
 while(cycle.index<cycle.total){
  individualTick(agents[cycle.index++]);done++;individualUpdates++;updateWindow++;
  if((done&63)===0&&performance.now()-start>7)break;
 }
 if(cycle.index>=cycle.total){
  cycle=null;step++;biologicalCycles++;
  if(step%150===0){
   dynamicCycle++;
   const x=(dynamicCycle*29+seed%W)%W,y=(dynamicCycle*17+seed%H)%H;
   const cell=pos(x,y);
   temperature[cell]=clamp(temperature[cell]+between(-.2,.2),0,1);
   water[cell]=clamp(water[cell]+between(-.22,.22),0,1);
   nutrition[cell]=clamp(nutrition[cell]+.32,0,1);
   environmentChanges++;
  }
  if(step%180===0){
   lastBenchmark=G7.evaluateForage(.25+Math.min(.65,(agents.at(-1)?.g.bio.plasticity||.4)),seed^step);
   benchmarks=lastBenchmark;
  }
 }
}
function gainSkill(c,k){
 const t=c.tech,threshold=k<5?0.18:k<9?0.33:k<13?0.50:0.68;
 if(t[k]>=threshold)return false;
 // Actual prerequisite dependencies, not a preprogrammed era triggered by timer.
 const req=[
 [],[0],[0],[1,2],[2,3],[0,1],[1,3],[5,6],[2,3],[4,8],
 [8,9],[5,7,9],[10,11],[12,11],[11,13],[9,13,14]
 ];
 if(req[k].some(j=>t[j]<.16))return false;
 t[k]=Math.min(1,t[k]+.06+rand()*.06);
 if(t[k]>=threshold){
  c.knowledge|=bit(k);skillsFound++;c.discovery++;
  const conceptToken=(k+2)%WORDS.length;
  speech(c,'upptäckt',c.name+' utvecklade '+DOMAINS[k].toLowerCase()+' genom arbete och delning av idéer.',[0,20,conceptToken,1],{tech:k});
  addEvent('skill',c.name+' utvecklade kunskap inom '+DOMAINS[k]+'.',c.id);
 }
 return true;
}
function cityName(c){return c.name+'-'+pick(['ara','os','en','kal','ima','tor','esh']);}
function foundingSite(c){
 for(let j=0;j<32;j++){
  const anchor=c.cities.length?cities[pick(c.cities)-1]:null;
  const x=mod((anchor?.x??c.x)+between(-29,29),W);
  const y=mod((anchor?.y??c.y)+between(-23,23),H);
  if(nutrition[pos(x,y)]+.3*water[pos(x,y)]<.23)continue;
  if(cities.some(t=>Math.hypot(t.x-x,t.y-y)<7.2))continue;
  return{x,y};
 }
 return null;
}
function foundCity(c){
 if(c.tech[1]<.16||c.tech[3]<.16||c.resources.material<6)return false;
 const location=foundingSite(c);if(!location)return false;
 const city={id:cities.length+1,clan:c.id,name:cityName(c),x:location.x,y:location.y,
  level:1,structures:1,homes:2,farms:0,observatories:0,shipyards:0,library:0,
  workshops:0,power:0,roads:0,wealth:2,stored:0,land:1,style:c.architectureStyle,
  projects:[],project:0,inventions:[],messages:[],population:0,founded:step,sky:0};
 c.cities.push(city.id);cities.push(city);c.resources.material-=5;
 buildings+=3;architectureEvents++;
 speech(c,'grundande',c.name+' grundade '+city.name+' med två hem.',[0,3,4,5],{city:city.id});
 addEvent('city','NY BY: '+city.name+' grundades och två hem byggdes.',c.id);
 return true;
}
function expandCity(c){
 if(!c.cities.length){foundCity(c);return;}
 const city=cities[pick(c.cities)-1];
 if(!city||c.resources.material<1.4)return;
 c.resources.material-=1.4;
 let x=rand();
 if(x<.30){city.homes+=1+((rand()*3)|0);city.structures++;city.land+=.035;}
 else if(x<.49){city.workshops++;c.resources.material+=.8;}
 else if(x<.64){city.farms++;c.resources.food+=1.5;nutrition[pos(city.x,city.y)]=clamp(nutrition[pos(city.x,city.y)]+.06,0,1);}
 else if(x<.78){city.library++;c.research+=.4;}
 else if(x<.90){city.power++;c.resources.power+=.9;}
 else if(x<.96){city.observatories++;c.research+=.65;}
 else{
  city.shipyards++;
  const base=c.inventions.length?inventions[pick(c.inventions)-1]:null;
  city.projects.push({id:city.projects.length+1,
    name:'Experiment '+lexeme()+' '+(base?.effect||'nyskaping'),origin:base?.id||null,step});
  city.project++;
 }
 buildings++;architectureEvents++;
 const size=(city.homes||0)+city.structures+city.workshops+city.library+
  city.power+city.farms+city.observatories+city.shipyards+city.project;
 const level=Math.max(1,1+Math.floor(Math.log2(1+size/3)));
 if(level>city.level){city.level=level;
  if(level%2===0)addEvent('city',city.name+' växte till stadsnivå '+level+'.',c.id);}
 if(city.farms&&rand()<.16){
  const p=pos(city.x+between(-2,2),city.y+between(-2,2));
  nutrition[p]=clamp(nutrition[p]+.12,0,1);
 }
 city.wealth+=.3;city.population=Math.floor(c.members/c.cities.length);
}
function developCity(c){expandCity(c);}
function compoundName(c,k1,k2,effect){
 const a=COMPONENTS[k1],b=COMPONENTS[k2],e=EFFECTS[effect];
 return (a.slice(0,Math.min(4,a.length))+b.slice(0,Math.min(5,b.length))+'-'+e).toLowerCase();
}
function invent(c){
 if(!c.cities.length||c.resources.material<2.8||c.resources.power<1.0)return;
 const known=[];
 // Technical building blocks arise from both material knowledge and cultural techniques.
 for(let i=0;i<COMPONENTS.length;i++){
  const mapped=[8,8,8,10,9,9,4,15,0,11,11,7,9,9,11,8,10,2,12,0,8,13][i];
  if(c.tech[mapped]>.18)known.push(i);
 }
 if(known.length<2)return;
 let a=pick(known),b=pick(known),effect=(rand()*EFFECTS.length)|0;
 if(a===b)b=known[(known.indexOf(b)+1)%known.length];
 // Complex effects have hard knowledge prerequisites; they are not conjured by random names.
 if(effect===8&&c.tech[15]<.22)return;
 if(effect===12&&c.tech[11]<.20)return;
 if(effect===11&&c.tech[10]<.20)return;
 if(effect===7&&c.tech[13]<.2)return;
 const parents=c.inventions.length>2&&rand()<.62?
   [pick(c.inventions),pick(c.inventions)]:[];
 // Distinct lineages create genuinely new synthesis candidates even after
 // every basic two-part combination has been tried. Hash lookups stay O(1).
 const depth=Math.floor(Math.log2(c.inventions.length+2));
 const fingerprint=[Math.min(a,b),Math.max(a,b),effect,depth,...parents].join(':');
 if(c.inventionKeys.has(fingerprint))return;
 const complexity=1+Math.floor(Math.log2(c.inventions.length+1))+(parents.length?1:0);
 const experimentCost=1.1+complexity*.18;
 if(c.resources.material<experimentCost||c.resources.power<.7+complexity*.08)return;
 // Spend prototype resources before measuring function. Failures do NOT become
 // successful inventions, but the scientific record preserves them.
 const scored=T7.prototype(a,b,effect,
   (c.tech[8]+c.tech[9]+c.tech[11]+c.tech[15])/4,complexity,parents);
 c.resources.material-=experimentCost;
 c.resources.power-=.7+complexity*.08;
 if(!scored.success){
  failedPrototypes++;
  c.research+=.18+scored.score*.3;
  failedExperiments.unshift({tick:step,clan:c.id,parts:[COMPONENTS[a],COMPONENTS[b]],
   effect:EFFECTS[effect],complexity,result:scored});
  if(failedExperiments.length>180)failedExperiments.pop();
  return;
 }
 const inv={id:inventions.length+1,key:fingerprint,clan:c.id,tick:step,test:scored,
  name:compoundName(c,a,b,effect)+(parents.length?' · '+lexeme():''),parts:[COMPONENTS[a],COMPONENTS[b]],effect:EFFECTS[effect],
  complexity,parents,uses:0,detail:'Kombination av '+COMPONENTS[a]+' och '+COMPONENTS[b]+' för '+EFFECTS[effect]+'.',
  type:effect===8?'framdrift':effect===10?'koordination':'uppfinning'};
 inventions.push(inv);c.inventions.push(inv.id);c.inventionKeys.add(fingerprint);innovations++;
 const location=cities.find(city=>city.clan===c.id);
 if(location){location.inventions.push(inv.id);if(location.inventions.length>36)location.inventions.shift();}
 speech(c,'uppfinning',c.name+' skapade '+inv.name+' genom att kombinera '+inv.parts.join(' och ')+'.',
  [0,20,2,9,11],{invention:inv.id,city:location?.id||null});
 addEvent('invention',c.name+' skapade '+inv.name+'.',c.id);
 // Each invention contributes a domain-specific, measurable in-simulation benefit.
 if(effect===3||effect===10)c.research+=1+complexity*.18; // control / coordination
 if(effect===9)c.resources.material+=2.8+complexity*.45; // production infrastructure pays back
 if(effect===4||effect===5)c.resources.power+=1.4+complexity*.2;
 if(effect===0)c.resources.food+=2.4;
 if(effect===1||effect===11||effect===12)c.resources.ideas+=.5+complexity*.25;
 inv.uses++;
}
function attemptSpace(c){
 if(c.space>0){
  if(c.space>=1&&c.resources.power>=16&&c.resources.material>=14&&rand()<.015&&flights.length<25){
   // A mature culture may construct more vehicles instead of stopping at one.
   c.space=0;
  }else return;
 }
 const needed=[8,9,11,12,13,14,15]; // metallurgy, energy, computation, astronomy, navigation, autonomy, propulsion
 if(needed.some(k=>c.tech[k]<.30))return;
 if(c.inventions.length<14||!c.cities.some(id=>cities[id-1]?.level>=3))return;
 if(c.resources.power<10||c.resources.material<10)return;
 const good=c.inventions.map(id=>inventions[id-1]).filter(x=>x?.complexity>=3&&x.type==='framdrift');
 if(good.length<1)return;
 c.space=1;c.resources.power-=10;c.resources.material-=10;
 const city=cities[c.cities[0]-1],flight={id:flights.length+1,clan:c.id,name:c.name+'-farkost '+(c.launches+1),
  x:city?.x??c.x,y:city?.y??c.y,progress:0,angle:rand()*TAU,created:step};
 flights.push(flight);c.launches++;
 speech(c,'rymdfart',c.name+' konstruerade '+flight.name+' av framdrift, energi, navigation och automatisering.',
  [0,3,21,10,15],{flight:flight.id,city:city?.id});
 addEvent('space',c.name+' byggde en experimentell rymdfarkost!',c.id);
}
function advanceFlight(){
 for(const f of flights){
  if(f.progress>=1){if(!f.arrived){f.arrived=true;extraPlanetary++;
    const c=clans[f.clan];
    speech(c,'rymdfart',f.name+' nådde sin simulerade utforskningsgräns och skickade tillbaka data.',[0,21,10,14,11],{flight:f.id});
    addEvent('space',f.name+' nådde fram och rapporterade upptäckter.',f.clan);
   }continue;}
  f.progress=Math.min(1,f.progress+.0007);
  f.x=mod(f.x+Math.cos(f.angle)*.28,W);
  f.y=mod(f.y+Math.sin(f.angle)*.28,H);
 }
}
function culturalFission(){
 // A new identity can form from an existing community. Individuals remain alive.
 const candidates=clans.filter(c=>c.members>=55&&c.cities.length>=1&&c.bioReadiness>4);
 if(!candidates.length)return false;
 const parent=pick(candidates),index=clans.length;
 const group=createClan(index);group.parentCulture=parent.id;
 group.name=lexeme().slice(0,1).toUpperCase()+lexeme()+'-'+index;
 group.hue=mod(parent.hue+between(22,110),360);
 group.x=mod(parent.x+between(-24,24),W);group.y=mod(parent.y+between(-20,20),H);
 group.language=parent.language.map(word=>rand()<.3?lexeme():word);
 group.grammar=(parent.grammar+1+((rand()*5)|0))%6;
 group.tech=new Float32Array(parent.tech);
 group.knowledge=parent.knowledge;group.bioReadiness=parent.bioReadiness*.78;
 group.social=parent.social*.8;
 group.resources={food:Math.max(4,parent.resources.food*.09),
  material:Math.max(5,parent.resources.material*.12),
  power:Math.max(2,parent.resources.power*.09),
  ideas:parent.resources.ideas*.1};
 const desired=Math.min(65,Math.max(15,Math.floor(parent.members*.1)));
 let migrated=0;const moved=[];
 const start=(index*137)%agents.length;
 for(let k=0;k<agents.length&&migrated<desired;k++){
  const a=agents[(start+k)%agents.length];
  if(a.clan!==parent.id)continue;
  moved.push(a);a.clan=index;migrated++;
 }
 if(migrated<7){
  // An aborted split must NOT leave organisms pointing to a nonexistent clan.
  for(const a of moved)a.clan=parent.id;
  return false;
 }
 for(const a of moved){a.x=mod(a.x+between(-1.5,1.5),W);a.y=mod(a.y+between(-1.5,1.5),H);}
 group.members=migrated;parent.members-=migrated;clans.push(group);
 parent.resources.material=Math.max(0,parent.resources.material-group.resources.material);
 parent.resources.food=Math.max(0,parent.resources.food-group.resources.food);
 culturesFounded++;
 addEvent('culture',group.name+' bröt sig ut ur '+parent.name+' med '+migrated+' individer.',group.id);
 return true;
}
function societalAction(){
 // Wall-clock social evolution proceeds independently of full organism biology ticks.
 for(const c of clans){
  const t=c.tech;
  const readiness=clamp(c.bioReadiness/14,0,1);
  c.resources.food+=.07+c.members*.00016;
  c.resources.material+=.72+c.members*.018+c.cities.reduce((sum,id)=>sum+(cities[id-1]?.workshops||0)*.07,0);
  c.resources.power+=.03+c.cities.length*.016;
  const researcher=c.members*.012+c.social*.55+c.resources.ideas*.003+c.cities.length*.12;
  // Genuine biological prerequisite: simple cells cannot automatically
  // research metallurgy, optics or spaceflight through a wall timer.
  c.research+=researcher*between(.6,1.3)*readiness;
  if(readiness<.07)continue;
  c.social=clamp(c.social+.0006*c.members/30,0,1);
  // Research efforts select among feasible domains with preference weighted by worldview.
  if(c.research>=3.5){
   c.research-=3.5;
   const feasible=[];
   for(let k=0;k<DOMAINS.length;k++){
    const gate=[[],[0],[0],[1,2],[2,3],[0,1],[1,3],[5,6],[2,3],[4,8],[8,9],[5,7,9],[10,11],[12,11],[11,13],[9,13,14]][k];
    if(gate.every(j=>t[j]>=.16)&&t[k]<1)feasible.push(k);
   }
   if(feasible.length){
    const k=rand()<.8?feasible[(rand()*Math.min(feasible.length,5))|0]:pick(feasible);
    gainSkill(c,k);
   }
  }
  if(readiness>.24&&c.tech[3]>.16&&c.tech[1]>.16&&rand()<(.010/(1+.13*c.cities.length)))foundCity(c);
  if(readiness>.24&&c.cities.length&&rand()<(.22+.02*Math.log2(1+c.cities.length)))developCity(c);
  if(readiness>.24&&c.cities.length&&rand()<.05/(1+c.inventions.length/55))invent(c);
  if(readiness>.2&&c.cities.length&&rand()<.032&&c.tech[5]>.16){
   c.grammar=(c.grammar+1+((rand()*5)|0))%6;c.languageAge++;
   speech(c,'språk','Språket i '+c.name+' förändrades genom nya grammatiska former.',[0,22,11,17]);
  }
  if(rand()<.045&&c.tech[0]>.16){
   speech(c,'samtal',pick([
    c.name+' delar en observation om energin i området.',
    c.name+' efterfrågar samarbete kring en byggnad.',
    c.name+' diskuterar ett okänt mönster i naturen.',
    c.name+' för vidare en metod till nästa generation.'
   ]),[0,(rand()*WORDS.length)|0,(rand()*WORDS.length)|0,(rand()*WORDS.length)|0]);
  }
  attemptSpace(c);
 }
 // Cultural branching can create new languages and social structures.
 if(cultureEnabled&&rand()<.0045) culturalFission();
 // Inter-clan cultural exchange, diplomacy and borrowing.
 if(rand()<.4){
  const a=pick(clans),b=pick(clans);if(a!==b&&a.cities.length&&b.cities.length){
   const k=(rand()*DOMAINS.length)|0;
   if(a.tech[k]>b.tech[k]+.11){
    b.tech[k]=Math.max(b.tech[k],a.tech[k]*between(.35,.85));transmissions++;
    speech(a,'handel',a.name+' lärde '+b.name+' något om '+DOMAINS[k].toLowerCase()+'.',
     [0,23,1,5,14],{otherClan:b.id});
   }
  }
 }
 advanceFlight();
}
function metrics(){
 return{count:agents.length,rate,gen:maxGen,brain:maxBrain,cells:maxCells,ticks:step,
  updates:updatesPerSecond,progress:cycle?cycle.index:agents.length,progressTotal:cycle?cycle.total:agents.length,
  cities:cities.length,buildings,inventions:inventions.length,messages:sentences,teaching,transmissions,socialSpeed,spaceDiscoveries:extraPlanetary,
  launchCount:flights.length,achievements:skillsFound,cultures:clans.filter(c=>c.knowledge).length,
 totalClans:clans.length,culturesFounded,architectureEvents,bodyEvents,totalHomes:cities.reduce((x,c)=>x+(c.homes||0),0),
 biologicalCultureReadiness:clans.reduce((sum,c)=>sum+clamp(c.bioReadiness/14,0,1),0)/clans.length,
 reproductionTarget:18*rateFactor,sexualBirths,clonalBirths,lineageBranches,
 geneticParts:maxGeneticParts,bodyComplexity,environmentChanges,signalsShared,signalSuccess,failedPrototypes,
 biologyFactor,rateFactor,cultureEnabled,learningEnabled,mutationEnabled,
 benchmark:benchmarks,biologicalCycles};
}
function siteSummary(city){
 const c=clans[city.clan];
 return{id:city.id,name:city.name,clan:city.clan,clanName:c.name,x:city.x,y:city.y,hue:c.hue,
 homes:city.homes||0,farms:city.farms||0,observatories:city.observatories||0,
 shipyards:city.shipyards||0,projects:city.project||0,style:city.style||0,
  level:city.level,structures:city.structures,library:city.library,workshops:city.workshops,
  power:city.power,wealth:city.wealth,people:c.members,tech:Array.from(c.tech,x=>Math.round(x*100)/100),knowledge:c.knowledge,
  population:Math.floor(c.members/Math.max(1,c.cities.length)),bioReadiness:c.bioReadiness,
  discoveries:c.inventions.length,language:c.languageAge,grammar:c.grammar,flights:c.launches};
}
function details(id){
 const city=cities.find(x=>x.id===id);if(!city)return null;
 const c=clans[city.clan];
 return{...siteSummary(city),recentInventions:c.inventions.slice(-14).reverse().map(i=>inventions[i-1]),
  messages:messages.filter(m=>m.clan===city.clan).slice(0,16),
  resources:{...c.resources},languageWords:c.language.slice(0,15),
  history:milestones.filter(m=>m.clan===c.id).slice(0,12)};
}
function render(){
 // FULL population is processed by the worker. The camera receives only
 // organisms currently inside its region, as real developmental morphologies.
 const visible=[],cap=128,viewW=W/camera.zoom,viewH=H/camera.zoom;
 const left=camera.x-viewW*.5,right=camera.x+viewW*.5;
 const top=camera.y-viewH*.5,bottom=camera.y+viewH*.5;
 let inView=0,newestVisible=null;
 for(let i=0;i<agents.length;i++){
  const a=agents[i];
  if(a.x<left||a.x>right||a.y<top||a.y>bottom)continue;
  inView++;
  if(i===agents.length-1)newestVisible=a;
  if(visible.length<cap)visible.push(a);
  else{
   const replacementIndex=Math.floor(rand()*inView);
   if(replacementIndex<cap)visible[replacementIndex]=a;
  }
 }
 if(newestVisible&&!visible.includes(newestVisible)&&visible.length)visible[visible.length-1]=newestVisible;
 const creatures=visible.map(a=>{
  const morph=G7.phenotype(a.g.bio,a.maturity);
  return{id:a.id,x:a.x,y:a.y,heading:a.angle,gen:a.gen,clan:a.clan,
   color:morph.color,segments:morph.segments,eyes:morph.eyes,
   limbs:morph.appendages,energy:a.energy,geneticParts:morph.geneticComplexity,
   maturity:a.maturity,nodes:morph.nodes.slice(0,60)};
 });
 const sampleCount=Math.min(agents.length,640),sample=new Uint8Array(sampleCount*4);
 for(let k=0;k<sampleCount;k++){
  const index=Math.min(agents.length-1,Math.floor((k+.5)*agents.length/sampleCount));
  const a=agents[index],o=k*4;
  sample[o]=clamp((a.x/W*255)|0,0,255);
  sample[o+1]=clamp((a.y/H*255)|0,0,255);
  sample[o+2]=a.clan%255;sample[o+3]=a.g.form||0;
 }
 const summaries=cities.length<600?cities.map(siteSummary):
  cities.filter((_,i)=>i%Math.ceil(cities.length/600)===0).map(siteSummary);
 const paths=[];
 // Bounded visual road derivation. Social geography is never capped.
 for(let i=0;i<summaries.length&&i<350;i++){
  let linked=0;
  for(let j=i+1;j<summaries.length&&j<350;j++){
   const a=summaries[i],b=summaries[j];
   const dx=a.x-b.x,dy=a.y-b.y;
   if(dx*dx+dy*dy<270&&a.level+b.level>=4){
    paths.push([a.id,b.id]);linked++;
    if(linked>=3)break;
   }
  }
 }
 const craft=flights.slice(-24).map(f=>({x:f.x,y:f.y,id:f.id,
  name:f.name,progress:f.progress,clan:f.clan}));
 const newest=agents.at(-1),chain=[];
 let cursor=newest,guard=0;
 while(cursor&&guard++<512){chain.push(cursor);cursor=cursor.parents?.[0]?agents[cursor.parents[0]-1]:null;}
 chain.reverse();
 const pickIDs=[0,Math.floor((chain.length-1)/3),Math.floor((chain.length-1)*2/3),chain.length-1];
 const seen=new Set();
 const picks=pickIDs.map(i=>chain[i]).filter(a=>a&&!seen.has(a.id)&&seen.add(a.id));
 const specimens=picks.map((a,index)=>{
  const morph=G7.phenotype(a.g.bio,a.maturity);
  return{id:a.id,gen:a.gen,clan:a.clan,parents:a.parents,lineage:a.lineage,
   role:index===0?'URSPRUNG':index===picks.length-1?'NUVARANDE':index===1?'FÖRFADER':'MELLANLED',
   eyes:morph.eyes,appendages:morph.appendages,segments:morph.segments,
   nodes:morph.nodes.slice(0,85),body:morph.functions,color:morph.color,
   genes:a.g.bio.development.length,brain:a.g.brain.length,
   learning:+a.learning.success.toFixed(3)};
 });
 // Small birth history, no need to transmit or paint the full individual list.
 birthMarks=birthMarks.filter(b=>clock-b.at<4200);
 postMessage({type:'frame',metrics:{...metrics(),inView,displayed:creatures.length,
   births:sexualBirths+clonalBirths},camera:{...camera},
  creatures,births:birthMarks.slice(-25),sample,sites:summaries,paths,craft,
  messages:messages.slice(0,35),discoveries:inventions.slice(-28).reverse(),specimens,
  events:milestones.slice(0,14),clans:clans.map(c=>({id:c.id,name:c.name,hue:c.hue,
   people:c.members,knowledge:bits(c.knowledge),inventions:c.inventions.length,
   cities:c.cities.length,languageAge:c.languageAge,parentCulture:c.parentCulture}))},
  [sample.buffer]);
}
function saveSnapshot(){
 return {
  version:V7_VERSION,seed,rng,id,step,clock,
  agents,clans,cities,messages,inventions,milestones,flights,ancestry,
  nutrition,signal,terrain,temperature,water,sunlight,occupancy,nextAgent,cycle,
  birthCredit,rate,rateBorn,rateFactor,biologyFactor,socialSpeed,
  cultureEnabled,mutationEnabled,learningEnabled,
  teaching,skillsFound,transmissions,sentences,innovations,buildings,roadCount,
  maxCells,maxBrain,maxGen,maxGeneticParts,bodyComplexity,
  sexualBirths,clonalBirths,lineageBranches,signalsShared,signalSuccess,
  rewardImprovement,learningTrials,lastBenchmark,benchmarks,environmentChanges,
  extraPlanetary,biologicalCycles,saves,failedPrototypes,failedExperiments,
 camera,birthMarks,culturesFounded,architectureEvents,bodyEvents
 };
}
function restoreSnapshot(s){
 if(!s||(s.version!==V7_VERSION&&s.version!=='7.0.0')||!Array.isArray(s.agents)||!Array.isArray(s.clans))
  throw Error('Ogiltig sparfil eller fel version av livsmotorn.');
 const names=['seed','rng','id','step','clock','agents','clans','cities','messages','inventions',
  'milestones','flights','ancestry','nutrition','signal','terrain','temperature','water',
  'sunlight','occupancy','nextAgent','cycle','birthCredit','rate','rateBorn','rateFactor',
  'biologyFactor','socialSpeed','cultureEnabled','mutationEnabled','learningEnabled',
  'teaching','skillsFound','transmissions','sentences','innovations','buildings','roadCount',
  'maxCells','maxBrain','maxGen','maxGeneticParts','bodyComplexity','sexualBirths',
  'clonalBirths','lineageBranches','signalsShared','signalSuccess','rewardImprovement',
  'learningTrials','lastBenchmark','benchmarks','environmentChanges','extraPlanetary',
  'biologicalCycles','saves'];
 // Restore by explicit assignments (no eval or dynamic global writes).
 seed=s.seed;rng=s.rng;id=s.id;step=s.step;clock=s.clock;
 agents=s.agents;clans=s.clans;cities=s.cities;messages=s.messages;
 inventions=s.inventions;milestones=s.milestones;flights=s.flights;ancestry=s.ancestry;
 nutrition=s.nutrition;signal=s.signal;terrain=s.terrain;
 temperature=s.temperature;water=s.water;sunlight=s.sunlight;
 occupancy=s.occupancy;nextAgent=s.nextAgent;cycle=s.cycle;
 birthCredit=s.birthCredit;rate=s.rate;rateBorn=s.rateBorn;
 rateFactor=s.rateFactor;biologyFactor=s.biologyFactor;socialSpeed=s.socialSpeed;
 cultureEnabled=s.cultureEnabled;mutationEnabled=s.mutationEnabled;
 learningEnabled=s.learningEnabled;teaching=s.teaching;skillsFound=s.skillsFound;
 transmissions=s.transmissions;sentences=s.sentences;innovations=s.innovations;
 buildings=s.buildings;roadCount=s.roadCount;maxCells=s.maxCells;maxBrain=s.maxBrain;
 maxGen=s.maxGen;maxGeneticParts=s.maxGeneticParts;bodyComplexity=s.bodyComplexity;
 sexualBirths=s.sexualBirths;clonalBirths=s.clonalBirths;lineageBranches=s.lineageBranches;
 signalsShared=s.signalsShared;signalSuccess=s.signalSuccess;
 rewardImprovement=s.rewardImprovement;learningTrials=s.learningTrials;
 lastBenchmark=s.lastBenchmark;benchmarks=s.benchmarks;
 environmentChanges=s.environmentChanges;extraPlanetary=s.extraPlanetary;
 biologicalCycles=s.biologicalCycles;saves=s.saves;
 camera=s.camera||{x:140,y:65,zoom:4};birthMarks=s.birthMarks||[];
 culturesFounded=s.culturesFounded||0;architectureEvents=s.architectureEvents||0;bodyEvents=s.bodyEvents||0;
 failedPrototypes=s.failedPrototypes||0;failedExperiments=s.failedExperiments||[];
 last=0;lastFrame=0;lastStats=0;lastRateAt=0;updateWindow=0;
 if(!nextAgent||nextAgent.length<agents.length)nextAgent=new Int32Array(Math.max(512,agents.length));
 if(!(temperature instanceof Float32Array))temperature=new Float32Array(temperature);
 if(!(water instanceof Float32Array))water=new Float32Array(water);
 if(!(sunlight instanceof Float32Array))sunlight=new Float32Array(sunlight);
 if(!(occupancy instanceof Int32Array))occupancy=new Int32Array(occupancy);
 if(!(nextAgent instanceof Int32Array))nextAgent=new Int32Array(nextAgent);
 if(!(nutrition instanceof Float32Array))nutrition=new Float32Array(nutrition);
 if(!(signal instanceof Float32Array))signal=new Float32Array(signal);
 for(const a of agents){
  if(!(a.network instanceof Float32Array))a.network=new Float32Array(a.network);
  if(!(a.memory instanceof Float32Array))a.memory=new Float32Array(a.memory);
 }
}
function integrity(){
 let uniq=true,hasBio=true,validLinks=true,distinctBrains=true;
 for(let j=0;j<agents.length;j++){
  const a=agents[j];
  if(a.id!==j+1)uniq=false;
  if(!a.g.bio||!a.body)hasBio=false;
  if(a.parents.some(p=>p!==null&&(p<1||p>=a.id)))validLinks=false;
  if(j&&a.network===agents[j-1].network)distinctBrains=false;
 }
 return{count:agents.length,uniqueSequentialIDs:uniq,genomesPresent:hasBio,
  validParentLinks:validLinks,individualNeuralArrays:distinctBrains,
  noDeathsOrArchiving:true,mutatedLineages:lineageBranches};
}
let timer=null;
function heartbeat(){
 if(!live||paused)return;
 const now=performance.now(),dt=last?clamp(now-last,0,600):24;last=now;clock+=dt;
 budgetBirths(dt);
 try{
  for(let i=0;i<biologyFactor;i++)stepIndividuals();
  if(clock-lastStats>190){
   // Fast-forward cultural deliberation without duplicating biological individuals.
   if(cultureEnabled)for(let i=0;i<socialSpeed;i++)societalAction();
   lastStats=clock;
  }
  if(clock-lastFrame>280){render();lastFrame=clock;}
  if(!lastRateAt)lastRateAt=clock;
  if(clock-lastRateAt>1000){rate=+(rateBorn/((clock-lastRateAt)/1000)).toFixed(1);updatesPerSecond=Math.round(updateWindow/((clock-lastRateAt)/1000));rateBorn=0;updateWindow=0;lastRateAt=clock;}
 }catch(e){paused=true;postMessage({type:'error',message:e.message});return;}
 timer=setTimeout(heartbeat,22);
}
onmessage=event=>{
 const m=event.data||{};
 if(m.type==='start'){
  if(timer!==null)clearTimeout(timer);const supplied=m.seed||((Math.random()*4294967295)>>>0);
  setup(supplied);live=true;paused=false;last=0;clock=0;render();
  postMessage({type:'ready',seed,baseline:125});heartbeat();
 }else if(m.type==='pause'){
  paused=true;if(timer!==null){clearTimeout(timer);timer=null;}postMessage({type:'paused'});
 }else if(m.type==='resume'){
  if(!live)return;if(timer!==null)clearTimeout(timer);last=0;paused=false;heartbeat();
 }else if(m.type==='setRate'){
  rateFactor=clamp(+m.value||1,.25,2);
  postMessage({type:'settings',rateFactor,biologyFactor});
 }else if(m.type==='setBiology'){
  biologyFactor=clamp(+m.value||1,1,3);
  postMessage({type:'settings',rateFactor,biologyFactor});
 }else if(m.type==='ablation'){
  const key=m.key;
  if(key==='learning')learningEnabled=!!m.enabled;
  if(key==='mutation')mutationEnabled=!!m.enabled;
  if(key==='culture')cultureEnabled=!!m.enabled;
  postMessage({type:'ablation',learningEnabled,mutationEnabled,cultureEnabled});
 }else if(m.type==='checkpoint'){
  try{saves++;postMessage({type:'checkpoint',data:saveSnapshot()});}
  catch(e){postMessage({type:'error',message:'Sparningen misslyckades: '+e.message});}
 }else if(m.type==='restore'){
  try{
   if(timer!==null)clearTimeout(timer);
   restoreSnapshot(m.data);
   live=true;paused=false;last=0;render();
   postMessage({type:'ready',seed,baseline:agents.length,restored:true});
   heartbeat();
  }catch(e){postMessage({type:'error',message:'Återställning misslyckades: '+e.message});}
 }else if(m.type==='integrity'){
  postMessage({type:'integrity',result:integrity()});
 }else if(m.type==='camera'){
  const v=m.view||{};
  camera={x:clamp(+v.x||0,0,W),y:clamp(+v.y||0,0,H),zoom:clamp(+v.zoom||4,1,14)};
  render();
 }else if(m.type==='inspectOrganism'){
  const a=agents[(+m.id||1)-1];
  postMessage({type:'organismDetail',id:m.id,agent:a?
    {id:a.id,gen:a.gen,clan:a.clan,parents:a.parents,lineage:a.lineage,
     genome:a.g.bio,body:G7.phenotype(a.g.bio,a.maturity),memory:Array.from(a.memory),
     brain:a.g.brain,fitness:a.fitness,learning:a.learning,
     lineagePath:(function(){const path=[];let current=a,safety=0;
      while(current&&safety++<128){
       path.push({id:current.id,gen:current.gen,genes:current.g.bio.development.length});
       current=current.parents[0]?agents[current.parents[0]-1]:null;
      }
      return path.reverse();
     })()}:null});
 }else if(m.type==='setSpeed'){
  socialSpeed=m.fast?4:1;
  postMessage({type:'speed',value:socialSpeed});
 }else if(m.type==='export'){
  // Export research evidence and causal parent IDs, not the entire unlimited agent heap.
  const journal={format:'KOSMOSSCAN-LIFE-V7-RESEARCH-JOURNAL',seed,generatedAt:new Date().toISOString(),
   interpretation:'A rule-based artificial-life simulation, not an observation of real extraterrestrial intelligence.',
   metrics:metrics(),lineages:ancestry,benchmark:benchmarks,
   clans:clans.map(c=>({id:c.id,name:c.name,population:c.members,
    words:c.language,grammar:c.grammar,tech:Array.from(c.tech),resources:{...c.resources},
    inventions:c.inventions,settlements:c.cities,launches:c.launches})),
   cities:cities.map(siteSummary),inventions:inventions.slice(-4500),
   messages:messages.slice(),history:milestones.slice(),spacecraft:flights.slice(),failedExperiments:failedExperiments.slice()};
  postMessage({type:'journal',data:journal});
 }else if(m.type==='inspect'){
  postMessage({type:'detail',request:m.request,city:details(+m.id)});
 }else if(m.type==='addFood'){
  const x=clamp(+m.x||0,0,W-1),y=clamp(+m.y||0,0,H-1);
  for(let oy=-5;oy<=5;oy++)for(let ox=-5;ox<=5;ox++){
   if(ox*ox+oy*oy<=25){const p=pos(x+ox,y+oy);nutrition[p]=clamp(nutrition[p]+.35,0,1)}
  }
 }
};
