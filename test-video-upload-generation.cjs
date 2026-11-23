const test=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {localStore}=require('./demo/local.cjs');
const {createReferenceUploads,UPLOAD_SERVICE,UPLOAD_OWNER,CHUNK_BYTES}=require('./netlify/lib/video-reference-uploads.cjs');
const usage=require('./netlify/lib/usage.cjs');
const originalTracker=usage.trackedFetch,originalKey=process.env.GOOGLE_DEVELOPER_API_KEY;
let providerCalls=0,lastImages=[];
usage.trackedFetch=async(event,details,url,options)=>{
  providerCalls++;const request=JSON.parse(options.body);
  lastImages=request.input.filter(item=>item.type==='image').map(image=>digest(Buffer.from(image.data,'base64')));
  assert.equal(request.model,'gemini-omni-1.1-flash');assert.equal(request.response_format.duration,'8s');
  assert.equal(request.upload,undefined);
  return Response.json({id:'mock-upload-job'});
};
process.env.GOOGLE_DEVELOPER_API_KEY='mock-upload-test-key';
const {handler}=require('./netlify/functions/start-veo-video.cjs');
const {createDemoState}=require('./netlify/lib/demo-state.cjs');
const {createDemoGateway}=require('./netlify/lib/demo-gateway.cjs');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1sAAAAASUVORK5CYII=','base64');
const metadata=bytes=>({mimeType:'image/png',size:bytes.length,sha256:digest(bytes)});
async function prepare(service,images){
  const {reference}=await service.create(images.map(metadata));
  for(let image=0;image<images.length;image++)for(let part=0,offset=0;offset<images[image].length;offset+=CHUNK_BYTES,part++)await service.put(reference,image,part,images[image].subarray(offset,offset+CHUNK_BYTES).toString('base64'));
  return reference;
}
const event=(upload,service)=>({httpMethod:'POST',body:JSON.stringify({upload,prompt:'Lokale mock test.',aspectRatio:'16:9'}),[UPLOAD_SERVICE]:service});
test.after(()=>{usage.trackedFetch=originalTracker;if(originalKey===undefined)delete process.env.GOOGLE_DEVELOPER_API_KEY;else process.env.GOOGLE_DEVELOPER_API_KEY=originalKey;});

test('a tiny start request reconstructs exactly 10 MiB server-side, calls Google once and deletes originals',async()=>{
  const store=localStore(),service=createReferenceUploads({store,environment:'generation-test'});
  const images=[4,4,2].map(size=>{const bytes=Buffer.alloc(size*CHUNK_BYTES);png.copy(bytes);return bytes;});
  const reference=await prepare(service,images);const request=event(reference,service);
  assert.ok(Buffer.byteLength(request.body)<2000);
  const before=providerCalls,response=await handler(request);
  assert.equal(response.statusCode,202);assert.equal(providerCalls,before+1);assert.deepEqual(lastImages,images.map(digest));
  await assert.rejects(service.consume(reference),error=>error.status===404);
  const rejected=await handler(request);assert.equal(rejected.statusCode,404);assert.equal(providerCalls,before+1);
});

test('incomplete, expired and cross-owner uploads never start Google; failure is explicitly pre-submission',async()=>{
  const store=localStore();let now=1700000000000;
  const service=createReferenceUploads({store,environment:'failed-test',now:()=>now});
  const {reference}=await service.create([metadata(png)]);const before=providerCalls;
  const response=await handler(event(reference,service));assert.equal(response.statusCode,409);assert.equal(JSON.parse(response.body).category,'invalid-upload');
  const next=await prepare(service,[png]);now+=60*60*1000+1;
  assert.equal((await handler(event(next,service))).statusCode,410);
  const owner=createReferenceUploads({store,owner:{owner:'one',workspace:'one'},environment:'owners'});
  const other=createReferenceUploads({store,owner:{owner:'two',workspace:'two'},environment:'owners'});
  const privateRef=await prepare(owner,[png]);assert.equal((await handler(event(privateRef,other))).statusCode,404);
  assert.equal(providerCalls,before);
});

test('parallel starts using one batch never produce two paid requests',async()=>{
  const service=createReferenceUploads({store:localStore(),environment:'parallel-test'});
  const reference=await prepare(service,[png]);const before=providerCalls;
  const results=await Promise.all([handler(event(reference,service)),handler(event(reference,service))]);
  assert.equal(results.filter(result=>result.statusCode===202).length,1);assert.equal(providerCalls,before+1);
});

