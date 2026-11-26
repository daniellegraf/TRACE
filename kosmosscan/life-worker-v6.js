/* KOSMOSSCAN LIFE ENGINE V6 — emergent societies experiment.
   One unique state per organism. No deaths/archives. Social systems on their
   own clock; reproduction low and resource-dependent; inventions and words
   generated from causal combinations. NOT a model of real biological history.
*/
'use strict';
const W=180,H=112,SIZE=W*H,TAU=Math.PI*2;
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
 innovationSeed:rand(),worldview:(rand()*4)|0,era:0,inventionKeys:new Set()};
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
function organism(parent=null,clan=null){
 const c=parent?clans[parent.clan]:clan||pick(clans);
 const g=parent?{...parent.g,brain:inheritBrain(parent.g.brain)}:
 {hue:mod(c.hue+between(-40,40),360),form:(rand()*6)|0,
 size:between(.4,1.2),limbs:rand(),cells:1,energyNeed:between(.002,.007),
 speed:between(.2,1),empathy:between(.3,.8),curiosity:between(.3,1),
 speech:between(.2,.75),inventiveness:between(.2,.8),brain:inheritBrain()};
 if(parent){
   for(const k of ['hue','size','limbs','empathy','curiosity','speech','inventiveness','speed']){
    if(rand()<.19)g[k]=k==='hue'?mod(g[k]+between(-32,32),360):clamp(g[k]+between(-.17,.17),0,1.7);
   }
   if(rand()<.1)g.form=(g.form+1+((rand()*5)|0))%6;
   if(g.cells<22&&rand()<.17)g.cells++;
 }
 maxCells=Math.max(maxCells,g.cells);maxBrain=Math.max(maxBrain,g.brain.length);
 const x=mod((parent?.x??c.x)+between(-5,5),W),y=mod((parent?.y??c.y)+between(-5,5),H);
 const a={id:++id,clan:c.id,x,y,angle:between(0,TAU),g,gen:parent?parent.gen+1:0,
 age:0,energy:parent?.7:between(.6,1.2),xp:0,network:new Float32Array(g.brain.length),
 memory:new Float32Array(4),known:parent?parent.known:0,role:(rand()*5)|0,
 attachments:0,production:0,language:0,intent:0,spoken:0};
 agents.push(a);c.members++;maxGen=Math.max(maxGen,a.gen);
 return a;
}
function setup(newSeed){
 rng=(newSeed||123456789)|0;seed=newSeed>>>0;id=0;step=0;clock=0;
 messages=[];inventions=[];milestones=[];flights=[];clans=[];cities=[];agents=[];socialSpeed=1;extraPlanetary=0;
 nextAgent=new Int32Array(512);occupancy.fill(-1);nutrition.fill(0);signal.fill(0);
 teaching=0;skillsFound=0;transmissions=0;sentences=0;innovations=0;buildings=0;roadCount=0;
 maxCells=1;maxBrain=3;maxGen=0;individualUpdates=0;updatesPerSecond=0;updateWindow=0;
 birthCredit=0;cycle=null;last=0;lastFrame=0;lastStats=0;lastRateAt=0;rate=0;rateBorn=0;
 for(let i=0;i<SIZE;i++){
   const x=i%W,y=(i/W)|0;
   const field=Math.sin(x*.069+seed*.00000007)*.39+Math.cos(y*.083)*.28+
    Math.sin((x+y)*.039)*.19+Math.sin(x*.15-y*.12)*.17;
   terrain[i]=field<-.38?0:field<.05?1:field<.35?2:3;
   nutrition[i]=between(.28,.58)*soil(x,y);
 }
 for(let i=0;i<11;i++)clans.push(createClan(i));
 for(let i=0;i<125;i++)organism(null,clans[i%11]);
 addEvent('start','125 unika organismer skapades i elva geografiska grupper.');
}
function budgetBirths(dt){
 // Slower reproduction, decaying with population. Not a strict population cap.
 const r=agents.length<250?1.6:agents.length<900?.7:agents.length<2400?.18:.03;
 birthCredit+=Math.min(dt,500)*r/1000;
 let born=0;
 while(birthCredit>=1&&born<6){
  birthCredit--;born++;const parent=pick(agents);
  organism(parent);rateBorn++;
 }
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
  const val=Math.tanh(v);thought[i]=thought[i]*.8+val*.2;last=thought[i];out+=i%2?thought[i]:-thought[i];
  if((step+i)%9===0){node[0]=clamp(node[0]+.0007*(food-a.memory[2])*val,-2,2);}
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
 const angleR=a.angle+.65,angleL=a.angle-.65;
 const l=nutrition[pos(a.x+Math.cos(angleL)*4,a.y+Math.sin(angleL)*4)];
 const r=nutrition[pos(a.x+Math.cos(angleR)*4,a.y+Math.sin(angleR)*4)];
 a.angle+=(r-l)*.44+thought*.22+between(-.13,.13);
 const mv=.36+a.g.speed*.65;
 a.x=mod(a.x+Math.cos(a.angle)*mv,W);a.y=mod(a.y+Math.sin(a.angle)*mv,H);
 const k=pos(a.x,a.y),take=Math.min(nutrition[k],.006+.0004*a.g.cells);
 nutrition[k]-=take;
 a.energy=clamp(a.energy+take*.75-a.g.energyNeed+.0015,.01,2.3);
 a.age++;a.xp+=take*.4;
 a.memory[0]=a.memory[0]*.9+(r-l)*.1;
 a.memory[1]=a.memory[1]*.9+thought*.1;
 if(n&&n.clan===a.clan){
  const c=clans[a.clan];
  if(rand()<.05*a.g.empathy){a.attachments++;c.social=clamp(c.social+.0002,0,1);}
  if(rand()<.02*a.g.speech&&c.knowledge&&((c.knowledge&~a.known)!==0)){
   const dif=c.knowledge&~a.known;a.known|=(dif&-dif);teaching++;a.language++;a.xp+=.02;
  }
  if(rand()<.01&&n.known&&!a.known){a.known=n.known;teaching++;}
 }
 const c=clans[a.clan];
 if(a.role===0)c.resources.food+=take*.22;
 if(a.role===1)c.resources.material+=take*.17;
 if(a.role===2)c.resources.ideas+=a.g.inventiveness*.0007;
 if(a.role===3)c.resources.power+=take*.008;
 if(a.age%30===0&&a.g.cells<24&&a.energy>.5&&rand()<.04*a.g.curiosity){
  a.g.cells++;maxCells=Math.max(maxCells,a.g.cells);
 }
 if(a.age%85===0&&a.g.brain.length<28&&rand()<.03*a.g.curiosity){
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
 if(cycle.index>=cycle.total){cycle=null;step++;}
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
function foundCity(c){
 if(c.cities.length>=2)return;
 if(c.tech[1]<.16||c.tech[3]<.16||c.resources.material<6)return;
 const position=c.cities.length?{
  x:mod(c.x+between(-22,22),W),y:mod(c.y+between(-18,18),H)
 }:{x:c.x,y:c.y};
 const city={id:cities.length+1,clan:c.id,name:cityName(c),x:position.x,y:position.y,
  level:1,structures:1,library:0,workshops:0,power:0,roads:0,wealth:2,stored:0,
  inventions:[],messages:[],population:Math.floor(c.members/(c.cities.length+1)),founded:step,sky:0};
 c.cities.push(city.id);cities.push(city);buildings++;
 c.resources.material-=5;
 speech(c,'grundande',c.name+' grundade bosättningen '+city.name+'.',[0,3,4,5],{city:city.id});
 addEvent('city','Bosättningen '+city.name+' grundades.',c.id);
}
function developCity(c){
 if(!c.cities.length){foundCity(c);return;}
 const city=cities[(rand()*c.cities.length)|0];
 const improvement=c.tech[7]+c.tech[8]+c.tech[9]+c.resources.material*.015;
 if(improvement<.3)return;
 if(c.resources.material<2)return;
 const build=rand();
 if(build<.25){city.library++;city.wealth+=.3;}
 else if(build<.56){city.workshops++;city.wealth+=.6;}
 else if(build<.84){city.structures++;city.stored+=1;}
 else{city.power++;city.wealth+=.9;}
 c.resources.material-=2;buildings++;
 if(city.structures+city.library+city.workshops+city.power>city.level*6&&city.level<10){
  city.level++;speech(c,'bygge',city.name+' växte till stadsnivå '+city.level+'.',[0,3,4,11],{city:city.id});
  addEvent('city',city.name+' nådde nivå '+city.level,c.id);
 }
}
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
 const inv={id:inventions.length+1,key:fingerprint,clan:c.id,tick:step,
  name:compoundName(c,a,b,effect)+(parents.length?' · '+lexeme():''),parts:[COMPONENTS[a],COMPONENTS[b]],effect:EFFECTS[effect],
  complexity,parents,uses:0,detail:'Kombination av '+COMPONENTS[a]+' och '+COMPONENTS[b]+' för '+EFFECTS[effect]+'.',
  type:effect===8?'framdrift':effect===10?'koordination':'uppfinning'};
 inventions.push(inv);c.inventions.push(inv.id);c.inventionKeys.add(fingerprint);innovations++;
 c.resources.material-=experimentCost;c.resources.power-=.7+complexity*.08;
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
function societalAction(){
 // Wall-clock social evolution proceeds independently of full organism biology ticks.
 for(const c of clans){
  const t=c.tech;
  c.resources.food+=.07+c.members*.00016;
  c.resources.material+=.72+c.members*.018+c.cities.reduce((sum,id)=>sum+(cities[id-1]?.workshops||0)*.07,0);
  c.resources.power+=.03+c.cities.length*.016;
  const researcher=c.members*.012+c.social*.55+c.resources.ideas*.003+c.cities.length*.12;
  c.research+=researcher*between(.6,1.3);
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
  if(c.tech[3]>.16&&c.tech[1]>.16&&rand()<.12)foundCity(c);
  if(c.cities.length&&rand()<.21)developCity(c);
  if(c.cities.length&&rand()<.05/(1+c.inventions.length/55))invent(c);
  if(c.cities.length&&rand()<.032&&c.tech[5]>.16){
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
  launchCount:flights.length,achievements:skillsFound,cultures:clans.filter(c=>c.knowledge).length};
}
function siteSummary(city){
 const c=clans[city.clan];
 return{id:city.id,name:city.name,clan:city.clan,clanName:c.name,x:city.x,y:city.y,hue:c.hue,
  level:city.level,structures:city.structures,library:city.library,workshops:city.workshops,
  power:city.power,wealth:city.wealth,people:c.members,tech:Array.from(c.tech,x=>Math.round(x*100)/100),knowledge:c.knowledge,
  population:Math.floor(c.members/Math.max(1,c.cities.length)),
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
 // Individual simulation persists; UI intentionally shows civilization map with a
 // fixed small representative agent sample. This is NOT a full individual pixel plot.
 const sampleCount=Math.min(agents.length,950),sample=new Uint8Array(sampleCount*4);
 for(let k=0;k<sampleCount;k++){
  const index=Math.min(agents.length-1,Math.floor((k+.5)*agents.length/sampleCount));
  const a=agents[index],o=k*4;sample[o]=(a.x/W*255)|0;sample[o+1]=(a.y/H*255)|0;
  sample[o+2]=a.clan;sample[o+3]=a.g.form;
 }
 const summaries=cities.map(siteSummary).slice(0,80);
 const paths=[];
 for(let i=0;i<summaries.length;i++)for(let j=i+1;j<summaries.length;j++){
  const a=summaries[i],b=summaries[j],dx=a.x-b.x,dy=a.y-b.y;
  if(dx*dx+dy*dy<420&&a.level+b.level>=4&&paths.length<140)paths.push([a.id,b.id]);
 }
 const craft=flights.map(f=>({x:f.x,y:f.y,id:f.id,name:f.name,progress:f.progress,clan:f.clan})).slice(-20);
 postMessage({type:'frame',metrics:metrics(),sample,sites:summaries,paths,craft,
  messages:messages.slice(0,35),discoveries:inventions.slice(-28).reverse(),
  events:milestones.slice(0,12),clans:clans.map(c=>({id:c.id,name:c.name,hue:c.hue,
   people:c.members,knowledge:bits(c.knowledge),inventions:c.inventions.length,
   cities:c.cities.length,languageAge:c.languageAge}))},[sample.buffer]);
}
let timer=null;
function heartbeat(){
 if(!live||paused)return;
 const now=performance.now(),dt=last?clamp(now-last,0,600):24;last=now;clock+=dt;
 budgetBirths(dt);
 try{
  stepIndividuals();
  if(clock-lastStats>190){
   // Fast-forward cultural deliberation without duplicating biological individuals.
   for(let i=0;i<socialSpeed;i++)societalAction();
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
 }else if(m.type==='setSpeed'){
  socialSpeed=m.fast?4:1;
  postMessage({type:'speed',value:socialSpeed});
 }else if(m.type==='export'){
  // Export research evidence and causal parent IDs, not the entire unlimited agent heap.
  const journal={format:'KOSMOSSCAN-LIFE-V6-RESEARCH-JOURNAL',seed,generatedAt:new Date().toISOString(),
   interpretation:'A rule-based artificial-life simulation, not an observation of real extraterrestrial intelligence.',
   metrics:metrics(),
   clans:clans.map(c=>({id:c.id,name:c.name,population:c.members,
    words:c.language,grammar:c.grammar,tech:Array.from(c.tech),resources:{...c.resources},
    inventions:c.inventions,settlements:c.cities,launches:c.launches})),
   cities:cities.map(siteSummary),inventions:inventions.slice(-4500),
   messages:messages.slice(),history:milestones.slice(),spacecraft:flights.slice()};
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
