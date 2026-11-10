const fs=require('node:fs'), vm=require('node:vm'), assert=require('node:assert/strict');
const elements=new Map();
// Exercise the actual text-fitting function at two proportional 9:16 preview sizes.
const pageSource=fs.readFileSync('spectron-social-studio.html','utf8');
const fitSource=pageSource.slice(pageSource.indexOf('function applyTextScale('),pageSource.indexOf('function resetImageAdjust('));
const preview={clientWidth:280,clientHeight:280*16/9,classList:{contains:()=>true}};
let lines=2;
const headline={parentElement:preview,clientWidth:240,scrollWidth:240,style:{setProperty(name,value){this[name]=value;}},classList:{contains:()=>true},get offsetHeight(){return parseFloat(this.style.fontSize)*1.04*lines;}};
const fitContext=vm.createContext({selectedVariantIndex:0,variantVisuals:[{textScale:1.5},{textScale:1.8}],DEFAULT_TEXT_SCALE:1.5,TEXT_BASE_SIZES:{'.headline-on-image':26},document:{querySelectorAll:()=>[headline]}});
vm.runInContext(fitSource,fitContext);
vm.runInContext('applyTextScale(0)',fitContext);
const smallSize=parseFloat(headline.style.fontSize);
assert.equal(smallSize,26*1.5*280/320);
preview.clientWidth=560;preview.clientHeight=560*16/9;
vm.runInContext('applyTextScale(0)',fitContext);
assert.equal(parseFloat(headline.style.fontSize),smallSize*2);
vm.runInContext('applyTextScale(1)',fitContext);
assert.equal(parseFloat(headline.style.fontSize),26*1.8*560/320);
lines=20;
vm.runInContext('applyTextScale(0)',fitContext);
assert.ok(headline.offsetHeight<=preview.clientHeight*.45);
console.log('PASS: proportional 9:16 text scaling, per-variant sizing, long-headline fitting');
const positionControls={zoomSlider:{value:100},posXSlider:{value:50},posYSlider:{value:80},zoomVal:{}};
const positionImage={naturalWidth:1000,naturalHeight:1000,clientWidth:280,clientHeight:280*16/9,style:{}};
const positionContext=vm.createContext({selectedVariantIndex:0,variantVisuals:[{}],imgScale:1,imgPosX:50,imgPosY:50,studioNotice(){},document:{getElementById:id=>positionControls[id],querySelector:()=>positionImage,querySelectorAll:()=>[positionImage]}});
vm.runInContext(pageSource.slice(pageSource.indexOf('function onImageAdjust('),pageSource.indexOf('function onTextAdjust(')),positionContext);
vm.runInContext("onImageAdjust('y')",positionContext);
assert.equal(positionControls.zoomSlider.value,120,'Vertical panning must create room at cover-size');
assert.match(positionImage.style.transform,/scale\(1.2\)/);
assert.equal(positionContext.variantVisuals[0].imgPosY,80);
positionControls.zoomSlider.value=100;positionControls.posXSlider.value=80;
vm.runInContext("onImageAdjust('x')",positionContext);
assert.equal(positionControls.zoomSlider.value,100,'Existing horizontal crop must not trigger extra zoom');
positionImage.clientWidth=280;positionImage.clientHeight=280;
vm.runInContext("onImageAdjust('x')",positionContext);
assert.equal(positionControls.zoomSlider.value,120,'Square images also need horizontal pan room');
positionControls.zoomSlider.value=100;positionControls.posXSlider.value=50;positionControls.posYSlider.value=50;
vm.runInContext('onImageAdjust()',positionContext);
assert.equal(positionContext.variantVisuals[0].imgScale,1,'Reset must retain 100% zoom');
console.log('PASS: mobile-size horizontal/vertical panning, automatic pan room, crop preservation, reset');
for(const match of fs.readFileSync('spectron-social-studio.html','utf8').matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
function el(){return {attributes:{},setAttribute(name,value){this.attributes[name]=value;},textContent:'',style:{setProperty(name,value){this[name]=value;}},classList:{add(){}},children:[],append(...nodes){this.children.push(...nodes)},replaceChildren(){this.children=[]},scrollIntoView(){},close(){},showModal(){},getAttribute(){return 'product.png'}};}
const rows=new Map();let selected=[];let clipboard='';let transactions=0,opened=null;
const db={transaction(store,mode){transactions++;const tx={};tx.objectStore=()=>({put(ad){rows.set(ad.id,structuredClone(ad));},getAll(){const r={};queueMicrotask(()=>{r.result=store==='ads'?[...rows.values()]:[];r.onsuccess();});return r;}});if(mode==='readwrite')setTimeout(()=>tx.oncomplete(),0);return tx;}};
const context=vm.createContext({console,structuredClone,crypto:require('node:crypto').webcrypto,setTimeout,
 indexedDB:{open(){const r={};queueMicrotask(()=>{r.result=db;r.onsuccess()});return r;}},
 document:{getElementById(id){if(!elements.has(id))elements.set(id,el());return elements.get(id);},querySelector(){return el()},querySelectorAll(selector){return selector === ".mock-social .canvas" ? [] : selected;},createElement:el},
 navigator:{clipboard:{async writeText(t){clipboard=t}}},
 brandImageRecords:[],renderImageGallery(){},
 currentVariants:[{headline:'Edited headline',body:'Same exact body',cta:'Shop now',hashtags:['toy']}],currentBrand:'Bluey',currentProduct:'Toy',currentPlatform:'Instagram / Facebook post',currentFormat:'1080x1080',selectedImage:'product.png',variantVisuals:[{imgScale:1.4,imgPosX:35,imgPosY:60,textScale:1.2}],SPECTRON_LOGO_SRC:'logo.png',
 updateFormatOptions(){},renderResults(variants){opened=variants[0];},selectVariant(){},applyImageTransform(){},applyTextScale(){}
});
assert.match(pageSource,/<button[^>]*id="savedLibraryToggle"[^>]*aria-expanded="false"[^>]*aria-controls="savedAdsPanel"/);
assert.match(pageSource,/<div id="savedAdsPanel" hidden>/);
assert.match(pageSource,/#savedLibrary \.library-actions,#duplicateDialog \.library-actions\{[^}]*flex-wrap:wrap;[^}]*gap:12px/);
const panel=el();panel.hidden=true;elements.set('savedAdsPanel',panel);
const toggle=el();toggle.setAttribute('aria-expanded','false');elements.set('savedLibraryToggle',toggle);
vm.runInContext(pageSource.slice(pageSource.indexOf('const DEFAULT_GRADIENT_DARKNESS'),pageSource.indexOf('const DEFAULT_TEXT_SCALE')),context);
vm.runInContext('applyGradientDarkness(40)',context);
vm.runInContext(fs.readFileSync('studio-library.js','utf8'),context);
(async()=>{
 await vm.runInContext('adDatabase',context);
 for(const count of [0,1]){
  selected=Array.from({length:count},(_,i)=>({value:String(i)}));
  vm.runInContext('showDuplicate(0)',context);
  assert.equal(elements.get('confirmDuplicate').disabled,true);
  await vm.runInContext('confirmDuplicate()',context);
  assert.equal(rows.size,0);
 }
 for(const count of [2,3,4]){
  const before=rows.size;selected=Array.from({length:count},(_,i)=>({value:String(i)}));
  vm.runInContext('duplicateSource = snapshotAd(0)',context);
  await vm.runInContext('confirmDuplicate()',context);
  assert.equal(rows.size,before+count);
  const batch=[...rows.values()].slice(-count);
  assert.equal(new Set(batch.map(a=>a.batchId)).size,1);
  assert.equal(new Set(batch.map(a=>a.id)).size,count);
  for(const ad of batch){assert.equal(ad.variant.headline,'Edited headline');assert.equal(ad.variant.body,'Same exact body');assert.equal(ad.visual.imgScale,1.4);assert.equal(ad.image,'product.png');assert.equal(ad.gradientDarkness,40);}
  assert.deepEqual(batch.map(a=>a.format),['1080x1080','1080x1350','1080x1920','1080x1920'].slice(0,count));
 }
 await vm.runInContext('saveAd(0)',context);const n=rows.size;
 context.currentVariants[0].headline='Updated saved headline';await vm.runInContext('saveAd(0)',context);assert.equal(rows.size,n);
 await vm.runInContext('refreshSavedAds()',context);assert.equal(vm.runInContext('savedAds.length',context),n);
 for(const item of elements.get('savedAds').children){
  const preview=item.children[1];
  assert.equal(preview.children.filter(node=>node.src).length,1);
  assert.equal(preview.children[0].src,'product.png');
  assert.equal(preview.style['--gradient-darkness'],'0.4');
  assert.ok(preview.children.every(node=>! /logo|ai-image-badge/.test(node.className || '')));
 }
 assert.equal(panel.hidden,true,'Saves and refresh leave the library collapsed');
 assert.equal(Number(elements.get('savedCount').textContent),rows.size);
 const cards=elements.get('savedAds').children;
 const originalRows=JSON.stringify([...rows]);
 const previousTransactions=transactions;
 for(const expanded of [true,false,true]){
  vm.runInContext('toggleSavedAds()',context);
  assert.equal(panel.hidden,!expanded);
  assert.equal(toggle.attributes['aria-expanded'],String(expanded));
  assert.equal(elements.get('savedLibraryChevron').textContent,expanded?'\u25b4':'\u25be');
  assert.equal(elements.get('savedAds').children,cards,'Toggling retains card nodes and handlers');
 }
 assert.equal(transactions,previousTransactions,'Toggling never reloads storage');
 assert.equal(JSON.stringify([...rows]),originalRows,'Toggling never writes or duplicates ads');
 const actionRow=cards[0].children[4];assert.equal(actionRow.className,'library-actions');
 actionRow.children[0].onclick();assert.ok(rows.has(opened._savedId),'Open action works after reopening');
 await vm.runInContext('refreshSavedAds()',context);assert.equal(panel.hidden,false,'Refresh preserves expanded state');
 const removed=[...rows][0];rows.delete(removed[0]);
 await vm.runInContext('refreshSavedAds()',context);assert.equal(Number(elements.get('savedCount').textContent),rows.size,'Count reflects removed storage records');
 rows.set(...removed);await vm.runInContext('refreshSavedAds()',context);
 console.log('PASS: collapsed initial state, accessible toggle/chevrons, stable nodes/storage, live count, reopened actions, wrapping button rows');
 await vm.runInContext('copyAdText(0)',context);assert.equal(clipboard,'Updated saved headline\n\nSame exact body\n\nShop now\n\n#toy');
 console.log('PASS: batches of 2/3/4, unique IDs, format dimensions, content/image/style preservation, save updates, library reload, clipboard text');
 selected=[{value:'0'},{value:'3'}];
 const before=rows.size;
 vm.runInContext('showDuplicate(0)',context);
 await vm.runInContext('Promise.all([confirmDuplicate(),confirmDuplicate()])',context);
 assert.equal(rows.size,before+2,'Repeated submit must only save one batch');
 const legacy=[...rows.values()][0];delete legacy.gradientDarkness;
 await vm.runInContext('refreshSavedAds()',context);
 vm.runInContext(`openSavedAd(${JSON.stringify(legacy.id)})`,context);
 assert.equal(vm.runInContext('gradientDarkness',context),25);
 assert.equal(rows.get(legacy.id).gradientDarkness,undefined,'Legacy records are not migrated or overwritten');
 console.log('PASS: saved darkness, duplicate preservation, legacy default');
 console.log('PASS: inline script syntax, minimum selection, repeated-submit protection');
})().catch(e=>{console.error(e);process.exitCode=1;});