async function demoFixture(){
  const store=localStore(),origin='https://demo.test';let enabled=true;
  const state=createDemoState({store,password:'mock-presenter-password',secret:'mock-cookie-secret-not-for-production',origin,removeInteraction:async()=>{}});
  const basic={headers:{origin}};
  const cookie=(await state.login(basic,'mock-presenter-password')).split(';')[0];
  const auth=state.authenticate({headers:{cookie}}),workspace=await state.createWorkspace(auth);
  const uploadFactory=event=>createReferenceUploads({store,owner:event[UPLOAD_OWNER],environment:'demo-test'});
  const gateway=createDemoGateway({stateFactory:()=>state,uploadFactory,handlers:{video:handler},videoEnabled:()=>enabled});
  const request=(action,input={},extra={})=>new Request(origin+'/.netlify/functions/demo-api',{method:'POST',headers:{origin,cookie,'content-type':'application/json',...extra},body:JSON.stringify({action,workspace,input})});
  const service=createReferenceUploads({store,owner:{owner:auth.owner,workspace},environment:'demo-test'});
  return {store,state,auth,workspace,gateway,request,service,disable:()=>{enabled=false;}};
}

test('demo upload actions require login/origin and never reserve generation quota; disabled video blocks them',async()=>{
  const s=await demoFixture(),input={action:'create',images:[metadata(png)]};const before=providerCalls;
  assert.equal((await s.gateway(s.request('references',input,{cookie:''}))).status,401);
  assert.equal((await s.gateway(s.request('references',input,{origin:'https://evil.test'}))).status,403);
  const response=await s.gateway(s.request('references',input));assert.equal(response.status,201);
  assert.equal(await s.store.get('limits/'+new Date().toISOString().slice(0,10)),null);assert.equal(providerCalls,before);
  s.disable();assert.equal((await s.gateway(s.request('references',input))).status,403);
});

test('demo reset purges pending upload bytes and prevents further chunk writes',async()=>{
  const s=await demoFixture(),reference=await prepare(s.service,[png]);
  const reset=await s.gateway(s.request('reset'));assert.equal(reset.status,200);assert.equal((await reset.json()).complete,true);
  await assert.rejects(s.service.consume(reference),error=>error.status===404);
  const late=await s.gateway(s.request('references',{action:'chunk',reference,image:0,part:0,data:png.toString('base64')}));assert.equal(late.status,404);
});

test('reset racing upload creation withholds the capability and purges newly written metadata',async()=>{
  const s=await demoFixture();
  const raced=createDemoGateway({stateFactory:()=>s.state,handlers:{video:handler},uploadFactory:()=>({...s.service,
    create:async images=>{const result=await s.service.create(images);await s.state.reset(s.auth,s.workspace);return result;}
  })});
  const response=await raced(s.request('references',{action:'create',images:[metadata(png)]}));
  assert.equal(response.status,404);assert.equal((await response.json()).reference,undefined);
  const remaining=[];for await(const page of s.store.list())remaining.push(...page.blobs.filter(blob=>blob.key.startsWith('v1/')&&!blob.key.includes('/rate/')&&!blob.key.endsWith('/claimed')));
  assert.equal(remaining.length,0);
});

test('a rejected upload consumes no Google call and leaves no unknown-video lock in the demo',async()=>{
  const s=await demoFixture(),{reference}=await s.service.create([metadata(png)]);const before=providerCalls;
  const response=await s.gateway(s.request('video',{upload:reference,prompt:'Mock.',aspectRatio:'9:16'}));
  assert.equal(response.status,409);assert.equal((await response.json()).category,'invalid-upload');assert.equal(providerCalls,before);
  assert.equal((await s.state.workspace(s.auth,s.workspace)).activeVideo,null);
  assert.equal((await s.store.get('limits/'+new Date().toISOString().slice(0,10))).video,1,'Existing attempt quota is not refunded');
});

test('demo start resolves original owned chunks with existing quota/operation ownership controls',async()=>{
  const s=await demoFixture(),reference=await prepare(s.service,[png]);const before=providerCalls;
  const response=await s.gateway(s.request('video',{upload:reference,prompt:'Mock.',aspectRatio:'9:16'}));
  assert.equal(response.status,202);assert.equal(providerCalls,before+1);
  await s.state.authorizeOperation(s.auth,s.workspace,'interactions/mock-upload-job');
  await assert.rejects(s.service.consume(reference),error=>error.status===404);
});
