const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {createProgress,percentage,AD_DURATION_MS}=require('./studio-progress.js');

function fixture(){
  let time=0,next=1;const timers=new Map();
  const host={attributes:{},children:[],setAttribute(k,v){this.attributes[k]=v;},removeAttribute(k){delete this.attributes[k];},appendChild(node){this.children.push(node);}};
  function node(){return {style:{},attributes:{},textContent:'',setAttribute(k,v){this.attributes[k]=v;}};}
  const document={getElementById:()=>host,createElement:()=>{
    const elements={'[role="progressbar"]':node(),'.studio-progress-fill':node(),'.studio-progress-value':node(),'.studio-progress-label':node()};
    return {elements,querySelector:s=>elements[s],remove(){host.children=host.children.filter(child=>child!==this);}};
  }};
  const loader=createProgress({document,now:()=>time,schedule:(fn,ms)=>{const id=next++;timers.set(id,{fn,at:time+ms});return id;},cancel:id=>timers.delete(id)});
  function advance(ms){const end=time+ms;for(;;){const entry=[...timers.entries()].sort((a,b)=>a[1].at-b[1].at)[0];if(!entry||entry[1].at>end)break;time=entry[1].at;timers.delete(entry[0]);entry[1].fn();}time=end;}
  const value=()=>host.children[0]?.elements['.studio-progress-value'].textContent;
  return {loader,host,timers,advance,value};
}
test('ad percentage reaches 100 at precisely 2000ms, never earlier',()=>{
  assert.equal(AD_DURATION_MS,2000);
  for(const [ms,value] of [[0,0],[1000,50],[1999,99],[2000,100],[3000,100]])assert.equal(percentage('ad',ms),value);
});
test('ad immediately shows 0%, then 50%, then 100% and holds with Even geduld',async()=>{
  const s=fixture();s.loader.start('ad');assert.equal(s.value(),'0%');assert.equal(s.host.attributes['aria-busy'],'true');
  let ready=false;const done=s.loader.waitForAd().then(value=>{ready=value;});
  s.advance(1000);assert.equal(s.value(),'50%');s.advance(999);assert.notEqual(s.value(),'100%');assert.equal(ready,false);
  s.advance(1);await done;assert.equal(ready,true);assert.equal(s.value(),'100%');
  assert.equal(s.host.children[0].elements['.studio-progress-label'].textContent,'Even geduld…');
  assert.equal(s.timers.size,0);s.advance(10000);assert.equal(s.value(),'100%');
  s.loader.stop();assert.equal(s.host.children.length,0);assert.equal(s.host.attributes['aria-busy'],undefined);
});
test('video estimate is monotonic and never reaches 95 or 100 even after a long wait',()=>{
  let previous=0;
  for(const ms of [0,1000,10000,60000,180000,420000,3600000]){
    const value=percentage('video',ms);assert.ok(value>=previous);assert.ok(value<95);previous=value;
  }
});
test('video only paints 100 on explicit ready completion, then allows reveal',async()=>{
  const s=fixture();s.loader.start('video');s.advance(180000);assert.equal(s.value(),'90%');
  const bar=s.host.children[0].elements['[role="progressbar"]'];
  assert.match(bar.attributes['aria-label'],/geschatte voortgang/);
  let ready=false;const done=s.loader.complete().then(value=>{ready=value;});assert.equal(s.value(),'100%');
  s.advance(119);assert.equal(ready,false);s.advance(1);await done;assert.equal(ready,true);
  s.loader.stop();assert.equal(s.timers.size,0);
});
test('error/cancellation stops timers and settles pending ad/reveal waits without revealing a result',async()=>{
  for(const mode of ['ad','video']){
    const s=fixture();s.loader.start(mode);const done=mode==='ad'?s.loader.waitForAd():s.loader.complete();
    s.loader.stop();assert.equal(await done,false);assert.equal(s.host.children.length,0);assert.equal(s.timers.size,0);
  }
});
test('starting another loader discards previous work and never creates duplicate overlays',async()=>{
  const s=fixture();s.loader.start('ad');const previous=s.loader.waitForAd();s.loader.start('video');
  assert.equal(await previous,false);assert.equal(s.host.children.length,1);assert.equal(s.value(),'0%');
  s.advance(2000);assert.notEqual(s.value(),'100%');s.loader.stop();
});
test('media gate waits for a decoded frame and cleans listeners on ready, error or timeout',async()=>{
  const source=fs.readFileSync('ai-video.js','utf8');
  const start=source.indexOf('function waitForAIVideoReady(video)');
  const helper=source.slice(start,source.indexOf('/** @param {string} operation */',start));
  for(const outcome of ['loadeddata','error','timeout']){
    let deadline,cancelled=false;const listeners=new Map();
    const context={setTimeout:fn=>{deadline=fn;return 1;},clearTimeout:()=>{cancelled=true;},Error};
    vm.runInNewContext(helper,context);
    const video={readyState:0,addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:type=>listeners.delete(type)};
    let ready=false;const promise=context.waitForAIVideoReady(video);promise.then(()=>{ready=true;},()=>{});
    await Promise.resolve();assert.equal(ready,false,'Media must not complete before loadeddata');
    if(outcome==='loadeddata'){listeners.get(outcome)();await promise;assert.equal(ready,true);}
    else{const rejected=assert.rejects(promise,/niet worden afgespeeld|duurde te lang/);if(outcome==='timeout')deadline();else listeners.get(outcome)();await rejected;}
    assert.equal(listeners.size,0);assert.equal(cancelled,true);
  }
});
test('both Studio builds load the same component, with a themeable blue ring and grey track',()=>{
  const html=fs.readFileSync('spectron-social-studio.html','utf8');const css=fs.readFileSync('studio-progress.css','utf8');const build=fs.readFileSync('demo/build.cjs','utf8');
  for(const asset of ['studio-progress.js','studio-progress.css']){assert.ok(html.includes(asset));assert.ok(build.includes(asset));}
  for(const variable of ['--progress-blue','--progress-track','--progress-overlay','--progress-size','--progress-stroke','--progress-font-size'])assert.ok(css.includes(variable));
  assert.match(css,/--progress-blue:var\(--ui-blue/);assert.match(css,/--progress-track:#d9dee7/);
  assert.match(css,/max-width:600px/);
});
