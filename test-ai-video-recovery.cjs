const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('ai-video.js', 'utf8');
const KEY = 'spectron-ai-video-recovery';
const OPERATION = 'interactions/mock-recovery';
const json = value => Response.json(value);

/** Build an isolated browser with no real network or persistent storage. */
function browser(storage = new Map()) {
  const elements = {
    aiVideoAspect:{value:'9:16'}, aiVideoPrompt:{value:'private prompt'}, aiVideoNoImage:{},
    generateAIVideoBtn:{}, outputMeta:{}, resultsArea:{}, aiVideoAgain:{}, aiVideoPreviousButton:{hidden:true},
    workspaceOutput:{hidden:true}, workspacePlaceholder:{hidden:false}, workspaceImagePreview:{hidden:false},
    aiVideoPreview:{readyState:2, dataset:{}, addEventListener(){}, load(){this.loaded = true;this.loads=(this.loads||0)+1;this.error=null;}},
    aiVideoPreviewError:{hidden:true}, aiVideoConfirmModal:{hidden:true},
    aiVideoConfirmButton:{focus(){}}, aiVideoCancelButton:{}, aiVideoRetryWarning:{}
  };
  const calls = [], warnings = [], timers = [], revoked = [], loadingStates=[];
  const window = {addEventListener(){}, sessionStorage:{
    getItem:key => storage.get(key) || null, setItem:(key, value) => storage.set(key, value)
  }};
  const context = vm.createContext({
    window, document:{getElementById:id => elements[id]}, selectedImage:'private image',
    setAdGenerationState(loading,mode){loadingStates.push({loading,mode});}, escapeHtml:String, Date,
    console:{warn:message => warnings.push(message), info(){}},
    URL:{createObjectURL:() => 'blob:mock-preview', revokeObjectURL:url => revoked.push(url)},
    setTimeout:fn => {timers.push(fn); return timers.length;}, clearTimeout(){},
    fetch:async (url, options) => {
      calls.push({url, method:options?.method || 'GET'});
      return state.respond(url, options);
    }
  });
  const state = {context, elements, calls, warnings, timers, storage, revoked, loadingStates,
    respond:async () => {throw new Error('Unexpected mocked request');}};
  vm.runInContext(source, context);
  context.normalizeAIVideoImage = async () => ({mimeType:'image/png', data:'YWJj'});
  return state;
}

/** Confirm the real modal, then wait for the submission to finish. */
async function submit(state, newRequest = false) {
  const pending = state.context.generateAIVideo(newRequest);
  assert.equal(state.elements.aiVideoConfirmModal.hidden, false);
  state.elements.aiVideoConfirmButton.onclick();
  await pending;
}
function recover(state) {
  state.storage.set(KEY, JSON.stringify({operation:OPERATION, aspectRatio:'16:9'}));
  state.context.restoreAIVideoRecovery();
}
const starts = state => state.calls.filter(call => call.method === 'POST').length;
const page = fs.readFileSync('spectron-social-studio.html', 'utf8');
const generateClick = page.match(/id="generateAIVideoBtn" onclick="([^"]+)"/)[1];

