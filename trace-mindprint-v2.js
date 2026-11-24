(function traceMindprintV2Factory(root){
  "use strict";

  const VERSION="trace-mindprint-v2";
  const FEATURE_SCHEMA="trace-mindprint-features-v2";
  const DOMAIN="TRACE_MINDPRINT_BEHAVIOR_V2";
  const MAX_INTERVALS=96;

  function clamp(value,min,max){return Math.min(max,Math.max(min,Number(value)||0));}
  function clamp01(value){return clamp(value,0,1);}
  function round(value,digits=4){const f=10**digits;return Math.round((Number(value)||0)*f)/f;}
  function textBytes(value){return new TextEncoder().encode(String(value??""));}
  function stable(value){
    if(Array.isArray(value))return value.map(stable);
    if(value&&typeof value==="object"){
      const out={};
      for(const key of Object.keys(value).sort())out[key]=stable(value[key]);
      return out;
    }
    return value;
  }
  function stableJson(value){return JSON.stringify(stable(value));}
  async function sha256Hex(value){
    if(!root.crypto?.subtle)throw new Error("WebCrypto unavailable for Mindprint V2");
    const bytes=value instanceof Uint8Array?value:textBytes(value);
    const digest=await root.crypto.subtle.digest("SHA-256",bytes);
    return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
  }
  function cleanIntervals(intervals){
    return (Array.isArray(intervals)?intervals:[])
      .map(Number)
      .filter(v=>Number.isFinite(v)&&v>10&&v<3000)
      .slice(-MAX_INTERVALS);
  }
  function quantile(sorted,p){
    if(!sorted.length)return 0;
    if(sorted.length===1)return sorted[0];
    const pos=(sorted.length-1)*clamp01(p);
    const lo=Math.floor(pos),hi=Math.ceil(pos),w=pos-lo;
    return sorted[lo]*(1-w)+sorted[hi]*w;
  }
  function mean(values){return values.length?values.reduce((a,b)=>a+b,0)/values.length:0;}
  function variance(values,m=mean(values)){return values.length?values.reduce((a,b)=>a+(b-m)*(b-m),0)/values.length:0;}
  function trimmedMean(sorted,fraction=.1){
    if(!sorted.length)return 0;
    const cut=Math.min(Math.floor(sorted.length*fraction),Math.floor((sorted.length-1)/2));
    const use=sorted.slice(cut,sorted.length-cut);
    return mean(use);
  }
  function rmssd(values){
    if(values.length<2)return 0;
    let sum=0;
    for(let i=1;i<values.length;i++){const d=values[i]-values[i-1];sum+=d*d;}
    return Math.sqrt(sum/(values.length-1));
  }
  function lag1Correlation(values,m=mean(values)){
    if(values.length<3)return 0;
    let num=0,den=0;
    for(const x of values){const d=x-m;den+=d*d;}
    if(!den)return 0;
    for(let i=1;i<values.length;i++)num+=(values[i-1]-m)*(values[i]-m);
    return clamp(num/den,-1,1);
  }
  function relativeHistogram(values,median){
    const bins=[0,.5,.75,1,1.25,1.5,2,3,Infinity];
    const counts=new Array(bins.length-1).fill(0);
    if(!values.length||!median)return counts;
    for(const value of values){
      const ratio=value/median;
      for(let i=0;i<counts.length;i++){
        if(ratio>=bins[i]&&ratio<bins[i+1]){counts[i]++;break;}
      }
    }
    return counts.map(c=>Math.round((c/values.length)*1000));
  }
  function histogramEntropy(hist){
    const total=hist.reduce((a,b)=>a+b,0);
    if(!total)return 0;
    let h=0,nonzero=0;
    for(const c of hist){
      if(!c)continue;
      nonzero++;
      const p=c/total;
      h-=p*Math.log2(p);
    }
    const max=nonzero>1?Math.log2(hist.length):1;
    return round(clamp01(h/max),4);
  }
  function extractFeatures(text,intervals){
    const clean=cleanIntervals(intervals);
    const sorted=[...clean].sort((a,b)=>a-b);
    const m=mean(clean);
    const med=quantile(sorted,.5);
    const q10=quantile(sorted,.10),q25=quantile(sorted,.25),q75=quantile(sorted,.75),q90=quantile(sorted,.90);
    const absDev=clean.map(v=>Math.abs(v-med)).sort((a,b)=>a-b);
    const mad=quantile(absDev,.5);
    const vari=variance(clean,m);
    const sd=Math.sqrt(vari);
    const hist=relativeHistogram(clean,med);
    const pauseThreshold=Math.max(650,med*2.4);
    const fastThreshold=Math.max(35,med*.55);
    const duration=clean.reduce((a,b)=>a+b,0);
    const possible=Math.max(1,String(text??"").length-1);
    return Object.freeze({
      sample_count:clean.length,
      duration_ms:Math.round(duration),
      mean_ms:round(m,1),
      trimmed_mean_ms:round(trimmedMean(sorted),1),
      median_ms:round(med,1),
      mad_ms:round(mad,1),
      sd_ms:round(sd,1),
      q10_ms:round(q10,1),
      q25_ms:round(q25,1),
      q75_ms:round(q75,1),
      q90_ms:round(q90,1),
      iqr_ms:round(q75-q25,1),
      rmssd_ms:round(rmssd(clean),1),
      cv:round(m?sd/m:0,4),
      burstiness:round((sd+m)>0?(sd-m)/(sd+m):0,4),
      lag1:round(lag1Correlation(clean,m),4),
      pause_ratio:round(clean.length?clean.filter(v=>v>pauseThreshold).length/clean.length:0,4),
      fast_ratio:round(clean.length?clean.filter(v=>v<fastThreshold).length/clean.length:0,4),
      coverage:round(clamp01(clean.length/possible),4),
      relative_histogram_permille:Object.freeze(hist),
      histogram_entropy:histogramEntropy(hist)
    });
  }
  function qualityScore(textLength,minChars,features){
    const lengthScore=clamp01(textLength/Math.max(1,minChars));
    const target=Math.max(8,Math.round(minChars*.55));
    const sampleScore=clamp01(features.sample_count/target);
    const coverageScore=clamp01(features.coverage);
    const spanTarget=Math.max(1500,target*90);
    const spanScore=clamp01(features.duration_ms/spanTarget);
    return round(.35*lengthScore+.30*sampleScore+.20*coverageScore+.15*spanScore,4);
  }
  function legacyRhythmMaterial(intervals){
    const clean=cleanIntervals(intervals).slice(-64);
    if(!clean.length)return "no_rhythm";
    const m=mean(clean),v=variance(clean,m);
    return clean.map(x=>Math.round(x)).join(",")+"|m="+m.toFixed(1)+"|v="+v.toFixed(1);
  }
  async function build({text="",intervals=[],minChars=20,kind="badge",creatorId=""}={}){
    const normalizedText=String(text??"");
    const textHash=await sha256Hex(normalizedText);
    const rhythmHash=await sha256Hex(legacyRhythmMaterial(intervals));
    const features=extractFeatures(normalizedText,intervals);
    const quality=qualityScore(normalizedText.length,minChars,features);
    const commitmentPayload={
      domain:DOMAIN,
      version:VERSION,
      feature_schema:FEATURE_SCHEMA,
      kind:String(kind||"badge"),
      creator_id:String(creatorId||""),
      text_hash:textHash,
      features
    };
    const behaviorCommitment=await sha256Hex(stableJson(commitmentPayload));
    const ready=normalizedText.length>=minChars;
    const behavioralAvailable=features.sample_count>=Math.max(4,Math.ceil(minChars*.25));
    return Object.freeze({
      version:VERSION,
      feature_schema:FEATURE_SCHEMA,
      textHash,
      rhythmHash,
      behaviorCommitment,
      score_0_1:ready?1:round(clamp01(normalizedText.length/Math.max(1,minChars)),4),
      quality_0_1:quality,
      sample_count:features.sample_count,
      behavioral_available:behavioralAvailable,
      ready,
      local_features:features
    });
  }
  function publicRecord(candidate){
    if(!candidate||typeof candidate!=="object")return null;
    const version=candidate.version===VERSION?VERSION:"";
    if(!version)return {
      textHash:candidate.textHash||null,
      rhythmHash:candidate.rhythmHash||null,
      score_0_1:Number(candidate.score_0_1)||0
    };
    return Object.freeze({
      version:VERSION,
      feature_schema:FEATURE_SCHEMA,
      textHash:String(candidate.textHash||""),
      rhythmHash:String(candidate.rhythmHash||""),
      behaviorCommitment:String(candidate.behaviorCommitment||""),
      score_0_1:round(clamp01(candidate.score_0_1),4),
      quality_0_1:round(clamp01(candidate.quality_0_1),4),
      sample_count:Math.max(0,Math.min(MAX_INTERVALS,Math.trunc(Number(candidate.sample_count)||0))),
      behavioral_available:Boolean(candidate.behavioral_available)
    });
  }

  root.TraceMindprintV2=Object.freeze({
    VERSION,FEATURE_SCHEMA,MAX_INTERVALS,
    cleanIntervals,extractFeatures,qualityScore,build,publicRecord,stableJson
  });
})(typeof window!=="undefined"?window:globalThis);
