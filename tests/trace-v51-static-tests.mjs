import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const index=read('index.html');
const glyph=read('trace-glyph-v1.js');
const server=read('server.js');
const mindprint=read('trace-mindprint-v2.js');
const files=['index.html','server.js','trace-glyph-v1.js','trace-mindprint-v2.js','trace-creator-ritual-v1.js','trace-creator-ritual-v1.css'];
files.forEach(name=>assert.ok(fs.existsSync(path.join(root,name)),`Missing production asset: ${name}`));
new vm.Script(glyph,{filename:'trace-glyph-v1.js'});
new vm.Script(mindprint,{filename:'trace-mindprint-v2.js'});

const scriptRx=/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
let inlineCount=0;
for(const m of index.matchAll(scriptRx)){
  const attrs=m[1], content=m[2].trim();
  if(!content || /\bsrc\s*=/i.test(attrs) || /type\s*=\s*["']application\/(?:json|ld\+json)["']/i.test(attrs))continue;
  inlineCount++;
  new vm.Script(content,{filename:`index.html <script ${inlineCount}>`});
}
assert.ok(inlineCount>=10,`Unexpected inline script count: ${inlineCount}`);
for(const tag of ['RENDERER_V1','RENDERER_V2','RENDERER_V3','RENDERER_V4','RENDERER_V5','RENDERER_V6','RENDERER_V7']){
 assert.match(glyph,new RegExp(`const ${tag}\\s*=`),`Missing renderer ${tag}`);
}
const sandbox={console,performance:{now:()=>0},setTimeout,clearTimeout};
sandbox.window=sandbox;sandbox.globalThis=sandbox;
vm.runInNewContext(glyph,sandbox,{filename:'trace-glyph-v1.js'});
const api=sandbox.TraceGlyphV1;
assert.ok(api && typeof api.createGlyphSpecification==='function');
for(const style of Object.keys(api.STYLES)){
 const inputs={creator_id:'id-1',image_sha256:'a'.repeat(64),profile_mindprint_hash:'b'.repeat(64),badge_mindprint_hash:'c'.repeat(64),proof_id:'proof-1',glyph_seed:'d'.repeat(64),style,ai_probability:0.12};
 const first=api.createGlyphSpecification(inputs), again=api.createGlyphSpecification(inputs);
 assert.equal(JSON.stringify(first),JSON.stringify(again),`${style}: nondeterministic spec`);
 assert.equal(first.renderer_version,api.RENDERER_V7,`${style}: unexpected latest renderer`);
 const out=api.renderGlyphFromSpecification(first,{width:240,height:240,mode:'badge',quality:'low'});
 assert.match(String(out),/<svg/i,`${style}: cannot render V7 glyph`);
}
const h=[{proof_id:'proof-b',proof_status:'published',created_at:'2026-01-02'},{proof_id:'proof-a',proof_status:'published',created_at:'2026-01-01'}];
const a=api.createProfileGlyphSpecification({creator_id:'creator-1',history:h}),b=api.createProfileGlyphSpecification({creator_id:'creator-1',history:[...h].reverse()});
assert.equal(a.profile_history_digest,b.profile_history_digest,'Profile glyph history not canonical');
assert.match(server,/function originProviderFetchBase\(req\)/);
assert.match(server,/RENDER_EXTERNAL_URL/);
assert.match(server,/\.eq\("owner_id", user\.id\)/);
assert.match(index,/hidden_from_profile:true/);
assert.match(server,/trace_origin_normalized_result/);
assert.match(index,/galleryDecorateFrame/,'Missing observer coalescing');
assert.match(index,/<script src="\/trace-mindprint-v2\.js\?v=2"><\/script>/,'Mindprint V2 engine is not loaded');
assert.match(server,/app\.get\("\/trace-mindprint-v2\.js"/,'Mindprint V2 engine route missing');
assert.match(server,/function validateMindprintContract\(proof\)/,'Mindprint V2 server contract validation missing');
assert.match(index,/mindprint_contract:/,'Mindprint V2 is not bound into creator proofs');

const mpSandbox={
  console,
  crypto:webcrypto,
  TextEncoder,
  Uint8Array,
  Math,
  JSON,
  Object,
  Array,
  Number,
  String,
  Boolean,
  Infinity
};
mpSandbox.window=mpSandbox;
mpSandbox.globalThis=mpSandbox;
vm.runInNewContext(mindprint,mpSandbox,{filename:'trace-mindprint-v2.js'});
const mpApi=mpSandbox.TraceMindprintV2;
assert.equal(mpApi.VERSION,'trace-mindprint-v2');
const timing=[121,134,118,160,142,129,145,151,137,126,172,133,141,128,155,139,147,130,163,136,149,127,158,143];
const mpA=await mpApi.build({text:'A deliberate creator statement with enough characters.',intervals:timing,minChars:40,kind:'profile',creatorId:'creator-1'});
const mpB=await mpApi.build({text:'A deliberate creator statement with enough characters.',intervals:timing,minChars:40,kind:'profile',creatorId:'creator-1'});
const mpChanged=await mpApi.build({text:'A deliberate creator statement with enough characters.',intervals:timing.map((x,i)=>x+(i%3)*17),minChars:40,kind:'profile',creatorId:'creator-1'});
assert.equal(mpA.behaviorCommitment,mpB.behaviorCommitment,'Mindprint V2 commitment is not deterministic');
assert.notEqual(mpA.behaviorCommitment,mpChanged.behaviorCommitment,'Mindprint V2 commitment ignores meaningful timing changes');
assert.equal(mpA.textHash.length,64);
assert.equal(mpA.rhythmHash.length,64);
assert.equal(mpA.behaviorCommitment.length,64);
assert.equal(mpA.ready,true);
assert.ok(mpA.quality_0_1>0.6,'Typed Mindprint V2 quality unexpectedly low');
assert.ok(mpA.local_features.median_ms>0&&mpA.local_features.mad_ms>=0);
const publicMp=mpApi.publicRecord(mpA);
assert.equal(publicMp.version,'trace-mindprint-v2');
assert.equal('local_features' in publicMp,false,'Private timing features leaked into public Mindprint record');
assert.equal(JSON.stringify(publicMp).includes('121'),false,'Raw keystroke timing leaked into public Mindprint record');

console.log(`TRACE static tests passed: ${inlineCount} inline scripts, ${Object.keys(api.STYLES).length} renderer families, Mindprint V2 commitments, profile determinism and active contracts.`);