test('main Generate uses the newly selected photo; cancelling preserves the old request', async () => {
  const state = browser();
  const submittedImages = [];
  state.context.normalizeAIVideoImage = async () => ({mimeType:'image/png', data:Buffer.from(state.context.selectedImage).toString('base64')});
  state.respond = (url, options) => {
    if (options?.method === 'POST') {
      submittedImages.push(JSON.parse(options.body).images[0]);
      return json({operation:`interactions/mock-photo-${submittedImages.length}`});
    }
    return json({state:'completed', outputAvailable:false});
  };
  for (const photo of ['photo-A', 'photo-B']) {
    state.context.selectedImage = photo;
    const previous = state.storage.get(KEY);
    if (photo === 'photo-B') {
      const cancelled = vm.runInContext(generateClick, state.context);
      assert.equal(state.elements.aiVideoConfirmModal.hidden, false, 'A new photo must not silently resume the old operation');
      state.elements.aiVideoCancelButton.onclick();
      await cancelled;
      assert.equal(starts(state), 1);
      assert.equal(state.storage.get(KEY), previous, 'Cancel keeps the previous request recoverable');
    }
    const beforeConfirmation = starts(state);
    const generating = vm.runInContext(generateClick, state.context);
    assert.equal(state.elements.aiVideoConfirmModal.hidden, false);
    assert.equal(starts(state), beforeConfirmation, 'No request before confirmation');
    state.elements.aiVideoConfirmButton.onclick();
    await generating;
    const operation = JSON.parse(state.storage.get(KEY)).operation;
    await state.context.pollAIVideo(operation);
  }
  assert.deepEqual(submittedImages, ['photo-A','photo-B'].map(photo => `data:image/png;base64,${Buffer.from(photo).toString('base64')}`));
  const before = starts(state);
  await state.context.resumeAIVideo();
  assert.equal(starts(state), before, 'Explicit recovery still only reads the existing request');
  assert.match(state.calls.at(-1).url, /mock-photo-2/);
});

test('main Generate requires a photo even when an old request is available', async () => {
  const state = browser(); recover(state);
  state.context.selectedImage = null;
  await vm.runInContext(generateClick, state.context);
  assert.equal(state.elements.aiVideoNoImage.hidden, false);
  assert.equal(state.calls.length, 0);
  assert.equal(state.elements.aiVideoConfirmModal.hidden, true);
  assert.equal(JSON.parse(state.storage.get(KEY)).operation, OPERATION);
});

test('accepted ID is stored with orientation only; submission/polling block duplicate starts', async () => {
  const state = browser();
  let accept, notifySubmitted;
  const submitted = new Promise(resolve => {notifySubmitted = resolve;});
  state.respond = () => new Promise(resolve => {accept = resolve; notifySubmitted();});
  const pending = state.context.generateAIVideo();
  await state.context.generateAIVideo();
  assert.equal(starts(state), 0, 'confirmation is required');
  state.elements.aiVideoConfirmButton.onclick();
  await submitted;
  assert.equal(starts(state), 1);
  await state.context.generateAIVideo(true);
  await state.context.resumeAIVideo();
  assert.equal(starts(state), 1, 'in-flight start is locked');
  assert.deepEqual(JSON.parse(state.storage.get(KEY)), {operation:'', aspectRatio:'9:16'});
  accept(json({operation:OPERATION})); await pending;
  assert.deepEqual(JSON.parse(state.storage.get(KEY)), {operation:OPERATION, aspectRatio:'9:16'});
  assert.doesNotMatch(state.storage.get(KEY), /private|YWJj|blob:|key|prompt|image/);
  assert.match(state.elements.outputMeta.textContent, /in behandeling/);
  await state.context.generateAIVideo(true);
  assert.equal(starts(state), 1, 'polling also blocks starts');
});

test('refresh stays quiet; previous-video action checks the ID without image or paid confirmation', async () => {
  const state = browser(); recover(state);
  assert.equal(state.calls.length, 0, 'restore does not submit or poll automatically');
  assert.equal(state.elements.workspaceOutput.hidden, true, 'refresh must not reveal the output');
  assert.equal(state.elements.workspacePlaceholder.hidden, false);
  assert.equal(state.elements.workspaceImagePreview.hidden, false);
  assert.equal(state.elements.resultsArea.innerHTML, undefined);
  assert.equal(state.elements.aiVideoPreviousButton.hidden, false);
  state.context.selectedImage = null;
  state.respond = () => json({state:'pending'});
  await state.context.openPreviousAIVideo();
  assert.equal(starts(state), 0);
  assert.match(state.calls[0].url, /operation=interactions%2Fmock-recovery$/);
  assert.match(state.elements.outputMeta.textContent, /vorige video wordt nog verwerkt/);
  assert.deepEqual(state.loadingStates,[{loading:true,mode:'restore'}]);
  assert.match(state.elements.resultsArea.innerHTML,/geen nieuwe video gestart/);
  assert.doesNotMatch(state.elements.resultsArea.innerHTML,/geschatte|gegenereerd|\d+%/);
});

