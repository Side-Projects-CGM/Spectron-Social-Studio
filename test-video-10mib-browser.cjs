const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {build}=require('./demo/build.cjs');
const {localStore}=require('./demo/local.cjs');
const {createDemoState}=require('./netlify/lib/demo-state.cjs');
const {createDemoGateway}=require('./netlify/lib/demo-gateway.cjs');
const {createReferenceUploads,uploadRequest,UPLOAD_SERVICE,UPLOAD_OWNER}=require('./netlify/lib/video-reference-uploads.cjs');
const usage=require('./netlify/lib/usage.cjs');
const ROOT=__dirname,ARTIFACTS=path.join(ROOT,'artifacts/video-10mib');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

async function serveMockPreview({port=0,autoLogin=false}={}){
  const output=path.join(ARTIFACTS,'site');await build(output);
  const store=localStore(),stats={requests:[],providerCalls:0,hashes:[]},control={failure:'none',parts:0};
  const previousTracker=usage.trackedFetch,previousKey=process.env.GOOGLE_DEVELOPER_API_KEY;
  // Every paid provider request is replaced server-side, including accidental ones.
  usage.trackedFetch=async(event,details,url,options)=>{
    stats.providerCalls++;const body=JSON.parse(options.body);
    stats.hashes=body.input.filter(item=>item.type==='image').map(image=>digest(Buffer.from(image.data,'base64')));
    return Response.json({id:`mock-large-${stats.providerCalls}`});
  };
  process.env.GOOGLE_DEVELOPER_API_KEY='mock-local-reference-test';
  // Read the mocked tracker when the provider wrapper is loaded.
  delete require.cache[require.resolve('./netlify/lib/omni-video.cjs')];
  delete require.cache[require.resolve('./netlify/functions/start-veo-test.cjs')];
  delete require.cache[require.resolve('./netlify/functions/start-veo-video.cjs')];
  const start=require('./netlify/functions/start-veo-video.cjs').handler;
  const regular=createReferenceUploads({store,environment:'browser-test',client:'loopback-test'});
  let state,gateway,origin;
  const factory=event=>createReferenceUploads({store,environment:'browser-test',owner:event[UPLOAD_OWNER]});
  const failedStatus=()=>({statusCode:200,headers:{'Content-Type':'application/json'},body:JSON.stringify({state:'failed',message:'Lokale mock gestopt. Geen betaalde aanvraag.'})});
  const server=http.createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,origin||'http://127.0.0.1');
      if(url.pathname.startsWith('/.netlify/functions/')){
        let bytes=0;const chunks=[];
        for await(const chunk of req){bytes+=chunk.length;if(bytes>6_000_000){res.writeHead(413,{'Content-Type':'application/json'});res.end('{"error":"Netlify request boundary exceeded"}');return;}chunks.push(chunk);}
        const body=Buffer.concat(chunks).toString(),input=body?JSON.parse(body):{};
        const demo=url.pathname.endsWith('/demo-api');
        const action=demo?input.action:url.pathname.endsWith('/video-reference-upload')?'references':url.pathname.endsWith('/start-veo-video')?'video':'status';
        const payload=demo?input.input:input;
        stats.requests.push({bytes,action,subaction:action==='references'?payload?.action:undefined});
        if(action==='references'&&payload?.action==='chunk'){
          control.parts++;
          if(control.failure==='chunk'&&control.parts===2){res.writeHead(503,{'Content-Type':'application/json'});res.end('{"error":"Mock interrupted upload"}');return;}
        }
        if(action==='video'&&payload?.upload&&control.failure==='consume')await (demo?factory({[UPLOAD_OWNER]:{owner:state.authenticate({headers:req.headers}).owner,workspace:input.workspace}}):regular).remove(payload.upload);
        if(demo){
          if(autoLogin&&action==='session'){
            const cookie=await state.login({headers:req.headers},'mock-preview-password');
            res.writeHead(200,{'Content-Type':'application/json','Set-Cookie':cookie,'Cache-Control':'no-store'});res.end('{"authenticated":true}');return;
          }
          const result=await gateway(new Request(url,{method:req.method,headers:req.headers,...(req.method!=='GET'?{body,duplex:'half'}:{})}));
          res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));return;
        }
        const event={httpMethod:req.method,headers:req.headers,body,queryStringParameters:Object.fromEntries(url.searchParams),[UPLOAD_SERVICE]:regular};
        const result=action==='references'?await uploadRequest(event):action==='video'?await start(event):failedStatus();
        res.writeHead(result.statusCode,result.headers);res.end(result.body);return;
      }
      const demo=url.pathname.startsWith('/demo/'),base=demo?output:ROOT;
      const name=demo?(url.pathname.slice(6)||'index.html'):(url.pathname.slice(1)||'spectron-social-studio.html');
      const file=path.resolve(base,name),ext=path.extname(file);
      if(!file.startsWith(base+path.sep)||!['.html','.js','.css','.svg','.png','.jpg','.jpeg','.webp'].includes(ext)){res.writeHead(404);res.end();return;}
      const data=await fs.readFile(file);
      res.writeHead(200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'}[ext],'Cache-Control':'no-store'});res.end(data);
    }catch{if(!res.headersSent)res.writeHead(503,{'Content-Type':'application/json'});res.end('{"error":"Local mock preview failed"}');}
  });
  await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;
  state=createDemoState({store,password:'mock-preview-password',secret:'mock-preview-cookie-secret-not-for-production',origin,removeInteraction:async()=>{}});
  gateway=createDemoGateway({stateFactory:()=>state,uploadFactory:factory,handlers:{video:start,status:failedStatus}});
  async function pending(){let count=0;for await(const page of store.list())count+=page.blobs.filter(blob=>!blob.key.includes('/rate/')&&blob.key.startsWith('v1/')&&!blob.key.endsWith('/claimed')).length;return count;}
  return {origin,stats,control,pending,close:async()=>{await new Promise(resolve=>server.close(resolve));usage.trackedFetch=previousTracker;if(previousKey===undefined)delete process.env.GOOGLE_DEVELOPER_API_KEY;else process.env.GOOGLE_DEVELOPER_API_KEY=previousKey;}};
}
module.exports={serveMockPreview};

