const {spawn} = require('node:child_process');
const path = require('node:path');
const assert = require('node:assert/strict');
const BASE = 'http://localhost:8899';
const STARTUP_TIMEOUT_MS = 90000;
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const windows = process.platform === 'win32';
const cliPath = windows ? path.join(process.env.APPDATA, 'npm/node_modules/netlify-cli/bin/run.js') : null;
const child = spawn(windows ? process.execPath : 'netlify',
  windows ? [cliPath, 'dev', '--offline', '--port', '8899'] : ['dev', '--offline', '--port', '8899'], {
    env:{...process.env, GOOGLE_DEVELOPER_API_KEY:'mock-only-not-a-real-google-key',
      NODE_OPTIONS:`--require="${path.resolve('mock-video-network.cjs').split(path.sep).join('/')}"`},
    stdio:['ignore', 'pipe', 'pipe']
  });
let exited = false;
child.on('exit', () => { exited = true; });
child.on('error', () => { exited = true; });
// Drain CLI output without exposing local environment settings.
let cliOutput = '';
const collect = chunk => { cliOutput = (cliOutput + chunk.toString()).slice(-6000); };
child.stdout.on('data', collect); child.stderr.on('data', collect);
async function call(name, options) {
  return fetch(`${BASE}/.netlify/functions/${name}`, {...options, signal:AbortSignal.timeout(30000)});
}
async function waitForServer() {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline && !exited) {
    try {
      const response = await fetch(BASE, {signal:AbortSignal.timeout(2000)});
      if (response.ok) return;
    } catch { /* Netlify has not started listening yet. */ }
    await delay(500);
  }
  throw new Error('Mocked Netlify Dev did not start. CLI output:\n' + cliOutput);
}
async function start(prompt = 'mock:success') {
  return call('start-veo-video', {method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({image:'data:image/png;base64,YWJj', prompt, aspectRatio:'9:16'})});
}
async function checkWorkflowAssets() {
  const response = await fetch(BASE); const html = await response.text();
  assert.match(html, /function showStudioWorkflow\(workflow\)/);
  assert.match(html, /onclick="showStudioWorkflow\('advertisement'\)"/);
  for (const script of html.matchAll(/<script[^>]*src="([^"]+)"/g)) {
    const asset = await fetch(new URL(script[1], BASE));
    assert.equal(asset.status, 200, `Missing script: ${script[1]}`);
    assert.doesNotMatch(asset.headers.get('Content-Type') || '', /text\/html/, `HTML returned for ${script[1]}`);
  }
}
async function checkVideoFlow() {
  // Prove the function worker uses the mock before submitting any start request.
  const probe = await call('veo-video-status?operation=interactions%2Flocal-mock-video');
  assert.equal(probe.status, 200); assert.equal((await probe.json()).state, 'completed');
  const startedAt = Date.now(); const response = await start();
  assert.equal(response.status, 202, await response.clone().text()); assert.ok(Date.now() - startedAt < 10000);
  const {operation} = await response.json(); assert.equal(operation, 'interactions/local-mock-video');
  const suffix = '?operation=' + encodeURIComponent(operation);
  const status = await call('veo-video-status' + suffix);
  assert.equal(status.status, 200); assert.equal((await status.json()).state, 'completed');
  const video = await call('download-veo-video' + suffix);
  assert.equal(video.status, 200); assert.match(video.headers.get('Content-Type'), /video\/mp4/);
  assert.equal(await video.text(), 'mock-mp4');
  const pending = await call('veo-video-status?operation=interactions%2Flocal-mock-pending');
  assert.equal((await pending.json()).state, 'pending');
  const notReady = await call('download-veo-video?operation=interactions%2Flocal-mock-pending');
  assert.equal(notReady.status, 409);
  const failed = await call('veo-video-status?operation=interactions%2Flocal-mock-failed');
  assert.equal((await failed.json()).category, 'content-filter');
  const quota = await start('mock:quota'); assert.equal(quota.status, 429);
  assert.match((await quota.json()).error, /gebruikslimiet van Google/);
  const permission = await start('mock:permission'); assert.equal(permission.status, 502);
  assert.match((await permission.json()).error, /not permitted/);
}
async function stop() {
  if (windows) {
    await new Promise(resolve => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {stdio:'ignore'});
      killer.on('exit', resolve); killer.on('error', resolve);
    });
  } else child.kill('SIGTERM');
}
(async () => {
  try {
    await waitForServer(); await checkWorkflowAssets(); await checkVideoFlow();
    console.log('PASS: Netlify Dev assets, fast background start, status, MP4 download, pending, filtering, quota and permission errors; all Google calls mocked');
  } finally { await stop(); }
})().catch(error => {
  console.error(error.message);
  console.error(cliOutput.split('\n').filter(line => /mock-video|path:|method:/.test(line)).join('\n'));
  process.exitCode = 1;
});
