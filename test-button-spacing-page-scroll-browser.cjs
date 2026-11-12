const assert = require('node:assert/strict');

async function checkDocumentScroll(page) {
  const layout = await page.evaluate(() => {
    const panel = document.getElementById('workflowPanel');
    const parents = [];
    for (let el = panel; el; el = el.parentElement) {
      parents.push({name:el.id || el.tagName,overflow:getComputedStyle(el).overflowY});
    }
    return {parents,panelHeight:panel.clientHeight,panelContent:panel.scrollHeight,
      canvasOverflow:getComputedStyle(document.getElementById('workspaceCanvas')).overflowY,
      documentHeight:document.scrollingElement.scrollHeight,viewport:innerHeight,
      horizontalOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth};
  });
  for (const parent of layout.parents) assert.equal(parent.overflow,'visible',`No scroll trap: ${parent.name}`);
  assert.ok(layout.panelContent<=layout.panelHeight+1,'Entire control panel fits without inner scrolling');
  assert.equal(layout.canvasOverflow,'visible','Preview does not add a separate scrollbar');
  assert.equal(layout.horizontalOverflow,false);
  assert.ok(layout.documentHeight>layout.viewport,'Long controls grow the page');
  await page.evaluate(()=>window.scrollTo(0,document.scrollingElement.scrollHeight));
  const scrolled = await page.evaluate(()=>({page:scrollY,panel:document.getElementById('workflowPanel').scrollTop}));
  assert.ok(scrolled.page>0,'Normal page scroll works');
  assert.equal(scrolled.panel,0,'Panel never scrolls independently');
  await page.evaluate(()=>window.scrollTo(0,0));
}

async function run(browser, baseUrl) {
  for (const width of [320,390,768,1280]) {
    const context = await browser.newContext({viewport:{width,height:900}});
    const errors = [], calls = [];
    await context.addInitScript(()=>sessionStorage.setItem('spectron-ai-video-recovery',
      JSON.stringify({operation:'interactions/mock-spacing',aspectRatio:'16:9'})));
    await context.route('**/.netlify/functions/**',route=>{calls.push(route.request().method());return route.abort();});
    const page = await context.newPage();
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
    try {
      await page.goto(baseUrl,{waitUntil:'networkidle'});
      assert.equal(await page.locator('#workspaceOutput').isVisible(),false,'Recovery stays quiet');
      await page.selectOption('#brand','Bluey');
      await page.locator('#imgGallery .img-thumb').first().click();
      await page.locator('#chooseAdvertisement').click();
      await checkDocumentScroll(page);
      await page.locator('#workflowBack').click();
      await page.locator('#chooseVideo').click();
      await checkDocumentScroll(page);
      const boxes = await page.locator('#generateAIVideoBtn, #aiVideoPreviousButton').evaluateAll(buttons=>buttons.map(button=>{
        const r=button.getBoundingClientRect();
        return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height};
      }));
      assert.equal(boxes.length,2);
      assert.ok(boxes[1].top>=boxes[0].bottom+12,'Primary and recovery actions have a 12px gap');
      for(const box of boxes) {
        assert.ok(box.height>=44,'Actions have usable touch targets');
        assert.ok(box.left>=0&&box.right<=width,'Buttons fit the viewport');
      }
      await page.locator('#generateAIVideoBtn').click();
      assert.equal(await page.locator('#aiVideoConfirmModal').isVisible(),true);
      await page.locator('#aiVideoCancelButton').click();
      assert.equal(await page.locator('#aiVideoConfirmModal').isVisible(),false);
      assert.deepEqual(calls,[],'Layout and cancellation do not start paid requests');
      assert.deepEqual(errors,[]);
      console.log(`${width}px: PASS button spacing, page-only scrolling, confirmation/cancel; no API requests`);
    } finally {await context.close();}
  }
}
module.exports = run;
if(require.main===module) {
  (async()=>{
    const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
    const browser=await chromium.launch({headless:true,channel:process.env.TEST_BROWSER_CHANNEL||'chrome'});
    try {await run(browser,process.env.TEST_BASE_URL||'http://127.0.0.1:8891');}
    finally {await browser.close();}
  })().catch(error=>{console.error(error.message);process.exitCode=1;});
}
