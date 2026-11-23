const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

async function run(browser, baseUrl, {demo=false, artifacts}={}) {
  const reports=[];
  for (const width of [1280,390]) {
    const context=await browser.newContext({viewport:{width,height:900}});
    const requests=[],errors=[],badResponses=[];let textRequests=0;
    const origin=new URL(baseUrl).origin;
    await context.route('**/*',route=>{
      const request=route.request(),url=new URL(request.url());
      if(url.origin!==origin)return route.fulfill({status:200,contentType:'text/css',body:''});
      if(!url.pathname.startsWith('/.netlify/functions/'))return route.continue();
      const body=request.postDataJSON?.()||{};
      const action=demo?body.action:({'generate':'text','start-veo-video':'video','veo-video-status':'status'})[url.pathname.split('/').pop()];
      const json=value=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value)});
      if(action==='session')return json({authenticated:true});
      if(action==='create')return json({workspace:'11111111-1111-4111-8111-111111111111'});
      if(action==='check')return json({active:true});
      if(action==='reset')return json({complete:true});
      if(action==='text'){
        textRequests++;
        return json({candidates:[{content:{parts:[{text:JSON.stringify({variants:[{headline:'Mock advertentie',body:'Lokale test.',cta:'Ontdek meer',hashtags:[]}]})}]}}]});
      }
      if(action==='video'){
        requests.push(demo?body.input:body);
        return json({operation:'interactions/mock-references'});
      }
      if(action==='status')return json({state:'completed',outputAvailable:false});
      throw new Error('Unexpected API action in reference-box test');
    });
    const page=await context.newPage();page.setDefaultTimeout(12000);
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
    page.on('response',response=>{if(response.status()>=400)badResponses.push({status:response.status(),url:response.url()});});
    let studio;
    const screenshot=async name=>{if(artifacts){await fs.mkdir(artifacts,{recursive:true});await page.screenshot({path:path.join(artifacts,`${demo?'demo':'regular'}-${width}-${name}.png`),fullPage:true});}};
    const file=(source,name='reference.png')=>({name,mimeType:'image/png',buffer:Buffer.from(source.split(',')[1],'base64')});
    async function upload(slot,value,keyboard=false){
      const button=studio.locator(`#aiVideoReferenceUpload${slot-1}`);
      const picker=page.waitForEvent('filechooser');
      if(keyboard){await button.focus();assert.equal(await button.evaluate(el=>el===document.activeElement),true);await button.press('Enter');}
      else await button.click();
      await (await picker).setFiles(value);
    }
    async function sources(expected){
      await studio.waitForFunction(values=>{
        const thumbnails=[...document.querySelectorAll('#aiVideoReferenceList img')].map(img=>img.src);
        const canvas=[...document.querySelectorAll('#workspaceVideoImages img')];
        return JSON.stringify(thumbnails)===JSON.stringify(values)&&JSON.stringify(canvas.map(img=>img.src))===JSON.stringify(values)&&canvas.every(img=>img.complete&&img.naturalWidth>0)&&!document.getElementById('aiVideoReferenceInput').disabled;
      },expected);
      assert.equal(await studio.locator('#aiVideoReferenceList .video-reference-thumb').count(),3);
      assert.equal(await studio.locator('#workspaceVideoImages').isVisible(),true);
      assert.equal(await studio.locator('#workspaceProductImage').isVisible(),false);
      assert.equal(await studio.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    }
    try {
      await page.goto(baseUrl);
      studio=demo?await(await page.locator('iframe').elementHandle()).contentFrame():page.mainFrame();
      await studio.waitForLoadState('load');
      const photos=await studio.evaluate(()=>['#f06a35','#0099ff','#ff1493','#00a040','#333333'].map((color,i)=>{
        const canvas=document.createElement('canvas');canvas.width=i===1?120:320;canvas.height=i===1?240:120;
        const ctx=canvas.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,canvas.width,canvas.height);
        ctx.fillStyle='#ffffff';ctx.fillRect(0,0,12,canvas.height);return canvas.toDataURL('image/png');
      }));
      if(demo){await studio.locator('#brand').fill('Testklant');await studio.locator('#brand').dispatchEvent('change');}
      else await studio.locator('#brand').selectOption('Bluey');
      await studio.locator('#uploadInput').setInputFiles(file(photos[0],'selected.png'));
      await studio.waitForFunction(value=>selectedImage===value,photos[0]);
      await studio.locator('#chooseVideo').click();
      const defaultPrompt=await studio.locator('#aiVideoPrompt').inputValue();
      await sources([photos[0]]);
      const boxes=await studio.locator('.video-reference-box').evaluateAll(elements=>elements.map(el=>({y:el.getBoundingClientRect().y,width:el.getBoundingClientRect().width})));
      assert.equal(boxes.length,3);assert.ok(boxes.every(box=>Math.abs(box.y-boxes[0].y)<1&&box.width>60),'All three slots stay beside each other, including mobile');
      assert.equal(await studio.getByRole('button',{name:'Upload foto 2',exact:true}).count(),1);
      assert.equal(await studio.getByRole('button',{name:'Upload foto 3',exact:true}).count(),1);
      await screenshot('empty-slots');
      // Slot 3 can be filled first; slot numbers never shift when another is removed.
      await upload(3,file(photos[2]));await sources([photos[0],photos[2]]);
      await upload(2,file(photos[1]),true);await sources(photos.slice(0,3));
      assert.equal(await studio.evaluate(()=>selectedImage),photos[0]);
      const canvasLayout=await studio.locator('#workspaceVideoImages img').evaluateAll(images=>images.map(img=>({y:img.getBoundingClientRect().y,width:img.clientWidth,fit:getComputedStyle(img).objectFit})));
      assert.ok(canvasLayout.every(image=>image.fit==='contain'&&image.width>80));
      if(width===1280)assert.ok(canvasLayout.every(image=>Math.abs(image.y-canvasLayout[0].y)<1),'Desktop canvas displays all three together');
      else assert.ok(canvasLayout[2].y>canvasLayout[1].y&&canvasLayout[1].y>canvasLayout[0].y,'Mobile canvas stacks large previews, not tiny thumbnails');
      await screenshot('three-images');
      await upload(2,file(photos[3]));await sources([photos[0],photos[3],photos[2]]);await screenshot('replaced');
      await studio.getByRole('button',{name:'Verwijder referentiefoto 2',exact:true}).click();
      await sources([photos[0],photos[2]]);
      assert.equal(await studio.locator('[data-slot="3"] img').getAttribute('src'),photos[2]);
      const invalid=[
        [{name:'not-image.txt',mimeType:'text/plain',buffer:Buffer.from('text')},/JPEG/],
        [{name:'empty.png',mimeType:'image/png',buffer:Buffer.alloc(0)},/niet-lege/],
        [{name:'fake.png',mimeType:'image/png',buffer:Buffer.from('not a real PNG')},/leesbare/],
        [{name:'large.png',mimeType:'image/png',buffer:Buffer.alloc(4*1024*1024+1)},/4 MiB/]
      ];
      for(const [value,message] of invalid){
        await upload(2,value);await studio.locator('#aiVideoReferenceError').waitFor();
        assert.match(await studio.locator('#aiVideoReferenceError').textContent(),message);
        await sources([photos[0],photos[2]]);
      }
      const padded=Buffer.alloc(Math.ceil(2.1*1024*1024));file(photos[1]).buffer.copy(padded);
      await upload(2,{name:'padded.png',mimeType:'image/png',buffer:padded});
      await studio.waitForFunction(()=>document.querySelector('[data-slot="2"] img')&&!document.getElementById('aiVideoReferenceInput').disabled);
      const before=await studio.locator('[data-slot="2"] img').getAttribute('src');
      await upload(3,{name:'over-combined-cap.png',mimeType:'image/png',buffer:padded});
      await studio.locator('#aiVideoReferenceError').waitFor();assert.match(await studio.locator('#aiVideoReferenceError').textContent(),/4 MiB/);
      assert.equal(await studio.locator('[data-slot="2"] img').getAttribute('src'),before);
      assert.equal(await studio.locator('[data-slot="3"] img').getAttribute('src'),photos[2]);
      await upload(2,file(photos[1]));await sources(photos.slice(0,3));
      assert.equal(requests.length,0,'Uploads/replacements never start generation');
      assert.equal(await studio.locator('#aiVideoPrompt').inputValue(),defaultPrompt);
      // References survive navigation, but never replace the ad photo or its cached result.
      await studio.locator('#workflowBack').click();await studio.locator('#chooseAdvertisement').click();
      assert.equal(await studio.locator('#workspaceVideoImages').isVisible(),false);
      assert.equal(await studio.locator('#workspaceProductImage').isVisible(),true);
      assert.equal(await studio.locator('#workspaceProductImage').getAttribute('src'),photos[0]);
      await studio.locator('#generateBtn').click();await studio.locator('#resultsArea .card').first().waitFor();
      const ad=await studio.locator('#resultsArea').innerHTML();
      await studio.locator('#workflowBack').click();await studio.locator('#chooseVideo').click();await sources(photos.slice(0,3));
      await studio.locator('#workflowBack').click();await studio.locator('#chooseAdvertisement').click();
      assert.equal(await studio.locator('#resultsArea').innerHTML(),ad);assert.equal(textRequests,1);
      await studio.locator('#workflowBack').click();await studio.locator('#chooseVideo').click();
      await studio.locator('#aiVideoPrompt').fill(defaultPrompt||'Een lokale mock video.');
      await studio.locator('input[name="studioVideoFormat"][value="16:9"]').check();
      await studio.locator('#generateAIVideoBtn').click();await studio.locator('#aiVideoCancelButton').click();
      assert.equal(requests.length,0,'Cancel sends no paid request');
      await studio.locator('#generateAIVideoBtn').click();await studio.locator('#aiVideoConfirmButton').click();
      await studio.waitForFunction(()=>aiVideoRunning&&aiVideoOperation==='interactions/mock-references');
      assert.equal(requests.length,1);assert.deepEqual(requests[0].images,photos.slice(0,3),'Original bytes and slot ordering are submitted, without canvas cropping');
      assert.equal(requests[0].prompt,defaultPrompt||'Een lokale mock video.');assert.equal(requests[0].aspectRatio,'16:9');
      assert.equal(await studio.locator('#aiVideoReferenceInput').isDisabled(),true);
      assert.equal(await studio.locator('#aiVideoReferenceUpload1').isDisabled(),true);
      assert.equal(await studio.locator('#aiVideoReferenceUpload2').isDisabled(),true);
      await studio.evaluate(()=>pollAIVideo(aiVideoOperation));await studio.waitForFunction(()=>!aiVideoRunning);
      await upload(2,file(photos[3]));await sources([photos[0],photos[3],photos[2]]);
      assert.equal(await studio.locator('#workspaceOutput').isVisible(),false,'Replacing a photo reveals the canvas after a prior result/error');
      // Slow image decoding cannot attach an old product reference to a new selection.
      await studio.evaluate(()=>{
        window.originalBitmap=createImageBitmap;
        window.createImageBitmap=async blob=>{const bitmap=await window.originalBitmap(blob);if(!window.releaseReferenceBitmap)await new Promise(resolve=>{window.releaseReferenceBitmap=resolve;});return bitmap;};
      });
      await upload(2,file(photos[1]));await studio.waitForFunction(()=>typeof window.releaseReferenceBitmap==='function');
      assert.equal(await studio.locator('#aiVideoReferenceUpload2').isDisabled(),true);
      await studio.locator('#uploadInput').setInputFiles(file(photos[4],'new-product.png'));
      await studio.waitForFunction(value=>selectedImage===value,photos[4]);
      await studio.evaluate(()=>{window.createImageBitmap=window.originalBitmap;window.releaseReferenceBitmap();});
      await sources([photos[4]]);
      assert.equal(await studio.getByRole('button',{name:'Upload foto 2',exact:true}).count(),1);
      assert.equal(await studio.getByRole('button',{name:'Upload foto 3',exact:true}).count(),1);
      assert.equal(requests.length,1);await screenshot('new-product');
      if(demo){
        await page.locator('#resetDemo').click();await page.locator('#confirmReset').click();
        await page.waitForFunction(()=>document.querySelector('iframe')?.contentDocument?.getElementById('brand')?.value==='');
        studio=await(await page.locator('iframe').elementHandle()).contentFrame();await studio.waitForLoadState('load');
        assert.equal(await studio.locator('#aiVideoReferenceList img').count(),0);
        await studio.locator('#uploadInput').setInputFiles(file(photos[0]));await studio.waitForFunction(value=>selectedImage===value,photos[0]);
        await studio.locator('#chooseVideo').click();await sources([photos[0]]);
      }
      assert.deepEqual(errors,[]);assert.deepEqual(badResponses,[]);
      reports.push({mode:demo?'demo':'regular',width,status:'PASS',requests:requests.length,textRequests,errors,badResponses});
      console.log(`${demo?'demo':'regular'} ${width}px: PASS three fixed slots, keyboard upload, full canvas previews, replace/remove, 4 MiB validation, ad isolation/cache, paid confirmation, request bytes, decoding race${demo?', reset':''}; all APIs mocked`);
    }catch(error){await screenshot('FAIL');throw error;}
    finally{await context.close();}
  }
  return reports;
}
module.exports=run;
if(require.main===module){
  (async()=>{
    const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
    const browser=await chromium.launch({headless:true,channel:process.env.TEST_BROWSER_CHANNEL||'chrome'});
    try{await run(browser,process.env.TEST_BASE_URL||'http://127.0.0.1:8892');}
    finally{await browser.close();}
  })().catch(error=>{console.error(error.message);process.exitCode=1;});
}
