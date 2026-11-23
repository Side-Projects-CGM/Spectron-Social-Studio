const test=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {localStore}=require('./demo/local.cjs');
const {createReferenceUploads,uploadRequest,UPLOAD_SERVICE,CHUNK_BYTES,TTL_MS}=require('./netlify/lib/video-reference-uploads.cjs');
const digest=value=>createHash('sha256').update(value).digest('hex');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1sAAAAASUVORK5CYII=','base64');
function photo(size=png.length){const bytes=Buffer.alloc(size);png.copy(bytes);return bytes;}
function fixture(){
  const store=localStore();let clock=1700000000000;
  const options={store,environment:'test',now:()=>clock};
  const service=createReferenceUploads(options);
  return {store,options,service,advance:ms=>{clock+=ms;}};
}
const metadata=bytes=>({mimeType:'image/png',size:bytes.length,sha256:digest(bytes)});
async function putAll(service,reference,images){
  for(let image=0;image<images.length;image++)for(let offset=0,part=0;offset<images[image].length;offset+=CHUNK_BYTES,part++)await service.put(reference,image,part,images[image].subarray(offset,offset+CHUNK_BYTES).toString('base64'));
}
async function keys(store){const result=[];for await(const page of store.list())result.push(...page.blobs.map(blob=>blob.key));return result;}
const status=expected=>error=>{assert.equal(error.status,expected);return true;};

test('exactly 10 MiB in three original images round-trips via bounded chunks and cleans up',async()=>{
  const s=fixture(),images=[photo(4*CHUNK_BYTES),photo(4*CHUNK_BYTES),photo(2*CHUNK_BYTES)];
  const created=await s.service.create(images.map(metadata));assert.equal(created.chunkBytes,CHUNK_BYTES);
  await putAll(s.service,created.reference,images);
  const sources=await s.service.consume(created.reference);
  assert.deepEqual(sources.map(source=>digest(Buffer.from(source.split(',')[1],'base64'))),images.map(digest));
  assert.equal(sources.length,3);
  await s.service.remove(created.reference);await s.service.remove(created.reference);
  assert.equal((await keys(s.store)).filter(key=>!key.includes('/rate/')&&!key.endsWith('/claimed')).length,0);
  assert.equal((await keys(s.store)).filter(key=>key.endsWith('/claimed')).length,1,'Only an empty replay-protection marker remains');
});

test('rejects totals above 10 MiB, bad counts, types, sizes and checksums before allocating an upload',async()=>{
  const s=fixture(),valid=metadata(png);
  for(const images of [[],Array(4).fill(valid),[{...valid,size:10*CHUNK_BYTES+1}],[{...valid,mimeType:'image/svg+xml'}],[{...valid,size:0}],[{...valid,sha256:'bad'}]])await assert.rejects(s.service.create(images),error=>[400,413].includes(error.status));
  assert.equal((await keys(s.store)).length,0);
});

test('chunks are strict, immutable and idempotent; incomplete uploads never get claimed',async()=>{
  const s=fixture(),bytes=photo(CHUNK_BYTES+1),{reference}=await s.service.create([metadata(bytes)]);
  for(const [image,part,data] of [[-1,0,'AAAA'],[0,-1,'AAAA'],[0,3,'AAAA'],[0,0,'%%%'],[0,0,'AAAA']])await assert.rejects(s.service.put(reference,image,part,data),status(400));
  const first=bytes.subarray(0,CHUNK_BYTES).toString('base64');
  await s.service.put(reference,0,0,first);await s.service.put(reference,0,0,first);
  const different=Buffer.alloc(CHUNK_BYTES,1).toString('base64');
  await assert.rejects(s.service.put(reference,0,0,different),status(409));
  await assert.rejects(s.service.consume(reference),status(409));
  await s.service.put(reference,0,1,bytes.subarray(CHUNK_BYTES).toString('base64'));
  assert.equal((await s.service.consume(reference)).length,1);
});

