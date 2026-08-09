(function traceGlyphV1Factory(root){
  "use strict";

  const VERSION = "trace-glyph-v1";
  const RENDERER_V1 = "trace-glyph-renderer-v1";
  const RENDERER_V2 = "trace-glyph-renderer-v2";
  const RENDERER_V3 = "trace-glyph-renderer-v3";
  const RENDERER_V4 = "trace-glyph-renderer-v4-true3d";
  const RENDERER_V5 = "trace-glyph-renderer-v5-spatial-4d";
  const RENDERER_V6 = "trace-glyph-renderer-v6-volumetric";
  const RENDERER_V7 = "trace-glyph-renderer-v7-premium-spatial";
  const PROFILE_RENDERER_V2 = "trace-profile-glyph-v2-spatial";
  const STYLES = Object.freeze({
    hash_shards: "Hash Shards",
    spiro_flow: "Spiro Flow",
    helix_clean: "Helix Clean",
    orbit_ring: "Orbit Ring",
    dna_braid: "DNA Braid",
    minimal_pulse: "Minimal Pulse",
    quantum_lattice: "Tesseract Flux 4D",
    prism_vault: "Crystal Vault 3D",
    neural_constellation: "Neural Forge 3D"
  });
  const STRUCTURE_LABELS = Object.freeze({
    woven_paths: "woven paths",
    interlocked_arcs: "interlocked arcs",
    axial_strands: "axial strands",
    orbital_rings: "orbital rings",
    braided_strands: "braided strands",
    pulse_loops: "pulse loops",
    lattice_filaments: "lattice filaments",
    faceted_arcs: "faceted arcs",
    connected_nodes: "connected nodes"
  });
  const MOTION_LABELS = Object.freeze({
    convergent_flow: "Convergent flow",
    divergent_orbit: "Divergent orbit",
    braided_rotation: "Braided rotation",
    pulse_breath: "Layered pulse",
    depth_precession: "Depth precession",
    torsion_orbit: "Torsion orbit",
    parallax_drift: "Parallax drift"
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
    minimal_pulse:["pulse_loops","interlocked_arcs"],
    quantum_lattice:["lattice_filaments","interlocked_arcs"],
    prism_vault:["faceted_arcs","orbital_rings"],
    neural_constellation:["connected_nodes","woven_paths"]
  });
  const STYLE_MOTIONS = Object.freeze({
    hash_shards:["convergent_flow","braided_rotation"],
    spiro_flow:["convergent_flow","braided_rotation"],
    helix_clean:["braided_rotation","convergent_flow"],
    orbit_ring:["divergent_orbit","braided_rotation"],
    dna_braid:["braided_rotation","convergent_flow"],
    minimal_pulse:["pulse_breath","convergent_flow"],
    quantum_lattice:["depth_precession","convergent_flow"],
    prism_vault:["torsion_orbit","braided_rotation"],
    neural_constellation:["parallax_drift","convergent_flow"]
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
      renderer_version:candidate.renderer_version===RENDERER_V7?RENDERER_V7:(candidate.renderer_version===RENDERER_V6?RENDERER_V6:(candidate.renderer_version===RENDERER_V5?RENDERER_V5:(candidate.renderer_version===RENDERER_V4?RENDERER_V4:(candidate.renderer_version===RENDERER_V3?RENDERER_V3:(candidate.renderer_version===RENDERER_V2?RENDERER_V2:RENDERER_V1))))),
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
      renderer_version:RENDERER_V7,
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
  function premiumPalette(spec){
    const base=palette(spec);
    // V7 keeps palette_seed determinism but restrains saturation/brightness into a
    // precision-instrument material language instead of candy/neon output.
    const rnd=seedPrng(spec.palette_seed+"|premium-v7");
    const anchor=Math.floor(rnd()*32); // subtle proof-derived spectral offset
    return [
      `hsl(${188+anchor} 54% 72%)`,
      `hsl(${164+Math.floor(anchor*.45)} 46% 62%)`,
      `hsl(${205+Math.floor(anchor*.55)} 34% 82%)`,
      `hsl(${220+Math.floor(anchor*.35)} 28% 55%)`
    ];
  }
  function qualityForContext(context={}){
    const explicit=clean(context.quality||"").toLowerCase();
    if(["high","medium","low","static"].includes(explicit))return explicit;
    const mode=clean(context.mode||"badge");
    if(mode==="public"||mode==="export"||mode==="reveal")return "high";
    if(mode==="avatar"||mode==="profile")return "medium";
    if(mode==="gallery"||mode==="thumbnail")return "low";
    return "medium";
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
    if(spec.motion==="depth_precession") return {phase,scale:0.94+0.07*(0.5+0.5*Math.sin(phase*.72)),radial:0.035*Math.sin(phase*.58)};
    if(spec.motion==="torsion_orbit") return {phase,scale:0.96+0.05*(0.5+0.5*Math.cos(phase*.82)),radial:0.05*Math.sin(phase*.44)};
    if(spec.motion==="parallax_drift") return {phase,scale:0.95+0.05*(0.5+0.5*Math.sin(phase*.66)),radial:0.025*Math.cos(phase*.51)};
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

    if(spec.style==="quantum_lattice"){
      const radius=base*(0.58+0.32*(index+1)/spec.primary_path_count)*m.scale;
      const tiltX=0.38+0.42*rnd(), tiltY=0.42+0.38*rnd();
      const freqA=2+(index%4),freqB=3+((index+spec.symmetry)%5);
      for(let s=0;s<=count;s++){
        const u=(s/count)*Math.PI*2;
        const z=Math.sin(u*freqB+phase+m.phase*.72);
        const depth=0.72+0.28*((z+1)/2);
        const x0=Math.cos(u*freqA+phase)*radius*tiltX;
        const y0=Math.sin(u*freqB-phase*.6)*radius*tiltY;
        const rot=phase*.18+m.phase*.10;
        points.push([cx+(x0*Math.cos(rot)-y0*Math.sin(rot))*depth,cy+(x0*Math.sin(rot)+y0*Math.cos(rot))*depth+z*base*.10]);
      }
      return pointPath(points,false);
    }

    if(spec.style==="prism_vault"){
      const sides=5+(index%5);
      const radius=base*(0.48+0.44*(index+1)/spec.primary_path_count)*m.scale;
      const twist=phase*.33+m.phase*.22;
      for(let s=0;s<=count;s++){
        const u=s/count;
        const angular=u*Math.PI*2;
        const facet=Math.cos(Math.round((angular/(Math.PI*2))*sides)*(Math.PI*2/sides));
        const z=Math.sin(angular*2+phase)*.5+.5;
        const rr=radius*(.78+.22*facet)*(1+m.radial*.4);
        const x0=Math.cos(angular+twist)*rr;
        const y0=Math.sin(angular+twist)*rr*(.52+.26*z);
        points.push([cx+x0,cy+y0+(z-.5)*base*.18]);
      }
      return pointPath(points,true);
    }

    if(spec.style==="neural_constellation"){
      const lobes=3+spec.symmetry+(index%3);
      const radius=base*(0.40+0.50*(index+1)/spec.primary_path_count)*m.scale;
      for(let s=0;s<=count;s++){
        const u=(s/count)*Math.PI*2;
        const z=Math.sin(u*(lobes+1)+phase+m.phase*.48);
        const rr=radius*(.70+.18*Math.sin(u*lobes+phase)+.12*z);
        const a=u+phase*.18+m.phase*.11;
        const depth=.76+.24*((z+1)/2);
        points.push([cx+Math.cos(a)*rr*depth,cy+Math.sin(a)*rr*(.60+.20*depth)+z*base*.08]);
      }
      return pointPath(points,true);
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


  // --- Renderer V4: actual deterministic 3D geometry projected into SVG ---
  // The three *3D styles below are generated as XYZ point clouds/curves first,
  // rotated around all three axes, perspective-projected through a camera, and
  // depth-sorted before SVG faces are emitted. Historical V1/V2/V3 glyphs keep
  // their original renderer and therefore remain visually stable.
  function v3add(a,b){return [a[0]+b[0],a[1]+b[1],a[2]+b[2]];}
  function v3sub(a,b){return [a[0]-b[0],a[1]-b[1],a[2]-b[2]];}
  function v3mul(a,k){return [a[0]*k,a[1]*k,a[2]*k];}
  function v3dot(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}
  function v3cross(a,b){return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];}
  function v3len(a){return Math.hypot(a[0],a[1],a[2])||1;}
  function v3norm(a){const l=v3len(a);return [a[0]/l,a[1]/l,a[2]/l];}
  function rotate3D(p,ax,ay,az){
    let [x,y,z]=p;
    let c=Math.cos(ax),s=Math.sin(ax); [y,z]=[y*c-z*s,y*s+z*c];
    c=Math.cos(ay);s=Math.sin(ay); [x,z]=[x*c+z*s,-x*s+z*c];
    c=Math.cos(az);s=Math.sin(az); [x,y]=[x*c-y*s,x*s+y*c];
    return [x,y,z];
  }
  function cameraFor(spec,width,height,t){
    const dir=spec.rotation_direction==="clockwise"?1:-1;
    const b=(i)=>byteAt(spec.geometry_seed,i);
    const speed=spec.animation_speed;
    return {
      ax:(0.42+(b(2)/255)*0.34)+Math.sin(t*speed*.41)*0.18,
      ay:(-0.52+(b(3)/255)*1.04)+dir*t*speed*.34,
      az:(-0.20+(b(4)/255)*0.40)+Math.sin(t*speed*.27)*0.10,
      focal:3.25+(b(5)/255)*0.75,
      zoom:Math.min(width,height)*(0.33+(b(6)/255)*0.035),
      cx:width/2,cy:height/2
    };
  }
  function project3D(p,camera){
    const q=rotate3D(p,camera.ax,camera.ay,camera.az);
    const denom=Math.max(.72,camera.focal-q[2]);
    const k=camera.focal/denom;
    return {x:camera.cx+q[0]*camera.zoom*k,y:camera.cy-q[1]*camera.zoom*k,z:q[2],k};
  }
  function true3DSteps(context){
    const mode=clean(context?.mode||"badge");
    return mode==="avatar"?18:mode==="public"?34:26;
  }
  function true3DPath(spec,index,context={}){
    const count=true3DSteps(context);
    const rnd=seedPrng(`${spec.geometry_seed}|3d|${index}`);
    const pts=[];
    const spread=(index-(spec.primary_path_count-1)/2)/Math.max(1,spec.primary_path_count-1);
    const phase=(index/spec.primary_path_count)*Math.PI*2+rnd()*.35;
    if(spec.style==="quantum_lattice"){
      // Interlocked Lissajous filaments distributed through a spherical volume.
      const a=2+(index%4), b=3+((index+spec.symmetry)%5), c=2+((index*2+1)%4);
      const squash=.78+.16*rnd();
      for(let i=0;i<=count;i++){
        const u=i/count*Math.PI*2;
        pts.push([
          Math.sin(a*u+phase)*(.72+.13*spread),
          Math.sin(b*u-phase*.73)*(.72-.10*spread)*squash,
          Math.cos(c*u+phase*.47)*(.58+.18*rnd()) + spread*.22
        ]);
      }
      return pts;
    }
    if(spec.style==="prism_vault"){
      // Twisted polygonal vault: each primary path occupies a separate Z slice.
      const sides=5+(index%5), twist=(1.1+(index%3)*.35)*(spec.rotation_direction==="clockwise"?1:-1);
      const zBase=spread*.72;
      for(let i=0;i<=count;i++){
        const u=i/count*Math.PI*2;
        const sector=Math.round((u/(Math.PI*2))*sides)%sides;
        const facetAngle=sector*Math.PI*2/sides+phase*.22;
        const rr=.62+.17*Math.cos(sides*u+phase);
        const z=zBase+.34*Math.sin(u*2+phase)+.18*Math.cos(u*sides*.5);
        const a=u+twist*z*.32+phase*.18;
        pts.push([Math.cos(a)*rr,Math.sin(a)*rr*.78,z]);
      }
      return pts;
    }
    // Neural Constellation: deterministic 3D spline-like routes through a volume.
    const lobes=3+spec.symmetry+(index%3);
    for(let i=0;i<=count;i++){
      const u=i/count*Math.PI*2;
      const rr=.48+.17*Math.sin(lobes*u+phase)+.08*Math.sin((lobes+3)*u-phase);
      const z=.52*Math.sin((lobes-1)*u+phase*.8)+spread*.30;
      const a=u+phase*.28+.20*Math.sin(u*2+phase);
      pts.push([Math.cos(a)*rr,Math.sin(a)*rr*.84,z]);
    }
    return pts;
  }
  function tubeFacesForPath(worldPoints,camera,radius,color,pathIndex){
    const faces=[]; const sides=4; const light=v3norm([-0.35,0.55,1]);
    for(let i=0;i<worldPoints.length-1;i++){
      const p0=rotate3D(worldPoints[i],camera.ax,camera.ay,camera.az);
      const p1=rotate3D(worldPoints[i+1],camera.ax,camera.ay,camera.az);
      const tangent=v3norm(v3sub(p1,p0));
      let n=v3cross(tangent,[0,0,1]); if(v3len(n)<.05)n=v3cross(tangent,[0,1,0]); n=v3norm(n);
      const bn=v3norm(v3cross(tangent,n));
      const rings=[p0,p1].map(p=>Array.from({length:sides},(_,j)=>{
        const a=j/sides*Math.PI*2;
        return v3add(p,v3add(v3mul(n,Math.cos(a)*radius),v3mul(bn,Math.sin(a)*radius)));
      }));
      for(let j=0;j<sides;j++){
        const j2=(j+1)%sides;
        const verts=[rings[0][j],rings[0][j2],rings[1][j2],rings[1][j]];
        const normal=v3norm(v3cross(v3sub(verts[1],verts[0]),v3sub(verts[3],verts[0])));
        const lambert=.24+.76*Math.abs(v3dot(normal,light));
        const projected=verts.map(q=>{
          const denom=Math.max(.72,camera.focal-q[2]); const k=camera.focal/denom;
          return {x:camera.cx+q[0]*camera.zoom*k,y:camera.cy-q[1]*camera.zoom*k,z:q[2],k};
        });
        faces.push({
          depth:projected.reduce((a,v)=>a+v.z,0)/4,
          points:projected.map(v=>`${v.x.toFixed(2)},${v.y.toFixed(2)}`).join(" "),
          opacity:(.24+.55*lambert).toFixed(3),
          color,pathIndex
        });
      }
    }
    return faces;
  }
  function buildTrue3DScene(spec,width,height,t,context,colors,stroke){
    const camera=cameraFor(spec,width,height,t);
    const pathWorld=[]; const projectedPaths=[]; const faces=[];
    const radiusBase={fine:.012,balanced:.016,bold:.021}[spec.stroke_profile]*(.88+spec.density*.28);
    for(let i=0;i<spec.primary_path_count;i++){
      const world=true3DPath(spec,i,context); pathWorld.push(world);
      const projected=world.map(p=>project3D(p,camera)); projectedPaths.push(projected);
      faces.push(...tubeFacesForPath(world,camera,radiusBase,colors[i%colors.length],i));
    }
    faces.sort((a,b)=>a.depth-b.depth); // painter's algorithm: far -> near
    const surfaces=faces.map(f=>`<polygon class="trace-glyph-v4-face" data-path-index="${f.pathIndex}" points="${f.points}" fill="${f.color}" fill-opacity="${f.opacity}" stroke="none"/>`).join("");
    const primary=projectedPaths.map((pts,i)=>{
      const d=pts.map((p,j)=>(j?"L":"M")+p.x.toFixed(2)+" "+p.y.toFixed(2)).join(" ");
      const avg=pts.reduce((a,p)=>a+p.z,0)/pts.length;
      const opacity=(.28+.38*((avg+1.2)/2.4)).toFixed(3);
      return {d,opacity,index:i};
    });
    // Deterministic 3D anchor nodes for Neural Constellation only.
    let nodes="";
    if(spec.style==="neural_constellation"){
      const rnd=seedPrng(`${spec.geometry_seed}|nodes3d`); const n=7+(byteAt(spec.geometry_seed,17)%7);
      const list=[];
      for(let i=0;i<n;i++){
        const a=rnd()*Math.PI*2, r=.30+rnd()*.55, z=-.62+rnd()*1.24;
        const p=project3D([Math.cos(a)*r,Math.sin(a)*r*.85,z],camera); list.push({...p,c:colors[i%colors.length]});
      }
      list.sort((a,b)=>a.z-b.z);
      nodes=list.map(n=>`<g class="trace-glyph-v4-node"><circle cx="${n.x.toFixed(2)}" cy="${n.y.toFixed(2)}" r="${(1.0+2.3*n.k).toFixed(2)}" fill="${n.c}" opacity=".78"/><circle cx="${(n.x-.45*n.k).toFixed(2)}" cy="${(n.y-.55*n.k).toFixed(2)}" r="${(.25+.42*n.k).toFixed(2)}" fill="#fff" opacity=".82"/></g>`).join("");
    }
    return {surfaces,primary,nodes,camera};
  }


  // --- Renderer V5: spatial families with genuinely different geometry ---
  // Tesseract Flux is a deterministic 4D hypercube projected 4D -> 3D -> 2D.
  // Crystal Vault is a faceted 3D architectural solid. Neural Forge is a
  // branching 3D graph. Historical renderer versions remain untouched.
  function rotatePlane4D(p,a,b,theta){
    const q=p.slice(); const c=Math.cos(theta),s=Math.sin(theta);
    const x=q[a],y=q[b]; q[a]=x*c-y*s; q[b]=x*s+y*c; return q;
  }
  function rotate4D(p,angles){
    let q=p.slice();
    q=rotatePlane4D(q,0,3,angles.xw);
    q=rotatePlane4D(q,1,3,angles.yw);
    q=rotatePlane4D(q,2,3,angles.zw);
    q=rotatePlane4D(q,0,1,angles.xy);
    q=rotatePlane4D(q,1,2,angles.yz);
    return q;
  }
  function project4Dto3D(p,d=2.75){
    const k=d/Math.max(.62,d-p[3]);
    return [p[0]*k,p[1]*k,p[2]*k];
  }
  function projectCameraPoint(q,camera){
    const r=rotate3D(q,camera.ax,camera.ay,camera.az);
    const denom=Math.max(.72,camera.focal-r[2]); const k=camera.focal/denom;
    return {x:camera.cx+r[0]*camera.zoom*k,y:camera.cy-r[1]*camera.zoom*k,z:r[2],k};
  }
  function cameraV5(spec,width,height,t,style){
    const b=(i)=>byteAt(spec.geometry_seed,i),dir=spec.rotation_direction==="clockwise"?1:-1;
    const speed=spec.animation_speed;
    const baseZoom=style==="prism_vault"?.43:style==="neural_constellation"?.42:.39;
    return {
      ax:.40+(b(2)/255)*.32+Math.sin(t*speed*.29)*.12,
      ay:-.50+(b(3)/255)*1.0+dir*t*speed*(style==="neural_constellation"?.13:.20),
      az:-.16+(b(4)/255)*.32+Math.sin(t*speed*.19)*.07,
      focal:3.7+(b(5)/255)*.55,
      zoom:Math.min(width,height)*(baseZoom+(b(6)/255)*.025),
      cx:width/2,cy:height/2
    };
  }
  function shadeFace3D(verts,camera,color,opacity=.72){
    const rv=verts.map(p=>rotate3D(p,camera.ax,camera.ay,camera.az));
    const n=v3norm(v3cross(v3sub(rv[1],rv[0]),v3sub(rv[2],rv[0])));
    const light=v3norm([-.42,.62,.92]);
    const lam=.16+.84*Math.max(0,v3dot(n,light));
    const ps=rv.map(q=>{const d=Math.max(.72,camera.focal-q[2]),k=camera.focal/d;return{x:camera.cx+q[0]*camera.zoom*k,y:camera.cy-q[1]*camera.zoom*k,z:q[2],k};});
    return {depth:ps.reduce((a,p)=>a+p.z,0)/ps.length,points:ps.map(p=>`${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' '),opacity:(opacity*(.26+.74*lam)).toFixed(3),color};
  }
  function buildTesseractV5(spec,width,height,t,context,colors){
    const camera=cameraV5(spec,width,height,t,'quantum_lattice');
    const b=(i)=>byteAt(spec.geometry_seed,i),dir=spec.rotation_direction==="clockwise"?1:-1;
    const a=t*spec.animation_speed;
    const angles={xw:a*.71*dir+(b(8)/255)*1.7,yw:a*.47+(b(9)/255)*1.5,zw:a*.33*dir+(b(10)/255)*1.3,xy:a*.19+(b(11)/255)*.8,yz:a*.27*dir+(b(12)/255)*.9};
    const s=.62; const v4=[];
    for(let mask=0;mask<16;mask++) v4.push([0,1,2,3].map(k=>(mask&(1<<k))?s:-s));
    const world=v4.map(p=>project4Dto3D(rotate4D(p,angles),2.65));
    const pp=world.map(p=>projectCameraPoint(p,camera));
    const edges=[];
    for(let i=0;i<16;i++) for(let axis=0;axis<4;axis++){const j=i^(1<<axis); if(i<j) edges.push([i,j,axis]);}
    const detail=edges.map(([i,j,axis],n)=>{
      const p=pp[i],q=pp[j],depth=(p.z+q.z)/2,near=(p.k+q.k)/2;
      return {depth,svg:`<path class="trace-glyph-v5-hyperedge" d="M${p.x.toFixed(2)} ${p.y.toFixed(2)} L${q.x.toFixed(2)} ${q.y.toFixed(2)}" fill="none" stroke="${colors[axis%colors.length]}" stroke-width="${(.42+near*.23).toFixed(2)}" opacity="${(.18+.38*Math.min(1,near)).toFixed(2)}" vector-effect="non-scaling-stroke"/>`};
    }).sort((a,b)=>a.depth-b.depth).map(x=>x.svg).join('');
    const n=spec.primary_path_count; const primary=[];
    for(let i=0;i<n;i++){
      const e0=edges[(i*3+b(i+13))%edges.length],e1=edges[(i*7+b(i+2))%edges.length];
      const p0=pp[e0[0]],p1=pp[e0[1]],p2=pp[e1[1]];
      primary.push({d:`M${p0.x.toFixed(2)} ${p0.y.toFixed(2)} L${p1.x.toFixed(2)} ${p1.y.toFixed(2)} L${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`,opacity:(.52+.34*((i+1)/n)).toFixed(3)});
    }
    const nodes=pp.map((p,i)=>`<g><circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="${(1.0+1.45*p.k).toFixed(2)}" fill="${colors[i%colors.length]}" opacity=".88"/><circle cx="${(p.x-.38*p.k).toFixed(2)}" cy="${(p.y-.45*p.k).toFixed(2)}" r="${(.22+.35*p.k).toFixed(2)}" fill="#fff" opacity=".92"/></g>`).join('');
    const core=`<circle cx="${width/2}" cy="${height/2}" r="${(Math.min(width,height)*.045).toFixed(2)}" fill="#02050a" stroke="${colors[2]}" stroke-width=".7" opacity=".95"/>`;
    return {surfaces:detail,primary,nodes,detail:core,camera};
  }
  function buildPrismVaultV5(spec,width,height,t,context,colors){
    const camera=cameraV5(spec,width,height,t,'prism_vault'); const b=(i)=>byteAt(spec.geometry_seed,i);
    const sides=5+(b(7)%4),levels=4+(b(8)%3),dir=spec.rotation_direction==="clockwise"?1:-1;
    const rings=[];
    for(let l=0;l<levels;l++){
      const z=-.78+l*(1.56/(levels-1)); const taper=.74-.16*Math.abs(z); const twist=dir*(l/(levels-1)-.5)*(.75+(b(9)/255)*.7)+t*spec.animation_speed*.16;
      const ring=[];
      for(let i=0;i<sides;i++){const a=i/sides*Math.PI*2+twist; ring.push([Math.cos(a)*taper,Math.sin(a)*taper*.72,z]);}
      rings.push(ring);
    }
    const faces=[];
    for(let l=0;l<levels-1;l++) for(let i=0;i<sides;i++){const j=(i+1)%sides;faces.push(shadeFace3D([rings[l][i],rings[l][j],rings[l+1][j],rings[l+1][i]],camera,colors[(i+l)%colors.length],.78));}
    const caps=[rings[0],rings[rings.length-1]]; caps.forEach((ring,k)=>{for(let i=1;i<sides-1;i++)faces.push(shadeFace3D([ring[0],ring[i],ring[i+1]],camera,colors[(i+k+2)%colors.length],.48));});
    faces.sort((a,b)=>a.depth-b.depth);
    const surfaces=faces.map(f=>`<polygon class="trace-glyph-v5-crystal-face" points="${f.points}" fill="${f.color}" fill-opacity="${f.opacity}" stroke="#fff" stroke-opacity=".06" stroke-width=".35"/>`).join('');
    const n=spec.primary_path_count,primary=[];
    for(let p=0;p<n;p++){const i=p%sides; const points=rings.map(r=>projectCameraPoint(r[i],camera)); const d=points.map((q,j)=>(j?'L':'M')+q.x.toFixed(2)+' '+q.y.toFixed(2)).join(' ');primary.push({d,opacity:(.58+.30*(p+1)/n).toFixed(3)});}
    const top=rings[rings.length-1].map(p=>projectCameraPoint(p,camera));
    const nodes=top.map((p,i)=>`<circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="${(1.2+1.1*p.k).toFixed(2)}" fill="${colors[(i+1)%colors.length]}" stroke="#fff" stroke-opacity=".55" stroke-width=".45"/>`).join('');
    const detail=`<path d="${top.map((p,i)=>(i?'L':'M')+p.x.toFixed(2)+' '+p.y.toFixed(2)).join(' ')} Z" fill="none" stroke="#fff" stroke-opacity=".42" stroke-width=".6"/>`;
    return {surfaces,primary,nodes,detail,camera};
  }
  function buildNeuralForgeV5(spec,width,height,t,context,colors){
    const camera=cameraV5(spec,width,height,t,'neural_constellation'),rnd=seedPrng(`${spec.geometry_seed}|forge`),b=(i)=>byteAt(spec.geometry_seed,i);
    const n=spec.primary_path_count; const branches=[]; const allNodes=[[0,0,0]];
    for(let i=0;i<n;i++){
      const pts=[[0,0,0]]; let p=[0,0,0]; const seg=4+(b(i+3)%4); const theta=(i/n)*Math.PI*2+(b(i+10)/255)*.45;
      for(let s=1;s<=seg;s++){const u=s/seg,rad=.16+u*(.64+.14*rnd()),a=theta+.42*Math.sin(u*Math.PI*2+(i%3))+.16*(rnd()-.5);p=[Math.cos(a)*rad,Math.sin(a)*rad*.74,(rnd()-.5)*.55+Math.sin(theta*1.7+u*Math.PI)*.22];pts.push(p);allNodes.push(p);}
      branches.push(pts);
    }
    const projectedBranches=branches.map(br=>br.map(p=>projectCameraPoint(p,camera)));
    const primary=projectedBranches.map((pts,i)=>({d:pts.map((p,j)=>(j?'L':'M')+p.x.toFixed(2)+' '+p.y.toFixed(2)).join(' '),opacity:(.60+.30*((i+1)/n)).toFixed(3)}));
    const edgeParts=[];
    projectedBranches.forEach((pts,i)=>{for(let j=1;j<pts.length;j++){const p=pts[j-1],q=pts[j],depth=(p.z+q.z)/2,near=(p.k+q.k)/2;edgeParts.push({depth,svg:`<path d="M${p.x.toFixed(2)} ${p.y.toFixed(2)} L${q.x.toFixed(2)} ${q.y.toFixed(2)}" stroke="${colors[i%colors.length]}" stroke-width="${(.7+near*.55).toFixed(2)}" stroke-linecap="round" opacity="${(.24+.48*Math.min(1.2,near)).toFixed(2)}"/>`});}});
    edgeParts.sort((a,b)=>a.depth-b.depth); const surfaces=edgeParts.map(e=>e.svg).join('');
    const projectedNodes=allNodes.map((p,i)=>({...projectCameraPoint(p,camera),i})).sort((a,b)=>a.z-b.z);
    const nodes=projectedNodes.map((p,k)=>{const pulse=.92+.08*Math.sin(t*spec.animation_speed*2.2+k*.7);const r=(.8+2.0*p.k)*pulse;return `<g class="trace-glyph-v5-neuron"><circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="${(r*2.2).toFixed(2)}" fill="${colors[k%colors.length]}" opacity=".08"/><circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="${r.toFixed(2)}" fill="${colors[k%colors.length]}" opacity=".88"/><circle cx="${(p.x-.35*p.k).toFixed(2)}" cy="${(p.y-.45*p.k).toFixed(2)}" r="${(.2+.32*p.k).toFixed(2)}" fill="#fff" opacity=".9"/></g>`}).join('');
    const hub=projectCameraPoint([0,0,0],camera); const detail=`<circle cx="${hub.x.toFixed(2)}" cy="${hub.y.toFixed(2)}" r="${(Math.min(width,height)*.055).toFixed(2)}" fill="#02060b" stroke="${colors[1]}" stroke-width="1.1"/><circle cx="${hub.x.toFixed(2)}" cy="${hub.y.toFixed(2)}" r="${(Math.min(width,height)*.085).toFixed(2)}" fill="none" stroke="${colors[3]}" stroke-opacity=".25" stroke-dasharray="1.5 2.8"/>`;
    return {surfaces,primary,nodes,detail,camera};
  }
  // V5 Spatial upgrade for the six original TRACE families. These are not
  // flattened 2D paths: each family is generated in XYZ, camera-rotated,
  // perspective-projected and depth-shaded. The family grammar stays distinct.
  function legacySpatialWorldPathV5(spec,index,t){
    const rnd=seedPrng(`${spec.geometry_seed}|legacy-spatial-v5|${spec.style}|${index}`);
    const n=28, pts=[], u0=(index/spec.primary_path_count)*Math.PI*2;
    const spread=(index-(spec.primary_path_count-1)/2)/Math.max(1,spec.primary_path_count-1);
    const dir=spec.rotation_direction==='clockwise'?1:-1;
    const time=t*spec.animation_speed*dir;
    if(spec.style==='spiro_flow'){
      // A spatial hypotrochoid ribbon: familiar Spiro DNA, now weaving in Z.
      const R=.78, r=.19+.07*rnd(), d=.31+.11*rnd(), k=(R-r)/r;
      for(let j=0;j<=n;j++){const u=j/n*Math.PI*2*(3.2+spec.symmetry*.45);
        const x=((R-r)*Math.cos(u+time*.22)+d*Math.cos(k*u+u0-time*.31))*.70;
        const y=((R-r)*Math.sin(u+time*.22)-d*Math.sin(k*u+u0-time*.31))*.70;
        const z=.34*Math.sin(u*1.35+u0+time*.55)+spread*.20;
        pts.push([x,y,z]);}
    } else if(spec.style==='hash_shards'){
      // Angular crystalline shards crossing a deep central volume.
      const corners=7+(index%5), phase=u0+time*.18;
      for(let j=0;j<=corners;j++){const u=j/corners, a=phase+(u-.5)*(1.15+.45*rnd());
        const pulse=(j%2? .78:.30)+.10*Math.sin(j*2.7+u0);
        const z=(u-.5)*1.15 + .22*Math.sin(j*1.9+u0+time*.4);
        pts.push([Math.cos(a)*pulse,Math.sin(a)*pulse*.82,z]);}
    } else if(spec.style==='helix_clean'){
      // Clean vertical helix columns with actual front/back crossover.
      const turns=2.3+spec.symmetry*.22, phase=u0+time*.34;
      for(let j=0;j<=n;j++){const u=j/n, a=u*turns*Math.PI*2+phase;
        pts.push([Math.sin(a)*(.42+.04*spread), (u-.5)*1.48, Math.cos(a)*(.42+.04*spread)+spread*.13]);}
    } else if(spec.style==='dna_braid'){
      // Braided spatial cable; alternating strands occupy opposing phases.
      const turns=2.0+spec.symmetry*.18, phase=(index%2)*Math.PI+u0*.18+time*.30;
      for(let j=0;j<=n;j++){const u=j/n,a=u*turns*Math.PI*2+phase;
        const axis=.12*Math.sin(u*Math.PI*2+u0);
        pts.push([Math.sin(a)*.46+axis,(u-.5)*1.42,Math.cos(a)*.46+spread*.10]);}
    } else if(spec.style==='orbit_ring'){
      // Independent orbital planes around a luminous proof core.
      const tilt=.28+(index/spec.primary_path_count)*1.05, phase=u0+time*.24;
      for(let j=0;j<=n;j++){const u=j/n*Math.PI*2, rr=.48+.28*(index+1)/spec.primary_path_count;
        let q=[Math.cos(u+phase)*rr,Math.sin(u+phase)*rr,0];
        q=rotate3D(q,tilt*.72,tilt,phase*.16); pts.push(q);}
    } else {
      // Minimal Pulse: intentionally restrained, volumetric breathing lemniscates.
      const phase=u0*.24+time*.22, scale=.54+.08*Math.sin(time*.7+index);
      for(let j=0;j<=n;j++){const u=j/n*Math.PI*2,den=1+Math.sin(u)*Math.sin(u);
        const x=scale*Math.cos(u)/den, y=scale*.72*Math.sin(u)*Math.cos(u)/den;
        const z=.18*Math.sin(u*2+phase)+spread*.10; pts.push(rotate3D([x,y,z],.34,phase,.08));}
    }
    return pts;
  }
  function buildLegacySpatialV5(spec,width,height,t,context,colors){
    const camera=cameraV5(spec,width,height,t,spec.style);
    // Give old families a wider, calmer camera so their silhouettes remain legible.
    camera.zoom*=spec.style==='minimal_pulse'?.88:(spec.style==='orbit_ring'?.92:.86);
    const paths=[],faces=[];
    const radius={fine:.0105,balanced:.014,bold:.018}[spec.stroke_profile]*(1+spec.density*.16);
    for(let i=0;i<spec.primary_path_count;i++){
      const world=legacySpatialWorldPathV5(spec,i,t), projected=world.map(q=>projectCameraPoint(q,camera));
      paths.push(projected);
      faces.push(...tubeFacesForPath(world,camera,radius,colors[i%colors.length],i));
    }
    faces.sort((a,b)=>a.depth-b.depth);
    const surfaces=faces.map(f=>`<polygon class="trace-glyph-v5-face" points="${f.points}" fill="${f.color}" fill-opacity="${Math.min(.82,Number(f.opacity)+.08).toFixed(3)}" stroke="none"/>`).join('');
    const primary=paths.map((pts,i)=>({
      d:pts.map((q,j)=>(j?'L':'M')+q.x.toFixed(2)+' '+q.y.toFixed(2)).join(' '),
      opacity:(.42+.42*(i+1)/spec.primary_path_count).toFixed(3)
    }));
    const c=projectCameraPoint([0,0,0],camera), min=Math.min(width,height);
    let detail='';
    if(spec.style==='orbit_ring') detail=`<circle cx="${c.x.toFixed(2)}" cy="${c.y.toFixed(2)}" r="${(min*.045).toFixed(2)}" fill="${colors[2]}" opacity=".72"/><circle cx="${c.x.toFixed(2)}" cy="${c.y.toFixed(2)}" r="${(min*.075).toFixed(2)}" fill="none" stroke="${colors[1]}" stroke-opacity=".28" stroke-width=".6"/>`;
    else if(spec.style==='minimal_pulse') detail=`<circle cx="${c.x.toFixed(2)}" cy="${c.y.toFixed(2)}" r="${(min*.025).toFixed(2)}" fill="#fff" opacity=".72"/>`;
    else detail=`<circle cx="${c.x.toFixed(2)}" cy="${c.y.toFixed(2)}" r="${(min*.034).toFixed(2)}" fill="#02050a" stroke="${colors[2]}" stroke-width=".55" opacity=".9"/>`;
    return {surfaces,primary,nodes:'',detail,camera};
  }
  function buildSpatialV5Scene(spec,width,height,t,context,colors){
    if(spec.style==="quantum_lattice")return buildTesseractV5(spec,width,height,t,context,colors);
    if(spec.style==="prism_vault")return buildPrismVaultV5(spec,width,height,t,context,colors);
    if(spec.style==="neural_constellation")return buildNeuralForgeV5(spec,width,height,t,context,colors);
    return buildLegacySpatialV5(spec,width,height,t,context,colors);
  }

  // --- Renderer V6: visibly volumetric spatial renderer ---
  // Every current family is built in XYZ (Tesseract starts in XYZW), then camera-
  // projected. V6 renders faceted tube/solid surfaces with depth-dependent shading,
  // so front/back relationships remain visually obvious even at badge size.
  function cameraV6(spec,width,height,t,style){
    const b=(i)=>byteAt(spec.geometry_seed,i),dir=spec.rotation_direction==="clockwise"?1:-1;
    const speed=spec.animation_speed;
    const familyZoom={minimal_pulse:.40,orbit_ring:.45,helix_clean:.43,dna_braid:.43,spiro_flow:.44,hash_shards:.46,quantum_lattice:.44,prism_vault:.47,neural_constellation:.45}[style]||.44;
    return {
      ax:.58+(b(2)/255)*.32+Math.sin(t*speed*.31)*.16,
      ay:-.72+(b(3)/255)*1.44+dir*t*speed*.28,
      az:-.22+(b(4)/255)*.44+Math.sin(t*speed*.23)*.11,
      focal:2.72+(b(5)/255)*.42,
      zoom:Math.min(width,height)*(familyZoom+(b(6)/255)*.035),
      cx:width/2,cy:height/2
    };
  }
  function tubeFacesV6(worldPoints,camera,radius,color,pathIndex){
    const faces=[], sides=6, light=v3norm([-.45,.68,1.0]);
    for(let i=0;i<worldPoints.length-1;i++){
      const p0=rotate3D(worldPoints[i],camera.ax,camera.ay,camera.az);
      const p1=rotate3D(worldPoints[i+1],camera.ax,camera.ay,camera.az);
      const tangent=v3norm(v3sub(p1,p0));
      let n=v3cross(tangent,[0,0,1]); if(v3len(n)<.08)n=v3cross(tangent,[0,1,0]); n=v3norm(n);
      const bn=v3norm(v3cross(tangent,n));
      const rings=[p0,p1].map(p=>Array.from({length:sides},(_,j)=>{const a=j/sides*Math.PI*2;return v3add(p,v3add(v3mul(n,Math.cos(a)*radius),v3mul(bn,Math.sin(a)*radius)));}));
      for(let j=0;j<sides;j++){
        const j2=(j+1)%sides, verts=[rings[0][j],rings[0][j2],rings[1][j2],rings[1][j]];
        const normal=v3norm(v3cross(v3sub(verts[1],verts[0]),v3sub(verts[3],verts[0])));
        const nd=Math.max(-1,Math.min(1,v3dot(normal,light)));
        const lam=.10+.90*Math.max(0,nd);
        const projected=verts.map(q=>{const denom=Math.max(.54,camera.focal-q[2]),k=camera.focal/denom;return{x:camera.cx+q[0]*camera.zoom*k,y:camera.cy-q[1]*camera.zoom*k,z:q[2],k};});
        const depth=projected.reduce((a,v)=>a+v.z,0)/4;
        const near=projected.reduce((a,v)=>a+v.k,0)/4;
        const brightness=(.34+lam*.92)*Math.min(1.26,.72+near*.34);
        faces.push({depth,points:projected.map(v=>`${v.x.toFixed(2)},${v.y.toFixed(2)}`).join(' '),color,pathIndex,brightness:brightness.toFixed(3),opacity:(.76+.18*Math.min(1,near)).toFixed(3)});
      }
    }
    return faces;
  }
  function v6WorldPaths(spec,t){
    const paths=[];
    if(spec.style==='quantum_lattice'){
      const b=(i)=>byteAt(spec.geometry_seed,i),dir=spec.rotation_direction==='clockwise'?1:-1,a=t*spec.animation_speed;
      const angles={xw:a*.73*dir+(b(8)/255)*1.7,yw:a*.49+(b(9)/255)*1.5,zw:a*.37*dir+(b(10)/255)*1.3,xy:a*.23+(b(11)/255)*.8,yz:a*.29*dir+(b(12)/255)*.9};
      const s=.66,v4=[];for(let mask=0;mask<16;mask++)v4.push([0,1,2,3].map(k=>(mask&(1<<k))?s:-s));
      const world=v4.map(q=>project4Dto3D(rotate4D(q,angles),2.55));
      const edges=[];for(let i=0;i<16;i++)for(let axis=0;axis<4;axis++){const j=i^(1<<axis);if(i<j)edges.push([i,j]);}
      return {paths:edges.map(e=>[world[e[0]],world[e[1]]]), all:true};
    }
    if(spec.style==='neural_constellation'){
      const rnd=seedPrng(`${spec.geometry_seed}|v6-neural`),b=(i)=>byteAt(spec.geometry_seed,i);
      for(let i=0;i<spec.primary_path_count;i++){const pts=[[0,0,0]];const seg=5+(b(i+3)%4),theta=i/spec.primary_path_count*Math.PI*2+(b(i+10)/255)*.4;
        for(let k=1;k<=seg;k++){const u=k/seg,rad=.13+u*(.70+.11*rnd()),aa=theta+.45*Math.sin(u*Math.PI*2+i*.7)+.13*(rnd()-.5);pts.push([Math.cos(aa)*rad,Math.sin(aa)*rad*.78,(rnd()-.5)*.68+Math.sin(theta*1.7+u*Math.PI)*.30]);}
        paths.push(pts);}
      return {paths};
    }
    if(spec.style==='prism_vault'){
      const b=(i)=>byteAt(spec.geometry_seed,i),sides=5+(b(7)%4),levels=5+(b(8)%3),dir=spec.rotation_direction==='clockwise'?1:-1;
      const rings=[];for(let l=0;l<levels;l++){const z=-.84+l*(1.68/(levels-1)),taper=.78-.14*Math.abs(z),tw=dir*(l/(levels-1)-.5)*(1.0+(b(9)/255)*.8)+t*spec.animation_speed*.18;const ring=[];for(let i=0;i<sides;i++){const aa=i/sides*Math.PI*2+tw;ring.push([Math.cos(aa)*taper,Math.sin(aa)*taper*.72,z]);}rings.push(ring);}
      for(let i=0;i<sides;i++)paths.push(rings.map(r=>r[i]));
      for(let l=0;l<levels;l++)paths.push([...rings[l],rings[l][0]]);
      return {paths};
    }
    for(let i=0;i<spec.primary_path_count;i++)paths.push(legacySpatialWorldPathV5(spec,i,t));
    return {paths};
  }
  function buildSpatialV6Scene(spec,width,height,t,context,colors){
    const camera=cameraV6(spec,width,height,t,spec.style), data=v6WorldPaths(spec,t), faces=[];
    const baseRadius={fine:.020,balanced:.026,bold:.034}[spec.stroke_profile]*(.92+spec.density*.20);
    data.paths.forEach((world,i)=>faces.push(...tubeFacesV6(world,camera,baseRadius*(spec.style==='minimal_pulse'?.88:1),colors[i%colors.length],i)));
    faces.sort((a,b)=>a.depth-b.depth);
    const surfaces=faces.map(f=>`<polygon class="trace-glyph-v6-face" data-path-index="${f.pathIndex}" points="${f.points}" fill="${f.color}" fill-opacity="${f.opacity}" style="filter:brightness(${f.brightness}) saturate(1.08)" stroke="#000" stroke-opacity=".08" stroke-width=".18"/>`).join('');
    const basePaths=data.paths.slice(0,spec.primary_path_count);
    while(basePaths.length<spec.primary_path_count)basePaths.push(data.paths[basePaths.length%data.paths.length]);
    const primary=basePaths.map((world,i)=>{const pts=world.map(q=>projectCameraPoint(q,camera));return{d:pts.map((q,j)=>(j?'L':'M')+q.x.toFixed(2)+' '+q.y.toFixed(2)).join(' '),opacity:(.20+.20*(i+1)/spec.primary_path_count).toFixed(3)};});
    const c=projectCameraPoint([0,0,0],camera),min=Math.min(width,height);
    const detail=`<ellipse cx="${c.x.toFixed(2)}" cy="${c.y.toFixed(2)}" rx="${(min*.055).toFixed(2)}" ry="${(min*.041).toFixed(2)}" fill="#02050a" stroke="${colors[2]}" stroke-width=".7"/><circle cx="${(c.x-min*.012).toFixed(2)}" cy="${(c.y-min*.015).toFixed(2)}" r="${(min*.010).toFixed(2)}" fill="#fff" opacity=".72"/>`;
    let nodes='';
    if(spec.style==='neural_constellation')nodes=data.paths.flatMap((p,i)=>p.slice(1).map((q,j)=>{const z=projectCameraPoint(q,camera),r=(1.1+1.7*z.k);return `<g><circle cx="${z.x.toFixed(2)}" cy="${z.y.toFixed(2)}" r="${(r*1.75).toFixed(2)}" fill="${colors[(i+j)%colors.length]}" opacity=".11"/><circle cx="${z.x.toFixed(2)}" cy="${z.y.toFixed(2)}" r="${r.toFixed(2)}" fill="${colors[(i+j)%colors.length]}" opacity=".92"/><circle cx="${(z.x-.4*z.k).toFixed(2)}" cy="${(z.y-.5*z.k).toFixed(2)}" r="${(.25+.3*z.k).toFixed(2)}" fill="#fff" opacity=".92"/></g>`})).join('');
    return {surfaces,primary,nodes,detail,camera};
  }


// --- Renderer V7: premium spatial / lower-jank material system ---
// Geometry identity remains proof-derived. V7 intentionally uses fewer tube
// sides at interactive quality levels, thinner engineered surfaces, restrained
// materials and cached topology-friendly rendering.
function tubeFacesV7(worldPoints,camera,radius,color,pathIndex,quality){
  const faces=[];
  const sides=quality==="high"?5:quality==="medium"?4:3;
  const light=v3norm([-.38,.72,1]);
  for(let i=0;i<worldPoints.length-1;i++){
    const p0=rotate3D(worldPoints[i],camera.ax,camera.ay,camera.az),p1=rotate3D(worldPoints[i+1],camera.ax,camera.ay,camera.az);
    const tangent=v3norm(v3sub(p1,p0));let n=v3cross(tangent,[0,0,1]);if(v3len(n)<.08)n=v3cross(tangent,[0,1,0]);n=v3norm(n);const bn=v3norm(v3cross(tangent,n));
    const rings=[p0,p1].map(p=>Array.from({length:sides},(_,j)=>{const a=j/sides*Math.PI*2;return v3add(p,v3add(v3mul(n,Math.cos(a)*radius),v3mul(bn,Math.sin(a)*radius)));}));
    for(let j=0;j<sides;j++){
      const j2=(j+1)%sides,verts=[rings[0][j],rings[0][j2],rings[1][j2],rings[1][j]];
      const normal=v3norm(v3cross(v3sub(verts[1],verts[0]),v3sub(verts[3],verts[0]))),nd=Math.max(-1,Math.min(1,v3dot(normal,light))),lam=.16+.84*Math.max(0,nd);
      const projected=verts.map(q=>{const denom=Math.max(.54,camera.focal-q[2]),k=camera.focal/denom;return{x:camera.cx+q[0]*camera.zoom*k,y:camera.cy-q[1]*camera.zoom*k,z:q[2],k};});
      const depth=projected.reduce((a,v)=>a+v.z,0)/4,near=projected.reduce((a,v)=>a+v.k,0)/4;
      faces.push({depth,points:projected.map(v=>`${v.x.toFixed(2)},${v.y.toFixed(2)}`).join(" "),color,pathIndex,brightness:(.48+lam*.58)*Math.min(1.15,.80+near*.22),opacity:.48+.26*Math.min(1,near)});
    }
  }
  return faces;
}
function buildSpatialV7Scene(spec,width,height,t,context,colors){
  const quality=qualityForContext(context),camera=cameraV6(spec,width,height,t,spec.style),data=v6WorldPaths(spec,t),faces=[];
  camera.zoom*=spec.style==="minimal_pulse"?.92:.96;
  const baseRadius={fine:.010,balanced:.014,bold:.018}[spec.stroke_profile]*(.88+spec.density*.10);
  const stride=quality==="high"?1:(quality==="medium"?2:3);
  data.paths.forEach((world,i)=>{
    // Interactive V7 keeps the same topology but decimates intermediate tube
    // samples. High-resolution/export rendering still uses every sample.
    const reduced=stride===1?world:world.filter((_,idx)=>idx===0||idx===world.length-1||idx%stride===0);
    faces.push(...tubeFacesV7(reduced,camera,baseRadius*(spec.style==="minimal_pulse"?.78:1),colors[i%colors.length],i,quality));
  });
  faces.sort((a,b)=>a.depth-b.depth);
  // Per-polygon CSS filters are extremely expensive when a large SVG group is
  // moving. Bake the lighting cue into opacity and keep every face paint-simple.
  const surfaces=faces.map(f=>{const lit=Math.max(.34,Math.min(1.16,Number(f.brightness)||1));const op=Math.min(.90,f.opacity*(.70+lit*.27));return `<polygon class="trace-glyph-v7-face" data-path-index="${f.pathIndex}" points="${f.points}" fill="${f.color}" fill-opacity="${op.toFixed(3)}" stroke="#dff8ff" stroke-opacity=".045" stroke-width=".10"/>`;}).join("");
  const basePaths=data.paths.slice(0,spec.primary_path_count);while(basePaths.length<spec.primary_path_count)basePaths.push(data.paths[basePaths.length%Math.max(1,data.paths.length)]||[]);
  const primary=basePaths.map((world,i)=>{const pts=world.map(q=>projectCameraPoint(q,camera));return{d:pts.map((q,j)=>(j?"L":"M")+q.x.toFixed(2)+" "+q.y.toFixed(2)).join(" "),opacity:(.34+.36*(i+1)/spec.primary_path_count).toFixed(3)};});
  const min=Math.min(width,height),c=projectCameraPoint([0,0,0],camera);
  let detail=`<circle cx="${c.x.toFixed(2)}" cy="${c.y.toFixed(2)}" r="${(min*.019).toFixed(2)}" fill="#f4fdff" opacity=".72"/><circle cx="${c.x.toFixed(2)}" cy="${c.y.toFixed(2)}" r="${(min*.055).toFixed(2)}" fill="none" stroke="${colors[0]}" stroke-width=".34" stroke-opacity=".24"/>`;
  let nodes=""; if(quality!=="low"&&quality!=="static"){const n=4+(byteAt(spec.geometry_seed,19)%5);for(let i=0;i<n;i++){const a=i/n*Math.PI*2+(byteAt(spec.geometry_seed,i+4)/255),r=min*(.18+.15*((byteAt(spec.geometry_seed,i+12))/255));nodes+=`<circle cx="${(width/2+Math.cos(a)*r).toFixed(2)}" cy="${(height/2+Math.sin(a)*r*.72).toFixed(2)}" r="${(quality==="high"?1.05:.75).toFixed(2)}" fill="${colors[(i+1)%colors.length]}" opacity=".46"/>`;}}
  return {surfaces,primary,detail,nodes,camera,quality};
}

  function traceProjectedPoseMetrics(spec,t,width=640,height=640){
    if(spec.renderer_version!==RENDERER_V7 && spec.renderer_version!==RENDERER_V6 && spec.renderer_version!==RENDERER_V5) return null;
    try{
      const data=(spec.renderer_version===RENDERER_V7||spec.renderer_version===RENDERER_V6) ? v6WorldPaths(spec,t) : {paths:Array.from({length:spec.primary_path_count},(_,i)=>legacySpatialWorldPathV5(spec,i,t))};
      const camera=(spec.renderer_version===RENDERER_V7||spec.renderer_version===RENDERER_V6) ? cameraV6(spec,width,height,t,spec.style) : cameraV5(spec,width,height,t,spec.style);
      const pts=[];
      for(const path of (data.paths||[])) for(const q of path) pts.push(projectCameraPoint(q,camera));
      if(!pts.length) return null;
      let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity,minZ=Infinity,maxZ=-Infinity;
      const grid=new Uint16Array(14*14);
      let clipped=0;
      for(const q of pts){
        minX=Math.min(minX,q.x);maxX=Math.max(maxX,q.x);minY=Math.min(minY,q.y);maxY=Math.max(maxY,q.y);minZ=Math.min(minZ,q.z);maxZ=Math.max(maxZ,q.z);
        if(q.x<8||q.x>width-8||q.y<8||q.y>height-8) clipped++;
        const gx=Math.max(0,Math.min(13,Math.floor((q.x/width)*14))),gy=Math.max(0,Math.min(13,Math.floor((q.y/height)*14)));
        grid[gy*14+gx]++;
      }
      const bboxArea=Math.max(0,Math.min(1,((maxX-minX)*(maxY-minY))/(width*height)));
      const depth=Math.max(0,Math.min(2.5,maxZ-minZ))/2.5;
      const occupied=Array.from(grid).filter(Boolean).length/(14*14);
      const crowd=Array.from(grid).reduce((a,n)=>a+Math.max(0,n-4),0)/Math.max(1,pts.length);
      const clipPenalty=clipped/pts.length;
      const centerX=(minX+maxX)/2/width, centerY=(minY+maxY)/2/height;
      const centerPenalty=Math.min(.35,Math.hypot(centerX-.5,centerY-.5));
      const score=bboxArea*.42+depth*.24+occupied*.34-crowd*.13-clipPenalty*.9-centerPenalty*.25;
      return {score,bboxArea,depth,occupied,clipPenalty};
    }catch{return null;}
  }

  function selectGlyphHeroPose(candidate,context={}){
    const spec=normalizeGlyphSpecification(candidate);
    if(!spec) return Object.freeze({time:0,score:0,samples:0});
    if(spec.renderer_version!==RENDERER_V7 && spec.renderer_version!==RENDERER_V6 && spec.renderer_version!==RENDERER_V5){
      return Object.freeze({time:0,score:0,samples:1,renderer_version:spec.renderer_version});
    }
    const samples=Math.max(12,Math.min(24,Math.round(Number(context.samples)||18)));
    const width=Math.max(240,Math.round(Number(context.width)||640));
    const height=Math.max(240,Math.round(Number(context.height)||640));
    const phaseSeed=(byteAt(spec.geometry_seed,28)/255)*1.75;
    let best={time:0,score:-Infinity};
    // Sample a deterministic span long enough for the spatial camera and object motion.
    const span=12.0;
    for(let i=0;i<samples;i++){
      const time=phaseSeed+(i/samples)*span;
      const m=traceProjectedPoseMetrics(spec,time,width,height);
      if(m && m.score>best.score) best={time,score:m.score,metrics:m};
    }
    return Object.freeze({time:round(best.time,4),score:round(best.score,5),samples,renderer_version:spec.renderer_version});
  }

  function renderGlyphFromSpecification(candidate,context={}){
    const spec=normalizeGlyphSpecification(candidate);
    if(!spec) return "";
    const v2=spec.renderer_version===RENDERER_V2;
    const v3=spec.renderer_version===RENDERER_V3;
    const v4=spec.renderer_version===RENDERER_V4;
    const v5=spec.renderer_version===RENDERER_V5;
    const v6=spec.renderer_version===RENDERER_V6;
    const v7=spec.renderer_version===RENDERER_V7;
    const advanced=v2||v3||v4||v5||v6||v7;
    const mode=clean(context.mode||"badge");
    const renderTime=Number.isFinite(Number(context.time))?Number(context.time):0;
    const transparent=!!context.transparent;
    const width=Math.max(48,Math.round(Number(context.width)||(mode==="avatar"?96:mode==="public"?180:142)));
    const height=Math.max(48,Math.round(Number(context.height)||(mode==="avatar"?96:mode==="public"?180:92)));
    const colors=v7?premiumPalette(spec):palette(spec);
    const uid=`tg_${spec.geometry_seed.slice(0,10)}_${mode}`.replace(/[^a-z0-9_-]/gi,"");
    const strokeBase={fine:0.72,balanced:0.94,bold:1.18}[spec.stroke_profile];
    const stroke=v7?strokeBase*.34:(v6?strokeBase*.44:(v5?strokeBase*.72:(v3?strokeBase*0.82:(v2?strokeBase*0.92:strokeBase))));
    const specEncoded=encodeURIComponent(JSON.stringify(spec));
    let svg=`<svg class="glyph3d trace-glyph-v1${v2?" trace-glyph-renderer-v2":v3?" trace-glyph-renderer-v3":v4?" trace-glyph-renderer-v4":v5?" trace-glyph-renderer-v5":v6?" trace-glyph-renderer-v6":v7?" trace-glyph-renderer-v7":""}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Deterministic TRACE proof glyph" preserveAspectRatio="xMidYMid meet" data-glyph-spec-version="${VERSION}" data-glyph-renderer-version="${spec.renderer_version}" data-glyph-spec="${specEncoded}" data-motion-model="${spec.motion}" data-rendered-primary-count="${spec.primary_path_count}" data-rendered-layer-count="${spec.layer_count}">`;
    svg+=`<defs>
      <radialGradient id="${uid}_core" cx="50%" cy="50%" r="72%"><stop offset="0" stop-color="${colors[2]}" stop-opacity="${advanced?".22":".18"}"/><stop offset=".52" stop-color="${colors[0]}" stop-opacity="${advanced?".08":".06"}"/><stop offset="1" stop-color="#000" stop-opacity="1"/></radialGradient>
      <linearGradient id="${uid}_line" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${colors[0]}"/><stop offset=".34" stop-color="${colors[1]}"/><stop offset=".68" stop-color="${colors[2]}"/><stop offset="1" stop-color="${colors[3]}"/></linearGradient>
      ${advanced?`<linearGradient id="${uid}_line2" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${colors[3]}"/><stop offset=".34" stop-color="${colors[2]}"/><stop offset=".68" stop-color="${colors[1]}"/><stop offset="1" stop-color="${colors[0]}"/></linearGradient>
      <filter id="${uid}_softGlow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation=".55" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      ${v3?`<radialGradient id="${uid}_depth" cx="38%" cy="30%" r="72%"><stop offset="0" stop-color="#fff" stop-opacity=".24"/><stop offset=".22" stop-color="${colors[1]}" stop-opacity=".10"/><stop offset=".66" stop-color="${colors[3]}" stop-opacity=".035"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient><filter id="${uid}_depthGlow" x="-45%" y="-45%" width="190%" height="190%"><feGaussianBlur in="SourceGraphic" stdDeviation="1.05" result="blur"/><feColorMatrix in="blur" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 .68 0" result="soft"/><feMerge><feMergeNode in="soft"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`:""}`:""}
    </defs>`;
    if(!transparent) svg+=`<rect width="${width}" height="${height}" fill="#000"/><rect width="${width}" height="${height}" fill="url(#${uid}_core)"/>`;
    if(v3 && ["quantum_lattice","prism_vault","neural_constellation"].includes(spec.style)){
      svg+=`<ellipse cx="${width*.46}" cy="${height*.43}" rx="${Math.min(width,height)*.39}" ry="${Math.min(width,height)*.31}" fill="url(#${uid}_depth)" opacity=".58"/>`;
    }

    if(v7) {
      // V7.1 PERFORMANCE ARCHITECTURE:
      // Build the expensive XYZ -> projected SVG geometry exactly once. Runtime
      // motion is compositor-driven on stable layer groups; no polygon/string
      // reconstruction happens on animation frames. This keeps the visual identity
      // deterministic while protecting typing, scrolling and touch interaction.
      const scene=buildSpatialV7Scene(spec,width,height,renderTime,context,colors);
      const motionClass=`trace-v7-motion-${String(spec.motion||"convergent_flow").replace(/[^a-z0-9_-]/gi,"-")}`;
      const dir=spec.rotation_direction==="counterclockwise"?"reverse":"normal";
      const duration=(11.5 + (1-Math.max(.12,Math.min(1,spec.animation_speed)))*8.5 + (byteAt(spec.geometry_seed,27)/255)*3.5).toFixed(2);
      svg=svg.replace('<svg class="glyph3d ',`<svg style="--trace-v7-duration:${duration}s;--trace-v7-direction:${dir}" class="glyph3d ${motionClass} `);
      svg+=`<style>
        .trace-glyph-renderer-v7 .trace-glyph-v7-rig,.trace-glyph-renderer-v7 .trace-glyph-v7-surface,.trace-glyph-renderer-v7 .trace-glyph-v7-primary,.trace-glyph-renderer-v7 .trace-glyph-halo-layer,.trace-glyph-renderer-v7 .trace-glyph-detail-layer,.trace-glyph-renderer-v7 .trace-glyph-node-layer{transform-box:fill-box;transform-origin:center;will-change:transform,opacity}
        .trace-glyph-renderer-v7.trace-glyph-v7-compositor .trace-glyph-v7-rig{animation:traceV7Rig var(--trace-v7-duration) linear infinite;animation-direction:var(--trace-v7-direction)}
        .trace-glyph-renderer-v7.trace-glyph-v7-compositor .trace-glyph-v7-primary{animation:traceV7Primary calc(var(--trace-v7-duration)*1.37) linear infinite;animation-direction:reverse}
        .trace-glyph-renderer-v7.trace-glyph-v7-compositor .trace-glyph-detail-layer{animation:traceV7Detail calc(var(--trace-v7-duration)*.54) ease-in-out infinite}
        .trace-glyph-renderer-v7.trace-glyph-v7-compositor .trace-glyph-node-layer{animation:traceV7Nodes calc(var(--trace-v7-duration)*1.73) linear infinite;animation-direction:var(--trace-v7-direction)}
        .trace-glyph-renderer-v7.trace-v7-motion-braided_rotation.trace-glyph-v7-compositor .trace-glyph-v7-primary{animation-duration:calc(var(--trace-v7-duration)*.82)}
        .trace-glyph-renderer-v7.trace-v7-motion-divergent_orbit.trace-glyph-v7-compositor .trace-glyph-v7-rig{animation-name:traceV7Orbit}
        .trace-glyph-renderer-v7.trace-v7-motion-convergent_flow.trace-glyph-v7-compositor .trace-glyph-v7-rig{animation-name:traceV7Converge}
        .trace-glyph-renderer-v7.trace-reward-paused .trace-glyph-v7-rig,.trace-glyph-renderer-v7.trace-reward-paused .trace-glyph-v7-primary,.trace-glyph-renderer-v7.trace-reward-paused .trace-glyph-detail-layer,.trace-glyph-renderer-v7.trace-reward-paused .trace-glyph-node-layer{animation-play-state:paused!important}
        @keyframes traceV7Rig{0%{transform:rotate(0deg) scale(1)}25%{transform:rotate(90deg) scale(1.018) translate(.35px,-.25px)}50%{transform:rotate(180deg) scale(.995)}75%{transform:rotate(270deg) scale(1.014) translate(-.3px,.2px)}100%{transform:rotate(360deg) scale(1)}}
        @keyframes traceV7Primary{0%{transform:rotate(0deg) scale(1)}50%{transform:rotate(-180deg) scale(1.012)}100%{transform:rotate(-360deg) scale(1)}}
        @keyframes traceV7Detail{0%,100%{transform:scale(.985);opacity:.72}50%{transform:scale(1.035);opacity:1}}
        @keyframes traceV7Nodes{0%{transform:rotate(0deg) translate(0,0)}50%{transform:rotate(180deg) translate(.5px,-.35px)}100%{transform:rotate(360deg) translate(0,0)}}
        @keyframes traceV7Orbit{0%{transform:rotate(0deg) scale(1) translate(0,0)}25%{transform:rotate(90deg) scale(1.01) translate(.65px,-.35px)}50%{transform:rotate(180deg) scale(.995) translate(0,.55px)}75%{transform:rotate(270deg) scale(1.012) translate(-.55px,-.25px)}100%{transform:rotate(360deg) scale(1) translate(0,0)}}
        @keyframes traceV7Converge{0%,100%{transform:rotate(0deg) scale(1)}25%{transform:rotate(90deg) scale(.975)}50%{transform:rotate(180deg) scale(1.025)}75%{transform:rotate(270deg) scale(.982)}100%{transform:rotate(360deg) scale(1)}}
        @media(prefers-reduced-motion:reduce){.trace-glyph-renderer-v7 .trace-glyph-v7-rig,.trace-glyph-renderer-v7 .trace-glyph-v7-primary,.trace-glyph-renderer-v7 .trace-glyph-detail-layer,.trace-glyph-renderer-v7 .trace-glyph-node-layer{animation:none!important}}
      </style>`;
      svg+=`<g class="trace-glyph-v7-rig"><g class="trace-glyph-v7-surface" data-spatial-render="premium-xyz">${scene.surfaces}</g>`;
      svg+=`<g data-glyph-layer="primary" class="trace-glyph-layer trace-glyph-primary-layer trace-glyph-v7-primary" data-active-motion="${spec.motion}">`;
      scene.primary.forEach((item,i)=>{svg+=`<path class="trace-glyph-primary strand" data-path-index="${i}" d="${item.d}" fill="none" stroke="${colors[i%colors.length]}" stroke-width="${(stroke*.48).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round" opacity="${item.opacity}" vector-effect="non-scaling-stroke"/>`;});
      svg+=`</g>`;
      if(spec.layer_count>=2) svg+=`<g data-glyph-layer="halo" class="trace-glyph-layer trace-glyph-halo-layer"><ellipse cx="${width/2}" cy="${height/2}" rx="${(Math.min(width,height)*.39).toFixed(2)}" ry="${(Math.min(width,height)*.29).toFixed(2)}" fill="none" stroke="${colors[0]}" stroke-width="${(stroke*.08).toFixed(2)}" opacity=".045" stroke-dasharray=".7 6.2"/></g>`;
      if(spec.layer_count>=3) svg+=`<g data-glyph-layer="detail" class="trace-glyph-layer trace-glyph-detail-layer">${scene.detail||""}</g>`; else if(scene.detail) svg+=`<g class="trace-glyph-v7-floating-detail">${scene.detail}</g>`;
      if(spec.layer_count>=4) svg+=`<g data-glyph-layer="nodes" class="trace-glyph-layer trace-glyph-node-layer">${scene.nodes||""}</g>`; else if(scene.nodes) svg+=`<g class="trace-glyph-v7-floating-nodes">${scene.nodes}</g>`;
      svg+=`</g></svg>`; return svg;
    }

    if(v6) {
      const scene=buildSpatialV6Scene(spec,width,height,renderTime,context,colors);
      svg+=`<g class="trace-glyph-v6-surface" data-spatial-render="volumetric-xyz">${scene.surfaces}</g>`;
      svg+=`<g data-glyph-layer="primary" class="trace-glyph-layer trace-glyph-primary-layer trace-glyph-v6-primary" data-active-motion="${spec.motion}">`;
      scene.primary.forEach((item,i)=>{svg+=`<path class="trace-glyph-primary strand" data-path-index="${i}" d="${item.d}" fill="none" stroke="${colors[i%colors.length]}" stroke-width="${(stroke*.52).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round" opacity="${item.opacity}" vector-effect="non-scaling-stroke"/>`;});
      svg+=`</g>`;
      if(spec.layer_count>=2) svg+=`<g data-glyph-layer="halo" class="trace-glyph-layer trace-glyph-halo-layer"><ellipse cx="${width/2}" cy="${height/2}" rx="${(Math.min(width,height)*.42).toFixed(2)}" ry="${(Math.min(width,height)*.31).toFixed(2)}" fill="none" stroke="${colors[0]}" stroke-width="${(stroke*.12).toFixed(2)}" opacity=".07" stroke-dasharray="1 5"/></g>`;
      if(spec.layer_count>=3) svg+=`<g data-glyph-layer="detail" class="trace-glyph-layer trace-glyph-detail-layer">${scene.detail||""}</g>`; else if(scene.detail) svg+=`<g class="trace-glyph-v6-floating-detail">${scene.detail}</g>`;
      if(spec.layer_count>=4) svg+=`<g data-glyph-layer="nodes" class="trace-glyph-layer trace-glyph-node-layer">${scene.nodes||""}</g>`; else if(scene.nodes) svg+=`<g class="trace-glyph-v6-floating-nodes">${scene.nodes}</g>`;
      svg+=`</svg>`;
      return svg;
    }

    if(v5) {
      const scene=buildSpatialV5Scene(spec,width,height,renderTime,context,colors);
      svg+=`<g class="trace-glyph-v5-surface" data-spatial-render="${spec.style==="quantum_lattice"?"4d-projection":"true-3d"}">${scene.surfaces}</g>`;
      svg+=`<g data-glyph-layer="primary" class="trace-glyph-layer trace-glyph-primary-layer trace-glyph-v5-primary" data-active-motion="${spec.motion}">`;
      scene.primary.forEach((item,i)=>{svg+=`<path class="trace-glyph-primary strand" data-path-index="${i}" d="${item.d}" fill="none" stroke="${colors[i%colors.length]}" stroke-width="${(stroke*(spec.style==="prism_vault"?.72:1.0)).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round" opacity="${item.opacity}" vector-effect="non-scaling-stroke"/>`;});
      svg+=`</g>`;
      if(spec.layer_count>=2) svg+=`<g data-glyph-layer="halo" class="trace-glyph-layer trace-glyph-halo-layer"><ellipse cx="${width/2}" cy="${height/2}" rx="${(Math.min(width,height)*.40).toFixed(2)}" ry="${(Math.min(width,height)*.29).toFixed(2)}" fill="none" stroke="${colors[0]}" stroke-width="${(stroke*.18).toFixed(2)}" opacity=".10" stroke-dasharray="1.1 4.4"/></g>`;
      if(spec.layer_count>=3) svg+=`<g data-glyph-layer="detail" class="trace-glyph-layer trace-glyph-detail-layer">${scene.detail||""}</g>`;
      else if(scene.detail) svg+=`<g class="trace-glyph-v5-floating-detail">${scene.detail}</g>`;
      if(spec.layer_count>=4) svg+=`<g data-glyph-layer="nodes" class="trace-glyph-layer trace-glyph-node-layer">${scene.nodes||""}</g>`;
      else if(scene.nodes) svg+=`<g class="trace-glyph-v5-floating-nodes">${scene.nodes}</g>`;
      svg+=`</svg>`;
      return svg;
    }

    if(v4 && ["quantum_lattice","prism_vault","neural_constellation"].includes(spec.style)) {
      const scene=buildTrue3DScene(spec,width,height,0,context,colors,stroke);
      svg+=`<g class="trace-glyph-v4-surface" data-true-3d="1">${scene.surfaces}</g>`;
      svg+=`<g data-glyph-layer="primary" class="trace-glyph-layer trace-glyph-primary-layer trace-glyph-v4-primary" data-active-motion="${spec.motion}">`;
      scene.primary.forEach((item,i)=>{svg+=`<path class="trace-glyph-primary strand" data-path-index="${i}" d="${item.d}" fill="none" stroke="${colors[i%colors.length]}" stroke-width="${(stroke*.34).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round" opacity="${item.opacity}" vector-effect="non-scaling-stroke"/>`;});
      svg+=`</g>`;
      if(spec.layer_count>=2) svg+=`<g data-glyph-layer="halo" class="trace-glyph-layer trace-glyph-halo-layer"><ellipse cx="${width/2}" cy="${height/2}" rx="${(Math.min(width,height)*.36).toFixed(2)}" ry="${(Math.min(width,height)*.22).toFixed(2)}" fill="none" stroke="${colors[2]}" stroke-width="${(stroke*.18).toFixed(2)}" opacity=".16" stroke-dasharray="1.2 3.4"/></g>`;
      if(spec.layer_count>=3) svg+=`<g data-glyph-layer="detail" class="trace-glyph-layer trace-glyph-detail-layer"><circle cx="${width/2}" cy="${height/2}" r="${(Math.min(width,height)*.055).toFixed(2)}" fill="${colors[3]}" opacity=".20"/><circle cx="${width/2}" cy="${height/2}" r="${(Math.min(width,height)*.085).toFixed(2)}" fill="none" stroke="#fff" stroke-width="${(stroke*.12).toFixed(2)}" opacity=".16"/></g>`;
      if(spec.layer_count>=4) svg+=`<g data-glyph-layer="nodes" class="trace-glyph-layer trace-glyph-node-layer">${scene.nodes}</g>`;
      else if(scene.nodes) svg+=`<g class="trace-glyph-v4-floating-nodes">${scene.nodes}</g>`;
      svg+=`</svg>`;
      return svg;
    }

    const primary=[];
    for(let i=0;i<spec.primary_path_count;i++) primary.push(structuralPath(spec,i,width,height,renderTime,context));
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
      if(["quantum_lattice","prism_vault","neural_constellation"].includes(spec.style)){
        const depthR=outerR*.72;
        const rails=6+(b(3)%5);
        svg+=`<g class="trace-glyph-v3-depth" filter="url(#${uid}_depthGlow)" opacity=".68">`;
        for(let i=0;i<rails;i++){
          const a=phase+(i/rails)*Math.PI*2;
          const x1=cx+Math.cos(a)*depthR*.30,y1=cy+Math.sin(a)*depthR*.17;
          const x2=cx+Math.cos(a+.22)*depthR,y2=cy+Math.sin(a+.22)*depthR*.58;
          svg+=`<path d="M${x1.toFixed(2)} ${y1.toFixed(2)} Q${cx.toFixed(2)} ${(cy+(i%2?1:-1)*depthR*.18).toFixed(2)} ${x2.toFixed(2)} ${y2.toFixed(2)}" fill="none" stroke="${colors[(i+2)%colors.length]}" stroke-width="${(stroke*.18).toFixed(2)}" opacity="${(.22+(i%3)*.08).toFixed(2)}" vector-effect="non-scaling-stroke"/>`;
        }
        const nodeN=7+(b(19)%7);
        for(let i=0;i<nodeN;i++){
          const a=phase*.7+(i/nodeN)*Math.PI*2;
          const z=.55+.45*Math.sin(a*2+b(21)/255*Math.PI);
          const rr=depthR*(.46+.46*((b(i+9)%255)/255));
          const nx=cx+Math.cos(a)*rr,ny=cy+Math.sin(a)*rr*(.48+.28*z);
          svg+=`<circle cx="${nx.toFixed(2)}" cy="${ny.toFixed(2)}" r="${(.55+1.15*z).toFixed(2)}" fill="${colors[i%colors.length]}" opacity="${(.45+.34*z).toFixed(2)}"/>`;
          svg+=`<circle cx="${(nx-.18).toFixed(2)}" cy="${(ny-.22).toFixed(2)}" r="${(.18+.32*z).toFixed(2)}" fill="#fff" opacity=".78"/>`;
        }
        svg+=`</g>`;
      }
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


const TraceGlyphScheduler=(()=>{
  const items=new Map(); let raf=0,last=0,avgFrame=16.7,interactionUntil=0;
  const reduced=()=>!!(root.matchMedia&&root.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const isVisible=(svg)=>{if(!svg?.isConnected)return false;const r=svg.getBoundingClientRect?.();return !r||(r.bottom>=-80&&r.top<=(root.innerHeight||1000)+80&&r.right>=-80&&r.left<=(root.innerWidth||1000)+80);};
  const qualityFor=(item)=>{if(reduced())return"static";if(root.__TRACE_TEXT_INPUT_ACTIVE||performance.now()<interactionUntil)return"static";if(avgFrame>28)return"low";if(avgFrame>21)return"medium";return item.mode==="badge"||item.mode==="public"?"high":"medium";};
  function touchInteraction(ms=180){interactionUntil=Math.max(interactionUntil,performance.now()+ms);}
  function update(item,now){
    const {svg,spec,width,height,mode,primary,halos}=item;if(!isVisible(svg)){item.visible=false;return;}item.visible=true;
    const q=qualityFor(item); if(q==="static")return;
    const target=q==="high"?33:q==="medium"?50:83;if(now-item.last<target)return;item.last=now;const t=now/1000;
    if(spec.renderer_version===RENDERER_V7)return;
    const colors=palette(spec);
    const scene=spec.renderer_version===RENDERER_V6?buildSpatialV6Scene(spec,width,height,t,{mode,quality:q},colors):spec.renderer_version===RENDERER_V5?buildSpatialV5Scene(spec,width,height,t,{mode,quality:q},colors):null;
    if(scene){
      const surface=svg.querySelector(spec.renderer_version===RENDERER_V7?".trace-glyph-v7-surface":spec.renderer_version===RENDERER_V6?".trace-glyph-v6-surface":".trace-glyph-v5-surface"); if(surface&&item.lastSurface!==scene.surfaces){surface.innerHTML=scene.surfaces;item.lastSurface=scene.surfaces;}
      for(let i=0;i<primary.length;i++){const x=scene.primary[i];if(x){primary[i].setAttribute("d",x.d);primary[i].setAttribute("opacity",x.opacity);}}
      const detail=svg.querySelector(".trace-glyph-detail-layer,.trace-glyph-v7-floating-detail,.trace-glyph-v6-floating-detail,.trace-glyph-v5-floating-detail");if(detail&&scene.detail!==undefined&&item.lastDetail!==scene.detail){detail.innerHTML=scene.detail;item.lastDetail=scene.detail;}
      const nodes=svg.querySelector(".trace-glyph-node-layer,.trace-glyph-v7-floating-nodes,.trace-glyph-v6-floating-nodes,.trace-glyph-v5-floating-nodes");if(nodes&&scene.nodes!==undefined&&item.lastNodes!==scene.nodes){nodes.innerHTML=scene.nodes;item.lastNodes=scene.nodes;}
      return;
    }
    for(let i=0;i<primary.length;i++){const d=structuralPath(spec,i,width,height,t+i*.14,{mode});primary[i].setAttribute("d",d);if(halos[i])halos[i].setAttribute("d",d);}
  }
  function tick(now){const delta=last?Math.min(80,now-last):16.7;last=now;avgFrame=avgFrame*.92+delta*.08;for(const [svg,item] of items){if(!svg.isConnected){items.delete(svg);continue;}update(item,now);}raf=items.size?root.requestAnimationFrame(tick):0;}
  function register(svg,spec,width,height,mode,primary,halos){items.set(svg,{svg,spec,width,height,mode,primary,halos,last:0,lastSurface:"",lastDetail:"",lastNodes:""});if(!raf)raf=root.requestAnimationFrame(tick);}
  function unregister(svg){items.delete(svg);if(!items.size&&raf){root.cancelAnimationFrame?.(raf);raf=0;}}
  function stats(){return{active:items.size,avgFrameMs:round(avgFrame,2),interactionPaused:performance.now()<interactionUntil||!!root.__TRACE_TEXT_INPUT_ACTIVE};}
  try{root.addEventListener?.("pointerdown",()=>touchInteraction(140),{passive:true});root.addEventListener?.("keydown",()=>touchInteraction(180),{passive:true});root.document?.addEventListener?.("visibilitychange",()=>{if(root.document.visibilityState!=="visible")interactionUntil=performance.now()+250;});}catch{}
  return Object.freeze({register,unregister,touchInteraction,stats});
})();

function startGlyphMotion(svg){
  if(!svg||svg.dataset.traceGlyphV1Motion==="1")return;
  const spec=parseSpecFromSvg(svg);if(!spec)return;svg.dataset.traceGlyphV1Motion="1";
  if(root.matchMedia&&root.matchMedia("(prefers-reduced-motion: reduce)").matches){svg.dataset.motionReduced="1";return;}
  // V7 never enters the JavaScript frame renderer. Its expensive volumetric
  // geometry is already materialized once; stable SVG groups are animated by
  // compositor-friendly CSS transforms. This is the critical zero-jank path.
  if(spec.renderer_version===RENDERER_V7){
    svg.classList.add("trace-glyph-v7-compositor");
    svg.dataset.traceMotionOwner="v7-compositor";
    return;
  }
  const vb=(svg.getAttribute("viewBox")||"0 0 142 92").split(/\s+/).map(Number),width=vb[2]||142,height=vb[3]||92;
  const mode=height===width?(svg.closest?.(".trace-profile-glyph-v34")?"profile":"avatar"):"badge";
  TraceGlyphScheduler.register(svg,spec,width,height,mode,Array.from(svg.querySelectorAll(".trace-glyph-primary")),Array.from(svg.querySelectorAll(".trace-glyph-halo")));
}


function createProfileGlyphSpecification(inputs={}){
  const history=Array.isArray(inputs.history)?inputs.history:[];
  const canonical=history.map(item=>({id:clean(item.proof_id||item.badge_id||item.id),state:clean(item.lifecycle||item.proof_status||item.state||"published"),ts:clean(item.created_at||item.ts)})).sort((a,b)=>(a.ts+a.id).localeCompare(b.ts+b.id));
  const historyMaterial=JSON.stringify(canonical);
  const spec=createGlyphSpecification({creator_id:inputs.creator_id||inputs.handle,profile_mindprint_hash:inputs.profile_mindprint_hash||"",badge_mindprint_hash:deriveHex(historyMaterial,"profile-history"),proof_id:deriveHex(historyMaterial,"profile-proof-state"),glyph_seed:deriveHex(`${clean(inputs.creator_id||inputs.handle)}|${historyMaterial}`,"profile-glyph"),style:"prism_vault",ai_probability:0});
  return Object.freeze({...spec,renderer_version:RENDERER_V7,style:"prism_vault",structure:"faceted_arcs",motion:"torsion_orbit",complexity:"complex",layer_count:4,stroke_profile:"fine",profile_renderer:PROFILE_RENDERER_V2,profile_history_count:canonical.length,profile_history_digest:deriveHex(historyMaterial,"profile-history-digest")});
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
    VERSION,RENDERER_V1,RENDERER_V2,RENDERER_V3,RENDERER_V4,RENDERER_V5,RENDERER_V6,RENDERER_V7,PROFILE_RENDERER_V2,STYLES,normalizeGlyphSpecification,createGlyphSpecification,createProfileGlyphSpecification,describeGlyphSpecification,
    renderGlyphFromSpecification,selectGlyphHeroPose,startGlyphMotion,validateRenderedGlyph,exampleSpecification,TraceGlyphScheduler
  });
  root.TraceGlyphV1=api;
})(typeof window!=="undefined"?window:globalThis);
