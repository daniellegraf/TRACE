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
  // Constructed learning institutions measurably improve subsequent study.
  const education=1+Math.min(1.2,(city?.library||0)*.014+(city?.archives||0)*.008);
  const observation=(k===12||k===10)?1+Math.min(1,(city?.observatories||0)*.03):1;
  const effort=(.0035+quality*.014)*education*observation;
  const before=c.tech[k];c.tech[k]=clamp(before+effort,0,1);
  p.skill[k]=clamp(p.skill[k]+.003+quality*.004,0,1);
  p.experience+=.02;personalKnowledge++;
  // Composite knowledge can continue beyond the fixed introductory subjects.
  // Each new idea carries inherited source domains and alters future output.
  if(city&&c.tech[k]>.28&&R()<.0045+p.drive.invention*.0035){
    if(!c.researchTree)c.researchTree=[];
    if(!c.researchKeys)c.researchKeys=new Set();
    const target=choose(DOMAINS.map((_,i)=>i).filter(i=>c.tech[i]>.16));
    const parent=c.researchTree.length&&R()<.65?choose(c.researchTree):null;
    const source=parent?parent.id:'grundforskning';
    const key=k+':'+target+':'+source;
    if(!c.researchKeys.has(key)){
     const knowledge={id:c.researchTree.length+1,step:w.step,author:a.id,
      authorName:p.name,key,parents:[k,target],parentIdea:parent?.id||null,
      name:DOMAINS[k].toLowerCase()+'-'+DOMAINS[target].toLowerCase()+' '+NAMES[(a.id+w.step)%NAMES.length],
      effect:choose(['information','produktion','samordning','energi','hållbarhet','transport','lärande']),
      strength:+(.08+R()*.15).toFixed(3)};
     c.researchTree.push(knowledge);c.researchKeys.add(key);
     c.resources.ideas+=knowledge.strength*1.3;
     if(knowledge.effect==='produktion')c.resources.material+=knowledge.strength;
     if(knowledge.effect==='lärande')c.research+=knowledge.strength;
     if(knowledge.effect==='energi')c.resources.power+=knowledge.strength;
     ideas++;p.discoveries++;
     log(w,'breakthrough',a,city,p.name+' kombinerade '+DOMAINS[k]+' och '+DOMAINS[target]+
       ' till '+knowledge.name+'.',{knowledge});
    }
   }
  if(before<.16&&c.tech[k]>=.16){
   researchSuccesses++;p.discoveries++;
   const knowledge=DOMAINS[k].toLowerCase();
   c.knowledge|=(1<<k);
   log(w,'discovery',a,city,p.name+' utvecklade kunskap om '+knowledge+'.',
    {domain:k,level:+c.tech[k].toFixed(3)});
   if(worldCanLog(w))w.addEvent('skill',p.name+' i '+c.name+' upptäckte '+knowledge,c.id);
   if(city&&R()<.15&&typeof w.invent==='function')w.invent(c,a);
  }else if(city&&c.tech[8]>.16&&R()<.012){
   if(typeof w.invent==='function')w.invent(c,a);
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
   // Saturating infrastructure must not monopolize future construction.
   // An absent capability gets a strong priority, while additional copies
   // yield diminishing simulated benefit. This is local to each settlement.
   if(!city.assetCounts){
    city.assetCounts={};
    for(const asset of city.assets||[])city.assetCounts[asset.kind]=(city.assetCounts[asset.kind]||0)+1;
   }
   const existing=city.assetCounts[concept.kind]||0;
   const shortage=(needs[concept.needs]||.2);
   const novelty=1/(1+existing*.85);
   const readiness=.75+.2*Math.min(1,c.tech[concept.tech]);
   const score=(shortage*(.7+R()*.35)+p.drive.creation*.36+
     p.drive.invention*.18+(concept.tech===p.favored?.18:0))*novelty*readiness;
   options.push({concept,score});
  }
  if(!options.length)return;
  options.sort((a,b)=>b.score-a.score);
  const candidate=options.find(o=>!(city.projects||[]).some(q=>q.status==='active'&&q.kind===o.concept.kind));
  const concept=(candidate||options[0]).concept;
  if(!city.projects)city.projects=[];
  if(city.projects.filter(q=>q.status==='active').length>5)return;
  const current=city.projects.find(q=>q.status==='active'&&q.kind===concept.kind);
  if(current&&R()<.9)return;
  const costs=concept.cost*(.8+R()*.4);
  const effort=concept.labor*(.7+R()*.55);
  const novel=c.researchTree?.length&&R()<.26?choose(c.researchTree):null;
  const project={id:++totalProjects,city:city.id,kind:concept.kind,
   title:(novel?'Experiment '+novel.name:concept.label+' '+p.name.slice(0,4)+'-'+totalProjects),
   sourceIdea:novel?.id||null,sourceEffect:novel?.effect||null,
   founder:a.id,founderName:p.name,tech:concept.tech,
   need:concept.needs,created:w.step,
   status:'active',work:0,spent:0,required:+effort.toFixed(2),
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
  const minMaterial=Math.max(.01,(project.materialCost-(project.spent||0))/Math.max(1,project.required-project.work)*.3);
  if(c.resources.material<minMaterial)return;
  const perk=(p.drive.creation*.8+p.drive.cooperation*.25+p.skill[project.tech]*.7);
  const invested=.21+perk*.52+Math.min(1.2,a.g.brain.length*.018);
  const materialUse=Math.min(c.resources.material,
    project.materialCost*(Math.min(invested,project.required-project.work)/project.required));
  const fraction=materialUse/Math.max(.01,project.materialCost);
  c.resources.material-=materialUse;
  project.spent=(project.spent||0)+materialUse;
  project.work+=Math.min(invested,project.required*fraction);
  a.energy=Math.max(.01,(a.energy||.8)-.0003*invested);
  p.skill[project.tech]=clamp(p.skill[project.tech]+.003,0,1);
  p.contributions++;p.experience+=.03;
  p.lastProject=project.id;
  if(!project.workers.includes(a.id)&&project.workers.length<40)project.workers.push(a.id);
  const found=project.contributions.find(x=>x.id===a.id);
  if(found)found.work+=invested;
  else if(project.contributions.length<48)project.contributions.push({id:a.id,name:p.name,work:invested});
  if(R()<.012)log(w,'work',a,city,p.name+' arbetar med '+project.title+'.',
   {project:project.id,progress:project.work/project.required});
  if(project.work>=project.required-.001){
   project.status='complete';project.finished=w.step;project.work=project.required;
   const concept=CONCEPTS.find(x=>x.kind===project.kind);
   const output=concept?.output||'structures';
   if(city[output]===undefined)city[output]=0;
   city[output]++;city.structures++;
   const assetIndex=(city.assets?.length||0),ang=assetIndex*2.39996;
   const radial=Math.min(.92,Math.sqrt(assetIndex+1)*.078);
   const asset={id:project.id,kind:project.kind,title:project.title,
    x:Math.cos(ang)*radial,y:Math.sin(ang)*radial,
    author:project.founder,workers:project.workers.length,
    value:1+Math.log2(1+project.contributions.length),created:w.step,
    function:project.need};
   if(!city.assets)city.assets=[];
   city.assets.push(asset);
   if(!city.assetCounts)city.assetCounts={};
   city.assetCounts[project.kind]=(city.assetCounts[project.kind]||0)+1;
   // Resource feedback depends on what was built, not on a random city timer.
   if(project.kind==='farm'||project.kind==='commons')c.resources.food+=4;
   if(project.kind==='workshop'||project.kind==='factory')c.resources.material+=2.4;
   if(project.kind==='power')c.resources.power+=3.1;
   if(project.kind==='academy'||project.kind==='archive'||project.kind==='observatory')c.resources.ideas+=2;
   if(project.kind==='transport')c.resources.material+=1.5;
   // Derived inventions have repeatable effects, beyond a decorative name.
   if(project.sourceEffect==='lärande')c.research+=.7;
   if(project.sourceEffect==='produktion')c.resources.material+=.7;
   if(project.sourceEffect==='energi')c.resources.power+=.8;
   if(project.sourceEffect==='information')c.resources.ideas+=.5;
   if(project.sourceEffect==='hållbarhet')city.ecology=(city.ecology||0)+.15;
   if(project.sourceEffect==='samordning')c.social=clamp(c.social+.02,0,1);
   if(project.sourceEffect==='transport')city.roads=(city.roads||0)+1;
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
  const roster=c.socialRoster||[];
  let other=null;
  for(let j=0;j<6;j++){
   const id=roster.length?choose(roster):0;
   const candidate=id?w.agents[id-1]:w.agents[Math.floor(R()*w.agents.length)];
   if(candidate&&candidate!==a&&candidate.clan===a.clan){other=candidate;break;}
  }
  if(!other)return;
  const q=agent(other);const skillIdx=p.skill.indexOf(Math.max(...p.skill));
  const source=p.skill[skillIdx],target=q.skill[skillIdx];
  if(source<=target+.03)return;
  const diff=source-target;
  q.skill[skillIdx]+=diff*.2*(1+Math.min(1,(city.archives||0)*.035));q.teaching++;p.teaching++;link(a,other);
  if(R()<.25){
   log(w,'teaching',a,city,p.name+' lärde '+q.name+' om '+DOMAINS[skillIdx].toLowerCase()+'.',
    {teacher:a.id,learner:other.id,domain:skillIdx});
  }
 }
 function harvesting(a,c,city,w){
  const p=agent(a),j=w.pos(a.x,a.y);
  const fertility=w.nutrition[j],moisture=w.water[j],stone=w.terrain[j]>=2;
  const efficiency=.35+p.drive.exploration*.7+p.skill[8]*.32;
  const factories=Math.min(1.6,(city?.factories||0)*.06+(city?.workshops||0)*.018);
  const farms=Math.min(1.8,(city?.farms||0)*.037+(city?.gardens||0)*.021);
  const collected=(stone?.57:.31)*efficiency*(.8+moisture*.35)*(1+factories);
  const food= Math.max(0,fertility*.18*efficiency*(1+farms));
  c.resources.material+=collected;
  c.resources.food+=food;
  w.nutrition[j]=clamp(fertility-food*.018,0,1);
  p.contributions++;p.experience+=.01;
  if(R()<.007)log(w,'harvest',a,city,p.name+' samlade '+(stone?'mineraler':'växtfibrer')+' till samhällets förråd.',
    {material:+collected.toFixed(3),food:+food.toFixed(3)});
}
function exploration(a,c,city,w){
  const p=agent(a),j=w.pos(a.x,a.y);
  const quality=(p.drive.exploration+p.drive.research)*.5;
  const reward=w.nutrition[j]*quality;
  c.resources.food+=reward*.25;c.resources.material+=reward*.21;
  if(city?.observatories&&R()<.05)c.resources.ideas+=Math.min(1,city.observatories*.018);
  if(reward>.055&&R()<.085*quality){p.discoveries++;discoveries++;
   const insight=['näringsmönster','vattenflöde','mineralstruktur','rytmiska signaler','temperaturvariation',
   'optisk variation','ekologisk kretsgång'];
   const label=choose(insight);
   c.research+=.4;c.resources.ideas+=.08;
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
  if(R()<.62*p.drive.creation){
   concern.work+=.12;cooperations++;c.dissent=Math.max(0,(c.dissent||0)-.12);
   log(w,'agreement',a,city,p.name+' samordnade två grupper kring '+concern.title+'.');
  }else{
   disagreements++;p.failures++;c.dissent=(c.dissent||0)+1;
   if(c.dissent>9&&c.members>90&&typeof w.fission==='function'&&R()<.13){
    if(w.fission(c,a))c.dissent=0;
   }
   log(w,'disagreement',a,city,p.name+' motsatte sig prioriteringen av '+concern.title+'.',
    {project:concern.id,reason:choose(['resursbrist','miljöpåverkan','alternativ forskning','social konflikt'])});
  }
 }
 function maybeFound(a,c,w){
  if(c.bioReadiness<4||c.tech[1]<.16||c.tech[3]<.16)return null;
  if(c.resources.material<6)return null;
  const pressure=c.members/Math.max(1,c.cities.length);
  const expansion=c.cities.length>0;
  if(expansion&&pressure<110)return null;
  if(R()<(expansion?.008:.17)){
   const city=w.foundCity(c,a);
   if(city){const v=city===true?w.cities.at(-1):city;const p=agent(a);
    p.homeCity=v.id;log(w,'founding',a,v,p.name+' organiserade grundandet av '+v.name+'.');
    return v}
  }
  return null;
 }
 function chooseAction(a,c,city){
  const p=agent(a),resources=c.resources,energy=a.energy||.6;
  const scores=[
   {name:'study',score:p.drive.research*.8+(city?.library||0)*.008+.17+
       (c.tech.filter(v=>v>=.16).length<12?.35:.08)},
   {name:'explore',score:p.drive.exploration*.8+Math.max(0,.5-energy)*.4+.2},
   {name:'harvest',score:.32+Math.max(0,14-resources.material)*.075+p.drive.exploration*.2},
   {name:'design',score:p.drive.invention*.65+p.drive.creation*.2+.12},
   {name:'work',score:p.drive.creation*.8+p.drive.cooperation*.15+((city?.projects||[]).some(x=>x.status==='active')?.34:0)},
   {name:'teach',score:p.drive.cooperation*.85+.1},
   {name:'debate',score:p.drive.cooperation*.22+p.drive.invention*.15+
      ((city?.projects||[]).some(z=>z.status==='active')?.27:0)+
      (resources.material<8?.35:0)+(p.beliefs===1?.1:0)}
  ];
  // Work is not automatic: tradeoffs, temperament, accumulated experience and
  // ecology determine the action selected by a specific individual.
  for(const x of scores){
    x.score+=R()*.43;
    if(x.name===p.lastChoice)x.score+=.16; // ongoing plans persist
    if(x.name==='teach'&&p.social.size>1)x.score+=.12;
    if(x.name==='work'&&p.lastProject&&city?.projects?.some(q=>q.id===p.lastProject&&q.status==='active'))x.score+=.25;
    if(x.name==='study'&&p.memory.some(e=>e.type==='breakthrough'))x.score+=.12;
  }
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
   if(!c.socialRoster)c.socialRoster=[];
   if(!c.socialRoster.includes(a.id)){c.socialRoster.push(a.id);if(c.socialRoster.length>80)c.socialRoster.shift();}
   let city=findCity(a,w);
   if(!city)city=maybeFound(a,c,w);
   else if(p.drive.exploration>.58&&R()<.028)city=maybeFound(a,c,w)||city;
   const action=chooseAction(a,c,city);p.goal=action;p.lastChoice=action;decisions++;
   switch(action){
    case 'study':study(a,c,city,w);break;
    case 'explore':exploration(a,c,city,w);break;
    case 'harvest':harvesting(a,c,city,w);break;
    case 'design':brainstorm(a,c,city,w);break;
    case 'work':if(city)labor(a,c,city,w);break;
    case 'teach':teach(a,c,city,w);break;
    case 'debate':if(R()<.28)disagreement(a,c,city,w);break;
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
  // This is a descriptive classification based on existing capabilities,
  // not a hidden unlock or automatic progression timer.
  let era='Tidigt samhälle';
  if((city.councils||0)>0&&(city.exchange||city.markets||0)>0)era='Organiserad handelsstad';
  if((city.library||0)>0&&(city.observatories||0)>0)era='Vetenskapligt samhälle';
  if((city.factories||0)>0&&(city.power||0)>0)era='Industriell kultur';
  if((city.shipyards||0)>0&&c.tech[15]>.3)era='Experimentell farkostkultur';
  return{id:city.id,name:city.name,level:city.level,era,clan:city.clan,
   x:city.x,y:city.y,hue:c.hue,clanName:c.name,people:c.members,
   resources:{...c.resources},tech:Array.from(c.tech).map(v=>+v.toFixed(3)),
   assets:(city.assets||[]).slice(-80),assetsTotal:(city.assets||[]).length,
   active:active.slice(0,8),recent:(city.activity||[]).slice(0,24),
   citizens:agents,homes:city.homes||0,farms:city.farms||0,
   workshops:city.workshops||0,library:city.library||0,power:city.power||0,
   observatories:city.observatories||0,artifacts:c.inventions.length,researchIdeas:(c.researchTree||[]).slice(-12).reverse()};
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