test('corruption and MIME spoofing are rejected before consumption',async()=>{
  const s=fixture(),bytes=photo(),{reference}=await s.service.create([metadata(bytes)]);
  await s.service.put(reference,0,0,Buffer.alloc(bytes.length).toString('base64'));
  await assert.rejects(s.service.consume(reference),status(400));
  const spoof=Buffer.from('not really an image');const next=await s.service.create([metadata(spoof)]);
  await putAll(s.service,next.reference,[spoof]);await assert.rejects(s.service.consume(next.reference),status(400));
});

test('possession of ID alone is insufficient; demo references also require the original owner and workspace',async()=>{
  const s=fixture(),owner={owner:'presenter-A',workspace:'workspace-A'};
  const a=createReferenceUploads({...s.options,owner}),b=createReferenceUploads({...s.options,owner:{...owner,workspace:'workspace-B'}});
  const other=createReferenceUploads({...s.options,owner:{owner:'presenter-B',workspace:owner.workspace}});
  const {reference}=await a.create([metadata(png)]);await putAll(a,reference,[png]);
  const wrong={...reference,token:'0'.repeat(64)};
  await assert.rejects(a.consume(wrong),status(404));await assert.rejects(a.remove(wrong),status(404));
  await assert.rejects(b.consume(reference),status(404));await assert.rejects(other.consume(reference),status(404));
  await assert.rejects(s.service.consume(reference),status(404));
  assert.equal((await a.consume(reference)).length,1);
});

