const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

for (const path of ['spectron-social-studio.html', 'usage.html', 'veo-test.html']) {
  test(`${path}: Dutch page language and no old English interface labels`, () => {
    const html = fs.readFileSync(path, 'utf8');
    assert.match(html, /<html lang="nl">/);
    const markup = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
    assert.doesNotMatch(markup, /Generate AI Video|>Generate|>Cancel<|>Retry<|All rights reserved|Gradient darkness|>Aspect ratio<|>Image<|>AI usage<|Dashboard password|Back to studio/);
  });
}

test('video confirmation, recovery and pending state are Dutch without a generation request', async () => {
  const elements = {aiVideoConfirmModal:{hidden:true}, aiVideoConfirmButton:{focus(){}},
    aiVideoCancelButton:{}, aiVideoRetryWarning:{}, outputMeta:{}, resultsArea:{}, generateAIVideoBtn:{}};
  let reads = 0;
  const context = vm.createContext({
    document:{getElementById:id=>elements[id]}, window:{addEventListener(){}, sessionStorage:{getItem:()=>JSON.stringify({operation:'interactions/mock-dutch',aspectRatio:'9:16'})}},
    escapeHtml:String, setAdGenerationState(){}, clearTimeout(){}, setTimeout(){return 1;}, Date,
    fetch:async()=>{reads++;return Response.json({state:'pending'});}
  });
  vm.runInContext(fs.readFileSync('ai-video.js', 'utf8'), context);
  assert.match(vm.runInContext('DEFAULT_AI_VIDEO_PROMPT', context), /^Maak een professionele/);
  const confirmed = context.requestAIVideoConfirmation();
  assert.equal(elements.aiVideoConfirmButton.textContent, 'Video genereren');
  elements.aiVideoCancelButton.onclick();
  assert.equal(await confirmed, false);
  assert.equal(reads, 0);
  context.restoreAIVideoRecovery();
  assert.match(elements.resultsArea.innerHTML, /Bestaande aanvraag controleren/);
  assert.match(elements.resultsArea.innerHTML, /Nieuwe betaalde video \(bevestiging vereist\)/);
  await context.resumeAIVideo();
  assert.equal(elements.outputMeta.textContent, 'AI-video — in behandeling');
  assert.equal(reads, 1, 'Only the existing request status is read');
});

test('legacy provider explanations do not leak English copy into the interface', () => {
  const {failureDetails} = require('./netlify/lib/veo-failure.cjs');
  const result = failureDetails({error:{message:'An unfamiliar English provider explanation.'}});
  assert.equal(result.message, 'Google heeft gemeld dat de videoaanvraag is mislukt.');
  assert.doesNotMatch(result.message, /unfamiliar|English|explanation/);
});

test('animated video download action is Dutch', () => {
  const source = fs.readFileSync('animated-video.js', 'utf8');
  assert.match(source, /Video downloaden/);
  assert.doesNotMatch(source, /Download Video/);
});

test('usage interface translates display labels, not API state values', () => {
  const source = fs.readFileSync('usage.js', 'utf8');
  assert.match(source, /Intl.NumberFormat\('nl-NL'\)/);
  assert.match(source, /display\(r.requestType\)/);
  assert.match(source, /display\(r.state \|\| r.operationState \|\| r.outcome\)/);
});
