const test=require('node:test');
const assert=require('node:assert/strict');
const {createDemoGateway}=require('./netlify/lib/demo-gateway.cjs');
const {DemoError}=require('./netlify/lib/demo-state.cjs');
const {DEMO_REQUEST}=require('./netlify/lib/demo-context.cjs');
const {createTracker}=require('./netlify/lib/usage.cjs');

function fixture(){
  const calls=[];let authorized=true,active=true,owned=true;
  const state={checkOrigin:event=>{if(event.headers.origin!=='https://demo.test')throw new DemoError(403,'Origin refused');},
    authenticate:()=>{if(!authorized)throw new DemoError(401,'Login required');return {};},
    workspace:async()=>{if(!active)throw new DemoError(410,'Reset workspace');},
    authorizeOperation:async()=>{if(!owned)throw new DemoError(404,'Not owned');},
    begin:async()=>{calls.push('reserve');return 'ticket';},finish:async()=>{calls.push('finish');if(!active)throw new DemoError(410,'Reset workspace');},
    completeVideo:async()=>calls.push('complete'),reset:async()=>({complete:true}),createWorkspace:async()=>'new-workspace',login:async()=>'test-cookie'};
  const handler=async event=>{assert.equal(event[DEMO_REQUEST],true);calls.push('provider');return {statusCode:200,headers:{'Content-Type':'application/json'},body:JSON.stringify({state:'completed'})};};
  const handlers={text:handler,image:handler,video:handler,status:handler,download:async()=>({statusCode:200,headers:{'Content-Type':'video/mp4'},body:Buffer.from('mock-video')})};
  const gateway=createDemoGateway({stateFactory:()=>state,handlers});
  const request=(body,headers={})=>new Request('https://demo.test/.netlify/functions/demo-api',{method:'POST',headers:{'Content-Type':'application/json',origin:'https://demo.test',...headers},body:JSON.stringify(body)});
  return {calls,state,handlers,gateway,request,setAuth:v=>{authorized=v;},setActive:v=>{active=v;},setOwned:v=>{owned=v;}};
}
test('disabled paid video is rejected before quota reservation or provider calls',async()=>{
  const s=fixture();
  const gateway=createDemoGateway({stateFactory:()=>s.state,handlers:s.handlers,videoEnabled:()=>false});
  const response=await gateway(s.request({action:'video',input:{prompt:'never submit'}}));
  assert.equal(response.status,403);assert.deepEqual(s.calls,[]);
});
test('session probe reports login state without a failing HTTP request or authorizing work',async()=>{
  const s=fixture();s.setAuth(false);
  const loggedOut=await s.gateway(s.request({action:'session'}));
  assert.equal(loggedOut.status,200);assert.deepEqual(await loggedOut.json(),{authenticated:false});
  s.setAuth(true);const loggedIn=await s.gateway(s.request({action:'session'}));
  assert.deepEqual(await loggedIn.json(),{authenticated:true});assert.deepEqual(s.calls,[]);
});
test('gateway requires authentication before provider calls or quota reservation',async()=>{
  const s=fixture();s.setAuth(false);
  assert.equal((await s.gateway(s.request({action:'text',workspace:'id',input:{prompt:'hello'}}))).status,401);assert.deepEqual(s.calls,[]);
});
test('gateway denies wrong-origin, unsupported method and unknown legacy actions',async()=>{
  const s=fixture();assert.equal((await s.gateway(s.request({action:'create'},{origin:'https://evil.test'}))).status,403);
  assert.equal((await s.gateway(new Request('https://demo.test/api'))).status,405);
  assert.equal((await s.gateway(s.request({action:'start-veo-test'}))).status,400);assert.deepEqual(s.calls,[]);
});
test('gateway reserves before generation and never exposes cacheable results',async()=>{
  const s=fixture();const r=await s.gateway(s.request({action:'text',input:{prompt:'hello'}}));assert.equal(r.status,200);
  assert.deepEqual(s.calls,['reserve','provider','finish']);assert.match(r.headers.get('cache-control'),/no-store/);
});
test('download requires operation ownership and streams original bytes',async()=>{
  const s=fixture();s.setOwned(false);
  assert.equal((await s.gateway(s.request({action:'download',operation:'interactions/other'}))).status,404);
  s.setOwned(true);const r=await s.gateway(s.request({action:'download',operation:'interactions/owned'}));
  assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'video/mp4');assert.equal(await r.text(),'mock-video');
});
test('reset racing a completed provider response withholds it',async()=>{
  const s=fixture();s.handlers.text=async()=>{s.setActive(false);return {statusCode:200,body:'private output'};};
  const r=await s.gateway(s.request({action:'text',input:{prompt:'hello'}}));assert.equal(r.status,410);assert.doesNotMatch(await r.text(),/private output/);
});
test('reset racing a download withholds the buffered media',async()=>{
  const s=fixture();s.handlers.download=async()=>{s.setActive(false);return {statusCode:200,body:Buffer.from('private media')};};
  const r=await s.gateway(s.request({action:'download',operation:'interactions/owned'}));assert.equal(r.status,410);assert.doesNotMatch(await r.text(),/private media/);
});
test('internal errors return fixed messages, never provider error details',async()=>{
  const s=fixture();s.handlers.text=async()=>{throw new Error('mock-private-provider-data');};
  const r=await s.gateway(s.request({action:'text',input:{prompt:'hello'}}));assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/mock-private/);assert.deepEqual(s.calls,['reserve','finish']);
});
test('trusted demo requests do not create customer-linked usage records; browser property cannot bypass tracking',async()=>{
  let writes=0,fetches=0;
  const tracker=createTracker({storeFactory:()=>({setJSON:async()=>{writes++;return {modified:true};}}),fetcher:async()=>{fetches++;return new Response('{}',{status:200});}});
  await tracker.trackedFetch({[DEMO_REQUEST]:true},{provider:'gemini'},'https://mock.test',{});
  assert.equal(writes,0);assert.equal(fetches,1);
  await tracker.trackedFetch({'authenticated-demo-request':true},{provider:'gemini'},'https://mock.test',{});
  assert.equal(writes,2);assert.equal(fetches,2);
});
