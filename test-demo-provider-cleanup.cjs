const test = require('node:test');
const assert = require('node:assert/strict');
const {createProviderCleanup, fileResource} = require('./netlify/lib/demo-provider-cleanup.cjs');
const reply = (body, status=200) => new Response(status===204 ? null : JSON.stringify(body), {status});
function fixture(responses) {
  const calls=[];
  const remove=createProviderCleanup({apiKey:'test-only',fetcher:async(url,options)=>{
    calls.push({url,method:options.method});
    assert.equal(options.redirect,'error');
    assert.ok(options.signal);
    if(!responses.length) throw new Error('Unexpected network call');
    return responses.shift();
  }});
  return {calls,remove};
}
test('deletes generated Files resources before the interaction',async()=>{
  const s=fixture([reply({status:'completed',steps:[{type:'model_output',content:[{type:'video',uri:'https://generativelanguage.googleapis.com/v1beta/files/owned:download?alt=media'}]}]}),reply(null,204),reply(null,204)]);
  await s.remove('interactions/owned');
  assert.deepEqual(s.calls.map(c=>[c.url.split('/v1beta/')[1],c.method]),[['interactions/owned','GET'],['files/owned','DELETE'],['interactions/owned','DELETE']]);
});
test('cancels a running interaction before deleting it',async()=>{
  const s=fixture([reply({status:'in_progress'}),reply({status:'cancelled'}),reply(null,204)]);
  await s.remove('interactions/running');
  assert.deepEqual(s.calls.map(c=>c.method),['GET','POST','DELETE']);
  assert.match(s.calls[1].url,/\/cancel$/);
});
test('missing interaction is already deleted',async()=>{
  const s=fixture([reply({},404)]);await s.remove('interactions/gone');assert.equal(s.calls.length,1);
});
test('a failed file deletion preserves the interaction for cleanup',async()=>{
  const s=fixture([reply({status:'completed',steps:[{type:'model_output',content:[{type:'video',uri:'files/owned'}]}]}),reply({},503)]);
  await assert.rejects(s.remove('interactions/owned'),/not confirmed/);
  assert.equal(s.calls.length,2);
});
test('unsupported external file reference is not fetched or silently ignored',async()=>{
  const s=fixture([reply({status:'completed',steps:[{type:'model_output',content:[{type:'video',uri:'https://evil.example/file'}]}]})]);
  await assert.rejects(s.remove('interactions/owned'),/Unsupported/);assert.equal(s.calls.length,1);
});
test('pending cancellation cannot be claimed as deletion',async()=>{
  const s=fixture([reply({status:'in_progress'}),reply({status:'in_progress'})]);
  await assert.rejects(s.remove('interactions/running'),/has not stopped/);
});
test('operation path traversal and arbitrary hosts are rejected',async()=>{
  const s=fixture([]);await assert.rejects(s.remove('interactions/../../files/other'),/Invalid/);
  for(const uri of ['https://evil.example/v1beta/files/a','https://generativelanguage.googleapis.com.evil.example/v1beta/files/a','https://user:password@generativelanguage.googleapis.com/v1beta/files/a']) assert.throws(()=>fileResource(uri));
  assert.equal(s.calls.length,0);
});
test('relative Google download references normalize to deletable Files resources',()=>{
  assert.equal(fileResource('files/mock:download'),'files/mock');
});
test('inline generated video needs no Files API deletion',async()=>{
  const s=fixture([reply({status:'completed',steps:[{type:'model_output',content:[{type:'video',data:'mock-inline'}]}]}),reply(null,204)]);
  await s.remove('interactions/inline');assert.equal(s.calls.length,2);
});
