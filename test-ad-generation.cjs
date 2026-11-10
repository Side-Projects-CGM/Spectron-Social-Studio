const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const page=fs.readFileSync('spectron-social-studio.html','utf8');
const source=page.slice(page.indexOf('let adGenerationInProgress ='),page.indexOf('function renderResults('));
function session(){
 const elements=new Map();
 const el=id=>{if(!elements.has(id))elements.set(id,{value:'',innerHTML:'',textContent:'',style:{},attributes:{},setAttribute(k,v){this.attributes[k]=v;}});return elements.get(id);};
 for(const [id,value] of Object.entries({brand:'Bluey',platform:'post',tone:'warm',promo:'',variantCount:'4'}))el(id).value=value;
 el('resultsArea').innerHTML='OLD RESULTS';
 let settle,requests=0,renders=0;
 const context=vm.createContext({document:{getElementById:id=>id==='adGenerationLoading'?null:el(id)},getFormatSpec:()=>({label:'Square'}),getSelectedUSPs:()=>[],PLATFORM_LIMITS:{post:{headline:30,body:100}},escapeHtml:String,
 fetch:()=>{requests++;return new Promise(resolve=>{settle=resolve;});},
 renderResults(variants){assert.equal(el('generateBtn').disabled,true,'Loading lasts through rendering');assert.match(el('resultsArea').innerHTML,/role="progressbar"/);renders++;if(context.renderFails)throw new Error('Render failed');el('resultsArea').innerHTML='NEW RESULTS';},
 generateOffline(){if(context.fallbackFails)throw new Error('Fallback failed');return [{headline:'Offline'}];}
 });
 vm.runInContext(source,context);
 return {el,context,run:()=>vm.runInContext('generateAds()',context),respond:response=>settle(response),requests:()=>requests,renders:()=>renders};
}
const success={ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify({variants:[{headline:'New'}]})}]}}]})};
function restored(s){assert.equal(s.el('generateBtn').disabled,false);assert.match(s.el('generateBtn').innerHTML,/Genereer advertentie/);assert.equal(s.el('resultsArea').attributes['aria-busy'],'false');assert.doesNotMatch(s.el('resultsArea').innerHTML,/role="progressbar"|Generating your advertisements/);}
(async()=>{
 let s=session(),pending=s.run();
 assert.match(s.el('resultsArea').innerHTML,/role="progressbar"/);
 assert.match(s.el('resultsArea').innerHTML,/aria-live="polite"/);
 assert.doesNotMatch(s.el('resultsArea').innerHTML,/OLD RESULTS|aria-valuenow/);
 assert.equal(s.el('generateBtn').disabled,true);assert.equal(s.el('generateBtn').innerHTML,'Bezig met genereren...');
 await s.run();assert.equal(s.requests(),1);
 s.respond(success);await pending;restored(s);assert.equal(s.renders(),1);assert.equal(s.el('resultsArea').innerHTML,'NEW RESULTS');
 // A later click starts a new generation after the lock is released.
 pending=s.run();assert.equal(s.requests(),2);s.respond(success);await pending;restored(s);
 for(const mode of ['fallback','failure','render','empty']){
  s=session();s.context.fallbackFails=mode!=='fallback';s.context.renderFails=mode==='render';pending=s.run();
  s.respond(mode==='render'?success:mode==='empty'?{ok:true,json:async()=>({candidates:[{content:{parts:[{text:'{"variants":[]}'}]}}]})}:{ok:false,status:500});
  await pending;restored(s);
  if(mode==='fallback')assert.equal(s.el('resultsArea').innerHTML,'NEW RESULTS');
  else {assert.match(s.el('resultsArea').innerHTML,/Opnieuw proberen/);assert.match(s.el('resultsArea').innerHTML,/onclick="generateAds\(\)"/);}
 }
 s=session();s.el('brand').value='';await s.run();assert.equal(s.requests(),0);assert.doesNotMatch(s.el('resultsArea').innerHTML,/progressbar/);
 s=session();s.el('outputType').value='video';let videoCalls=0;s.context.generateAnimatedAd=async()=>{videoCalls++;};await s.run();assert.equal(videoCalls,1);assert.equal(s.requests(),0,'Video mode must bypass the AI text endpoint');
 console.log('PASS: immediate accessible indeterminate progress, old-result replacement, disabled button, duplicate prevention, rendering completion, retry, fallback and failure cleanup');
})().catch(error=>{console.error(error);process.exitCode=1;});



