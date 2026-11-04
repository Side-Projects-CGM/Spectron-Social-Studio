const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');

async function expectedRequest(page) {
  return page.evaluate(async () => {
    const aspectRatio = document.getElementById('aiVideoAspect').value;
    const image = await normalizeAIVideoImage(aspectRatio);
    const data = `data:${image.mimeType};base64,${image.data}`;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
    return {imageHash:[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join(''),
      prompt:document.getElementById('aiVideoPrompt').value.trim(),aspectRatio};
  });
}

async function runSelectedImageTests(browser, baseUrl = 'http://localhost:8890') {
  const results = [];
  for (const width of [1280,390]) {
    const context = await browser.newContext({viewport:{width,height:900}});
    const requests = [], reads = [], errors = [];
    // Never contact Google or any real generation endpoint in this regression test.
    await context.route('**/.netlify/functions/**', route => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/start-veo-video')) {
        const body = route.request().postDataJSON();
        requests.push({imageHash:createHash('sha256').update(body.image).digest('hex'),prompt:body.prompt,aspectRatio:body.aspectRatio});
        return route.fulfill({status:202,contentType:'application/json',body:JSON.stringify({operation:`interactions/mock-photo-${requests.length}`})});
      }
      if (url.pathname.endsWith('/veo-video-status')) {
        reads.push(url.searchParams.get('operation'));
        return route.fulfill({contentType:'application/json',body:JSON.stringify({state:'completed',outputAvailable:false,category:'output-unavailable'})});
      }
      return route.abort();
    });
    await context.route('https://generativelanguage.googleapis.com/**',route=>route.abort());
    const page = await context.newPage();
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error')errors.push('Browser console error');});
    async function generateCurrent() {
      const expected = await expectedRequest(page);
      const count = requests.length;
      await page.locator('#generateAIVideoBtn').click();
      assert.equal(await page.locator('#aiVideoConfirmModal').isVisible(),true,'Main button must confirm a new request, not resume an old one');
      assert.equal(requests.length,count);
      await page.locator('#aiVideoConfirmButton').click();
      await page.waitForFunction(count=>aiVideoRunning&&aiVideoOperation===`interactions/mock-photo-${count}`,count+1);
      assert.equal(requests.length,count+1);
      assert.deepEqual(requests.at(-1),expected,'Submitted data must match the currently selected photo, prompt and ratio');
      await page.evaluate(()=>pollAIVideo(aiVideoOperation));
      await page.waitForFunction(()=>!aiVideoRunning);
    }
    try {
      await page.goto(baseUrl,{waitUntil:'networkidle'});
      await page.selectOption('#brand','Bluey');
      await page.locator('#imgGallery .img-thumb').first().click();
      await page.locator('#chooseVideo').click();
      await generateCurrent();
      await page.locator('#workflowBack').click();
      await page.locator('#imgGallery .img-thumb').nth(1).click();
      await page.locator('#chooseVideo').click();
      const oldRecovery = await page.evaluate(()=>sessionStorage.getItem('spectron-ai-video-recovery'));
      const readCount = reads.length;
      await page.locator('#generateAIVideoBtn').click();
      assert.equal(await page.locator('#aiVideoConfirmModal').isVisible(),true);
      await page.locator('#aiVideoCancelButton').click();
      assert.equal(requests.length,1,'Cancel must not start photo B');
      assert.equal(reads.length,readCount,'Main Generate must not silently resume photo A');
      assert.equal(await page.evaluate(()=>sessionStorage.getItem('spectron-ai-video-recovery')),oldRecovery);
      await generateCurrent();
      assert.notEqual(requests[0].imageHash,requests[1].imageHash,'Changing the gallery photo changes the submitted image');
      await page.getByRole('button',{name:'Bestaande aanvraag controleren / Voorbeeld opnieuw laden',exact:true}).click();
      assert.equal(requests.length,2,'Explicit recovery remains GET-only');
      assert.equal(reads.at(-1),'interactions/mock-photo-2');
      await page.reload({waitUntil:'networkidle'});
      assert.equal(requests.length,2,'Refresh cannot submit a new generation');
      await page.getByRole('button',{name:'Bestaande aanvraag controleren / Voorbeeld opnieuw laden',exact:true}).click();
      assert.equal(requests.length,2,'Recovery after refresh still cannot submit a new generation');
      await page.selectOption('#brand','Bluey');
      const upload = await page.evaluate(()=>{
        const canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;
        const ctx=canvas.getContext('2d');ctx.fillStyle='#ff385c';ctx.fillRect(0,0,160,240);ctx.fillStyle='#245bff';ctx.fillRect(160,0,160,240);
        return canvas.toDataURL('image/png').split(',')[1];
      });
      await page.locator('#uploadInput').setInputFiles({name:'local-selected-product.png',mimeType:'image/png',buffer:Buffer.from(upload,'base64')});
      await page.waitForFunction(()=>selectedImage?.startsWith('data:image/png'));
      await page.locator('#chooseVideo').click();
      await page.locator('#aiVideoPrompt').fill('Animeer uitsluitend het geselecteerde product.');
      await page.locator('input[name="studioVideoFormat"][value="16:9"]').check();
      await generateCurrent();
      assert.notEqual(requests[2].imageHash,requests[1].imageHash,'An uploaded photo is not replaced by an old gallery photo');
      assert.equal(requests[2].aspectRatio,'16:9');
      assert.deepEqual(errors,[]);
      results.push(`${width}px: PASS gallery A→B, cancellation, GET-only recovery/refresh, uploaded photo, current prompt/ratio; all requests mocked`);
    } finally {await context.close();}
  }
  return results;
}

module.exports = runSelectedImageTests;
if (require.main === module) {
  (async()=>{
    const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
    const browser = await chromium.launch({headless:true,channel:process.env.TEST_BROWSER_CHANNEL || 'chrome'});
    try {console.log((await runSelectedImageTests(browser,process.env.TEST_BASE_URL)).join('\n'));}
    finally {await browser.close();}
  })().catch(error=>{console.error(error.message);process.exitCode=1;});
}
