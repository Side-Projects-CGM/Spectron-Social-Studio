const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {build}=require('./demo/build.cjs');
const ARTIFACTS=path.join(__dirname,'artifacts/demo-scroll');

test('demo desktop uses one workspace scrollbar, without outer or panel scrolling; mobile remains unchanged',{timeout:120000},async t=>{
  const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/User/Documents/Oomagent/food-for-skin-studio/node_modules/@playwright/test');
  const output=path.join(ARTIFACTS,'site');await build(output);
  const server=http.createServer(async(req,res)=>{
    try{
      const pathname=new URL(req.url,'http://local.test').pathname;
      if(pathname.startsWith('/.netlify/')){res.writeHead(500);res.end('API calls must be mocked');return;}
      const file=path.resolve(output,'.'+(pathname==='/'?'/index.html':pathname));
      if(!file.startsWith(output+path.sep)){res.writeHead(404);res.end();return;}
      const bytes=await fs.readFile(file);
      const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'}[path.extname(file)]||'application/octet-stream';
      res.writeHead(200,{'Content-Type':mime});res.end(bytes);
    }catch{res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const browser=await chromium.launch({channel:'chrome'});const report=[];
  try{
    for(const viewport of [{width:1280,height:650},{width:1280,height:900},{width:1440,height:900},{width:390,height:844}])await t.test(`${viewport.width}x${viewport.height}`,async()=>{
      const context=await browser.newContext({viewport});const page=await context.newPage();
      const errors=[],badResponses=[];let requests=0;
      page.on('pageerror',e=>errors.push(e.message));
      page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
      page.on('response',r=>{if(r.status()>=400)badResponses.push(r.status());});
      await context.route('**/*',route=>{
        const request=route.request(),url=new URL(request.url());
        if(url.origin!==origin)return route.fulfill({status:200,contentType:'text/css',body:''});
        if(!url.pathname.startsWith('/.netlify/functions/'))return route.continue();
        const body=request.postDataJSON();let result;
        if(body.action==='session')result={authenticated:true};
        else if(body.action==='create')result={workspace:randomUUID()};
        else if(body.action==='check')result={active:true};
        else if(body.action==='reset')result={complete:true};
        else if(body.action==='text'){
          requests++;result={candidates:[{content:{parts:[{text:JSON.stringify({variants:Array.from({length:4},(_,i)=>({headline:`Mock ${i+1}`,body:'Lokale scrolltest.',cta:'Ontdek meer',hashtags:[]}))})}]}}]};
        }else throw new Error('Unexpected API in scroll test');
        return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
      });
      const screenshot=name=>page.screenshot({path:path.join(ARTIFACTS,`${viewport.width}-${viewport.height}-${name}.png`),fullPage:true});
      async function assertOneScroll(){
        await page.waitForFunction(()=>{
          const frame=document.querySelector('iframe'),box=frame?.getBoundingClientRect();
          return box&&box.top>=0&&box.bottom<=innerHeight+1&&document.documentElement.scrollHeight<=innerHeight+1;
        },null,{timeout:5000});
        const metrics=await page.locator('iframe').evaluate(frame=>{
          const doc=frame.contentDocument,win=frame.contentWindow;
          return {frame:frame.clientHeight,content:doc.documentElement.scrollHeight,innerScroll:win.scrollY,horizontal:doc.documentElement.scrollWidth>win.innerWidth,
            panels:[...doc.querySelectorAll('.workflow-panel,.workspace-canvas')].filter(el=>el.scrollHeight>el.clientHeight+1&&/auto|scroll/.test(win.getComputedStyle(el).overflowY)).length};
        });
        assert.equal(await page.evaluate(()=>scrollY),0);assert.equal(metrics.horizontal,false);assert.equal(metrics.panels,0);
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
        assert.equal(await page.evaluate(()=>getComputedStyle(document.body).overflowY),'hidden');
        return metrics;
      }
      try{
        await page.goto(origin);await page.locator('iframe').waitFor();
        let studio=await(await page.locator('iframe').elementHandle()).contentFrame();await studio.waitForLoadState('load');
        await studio.locator('#brand').fill('Scrolltest');await studio.locator('#brand').dispatchEvent('change');
        const data=await studio.evaluate(()=>{const c=document.createElement('canvas');c.width=160;c.height=120;const ctx=c.getContext('2d');ctx.fillStyle='#ed6a3c';ctx.fillRect(0,0,160,120);return c.toDataURL().split(',')[1];});
        await studio.locator('#uploadInput').setInputFiles({name:'scroll.png',mimeType:'image/png',buffer:Buffer.from(data,'base64')});
        await studio.waitForFunction(()=>typeof selectedImage==='string'&&selectedImage.startsWith('data:'));
        await studio.locator('#chooseAdvertisement').click();
        const desktop=viewport.width>900;
        if(desktop){
          await assertOneScroll();await studio.evaluate(()=>scrollTo(0,0));
          await studio.locator('.workflow-panel').hover({position:{x:100,y:100}});
          const before=await studio.evaluate(()=>scrollY);await page.mouse.wheel(0,400);
          await studio.waitForFunction(previous=>scrollY>previous,before);
          assert.equal(await page.evaluate(()=>scrollY),0,'Wheel over left controls scrolls the workspace only');
        }
        await screenshot('controls');
        await studio.locator('#generateBtn').click();await studio.locator('#resultsArea .card').first().waitFor();assert.equal(requests,1);
        const metrics=desktop?await assertOneScroll():null;await screenshot('results');
        if(desktop){
          await studio.locator('.studio-copyright').scrollIntoViewIfNeeded();
          assert.equal(await studio.evaluate(()=>{const box=document.querySelector('.studio-copyright').getBoundingClientRect();return box.top>=0&&box.bottom<=innerHeight+1;}),true,'The footer remains reachable, not clipped');
          const expanded=await page.locator('iframe').evaluate(el=>el.contentDocument.documentElement.scrollHeight);
          await studio.locator('#workflowBack').click();
          await page.waitForFunction(previous=>document.querySelector('iframe').contentDocument.documentElement.scrollHeight<previous,expanded);
          await assertOneScroll();
          // The same frame must switch modes without leaving stale desktop height behind.
          await page.setViewportSize({width:390,height:844});
          await page.waitForFunction(()=>document.querySelector('iframe').style.height==='');
          await page.setViewportSize(viewport);await assertOneScroll();
          // Reset replaces the workspace while retaining the single-scroll layout.
          await page.locator('#resetDemo').click();await page.locator('#confirmReset').click();
          await page.waitForFunction(()=>document.querySelector('iframe')?.contentDocument?.getElementById('brand')?.value==='');
          await assertOneScroll();await screenshot('reset');
        }else{
          assert.equal(await page.locator('iframe').evaluate(el=>el.style.height),'','Mobile retains its existing sizing');
          assert.equal(await page.locator('iframe').evaluate(el=>getComputedStyle(el).minHeight),'1000px');
        }
        assert.deepEqual(errors,[]);assert.deepEqual(badResponses,[]);
        report.push({...viewport,status:'PASS',metrics,errors,badResponses});
      }catch(error){await screenshot('FAIL');report.push({...viewport,status:'FAIL',message:error.message,errors,badResponses});throw error;}
      finally{await context.close();}
    });
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));await fs.writeFile(path.join(ARTIFACTS,'report.json'),JSON.stringify(report,null,2));}
});
