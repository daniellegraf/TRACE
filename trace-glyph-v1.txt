(function traceGlyphV1Factory(root){
  "use strict";

  const VERSION = "trace-glyph-v1";
  const RENDERER_V1 = "trace-glyph-renderer-v1";
  const RENDERER_V2 = "trace-glyph-renderer-v2";
  const RENDERER_V3 = "trace-glyph-renderer-v3";
  const STYLES = Object.freeze({
    hash_shards: "Hash Shards",
    spiro_flow: "Spiro Flow",
    helix_clean: "Helix Clean",
    orbit_ring: "Orbit Ring",
    dna_braid: "DNA Braid",
    minimal_pulse: "Minimal Pulse"
  });
  const STRUCTURE_LABELS = Object.freeze({
    woven_paths: "woven paths",
    interlocked_arcs: "interlocked arcs",
    axial_strands: "axial strands",
    orbital_rings: "orbital rings",
    braided_strands: "braided strands",
    pulse_loops: "pulse loops"
  });
  const MOTION_LABELS = Object.freeze({
    convergent_flow: "Convergent flow",
    divergent_orbit: "Divergent orbit",
    braided_rotation: "Braided rotation",
    pulse_breath: "Layered pulse"
  });
  const COMPLEXITY_LABELS = Object.freeze({
    minimal: "Minimal",
    structured: "Structured",
    layered: "Layered",
    complex: "Complex"
  });
  const LAYER_COUNTS = Object.freeze({ minimal:1, structured:2, layered:3, complex:4 });
  const STYLE_STRUCTURES = Object.freeze({
    hash_shards:["woven_paths","interlocked_arcs"],
    spiro_flow:["woven_paths","interlocked_arcs"],
    helix_clean:["axial_strands","woven_paths"],
    orbit_ring:["orbital_rings","interlocked_arcs"],
    dna_braid:["braided_strands","woven_paths"],
    minimal_pulse:["pulse_loops","interlocked_arcs"]
  });
  const STYLE_MOTIONS = Object.freeze({
    hash_shards:["convergent_flow","braided_rotation"],
    spiro_flow:["convergent_flow","braided_rotation"],
    helix_clean:["braided_rotation","convergent_flow"],
    orbit_ring:["divergent_orbit","braided_rotation"],
    dna_braid:["braided_rotation","convergent_flow"],
    minimal_pulse:["pulse_breath","convergent_flow"]
  });

  function clamp(value,min,max){ return Math.min(max,Math.max(min,Number(value)||0)); }
  function clamp01(value){ return clamp(value,0,1); }
  function clean(value){ return String(value ?? "").trim(); }
  function normalizeStyle(value){ return Object.hasOwn(STYLES,clean(value)) ? clean(value) : "spiro_flow"; }
  function fnv32(value){
    const text=clean(value);let h=2166136261>>>0;
    for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619)>>>0;}
    return h>>>0;
  }
  function hex32(value){ return (value>>>0).toString(16).padStart(8,"0"); }
  function deriveHex(material,label){
    let out="";let state=fnv32(`${label}|${material}`);
    for(let i=0;i<8;i++){
      state=fnv32(`${state}|${i}|${material}|${label}`);
      out+=hex32(state);
    }
    return out.slice(0,64);
  }
  function rawHex(value){
    const match=clean(value).replace(/^sha256:/i,"").toLowerCase();
    return /^[a-f0-9]{64}$/.test(match)?match:"";
  }
  function byteAt(hex,index){
    const start=(index%32)*2;
    return Number.parseInt(hex.slice(start,start+2),16)||0;
  }
  function round(value,digits=4){
    const factor=10**digits;
    return Math.round(Number(value)*factor)/factor;
  }
  function canonicalInputMaterial(inputs){
    return [
      VERSION,
      clean(inputs.creator_id),
      clean(inputs.image_sha256||inputs.img_hash),
      clean(inputs.profile_mindprint_hash||inputs.mindprint_profile_hash),
      clean(inputs.badge_mindprint_hash||inputs.mindprint_badge_hash),
      clean(inputs.proof_id||inputs.badge_key||inputs.badge_id),
      rawHex(inputs.glyph_seed)||clean(inputs.glyph_seed),
      normalizeStyle(inputs.style||inputs.glyph_style),
      round(clamp01(inputs.ai_probability),6)
    ].join("|");
  }

  function normalizeGlyphSpecification(candidate){
    if(!candidate||typeof candidate!=="object"||Array.isArray(candidate)) return null;
    if(candidate.version!==VERSION) return null;
    const style=normalizeStyle(candidate.style);
    const structures=STYLE_STRUCTURES[style];
    const structure=structures.includes(candidate.structure)?candidate.structure:structures[0];
    const motions=STYLE_MOTIONS[style];
    const motion=motions.includes(candidate.motion)?candidate.motion:motions[0];
    const complexity=Object.hasOwn(LAYER_COUNTS,candidate.complexity)?candidate.complexity:"structured";
    const layerCount=LAYER_COUNTS[complexity];
    const geometrySeed=rawHex(candidate.geometry_seed)||deriveHex(JSON.stringify(candidate),"geometry");
    const paletteSeed=rawHex(candidate.palette_seed)||deriveHex(JSON.stringify(candidate),"palette");
    return Object.freeze({
      version:VERSION,
      renderer_version:candidate.renderer_version===RENDERER_V3?RENDERER_V3:(candidate.renderer_version===RENDERER_V2?RENDERER_V2:RENDERER_V1),
      style,
      structure,
      primary_path_count:Math.round(clamp(candidate.primary_path_count,4,22)),
      motion,
      complexity,
      layer_count:layerCount,
      symmetry:Math.round(clamp(candidate.symmetry,1,6)),
      density:round(clamp(candidate.density,0.25,0.95),4),
      rotation_direction:candidate.rotation_direction==="counterclockwise"?"counterclockwise":"clockwise",
      animation_speed:round(clamp(candidate.animation_speed,0.18,0.9),4),
      stroke_profile:["fine","balanced","bold"].includes(candidate.stroke_profile)?candidate.stroke_profile:"fine",
      palette_seed:paletteSeed,
      geometry_seed:geometrySeed,
      visual_signal_influence:Object.freeze({
        kind:"aesthetic_only",
        ai_probability:round(clamp01(candidate.visual_signal_influence?.ai_probability),6),
        palette_tension:round(clamp(candidate.visual_signal_influence?.palette_tension,0,0.22),4)
      })
    });
  }

  function createGlyphSpecification(inputs={}){
    const material=canonicalInputMaterial(inputs);
    const style=normalizeStyle(inputs.style||inputs.glyph_style);
    const baseSeed=rawHex(inputs.glyph_seed)||deriveHex(material,"glyph-base");
    const geometrySeed=deriveHex(`${baseSeed}|${material}`,"geometry");
    const paletteSeed=deriveHex(`${baseSeed}|${material}`,"palette");
    const structureOptions=STYLE_STRUCTURES[style];
    const motionOptions=STYLE_MOTIONS[style];
    const complexities=["minimal","structured","layered","complex"];
    const complexity=complexities[byteAt(geometrySeed,2)%complexities.length];
    const aiProbability=clamp01(inputs.ai_probability);
    const spec={
      version:VERSION,
      renderer_version:RENDERER_V3,
      style,
      structure:structureOptions[byteAt(geometrySeed,0)%structureOptions.length],
      primary_path_count:8+(byteAt(geometrySeed,1)%7),
      motion:motionOptions[byteAt(geometrySeed,3)%motionOptions.length],
      complexity,
      layer_count:LAYER_COUNTS[complexity],
      symmetry:1+(byteAt(geometrySeed,4)%4),
      density:round(0.42+(byteAt(geometrySeed,5)/255)*0.4,4),
      rotation_direction:(byteAt(geometrySeed,6)%2)?"clockwise":"counterclockwise",
      animation_speed:round(0.28+(byteAt(geometrySeed,7)/255)*0.42,4),
      stroke_profile:["fine","balanced","bold"][byteAt(geometrySeed,8)%3],
      palette_seed:paletteSeed,
      geometry_seed:geometrySeed,
      visual_signal_influence:{
        kind:"aesthetic_only",
        ai_probability:round(aiProbability,6),
        palette_tension:round(aiProbability*0.18,4)
      }
    };
    return normalizeGlyphSpecification(spec);
  }

  function describeGlyphSpecification(candidate){
    const spec=normalizeGlyphSpecification(candidate);
    if(!spec) return Object.freeze({legacy:true,family:"Legacy glyph",structure:"Detailed formation metadata unavailable",motion:"",complexity:"",summary:"Legacy glyph · Detailed formation metadata unavailable"});
    const family=STYLES[spec.style];
    const structure=`${spec.primary_path_count} ${STRUCTURE_LABELS[spec.structure]}`;
    const motion=MOTION_LABELS[spec.motion];
    const complexity=COMPLEXITY_LABELS[spec.complexity];
    return Object.freeze({legacy:false,family,structure,motion,complexity,summary:`${structure} · ${motion} · ${complexity}`,layer_detail:`${spec.layer_count} rendering layer${spec.layer_count===1?"":"s"}`});
  }

  function seedPrng(seedText){
    let state=fnv32(seedText)||0x9e3779b9;
    return function(){
      state=(state+0x6D2B79F5)>>>0;
      let x=state;x^=x>>>15;x=Math.imul(x,1|x);x^=x+Math.imul(x^(x>>>7),61|x);
      return ((x^(x>>>14))>>>0)/4294967296;
    };
  }
  function palette(spec){
    const rnd=seedPrng(spec.palette_seed);
    let hue=Math.floor(rnd()*360);
    hue=(hue+Math.round(spec.visual_signal_influence.palette_tension*120))%360;
    const spread=54+Math.floor(rnd()*36);
    return [0,1,2,3].map((_,i)=>`hsl(${(hue+i*spread)%360} 96% ${i%2?66:61}%)`);
  }
  function pathSteps(context){
    const mode=clean(context?.mode||"badge");
    return mode==="avatar"?68:mode==="public"?96:88;
  }
  function motionState(spec,t,index){
    const direction=spec.rotation_direction==="clockwise"?1:-1;
    const phase=t*spec.animation_speed*direction+index*0.19;
    if(spec.motion==="convergent_flow") return {phase,scale:0.91+0.09*(0.5+0.5*Math.cos(phase)),radial:-0.08*(0.5+0.5*Math.sin(phase))};
    if(spec.motion==="divergent_orbit") return {phase,scale:0.96+0.10*(0.5+0.5*Math.sin(phase)),radial:0.09*(0.5+0.5*Math.cos(phase))};
    if(spec.motion==="braided_rotation") return {phase,scale:1,radial:0};
    return {phase,scale:0.96+0.04*(0.5+0.5*Math.sin(phase)),radial:0};
  }
  function pointPath(points,close=false){
    if(!points.length)return "";
    let d=`M${points[0][0].toFixed(2)} ${points[0][1].toFixed(2)}`;
    for(let i=1;i<points.length;i++) d+=` L${points[i][0].toFixed(2)} ${points[i][1].toFixed(2)}`;
    if(close)d+=" Z";
    return d;
  }
  function structuralPath(spec,index,width,height,t=0,context={}){
    const rnd=seedPrng(`${spec.geometry_seed}|${index}`);
    const cx=width/2,cy=height/2;
    const base=Math.min(width,height)*(0.27+spec.density*0.14);
    const m=motionState(spec,t,index);
    const rotation=m.phase*(spec.motion==="braided_rotation"?0.55:0.16);
    const count=pathSteps(context);
    const phase=(index/spec.primary_path_count)*Math.PI*2+rnd()*0.32+rotation;
    const spread=(index-(spec.primary_path_count-1)/2)/Math.max(1,spec.primary_path_count-1);
    const points=[];

    if(spec.style==="orbit_ring"){
      const a=base*(0.58+0.42*(index+1)/spec.primary_path_count)*(1+m.radial);
      const b=a*(0.55+0.28*rnd());
      const tilt=phase*0.35+spread*0.8;
      for(let s=0;s<=count;s++){
        const u=(s/count)*Math.PI*2;
        const ripple=1+0.025*Math.sin(u*spec.symmetry+phase+m.phase);
        const x0=Math.cos(u)*a*ripple*m.scale,y0=Math.sin(u)*b*ripple*m.scale;
        points.push([cx+x0*Math.cos(tilt)-y0*Math.sin(tilt),cy+x0*Math.sin(tilt)+y0*Math.cos(tilt)]);
      }
      return pointPath(points,true);
    }

    if(spec.style==="helix_clean"||spec.style==="dna_braid"){
      const heightSpan=height*0.76;
      const amp=base*(0.32+0.22*rnd())*m.scale;
      const turns=(spec.style==="dna_braid"?2.4:3.1)+spec.symmetry*0.22;
      for(let s=0;s<=count;s++){
        const u=s/count;
        const angle=u*turns*Math.PI*2+phase+m.phase*0.7;
        const convergence=spec.motion==="convergent_flow"?(0.72+0.28*Math.abs(2*u-1)):1;
        const x=cx+Math.sin(angle)*amp*convergence+spread*base*0.22;
        const y=cy-heightSpan/2+u*heightSpan;
        points.push([x,y]);
      }
      return pointPath(points,false);
    }

    if(spec.style==="minimal_pulse"){
      const a=base*(0.62+0.18*spread)*m.scale;
      const b=a*0.72;
      for(let s=0;s<=count;s++){
        const u=(s/count)*Math.PI*2;
        const denom=1+Math.sin(u)**2;
        const x0=a*Math.cos(u)/denom;
        const y0=b*Math.sin(u)*Math.cos(u)/denom;
        const rot=phase*0.14;
        points.push([cx+x0*Math.cos(rot)-y0*Math.sin(rot),cy+x0*Math.sin(rot)+y0*Math.cos(rot)]);
      }
      return pointPath(points,true);
    }

    if(spec.style==="spiro_flow"){
      const R=base*(0.92+0.08*rnd())*m.scale;
      const r=R*(0.24+0.16*rnd());
      const d=R*(0.28+0.16*rnd());
      const k=(R-r)/r;
      for(let s=0;s<=count;s++){
        const u=(s/count)*Math.PI*2*(4+spec.symmetry);
        const x0=(R-r)*Math.cos(u+m.phase*0.24)+d*Math.cos(k*u+phase-m.phase*0.35);
        const y0=(R-r)*Math.sin(u+m.phase*0.24)-d*Math.sin(k*u+phase-m.phase*0.35);
        const scale=0.42+index/spec.primary_path_count*0.12;
        points.push([cx+x0*scale,cy+y0*scale]);
      }
      return pointPath(points,false);
    }

    // Hash Shards: each primary path is one visible woven radial loop.
    const angle=phase;
    const inner=base*(0.18+0.05*rnd());
    const outer=base*(0.72+0.22*rnd())*m.scale*(1+m.radial);
    const tangent=base*(0.14+0.08*spec.density);
    const turns=1+spec.symmetry*0.25;
    for(let s=0;s<=count;s++){
      const u=s/count;
      const envelope=Math.sin(Math.PI*u);
      const radial=inner+(outer-inner)*envelope;
      const weave=Math.sin(u*Math.PI*2*turns+index*0.63+m.phase)*tangent*envelope;
      const a=angle+(u-0.5)*0.34+0.04*Math.sin(m.phase);
      const x=cx+Math.cos(a)*radial-Math.sin(a)*weave;
      const y=cy+Math.sin(a)*radial+Math.cos(a)*weave;
      points.push([x,y]);
    }
    return pointPath(points,false);
  }

  function renderGlyphFromSpecification(candidate,context={}){
    const spec=normalizeGlyphSpecification(candidate);
    if(!spec) return "";
    const v2=spec.renderer_version===RENDERER_V2;
    const v3=spec.renderer_version===RENDERER_V3;
    const advanced=v2||v3;
    const mode=clean(context.mode||"badge");
    const width=Math.max(48,Math.round(Number(context.width)||(mode==="avatar"?96:mode==="public"?180:142)));
    const height=Math.max(48,Math.round(Number(context.height)||(mode==="avatar"?96:mode==="public"?180:92)));
    const colors=palette(spec);
    const uid=`tg_${spec.geometry_seed.slice(0,10)}_${mode}`.replace(/[^a-z0-9_-]/gi,"");
    const strokeBase={fine:0.72,balanced:0.94,bold:1.18}[spec.stroke_profile];
    const stroke=v3?strokeBase*0.82:(v2?strokeBase*0.92:strokeBase);
    const specEncoded=encodeURIComponent(JSON.stringify(spec));
    let svg=`<svg class="glyph3d trace-glyph-v1${v2?" trace-glyph-renderer-v2":v3?" trace-glyph-renderer-v3":""}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Deterministic TRACE proof glyph" preserveAspectRatio="xMidYMid meet" data-glyph-spec-version="${VERSION}" data-glyph-renderer-version="${spec.renderer_version}" data-glyph-spec="${specEncoded}" data-motion-model="${spec.motion}" data-rendered-primary-count="${spec.primary_path_count}" data-rendered-layer-count="${spec.layer_count}">`;
    svg+=`<defs>
      <radialGradient id="${uid}_core" cx="50%" cy="50%" r="72%"><stop offset="0" stop-color="${colors[2]}" stop-opacity="${advanced?".22":".18"}"/><stop offset=".52" stop-color="${colors[0]}" stop-opacity="${advanced?".08":".06"}"/><stop offset="1" stop-color="#000" stop-opacity="1"/></radialGradient>
      <linearGradient id="${uid}_line" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${colors[0]}"/><stop offset=".34" stop-color="${colors[1]}"/><stop offset=".68" stop-color="${colors[2]}"/><stop offset="1" stop-color="${colors[3]}"/></linearGradient>
      ${advanced?`<linearGradient id="${uid}_line2" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${colors[3]}"/><stop offset=".34" stop-color="${colors[2]}"/><stop offset=".68" stop-color="${colors[1]}"/><stop offset="1" stop-color="${colors[0]}"/></linearGradient>
      <filter id="${uid}_softGlow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation=".55" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`:""}
    </defs>`;
    svg+=`<rect width="${width}" height="${height}" fill="#000"/><rect width="${width}" height="${height}" fill="url(#${uid}_core)"/>`;

    const primary=[];
    for(let i=0;i<spec.primary_path_count;i++) primary.push(structuralPath(spec,i,width,height,0,context));
    const cx=width/2,cy=height/2,min=Math.min(width,height);
    const seed=spec.geometry_seed;
    const b=(i)=>byteAt(seed,i);

    if(spec.layer_count>=2){
      svg+=`<g data-glyph-layer="halo" class="trace-glyph-layer trace-glyph-halo-layer">`;
      primary.forEach((d,i)=>{svg+=`<path class="trace-glyph-halo" data-path-index="${i}" d="${d}" fill="none" stroke="${colors[i%colors.length]}" stroke-width="${(stroke*(advanced?2.6:3.2)).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round" opacity="${advanced?".065":".075"}"/>`;});
      if(advanced){
        const ringR=min*(.24+(b(12)/255)*.08);
        const dash=Math.max(1.5,min*.018),gap=Math.max(2.5,min*.028);
        svg+=`<circle class="trace-glyph-v2-orbit" cx="${cx}" cy="${cy}" r="${ringR.toFixed(2)}" fill="none" stroke="${colors[3]}" stroke-width="${(stroke*.42).toFixed(2)}" stroke-dasharray="${dash.toFixed(2)} ${gap.toFixed(2)}" opacity=".22"/>`;
      }
      svg+=`</g>`;
    }

    svg+=`<g data-glyph-layer="primary" class="trace-glyph-layer trace-glyph-primary-layer" data-active-motion="${spec.motion}">`;
    primary.forEach((d,i)=>{
      svg+=`<path class="trace-glyph-primary strand" data-path-index="${i}" d="${d}" fill="none" stroke="url(#${uid}_${advanced&&i%2?"line2":"line"})" stroke-width="${stroke.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round" opacity="${(0.62+0.34*(i+1)/spec.primary_path_count).toFixed(3)}"${advanced?' vector-effect="non-scaling-stroke"':''}/>`;
    });
    if(advanced){
      // Proof-derived micro geometry lives inside the primary layer so the signed
      // layer count remains literal while the renderer gains recognisable detail.
      const ringCount=2+(b(14)%3);
      for(let r=0;r<ringCount;r++){
        const rr=min*(.105+r*.055+(b(15+r)/255)*.018);
        const start=(b(20+r)/255)*Math.PI*2;
        const span=Math.PI*(.55+(b(24+r)/255)*.85);
        const x1=cx+Math.cos(start)*rr,y1=cy+Math.sin(start)*rr;
        const x2=cx+Math.cos(start+span)*rr,y2=cy+Math.sin(start+span)*rr;
        const large=span>Math.PI?1:0;
        svg+=`<path class="trace-glyph-v2-micro" d="M${x1.toFixed(2)} ${y1.toFixed(2)} A${rr.toFixed(2)} ${rr.toFixed(2)} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}" fill="none" stroke="${colors[(r+1)%colors.length]}" stroke-width="${(stroke*.38).toFixed(2)}" opacity=".40" stroke-linecap="round"/>`;
      }
      const axis=(b(30)/255)*Math.PI;
      const arm=min*(.12+(b(31)/255)*.08);
      svg+=`<path class="trace-glyph-v2-micro" d="M${(cx-Math.cos(axis)*arm).toFixed(2)} ${(cy-Math.sin(axis)*arm).toFixed(2)} L${(cx+Math.cos(axis)*arm).toFixed(2)} ${(cy+Math.sin(axis)*arm).toFixed(2)}" stroke="${colors[1]}" stroke-width="${(stroke*.30).toFixed(2)}" opacity=".28" stroke-dasharray="1.2 2.6"/>`;
    }
    svg+=`</g>`;

    if(spec.layer_count>=3){
      const r=min*(0.08+spec.density*0.04);
      svg+=`<g data-glyph-layer="detail" class="trace-glyph-layer trace-glyph-detail-layer" opacity="${advanced?".58":".42"}">`;
      svg+=`<circle cx="${cx}" cy="${cy}" r="${r.toFixed(2)}" fill="none" stroke="${colors[2]}" stroke-width="${(stroke*0.55).toFixed(2)}" stroke-dasharray="${advanced?"1.4 3.2":"2 4"}"/><circle cx="${cx}" cy="${cy}" r="${(r*0.35).toFixed(2)}" fill="${colors[1]}" opacity="${advanced?".30":".22"}"/>`;
      if(advanced){
        const anchors=4+(b(9)%5);
        for(let i=0;i<anchors;i++){
          const a=(i/anchors)*Math.PI*2+(b(10)/255)*.7;
          const rr=min*(.18+(b(11+i)/255)*.16);
          const ar=0.7+(b(18+i)%4)*.22;
          svg+=`<circle class="trace-glyph-v2-anchor" cx="${(cx+Math.cos(a)*rr).toFixed(2)}" cy="${(cy+Math.sin(a)*rr).toFixed(2)}" r="${ar.toFixed(2)}" fill="${colors[i%colors.length]}" opacity="${(.34+(i%3)*.08).toFixed(2)}"/>`;
        }
      }
      svg+=`</g>`;
    }

    if(spec.layer_count>=4){
      svg+=`<g data-glyph-layer="nodes" class="trace-glyph-layer trace-glyph-node-layer">`;
      const nodeCount=advanced?Math.max(6,spec.symmetry*3):spec.symmetry*2;
      for(let i=0;i<nodeCount;i++){
        const a=(i/nodeCount)*Math.PI*2+(advanced?(b(28)/255)*.45:0);
        const rr=min*(advanced?(.28+(i%2)*.07):.34);
        svg+=`<circle cx="${(cx+Math.cos(a)*rr).toFixed(2)}" cy="${(cy+Math.sin(a)*rr).toFixed(2)}" r="${advanced?(i%3===0?1.35:.82):1.15}" fill="${colors[i%colors.length]}" opacity="${advanced?".60":".52"}"/>`;
        if(advanced&&i%2===0){
          const x1=cx+Math.cos(a)*rr*.56,y1=cy+Math.sin(a)*rr*.56;
          const x2=cx+Math.cos(a)*rr,y2=cy+Math.sin(a)*rr;
          svg+=`<path d="M${x1.toFixed(2)} ${y1.toFixed(2)} L${x2.toFixed(2)} ${y2.toFixed(2)}" stroke="${colors[(i+2)%colors.length]}" stroke-width="${(stroke*.24).toFixed(2)}" opacity=".25"/>`;
        }
      }
      svg+=`</g>`;
    }
    if(v3){
      // Renderer V3 adds a crisp provenance-topology pass without changing the
      // signed glyph specification or the literal primary-path/layer counts.
      const outerR=min*(.405+(b(4)/255)*.035);
      const innerR=min*(.118+(b(5)/255)*.026);
      const sectors=8+(b(6)%9);
      const phase=(b(7)/255)*Math.PI*2;
      svg+=`<g class="trace-glyph-v3-topology" opacity=".78">`;
      svg+=`<circle cx="${cx}" cy="${cy}" r="${outerR.toFixed(2)}" fill="none" stroke="${colors[0]}" stroke-width="${(stroke*.24).toFixed(2)}" stroke-dasharray=".9 3.2" opacity=".34" vector-effect="non-scaling-stroke"/>`;
      svg+=`<circle cx="${cx}" cy="${cy}" r="${(outerR*.86).toFixed(2)}" fill="none" stroke="${colors[2]}" stroke-width="${(stroke*.16).toFixed(2)}" opacity=".18" vector-effect="non-scaling-stroke"/>`;
      for(let i=0;i<sectors;i++){
        const a=phase+(i/sectors)*Math.PI*2;
        const a2=a+((b(8+i%16)/255)-.5)*.12;
        const r1=innerR*(.72+(i%3)*.10);
        const r2=outerR*(.82+(i%2)*.11);
        const x1=cx+Math.cos(a)*r1,y1=cy+Math.sin(a)*r1;
        const x2=cx+Math.cos(a2)*r2,y2=cy+Math.sin(a2)*r2;
        svg+=`<path class="trace-glyph-v3-ray" d="M${x1.toFixed(2)} ${y1.toFixed(2)} L${x2.toFixed(2)} ${y2.toFixed(2)}" fill="none" stroke="${colors[(i+1)%colors.length]}" stroke-width="${(stroke*(i%4===0?.30:.16)).toFixed(2)}" opacity="${i%4===0?'.34':'.16'}" vector-effect="non-scaling-stroke"/>`;
        if(i%2===0){
          svg+=`<circle cx="${x2.toFixed(2)}" cy="${y2.toFixed(2)}" r="${(0.52+(i%3)*.18).toFixed(2)}" fill="${colors[(i+2)%colors.length]}" opacity=".72"/>`;
        }
      }
      const poly=5+(b(25)%4);
      const pr=innerR*(.62+(b(26)/255)*.20);
      let pd="";
      for(let i=0;i<poly;i++){
        const a=phase*.5+(i/poly)*Math.PI*2;
        const x=cx+Math.cos(a)*pr,y=cy+Math.sin(a)*pr;
        pd+=(i?" L":"M")+x.toFixed(2)+" "+y.toFixed(2);
      }
      pd+=" Z";
      svg+=`<path class="trace-glyph-v3-core" d="${pd}" fill="none" stroke="${colors[1]}" stroke-width="${(stroke*.42).toFixed(2)}" opacity=".72" vector-effect="non-scaling-stroke"/>`;
      svg+=`<circle cx="${cx}" cy="${cy}" r="${(pr*.28).toFixed(2)}" fill="${colors[3]}" opacity=".62"/>`;
      svg+=`</g>`;
    }
    svg+=`</svg>`;
    return svg;
  }

  function parseSpecFromSvg(svg){
    try{return normalizeGlyphSpecification(JSON.parse(decodeURIComponent(svg?.dataset?.glyphSpec||"")));}catch{return null;}
  }
  function validateRenderedGlyph(svg,candidate){
    const spec=normalizeGlyphSpecification(candidate)||parseSpecFromSvg(svg);
    if(!svg||!spec)return {ok:false,errors:["missing_spec_or_svg"]};
    const primary=svg.querySelectorAll(".trace-glyph-primary").length;
    const layers=svg.querySelectorAll("[data-glyph-layer]").length;
    const motion=svg.querySelector(".trace-glyph-primary-layer")?.dataset?.activeMotion||svg.dataset.motionModel||"";
    const errors=[];
    if(primary!==spec.primary_path_count)errors.push(`primary_path_count:${primary}!=${spec.primary_path_count}`);
    if(layers!==spec.layer_count)errors.push(`layer_count:${layers}!=${spec.layer_count}`);
    if(motion!==spec.motion)errors.push(`motion:${motion}!=${spec.motion}`);
    return {ok:errors.length===0,errors,renderedPrimaryPathCount:primary,renderedLayerCount:layers,activeMotionModel:motion};
  }

  function startGlyphMotion(svg){
    if(!svg||svg.dataset.traceGlyphV1Motion==="1")return;
    const spec=parseSpecFromSvg(svg);if(!spec)return;
    svg.dataset.traceGlyphV1Motion="1";
    const reduced=!!(root.matchMedia&&root.matchMedia("(prefers-reduced-motion: reduce)").matches);
    if(reduced){svg.dataset.motionReduced="1";return;}
    const vb=(svg.getAttribute("viewBox")||"0 0 142 92").split(/\s+/).map(Number);
    const width=vb[2]||142,height=vb[3]||92;
    const mode=height===width?"avatar":"badge";
    const primary=Array.from(svg.querySelectorAll(".trace-glyph-primary"));
    const halos=Array.from(svg.querySelectorAll(".trace-glyph-halo"));
    let raf=0,last=0;
    const tick=(now)=>{
      if(!svg.isConnected){if(raf)root.cancelAnimationFrame?.(raf);return;}
      if(now-last<33){raf=root.requestAnimationFrame(tick);return;}
      last=now;const t=now/1000;
      for(let i=0;i<primary.length;i++){
        const d=structuralPath(spec,i,width,height,t + i*0.14,{mode});
        primary[i].setAttribute("d",d);if(halos[i])halos[i].setAttribute("d",d);
      }
      if(spec.renderer_version===RENDERER_V2 || spec.renderer_version===RENDERER_V3){
        const direction=spec.rotation_direction==="counterclockwise"?-1:1;
        const angle=((t*10*spec.animation_speed*direction)%360).toFixed(3);
        svg.querySelectorAll(".trace-glyph-v2-orbit").forEach(node=>node.setAttribute("transform",`rotate(${angle} ${width/2} ${height/2})`));
        if(spec.renderer_version===RENDERER_V3){
          const counter=((-t*4.5*spec.animation_speed*direction)%360).toFixed(3);
          svg.querySelectorAll(".trace-glyph-v3-topology").forEach(node=>node.setAttribute("transform",`rotate(${counter} ${width/2} ${height/2})`));
        }
      }
      raf=root.requestAnimationFrame(tick);
    };
    raf=root.requestAnimationFrame(tick);
  }

  function exampleSpecification(){
    return normalizeGlyphSpecification({
      version:VERSION,style:"hash_shards",structure:"woven_paths",primary_path_count:10,
      motion:"convergent_flow",complexity:"layered",layer_count:3,symmetry:2,density:.64,
      rotation_direction:"clockwise",animation_speed:.42,stroke_profile:"fine",
      palette_seed:deriveHex("trace-about-specimen","palette"),geometry_seed:deriveHex("trace-about-specimen","geometry"),
      visual_signal_influence:{kind:"aesthetic_only",ai_probability:0,palette_tension:0}
    });
  }

  const api=Object.freeze({
    VERSION,RENDERER_V1,RENDERER_V2,RENDERER_V3,STYLES,normalizeGlyphSpecification,createGlyphSpecification,describeGlyphSpecification,
    renderGlyphFromSpecification,startGlyphMotion,validateRenderedGlyph,exampleSpecification
  });
  root.TraceGlyphV1=api;
})(typeof window!=="undefined"?window:globalThis);
