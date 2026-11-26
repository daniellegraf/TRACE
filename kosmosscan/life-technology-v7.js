/* KOSMOSSCAN V7 — repeatable technology trials for simulated component interactions.
   These are game-world functional tests, NOT validation of real engineering physics.
*/
(function(root){
'use strict';
const PHYSICS=[
 // toughness, conduction, mobility, optical, storage, controllability
 [.8,.06,.2,.05,.45,.2], // fibres
 [1,.06,.08,.05,.65,.12], // stone
 [.96,.85,.25,.26,.6,.8], // metal
 [.06,.25,.72,1,.08,.38], // light
 [.07,.68,.82,.5,.18,.3], // heat
 [.02,.08,.92,.1,.1,.23], // wind
 [.12,.22,.84,.3,.88,.32], // water
 [.2,.2,1,.22,.24,.7], // motion
 [.06,.76,.68,.6,.75,.97], // signal
 [.4,.18,.04,.19,1,.9], // memory
 [.52,.1,.25,.5,.88,.82], // pattern
 [1,.12,.12,.14,.86,.6], // structure
 [.1,1,.65,.15,.46,.9], // magnetism
 [.34,.15,.9,.08,.5,.62], // pressure
 [.24,.28,.7,.3,.76,.9], // cycle
 [.82,.54,.13,.96,.62,.42], // crystal
 [.09,.58,.91,.94,.36,.6], // wave
 [.72,.18,.28,.2,.85,.68], // weave
 [.01,.1,.01,1,.4,.52], // stars
 [.03,.18,.3,.92,.2,.72], // echoes
 [.4,.45,.52,.15,.1,.65], // friction
 [.01,.92,.81,.72,.32,.88] // field
];
const EXPECT=[
 [4,0],[3,5],[1,4],[5,0],[1,2],[2,1],[0,4],
 [5,4],[2,5],[4,0],[3,1],[3,5],[4,5],[5,2]
];
function create(rand){
 const clip=x=>Math.max(0,Math.min(1,x));
 function prototype(a,b,effect,knowledge,complexity,parents=[]){
  const p=PHYSICS[a]||PHYSICS[0],q=PHYSICS[b]||PHYSICS[1];
  const dims=EXPECT[effect]||[4,5];
  const synergy=(p[dims[0]]+q[dims[0]])*.25+(p[dims[1]]+q[dims[1]])*.25;
  const complement=Math.abs(p[dims[0]]-q[dims[1]])*.13;
  const prior=Array.isArray(parents)?Math.min(.13,parents.length*.045):0;
  const knowledgeTerm=clip(knowledge)*.28;
  const difficulty=.38+(effect===8||effect===11?.14:0)+Math.max(0,complexity-2)*.012;
  const base=synergy+complement+prior+knowledgeTerm-difficulty;
  const trials=[];
  for(let k=0;k<5;k++)trials.push(clip(base+.24+(rand()-.5)*.24));
  const avg=trials.reduce((s,x)=>s+x,0)/5;
  const success=avg>.37&&trials.filter(x=>x>.32).length>=3;
  return{success,score:+avg.toFixed(3),
   trials:trials.map(x=>+x.toFixed(3)),criterion:'score > .37 in simulated component-function trials',
   functionality:success?'passed simulated trials':'failed simulated trials'};
 }
 return {prototype};
}
root.V7Technology={create};
})(typeof self!=='undefined'?self:globalThis);
