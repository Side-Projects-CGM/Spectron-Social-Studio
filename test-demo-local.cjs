const test=require('node:test');
const assert=require('node:assert/strict');
const {serve,localStore}=require('./demo/local.cjs');
const {createDemoState}=require('./netlify/lib/demo-state.cjs');

test('local runner atomic adapter enforces quota across simultaneous sessions',async()=>{
  const store=localStore();
  const state=createDemoState({store,password:'mock-presenter-only',secret:'mock-secret-only-never-for-deployment',origin:'http://127.0.0.1:8891'});
  const cookie=await state.login({headers:{origin:'http://127.0.0.1:8891'}},'mock-presenter-only');
  const auth=state.authenticate({headers:{cookie:cookie.split(';')[0]}});
  const date=new Date().toISOString().slice(0,10);
  await store.setJSON(`limits/${date}`,{text:49,image:0,video:0});
  const ids=await Promise.all(Array.from({length:8},()=>state.createWorkspace(auth)));
  const results=await Promise.allSettled(ids.map(id=>state.begin(auth,id,'text')));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
});

test('documented local runner: login, upload, mock text/image, reset; paid video denied',{timeout:60000},async()=>{
  const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/User/Documents/Oomagent/food-for-skin-studio/node_modules/@playwright/test');
  const server=await serve({port:8893,password:'mock-presenter-only'});
  const realFetch=global.fetch;
  // Fail if the server attempts any paid/network call in mock mode.
  global.fetch=async()=>{throw new Error('Server external networking forbidden in local smoke test');};
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const context=await browser.newContext();
    await context.route('**/*',route=>new URL(route.request().url()).origin==='http://127.0.0.1:8893'?route.continue():route.fulfill({status:200,contentType:'text/css',body:''}));
    const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto('http://127.0.0.1:8893');await page.fill('#password','mock-presenter-only');await page.locator('#loginForm button').click();
    const frame=page.frameLocator('iframe');await frame.locator('#brand').waitFor();
    const data=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=32;c.getContext('2d').fillRect(0,0,32,32);return c.toDataURL().split(',')[1];});
    await frame.locator('#uploadInput').setInputFiles({name:'mock.png',mimeType:'image/png',buffer:Buffer.from(data,'base64')});
    await frame.locator('#imgGallery img').first().waitFor();
    await frame.locator('#chooseAdvertisement').click();await frame.locator('#generateBtn').click();await frame.locator('.card').first().waitFor();
    await frame.locator('#backgroundButton').click();await frame.locator('#backgroundDescription').fill('Test');await frame.locator('#backgroundGenerate').click();
    await page.waitForFunction(()=>document.querySelector('iframe').contentDocument.querySelector('#backgroundStatus').textContent.includes('opgeslagen'));
    // Prove the mock image is decodable, not just a fake success response.
    assert.ok(await page.locator('iframe').evaluate(async iframe=>{
      const image=new iframe.contentWindow.Image();image.src=iframe.contentWindow.eval('selectedImage');await image.decode();return image.naturalWidth>0;
    }));
    const denied=await page.evaluate(async()=>{const r=await fetch('/.netlify/functions/demo-api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'video',workspace:sessionStorage.getItem('studio-demo:workspace'),input:{prompt:'must never run'}})});return r.status;});
    assert.equal(denied,403);
    const old=await page.evaluate(()=>sessionStorage.getItem('studio-demo:workspace'));
    await page.locator('#resetDemo').click();await page.locator('#confirmReset').click();
    await page.waitForFunction(old=>sessionStorage.getItem('studio-demo:workspace')!==old,old);
    await frame.locator('#brand').waitFor();assert.equal(await frame.locator('#imgGallery img').count(),0);assert.deepEqual(errors,[]);
    await context.close();
  }finally{global.fetch=realFetch;await browser.close();await new Promise(resolve=>server.close(resolve));}
});
