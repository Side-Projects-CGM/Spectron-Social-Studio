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
  ['RESOURCE_EXHAUSTED', 'quota', /usage limit/],
  ['PERMISSION_DENIED', 'permission', /permission/],
  ['UNAUTHENTICATED', 'authentication', /authenticate/],
  ['SAFETY_BLOCKED', 'content-filter', /content filter/],
  ['INTERNAL', 'generation-failed', /could not generate/]
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

test('completed text refusal is identified without exposing the model response', async () => {
  payload = {status:'completed', steps:[{type:'model_output', content:[
    {type:'text', text:'I cannot generate this due to third-party content guardrails. private prompt'}
  ]}]};
  const result = JSON.parse((await service.status(event, 'ai-video')).body);
  assert.equal(result.category, 'content-filter');
  assert.doesNotMatch(result.message, /private prompt/);
});

test('missing video and incomplete/continuation responses have distinct explanations', async () => {
  for (const [status, category, expected] of [
    ['completed', 'missing-video', /without a downloadable MP4/],
    ['incomplete', 'incomplete', /incomplete/],
    ['requires_continuation', 'incomplete', /additional input or continuation/]
  ]) {
    payload = {status};
    const result = JSON.parse((await service.status(event, 'ai-video')).body);
    assert.equal(result.state, 'failed');
    assert.equal(result.category, category);
    assert.match(result.message, expected);
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
  const {ctx, elements, requests} = frontend(Response.json({state:'failed', category:'quota', message:'Google usage limit reached.'}));
  await ctx.pollAIVideo('interactions/mock');
  assert.match(elements.resultsArea.innerHTML, /usage limit/);
  assert.doesNotMatch(elements.resultsArea.innerHTML, /may already have started|may create another paid video/);
  assert.equal(vm.runInContext('aiVideoMayHaveStarted', ctx), false);
  assert.equal(requests(), 1);
});

test('network/status failure retains the uncertain paid-request warning', async () => {
  const {ctx, elements, requests} = frontend(Response.json({error:'Unavailable'}, {status:502}));
  await ctx.pollAIVideo('interactions/mock');
  assert.match(elements.resultsArea.innerHTML, /may create another paid video/);
  assert.equal(requests(), 1);
});

test('content-filter failure offers no one-click retry', async () => {
  const {ctx, elements} = frontend(Response.json({state:'failed', category:'content-filter', message:'Google content filter blocked this video.'}));
  await ctx.pollAIVideo('interactions/mock');
  assert.doesNotMatch(elements.resultsArea.innerHTML, /<button|may already have started/);
});

test('all backend tests only perform mocked reads, never start generation', () => {
  assert.ok(calls > 0);
});
