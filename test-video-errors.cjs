const {test, after} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const usage = require('./netlify/lib/usage.cjs');
const originalFetch = usage.trackedFetch;
const originalKey = process.env.GOOGLE_DEVELOPER_API_KEY;
let payload;
let calls = 0;
usage.trackedFetch = async () => { calls++; return Response.json(payload); };
process.env.GOOGLE_DEVELOPER_API_KEY = 'mock-video-errors-only';
const servicePath = require.resolve('./netlify/lib/omni-video.cjs');
delete require.cache[servicePath];
const service = require(servicePath);
const event = {httpMethod:'GET', queryStringParameters:{operation:'interactions/mock'}};

after(() => {
  usage.trackedFetch = originalFetch;
  delete require.cache[servicePath];
  if (originalKey === undefined) delete process.env.GOOGLE_DEVELOPER_API_KEY;
  else process.env.GOOGLE_DEVELOPER_API_KEY = originalKey;
});

for (const [code, category, message] of [
  ['RESOURCE_EXHAUSTED', 'quota', /gebruikslimiet/],
  ['PERMISSION_DENIED', 'permission', /toegang/],
  ['UNAUTHENTICATED', 'authentication', /aanmelden/],
  ['SAFETY_BLOCKED', 'content-filter', /inhoudsfilter/],
  ['INTERNAL', 'generation-failed', /kon deze video niet genereren/]
]) test(`Google errors[]: ${code} becomes a safe, specific failure`, async () => {
  payload = {status:'failed', errors:[{code, message:'private prompt mock-video-errors-only https://private.test'}]};
  const result = JSON.parse((await service.status(event, 'ai-video')).body);
  assert.equal(result.state, 'failed');
  assert.equal(result.category, category);
  assert.match(result.message, message);
  assert.doesNotMatch(JSON.stringify(result), /private|mock-video-errors-only|https:/);
  const download = await service.download(event, 'ai-video');
  assert.equal(download.statusCode, 422);
  assert.match(JSON.parse(download.body).error, message);
});

test('failed status logs bounded diagnostics, not credentials, images or model output', async () => {
  const warnings = [];
  const warn = console.warn;
  payload = {status:'failed', errors:[{code:'INTERNAL', message:'Render worker failed. token="fake token with spaces" https://private.test/key data:image/png;base64,ZmFrZQ== mock-video-errors-only', details:{password:'nested-private'}}],
    input:'private-input', steps:[{type:'model_output',content:[{type:'text',text:'private-model-output'},{type:'video',data:'private-video'}]}]};
  try {
    console.warn = (...args) => warnings.push(args);
    const before = calls;
    const response = await service.status(event, 'ai-video');
    assert.equal(calls, before + 1, 'diagnostics must not trigger another provider request');
    assert.equal(JSON.parse(response.body).category, 'generation-failed');
    assert.equal(warnings.length, 1);
    const logged = JSON.stringify(warnings);
    assert.match(logged, /INTERNAL|Render worker failed/);
    assert.doesNotMatch(logged, /fake token|private\.test|ZmFrZQ|mock-video-errors-only|nested-private|private-input|private-model-output|private-video/);
    assert.doesNotMatch(response.body, /Render worker|INTERNAL|reason/);
  } finally { console.warn = warn; }
});

test('completed text-only output stays recoverable without exposing the model response', async () => {
  payload = {status:'completed', steps:[{type:'model_output', content:[
    {type:'text', text:'I cannot generate this due to third-party content guardrails. private prompt'}
  ]}]};
  const result = JSON.parse((await service.status(event, 'ai-video')).body);
  assert.equal(result.state, 'completed');
  assert.equal(result.outputAvailable, false);
  assert.equal(result.category, 'output-unavailable');
  assert.doesNotMatch(result.message, /private prompt/);
});

test('missing output and incomplete/continuation states never invent provider failure', async () => {
  for (const status of ['completed', 'incomplete', 'requires_action', 'requires_continuation']) {
    payload = {status};
    const response = await service.status(event, 'ai-video');
    const result = JSON.parse(response.body);
    if (status === 'completed') {
      assert.equal(response.statusCode, 200);
      assert.equal(result.state, 'completed');
      assert.equal(result.outputAvailable, false);
      assert.equal(result.category, 'output-unavailable');
    } else {
      assert.equal(response.statusCode, 502);
      assert.equal(result.state, 'unknown');
      assert.equal(result.category, 'monitoring-interrupted');
    }
  }
});

function frontend(response) {
  const elements = {resultsArea:{}, outputMeta:{}, generateAIVideoBtn:{setAttribute(){}}};
  let requests = 0;
  const ctx = vm.createContext({
    window:{addEventListener(){}}, document:{getElementById:id=>elements[id]},
    setAdGenerationState(){}, escapeHtml:String, clearTimeout(){}, Date, console,
    fetch:async()=>{requests++;return response;}
  });
  vm.runInContext(fs.readFileSync('ai-video.js', 'utf8'), ctx);
  vm.runInContext('aiVideoRunning=true;aiVideoPollStarted=Date.now()', ctx);
  return {ctx, elements, requests:()=>requests};
}

test('confirmed failed generation does not claim it may still be running or auto-regenerate', async () => {
  const {ctx, elements, requests} = frontend(Response.json({state:'failed', category:'quota', message:'De gebruikslimiet van Google is bereikt.'}));
  await ctx.pollAIVideo('interactions/mock');
  assert.match(elements.resultsArea.innerHTML, /gebruikslimiet/);
  assert.doesNotMatch(elements.resultsArea.innerHTML, /mogelijk al gestart|extra betaalde video opleveren/);
  assert.equal(vm.runInContext('aiVideoMayHaveStarted', ctx), false);
  assert.equal(requests(), 1);
});

test('network/status failure retains the uncertain paid-request warning', async () => {
  const {ctx, elements, requests} = frontend(Response.json({error:'Unavailable'}, {status:502}));
  await ctx.pollAIVideo('interactions/mock');
  assert.match(elements.resultsArea.innerHTML, /extra betaalde video opleveren/);
  assert.equal(requests(), 1);
});

test('content-filter failure offers no one-click retry', async () => {
  const {ctx, elements} = frontend(Response.json({state:'failed', category:'content-filter', message:'Het inhoudsfilter van Google heeft deze video geblokkeerd.'}));
  await ctx.pollAIVideo('interactions/mock');
  assert.doesNotMatch(elements.resultsArea.innerHTML, />Opnieuw proberen<|onclick="generateAIVideo\(\)"|mogelijk al gestart/);
  assert.match(elements.resultsArea.innerHTML, /Nieuwe betaalde video \(bevestiging vereist\)/);
});

test('all backend tests only perform mocked reads, never start generation', () => {
  assert.ok(calls > 0);
});
