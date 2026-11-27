/* KOSMOSSCAN V9 — attributable agent-driven social simulation.
   The only path from intention to construction is work by named individuals.
   Projects consume communal inputs, require individual labor and change world state.
   This is an experimental artificial society, NOT a model of human civilization.
*/
(function(root){
'use strict';
function create(random){
 const R=random,clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),choose=a=>a[Math.floor(R()*a.length)];
 const DOMAINS=['Signaler','Samarbete','Verktyg','Skydd','Odling','Symboler','Handel','Organisation','Material','Energi','Optik','Beräkning','Astronomi','Navigation','Automation','Framdrift'];
 const REQ=[[],[0],[0],[1,2],[2,3],[0,1],[1,3],[5,6],[2,3],[4,8],[8,9],[5,7,9],[10,11],[12,11],[11,13],[9,13,14]];
 const CONCEPTS=[
  {kind:'dwelling',label:'Bostad',needs:'shelter',tech:3,cost:2.8,labor:8,output:'homes'},
  {kind:'farm',label:'Odlingsplats',needs:'food',tech:4,cost:3.4,labor:12,output:'farms'},
  {kind:'workshop',label:'Verkstad',needs:'material',tech:2,cost:4.7,labor:14,output:'workshops'},
  {kind:'academy',label:'Lärdomshus',needs:'knowledge',tech:5,cost:4.3,labor:17,output:'library'},
  {kind:'power',label:'Energianläggning',needs:'power',tech:9,cost:7.4,labor:24,output:'power'},
  {kind:'observatory',label:'Observatorium',needs:'discovery',tech:12,cost:7.9,labor:28,output:'observatories'},
  {kind:'exchange',label:'Marknadsplats',needs:'trade',tech:6,cost:4.4,labor:14,output:'markets'},
  {kind:'archive',label:'Gemensamt minne',needs:'culture',tech:5,cost:3.8,labor:17,output:'archives'},
  {kind:'clinic',label:'Omsorgscenter',needs:'wellbeing',tech:7,cost:5.9,labor:20,output:'clinics'},
  {kind:'council',label:'Rådssal',needs:'cooperation',tech:7,cost:5.3,labor:20,output:'councils'},
  {kind:'transport',label:'Transportsystem',needs:'connection',tech:13,cost:8.4,labor:30,output:'roads'},
  {kind:'factory',label:'Automatiserad fabrik',needs:'production',tech:14,cost:12,labor:36,output:'factories'},
  {kind:'shipyard',label:'Farkostverkstad',needs:'exploration',tech:15,cost:17,labor:50,output:'shipyards'},
  {kind:'commons',label:'Gemensam trädgård',needs:'nature',tech:1,cost:3,labor:11,output:'gardens'},
  {kind:'communication',label:'Signaltorn',needs:'contact',tech:0,cost:3.2,labor:11,output:'towers'}
 ];
 const EMO=['nyfiken','uthållig','försiktig','samarbetsvillig','självständig','uppfinningsrik','målmedveten'];
 const NAMES=['a','ri','so','tal','ma','esh','vek','nu','ki','loro','shi','pan','yor','evi','ru','tha'];
 let actions=0,records=[],discoveries=0,constructed=0,researchSuccesses=0,cooperations=0,disagreements=0,ideas=0;
 let decisions=0,personalKnowledge=0,lastActor=0,totalProjects=0;
 const skill=(a,k)=>a.skills?.[k]||0;
 function agent(a){
  if(a.agency)return a.agency;
  const g=a.g?.bio||{},hash=(a.id*2654435761)>>>0;
  const role=(hash%7);
  const ambition=clamp((g.brainGrowth||.4)*.55+((hash>>>4)%100)/200,.15,1);
  a.agency={
   name:NAMES[(hash>>>1)%NAMES.length]+NAMES[(hash>>>9)%NAMES.length]+(hash%10),
   temperament:EMO[role],role,drive:{
    research:clamp((g.plasticity||.4)*.6+((hash>>>11)%64)/140,.08,1),
    cooperation:clamp((a.g?.empathy||.4)*.7+((hash>>>5)%51)/180,.08,1),
    invention:clamp((a.g?.inventiveness||.3)*.7+((hash>>>17)%52)/150,.08,1),
    creation:ambition,
    exploration:clamp((a.g?.curiosity||.4)*.65+((hash>>>16)%35)/120,.08,1)
   },
   aptitude:Array.from({length:DOMAINS.length},(_,i)=>.05+(((hash>>>((i%4)*8))&255)/255)*.19),
   favored:role%DOMAINS.length,skill:new Float32Array(DOMAINS.length),
   social:new Map(),memory:[],contributions:0,discoveries:0,teaching:0,failures:0,
   projects:[],ownIdeas:[],homeCity:null,goal:'observera',experience:0,
   lastAct:-1,lastProject:null,followers:0,motivation:ambition,beliefs:((hash>>>12)%5),
   authored:0};
  return a.agency;
 }
 function log(world,type,actor,city,description,context){
  const event={id:++actions,step:world.step,type,actor:actor?.id||null,
   actorName:actor?agent(actor).name:'',city:city?.id||null,
   cityName:city?.name||'',text:description,
   context:context||null};
  records.unshift(event);if(records.length>240)records.pop();
  if(city){
   if(!city.activity)city.activity=[];
   city.activity.unshift(event);if(city.activity.length>45)city.activity.pop();
  }
  if(actor){
   const p=agent(actor);p.memory.unshift({step:world.step,type,description});
   if(p.memory.length>8)p.memory.pop();p.lastAct=world.step;
  }
  return event;
 }
 function link(a,b){
  const p=agent(a),q=agent(b);
  const grow=(x,id)=>{x.social.set(id,Math.min(1,(x.social.get(id)||0)+.04));
   if(x.social.size>8)x.social.delete(x.social.keys().next().value)};
  grow(p,b.id);grow(q,a.id);cooperations++;
 }
 function countryBrain(c){
  let mean=0;for(const id of c.cities)mean+=0;return mean;
 }
 function findCity(a,w){
  const c=w.clans[a.clan];if(!c||!c.cities.length)return null;
  const p=agent(a);
  if(p.homeCity){
   const found=w.cities[p.homeCity-1];if(found&&found.clan===a.clan)return found;
  }
  let best=null,d=1e9;
  const sample=c.cities.length<15?c.cities:Array.from({length:15},()=>choose(c.cities));
  for(const id of sample){
   const city=w.cities[id-1];if(!city)continue;
   const score=Math.hypot(city.x-a.x,city.y-a.y)+R()*4;
   if(score<d){d=score;best=city}
  }
  if(best&&d<42){p.homeCity=best.id;return best}
  return best;
 }
 function available(c,k){
  if(c.tech[k]>=1)return false;
  return REQ[k].every(j=>c.tech[j]>=.16);
 }
 function study(a,c,city,w){
  const p=agent(a),paths=[];
  for(let k=0;k<DOMAINS.length;k++)if(available(c,k))paths.push(k);
  if(!paths.length)return;
  const base=paths[(a.id+p.role+w.step)%paths.length];
  const other=choose(paths);
  const k=R()<.65?base:other;
  const curiosity=p.drive.research,quality=(p.aptitude[k]+p.skill[k]+(a.g?.brain.length||3)*.009)*curiosity;
  const effort=.0035+quality*.014;
  const before=c.tech[k];c.tech[k]=clamp(before+effort,0,1);
  p.skill[k]=clamp(p.skill[k]+.003+quality*.004,0,1);
  p.experience+=.02;personalKnowledge++;
  if(before<.16&&c.tech[k]>=.16){
   researchSuccesses++;p.discoveries++;
   const knowledge=DOMAINS[k].toLowerCase();
   c.knowledge|=(1<<k);
   log(w,'discovery',a,city,p.name+' utvecklade kunskap om '+knowledge+'.',
    {domain:k,level:+c.tech[k].toFixed(3)});
   if(worldCanLog(w))w.addEvent('skill',p.name+' i '+c.name+' upptäckte '+knowledge,c.id);
  }else if(R()<.004){
   log(w,'study',a,city,p.name+' undersöker '+DOMAINS[k].toLowerCase()+'.',{domain:k});
  }
 }
 function worldCanLog(w){return typeof w.addEvent==='function'}
 function deriveNeed(city,c){
  const count=Math.max(1,c.members),homes=city.homes||0,food=c.resources.food,mat=c.resources.material;
  return{
   shelter:clamp((count/Math.max(1,c.cities.length)-homes*6)/95,.15,1.4),
   food:clamp((45-food)/40,.16,1.4),
   material:clamp((50-mat)/40,.16,1.4),
   knowledge:.48/(1+(city.library||0)*.2),
   power:.3/(1+(city.power||0)*.2),
   discovery:.22,trade:.25,culture:.3,wellbeing:.28,cooperation:.28,
   connection:.25,production:.3,exploration:.2,nature:.22,contact:.25};
 }
 function brainstorm(a,c,city,w){
  const p=agent(a);if(!city)return;
  const needs=deriveNeed(city,c),options=[];
  for(const concept of CONCEPTS){
   const unlocked=c.tech[concept.tech]>=.16 ||
    concept.kind==='commons'&&c.tech[1]>=.13;
   if(!unlocked)continue;
   const score=(needs[concept.needs]||.2)*(R()*.4+.68)+p.drive.creation*.4+
    p.drive.invention*.25+(concept.tech===p.favored?.19:0);
   options.push({concept,score});
  }
  if(!options.length)return;
  options.sort((a,b)=>b.score-a.score);
  const concept=options[0].concept;
  if(!city.projects)city.projects=[];
  if(city.projects.length>6)return;
  const current=city.projects.find(q=>q.status==='active'&&q.kind===concept.kind);
  if(current&&R()<.9)return;
  const costs=concept.cost*(.8+R()*.4);
  const effort=concept.labor*(.7+R()*.55);
  const project={id:++totalProjects,city:city.id,kind:concept.kind,
   title:concept.label+' '+p.name.slice(0,4)+'-'+totalProjects,
   founder:a.id,founderName:p.name,tech:concept.tech,
   need:concept.needs,created:w.step,
   status:'active',work:0,required:+effort.toFixed(2),
   materialCost:+costs.toFixed(2),workers:[],contributions:[],stages:['idé','samordning','bygge'],
   outcome:null};
  city.projects.push(project);ideas++;p.ownIdeas.push(project.id);p.lastProject=project.id;
  log(w,'project',a,city,p.name+' föreslog '+concept.label.toLowerCase()+' för '+concept.needs+'.',
   {project:project.id,cost:costs,required:effort});
 }
 function labor(a,c,city,w){
  const p=agent(a),active=(city.projects||[]).filter(x=>x.status==='active');
  if(!active.length){brainstorm(a,c,city,w);return}
  active.sort((x,y)=>(x.work/x.required)-(y.work/y.required));
  const project=R()<.35?choose(active):active[active.length-1];
  if(!project)return;
  const minMaterial=project.materialCost*.055;
  if(c.resources.material<minMaterial){
   c.resources.material+=.07; // collective salvage, not free completion
   return;
  }
  const perk=(p.drive.creation*.8+p.drive.cooperation*.25+p.skill[project.tech]*.7);
  const invested=.21+perk*.52+Math.min(1.2,a.g.brain.length*.018);
  const materialUse=Math.min(c.resources.material,.025+invested*.055);
  c.resources.material-=materialUse;
  project.work+=invested;
  p.skill[project.tech]=clamp(p.skill[project.tech]+.003,0,1);
  p.contributions++;p.experience+=.03;
  p.lastProject=project.id;
  if(!project.workers.includes(a.id)&&project.workers.length<40)project.workers.push(a.id);
  const found=project.contributions.find(x=>x.id===a.id);
  if(found)found.work+=invested;
  else if(project.contributions.length<48)project.contributions.push({id:a.id,name:p.name,work:invested});
  if(R()<.012)log(w,'work',a,city,p.name+' arbetar med '+project.title+'.',
   {project:project.id,progress:project.work/project.required});
  if(project.work>=project.required){
   project.status='complete';project.finished=w.step;project.work=project.required;
   const concept=CONCEPTS.find(x=>x.kind===project.kind);
   const output=concept?.output||'structures';
   if(city[output]===undefined)city[output]=0;
   city[output]++;city.structures++;
   const asset={id:project.id,kind:project.kind,title:project.title,
    x:(R()-.5)*2,y:(R()-.5)*2,
    author:project.founder,workers:project.workers.length,
    value:1+Math.log2(1+project.contributions.length),created:w.step,
    function:project.need};
   if(!city.assets)city.assets=[];
   city.assets.push(asset);
   // Resource feedback depends on what was built, not on a random city timer.
   if(project.kind==='farm'||project.kind==='commons')c.resources.food+=4;
   if(project.kind==='workshop'||project.kind==='factory')c.resources.material+=2.4;
   if(project.kind==='power')c.resources.power+=3.1;
   if(project.kind==='academy'||project.kind==='archive'||project.kind==='observatory')c.resources.ideas+=2;
   if(project.kind==='transport')c.resources.material+=1.5;
   const oldLevel=city.level;
   city.level=Math.max(1,1+Math.floor(Math.log2(1+city.assets.length/4)));
   if(city.level>oldLevel&&worldCanLog(w))w.addEvent('city',city.name+' har utvecklat nya funktioner: nivå '+city.level,c.id);
   constructed++;w.buildings();
   project.outcome=output;
   const contributors=project.contributions.sort((a,b)=>b.work-a.work).slice(0,4).map(q=>q.name).join(', ');
   log(w,'completed',a,city,project.title+' färdigställdes av '+project.workers.length+
     ' individer. Medverkande: '+contributors+'.',
     {project:project.id,output,contributors:project.contributions.slice(0,6)});
   if(worldCanLog(w))w.addEvent('construction',city.name+': '+project.title+' färdigställd av '+project.workers.length+' individer.',c.id);
   // Completed projects remain in individual contribution records and city history.
   if(city.projects.length>90)city.projects=city.projects.filter(x=>x.status==='active').concat(city.projects.filter(x=>x.status==='complete').slice(-55));
  }
 }
 function teach(a,c,city,w){
  const p=agent(a);if(!city)return;
  const other=w.agents[Math.floor(R()*w.agents.length)];if(!other||other===a||other.clan!==a.clan)return;
  const q=agent(other);const skillIdx=(a.id+Math.floor(R()*DOMAINS.length))%DOMAINS.length;
  const source=p.skill[skillIdx],target=q.skill[skillIdx];
  if(source<=target+.03)return;
  const diff=source-target;
  q.skill[skillIdx]+=diff*.2;q.teaching++;p.teaching++;link(a,other);
  if(R()<.04){
   log(w,'teaching',a,city,p.name+' lärde '+q.name+' om '+DOMAINS[skillIdx].toLowerCase()+'.',
    {teacher:a.id,learner:other.id,domain:skillIdx});
  }
 }
 function exploration(a,c,city,w){
  const p=agent(a),j=w.pos(a.x,a.y);
  const quality=(p.drive.exploration+p.drive.research)*.5;
  const reward=w.nutrition[j]*quality;
  c.resources.food+=reward*.25;c.resources.material+=reward*.21;
  if(R()<.1*quality){p.discoveries++;discoveries++;
   const insight=['näringsmönster','vattenflöde','mineralstruktur','rytmiska signaler','temperaturvariation',
   'optisk variation','ekologisk kretsgång'];
   const label=choose(insight);
   c.research+=.4;
   log(w,'insight',a,city,p.name+' dokumenterade '+label+'.',
    {field:label,resource:reward});
  }
 }
 function disagreement(a,c,city,w){
  const p=agent(a);
  if(!city||!city.projects?.length)return;
  const ongoing=city.projects.filter(x=>x.status==='active');
  if(!ongoing.length)return;
  const concern=choose(ongoing);
  if(R()<.4*p.drive.creation){
   concern.work+=.12;cooperations++;
   log(w,'agreement',a,city,p.name+' samordnade två grupper kring '+concern.title+'.');
  }else{
   disagreements++;p.failures++;
   log(w,'disagreement',a,city,p.name+' motsatte sig prioriteringen av '+concern.title+'.',
    {project:concern.id,reason:choose(['resursbrist','miljöpåverkan','alternativ forskning','social konflikt'])});
  }
 }
 function maybeFound(a,c,w){
  if(c.cities.length||c.bioReadiness<4||c.tech[1]<.16||c.tech[3]<.16)return null;
  if(c.resources.material<6)return null;
  if(R()<.17){
   const city=w.foundCity(c);
   if(city){const v=city===true?w.cities.at(-1):city;const p=agent(a);
    p.homeCity=v.id;log(w,'founding',a,v,p.name+' organiserade grundandet av '+v.name+'.');
    return v}
  }
  return null;
 }
 function chooseAction(a,c,city){
  const p=agent(a),resources=c.resources,energy=a.energy||.6;
  const scores=[
   {name:'study',score:p.drive.research*.8+(city?.library||0)*.008+.17},
   {name:'explore',score:p.drive.exploration*.8+Math.max(0,.5-energy)*.4+.2},
   {name:'design',score:p.drive.invention*.65+p.drive.creation*.2+.12},
   {name:'work',score:p.drive.creation*.8+p.drive.cooperation*.15+(city?.projects||[]).some(x=>x.status==='active')?.34:0},
   {name:'teach',score:p.drive.cooperation*.85+.1},
   {name:'debate',score:p.drive.cooperation*.22+p.drive.invention*.15+.1}
  ];
  // Work is not automatic: tradeoffs, temperament, accumulated experience and
  // ecology determine the action selected by a specific individual.
  for(const x of scores){x.score+=R()*.5;}
  if(!city){for(const x of scores)if(x.name==='work'||x.name==='design')x.score=0;}
  scores.sort((a,b)=>b.score-a.score);
  return scores[0].name;
 }
 function step(w,iterations=30){
  const n=w.agents.length;
  if(!n)return;
  for(let i=0;i<iterations;i++){
   const a=w.agents[Math.floor(R()*n)];if(!a||a.age<14)continue;
   const c=w.clans[a.clan];if(!c)continue;
   const p=agent(a);
   let city=findCity(a,w);if(!city)city=maybeFound(a,c,w);
   const action=chooseAction(a,c,city);p.goal=action;decisions++;
   switch(action){
    case 'study':study(a,c,city,w);break;
    case 'explore':exploration(a,c,city,w);break;
    case 'design':brainstorm(a,c,city,w);break;
    case 'work':if(city)labor(a,c,city,w);break;
    case 'teach':teach(a,c,city,w);break;
    case 'debate':if(R()<.08)disagreement(a,c,city,w);break;
   }
   if(c.tech[0]>=.16&&R()<.002&&city)log(w,'communication',a,city,p.name+' föreslog en ny signal för lokal samordning.');
  }
 }
 function citizen(a){const p=agent(a);return{id:a.id,name:p.name,role:p.temperament,
  aspiration:p.goal,clan:a.clan,gen:a.gen,energy:+(a.energy||0).toFixed(2),
  interests:Object.entries(p.drive).sort((a,b)=>b[1]-a[1]).slice(0,2).map(x=>x[0]),
  skill:Array.from(p.skill).map(x=>+x.toFixed(2)),knowledge:p.discoveries,
  experience:+p.experience.toFixed(2),built:p.contributions,teaching:p.teaching,
  memory:p.memory,relationships:[...p.social].slice(-5)};
 }
 function view(city,w){
  if(!city)return null;
  const c=w.clans[city.clan];
  const agents=[];
  if(city.activity){
   const ids=[...new Set(city.activity.map(x=>x.actor).filter(Boolean))].slice(0,25);
   for(const id of ids){const a=w.agents[id-1];if(a&&a.clan===c.id)agents.push(citizen(a));}
  }
  const active=(city.projects||[]).filter(p=>p.status==='active');
  return{id:city.id,name:city.name,level:city.level,clan:city.clan,
   x:city.x,y:city.y,hue:c.hue,clanName:c.name,people:c.members,
   resources:{...c.resources},tech:Array.from(c.tech).map(v=>+v.toFixed(3)),
   assets:(city.assets||[]).slice(-80),assetsTotal:(city.assets||[]).length,
   active:active.slice(0,8),recent:(city.activity||[]).slice(0,24),
   citizens:agents,homes:city.homes||0,farms:city.farms||0,
   workshops:city.workshops||0,library:city.library||0,power:city.power||0,
   observatories:city.observatories||0,artifacts:c.inventions.length};
 }
 function summary(){
  return{actions,discoveries,constructed,researchSuccesses,cooperations,
   disagreements,ideas,decisions,personalKnowledge,totalProjects,
   recent:records.slice(0,24)};
 }
 function snapshot(){return{actions,records,discoveries,constructed,researchSuccesses,
  cooperations,disagreements,ideas,decisions,personalKnowledge,totalProjects};}
 function restore(s){
  if(!s)return;
  actions=s.actions||0;records=s.records||[];discoveries=s.discoveries||0;
  constructed=s.constructed||0;researchSuccesses=s.researchSuccesses||0;
  cooperations=s.cooperations||0;disagreements=s.disagreements||0;
  ideas=s.ideas||0;decisions=s.decisions||0;
  personalKnowledge=s.personalKnowledge||0;totalProjects=s.totalProjects||0;
 }
 function reset(){restore({});}
 return{step,view,summary,agent,citizen,snapshot,restore,reset};
}
root.V9Society={create};
})(typeof self!=='undefined'?self:globalThis);