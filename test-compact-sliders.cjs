const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const css = fs.readFileSync('studio-design.css', 'utf8');
const html = fs.readFileSync('spectron-social-studio.html', 'utf8');

test('header sliders use shorter tracks and shared 14px handles', () => {
  assert.match(css, /--studio-slider-thumb-size:14px;display:block;width:84%;min-width:90px;max-width:100%/);
  for (const engine of ['webkit-slider-thumb', 'moz-range-thumb']) {
    assert.ok(css.includes(`::-${engine}{`));
    const rule = css.split(`::-${engine}{`)[1].split('}')[0];
    assert.match(rule, /box-sizing:border-box/);
    assert.match(rule, /width:var\(--studio-slider-thumb-size\);height:var\(--studio-slider-thumb-size\)/);
  }
  assert.match(css, /@media\(pointer:coarse\)\{\.masthead \.adj-row input\[type=range\]\{height:44px;\}\}/);
});

const start = html.indexOf('  function update(){sliders.forEach((slider,i)=>{');
const end = html.indexOf('  sliders.forEach(slider=>slider.addEventListener', start);
assert.ok(start >= 0 && end > start);
const source = html.slice(start, end);
for (const thumbSize of [14, 12]) {
  test(`${thumbSize}px handle: percentages stay centred at minimum, middle and maximum`, () => {
    const sliders = [
      {min:0,max:60,value:0}, {min:100,max:220,value:160}, {min:0,max:100,value:100},
      {min:0,max:100,value:50}, {min:70,max:220,value:220}
    ].map(slider => ({...slider,offsetLeft:12,clientWidth:120}));
    const outputs = sliders.map(() => ({style:{},textContent:''}));
    const context = vm.createContext({sliders,outputs,getComputedStyle:()=>({getPropertyValue:()=>`${thumbSize}px`})});
    vm.runInContext(source, context);
    context.update();
    sliders.forEach((slider, i) => {
      const fraction = (slider.value-slider.min)/(slider.max-slider.min);
      const expected = slider.offsetLeft + thumbSize/2 + fraction*(slider.clientWidth-thumbSize);
      assert.equal(parseFloat(outputs[i].style.left), expected);
      assert.equal(outputs[i].textContent, `${slider.value}%`);
    });
  });
}
