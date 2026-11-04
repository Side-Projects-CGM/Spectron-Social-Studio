const assert = require('node:assert/strict');

const VIEWPORTS = [
  {width:320,height:740}, {width:390,height:844},
  {width:768,height:1024}, {width:900,height:900},
  {width:1024,height:768}, {width:1440,height:900},
  {width:1920,height:1080}, {width:1024,height:500}
];

async function measureLayout(page) {
  return page.evaluate(() => {
    const rect = selector => {
      const box = document.querySelector(selector).getBoundingClientRect();
      return {left:box.left,right:box.right,top:box.top,bottom:box.bottom,width:box.width,height:box.height};
    };
    return {
      width:document.documentElement.clientWidth,
      scrollWidth:document.documentElement.scrollWidth,
      brand:rect('.client-brand-logo'), studio:rect('.social-studio-brand-logo'),
      header:rect('.masthead'), controls:rect('#workflowPanel'), canvas:rect('#workspaceCanvas'),
      footer:rect('.studio-copyright'),
      logosLoaded:[...document.querySelectorAll('.masthead img')].every(img => img.complete && img.naturalWidth > 0)
    };
  });
}

function assertLayout(layout, viewport) {
  const {brand,studio,header,controls,canvas} = layout;
  assert.ok(layout.scrollWidth <= layout.width, 'No horizontal document overflow');
  assert.ok(layout.logosLoaded, 'Both header logos loaded');
  assert.ok(brand.right <= studio.left, 'Logos remain side by side without overlap');
  assert.ok(studio.right <= layout.width && brand.left >= 0, 'Header logos fit');
  assert.ok(canvas.width >= 280, 'Canvas has a usable width');
  if (viewport.width <= 900) {
    assert.ok(canvas.top >= controls.bottom - 1, 'Tablet/phone canvas follows controls');
    assert.ok(header.height <= 100, 'Initial mobile header stays compact');
  } else {
    assert.ok(canvas.left >= controls.right - 1, 'Desktop uses two columns');
    if (viewport.height > 600) assert.ok(layout.footer.bottom <= viewport.height + 1, 'Desktop footer fits');
  }
}

async function checkSliders(page) {
  // Layout-only fixture: expose existing controls, without a paid generation.
  await page.evaluate(() => {
    document.getElementById('advancedAdjustments').hidden = false;
    document.getElementById('advancedAdjustments').open = true;
    document.getElementById('imgAdjust').style.display = 'block';
  });
  const sliders = await page.locator('#imgAdjust input[type="range"]').evaluateAll(inputs => inputs.map(input => {
    const box = input.getBoundingClientRect();
    const label = input.parentElement.querySelector('label').getBoundingClientRect();
    return {width:box.width,left:box.left,right:box.right,labelHeight:label.height};
  }));
  const width = await page.evaluate(() => document.documentElement.clientWidth);
  assert.equal(sliders.length, 5);
  for (const slider of sliders) {
    assert.ok(slider.width >= 90, 'Slider remains usable');
    assert.ok(slider.left >= 0 && slider.right <= width, 'Slider is not clipped');
    assert.ok(slider.labelHeight > 0, 'Slider heading is visible');
  }
}

async function checkWorkflow(page) {
  assert.ok(await page.locator('#chooseAdvertisement').isDisabled(), 'Photo required first');
  await page.selectOption('#brand', 'Bluey');
  await page.locator('#imgGallery .img-thumb').first().click();
  const image = page.locator('#workspaceProductImage');
  await image.evaluate(img => img.decode());
  const fits = await image.evaluate(img => {
    const box = img.getBoundingClientRect();
    const parent = img.parentElement.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && box.width <= parent.width + 1 && box.height <= parent.height + 1;
  });
  assert.ok(fits, 'Selected image fits within the preview');
  await page.locator('#chooseAdvertisement').click();
  assert.ok(await page.locator('#advertisementFields').isVisible());
  await checkSliders(page);
  await page.locator('#workflowBack').click();
  await page.locator('#chooseVideo').click();
  assert.ok(await page.locator('#aiVideoPrompt').isVisible());
  await page.locator('#aiVideoPrompt').fill('Local layout check — do not generate.');
  await page.locator('#workflowBack').click();
}

async function runResponsiveTests(page, baseUrl = 'http://localhost:8888') {
  const errors = [];
  const onError = error => errors.push(error.message);
  page.on('pageerror', onError);
  const results = [];
  try {
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await page.goto(baseUrl, {waitUntil:'networkidle'});
      const layout = await measureLayout(page);
      assertLayout(layout, viewport);
      await checkWorkflow(page);
      results.push(`${viewport.width}x${viewport.height}: PASS`);
    }
    assert.deepEqual(errors, [], 'No browser runtime errors');
    return results;
  } finally {
    page.off('pageerror', onError);
  }
}

module.exports = runResponsiveTests;

// Use an already installed Playwright; this script never installs dependencies.
if (require.main === module) {
  (async () => {
    const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
    const browser = await chromium.launch({headless:true,channel:process.env.TEST_BROWSER_CHANNEL || 'chrome'});
    try {
      console.log((await runResponsiveTests(await browser.newPage(), process.env.TEST_BASE_URL)).join('\n'));
    } finally {
      await browser.close();
    }
  })().catch(error => {console.error(error.message);process.exitCode = 1;});
}