test('parallel/replayed consumption succeeds only once and a used upload rejects more chunks',async()=>{
  const s=fixture(),{reference}=await s.service.create([metadata(png)]);await putAll(s.service,reference,[png]);
  const attempts=await Promise.allSettled([s.service.consume(reference),s.service.consume(reference)]);
  assert.equal(attempts.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(attempts.filter(result=>result.status==='rejected'&&result.reason.status===409).length,1);
  await assert.rejects(s.service.consume(reference),status(409));
  await assert.rejects(s.service.put(reference,0,0,png.toString('base64')),status(409));
});

test('cleanup cannot let a delayed competing consumption claim a previously used upload again',async()=>{
  const base=localStore();let claims=0,ready,release;
  const both=new Promise(resolve=>{ready=resolve;}),late=new Promise(resolve=>{release=resolve;});
  const store={...base,setJSON:async(key,data,options)=>{
    if(key.endsWith('/claimed')){
      claims++;
      if(claims===1)await both;
      else if(claims===2){ready();await late;}
    }
    return base.setJSON(key,data,options);
  }};
  const service=createReferenceUploads({store,environment:'cleanup-claim-race'}),{reference}=await service.create([metadata(png)]);
  await putAll(service,reference,[png]);
  const first=service.consume(reference),second=service.consume(reference);
  await both;await first;await service.remove(reference);release();
  await assert.rejects(second,status(409));
});

test('one-hour expiry rejects reuse; sweeper deletes expired images and later rate records',async()=>{
  const s=fixture(),{reference}=await s.service.create([metadata(png)]);await putAll(s.service,reference,[png]);
  s.advance(TTL_MS+1);await assert.rejects(s.service.consume(reference),status(410));
  assert.ok(await s.service.sweep()>0);
  assert.equal((await keys(s.store)).filter(key=>!key.includes('/rate/')&&!key.endsWith('/claimed')).length,0);
  s.advance(2*TTL_MS);await s.service.sweep();assert.equal((await keys(s.store)).length,0);
});

test('used markers outlive expiry briefly, then are swept without retaining image bytes',async()=>{
  const s=fixture(),{reference}=await s.service.create([metadata(png)]);await putAll(s.service,reference,[png]);
  await s.service.consume(reference);await s.service.remove(reference);
  s.advance(TTL_MS+1);await s.service.sweep();
  assert.equal((await keys(s.store)).filter(key=>key.endsWith('/claimed')).length,1);
  s.advance(5*60*1000);await s.service.sweep();
  assert.equal((await keys(s.store)).filter(key=>key.endsWith('/claimed')).length,0);
});

test('workspace cleanup deletes only its own photos; deleting an expired batch is allowed',async()=>{
  const s=fixture(),a=createReferenceUploads({...s.options,owner:{owner:'A',workspace:'one'}}),b=createReferenceUploads({...s.options,owner:{owner:'A',workspace:'two'}});
  const first=await a.create([metadata(png)]),second=await b.create([metadata(png)]);
  await putAll(a,first.reference,[png]);await putAll(b,second.reference,[png]);
  await a.removeWorkspace();await assert.rejects(a.consume(first.reference),status(404));
  assert.equal((await b.consume(second.reference)).length,1);
  s.advance(TTL_MS+1);await b.remove(second.reference);
  assert.equal((await keys(s.store)).filter(key=>!key.includes('/rate/')&&!key.endsWith('/claimed')).length,0);
});

test('per-client and site-wide creation limits are persistent and concurrency safe',async()=>{
  const s=fixture();for(let i=0;i<10;i++)await s.service.create([metadata(png)]);
  await assert.rejects(s.service.create([metadata(png)]),status(429));
  const next=fixture();
  const attempts=await Promise.allSettled(Array.from({length:65},(_,i)=>createReferenceUploads({...next.options,client:String(i)}).create([metadata(png)])));
  assert.equal(attempts.filter(result=>result.status==='fulfilled').length,60);
  assert.equal(attempts.filter(result=>result.status==='rejected'&&result.reason.status===429).length,5);
});

test('a reset/delete racing a chunk write cannot leave a late image blob behind',async()=>{
  const base=localStore();let release,started;
  const gate=new Promise(resolve=>{release=resolve;});const ready=new Promise(resolve=>{started=resolve;});
  const store={...base,setJSON:async(key,data,options)=>{if(key.endsWith('/image-0-0')){started();await gate;}return base.setJSON(key,data,options);}};
  const service=createReferenceUploads({store,environment:'race',owner:{owner:'one',workspace:'one'}});
  const {reference}=await service.create([metadata(png)]);
  const writing=service.put(reference,0,0,png.toString('base64'));await ready;
  await service.removeWorkspace();release();await assert.rejects(writing,status(404));
  assert.equal((await keys(store)).filter(key=>!key.includes('/rate/')&&!key.endsWith('/claimed')).length,0);
});

test('creation performs bounded opportunistic expiry cleanup, including inactive previews',async()=>{
  const s=fixture(),{reference}=await s.service.create([metadata(png)]);await putAll(s.service,reference,[png]);
  s.advance(TTL_MS+1);await s.service.create([metadata(png)]);
  await assert.rejects(s.service.consume(reference),status(404));
  const retained=(await keys(s.store)).filter(key=>!key.includes('/rate/')&&!key.endsWith('/claimed'));
  assert.equal(retained.length,1);assert.ok(retained[0].endsWith('/manifest'));
});

test('upload HTTP boundary denies wrong origins, oversized payloads and methods; responses are private',async()=>{
  const s=fixture();
  const event={httpMethod:'POST',headers:{host:'studio.test',origin:'https://studio.test','content-type':'application/json'},body:JSON.stringify({action:'create',images:[metadata(png)]}),[UPLOAD_SERVICE]:s.service};
  for(const [change,expected] of [[{httpMethod:'GET'},405],[{headers:{...event.headers,origin:'https://evil.test'}},403],[{headers:{...event.headers,'content-type':'text/plain'}},415],[{body:'{'},400],[{body:'x'.repeat(2*CHUNK_BYTES+1)},413]])assert.equal((await uploadRequest({...event,...change})).statusCode,expected);
  const result=await uploadRequest(event);assert.equal(result.statusCode,201);assert.match(result.headers['Cache-Control'],/no-store/);
  const {reference}=JSON.parse(result.body);
  const chunk=await uploadRequest({...event,body:JSON.stringify({action:'chunk',reference,image:0,part:0,data:png.toString('base64')})});assert.equal(chunk.statusCode,200);
  assert.equal((await s.service.consume(reference)).length,1);
});
