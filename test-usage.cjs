const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {BlobsServer} = require('@netlify/blobs/server');
const {createTracker, summarize, namespace, tokens, readSummary, openStore} = require('./netlify/lib/usage.cjs');
const {createHandler} = require('./netlify/functions/usage.cjs');
const details = {provider:'gemini',feature:'ad-text',requestType:'generate',model:'gemini-2.5-flash'};
const data = {candidates:[{content:{parts:[{text:'private output'}]}}],usageMetadata:{promptTokenCount:10,candidatesTokenCount:20,totalTokenCount:35,thoughtsTokenCount:5,cachedContentTokenCount:4}};
const json = (body, status=200) => new Response(JSON.stringify(body), {status,headers:{'Content-Type':'application/json'}});
function memory() {
 const records = new Map(); let writes = 0;
 return {records, get writes(){return writes;}, store:{async setJSON(key, value, options){writes++;if(!options?.onlyIfNew || !records.has(key))records.set(key,structuredClone(value));return {modified:true};}}};
}
const quiet = {warn(){}};
test('Gemini: preserve exact response, extract metadata, exclude content, concurrent requests retain distinct records', async () => {
 const m=memory();let calls=0;
 const tracker=createTracker({storeFactory:()=>m.store,fetcher:async()=>{calls++;return json(data);},logger:quiet});
 const responses=await Promise.all(Array.from({length:30},()=>tracker.trackedFetch({},details,'mock',{})));
 for(const response of responses)assert.deepEqual(await response.json(),data);
 assert.equal(calls,30);assert.equal(m.records.size,60);
 const summary=summarize([...m.records.values()]);
 assert.equal(summary.totals.gemini.attempts,30);assert.equal(summary.totals.gemini.totalTokens,1050);assert.equal(summary.totals.gemini.inputTokens,300);
 assert.equal(summary.totals.gemini.cachedTokens,120);assert.equal(summary.totals.gemini.missingMetadata,0);
 assert.doesNotMatch(JSON.stringify([...m.records.values()]),/private output|candidates"|api-key/);
});
test('storage retries and timeouts fail open without retrying generation', async()=>{
 for(const mode of ['reject','hang']){
  let calls=0,writes=0;
  const tracker=createTracker({storeFactory:()=>({setJSON(){writes++;return mode==='hang'?new Promise(()=>{}):Promise.reject(new Error('storage secret'));}}),fetcher:async()=>{calls++;return json(data);},writeTimeout:5,logger:quiet});
  assert.deepEqual(await (await tracker.trackedFetch({},details,'mock',{})).json(),data);
  assert.equal(calls,1);assert.equal(writes,4);
 }
 const m=memory();let failures=1;
 const tracker=createTracker({storeFactory:()=>({async setJSON(...args){if(failures-- > 0)throw Error('temporary');return m.store.setJSON(...args);}}),fetcher:async()=>json(data),logger:quiet});
 await tracker.trackedFetch({},details,'mock',{});assert.equal(m.records.size,2);
});
test('network failures, invalid responses, missing tokens and HTTP errors remain distinguishable',async()=>{
 const m=memory();const networkError=new TypeError('private URL');
 const tracker=createTracker({storeFactory:()=>m.store,fetcher:async()=>{throw networkError;},logger:quiet});
 await assert.rejects(tracker.trackedFetch({},details,'mock',{}),e=>e===networkError);
 assert.equal(summarize([...m.records.values()]).totals.gemini.unknown,1);
 for(const payload of [{}, {candidates:{}}, {...data,usageMetadata:undefined}]){
  const t=createTracker({storeFactory:()=>m.store,fetcher:async()=>json(payload),logger:quiet});
  assert.deepEqual(await (await t.trackedFetch({},details,'mock',{})).json(),JSON.parse(JSON.stringify(payload)));
 }
 const t=createTracker({storeFactory:()=>m.store,fetcher:async()=>json({error:'quota'},429),logger:quiet});
 assert.equal((await t.trackedFetch({},details,'mock',{})).status,429);
 const g=summarize([...m.records.values()]).totals.gemini;
 assert.equal(g.attempts,5);assert.equal(g.failed,1);assert.equal(g.missingMetadata,5);assert.equal(g.totalUnknown,5);
 assert.equal(tokens({usageMetadata:{totalTokenCount:-1,promptTokenCount:'20'}}).totalTokenCount,null);
});
test('Veo joins completion by operation, counts starts once and never turns polls/downloads into generations',async()=>{
 const m=memory();let reply;
 const t=createTracker({storeFactory:()=>m.store,fetcher:async()=>json(reply),logger:quiet});
 const base={provider:'veo',feature:'ai-video'};
 reply={name:'operations/video-1'};
 await t.trackedFetch({}, {...base,requestType:'generate',durationSeconds:4,requestedSeconds:4},'mock',{});
 reply={done:true,response:{generateVideoResponse:{generatedSamples:[{video:{uri:'https://private/video'}}]}}};
 for(let i=0;i<4;i++)await t.trackedFetch({}, {...base,requestType:'status',operation:'operations/video-1'},'mock',{});
 await t.trackedFetch({}, {...base,requestType:'download',operation:'operations/video-1'},'mock',{});
 let summary=summarize([...m.records.values()]);
 assert.deepEqual(summary.totals.veo,{attempts:1,submitted:1,completed:1,failed:0,pending:0,unknown:0,videos:1,requestedSeconds:4,estimatedCompletedSeconds:4,statusCalls:4,downloadCalls:1,diagnosticCalls:0});
 assert.doesNotMatch(JSON.stringify(summary),/operations\/video-1|https:\/\/private/);
 reply={name:'operations/video-1'};await t.trackedFetch({}, {...base,requestType:'generate',durationSeconds:4,requestedSeconds:4},'mock',{});
 const duplicate=summarize([...m.records.values()]);assert.equal(duplicate.totals.veo.attempts,2);assert.equal(duplicate.totals.veo.submitted,1);assert.equal(duplicate.totals.veo.completed,1);
 reply={name:'operations/video-2'};await t.trackedFetch({}, {...base,requestType:'generate',durationSeconds:4,requestedSeconds:4},'mock',{});
 reply={done:true,error:{message:'blocked'}};await t.trackedFetch({}, {...base,requestType:'status',operation:'operations/video-2'},'mock',{});
 reply={name:'operations/video-3'};await t.trackedFetch({}, {...base,requestType:'generate',durationSeconds:4,requestedSeconds:4},'mock',{});
 summary=summarize([...m.records.values()]);assert.equal(summary.totals.veo.failed,1);assert.equal(summary.totals.veo.pending,1);assert.equal(summary.totals.veo.estimatedCompletedSeconds,4);
});
test('Omni failed reads retain sanitised diagnostics privately without retries', async () => {
 const m=memory();let calls=0;
 const payload={status:'failed', errors:[{code:'RESOURCE_EXHAUSTED',message:'Quota exhausted. password="fake password with spaces" https://private.test data:image/png;base64,ZmFrZQ==',details:{token:'nested-private'}}],
   steps:[{type:'model_output',content:[{type:'text',text:'private-output'}]}]};
 const tracker=createTracker({storeFactory:()=>m.store,fetcher:async()=>{calls++;return json(payload);},logger:quiet});
 const base={provider:'veo',feature:'ai-video',requestType:'status',operation:'interactions/mock-failed'};
 const response=await tracker.trackedFetch({},base,'mock',{});
 assert.deepEqual(await response.json(),payload);
 assert.equal(calls,1);
 const result=[...m.records.values()].find(r=>r.phase==='result');
 assert.equal(result.operationState,'failed');
 assert.match(result.failureReason,/RESOURCE_EXHAUSTED|Quota exhausted/);
 assert.doesNotMatch(result.failureReason,/fake password|private.test|ZmFrZQ|nested-private|private-output/);
 assert.doesNotMatch(JSON.stringify(summarize([...m.records.values()])),/failureReason|Quota exhausted|RESOURCE_EXHAUSTED/);
});

test('Omni diagnostics handle absent, legacy and oversized errors without inventing quota', () => {
 const {interactionFailureDetails}=require('./netlify/lib/veo-failure.cjs');
 const absent=JSON.parse(interactionFailureDetails({status:'failed'}).reason);
 assert.equal(absent.status,'failed');
 assert.deepEqual(absent.errors,[]);
 assert.match(absent.reason,/without an error reason/);
 const legacy=JSON.parse(interactionFailureDetails({status:'failed',error:{code:500,message:'Worker failed'}}).reason);
 assert.equal(legacy.errors[0].code,'500');
 assert.equal(legacy.errors[0].message,'Worker failed');
 const large=interactionFailureDetails({status:'failed',errors:Array.from({length:100},()=>({code:'INTERNAL',message:'x'.repeat(10000)}))}).reason;
 assert.ok(large.length<6000);
 assert.equal(JSON.parse(large).errors.length,5);
});

test('daily and Monday weekly boundaries use Johannesburg; result wins over late request; environments are isolated',()=>{
 const r={version:1,id:'a',...details,timestamp:'2026-10-04T22:30:00Z',phase:'result',outcome:'succeeded',tokens:tokens(data)};
 const s=summarize([r,{...r,phase:'request',outcome:'unknown',tokens:undefined}]);
 assert.equal(s.days['2026-10-05'].gemini.totalTokens,35);assert.equal(s.weeks['2026-10-05'].gemini.attempts,1);
 assert.equal(namespace({CONTEXT:'production'}),'production');assert.equal(namespace({CONTEXT:'production',NETLIFY_DEV:'true'}),'local');
 assert.notEqual(namespace({CONTEXT:'deploy-preview',DEPLOY_ID:'one'}),namespace({CONTEXT:'deploy-preview',DEPLOY_ID:'two'}));
 assert.equal(summarize([]).trackingSince,null);
});
test('summary reads every page, handles empty records, rejects storage failures instead of returning fake zeroes', async()=>{
 let pages=0;const records=[{version:1,id:'1',timestamp:'2026-10-01T00:00:00Z',phase:'result',...details,outcome:'succeeded',tokens:tokens(data)},{version:1,id:'2',timestamp:'2026-10-02T00:00:00Z',phase:'result',...details,outcome:'succeeded',tokens:tokens(data)}];
 const s=await readSummary({},()=>({async *list(options){assert.equal(options.paginate,true);for(let i=0;i<2;i++){pages++;yield {blobs:[{key:String(i)}]};}},async get(key){return records[+key];}}));
 assert.equal(pages,2);assert.equal(s.totals.gemini.totalTokens,70);
 await assert.rejects(readSummary({},()=>({async *list(){throw Error('unavailable');}})));
});
test('dashboard requires password on every read, fails closed when unconfigured and never caches usage',async()=>{
 let reads=0;const password='test-password';const handler=createHandler({password:()=>password,read:async()=>{reads++;return {safe:true};}});
 const event={httpMethod:'GET',headers:{}};
 assert.equal((await handler(event)).statusCode,401);assert.equal(reads,0);
 assert.equal((await handler({...event,headers:{authorization:'Basic '+Buffer.from('usage:wrong').toString('base64')}})).statusCode,401);
 const response=await handler({...event,headers:{authorization:'Basic '+Buffer.from('usage:'+password).toString('base64')}});
 assert.equal(response.statusCode,200);assert.equal(response.headers['Cache-Control'],'no-store');assert.equal(reads,1);
 assert.equal((await createHandler({password:()=>''})(event)).statusCode,503);
 assert.equal((await handler({...event,httpMethod:'POST'})).statusCode,405);
 const failed=createHandler({password:()=>password,read:async()=>{throw Error('private backend token');}});
 const failure=await failed({...event,headers:{Authorization:'Basic '+Buffer.from('usage:'+password).toString('base64')}});
 assert.equal(failure.statusCode,503);assert.doesNotMatch(failure.body,/private backend token/);
});
test('real Netlify Blobs SDK: legacy event, persistent disk store, new client, authenticated endpoint; upstream calls mocked',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'spectron-usage-'));
 const server=new BlobsServer({directory,token:'test-token',logger:()=>{}});
 const address=await server.start();const realFetch=global.fetch;
 const originalKey=process.env.GEMINI_API_KEY, originalContext=process.env.CONTEXT, originalDev=process.env.NETLIFY_DEV;
 try{
  process.env.GEMINI_API_KEY='test-key';process.env.CONTEXT='dev';process.env.NETLIFY_DEV='true';
  const event={httpMethod:'POST',headers:{'x-nf-site-id':'local-test','x-nf-deploy-id':'deploy-test'},blobs:Buffer.from(JSON.stringify({url:`http://localhost:${address.port}`,token:'test-token'})).toString('base64'),body:JSON.stringify({prompt:'private prompt'})};
  let apiCalls=0;
  global.fetch=async(url,options)=>{
   const u=String(url);if(u.startsWith(`http://localhost:${address.port}/`))return realFetch(url,options);
   assert.match(u,/^https:\/\/generativelanguage\.googleapis\.com\//,'All other networking blocked');apiCalls++;
   if(u.endsWith('/interactions'))return json({id:'test-video',status:'in_progress'});
   if(u.includes('interactions/test-video'))return json({status:'completed',steps:[{type:'model_output',content:[{type:'video',mime_type:'video/mp4',uri:'files/mock:download'}]}]});
   if(u.includes('/files/mock:download'))return new Response('fake mp4',{headers:{'Content-Type':'video/mp4'}});
   if(u.includes('flash-image'))return json({...data,candidates:[{content:{parts:[{inlineData:{mimeType:'image/png',data:'YWJj'}}]}}]});
   return json(data);
  };
  const response=await require('./netlify/functions/generate.js').handler(event);
  assert.equal(response.statusCode,200);assert.deepEqual(JSON.parse(response.body),data);
  const imageBody=JSON.stringify({image:'data:image/png;base64,iVBORw0KGgo=',description:'test background'});
  assert.equal((await require('./netlify/functions/generate-ai-image.cjs').handler({...event,body:imageBody})).statusCode,200);
  const videoEvent={...event,body:JSON.stringify({image:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1sAAAAASUVORK5CYII=',prompt:'test',aspectRatio:'9:16'})};
  assert.equal((await require('./netlify/functions/start-veo-video.cjs').handler(videoEvent)).statusCode,202);
  const statusEvent={...event,httpMethod:'GET',queryStringParameters:{operation:'interactions/test-video'}};
  for(let i=0;i<2;i++)assert.equal((await require('./netlify/functions/veo-video-status.cjs').handler(statusEvent)).statusCode,200);
  assert.equal((await require('./netlify/functions/download-veo-video.cjs').download(statusEvent)).statusCode,200);
  const summary=await readSummary(event);
  assert.equal(summary.totals.veo.requestedSeconds,8);
  assert.equal(summary.totals.veo.estimatedCompletedSeconds,8);
  assert.equal(summary.totals.gemini.attempts,2);assert.equal(summary.totals.gemini.totalTokens,70);
  assert.equal(summary.features['ai-background'].gemini.attempts,1);assert.equal(summary.features['ai-video'].veo.completed,1);assert.equal(summary.totals.veo.attempts,1);assert.equal(summary.totals.veo.statusCalls,3);assert.equal(apiCalls,7);
  const handler=createHandler({password:()=> 'test-password'});
  const dashboard=await handler({...event,httpMethod:'GET',headers:{...event.headers,authorization:'Basic '+Buffer.from('usage:test-password').toString('base64')}});
  assert.equal(dashboard.statusCode,200);assert.equal(JSON.parse(dashboard.body).totals.gemini.totalTokens,70);
  const diskFiles=await fs.readdir(directory,{recursive:true});assert.ok(diskFiles.length>0);
  // A new SDK client reads the same persisted data, rather than process memory.
  const fresh=await readSummary({...event});assert.equal(fresh.totals.veo.completed,1);
 }finally{
  global.fetch=realFetch;
  for(const [key,value] of Object.entries({GEMINI_API_KEY:originalKey,CONTEXT:originalContext,NETLIFY_DEV:originalDev}))if(value===undefined)delete process.env[key];else process.env[key]=value;
  await server.stop();
  // Only remove the known test-created directory under the operating system temp directory.
  if(path.dirname(directory)===os.tmpdir() && path.basename(directory).startsWith('spectron-usage-'))await fs.rm(directory,{recursive:true,force:true});
 }
});
