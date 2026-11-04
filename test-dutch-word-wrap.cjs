const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('spectron-social-studio.html', 'utf8');
const source = html.slice(html.indexOf('function fitHeadlineText('), html.indexOf('function resetImageAdjust('));
const context = vm.createContext({});
vm.runInContext(source, context);

function headline(word, width, lines = 3) {
  return {clientWidth:width, style:{},
    get scrollWidth() { return Math.max(width, word.length * parseFloat(this.style.fontSize) * .55); },
    get offsetHeight() { return lines * parseFloat(this.style.fontSize) * 1.04; }
  };
}

for (const word of ['kerstgeschenk!', 'verjaardagscadeautje', 'kerstcadeauverpakking']) {
  test(`${word}: shrink to fit width without splitting the word`, () => {
    const element = headline(word, 190);
    context.fitHeadlineText(element, 52, 180);
    assert.ok(element.scrollWidth <= element.clientWidth + 1);
    assert.ok(element.offsetHeight <= 180);
    assert.ok(parseFloat(element.style.fontSize) < 52);
    assert.ok(parseFloat(element.style.fontSize) >= 10);
  });
}

test('short headlines keep the requested size and scale up again when resized', () => {
  const element = headline('Kimmon', 300, 2);
  context.fitHeadlineText(element, 42, 200);
  assert.equal(element.style.fontSize, '42px');
  element.clientWidth = 150;
  context.fitHeadlineText(element, 72, 200);
  assert.ok(parseFloat(element.style.fontSize) < 72);
  element.clientWidth = 600;
  context.fitHeadlineText(element, 72, 200);
  assert.equal(element.style.fontSize, '72px');
});

test('hidden saved previews wait until they have a measurable width', () => {
  const element = {clientWidth:0, style:{}, get offsetHeight(){throw Error('Hidden preview must not be measured');}};
  context.fitHeadlineText(element, 27, 0);
  assert.equal(element.style.fontSize, '27px');
});

test('saved previews use the same fitting function and retain requested size metadata', () => {
  const element = headline('kerstgeschenk!', 130, 3);
  element.getAttribute = () => '39';
  const preview = {clientHeight:300, querySelector:()=>element, classList:{contains:()=>true}};
  context.fitSavedPreviewText(preview);
  assert.ok(element.scrollWidth <= element.clientWidth + 1);
  assert.ok(element.offsetHeight <= 135);
  const library = fs.readFileSync('studio-library.js', 'utf8');
  assert.match(library, /data-headline-size/);
  assert.match(library, /canvasResizeObserver.observe\(preview\)/);
});

test('live and saved headline styles cannot break Dutch words arbitrarily', () => {
  for (const selector of ['.mock-social .canvas .headline-on-image', '.saved-preview strong']) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rule = [...html.matchAll(new RegExp(escaped + '\\{([^}]+)\\}', 'g'))].at(-1)?.[1];
    assert.ok(rule);
    assert.match(rule, /overflow-wrap:normal/);
    assert.match(rule, /word-break:normal/);
    assert.match(rule, /hyphens:none/);
    assert.doesNotMatch(rule, /anywhere|break-all/);
  }
});
