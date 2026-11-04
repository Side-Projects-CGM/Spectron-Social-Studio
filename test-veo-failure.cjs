const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const usage = require('./netlify/lib/usage.cjs');

test('production status, logs and usage preserve failure reasons with mocked network and storage', async () => {
  const records = [], logs = [];
  const original = usage.trackedFetch, originalWarn = console.warn, originalKey = process.env.GEMINI_API_KEY;
  const paths = ['./netlify/functions/veo-test-status.cjs','./netlify/functions/veo-video-status.cjs'].map(require.resolve);
  let payload, calls = 0;
  process.env.GEMINI_API_KEY = 'mock-secret';
  usage.trackedFetch = usage.createTracker({storeFactory:()=>({async setJSON(key,value){records.push(value);}}),
    fetcher:async()=>{calls++;return new Response(JSON.stringify(payload));}}).trackedFetch;
  console.warn = (...args)=>logs.push(args);
  paths.forEach(p=>delete require.cache[p]);
  try {
    const handler = require(paths[1]).handler;
    const cases = [
      [{done:true,response:{generateVideoResponse:{raiMediaFilteredCount:1,raiMediaFilteredReasons:['The uploaded image contains a child. Please use an image of an adult.']}}}, /content filter/],
      [{done:true,error:{message:'The video could not be generated because the image is too small.'}}, /image is too small/],
      [{done:true,error:{message:'Please use an image of an adult. Internal URL https://private.test?key=mock-secret',details:{stack:'private stack'}}}, /image of an adult/],
      [{done:true}, /Google reported/],
      [{done:true,error:{message:'SAFETY_BLOCKED'}}, /safety checks/],
      [{done:true,response:{generateVideoResponse:{raiMediaFilteredCount:1,raiMediaFilteredReasons:['Guardrails related to third-party content.']}}}, /third-party artwork/],
    ];
    for (const [body, expected] of cases) {
      payload = body;
      const response = await handler({httpMethod:'GET',queryStringParameters:{operation:'operations/mock'}});
      assert.equal(response.statusCode,200);
      const result = JSON.parse(response.body);
      assert.equal(result.state,'failed');assert.match(result.message,expected);
      assert.doesNotMatch(response.body,/mock-secret|private|stack|https:/);
      const record = records.at(-1);
      assert.equal(record.operationState,'failed');assert.ok(record.failureReason);
      assert.equal(logs.at(-1)[1].reason,record.failureReason);
      assert.doesNotMatch(record.failureReason,/mock-secret/);
    }
    assert.match(records[1].failureReason,/contains a child/);
    assert.match(records[5].failureReason,/private stack/);
    assert.doesNotMatch(JSON.stringify(usage.summarize(records)),/failureReason|private stack/);
    payload={done:false};assert.equal(JSON.parse((await handler({httpMethod:'GET',queryStringParameters:{operation:'operations/mock'}})).body).state,'pending');
    payload={done:true,response:{generatedVideos:[{video:{uri:'mock-video'}}]}};
    assert.equal(JSON.parse((await handler({httpMethod:'GET',queryStringParameters:{operation:'operations/mock'}})).body).state,'completed');
    assert.equal(calls,8);
    assert.match(records[11].failureReason,/third-party content/);
  } finally {
    usage.trackedFetch=original;console.warn=originalWarn;paths.forEach(p=>delete require.cache[p]);
    if(originalKey===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=originalKey;
  }
});

test('page displays the confirmed failure reason without an uncertain retry warning or regeneration', async()=>{
  const elements={resultsArea:{},outputMeta:{},generateAIVideoBtn:{setAttribute(){}}};let calls=0;
  const ctx=vm.createContext({window:{addEventListener(){}},document:{getElementById:id=>elements[id]},
    setAdGenerationState(){},escapeHtml:s=>s,clearTimeout(){},Date,console,
    fetch:async()=>{calls++;return new Response(JSON.stringify({state:'failed',message:'Google safety checks blocked this video request. Please use an image of an adult.'}),{headers:{'Content-Type':'application/json'}});}});
  vm.runInContext(fs.readFileSync('ai-video.js','utf8'),ctx);
  vm.runInContext('aiVideoRunning=true;aiVideoPollStarted=Date.now()',ctx);
  await ctx.pollAIVideo('operations/mock');
  assert.match(elements.resultsArea.innerHTML,/image of an adult/);
  assert.doesNotMatch(elements.resultsArea.innerHTML,/Starting again may create another paid video/);
  assert.equal(calls,1);
});

test('third-party guardrails produce a content-filter message and no one-click retry', async()=>{
  const {failureDetails}=require('./netlify/lib/veo-failure.cjs');
  for(const response of [
    {generateVideoResponse:{raiMediaFilteredCount:1,raiMediaFilteredReasons:['Your request was blocked by guardrails related to third-party content.']}},
    {raiMediaFilteredCount:1,raiMediaFilteredReasons:['Your request was blocked by guardrails related to third-party content.']},
    {generateVideoResponse:{raiMediaFilteredCount:1}},
  ]) {
    const failure=failureDetails({done:true,response});
    assert.equal(failure.category,'content-filter');
    assert.match(failure.message,/other brands' logos or licensed characters/);
    assert.match(failure.message,/different product photo without third-party artwork/);
    const elements={resultsArea:{},outputMeta:{},generateAIVideoBtn:{setAttribute(){}}};let calls=0;
    const ctx=vm.createContext({window:{addEventListener(){}},document:{getElementById:id=>elements[id]},
      setAdGenerationState(){},escapeHtml:s=>s,clearTimeout(){},Date,console,
      fetch:async()=>{calls++;return new Response(JSON.stringify({state:'failed',message:failure.message,category:failure.category}),{headers:{'Content-Type':'application/json'}});}});
    vm.runInContext(fs.readFileSync('ai-video.js','utf8'),ctx);
    vm.runInContext('aiVideoRunning=true;aiVideoPollStarted=Date.now()',ctx);
    await ctx.pollAIVideo('operations/mock');
    assert.match(elements.resultsArea.innerHTML,/content filter/);
    assert.doesNotMatch(elements.resultsArea.innerHTML,/<button|generateAIVideo|Google safety checks or Veo generation failed/);
    assert.doesNotMatch(elements.resultsArea.innerHTML,/Starting again may create another paid video/);
    assert.equal(calls,1);
  }
  assert.match(fs.readFileSync('spectron-social-studio.html','utf8'),/ai-video\.js\?v=video-failure-details-4/);
});
