const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function runCompactSliderTests(browser, baseUrl = 'http://localhost:8890', screenshotDir) {
  const results = [];
  for (const device of [{width:1280,height:900,touch:false}, {width:390,height:844,touch:true}]) {
    const context = await browser.newContext({viewport:{width:device.width,height:device.height},hasTouch:device.touch,isMobile:device.touch});
    let starts = 0;
    await context.route('**/.netlify/functions/**', route => {starts++;return route.abort();});
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {if(message.type() === 'error') errors.push('Browser console error');});
    try {
      await page.goto(baseUrl, {waitUntil:'networkidle'});
      await page.selectOption('#brand', 'BeepBoop');
      await page.locator('#imgGallery .img-thumb').first().click();
      await page.locator('#chooseAdvertisement').click();
      await page.evaluate(() => renderResults([{headline:'Ontdek de vrolijke wereld van BeepBoop!',body:'Spelen, lachen en ontdekken.',cta:'Bekijk nu',hashtags:['BeepBoop']}], 'Instagram / Facebook post', 'BeepBoop', true));
      for (const id of ['gradientDarkness','zoomSlider','posXSlider','posYSlider','textSlider']) {
        const slider = page.locator('#' + id);
        const bounds = await slider.evaluate(input => ({min:Number(input.min),max:Number(input.max),step:Number(input.step)||1}));
        await slider.focus();
        await slider.press('Home');
        assert.equal(Number(await slider.inputValue()), bounds.min);
        await slider.press('End');
        assert.equal(Number(await slider.inputValue()), bounds.max);
        await slider.press('ArrowLeft');
        assert.equal(Number(await slider.inputValue()), bounds.max - bounds.step);
        const box = await slider.boundingBox();
        await slider.click({position:{x:box.width*.35,y:box.height/2}});
        const clicked = Number(await slider.inputValue());
        assert.ok(clicked > bounds.min && clicked < bounds.max, 'Mouse changes slider value');
        if (device.touch) {
          await slider.tap({position:{x:box.width*.65,y:box.height/2}});
          assert.notEqual(Number(await slider.inputValue()), clicked, 'Touch changes slider value');
        }
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
        const alignment = await slider.evaluate(input => {
          const thumb = parseFloat(getComputedStyle(input).getPropertyValue('--studio-slider-thumb-size'));
          const sliderBox = input.getBoundingClientRect();
          const rowBox = input.parentElement.getBoundingClientRect();
          const output = input.parentElement.querySelector('.slider-thumb-value');
          const outputBox = output.getBoundingClientRect();
          const fraction = (Number(input.value)-Number(input.min))/(Number(input.max)-Number(input.min));
          return {thumb,width:sliderBox.width,rowWidth:rowBox.width,height:sliderBox.height,text:output.textContent,value:input.value,
            distance:Math.abs(outputBox.left+outputBox.width/2-(sliderBox.left+thumb/2+fraction*(sliderBox.width-thumb)))};
        });
        assert.equal(alignment.thumb, 14);
        assert.ok(alignment.width >= 90);
        assert.ok(alignment.width < alignment.rowWidth * .9, 'Track is visibly shorter than its column');
        if (device.touch) assert.ok(alignment.height >= 44, 'Mobile touch target stays usable');
        assert.equal(alignment.text, alignment.value+'%');
        assert.ok(alignment.distance <= 1.5, 'Percentage remains centred under handle');
      }
      const rows = await page.locator('#imgAdjust .adj-row').evaluateAll(rows => rows.map(row => ({top:Math.round(row.getBoundingClientRect().top),track:row.querySelector('input').getBoundingClientRect().top})));
      for (const row of rows) {
        const tracks = rows.filter(other => other.top === row.top).map(other => other.track);
        assert.ok(Math.max(...tracks) - Math.min(...tracks) <= 1.5, 'Sliders in the same row stay aligned under Dutch headings');
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'No horizontal overflow');
      if (screenshotDir) {
        fs.mkdirSync(screenshotDir, {recursive:true});
        await page.locator('#textSlider').evaluate(input => input.blur());
        await page.evaluate(() => window.scrollTo(0,0));
        await page.screenshot({path:path.join(screenshotDir, `cees-compact-sliders-${device.width}.png`),fullPage:true});
      }
      assert.equal(starts,0);
      assert.deepEqual(errors,[]);
      results.push(`${device.width}px: PASS five smaller sliders, mouse/keyboard${device.touch?'/touch':''}, aligned percentages, no overflow or paid requests`);
    } finally { await context.close(); }
  }
  return results;
}

module.exports = runCompactSliderTests;
if (require.main === module) {
  (async () => {
    const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
    const browser = await chromium.launch({headless:true,channel:process.env.TEST_BROWSER_CHANNEL || 'chrome'});
    try {console.log((await runCompactSliderTests(browser, process.env.TEST_BASE_URL, process.env.TEST_SCREENSHOT_DIR)).join('\n'));}
    finally {await browser.close();}
  })().catch(error => {console.error(error.message);process.exitCode = 1;});
}
