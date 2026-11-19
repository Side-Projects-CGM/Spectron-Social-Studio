const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
const {build}=require('./demo/build.cjs');
const {createDemoState}=require('./netlify/lib/demo-state.cjs');
const {createDemoGateway}=require('./netlify/lib/demo-gateway.cjs');

function memoryStore(){
  const records=new Map();let version=0;
  return {records,async get(k){return structuredClone(records.get(k)?.data||null);},async getWithMetadata(k){return structuredClone(records.get(k)||null);},async setJSON(k,data,options={}){
    const old=records.get(k);if(options.onlyIfNew&&old||options.onlyIfMatch&&old?.etag!==options.onlyIfMatch)return {modified:false};
    records.set(k,{data:structuredClone(data),etag:String(++version)});return {modified:true};
  },async delete(k){records.delete(k);}};
}
const result=body=>({statusCode:200,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});

test('demo browser: empty/upload/generate/save/reset/isolation at desktop and mobile (all AI mocked)',{timeout:120000},async()=>{
  // Reuse an already installed browser-test dependency; never install dependencies in this test.
  const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/User/Documents/Oomagent/food-for-skin-studio/node_modules/@playwright/test');
  await build();
  const store=memoryStore(),calls=[],deleted=[];let gateway,origin;
  const server=http.createServer(async(req,res)=>{
    try{
      if(req.url.startsWith('/.netlify/functions/')){
        if(req.url!=='/.netlify/functions/demo-api'){res.writeHead(404);res.end();return;}
        const chunks=[];for await(const chunk of req)chunks.push(chunk);
        const response=await gateway(new Request(origin+req.url,{method:req.method,headers:req.headers,body:Buffer.concat(chunks),duplex:'half'}));
        res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
      }
      const name=new URL(req.url,origin).pathname==='/'?'index.html':new URL(req.url,origin).pathname.slice(1);
      if(!/^[\w.-]+$/.test(name)){res.writeHead(404);res.end();return;}
      const data=await fs.readFile(path.join(__dirname,'demo-dist',name));
      const type=name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.svg')?'image/svg+xml':'text/html';
      res.writeHead(200,{'Content-Type':type});res.end(data);
    }catch{res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;
  const state=createDemoState({store,password:'test-presenter-only',secret:'test-secret-only-not-for-deployment-12345',origin,removeInteraction:async id=>deleted.push(id)});
  let generatedImage;
  gateway=createDemoGateway({stateFactory:()=>state,handlers:{
    text:async event=>{calls.push('text');assert.ok(!event.body.includes('speelgoedleverancier'));return result({candidates:[{content:{parts:[{text:JSON.stringify({variants:Array.from({length:4},(_,i)=>({headline:`Klantvoorbeeld ${i+1}`,body:'Tekst uit de klantbriefing.',cta:'Ontdek meer',hashtags:['voorbeeld']}))})}]}}]});},
    image:async()=>{calls.push('image');return result({image:generatedImage});},
    video:async()=>{calls.push('video');return {...result({operation:`interactions/mock_${calls.length}`}),statusCode:202};},
    status:async()=>result({state:'completed',outputAvailable:false}),
    download:async()=>({statusCode:200,headers:{'Content-Type':'video/mp4'},body:Buffer.from('mock MP4 bytes')})
  }});
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    for(const width of [1280,390]){
      const context=await browser.newContext({viewport:{width,height:900}});
      await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.fulfill({status:200,contentType:'text/css',body:''}));
      const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(origin);await page.locator('#loginForm').waitFor({state:'visible'});
      await page.fill('#password','test-presenter-only');await page.locator('#loginForm button').click();
      await page.locator('iframe').waitFor();let frame=page.frameLocator('iframe');
      await frame.locator('#brand').waitFor();
      assert.equal(await frame.locator('#brand').inputValue(),'');
      assert.equal(await frame.locator('#aiVideoPrompt').inputValue(),'');
      assert.equal(await frame.locator('#imgGallery img').count(),0);
      assert.equal(await frame.locator('#savedCount').textContent(),'0');
      const id=await page.evaluate(()=>sessionStorage.getItem('studio-demo:workspace'));
      const data=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=160;c.height=120;const x=c.getContext('2d');x.fillStyle='#f00';x.fillRect(0,0,160,120);return c.toDataURL();});
      generatedImage=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=160;c.height=120;const x=c.getContext('2d');x.fillStyle='#00f';x.fillRect(0,0,160,120);return c.toDataURL();});
      await frame.locator('#brand').fill('Klant');await frame.locator('#brand').dispatchEvent('change');
      await frame.locator('#uploadInput').setInputFiles({name:'klant.png',mimeType:'image/png',buffer:Buffer.from(data.split(',')[1],'base64')});
      await frame.locator('#imgGallery img').first().waitFor();
      await frame.locator('#chooseAdvertisement').click();await frame.locator('#generateBtn').click();
      await frame.locator('.card').first().waitFor();
      assert.equal(await frame.locator('.card').count(),4);
      await frame.locator('.card').first().getByRole('button',{name:'Opslaan',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('iframe').contentDocument.querySelector('#savedCount').textContent==='1');
      await frame.locator('#backgroundButton').click();await frame.locator('#backgroundDescription').fill('Blauwe achtergrond');await frame.locator('#backgroundGenerate').click();
      await page.waitForFunction(()=>document.querySelector('iframe').contentDocument.querySelector('#backgroundStatus').textContent.includes('opgeslagen'));
      await frame.locator('#workflowBack').click();await frame.locator('#chooseVideo').click();await frame.locator('#aiVideoPrompt').fill('Toon het product met rustige beweging.');
      await frame.locator('#generateAIVideoBtn').click();await frame.locator('#aiVideoConfirmButton').click();
      await page.waitForFunction(()=>document.querySelector('iframe').contentWindow.eval('aiVideoOperation').startsWith('interactions/'));
      await page.locator('iframe').evaluate(el=>el.contentWindow.eval('pollAIVideo(aiVideoOperation)'));
      await page.waitForFunction(()=>!document.querySelector('iframe').contentWindow.eval('aiVideoRunning'));
      await page.reload();await page.locator('iframe').waitFor();frame=page.frameLocator('iframe');
      await page.waitForFunction(()=>document.querySelector('iframe').contentDocument.querySelector('#savedCount')?.textContent==='1');
      // Cancel must preserve all customer data.
      await page.locator('#resetDemo').click();await page.locator('#cancelReset').click();
      assert.equal(await frame.locator('#savedCount').textContent(),'1');
      // A second independent presenter/workspace must survive the first workspace's reset.
      const other=await browser.newContext();const otherPage=await other.newPage();
      await other.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.fulfill({status:200,contentType:'text/css',body:''}));
      await otherPage.goto(origin);await otherPage.fill('#password','test-presenter-only');await otherPage.locator('#loginForm button').click();await otherPage.locator('iframe').waitFor();
      const otherId=await otherPage.evaluate(()=>sessionStorage.getItem('studio-demo:workspace'));
      await page.locator('#resetDemo').click();await page.locator('#confirmReset').click();
      await page.waitForFunction(old=>sessionStorage.getItem('studio-demo:workspace')!==old,id);
      frame=page.frameLocator('iframe');await frame.locator('#brand').waitFor();
      assert.equal(await frame.locator('#brand').inputValue(),'');assert.equal(await frame.locator('#imgGallery img').count(),0);assert.equal(await frame.locator('#aiVideoPrompt').inputValue(),'');
      assert.equal(await frame.locator('#savedCount').textContent(),'0');
      assert.equal(await store.get(`workspaces/${id}`),null);assert.ok(await store.get(`workspaces/${otherId}`));
      assert.deepEqual(await page.evaluate(async old=>({keys:Object.keys(localStorage).filter(k=>k.startsWith(`studio-demo:${old}:`)),databases:(await indexedDB.databases()).filter(d=>d.name.startsWith(`studio-demo:${old}:`))}),id),{keys:[],databases:[]});
      const replay=await page.evaluate(async old=>{const r=await fetch('/.netlify/functions/demo-api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'check',workspace:old})});return r.status;},id);
      assert.equal(replay,404);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      assert.equal(await page.locator('iframe').evaluate(el=>el.contentDocument.documentElement.scrollWidth>el.contentWindow.innerWidth),false);
      assert.deepEqual(errors,[]);
      await other.close();await context.close();
    }
    assert.equal(deleted.length,2);assert.equal(calls.filter(c=>c==='text').length,2);assert.equal(calls.filter(c=>c==='image').length,2);assert.equal(calls.filter(c=>c==='video').length,2);
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
