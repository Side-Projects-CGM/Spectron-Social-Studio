const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const page=fs.readFileSync('spectron-social-studio.html','utf8');
const stores=new Map([['ads',new Map([['existing',{id:'existing',savedAt:'2026-01-01',format:'1080x1080',variant:{headline:'Keep',body:'',cta:''},visual:{imgScale:1,imgPosX:50,imgPosY:50,textScale:1}}]])]]);
let version=1, failWrites=false, queue=Promise.resolve();
const db={objectStoreNames:{contains:name=>stores.has(name)},createObjectStore(name){stores.set(name,new Map());},close(){},transaction(name,mode){
 const tx={};let finish;const done=new Promise(resolve=>{finish=resolve;});const previous=queue;queue=done;
 previous.then(()=>setTimeout(()=>{
  if(mode==='readwrite' && failWrites){tx.error=new Error('QuotaExceededError');tx.onabort?.();finish();return;}
  if(request){request.result=structuredClone([...stores.get(name).values()]);request.onsuccess();}
  for(const record of writes) stores.get(name).set(record.id,structuredClone(record));
  tx.oncomplete?.();finish();
 },0));
 let request;const writes=[];
 tx.objectStore=()=>({getAll(){request={};return request;},put(record){writes.push(record);}});return tx;
}};
const indexedDB={open(name,next){assert.equal(name,'spectron-saved-ads');const request={};queueMicrotask(()=>{request.result=db;if(version<next){request.onupgradeneeded();version=next;}request.onsuccess();});return request;}};
function session(){
 const elements=new Map();const el=id=>{if(!elements.has(id)) elements.set(id,{value:'',setAttribute(){},removeAttribute(key){delete this[key];},style:{setProperty(name,value){this[name]=value;}},textContent:'',innerHTML:'',classList:{add(){}},append(){},replaceChildren(){},scrollIntoView(){},getAttribute(){return context.selectedImage;}});return elements.get(id);};
 el('brand').value='Bluey';
 const context=vm.createContext({console,structuredClone,indexedDB,crypto:require('node:crypto').webcrypto,
  document:{getElementById:el,createElement:()=>el(Symbol()),querySelector:()=>el('image'),querySelectorAll:selector=>selector === '.gallery-arrow' ? [el('prevArrow'),el('nextArrow')] : []},
  activeStudioWorkflow:null,studioWorkflowViewState:{advertisement:null,video:null},brandImageRecords:[],uploadedImages:[],uploadedLibraryImages:{},BRAND_IMAGES:{Bluey:['original.png'],Stitch:['stitch.png']},selectedImage:'original.png',currentBrand:'Bluey',variantVisuals:[],
  escapeHtml:value=>String(value).replaceAll('"','&quot;'),SPECTRON_LOGO_SRC:'logo.png',selectVariant(){},applyImageTransform(){},applyTextScale(){},
  canvasResizeObserver:{disconnect(){},observe(){}},imgScale:1,imgPosX:50,imgPosY:50,DEFAULT_TEXT_SCALE:1.5,
  getFormatSpec(){return {width:context.testWidth || 1080,height:context.testHeight,value:`${context.testWidth || 1080}x${context.testHeight}`};},
  PLATFORM_LIMITS:{'Instagram / Facebook post':{mock:'social'},'Instagram / Facebook story':{mock:'social'},TikTok:{mock:'social'},'Google Ads (zoekadvertentie)':{mock:'google'},LinkedIn:{mock:'linkedin'}}
 });
 const run=code=>vm.runInContext(code,context);
 run(page.slice(page.indexOf('const DEFAULT_GRADIENT_DARKNESS'),page.indexOf('const DEFAULT_TEXT_SCALE')));
 run(page.slice(page.indexOf('let workspacePreviewSource ='),page.indexOf("document.getElementById('uploadInput').addEventListener")));
 run(page.slice(page.indexOf('function renderResults('),page.indexOf('function onEdit(')));
 run(fs.readFileSync('studio-library.js','utf8'));
 return {context,run,el};
}
(async()=>{
 let {context,run,el}=session();await run('refreshBrandImages()');
 const arrowsHidden=expected=>{
  assert.equal(el('prevArrow').hidden,expected);
  assert.equal(el('nextArrow').hidden,expected);
 };
 assert.equal([...page.matchAll(/<button[^>]*class="gallery-arrow (?:prev|next)"[^>]* hidden/g)].length,2,'Both arrows hidden before JavaScript runs');
 el('brand').value='';run('renderImageGallery()');arrowsHidden(true);
 context.BRAND_IMAGES.Bluey=[];el('brand').value='Bluey';run('renderImageGallery()');arrowsHidden(true);
 context.BRAND_IMAGES.Bluey=['original.png'];run('renderImageGallery()');arrowsHidden(true);
 context.BRAND_IMAGES.Bluey=['original.png','second.png'];run('renderImageGallery()');arrowsHidden(false);
 el('brand').value='Stitch';run('renderImageGallery()');arrowsHidden(true);
 el('brand').value='Bluey';run('renderImageGallery()');arrowsHidden(false);
 el('brand').value='';context.uploadedImages=['upload-a.png','upload-b.png'];run('renderImageGallery()');arrowsHidden(true);
 el('brand').value='invalid';run('renderImageGallery()');arrowsHidden(true);
 el('brand').value='Bluey';context.BRAND_IMAGES.Bluey=['original.png'];context.uploadedImages=[];
 run('renderImageGallery()');arrowsHidden(true);
 context.uploadedImages=['upload-a.png'];run('renderImageGallery()');arrowsHidden(false);
 context.uploadedImages=[];run('renderImageGallery()');arrowsHidden(true);
 const scrolls=[];el('imgGallery').clientWidth=400;el('imgGallery').scrollBy=options=>scrolls.push(options);
 run('scrollGallery(-1);scrollGallery(1)');
 assert.deepEqual(scrolls.map(item=>item.left),[-312,312]);
 assert.ok(scrolls.every(item=>item.behavior==='smooth'));
 assert.equal(version,2);assert.equal(stores.get('ads').size,1,'Upgrade preserves saved advertisements');
 const image='data:image/png;base64,YWJj';
 context.record={id:require('node:crypto').randomUUID(),brand:'Bluey',image,source:'ai-background',prompt:'Snow',createdAt:new Date().toISOString(),originalImage:'original.png',originalImageId:null};
 await run('Promise.all([persistBrandImage(record),persistBrandImage({...record,id:crypto.randomUUID()})])');
 assert.equal(stores.get('brandImages').size,1);assert.equal(context.brandImageRecords.length,1);
 run('selectImage(record.image)');assert.equal(context.selectedImage,image);arrowsHidden(true);
 // The latest picker excludes saved AI images, but their stored records remain usable by ads.
 assert.doesNotMatch(el('imgGallery').innerHTML,/ai-image-badge/);assert.ok(!el('imgGallery').innerHTML.includes(image));
 ({context,run,el}=session());await run('refreshBrandImages()');
 assert.equal(context.brandImageRecords.length,1);assert.equal(context.brandImageRecords[0].prompt,'Snow');arrowsHidden(true);
 run('selectImage(brandImageRecords[0].image)');assert.equal(context.selectedImage,image);
 for(const source of [image,'uploaded.png','spectron-logo.webp',null]){
 context.selectedImage=source;
 for(const [platform,height,width] of [['Instagram / Facebook post',1080],['Instagram / Facebook post',1350],['Instagram / Facebook post',628,1200],['Instagram / Facebook story',1920],['TikTok',1920],['Google Ads (zoekadvertentie)',1080],['LinkedIn',1080]]){
  context.testWidth=width;context.testHeight=height;context.platform=platform;
  run("renderResults(Array.from({length:4},()=>({headline:'Spectron ad',body:'Body',cta:'Shop'})),platform,'Toy',false)");
  if(source) assert.ok(el('resultsArea').innerHTML.includes(source),platform+' preserves image pixels/source');
  assert.doesNotMatch(el('resultsArea').innerHTML,/ad-logo|saved-logo|ai-image-badge/);
  for(let i=0;i<4;i++) assert.ok(el('resultsArea').innerHTML.includes('cardVisual-'+i));
  assert.match(el('resultsArea').innerHTML,/Spectron ad/);
  assert.equal(run('snapshotAd(0).image'),source,platform+' saves selected image');
 }
 }
 el('brand').value='Stitch';context.selectedImage=null;run('renderImageGallery()');
 assert.ok(!el('imgGallery').innerHTML.includes(image),'Brand images stay with their brand');
 failWrites=true;context.record={id:'failed',brand:'Stitch',image:'failed.png'};
 await assert.rejects(run('persistBrandImage(record)'));
 assert.equal(stores.get('brandImages').size,1);assert.equal(context.brandImageRecords.length,1);
 console.log('PASS: gallery arrows on initial load, empty/single/multiple images, brand switch/reset, uploads, accepted AI image, refresh, unchanged scrolling');
 console.log('PASS: database upgrade, committed saves, transactional deduplication, refresh persistence, saved-AI picker exclusion, brand scope, selection, all ad renderers, saved ad image, storage failure');
})().catch(error=>{console.error(error);process.exitCode=1;});
