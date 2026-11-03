const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const page = fs.readFileSync('spectron-social-studio.html', 'utf8');
const elements = new Map();
function element(id) {
  if (!elements.has(id)) elements.set(id, {
    value:'', style:{}, dataset:{}, options:[{text:'Instagram'}], selectedIndex:0, children:[], hidden:true,
    classList:{add(){}, remove(){}, toggle(){}},
    addEventListener(){}, setAttribute(){}, removeAttribute(){}, pause(){}, load(){}, querySelectorAll(){return [];},
    before(){}, replaceChildren(){}, append(){}, closest(){return null;}
  });
  return elements.get(id);
}
const context = vm.createContext({
  console, setTimeout, clearTimeout, URL, Blob, structuredClone,
  ResizeObserver:class {observe(){}}, MutationObserver:class {observe(){}},
  requestAnimationFrame(){}, Image:class {},
  indexedDB:{open(){return {}; }}, localStorage:{getItem(){return null;}},
  document:{createElement(){return element(Symbol());}, getElementById:element, addEventListener(){}, querySelectorAll(){return [];},
    querySelector(){return null;}, createDocumentFragment(){return {append(){}};}}
});
context.window = context;
context.addEventListener = () => {};
const sources = [];
for (const match of page.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
  const external = match[1].match(/src="([^"]+)"/);
  const filename = external ? external[1].split('?')[0] : 'inline-studio.js';
  assert.doesNotMatch(match[1], /type="module"/, `${filename} must expose existing global handlers`);
  if (filename === 'embedded-assets.js') continue;
  const source = external ? fs.readFileSync(filename, 'utf8') : match[2];
  sources.push(source);
  vm.runInContext(source, context, {filename});
}
const handlerNames = new Set();
for (const source of [page, ...sources]) {
  for (const handler of source.matchAll(/onclick="([^"]+)"/g)) {
    // Global calls only; document.getElementById(), this.closest(), etc. are DOM methods.
    for (const call of handler[1].matchAll(/(?<![\w.])([A-Za-z_$][\w$]*)\s*\(/g)) handlerNames.add(call[1]);
  }
}
for (const name of handlerNames) assert.equal(typeof context[name], 'function', `Missing inline onclick function: ${name}`);
assert.equal(context.showStudioWorkflow('advertisement'), false, 'photo is required first');
vm.runInContext("selectedImage = 'data:image/png;base64,TEST'",context);
assert.equal(context.showStudioWorkflow('advertisement'), true);
assert.equal(element('advertisementFields').hidden, false);
assert.equal(context.showWorkflowChooser(), true);
assert.equal(context.showStudioWorkflow('video'), true);
assert.equal(element('videoFields').hidden, false);
console.log(`PASS: complete script loading, global workflow buttons, and ${handlerNames.size} inline onclick functions`);
