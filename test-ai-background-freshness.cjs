const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto').webcrypto;
const source=fs.readFileSync('ai-background.js','utf8');
const page=fs.readFileSync('spectron-social-studio.html','utf8');
const original='data:image/png;base64,b3JpZ2luYWw=';
const old='data:image/png;base64,b2xk';
const fresh='data:image/png;base64,ZnJlc2g=';
function session({storage=new Map(),records=[],outputs=[]}={}){
 const els=new Map(),requests=[];
 const el=id=>{if(!els.has(id))els.set(id,{value:'',hidden:false,src:'stale-dom-image',textContent:'',setAttribute(){},removeAttribute(key){delete this[key];},focus(){}});return els.get(id);};
 const ctx=vm.createContext({crypto,atob,AbortController,setTimeout,clearTimeout,console,
   selectedImage:original,brandImageRecords:records,uploadedImages:[],
   localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},
   document:{getElementById:el},
   fetch:async(url,options)=>{requests.push({url,options});const output=outputs.shift();return typeof output==='function'?output():{ok:true,json:async()=>({image:output})};},
   selectImage(src){ctx.selectedImage=src;vm.runInContext('clearBackgroundPreview();syncBackgroundImage()',ctx);},
   async persistBrandImage(record){ctx.brandImageRecords.push(record);},renderImageGallery(){}
 });
 vm.runInContext(source,ctx);
 vm.runInContext('backgroundImageData=async src=>src',ctx);
 el('backgroundDescription').value='Neutral background';
 return {ctx,el,requests,storage};
}

test('new clicks clear preview synchronously, use unique no-store requests, and failed requests leave it empty',async()=>{
 const s=session({outputs:[fresh,()=>{throw Error('mock failure');}]});
 assert.equal(s.el('backgroundPreview').hidden,true);assert.equal(s.el('backgroundPreview').src,undefined);
 await s.ctx.generateBackground();assert.equal(s.el('backgroundPreview').src,fresh);
 assert.equal(s.ctx.selectedImage,fresh);
 assert.equal(s.el('backgroundAccept').hidden,true);
 assert.equal(s.ctx.brandImageRecords.length,1);
 const pending=s.ctx.generateBackground();
 assert.equal(s.el('backgroundPreview').hidden,true);assert.equal(s.el('backgroundPreview').src,undefined);
 await pending;assert.equal(s.el('backgroundPreview').hidden,true);
 assert.equal(s.requests.length,2);
 assert.notEqual(s.requests[0].url,s.requests[1].url);
 for(const r of s.requests){assert.equal(r.options.cache,'no-store');assert.ok(JSON.parse(r.options.body).requestId);}
 s.ctx.selectImage(original);assert.equal(s.el('backgroundPreview').hidden,true);
});

test('saved duplicates retry once, accept only fresh output, and twice repeated output errors',async()=>{
 const records=[{image:old,source:'ai-background'}];
 const s=session({records,outputs:[old,fresh,old,old]});
 await s.ctx.generateBackground();assert.equal(s.requests.length,2);assert.equal(s.el('backgroundPreview').src,fresh);
 await s.ctx.generateBackground();assert.equal(s.requests.length,4);
 assert.equal(s.el('backgroundPreview').hidden,true);assert.equal(s.el('backgroundAccept').hidden,true);
 assert.match(s.el('backgroundError').textContent,/eerdere afbeelding/);
});

test('automatically applied result fingerprints survive reload; duplicate source bytes are rejected across MIME labels',async()=>{
 const storage=new Map();
 const first=session({storage,outputs:[fresh]});await first.ctx.generateBackground();
 const reload=session({storage,outputs:[fresh,fresh]});assert.equal(reload.el('backgroundPreview').hidden,true);
 await reload.ctx.generateBackground();assert.equal(reload.requests.length,2);assert.equal(reload.el('backgroundPreview').hidden,true);
 const same=session({outputs:[original.replace('image/png','image/jpeg'),original]});
 await same.ctx.generateBackground();assert.equal(same.requests.length,2);assert.equal(same.el('backgroundPreview').hidden,true);
});

test('late result after selecting another photo cannot reappear',async()=>{
 let resolve;
 const s=session({outputs:[()=>new Promise(r=>{resolve=r;})]});
 const pending=s.ctx.generateBackground();await Promise.resolve();await Promise.resolve();
 s.ctx.selectImage('another-original');resolve({ok:true,json:async()=>({image:fresh})});await pending;
 assert.equal(s.el('backgroundPreview').hidden,true);assert.equal(s.ctx.selectedImage,'another-original');
});

