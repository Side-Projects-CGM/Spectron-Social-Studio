const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const usage=require('./netlify/lib/usage.cjs');
const source=fs.readFileSync('ai-video.js','utf8');
const page=fs.readFileSync('spectron-social-studio.html','utf8');

for(const ratio of ['9:16','16:9']) test(`${ratio}: selector, crop, start payload, tracking and preview retain submitted orientation`,async()=>{
 const records=[];const requests=[];
 const originalTracked=usage.trackedFetch;
 const originalKey=process.env.GEMINI_API_KEY;
 const startPath=require.resolve('./netlify/functions/start-veo-test.cjs');
 const wrapperPath=require.resolve('./netlify/functions/start-veo-video.cjs');
 const servicePath=require.resolve('./netlify/lib/omni-video.cjs');
 // Inject an in-memory tracker and fetcher. No provider or storage network calls.
 usage.trackedFetch=usage.createTracker({storeFactory:()=>({async setJSON(key,value){records.push(value);}}),fetcher:async(url,options)=>{
   requests.push(JSON.parse(options.body));
   return new Response(JSON.stringify({id:'mock-video',status:'in_progress'}),{status:200});
 }}).trackedFetch;
 delete require.cache[startPath];delete require.cache[wrapperPath];delete require.cache[servicePath];
 process.env.GEMINI_API_KEY='mock-only-key';
 try{
  const start=require(wrapperPath).handler;
  const els={aiVideoAspect:{value:'9:16'},platform:{value:'landscape-platform'},outputType:{value:'ai-video'},aiVideoOptions:{},generateAIVideoBtn:{setAttribute(){}},aiVideoSourcePreview:{},aiVideoPrompt:{value:'Product showcase'},outputMeta:{},resultsArea:{innerHTML:''},aiVideoAgain:{},aiVideoPreview:{dataset:{},addEventListener(){},load(){}},aiVideoPreviewError:{hidden:true},aiVideoConfirmModal:{hidden:true},aiVideoConfirmButton:{focus(){}},aiVideoCancelButton:{}};
  let startCalls=0,draw,canvas;const timers=[];
  const ctx=vm.createContext({document:{getElementById:id=>els[id],querySelectorAll:()=>[],createElement:()=>canvas={getContext:()=>({drawImage(...args){draw=args;}}),toBlob(fn,type){fn(new Blob(['cropped'],{type}));}}},window:{addEventListener(){}},selectedImage:'mock-image',getFormatSpec:()=>({width:1920,height:1080}),setAdGenerationState(){},escapeHtml:String,console,Date,Blob,URL:{createObjectURL:()=> 'blob:mock',revokeObjectURL(){}},setTimeout(fn){timers.push(fn);return timers.length;},clearTimeout(){},createImageBitmap:async()=>({width:1600,height:900,close(){}}),FileReader:class{readAsDataURL(blob){this.result=`data:${blob.type};base64,YWJj`;this.onload();}},fetch:async(url,options)=>{
   if(url==='mock-image')return {blob:async()=>new Blob(['image'],{type:'image/png'})};
   if(url==='/.netlify/functions/start-veo-video'){
    startCalls++;assert.equal(JSON.parse(options.body).aspectRatio,ratio);
    const response=await start({httpMethod:'POST',body:options.body});
    return new Response(response.body,{status:response.statusCode,headers:response.headers});
   }
   if(url.startsWith('/.netlify/functions/veo-video-status?'))return new Response(JSON.stringify({state:'completed'}),{headers:{'Content-Type':'application/json'}});
   if(url.startsWith('/.netlify/functions/download-veo-video?'))return new Response(new Blob(['mock-mp4'],{type:'video/mp4'}),{headers:{'Content-Type':'video/mp4'}});
   throw Error(`Unexpected request: ${url}`);
  }});
  vm.runInContext(source,ctx);
  vm.runInContext('syncAIVideoImage=window.syncAIVideoImage',ctx);
  vm.runInContext(page.slice(page.indexOf('function syncStudioVideoFormatButtons('),page.indexOf('let currentVariants =')),ctx);
  ctx.updateVideoMode();assert.equal(els.aiVideoAspect.value,'9:16','platform must not silently overwrite visible portrait default');
  ctx.selectAIVideoFormat(ratio);ctx.updateVideoMode();assert.equal(els.aiVideoAspect.value,ratio);
  const generating=ctx.generateAIVideo();await Promise.resolve();
  await ctx.generateAIVideo();assert.equal(startCalls,0,'confirmation and duplicate click cannot start a request');
  els.aiVideoConfirmButton.onclick();await generating;
  await ctx.generateAIVideo();assert.equal(startCalls,1,'duplicate click during polling is ignored');
  assert.equal(requests[0].response_format.aspect_ratio,ratio);
  assert.equal(requests[0].response_format.duration,'8s');
  assert.equal(requests[0].input[1].text,'Product showcase','Omni receives only the video textbox, without appended brand or product fields');
  assert.equal(requests[0].input[0].mime_type,'image/png');
  if(ratio==='9:16'){assert.ok(Math.abs(canvas.width/canvas.height-9/16)<.002);assert.ok(draw[1]>0,'center crop without padding');}
  assert.equal(records.length,2);for(const record of records)assert.equal(record.aspectRatio,ratio);
  const summary=usage.summarize(records);assert.equal(summary.recent[0].aspectRatio,ratio);assert.equal(summary.totals.veo.attempts,1);
  ctx.selectAIVideoFormat(ratio==='9:16'?'16:9':'9:16');
  await ctx.pollAIVideo('interactions/mock-video');
  assert.equal(els.aiVideoPreview.dataset.previewRatio,ratio==='9:16'?'portrait':'landscape');
  assert.match(els.resultsArea.innerHTML,new RegExp(`ai-video-frame-${ratio==='9:16'?'portrait':'landscape'}`));
  assert.equal(els.aiVideoPreview.controls,true);
  assert.equal(els.aiVideoPreview.src,'blob:mock');
  assert.match(els.resultsArea.innerHTML,/href="\/\.netlify\/functions\/download-veo-video\?operation=interactions%2Fmock-video"/);
 }finally{usage.trackedFetch=originalTracked;delete require.cache[startPath];delete require.cache[wrapperPath];delete require.cache[servicePath];if(originalKey===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=originalKey;}
});

for(const mobile of [false,true]) test(`portrait fits ${mobile?'mobile viewport':'desktop canvas'} and resizes`,()=>{
 let height;
 const frame={offsetHeight:500,getBoundingClientRect:()=>({top:120}),style:{setProperty(key,value){assert.equal(key,'--ai-video-preview-height');height=Number.parseFloat(value);}}};
 const canvas={clientHeight:700,scrollTop:0,getBoundingClientRect:()=>({top:40})};
 const elements={aiVideoFrame:frame,workspaceCanvas:canvas,resultsArea:{scrollHeight:580}};
 const window={innerWidth:mobile?390:1200,innerHeight:800,visualViewport:{height:800,addEventListener(){}},addEventListener(){}};
 const ctx=vm.createContext({window,document:{getElementById:id=>elements[id]}});
 vm.runInContext(source,ctx);ctx.sizeAIVideoPreview();
 assert.equal(height,(mobile?800:700)-80-80-24);
 const width=Math.min(mobile?350:900,height*9/16);
 assert.ok(width*16/9+80+80+24<=(mobile?800:700));
 window.visualViewport.height=500;ctx.sizeAIVideoPreview();
 assert.equal(height,316,'shrinking viewport reserves header, actions and padding');
 canvas.scrollTop=30;frame.getBoundingClientRect=()=>({top:90});ctx.sizeAIVideoPreview();
 assert.equal(height,316,'canvas scrolling does not change the intrinsic height budget');
});

test('preview fills explicit frames without layout padding or white background',()=>{
 assert.match(page,/\.ai-video-result\{gap:10px;padding:0;background:transparent;/);
 assert.match(page,/\.ai-video-frame-portrait\{aspect-ratio:9\/16;/);
 assert.match(page,/\.ai-video-frame-landscape\{aspect-ratio:16\/9;width:100%;/);
 assert.match(page,/width:min\(100%,calc\(var\(--ai-video-preview-height/);
 assert.match(page,/\.ai-video-frame \.video-preview\{[^}]*width:100%;height:100%;[^}]*object-fit:contain;[^}]*background:var\(--media-black\);position:absolute;inset:0;/);
});

test('image decode failure stops before a paid start',async()=>{
 const ctx=vm.createContext({document:{getElementById(){}},window:{addEventListener(){}},selectedImage:'mock-image',fetch:async()=>({blob:async()=>new Blob(['image'],{type:'image/png'})}),createImageBitmap:async()=>{throw Error('decode');},Blob});
 vm.runInContext(source,ctx);
 await assert.rejects(ctx.normalizeAIVideoImage('9:16'),/kon niet worden verwerkt/);
});
