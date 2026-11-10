const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const page=fs.readFileSync('spectron-social-studio.html','utf8');
const controls={gradientDarkness:{value:25,setAttribute(k,v){this[k]=v;}},gradientDarknessValue:{}};
const makeCanvas=()=>({style:{setProperty(k,v){this[k]=v;}},image:{opacity:1},text:{opacity:1}});
let canvases=Array.from({length:4},makeCanvas);
const context=vm.createContext({document:{getElementById:id=>controls[id],querySelectorAll:selector=>{assert.equal(selector,'.mock-social .canvas');return canvases;}},resetImageAdjust(){},resetTextAdjust(){}});
vm.runInContext(page.slice(page.indexOf('const DEFAULT_GRADIENT_DARKNESS'),page.indexOf('const DEFAULT_TEXT_SCALE')),context);
const run=source=>vm.runInContext(source,context);
const gradient='linear-gradient(to bottom, transparent 25%, rgba(0,0,0,.24) 50%, rgba(0,0,0,.72) 80%, rgba(0,0,0,.88) 100%)';
const resolvedPage=page.replace(/var\(--(artwork-scrim-[\w-]+)\)/g,(_,name)=>page.match(new RegExp(`--${name}:([^;]+);`))[1]);
assert.equal(resolvedPage.split(gradient).length-1,2,'Live and saved gradients retain their original direction/stops');
assert.match(page,/\.scrim,\.saved-shade\{opacity:calc\(var\(--gradient-darkness, \.25\) \* 1\.1363636363636364\);\}/);
assert.match(page,/<label for="gradientDarkness">Donkerte van kleurverloop <span id="gradientDarknessValue">25%<\/span>/);
assert.match(page,/<input type="range" id="gradientDarkness" min="0" max="60" step="5" value="25" aria-label="Donkerte van kleurverloop" aria-valuemin="0" aria-valuemax="60" aria-valuenow="25" oninput="applyGradientDarkness\(\)">/);
for(const value of [25,0,60,10,45]){
 controls.gradientDarkness.value=value;run('applyGradientDarkness()');
 assert.equal(controls.gradientDarknessValue.textContent,`${value}%`);
 assert.equal(controls.gradientDarkness['aria-valuenow'],String(value));
 for(const canvas of canvases){
  assert.equal(canvas.style['--gradient-darkness'],String(value/100));
  assert.equal(canvas.image.opacity,1);assert.equal(canvas.text.opacity,1);
  assert.deepEqual(Object.keys(canvas.style).sort(),['--gradient-darkness','setProperty']);
 }
 for(const stop of [.24,.72,.88]) assert.ok(Math.abs(stop*1.1363636363636364*value/100-stop/.88*value/100)<1e-12);
}
run('applyGradientDarkness(100)');assert.equal(controls.gradientDarkness.value,60);
run('applyGradientDarkness(-10)');assert.equal(controls.gradientDarkness.value,0);
run('applyGradientDarkness(50)');canvases=Array.from({length:4},makeCanvas);
run('applyGradientDarkness()');assert.ok(canvases.every(c=>c.style['--gradient-darkness']==='0.5'));
assert.match(page.slice(page.indexOf('function renderResults('),page.indexOf('function onEdit(')),/applyGradientDarkness\(\);/);
vm.runInContext(page.slice(page.indexOf('function resetAllAdjust('),page.indexOf('function corsSafe(')),context);
run('resetAllAdjust()');assert.equal(controls.gradientDarkness.value,25);assert.ok(canvases.every(c=>c.style['--gradient-darkness']==='0.25'));
for(const value of [undefined,null,'',NaN]){context.testValue=value;assert.equal(run('normalizeGradientDarkness(testValue)'),25);}
assert.match(page,/async function copyCardImage\([\s\S]*?const png = downloadCardImage\(idx, true\)/);
console.log('PASS: gradient default, bounds, native accessibility, immediate four-variant updates, proportional unchanged fade, isolated overlay opacity, new renders and reset');
