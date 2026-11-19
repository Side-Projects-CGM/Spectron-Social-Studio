const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {serve}=require('./demo/local.cjs');
const ARTIFACTS=path.join(__dirname,'artifacts/demo-ticket');

test('Cees ticket in order: empty, client material, reset, reuse — desktop and mobile, mock AI only',{timeout:240000},async t=>{
  const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/User/Documents/Oomagent/food-for-skin-studio/node_modules/@playwright/test');
  await fs.mkdir(ARTIFACTS,{recursive:true});
  const server=await serve({port:8892,password:'ticket-mock-presenter'});
  const originalFetch=global.fetch;
  global.fetch=async()=>{throw new Error('No server network or paid calls allowed in this suite');};
  const browser=await chromium.launch({channel:'chrome',headless:true});
  const report=[];
  try{
    for(const width of [1280,390]) await t.test(`${width}px`,async t=>{
      const context=await browser.newContext({viewport:{width,height:900},acceptDownloads:true});
      const origin='http://127.0.0.1:8892';
      // No AI networking. Allow only the regular Studio's existing html2canvas CDN dependency for REAL PNG exports.
      await context.route('**/*',route=>{
        const request=route.request();const url=new URL(request.url());
        if(url.origin===origin)return route.continue();
        if(request.method()==='GET'&&url.href==='https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js')return route.continue();
        return route.fulfill({status:200,contentType:'text/css',body:''});
      });
      const page=await context.newPage();page.setDefaultTimeout(10000);
      const errors=[],network=[];let frame,oldWorkspace,firstImage,secondImage;
      page.on('pageerror',e=>errors.push(e.message));
      page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
      page.on('response',r=>{if(r.status()>=400)network.push({path:new URL(r.url()).pathname,status:r.status()});});
      const screenshot=async name=>{
        const file=path.join(ARTIFACTS,`${width}-${name}.png`);
        await page.screenshot({path:file,fullPage:true});return path.relative(__dirname,file);
      };
      const state=()=>page.locator('iframe').evaluate(el=>({
        photo:el.contentWindow.eval('selectedImage'),uploads:el.contentWindow.eval('uploadedImages.length'),
        saved:el.contentDocument.querySelector('#savedCount').textContent,
        name:el.contentDocument.querySelector('#brand').value,
        prompt:el.contentDocument.querySelector('#aiVideoPrompt').value
      }));
      async function step(number,name,run){
        const before=errors.length;
        await t.test(`${number} ${name}`,async()=>{
          try{
            await run();assert.deepEqual(errors.slice(before),[],`${name}: browser errors`);
            assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Presenter horizontal overflow');
            assert.equal(await page.locator('iframe').evaluate(el=>el.contentDocument.documentElement.scrollWidth>el.contentWindow.innerWidth),false,'Studio horizontal overflow');
            report.push({width,test:number,status:'PASS',screenshot:await screenshot(`test-${number}`),consoleErrors:errors.slice(before)});
          }catch(error){report.push({width,test:number,status:'FAIL',error:error.message,screenshot:await screenshot(`test-${number}-FAIL`),consoleErrors:errors.slice(before)});throw error;}
        });
      }
      async function upload(data,name){
        await frame.locator('#uploadInput').setInputFiles({name,mimeType:'image/png',buffer:Buffer.from(data.split(',')[1],'base64')});
      }
      async function waitSaved(count){await page.waitForFunction(count=>document.querySelector('iframe')?.contentDocument?.querySelector('#savedCount')?.textContent===String(count),count);}
      async function checkEmpty(){
        frame=page.frameLocator('iframe');await frame.locator('#brand').waitFor();
        const current=await state();assert.equal(current.name,'');assert.equal(current.photo,null);assert.equal(current.uploads,0);assert.equal(current.saved,'0');assert.equal(current.prompt,'');
        assert.equal(await frame.locator('#imgGallery img').count(),0);assert.equal(await frame.locator('video').count(),0);
        assert.equal(await frame.locator('#resultsArea .card').count(),0);
        const text=await frame.locator('body').innerText();assert.doesNotMatch(text,/Spectron|ToyToyz|Food for Skin|speelgoed|leerzaam spelen|EN71|baby- en kinderproducten/i);
        for(const input of await frame.locator('input[type="text"],textarea').all())assert.equal(await input.inputValue(),'');
        assert.equal(await frame.locator('img[src*="branding"],img[src*="spectron"],img[src*="toytous"]').count(),0);
      }
      async function reset(){
        await page.locator('#resetDemo').click();await page.locator('#confirmReset').click();
        await page.waitForFunction(old=>sessionStorage.getItem('studio-demo:workspace')!==old,oldWorkspace);
        await checkEmpty();
      }
      try{
        await step(1,'Empty demo',async()=>{
          await page.goto(origin);await page.fill('#password','ticket-mock-presenter');await page.locator('#loginForm button').click();await checkEmpty();
          [firstImage,secondImage]=await page.evaluate(()=>['#e95b38','#206a9e'].map(color=>{const c=document.createElement('canvas');c.width=320;c.height=240;const x=c.getContext('2d');x.fillStyle=color;x.fillRect(0,0,320,240);x.fillStyle='#fff';x.fillRect(60,40,120,160);return c.toDataURL();}));
        });
        await step(2,'Client images, selection, client copy, background, save, editing, duplication and exports',async()=>{
          oldWorkspace=await page.evaluate(()=>sessionStorage.getItem('studio-demo:workspace'));
          await upload(firstImage,'client-one.png');await page.waitForFunction(()=>document.querySelector('iframe').contentWindow.eval('uploadedImages.length')===1);
          await upload(secondImage,'client-two.png');await page.waitForFunction(()=>document.querySelector('iframe').contentWindow.eval('uploadedImages.length')===2);
          assert.equal(await frame.locator('#imgGallery .img-thumb').count(),2);
          // Real pointer clicks on BOTH images; never force or call selectImage directly.
          await frame.locator('#imgGallery .img-thumb').nth(1).click();assert.equal((await state()).photo,firstImage);
          await frame.locator('#imgGallery .img-thumb').nth(0).click();assert.equal((await state()).photo,secondImage);
          await frame.locator('#imgGallery .img-thumb').nth(1).click();assert.equal((await state()).photo,firstImage);
          await screenshot('test-2-selected-upload');
          await frame.locator('#brand').fill('Atelier Eerste Klant');await frame.locator('#brand').press('Tab');
          assert.equal((await state()).photo,firstImage,'Typing client name must preserve the chosen image, not silently pick the newest upload');
          await frame.locator('#chooseAdvertisement').click();await frame.locator('#generateBtn').click();await frame.locator('.card').first().waitFor();
          assert.match(await frame.locator('.editable[data-field="body"]').first().innerText(),/Atelier Eerste Klant/,'Client name must appear in generated mock ad text');
          const headline=frame.locator('.editable[data-field="headline"]').first();await headline.fill('Eerste klant aangepaste kop');
          await frame.locator('.card').first().getByRole('button',{name:'Opslaan',exact:true}).click();await waitSaved(1);
          await frame.locator('.card').first().getByRole('button',{name:'Dupliceren',exact:true}).click();
          await frame.locator('#duplicateChoices input').nth(0).check();await frame.locator('#duplicateChoices input').nth(1).check();await frame.locator('#confirmDuplicate').click();await waitSaved(3);
          await frame.locator('#backgroundButton').click();await frame.locator('#backgroundDescription').fill('Een neutrale lichte achtergrond');await frame.locator('#backgroundGenerate').click();
          await page.waitForFunction(()=>document.querySelector('iframe').contentDocument.querySelector('#backgroundStatus').textContent.includes('opgeslagen'));
          assert.notEqual((await state()).photo,firstImage);
          // Refresh/reopen must retain edited copy and the saved design's original image.
          await page.reload();frame=page.frameLocator('iframe');await waitSaved(3);
          // The saved library must be reachable WITHOUT another upload or generation after refresh.
          await frame.locator('#savedLibraryToggle').click();
          await frame.locator('.saved-ad').filter({hasText:'Eerste klant aangepaste kop'}).first().getByRole('button',{name:'Openen en bewerken'}).click();
          assert.equal(await frame.locator('.editable[data-field="headline"]').first().innerText(),'Eerste klant aangepaste kop');
          assert.equal((await state()).photo,firstImage,'Reopening must restore the original selected upload');
          // Exports run through the visible controls and browser download events.
          await frame.locator('.card .download-menu summary').first().click();
          const textDownload=page.waitForEvent('download');page.once('dialog',dialog=>dialog.accept('klant-tekst'));
          await frame.getByRole('button',{name:'Tekst (.txt)',exact:true}).first().click();
          const txt=await textDownload;assert.equal(await txt.failure(),null);const textFile=path.join(ARTIFACTS,`${width}-ad.txt`);await txt.saveAs(textFile);assert.match(await fs.readFile(textFile,'utf8'),/Eerste klant aangepaste kop/);
          await frame.locator('.card .download-menu summary').first().click();
          const imageDownload=page.waitForEvent('download');page.once('dialog',dialog=>dialog.accept('klant-afbeelding'));
          await frame.getByRole('button',{name:'Afbeelding (.png)',exact:true}).first().click();
          const png=await imageDownload;assert.equal(await png.failure(),null);const pngFile=path.join(ARTIFACTS,`${width}-ad.png`);await png.saveAs(pngFile);const bytes=await fs.readFile(pngFile);assert.equal(bytes.toString('hex',0,8),'89504e470d0a1a0a');assert.equal(bytes.readUInt32BE(16),1080);
          await screenshot('test-2-exports');
        });
        await step(3,'Cancel then confirm reset and verify all customer storage after refresh',async()=>{
          // Model session-owned temporary/recovery records without submitting a video.
          await page.evaluate(old=>{
            sessionStorage.setItem(`studio-demo:${old}:temporary-recovery`,JSON.stringify({client:'Atelier Eerste Klant'}));
            localStorage.setItem(`studio-demo:${old}:temporary-client`, 'Atelier Eerste Klant');
          },oldWorkspace);
          const before=await state();await page.locator('#resetDemo').click();
          assert.match(await page.locator('#resetDialog').innerText(),/Alle uploads, opgeslagen ontwerpen, gegenereerde content en tijdelijke bestanden/);
          assert.match(await page.locator('#resetDialog').innerText(),/Andere demosessies blijven behouden/);
          await screenshot('test-3-confirmation');await page.locator('#cancelReset').click();assert.deepEqual(await state(),before);
          await reset();
          const stored=await page.evaluate(async old=>({
            local:Object.keys(localStorage).filter(key=>key.startsWith(`studio-demo:${old}:`)),
            session:Object.keys(sessionStorage).filter(key=>key.startsWith(`studio-demo:${old}:`)),
            databases:(await indexedDB.databases()).filter(db=>db.name.startsWith(`studio-demo:${old}:`)).map(db=>db.name),
            caches:await caches.keys()
          }),oldWorkspace);assert.deepEqual(stored,{local:[],session:[],databases:[],caches:[]});
          await page.reload();await checkEmpty();
          assert.notEqual(await page.evaluate(()=>sessionStorage.getItem('studio-demo:workspace')),oldWorkspace);
        });
        await step(4,'Second full client round and reset without first-client data',async()=>{
          await checkEmpty();oldWorkspace=await page.evaluate(()=>sessionStorage.getItem('studio-demo:workspace'));
          const nextImage=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=200;c.height=160;const x=c.getContext('2d');x.fillStyle='#227744';x.fillRect(0,0,200,160);return c.toDataURL();});
          await upload(nextImage,'second-client.png');await frame.locator('#imgGallery .img-thumb').click();
          assert.equal((await state()).photo,nextImage);assert.equal(await frame.locator('#imgGallery .img-thumb').count(),1);
          await frame.locator('#brand').fill('Tweede Klant');await frame.locator('#brand').press('Tab');
          await frame.locator('#chooseAdvertisement').click();await frame.locator('#generateBtn').click();await frame.locator('.card').first().waitFor();
          const text=await frame.locator('#resultsArea').innerText();assert.match(text,/Tweede Klant/);assert.doesNotMatch(text,/Atelier Eerste Klant|Eerste klant aangepaste kop/);
          await frame.locator('.card').first().getByRole('button',{name:'Opslaan',exact:true}).click();await waitSaved(1);
          await screenshot('test-4-second-client');await reset();await page.reload();await checkEmpty();
          assert.deepEqual(await page.evaluate(async old=>({
            local:Object.keys(localStorage).filter(k=>k.startsWith(`studio-demo:${old}:`)),
            session:Object.keys(sessionStorage).filter(k=>k.startsWith(`studio-demo:${old}:`)),
            databases:(await indexedDB.databases()).filter(db=>db.name.startsWith(`studio-demo:${old}:`))
          }),oldWorkspace),{local:[],session:[],databases:[]});
        });
      }finally{report.push({width,network,allConsoleErrors:errors});await context.close();}
    });
  }finally{
    global.fetch=originalFetch;await fs.writeFile(path.join(ARTIFACTS,'report.json'),JSON.stringify(report,null,2));await browser.close();await new Promise(resolve=>server.close(resolve));
  }
});