test('poll errors and monitoring timeout retain ID and allow GET-only recovery', async () => {
  const state = browser(); recover(state);
  state.respond = () => {throw new TypeError('offline');};
  await state.context.resumeAIVideo();
  assert.match(state.elements.outputMeta.textContent, /statuscontrole onderbroken/);
  assert.match(state.elements.resultsArea.innerHTML, /resumeAIVideo/);
  assert.doesNotMatch(state.elements.resultsArea.innerHTML, />Opnieuw proberen<|onclick="generateAIVideo\(\)"/);
  assert.equal(JSON.parse(state.storage.get(KEY)).operation, OPERATION);
  state.respond = () => json({state:'pending'});
  await state.context.resumeAIVideo();
  vm.runInContext('aiVideoPollStarted=Date.now()-420000', state.context);
  const before = state.calls.length;
  await state.context.pollAIVideo(OPERATION);
  assert.equal(state.calls.length, before);
  assert.match(state.elements.resultsArea.innerHTML, /Google is mogelijk nog bezig/);
  assert.doesNotMatch(state.elements.outputMeta.textContent, /mislukt/);
  await state.context.resumeAIVideo();
  assert.equal(starts(state), 0);
});

test('HTTP, malformed and unexpected status responses interrupt monitoring without losing the ID', async () => {
  for (const response of [() => new Response('bad gateway', {status:502}),
    () => new Response('{', {headers:{'Content-Type':'application/json'}}),
    () => json({state:'unsupported'})]) {
    const state = browser(); recover(state);
    state.respond = response;
    await state.context.resumeAIVideo();
    assert.match(state.elements.outputMeta.textContent, /statuscontrole onderbroken/);
    assert.equal(JSON.parse(state.storage.get(KEY)).operation, OPERATION);
    assert.match(state.elements.resultsArea.innerHTML, /resumeAIVideo/);
    assert.equal(starts(state), 0);
  }
});

test('failed, completed-without-output and unknown statuses are distinct and retain recovery', async () => {
  for (const [result, title] of [
    [{state:'failed', message:'Google meldt een mislukte aanvraag'}, /mislukt/],
    [{state:'completed', outputAvailable:false, category:'output-unavailable'}, /voltooid, resultaat niet beschikbaar/],
    [{state:'unknown'}, /statuscontrole onderbroken/]
  ]) {
    const state = browser(); recover(state);
    state.respond = () => json(result);
    await state.context.resumeAIVideo();
    assert.match(state.elements.outputMeta.textContent, title);
    assert.equal(JSON.parse(state.storage.get(KEY)).operation, OPERATION);
    assert.equal(starts(state), 0);
    assert.match(state.elements.resultsArea.innerHTML, /Nieuwe betaalde video \(bevestiging vereist\)/);
  }
});

test('new paid generation needs separate confirmation; cancelling preserves the existing ID', async () => {
  const state = browser(); recover(state);
  state.respond = () => json({operation:'interactions/mock-new'});
  const cancelled = state.context.generateAIVideo(true);
  assert.equal(state.elements.aiVideoRetryWarning.hidden, false);
  state.elements.aiVideoCancelButton.onclick(); await cancelled;
  assert.equal(starts(state), 0);
  assert.equal(JSON.parse(state.storage.get(KEY)).operation, OPERATION);
  await submit(state, true);
  assert.equal(starts(state), 1);
  assert.equal(JSON.parse(state.storage.get(KEY)).operation, 'interactions/mock-new');
});