test('result is selected before saving completes; a late save does not override a new product',async()=>{
 const s=session({outputs:[fresh]});
 let finishSave,started;
 const saving=new Promise(resolve=>{started=resolve;});
 s.ctx.persistBrandImage=record=>new Promise(resolve=>{
   finishSave=()=>{s.ctx.brandImageRecords.push(record);resolve(record);};
   started();
 });
 const pending=s.ctx.generateBackground();
 await saving;
 assert.equal(s.ctx.selectedImage,fresh,'Canvas selection must not wait for storage');
 assert.equal(s.el('backgroundAccept').hidden,true);
 s.ctx.selectImage('another-product');
 finishSave();
 await pending;
 assert.equal(s.ctx.selectedImage,'another-product');
 assert.equal(s.el('backgroundPreview').hidden,true);
 assert.equal(s.el('backgroundAccept').hidden,true);
 assert.equal(s.el('backgroundError').textContent,'');
});

test('picker excludes saved AI and legacy mixed uploads on both initial load and refresh',()=>{
 const gallery={innerHTML:'',style:{},removeAttribute(key){delete this[key];}};
 const ctx=vm.createContext({activeStudioWorkflow:null,selectedImage:null,BRAND_IMAGES:{IMC:[original]},
   brandImageRecords:[{image:old,source:'ai-background',brand:'IMC'}],uploadedImages:[old],uploadedLibraryImages:{IMC:[old,original]},
   document:{getElementById:id=>id==='brand'?{value:'IMC'}:gallery,querySelectorAll:()=>[]},escapeHtml:s=>s,
   syncBackgroundImage(){},updateGalleryArrowVisibility(){}});
 vm.runInContext(page.slice(page.indexOf('let workspacePreviewSource ='),page.indexOf('function scrollGallery(')),ctx);
 ctx.renderImageGallery();assert.equal(ctx.selectedImage,original);assert.doesNotMatch(gallery.innerHTML,/b2xk|ai-image-badge/);
 ctx.selectedImage=old;ctx.renderImageGallery();assert.equal(ctx.selectedImage,old,'explicitly applied AI artwork remains usable by ads');
 assert.doesNotMatch(gallery.innerHTML,/b2xk/);
 ctx.backgroundAccepted=fresh;
 ctx.selectedImage=fresh;
 ctx.renderImageGallery();
 assert.equal(ctx.selectedImage,fresh,'A pending automatic save must not reset the selected result');
 ctx.BRAND_IMAGES.IMC=[];ctx.uploadedImages=[];ctx.uploadedLibraryImages={};
 ctx.renderImageGallery();
 assert.equal(ctx.selectedImage,fresh,'Automatic selection also survives an empty product collection');
});

test('server generation responses explicitly forbid caching',()=>{
 const server=fs.readFileSync('netlify/functions/generate-ai-image.cjs','utf8');
 assert.match(server,/'Cache-Control':'no-store, private'/);
 assert.match(server,/cache:'no-store'/);
});

test('duplicate retry sends two tracked provider requests with mocked storage and provider',async()=>{
 const usage=require('./netlify/lib/usage.cjs');
 const originalTracked=usage.trackedFetch,originalKey=process.env.GEMINI_API_KEY;
 const serverPath=require.resolve('./netlify/functions/generate-ai-image.cjs');
 const records=[];let providerCalls=0;
 usage.trackedFetch=usage.createTracker({storeFactory:()=>({async setJSON(key,value){records.push(value);}}),
   fetcher:async()=>{providerCalls++;return new Response(JSON.stringify({candidates:[{content:{parts:[{inlineData:{mimeType:'image/png',data:(providerCalls===1?old:fresh).split(',')[1]}}]}}]}));}}).trackedFetch;
 process.env.GEMINI_API_KEY='mock-only';delete require.cache[serverPath];
 try {
   const handler=require(serverPath).handler;
   const s=session({records:[{source:'ai-background',image:old}]});
   s.ctx.selectedImage='data:image/png;base64,iVBORw0KGgo=';s.ctx.syncBackgroundImage();s.el('backgroundDescription').value='Neutral background';
   s.ctx.fetch=async(url,options)=>{
     assert.match(url,/generate-ai-image\?requestId=/);
     const response=await handler({httpMethod:'POST',body:options.body});
     assert.equal(response.headers['Cache-Control'],'no-store, private');
     return new Response(response.body,{status:response.statusCode});
   };
   await s.ctx.generateBackground();
   assert.equal(providerCalls,2);assert.equal(records.length,4);
   assert.equal(usage.summarize(records).features['ai-background'].gemini.attempts,2);
   assert.equal(s.el('backgroundPreview').src,fresh);
 } finally {
   usage.trackedFetch=originalTracked;delete require.cache[serverPath];
   if(originalKey===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=originalKey;
 }
});
