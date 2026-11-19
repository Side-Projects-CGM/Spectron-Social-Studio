const test = require('node:test');
const assert = require('node:assert/strict');
const {createDemoState, LIMITS} = require('./netlify/lib/demo-state.cjs');

// Model the SDK's conditional-write contract, including conflicting concurrent writers.
function memoryStore() {
  const records = new Map();
  let version = 0;
  return {
    records,
    async get(key) { return structuredClone(records.get(key)?.data || null); },
    async getWithMetadata(key) { return structuredClone(records.get(key) || null); },
    async setJSON(key, data, options = {}) {
      const current = records.get(key);
      if ((options.onlyIfNew && current) || (options.onlyIfMatch && current?.etag !== options.onlyIfMatch)) return {modified:false};
      const etag = String(++version);
      records.set(key, {data:structuredClone(data), etag});
      return {modified:true, etag};
    },
    async delete(key) { records.delete(key); }
  };
}
function setup(options = {}) {
  const store = memoryStore();
  const deleted = [];
  let time = Date.parse('2026-11-18T10:00:00Z');
  const state = createDemoState({store, password:'test-password-only', secret:'test-secret-never-for-deployment-12345', origin:'https://demo.example', now:() => time,
    removeInteraction:async id => deleted.push(id), ...options});
  const event = {headers:{origin:'https://demo.example'}};
  async function presenter() {
    const cookie = await state.login(event, 'test-password-only');
    const request = {headers:{...event.headers, cookie:cookie.split(';')[0]}};
    return {cookie, request, auth:state.authenticate(request)};
  }
  return {state, store, deleted, event, presenter, setTime:value => { time = value; }};
}
const status = code => error => error.status === code;