test('completed recovery downloads MP4 to Blob preview; download/browser errors retry without POST', async () => {
  const state = browser(); recover(state);
  let downloadFails = true;
  state.respond = url => url.includes('veo-video-status') ? json({state:'completed', outputAvailable:true})
    : downloadFails ? new Response('unavailable', {status:502})
    : new Response('mock-mp4', {headers:{'Content-Type':'video/mp4'}});
  await state.context.resumeAIVideo();
  assert.match(state.elements.outputMeta.textContent, /voltooid, voorbeeld niet beschikbaar/);
  assert.equal(state.elements.aiVideoPreviewError.hidden, false);
  downloadFails = false;
  await state.context.resumeAIVideo();
  assert.equal(state.elements.aiVideoPreview.src, 'blob:mock-preview');
  assert.equal(state.elements.aiVideoPreview.loaded, true);
  assert.equal(state.elements.aiVideoPreview.dataset.previewRatio, 'landscape');
  assert.match(state.elements.outputMeta.textContent, /voltooid$/);
  state.elements.aiVideoPreview.onerror();
  assert.match(state.elements.outputMeta.textContent, /voltooid, voorbeeld niet beschikbaar/);
  await state.context.resumeAIVideo();
  assert.deepEqual(state.revoked, ['blob:mock-preview']);
  assert.equal(starts(state), 0);
});

function cacheablePreview(state){
  const result={id:'ready-preview'};
  state.elements.resultsArea.firstElementChild=result;
  state.elements.resultsArea.contains=node=>state.elements.resultsArea.firstElementChild===node;
  state.elements.resultsArea.replaceChildren=node=>{state.elements.resultsArea.firstElementChild=node;};
  state.respond=url=>url.includes('veo-video-status')?json({state:'completed',outputAvailable:true}):new Response('mock-mp4',{headers:{'Content-Type':'video/mp4'}});
  return result;
}

test('previous button reveals the same ready preview repeatedly without network, progress or resetting playback',async()=>{
  const state=browser();recover(state);const result=cacheablePreview(state);
  await state.context.resumeAIVideo();
  const calls=state.calls.length,loading=state.loadingStates.length;
  state.elements.aiVideoPreview.currentTime=3.5;
  state.elements.workspaceOutput.hidden=true;state.elements.workspaceImagePreview.hidden=false;
  // The workflow cache can detach the old result; Previous must reattach the same node.
  state.elements.resultsArea.firstElementChild=null;
  for(let i=0;i<3;i++)await state.context.openPreviousAIVideo();
  assert.equal(state.calls.length,calls);assert.equal(state.loadingStates.length,loading);
  assert.equal(state.elements.resultsArea.firstElementChild,result);
  assert.equal(state.elements.workspaceOutput.hidden,false);assert.equal(state.elements.workspaceImagePreview.hidden,true);
  assert.equal(state.elements.aiVideoPreview.currentTime,3.5);assert.equal(state.elements.aiVideoPreview.loads,1);
  assert.equal(state.revoked.length,0);assert.equal(starts(state),0);
});

test('wrong-operation and broken-source previews never bypass recovery; explicit reload still checks/downloads',async()=>{
  for(const mode of ['operation','source','reload']){
    const state=browser();recover(state);cacheablePreview(state);await state.context.resumeAIVideo();
    const count=state.calls.length;
    if(mode==='operation')vm.runInContext("aiVideoOperation='interactions/other-video'",state.context);
    if(mode==='source')state.elements.aiVideoPreview.src='blob:unrelated';
    if(mode==='reload')await state.context.resumeAIVideo();else await state.context.openPreviousAIVideo();
    assert.equal(state.calls.length,count+2);assert.equal(starts(state),0);
    assert.equal(state.loadingStates.at(-2).mode,'restore');
    if(mode==='operation')assert.match(state.calls[count].url,/other-video/);
  }
});

test('after refresh the previous ID is read again without confirmation or generation progress',async()=>{
  const original=browser();recover(original);cacheablePreview(original);await original.context.resumeAIVideo();
  const refreshed=browser(original.storage);refreshed.context.selectedImage=null;
  refreshed.context.restoreAIVideoRecovery();cacheablePreview(refreshed);
  await refreshed.context.openPreviousAIVideo();
  assert.equal(refreshed.calls.length,2);assert.equal(starts(refreshed),0);
  assert.equal(refreshed.elements.aiVideoConfirmModal.hidden,true);
  assert.equal(refreshed.loadingStates[0].mode,'restore');
});

