const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {BlobsServer}=require('@netlify/blobs/server');
const {setEnvironmentContext}=require('@netlify/blobs');
const {openDemoStore,createDemoState}=require('./netlify/lib/demo-state.cjs');

// Known emulator race: @netlify/blobs 11.1.3 server.cjs checks conditions before async writes.
// Keep the original assertion; TODO records the known failure, not proof of production safety.
// Remove this TODO after an emulator fix. Verify atomicity separately on a preview with NO Google calls.
test('actual Blobs SDK: conditional quota writes survive concurrent clients and reset',{
  todo:'Emulator GET omits ETag and PUT check/write is non-atomic; production preview verification required'
},async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'studio-demo-test-'));
  const server=new BlobsServer({directory,token:'test-only',logger:()=>{}});
  const address=await server.start();const originalFetch=global.fetch;
  try{
    global.fetch=(url,options)=>{
      if(!String(url).startsWith(`http://localhost:${address.port}/`))throw new Error('External networking is forbidden in this test');
      return originalFetch(url,options);
    };
    // The demo gateway uses Netlify's v2 runtime, not connectLambda (which lacks uncachedEdgeURL).
    setEnvironmentContext({siteID:'demo-test-site',deployID:'demo-test-deploy',edgeURL:`http://localhost:${address.port}`,uncachedEdgeURL:`http://localhost:${address.port}`,token:'test-only'});
    const event={};
    const options={password:'test-only-presenter',secret:'test-only-signing-key-not-for-deployment',origin:'https://demo.test',now:()=>Date.parse('2026-11-18T10:00:00Z'),removeInteraction:async()=>{}};
    const probe=openDemoStore(event);
    assert.equal((await probe.setJSON('conditional-probe',{version:1},{onlyIfNew:true})).modified,true);
    assert.equal((await probe.setJSON('conditional-probe',{version:2},{onlyIfNew:true})).modified,false);
    const created=await probe.setJSON('etag-probe',{version:1},{onlyIfNew:true});
    assert.ok(created.etag);
    assert.equal((await probe.setJSON('etag-probe',{version:2},{onlyIfMatch:created.etag})).modified,true);
    assert.equal((await probe.setJSON('etag-probe',{version:3},{onlyIfMatch:created.etag})).modified,false);
    await probe.delete('etag-probe');
    const current=await probe.getWithMetadata('conditional-probe',{type:'json'});
    assert.ok(current.etag,'Known emulator defect: GET omits ETag, so real application writes now fail closed');
    await probe.delete('conditional-probe');
    const clients=Array.from({length:8},()=>createDemoState({...options,store:openDemoStore(event)}));
    const cookie=await clients[0].login({headers:{origin:options.origin}},options.password);
    const auth=clients[0].authenticate({headers:{cookie:cookie.split(';')[0]}});
    const ids=await Promise.all(clients.map(client=>client.createWorkspace(auth)));
    await openDemoStore(event).setJSON('limits/2026-11-18',{text:49,image:0,video:0});
    const outcomes=await Promise.allSettled(clients.map((client,i)=>client.begin(auth,ids[i],'text')));
    assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
    assert.equal((await openDemoStore(event).get('limits/2026-11-18',{type:'json'})).text,50);
    for(let i=0;i<clients.length;i++){
      if(outcomes[i].status==='fulfilled')await clients[i].finish(auth,ids[i],outcomes[i].value);
      assert.deepEqual(await clients[i].reset(auth,ids[i]),{complete:true});
      assert.equal(await openDemoStore(event).get(`workspaces/${ids[i]}`,{type:'json'}),null);
    }
    assert.equal((await openDemoStore(event).get('limits/2026-11-18',{type:'json'})).text,50);
  }finally{
    global.fetch=originalFetch;await server.stop();
    if(path.dirname(directory)===os.tmpdir()&&path.basename(directory).startsWith('studio-demo-test-'))await fs.rm(directory,{recursive:true,force:true});
  }
});