test('limits match the approved site-wide daily allowances', () => assert.deepEqual(LIMITS, {text:50,image:30,video:10}));
test('configuration fails closed without strong secrets or HTTPS', () => {
  assert.throws(() => createDemoState({store:memoryStore()}), status(503));
  assert.throws(() => setup({origin:'http://public.example'}), status(503));
});
test('login rejects incorrect credentials and cross-origin requests', async () => {
  const s = setup();
  await assert.rejects(s.state.login(s.event, 'wrong'), status(401));
  await assert.rejects(s.state.login({headers:{origin:'https://evil.example'}}, 'test-password-only'), status(403));
  assert.throws(() => s.state.authenticate(s.event), status(401));
});
test('presenter cookie is secure, HttpOnly, scoped, expiring and tamper resistant', async () => {
  const s = setup();
  const p = await s.presenter();
  assert.match(p.cookie, /^__Host-studio-presenter=/);
  for (const attribute of ['HttpOnly','SameSite=Strict','Path=/','Secure']) assert.ok(p.cookie.includes(attribute));
  const cookie = p.request.headers.cookie;
  assert.throws(() => s.state.authenticate({headers:{cookie:cookie.slice(0,-1)+'!'}}), status(401));
  s.setTime(Date.parse('2026-11-19T10:00:00Z'));
  assert.throws(() => s.state.authenticate(p.request), status(401));
});
test('reauthentication preserves ownership so an expired workspace can still be cleaned', async () => {
  const s = setup(); const p = await s.presenter(); const id = await s.state.createWorkspace(p.auth);
  s.setTime(Date.parse('2026-11-19T10:00:00Z'));
  assert.throws(() => s.state.authenticate(p.request), status(401));
  const cookie = await s.state.login(p.request,'test-password-only');
  const renewed = s.state.authenticate({headers:{cookie:cookie.split(';')[0]}});
  assert.equal(renewed.owner,p.auth.owner);
  await assert.rejects(s.state.workspace(renewed,id),status(404));
  assert.deepEqual(await s.state.reset(renewed,id),{complete:true});
});
test('login throttle persists across attempts', async () => {
  const s = setup();
  for (let i = 0; i < 60; i++) await assert.rejects(s.state.login(s.event, 'wrong'), status(401));
  await assert.rejects(s.state.login(s.event, 'test-password-only'), status(429));
});
test('new workspace is empty and another presenter cannot read or reset it', async () => {
  const s = setup(); const a = await s.presenter(); const b = await s.presenter();
  const id = await s.state.createWorkspace(a.auth);
  const value = await s.state.workspace(a.auth, id);
  assert.deepEqual(value.operations, []); assert.deepEqual(value.inFlight, []); assert.equal(value.activeVideo,null);
  await assert.rejects(s.state.workspace(b.auth,id),status(404));
  await assert.rejects(s.state.reset(b.auth,id),status(404));
});
test('global limits survive reset and apply across workspaces', async () => {
  const s = setup(); const p = await s.presenter();
  let id = await s.state.createWorkspace(p.auth);
  for (let i = 0; i < 50; i++) {
    const ticket = await s.state.begin(p.auth,id,'text');
    await s.state.finish(p.auth,id,ticket);
    if (i === 25) { assert.equal((await s.state.reset(p.auth,id)).complete,true); id = await s.state.createWorkspace(p.auth); }
  }
  await assert.rejects(s.state.begin(p.auth,id,'text'),status(429));
  assert.deepEqual((await s.state.workspace(p.auth,id)).inFlight,[]);
});
test('each generation type enforces its own exact allowance', async () => {
  for (const kind of ['image','video']) {
    const s = setup(); const p = await s.presenter(); const id = await s.state.createWorkspace(p.auth);
    for (let i=0; i<LIMITS[kind]; i++) {
      const ticket = await s.state.begin(p.auth,id,kind);
      const operation = kind === 'video' ? `interactions/video_${i}` : undefined;
      await s.state.finish(p.auth,id,ticket,{operation});
      if(operation) await s.state.completeVideo(p.auth,id,operation);
    }
    await assert.rejects(s.state.begin(p.auth,id,kind),status(429));
  }
});
test('concurrent functions cannot exceed the final available quota slot', async () => {
  const s = setup(); const p = await s.presenter();
  await s.store.setJSON('limits/2026-11-18',{text:49,image:0,video:0});
  const ids = await Promise.all(Array.from({length:12},()=>s.state.createWorkspace(p.auth)));
  const results = await Promise.allSettled(ids.map(id=>s.state.begin(p.auth,id,'text')));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal((await s.store.get('limits/2026-11-18')).text,50);
});
test('only one active video per workspace, including an unknown provider outcome', async () => {
  const s = setup(); const p = await s.presenter(); const id = await s.state.createWorkspace(p.auth);
  const results = await Promise.allSettled([s.state.begin(p.auth,id,'video'),s.state.begin(p.auth,id,'video')]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const ticket=results.find(r=>r.status==='fulfilled').value;
  await s.state.finish(p.auth,id,ticket);
  await assert.rejects(s.state.begin(p.auth,id,'video'),status(409));
  assert.deepEqual(await s.state.reset(p.auth,id),{complete:false,reason:'provider-outcome-unknown'});
});
test('confirmed completion releases the video lock without refunding allowance', async () => {
  const s=setup(); const p=await s.presenter(); const id=await s.state.createWorkspace(p.auth);
  const ticket=await s.state.begin(p.auth,id,'video');
  await s.state.finish(p.auth,id,ticket,{operation:'interactions/first'});
  await s.state.completeVideo(p.auth,id,'interactions/first');
  await s.state.begin(p.auth,id,'video');
  assert.equal((await s.store.get('limits/2026-11-18')).video,2);
});
test('reset deletes owned resources only, denies old access, and supports repeated reset', async () => {
  const s=setup(); const p=await s.presenter();
  const a=await s.state.createWorkspace(p.auth); const b=await s.state.createWorkspace(p.auth);
  for(const [id,operation] of [[a,'interactions/a'],[b,'interactions/b']]) {
    const ticket=await s.state.begin(p.auth,id,'video'); await s.state.finish(p.auth,id,ticket,{operation});
  }
  await assert.rejects(s.state.authorizeOperation(p.auth,b,'interactions/a'),status(404));
  assert.deepEqual(await s.state.reset(p.auth,a),{complete:true});
  assert.deepEqual(s.deleted,['interactions/a']);
  assert.equal(await s.store.get(`workspaces/${a}`),null);
  await assert.rejects(s.state.authorizeOperation(p.auth,a,'interactions/a'),status(404));
  await s.state.authorizeOperation(p.auth,b,'interactions/b');
  assert.deepEqual(await s.state.reset(p.auth,a),{complete:true});
});
test('late start is withheld after reset and retained for explicit cleanup', async () => {
  const s=setup(); const p=await s.presenter(); const id=await s.state.createWorkspace(p.auth);
  const ticket=await s.state.begin(p.auth,id,'video');
  assert.deepEqual(await s.state.reset(p.auth,id),{complete:false,reason:'requests-pending'});
  await assert.rejects(s.state.finish(p.auth,id,ticket,{operation:'interactions/late'}),status(410));
  await assert.rejects(s.state.authorizeOperation(p.auth,id,'interactions/late'),status(410));
  assert.deepEqual(await s.state.reset(p.auth,id),{complete:true});
  assert.deepEqual(s.deleted,['interactions/late']);
});
test('provider cleanup failure is not reported as success and preserves its deletion references', async () => {
  const s=setup({removeInteraction:async()=>{throw new Error('mock provider failure');}});
  const p=await s.presenter(); const id=await s.state.createWorkspace(p.auth);
  const ticket=await s.state.begin(p.auth,id,'video');
  await s.state.finish(p.auth,id,ticket,{operation:'interactions/pending_cleanup'});
  assert.deepEqual(await s.state.reset(p.auth,id),{complete:false,reason:'provider-cleanup-failed'});
  const record=await s.store.get(`workspaces/${id}`);
  assert.equal(record.status,'revoked'); assert.deepEqual(record.operations,['interactions/pending_cleanup']);
});
test('missing storage ETag fails closed instead of making an unconditional write', async () => {
  let writes=0;
  const s=setup({store:{getWithMetadata:async()=>({data:{attempts:0}}),setJSON:async()=>{writes++;return {modified:true};}}});
  await assert.rejects(s.state.login(s.event,'test-password-only'),status(503));
  assert.equal(writes,0);
});
test('storage outage fails closed before authorizing generation', async () => {
  const s=setup({store:{getWithMetadata:async()=>{throw new Error('storage unavailable');}}});
  await assert.rejects(s.state.login(s.event,'test-password-only'),/storage unavailable/);
});
test('daily quota resets at UTC midnight, not on workspace reset', async () => {
  const s=setup(); const p=await s.presenter(); const id=await s.state.createWorkspace(p.auth);
  const ticket=await s.state.begin(p.auth,id,'image'); await s.state.finish(p.auth,id,ticket);
  s.setTime(Date.parse('2026-11-19T00:00:00Z'));
  const nextPresenter=await s.presenter(); const next=await s.state.createWorkspace(nextPresenter.auth);
  await s.state.begin(nextPresenter.auth,next,'image');
  assert.equal((await s.store.get('limits/2026-11-18')).image,1);
  assert.equal((await s.store.get('limits/2026-11-19')).image,1);
});
