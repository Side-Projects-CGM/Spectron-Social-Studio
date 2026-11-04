const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('animated-video.js','utf8');
const page=fs.readFileSync('spectron-social-studio.html','utf8');
assert.match(page,/<option value="image" selected>Afbeelding/);
assert.match(page,/id="videoOptions" hidden/);
assert.match(page,/<option value="4" selected/);
assert.match(page,/<option value="zoom-in" selected/);
assert.doesNotMatch(source,/fetch\(|gemini|veo|ad-logo|ai-image-badge/i);
function session({unsupported=false,error=false,dimensions=[1080,1080],hold=false,existing=true,mp4=false}={}){
 const elements=new Map(),events={urls:0,revoked:0,tracks:0,stops:0,frames:[],draws:[],requests:0,removed:0};
 const image={style:{}};
 const design={style:{},clientWidth:320,cloneNode(){return {...this,style:{}};},querySelector:()=>image};
 const el=id=>{if(!elements.has(id))elements.set(id,{value:'',style:{},innerHTML:'',setAttribute(){},replaceChildren(){this.innerHTML='';},pause(){},load(){},removeAttribute(){},play:()=>Promise.resolve()});return elements.get(id);};
 Object.entries({brand:'Bluey',platform:'post',outputType:'video',videoDuration:'4',videoMotion:'zoom-in',tone:'warm',promo:''}).forEach(([id,value])=>el(id).value=value);
 let now=0,resolveCapture;
 class Recorder{
  static isTypeSupported(type){return type===(mp4?'video/mp4;codecs=avc1':'video/webm;codecs=vp9');}
  constructor(stream,options){this.mimeType=options.mimeType;this.state='inactive';}
  start(){this.state='recording';if(error)queueMicrotask(()=>this.onerror?.());}
  stop(){this.state='inactive';events.stops++;this.ondataavailable?.({data:new Blob(['video'])});this.onstop?.();}
 }
 const context=vm.createContext({console,structuredClone,Blob,MediaRecorder:Recorder,HTMLCanvasElement:{prototype:{captureStream(){}}},
  window:{MediaRecorder:unsupported?undefined:Recorder,addEventListener(){},html2canvas:()=>hold?new Promise(resolve=>{resolveCapture=resolve;}):Promise.resolve({overlay:true})},
  document:{fonts:{ready:Promise.resolve()},body:{appendChild(){}},getElementById:id=>{
   if(id==='animatedVideoPreview'||id==='animatedVideoDownload')return el('resultsArea').innerHTML.includes('animatedVideoPreview')?el(id):null;
   return el(id);
  },querySelector:()=>existing?design:null,createElement:tag=>tag==='canvas'?{width:0,height:0,getContext:()=>({clearRect(){},drawImage(...args){events.draws.push(args);}}),captureStream:()=>({getTracks:()=>[{stop(){events.tracks++;}}]})}:{style:{},setAttribute(){},append(){},querySelector:()=>design,remove(){events.removed++;}}},
  URL:{createObjectURL(){events.urls++;return 'blob:video-'+events.urls;},revokeObjectURL(){events.revoked++;}},
  requestAnimationFrame:fn=>{const id=events.frames.length+1;events.frames.push(id);queueMicrotask(()=>{now+=1000;fn(now);});return id;},cancelAnimationFrame(){},performance:{now:()=>now},setTimeout:()=>1,clearTimeout(){},
  adGenerationInProgress:false,selectedImage:'brand.png',selectedVariantIndex:0,currentBrand:'Bluey',currentPlatform:'post',currentFormat:dimensions.join('x'),currentVariants:[{headline:'Edited headline'}],variantVisuals:[{imgScale:1.3,imgPosX:35,imgPosY:70,textScale:1.5}],imgScale:1.3,imgPosX:35,imgPosY:70,textScale:1.5,
  getFormatSpec:()=>({width:dimensions[0],height:dimensions[1],value:dimensions.join('x')}),PLATFORM_LIMITS:{post:{mock:'social'}},
  setAdGenerationState(value){context.adGenerationInProgress=value;el('generateBtn').disabled=value;if(value)el('resultsArea').innerHTML='PROGRESS';},
  loadCanvasImage:async src=>{assert.equal(src,'brand.png');return {naturalWidth:800,naturalHeight:600};},
  drawCoverImage(...args){events.draws.push(args);},escapeHtml:String,
  generateOffline(){return [{headline:'Local'}];},getSelectedUSPs:()=>[],renderResults(variants){assert.equal(variants[0].headline,'Edited headline');},applyImageTransform(){},applyTextScale(){},fetch(){throw Error('Video must not call network generation');}
 });
 vm.runInContext(source,context);
 return {context,el,events,run:code=>vm.runInContext(code,context),release:()=>resolveCapture?.({overlay:true})};
}
(async()=>{
 let s=session();assert.equal(s.el('videoOptions').hidden,false);
 s.el('outputType').value='image';s.run('updateVideoMode()');assert.equal(s.el('videoOptions').hidden,true);
 const visual={imgScale:1.3,imgPosX:35,imgPosY:70};s.context.visual=visual;
 for(const motion of ['zoom-in','zoom-out','pan-right','pan-left']){
  const a=s.run(`videoMotion('${motion}',0,visual)`),b=s.run(`videoMotion('${motion}',1,visual)`);
  assert.equal(a.y,70);assert.equal(b.y,70);
  if(motion==='zoom-in')assert.ok(b.scale>a.scale);
  if(motion==='zoom-out')assert.ok(b.scale<a.scale);
  if(motion==='pan-right')assert.ok(b.x<a.x);
  if(motion==='pan-left')assert.ok(b.x>a.x);
 }
 for(const dimensions of [[1080,1080],[1080,1350],[1200,628],[1080,1920]]){
  for(const seconds of [3,4,5]){
   s=session({dimensions});s.el('videoDuration').value=String(seconds);
   const pending=s.run('generateAnimatedAd()');assert.equal(s.el('resultsArea').innerHTML,'PROGRESS');assert.equal(s.el('generateBtn').disabled,true);
   await s.run('generateAnimatedAd()');await pending;
   assert.equal(s.events.urls,1);assert.equal(s.el('generateBtn').disabled,false);
   assert.match(s.el('resultsArea').innerHTML,/autoplay muted loop playsinline controls/);
   assert.equal(s.el('animatedVideoPreview').src,s.el('animatedVideoDownload').href);
   assert.match(s.el('animatedVideoDownload').download,/\.webm$/);
   assert.equal(s.events.draws[0][2],dimensions[0]);assert.equal(s.events.draws[0][3],dimensions[1]);
   assert.ok(s.events.tracks>=1);assert.ok(s.events.removed>=1);
   await s.run('generateAnimatedAd()');assert.equal(s.events.revoked,1);
   s.el('outputType').value='image';s.run('updateVideoMode()');assert.equal(s.events.revoked,2);
  }
 }
 for(const options of [{unsupported:true},{error:true}]){
  s=session(options);await s.run('generateAnimatedAd()');assert.equal(s.el('generateBtn').disabled,false);assert.match(s.el('resultsArea').innerHTML,/Opnieuw proberen/);assert.equal(s.events.urls,0);
  if(options.error)assert.ok(s.events.tracks>=1);
 }
 s=session({mp4:true});await s.run('generateAnimatedAd()');assert.match(s.el('animatedVideoDownload').download,/\.mp4$/);
 s=session();s.el('videoMotion').value='invalid';await s.run('generateAnimatedAd()');assert.match(s.el('resultsArea').innerHTML,/ondersteunde bewegingsstijl/);
 s=session();s.el('videoDuration').value='6';await s.run('generateAnimatedAd()');assert.match(s.el('resultsArea').innerHTML,/3, 4 of 5/);
 s=session({existing:false});await s.run('generateAnimatedAd()');assert.equal(s.events.urls,1);
 s=session({hold:true});const pending=s.run('generateAnimatedAd()');await new Promise(resolve=>setImmediate(resolve));
 s.el('outputType').value='image';s.run('updateVideoMode()');s.release();await pending;assert.equal(s.events.urls,0);assert.equal(s.el('generateBtn').disabled,false);
 console.log('PASS: Image default, conditional controls, 3/4/5 seconds, four motions, format dimensions, shared design, progress, duplicate guard, preview/download identity, unsupported/error handling, cancellation and URL/recording cleanup');
})().catch(error=>{console.error(error);process.exitCode=1;});
