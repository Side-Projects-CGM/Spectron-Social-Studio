const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {build}=require('./demo/build.cjs');
const ROOT=__dirname;
const ARTIFACTS=path.join(ROOT,'artifacts/progress-loader');
const adBody={candidates:[{content:{parts:[{text:JSON.stringify({variants:[{headline:'Mock advertentie',body:'Alleen een lokale test.',cta:'Ontdek meer',hashtags:[]}]})}]}}]};

test('shared circular loader: regular/demo, 1280/390, timing, media-ready gate, failures and cancellation',{timeout:240000},async t=>{
  const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/User/Documents/Oomagent/food-for-skin-studio/node_modules/@playwright/test');
  await fs.mkdir(ARTIFACTS,{recursive:true});await build();
  const clip=path.join(ARTIFACTS,'mock-ready.mp4');
  execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=160x90:r=10','-t','0.5','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart','-y',clip]);
  const mp4=await fs.readFile(clip);
  const server=http.createServer(async(req,res)=>{
    try{
      const pathname=new URL(req.url,'http://local.test').pathname;
      if(pathname.startsWith('/.netlify/')){res.writeHead(500);res.end('All APIs must be intercepted by mocks');return;}
      const isDemo=pathname.startsWith('/demo/');const base=isDemo?path.join(ROOT,'demo-dist'):ROOT;
      const name=isDemo?(pathname.slice(6)||'index.html'):(pathname.slice(1)||'spectron-social-studio.html');
      const file=path.resolve(base,name);if(!file.startsWith(base+path.sep)){res.writeHead(404);res.end();return;}
      const bytes=await fs.readFile(file);
      const ext=path.extname(file),mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'}[ext]||'application/octet-stream';
      res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store'});res.end(bytes);
    }catch{res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
  const browser=await chromium.launch({channel:'chrome',headless:true});const report=[];
  try{
    for(const mode of ['regular','demo'])for(const width of [1280,390])await t.test(`${mode} ${width}px`,async()=>{
      const context=await browser.newContext({viewport:{width,height:900}});
      let adMode='success',statusMode='pending',downloadMode='hold',adRoute,downloadRoute,videoStarts=0,adStarts=0;
      const errors=[],consoleErrors=[],badResponses=[];
      await context.route('**/*',async route=>{
        const req=route.request(),url=new URL(req.url());
        if(url.origin!==origin)return route.fulfill({status:200,contentType:'text/css',body:''});
        if(!url.pathname.startsWith('/.netlify/functions/'))return route.continue();
        const body=req.postDataJSON?.()||{};
        const action=mode==='demo'?body.action:({'generate':'text','start-veo-video':'video','veo-video-status':'status','download-veo-video':'download'})[url.pathname.split('/').pop()];
        const json=value=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value)});
        if(['session','login','create','check','reset'].includes(action))return json(action==='create'?{workspace:'11111111-1111-4111-8111-111111111111'}:action==='session'?{authenticated:true}:action==='reset'?{complete:true}:{active:true});
        if(action==='text'){
          adStarts++;if(adMode==='hold'){adRoute=route;return;}
          return json(adMode==='error'?{candidates:[]}:adBody);
        }
        if(action==='video'){videoStarts++;return json({operation:`interactions/mock_${videoStarts}`});}
        if(action==='status')return json(statusMode==='pending'?{state:'pending'}:statusMode==='failed'?{state:'failed',message:'Deze testvideo is mislukt.'}:{state:'completed',outputAvailable:true});
        if(action==='download'){
          if(downloadMode==='hold'){downloadRoute=route;return;}
          return route.fulfill({status:200,contentType:'video/mp4',body:downloadMode==='bad'?Buffer.from('not a video'):mp4});
        }
        throw new Error('Unexpected API action in mock test');
      });
      const page=await context.newPage();page.setDefaultTimeout(15000);
      page.on('pageerror',error=>errors.push(error.message));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});page.on('response',r=>{if(r.status()>=400)badResponses.push({status:r.status(),url:r.url()});});
      let studio;
      const screenshot=async name=>{const file=path.join(ARTIFACTS,`${mode}-${width}-${name}.png`);await page.screenshot({path:file,fullPage:true});return path.relative(ROOT,file);};
      try{
        await page.goto(origin+(mode==='demo'?'/demo/':'/spectron-social-studio.html'));
        if(mode==='demo'){await page.locator('iframe').waitFor();studio=await(await page.locator('iframe').elementHandle()).contentFrame();}else studio=page.mainFrame();
        await studio.locator('#brand').waitFor();
        const data=await studio.evaluate(()=>{const c=document.createElement('canvas');c.width=160;c.height=120;const x=c.getContext('2d');x.fillStyle='#ed6a3c';x.fillRect(0,0,160,120);return c.toDataURL().split(',')[1];});
        if(mode==='demo'){await studio.locator('#brand').fill('Testklant');await studio.locator('#brand').press('Tab');}
        else await studio.locator('#brand').selectOption('Bluey');
        await studio.locator('#uploadInput').setInputFiles({name:'loader-test.png',mimeType:'image/png',buffer:Buffer.from(data,'base64')});
        await studio.locator('#imgGallery .img-thumb').first().waitFor();await studio.locator('#chooseAdvertisement').click();
        await studio.evaluate(()=>{
          window.loaderStart=0;window.adShown=0;
          document.getElementById('generateBtn').addEventListener('click',()=>{window.loaderStart=performance.now();});
          new MutationObserver(()=>{if(document.querySelector('#resultsArea .card')&&!window.adShown)window.adShown=performance.now();}).observe(document.getElementById('resultsArea'),{childList:true,subtree:true});
        });
        // Fast successful response must wait for the full two-second animation.
        await studio.locator('#generateBtn').click();await studio.locator('.studio-progress-ring').waitFor();
        assert.equal(await studio.locator('#resultsArea .card').count(),0);
        await page.waitForTimeout(450);
        const appearance=await studio.locator('.studio-progress-ring').evaluate(el=>({blue:getComputedStyle(el.querySelector('.studio-progress-fill')).stroke,track:getComputedStyle(el.querySelector('.studio-progress-track')).stroke,weight:getComputedStyle(el.querySelector('strong')).fontWeight}));
        assert.equal(appearance.blue,'rgb(0, 0, 255)');assert.equal(appearance.track,'rgb(217, 222, 231)');assert.ok(Number(appearance.weight)>=700);
        await screenshot('ad-progress');await studio.locator('#resultsArea .card').first().waitFor();
        const elapsed=await studio.evaluate(()=>window.adShown-window.loaderStart);assert.ok(elapsed>=1950,`Ad appeared too early: ${elapsed}ms`);
        assert.equal(await studio.locator('.studio-progress-overlay').count(),0);
        // Slow API: circle holds at 100 and does not show a fabricated ad.
        adMode='hold';await studio.locator('#generateBtn').click();
        await studio.locator('.studio-progress-value').getByText('100%',{exact:true}).waitFor();
        assert.equal(await studio.locator('.studio-progress-label').textContent(),'Even geduld…');assert.equal(await studio.locator('#resultsArea .card').count(),0);
        const startsBefore=adStarts;await studio.locator('#generateBtn').dispatchEvent('click');assert.equal(adStarts,startsBefore);
        await screenshot('ad-waiting');assert.ok(adRoute);await adRoute.fulfill({status:200,contentType:'application/json',body:JSON.stringify(adBody)});await studio.locator('#resultsArea .card').first().waitFor();
        adMode='error';
        if(mode==='regular'){
          const beforeFallback=adStarts;
          await studio.evaluate(()=>{window.adShown=0;});
          await studio.locator('#generateBtn').click();await studio.locator('.studio-progress-ring').waitFor();
          assert.equal(await studio.locator('#resultsArea .card').count(),0);
          await studio.locator('#resultsArea .card').first().waitFor();
          assert.match(await studio.locator('#outputMeta').textContent(),/offline modus/);
          assert.ok(await studio.evaluate(()=>window.adShown-window.loaderStart>=1950),'Fallback must also wait two seconds');
          assert.equal(adStarts,beforeFallback+1,'Fallback is local, not another paid request');
          assert.equal(await studio.locator('.studio-progress-overlay').count(),0);await screenshot('ad-fallback');
          // Only failure of BOTH the request and fallback should show an error.
          await studio.evaluate(()=>{window.originalOffline=generateOffline;generateOffline=()=>{throw new Error('Mock fallback unavailable');};});
        }
        await studio.locator('#generateBtn').click();await studio.locator('#resultsArea [role="alert"]').waitFor();assert.equal(await studio.locator('.studio-progress-overlay').count(),0);await screenshot('ad-error');
        if(mode==='regular')await studio.evaluate(()=>{generateOffline=window.originalOffline;delete window.originalOffline;});
        await studio.locator('#workflowBack').click();await studio.locator('#chooseVideo').click();await studio.locator('#aiVideoPrompt').fill('Lokale mock video. Geen API-kosten.');
        await studio.locator('#generateAIVideoBtn').click();assert.equal(await studio.locator('.studio-progress-overlay').count(),0);await studio.locator('#aiVideoCancelButton').click();assert.equal(videoStarts,0);
        // Install a browser clock solely to advance long estimated progress/polling without real waits.
        await page.clock.install();
        await studio.locator('#generateAIVideoBtn').click();await studio.locator('#aiVideoConfirmButton').click();await studio.locator('.studio-progress-ring').waitFor();
        await studio.waitForFunction(()=>aiVideoOperation==='interactions/mock_1');assert.equal(videoStarts,1);
        await page.clock.fastForward(180000);await studio.locator('.studio-progress-value').getByText('90%',{exact:true}).waitFor();
        assert.match(await studio.locator('.studio-progress-label').textContent(),/Geschatte/);
        assert.equal(await studio.locator('#resultsArea video:visible').count(),0);await screenshot('video-progress');
        await page.clock.fastForward(180000);assert.ok(Number((await studio.locator('.studio-progress-value').textContent()).replace('%',''))<95);
        // Provider says completed, but download is still held: progress must remain below 100.
        statusMode='completed';await page.clock.fastForward(10000);
        await studio.waitForFunction(()=>document.getElementById('aiVideoPreview')!==null);
        assert.ok(downloadRoute);assert.notEqual(await studio.locator('.studio-progress-value').textContent(),'100%');assert.equal(await studio.locator('#aiVideoPreview').isVisible(),false);
        await screenshot('video-downloading');
        await downloadRoute.fulfill({status:200,contentType:'video/mp4',body:mp4});
        await studio.locator('#aiVideoPreview').waitFor({state:'visible'});
        assert.ok(await studio.locator('#aiVideoPreview').evaluate(v=>v.readyState>=2));assert.equal(await studio.locator('.studio-progress-overlay').count(),0);assert.equal(videoStarts,1);await screenshot('video-ready');
        // A provider failure removes the loader and never retries generation.
        statusMode='failed';await studio.locator('#generateAIVideoBtn').click();await studio.locator('#aiVideoConfirmButton').click();await studio.waitForFunction(()=>aiVideoOperation==='interactions/mock_2');await page.clock.fastForward(10000);
        await studio.locator('#resultsArea [role="alert"]').waitFor();assert.match(await studio.locator('#resultsArea').innerText(),/mislukt/);assert.equal(await studio.locator('.studio-progress-overlay').count(),0);assert.equal(videoStarts,2);await screenshot('video-error');
        // A completed response with unplayable bytes is NOT 100% success.
        statusMode='completed';downloadMode='bad';await studio.locator('#generateAIVideoBtn').click();await studio.locator('#aiVideoConfirmButton').click();await studio.waitForFunction(()=>aiVideoOperation==='interactions/mock_3');await page.clock.fastForward(10000);
        await studio.locator('#aiVideoPreviewError').waitFor({state:'visible'});assert.equal(await studio.locator('.studio-progress-overlay').count(),0);assert.equal(videoStarts,3);
        assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);assert.deepEqual(badResponses,[]);
        assert.equal(await studio.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
        report.push({mode,width,status:'PASS',adElapsedMs:elapsed,videoStarts,errors,consoleErrors,badResponses,appearance});
      }catch(error){await screenshot('FAIL');report.push({mode,width,status:'FAIL',message:error.message,errors,consoleErrors,badResponses});throw error;}
      finally{await context.close();}
    });
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));await fs.writeFile(path.join(ARTIFACTS,'report.json'),JSON.stringify(report,null,2));}
});