test('a media error during the ready-frame hold is not cached or relabelled as a playable success',async()=>{
  const state=browser();recover(state);cacheablePreview(state);
  state.context.window.studioProgress={stop(){},complete:async()=>{state.elements.aiVideoPreview.error={code:4};return true;}};
  state.context.setAIVideoLoading(true);
  await state.context.showAIVideoPreview(OPERATION);
  assert.match(state.elements.outputMeta.textContent,/voorbeeld niet beschikbaar/);
  const count=state.calls.length;
  await state.context.openPreviousAIVideo();
  assert.equal(state.calls.length,count+2);assert.equal(starts(state),0);
  assert.match(state.elements.outputMeta.textContent,/voltooid$/);
});

test('lost start response stores only an uncertainty marker; refresh never resubmits', async () => {
  const state = browser();
  state.respond = () => {throw new TypeError('network lost');};
  await submit(state);
  assert.match(state.elements.resultsArea.innerHTML, /geen aanvraagnummer.*niet bevestigd/);
  assert.doesNotMatch(state.elements.resultsArea.innerHTML, /resumeAIVideo/);
  const refreshed = browser(state.storage);
  refreshed.context.restoreAIVideoRecovery();
  assert.equal(refreshed.elements.resultsArea.innerHTML, undefined);
  assert.equal(refreshed.elements.workspaceOutput.hidden, true);
  assert.equal(refreshed.elements.aiVideoPreviousButton.hidden, false);
  await refreshed.context.openPreviousAIVideo();
  assert.match(refreshed.elements.resultsArea.innerHTML, /geen aanvraagnummer/);
  assert.equal(refreshed.calls.length, 0);
  const cancelled = refreshed.context.generateAIVideo(true);
  assert.equal(refreshed.elements.aiVideoRetryWarning.hidden, false);
  refreshed.elements.aiVideoCancelButton.onclick();
  await cancelled;
  await refreshed.context.resumeAIVideo();
  assert.equal(refreshed.calls.length, 0);
});

test('invalid, missing or blocked sessionStorage cannot crash or trigger a request', async () => {
  for (const raw of ['{', 'null', '[]', '{}',
    JSON.stringify({operation:'https://private.test', aspectRatio:'9:16'}),
    JSON.stringify({operation:OPERATION, aspectRatio:'4:3'})]) {
    const state = browser(new Map([[KEY, raw]]));
    assert.doesNotThrow(() => state.context.restoreAIVideoRecovery());
    await state.context.openPreviousAIVideo();
    assert.equal(state.elements.aiVideoPreviousButton.hidden, true);
    assert.equal(state.elements.workspaceOutput.hidden, true);
    assert.equal(state.calls.length, 0);
    assert.doesNotMatch(state.warnings.join(' '), /private.test/);
  }
  for (const mode of ['missing', 'blocked', 'quota']) {
    const state = browser();
    if (mode === 'missing') delete state.context.window.sessionStorage;
    else if (mode === 'blocked') Object.defineProperty(state.context.window, 'sessionStorage', {
      get(){throw new Error('private detail');}
    });
    else state.context.window.sessionStorage.setItem = () => {throw new Error('quota');};
    assert.doesNotThrow(() => state.context.restoreAIVideoRecovery());
    state.respond = url => url.includes('start-veo-video') ? json({operation:OPERATION}) : json({state:'pending'});
    await submit(state);
    vm.runInContext('aiVideoRunning=false', state.context);
    await state.context.resumeAIVideo();
    assert.equal(starts(state), 1, 'in-memory ID still permits recovery');
    assert.match(state.calls.at(-1).url, /mock-recovery/);
    assert.doesNotMatch(state.warnings.join(' '), /private detail/);
  }
});