if(require.main===module&&process.argv.includes('--serve')){
  serveMockPreview({port:8893,autoLogin:true}).then(({origin})=>console.log(`MOCK ONLY: ${origin}/ and ${origin}/demo/ ; no paid calls or real cloud storage`)).catch(()=>{console.error('Mock preview could not start.');process.exitCode=1;});
}else test('10 MiB originals survive real chunk HTTP boundaries, regular/demo desktop/mobile; failures never start Google',{timeout:240000},async t=>{
  const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/User/Documents/Oomagent/food-for-skin-studio/node_modules/@playwright/test');
  const harness=await serveMockPreview(),browser=await chromium.launch({channel:'chrome'}),reports=[];
  try{
    for(const demo of [false,true])for(const width of [1280,390])await t.test(`${demo?'demo':'regular'} ${width}px`,async()=>{
      const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),errors=[],failed=[];
      page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
      page.on('console',message=>{if(message.type()==='error'&&!message.text().includes('503')&&!message.text().includes('404'))errors.push(message.text());});
      page.on('response',r=>{if(r.status()>=400)failed.push(r.status());});
      await context.route('**/*',route=>new URL(route.request().url()).origin===harness.origin?route.continue():route.fulfill({status:200,contentType:'text/css',body:''}));
      harness.control.failure='none';harness.control.parts=0;
      const beforeCalls=harness.stats.providerCalls,beforeRequests=harness.stats.requests.length;
      try{
        await page.goto(harness.origin+(demo?'/demo/':'/'));
        if(demo){await page.locator('#loginForm').waitFor();await page.locator('#password').fill('mock-preview-password');await page.locator('#loginForm button').click();}
        const studio=demo?await(await page.locator('iframe').elementHandle()).contentFrame():page.mainFrame();
        await studio.waitForLoadState('load');
        if(demo){await studio.locator('#brand').fill('Lokale 10 MiB test');await studio.locator('#brand').dispatchEvent('change');}
        else await studio.locator('#brand').selectOption('Bluey');
        const small=await studio.evaluate(()=>['orange','blue','pink'].map(color=>{const c=document.createElement('canvas');c.width=160;c.height=120;const x=c.getContext('2d');x.fillStyle=color;x.fillRect(0,0,160,120);return c.toDataURL().split(',')[1];}));
        const files=small.map((data,index)=>{const bytes=Buffer.alloc((index===2?2:4)*1024*1024);Buffer.from(data,'base64').copy(bytes);return {name:`original-${index}.png`,mimeType:'image/png',buffer:bytes};});
        await studio.locator('#uploadInput').setInputFiles(files[0]);await studio.waitForFunction(()=>selectedImage?.startsWith('data:'));
        await studio.locator('#chooseVideo').click();
        for(const slot of [1,2]){
          const chooser=page.waitForEvent('filechooser');await studio.locator(`#aiVideoReferenceUpload${slot}`).click();await(await chooser).setFiles(files[slot]);
          await studio.waitForFunction(count=>document.querySelectorAll('#aiVideoReferenceList img').length===count&&!document.getElementById('aiVideoReferenceInput').disabled,slot+1);
        }
        await studio.locator('#aiVideoPrompt').fill('Een lokale mock video met drie volledige referentiefoto’s.');
        assert.match(await studio.locator('.video-reference-help').last().textContent(),/10 MiB/);
        const afterSetup=harness.stats.requests.length;
        await studio.locator('#generateAIVideoBtn').click();await studio.locator('#aiVideoCancelButton').click();
        assert.equal(harness.stats.requests.length,afterSetup,'Cancel uploads no bytes and starts no video');
        await studio.locator('#generateAIVideoBtn').click();await studio.locator('#aiVideoConfirmButton').click();
        await studio.waitForFunction(()=>aiVideoOperation.startsWith('interactions/mock-large-'));
        assert.equal(harness.stats.providerCalls,beforeCalls+1);assert.deepEqual(harness.stats.hashes,files.map(file=>digest(file.buffer)));
        assert.equal(await harness.pending(),0,'Server removes original chunks immediately after start');
        const sent=harness.stats.requests.slice(beforeRequests),chunkRequests=sent.filter(request=>request.subaction==='chunk');
        assert.equal(chunkRequests.length,10);assert.ok(sent.every(request=>request.bytes<2*1024*1024));
        assert.ok(sent.filter(request=>request.action==='video').every(request=>request.bytes<2000));
        await page.screenshot({path:path.join(ARTIFACTS,`${demo?'demo':'regular'}-${width}-10mib-started.png`),fullPage:true});
        await studio.evaluate(()=>pollAIVideo(aiVideoOperation));await studio.waitForFunction(()=>!aiVideoRunning);
        // A partial upload failure cleans up, removes the loader, and cannot reach the paid start.
        harness.control.failure='chunk';harness.control.parts=0;
        await studio.locator('#generateAIVideoBtn').click();await studio.locator('#aiVideoConfirmButton').click();
        await studio.waitForFunction(()=>!aiVideoRunning&&document.getElementById('outputMeta').textContent==='AI-video — controleer je invoer');
        assert.equal(harness.stats.providerCalls,beforeCalls+1);assert.equal(await harness.pending(),0);
        assert.equal(await studio.locator('.studio-progress-overlay').count(),0);
        assert.equal(await studio.locator('#aiVideoReferenceInput').isDisabled(),false);
        assert.equal(await studio.evaluate(()=>aiVideoMayHaveStarted),false);
        // A missing batch at final submission is a proven pre-provider rejection, not an unknown paid start.
        harness.control.failure='consume';harness.control.parts=0;
        await studio.locator('#generateAIVideoBtn').click();await studio.locator('#aiVideoConfirmButton').click();
        await studio.waitForFunction(()=>!aiVideoRunning&&document.getElementById('outputMeta').textContent==='AI-video — controleer je invoer');
        assert.match(await studio.locator('#resultsArea').innerText(),/geen nieuwe video gestart/);
        assert.equal(await studio.evaluate(()=>aiVideoMayHaveStarted),false);assert.equal(harness.stats.providerCalls,beforeCalls+1);
        assert.equal(await harness.pending(),0);assert.equal(await studio.locator('.studio-progress-overlay').count(),0);
        assert.equal(await studio.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
        assert.deepEqual(errors,[]);assert.deepEqual(failed,[503,404]);
        reports.push({mode:demo?'demo':'regular',width,status:'PASS',originalBytes:10*1024*1024,chunkRequests:chunkRequests.length,maxRequestBytes:Math.max(...sent.map(request=>request.bytes)),providerCalls:1,expectedFailures:failed});
      }finally{await context.close();}
    });
  }finally{await browser.close();await harness.close();await fs.writeFile(path.join(ARTIFACTS,'report.json'),JSON.stringify(reports,null,2));}
});
