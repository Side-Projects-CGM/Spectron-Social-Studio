const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function measureWords(locator) {
  return locator.evaluate(element => {
    const text = element.firstChild;
    const words = [...text.textContent.matchAll(/\S+/g)].map(match => {
      const range = document.createRange();
      range.setStart(text, match.index);
      range.setEnd(text, match.index + match[0].length);
      return {word:match[0], lines:[...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0).length};
    });
    return {words, width:element.clientWidth, scrollWidth:element.scrollWidth,
      wrap:getComputedStyle(element).overflowWrap, break:getComputedStyle(element).wordBreak};
  });
}
function assertWholeWords(result) {
  assert.equal(result.wrap, 'normal');
  assert.equal(result.break, 'normal');
  assert.ok(result.scrollWidth <= result.width + 1, 'Headline fits horizontally');
  for (const word of result.words) assert.equal(word.lines, 1, `Dutch word must remain whole: ${word.word}`);
}

async function runDutchWordWrapTests(browser, baseUrl = 'http://localhost:8890', screenshotDir) {
  const results = [];
  for (const viewport of [{width:1280,height:900}, {width:390,height:844}]) {
    const context = await browser.newContext({viewport});
    let starts = 0;
    await context.route('**/.netlify/functions/**', route => {starts++;return route.abort();});
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(baseUrl, {waitUntil:'networkidle'});
      await page.selectOption('#brand', 'Kimmon');
      await page.locator('#imgGallery .img-thumb').first().click();
      await page.locator('#chooseAdvertisement').click();
      await page.evaluate(() => document.fonts.ready);
      const formats = [
        ['Instagram / Facebook post', '1080x1080'],
        ['Instagram / Facebook post', '1080x1350'],
        ['Instagram / Facebook story', '1080x1920']
      ];
      for (const [platform, format] of formats) {
        for (const headline of ['Kimmon: ideaal kerstgeschenk!', 'Een bijzonder verjaardagscadeautje met kerstcadeauverpakking']) {
          await page.evaluate(({platform,format,headline}) => {
            // Layout-only fixture: render local copy, never call a paid generator.
            document.getElementById('platform').value = platform;
            updateFormatOptions();
            document.getElementById('format').value = format;
            renderResults([{headline,body:'Verras iemand met een bijzonder cadeau.',cta:'Bekijk nu',hashtags:['Kimmon']}], platform, 'Kimmon cadeau', true);
          }, {platform,format,headline});
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          const live = page.locator('.headline-on-image').first();
          assertWholeWords(await measureWords(live));
          if (format === '1080x1350' && headline.startsWith('Kimmon:') && screenshotDir) {
            fs.mkdirSync(screenshotDir, {recursive:true});
            await page.locator('.mock-social .canvas').first().screenshot({path:path.join(screenshotDir, `dutch-word-wrap-${viewport.width}.png`)});
            const png = await page.evaluate(async () => {
              const blob = await downloadCardImage(0, true);
              if (!blob || blob.type !== 'image/png') throw Error('Expected a PNG export');
              return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result.split(',')[1]);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
              });
            });
            const bytes = Buffer.from(png, 'base64');
            assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
            assert.equal(bytes.readUInt32BE(16), 1080);
            assert.equal(bytes.readUInt32BE(20), 1350);
            fs.writeFileSync(path.join(screenshotDir, `dutch-word-wrap-export-${viewport.width}.png`), bytes);
          }
        }
      }
      await page.evaluate(() => saveAd(0));
      await page.locator('#savedLibraryToggle').click();
      const saved = page.locator('.saved-preview strong').first();
      await saved.waitFor({state:'visible'});
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assertWholeWords(await measureWords(saved));
      // A stored preview must refit when resized without reloading its data.
      await page.setViewportSize({width:viewport.width === 390 ? 1280 : 390,height:900});
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assertWholeWords(await measureWords(saved));
      assert.equal(starts, 0, 'No generation request was sent');
      assert.deepEqual(errors, [], 'No runtime errors');
      results.push(`${viewport.width}px: PASS square/portrait/story headlines, saved preview and resize; no broken words or paid requests`);
    } finally { await context.close(); }
  }
  return results;
}

module.exports = runDutchWordWrapTests;
if (require.main === module) {
  (async () => {
    const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
    const browser = await chromium.launch({headless:true,channel:process.env.TEST_BROWSER_CHANNEL || 'chrome'});
    try {console.log((await runDutchWordWrapTests(browser, process.env.TEST_BASE_URL, process.env.TEST_SCREENSHOT_DIR)).join('\n'));}
    finally {await browser.close();}
  })().catch(error => {console.error(error.message);process.exitCode = 1;});
}
