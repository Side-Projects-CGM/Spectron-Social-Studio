const assert = require('node:assert/strict');

async function run(browser, baseUrl) {
  for (const width of [1280,390]) {
    const context = await browser.newContext({viewport:{width,height:900}});
    const requests = [], errors = [];
    await context.route('**/.netlify/functions/**', route => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/start-veo-video')) {
        requests.push(route.request().postDataJSON());
        return route.fulfill({status:202,contentType:'application/json',body:JSON.stringify({operation:'interactions/mock-references'})});
      }
      if (url.pathname.endsWith('/veo-video-status')) return route.fulfill({contentType:'application/json',body:JSON.stringify({state:'completed',outputAvailable:false})});
      return route.abort();
    });
    const page = await context.newPage();
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
    try {
      await page.goto(baseUrl,{waitUntil:'networkidle'});
      await page.selectOption('#brand','Bluey');
      await page.locator('#imgGallery .img-thumb').first().click();
      await page.locator('#chooseVideo').click();
      const selected = await page.evaluate(()=>selectedImage);
      const defaultPrompt = await page.locator('#aiVideoPrompt').inputValue();
      assert.equal(await page.locator('#aiVideoReferenceList img').count(),1);
      const photos = await page.evaluate(()=>[0,1].map(i=>{
        const canvas=document.createElement('canvas');canvas.width=240;canvas.height=90;
        const ctx=canvas.getContext('2d');ctx.fillStyle=i?'#ff1493':'#00aaff';ctx.fillRect(0,0,240,90);
        ctx.fillStyle='#00ff00';ctx.fillRect(0,0,15,90);ctx.fillStyle='#ff0000';ctx.fillRect(225,0,15,90);
        return canvas.toDataURL('image/png');
      }));
      const file=(source,index)=>({name:`reference-${index}.png`,mimeType:'image/png',buffer:Buffer.from(source.split(',')[1],'base64')});
      const add=page.getByRole('button',{name:"Referentiefoto's toevoegen",exact:true});
      await add.focus();
      assert.equal(await add.evaluate(el=>el===document.activeElement),true,'Reference upload is keyboard-accessible');
      const [picker]=await Promise.all([page.waitForEvent('filechooser'),add.press('Enter')]);
      await picker.setFiles(photos.map(file));
      const input=page.locator('#aiVideoReferenceInput');
      await page.waitForFunction(()=>document.querySelectorAll('#aiVideoReferenceList img').length===3);
      assert.equal(await page.evaluate(()=>selectedImage),selected,'References cannot replace the brand/ads photo');
      await input.setInputFiles(file(photos[0],3));
      await page.waitForFunction(()=>document.getElementById('aiVideoReferenceError').textContent.includes('maximaal 3'));
      assert.equal(await page.locator('#aiVideoReferenceList img').count(),3);
      await page.getByRole('button',{name:'Verwijder referentiefoto 3',exact:true}).click();
      await input.setInputFiles({name:'not-a-photo.txt',mimeType:'text/plain',buffer:Buffer.from('not an image')});
      await page.waitForFunction(()=>document.getElementById('aiVideoReferenceError').textContent.includes('JPEG'));
      const tooLarge=Buffer.alloc(4*1024*1024+1);
      await input.setInputFiles({name:'too-large.png',mimeType:'image/png',buffer:tooLarge});
      await page.waitForFunction(()=>document.getElementById('aiVideoReferenceError').textContent.includes('4 MiB'));
      await input.setInputFiles({name:'spoofed.png',mimeType:'image/png',buffer:Buffer.from('not really png')});
      await page.waitForFunction(()=>document.getElementById('aiVideoReferenceError').textContent.includes('leesbare'));
      await input.setInputFiles(file(photos[1],2));
      await page.waitForFunction(()=>document.querySelectorAll('#aiVideoReferenceList img').length===3);
      assert.equal(await page.locator('#aiVideoPrompt').inputValue(),defaultPrompt,'Default textbox prompt is unchanged');
      await page.locator('input[name="studioVideoFormat"][value="16:9"]').check();
      const expected=await page.locator('#aiVideoReferenceList img').evaluateAll(images=>images.map(image=>image.src));
      assert.deepEqual(expected,[selected,...photos]);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await page.locator('#generateAIVideoBtn').click();
      await page.locator('#aiVideoCancelButton').click();
      assert.equal(requests.length,0,'Cancellation sends no paid request');
      await page.locator('#generateAIVideoBtn').click();
      await page.locator('#aiVideoConfirmButton').click();
      await page.waitForFunction(()=>aiVideoRunning&&aiVideoOperation==='interactions/mock-references');
      assert.equal(requests.length,1);
      assert.equal(await input.isDisabled(),true,'References are locked during generation');
      assert.equal(await add.isDisabled(),true);
      assert.deepEqual(requests[0].images,expected,'Full original image bytes and ordering are preserved');
      assert.equal(requests[0].prompt,defaultPrompt);
      assert.equal(requests[0].aspectRatio,'16:9');
      await page.evaluate(()=>pollAIVideo(aiVideoOperation));
      await page.waitForFunction(()=>!aiVideoRunning);
      for(let i=3;i>0;i--)await page.getByRole('button',{name:'Verwijder referentiefoto 1',exact:true}).click();
      await page.locator('#generateAIVideoBtn').click();
      assert.equal(await page.locator('#aiVideoConfirmModal').isVisible(),false);
      assert.match(await page.locator('#aiVideoReferenceError').textContent(),/minstens één/);
      assert.equal(requests.length,1,'Empty selection never submits');
      await page.locator('#workflowBack').click();
      await page.selectOption('#brand','Stitch');
      await page.locator('#imgGallery .img-thumb').first().click();
      await page.locator('#chooseVideo').click();
      assert.equal(await page.locator('#aiVideoReferenceList img').count(),1,'Changing product resets video-only references');
      assert.deepEqual(errors,[]);
      console.log(`${width}px: PASS reference upload/remove, limits, full image bytes, unchanged prompt/ads photo; all requests mocked`);
    } finally {await context.close();}
  }
}
module.exports = run;
if(require.main===module) {
  (async()=>{
    const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
    const browser=await chromium.launch({headless:true,channel:process.env.TEST_BROWSER_CHANNEL||'chrome'});
    try {await run(browser,process.env.TEST_BASE_URL||'http://127.0.0.1:8892');}
    finally {await browser.close();}
  })().catch(error=>{console.error(error.message);process.exitCode=1;});
}
