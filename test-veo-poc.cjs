const {test, after} = require('node:test');
const assert = require('node:assert/strict');
const usage = require('./netlify/lib/usage.cjs');
const records = [], requests = [];
const MAX_DOWNLOAD_BYTES = 18 * 1024 * 1024;
const PRODUCTION_VIDEO_BYTES = 4_266_833;
const MAX_STREAMED_RESPONSE_BYTES = 20_000_000;
const originalTracker = usage.trackedFetch;
const originalKeys = {GEMINI_API_KEY:process.env.GEMINI_API_KEY, GOOGLE_DEVELOPER_API_KEY:process.env.GOOGLE_DEVELOPER_API_KEY};
let payload, responseStatus = 200, networkError;
usage.trackedFetch = usage.createTracker({
  storeFactory:() => ({async setJSON(key, record) { records.push(record); }}),
  fetcher:async (url, options) => {
    requests.push({url, options});
    if (networkError) throw networkError;
    if (typeof payload === 'function') return payload(url, options);
    return payload instanceof Response ? payload : Response.json(payload, {status:responseStatus});
  }
}).trackedFetch;
const start = require('./netlify/functions/start-veo-video.cjs').handler;
const status = require('./netlify/functions/veo-video-status.cjs').handler;
const download = require('./netlify/functions/download-veo-video.cjs').download;
const event = (method = 'GET', operation = 'interactions/mock') => ({httpMethod:method, queryStringParameters:{operation}});
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1sAAAAASUVORK5CYII=';
const {REFERENCE_INSTRUCTION}=require('./netlify/lib/video-references.cjs');
const input = {image:'data:image/png;base64,'+png, prompt:'Product showcase', aspectRatio:'9:16'};
const post = body => ({httpMethod:'POST', body:JSON.stringify(body)});
const read = response => JSON.parse(response.body);
const completed = video => ({status:'completed', steps:[{type:'model_output', content:[{type:'video', mime_type:'video/mp4', ...video}]}]});
function fileTypeBox(major = 'isom', compatible = ['mp42']) {
  const bytes = Buffer.alloc(16 + compatible.length * 4);
  bytes.writeUInt32BE(bytes.length, 0);
  bytes.write('ftyp', 4); bytes.write(major, 8);
  compatible.forEach((brand, index) => bytes.write(brand, 16 + index * 4));
  return bytes;
}
function reset() {
  payload = {id:'mock', status:'in_progress'}; responseStatus = 200; networkError = null;
  requests.length = 0; records.length = 0;
  process.env.GEMINI_API_KEY = 'mock-key'; delete process.env.GOOGLE_DEVELOPER_API_KEY;
}
after(() => {
  usage.trackedFetch = originalTracker;
  for (const [key, value] of Object.entries(originalKeys)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test('start submits exactly one background Omni interaction and returns immediately without polling', async () => {
  reset(); process.env.GOOGLE_DEVELOPER_API_KEY = 'preferred-mock-key';
  const response = await start(post(input));
  assert.equal(response.statusCode, 202); assert.equal(read(response).operation, 'interactions/mock');
  assert.equal(requests.length, 1); assert.equal(requests[0].url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
  const {options} = requests[0];
  assert.equal(options.headers['x-goog-api-key'], 'preferred-mock-key');
  assert.equal(options.headers['Api-Revision'], '2026-05-20');
  assert.deepEqual(JSON.parse(options.body), {
    model:'gemini-omni-1.1-flash', background:true, store:true,
    input:[{type:'image', data:png, mime_type:'image/png'}, {type:'text', text:'Product showcase\n\n'+REFERENCE_INSTRUCTION}],
    response_format:{type:'video', aspect_ratio:'9:16', duration:'8s', resolution:'720p', delivery:'uri'}
  });
  assert.equal(usage.summarize(records).totals.veo.submitted, 1);
  assert.doesNotMatch(JSON.stringify(records), /mock-key|Product showcase|YWJj/);
});
test('input validation, missing key, unsupported methods and malformed provider responses', async () => {
  reset(); delete process.env.GEMINI_API_KEY;
  assert.equal((await start(post(input))).statusCode, 500);
  process.env.GEMINI_API_KEY = 'mock-key';
  assert.equal((await start(event('GET'))).statusCode, 405);
  for (const body of [null, [], {}, {...input, prompt:''}, {...input, aspectRatio:'4:3'},
    {...input, image:'data:image/gif;base64,YWJj'}, {...input, image:'data:image/png;base64,!!!'},
    {...input, image:`data:image/png;base64,${Buffer.alloc(20 * 1024 * 1024 + 1).toString('base64')}`}]) {
    assert.equal((await start(post(body))).statusCode, 400);
  }
  assert.equal((await start({httpMethod:'POST', body:'{'})).statusCode, 400);
  assert.equal(requests.length, 0);
  for (const id of ['', '../evil', 'mock?key=secret', 'https://evil.test']) {
    payload = {id}; assert.equal((await start(post(input))).statusCode, 502);
  }
  payload = new Response('not json'); assert.equal((await start(post(input))).statusCode, 502);
});
test('friendly quota, authentication, permission, network and timeout errors never echo secrets', async () => {
  reset();
  for (const handler of [() => start(post(input)), () => status(event()), () => download(event())]) {
    for (const code of [400, 401, 403, 404, 429, 500]) {
      responseStatus = code; payload = {error:{message:'mock-key private prompt data:image/png;base64,YWJj'}};
      const response = await handler();
      assert.equal(response.statusCode, code === 429 ? 429 : 502);
      assert.doesNotMatch(response.body, /mock-key|private prompt|YWJj/);
      if (code === 429) assert.match(read(response).error, /gebruikslimiet van Google/);
    }
  }
  responseStatus = 200;
  for (const name of ['Error', 'TimeoutError']) {
    networkError = Object.assign(new Error('mock-key'), {name});
    const response = await start(post(input)); assert.equal(response.statusCode, 502);
    assert.doesNotMatch(response.body, /mock-key/);
  }
});
test('status supports pending/completed/failed/cancelled, omits video data and deduplicates usage', async () => {
  reset(); await start(post(input));
  for (const state of ['in_progress', 'completed', 'failed', 'cancelled', 'incomplete', 'requires_action', 'bogus']) {
    payload = state === 'completed' ? completed({data:Buffer.from('fake-mp4').toString('base64')}) : {status:state};
    const response = await status(event());
    assert.equal(response.statusCode, ['in_progress', 'completed', 'failed', 'cancelled'].includes(state) ? 200 : 502);
    const expected = {in_progress:'pending', completed:'completed', failed:'failed', cancelled:'failed'};
    assert.equal(read(response).state, expected[state] || 'unknown');
    assert.doesNotMatch(response.body, /steps|fake-mp4|ZmFrZS1tcDQ/);
  }
  payload = completed({data:Buffer.from('fake-mp4').toString('base64')});
  await status(event()); await status(event());
  const summary = usage.summarize(records);
  assert.equal(summary.totals.veo.attempts, 1); assert.equal(summary.totals.veo.completed, 1);
  assert.equal(summary.totals.veo.videos, 1); assert.equal(summary.totals.veo.estimatedCompletedSeconds, 8);
  assert.doesNotMatch(JSON.stringify(records), /ZmFrZS1tcDQ/);
  for (const operation of ['interactions/../evil', 'interactions/mock?key=x', 'https://evil.test']) {
    assert.equal((await status(event('GET', operation))).statusCode, 400);
  }
});
test('download returns inline MP4, waits for pending and rejects malformed, oversized or unsafe media', async () => {
  reset(); payload = {status:'in_progress'};
  assert.equal((await download(event())).statusCode, 409);
  payload = {status:'failed'}; assert.equal((await download(event())).statusCode, 422);
  payload = completed({data:Buffer.from('fake-mp4').toString('base64')});
  const response = await download(event());
  assert.equal(response.statusCode, 200); assert.equal(response.headers['Content-Type'], 'video/mp4');
  assert.equal(response.body.toString(), 'fake-mp4');
  for (const video of [{data:'!!!'}, {data:'YWJ'}, {data:'YW=J'}, {data:'A==='},
    {data:Buffer.alloc(MAX_DOWNLOAD_BYTES + 1).toString('base64')},
    {uri:'https://evil.test/video.mp4'}, {uri:'http://generativelanguage.googleapis.com/v1beta/files/x:download'}]) {
    payload = completed(video); assert.equal((await download(event())).statusCode, 502);
  }
  assert.equal(requests.filter(request => !request.url.includes('/interactions/')).length, 0);
});
test('URI download stays on Google, sends credentials only there and rejects redirects or non-video content', async () => {
  reset();
  payload = (url, options) => {
    if (url.endsWith('/interactions/mock')) return Response.json(completed({uri:'files/mock:download?key=untrusted'}));
    assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/files/mock:download?alt=media');
    assert.equal(options.headers['x-goog-api-key'], 'mock-key');
    assert.equal(options.redirect, 'error');
    return new Response('fake-mp4', {headers:{'Content-Type':'video/mp4'}});
  };
  const response = await download(event()); assert.equal(response.statusCode, 200);
  assert.equal(response.body.toString(), 'fake-mp4');
  payload = url => url.endsWith('/interactions/mock')
    ? Response.json(completed({uri:'files/mock:download'})) : new Response('<html>not video</html>');
  assert.equal((await download(event())).statusCode, 502);
});
test('video URI without MIME metadata is extracted, reported available and downloaded safely', async () => {
  reset();
  const {interactionVideo} = require('./netlify/lib/video-response.cjs');
  const video = {type:'video', uri:'files/mock:download?key=untrusted'};
  const interaction = {status:'completed', steps:[{type:'model_output', content:[video]}]};
  assert.equal(interactionVideo(interaction), video);
  payload = url => url.endsWith('/interactions/mock') ? Response.json(interaction)
    : new Response('fake-mp4', {headers:{'Content-Type':'video/mp4'}});
  const result = read(await status(event()));
  assert.equal(result.state, 'completed');
  assert.equal(result.outputAvailable, true);
  assert.doesNotMatch(JSON.stringify(result), /files\/mock|untrusted/);
  const response = await download(event());
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.toString(), 'fake-mp4');
  assert.equal(requests.at(-1).url, 'https://generativelanguage.googleapis.com/v1beta/files/mock:download?alt=media');
  assert.equal(requests.at(-1).options.redirect, 'error');
  assert.equal(requests.filter(request => request.options.method === 'POST').length, 0);
});
test('missing MIME metadata does not bypass video type, output or download validation', async () => {
  reset();
  const {interactionVideo} = require('./netlify/lib/video-response.cjs');
  for (const video of [{type:'image', uri:'files/mock:download'}, {type:'video'},
    {type:'video', uri:'', data:''}, {type:'video', mime_type:'video/webm', uri:'files/mock:download'},
    {type:'video', mime_type:'text/html', data:'YWJj'},
    {type:'video', mime_type:'', uri:'files/mock:download'}]) {
    const interaction = {status:'completed', steps:[{type:'model_output', content:[video]}]};
    assert.equal(interactionVideo(interaction), undefined);
    payload = interaction;
    assert.equal(read(await status(event())).outputAvailable, false);
    assert.equal((await download(event())).statusCode, 502);
  }
  payload = completed({mime_type:undefined, uri:'https://evil.test/video.mp4'});
  assert.equal((await download(event())).statusCode, 502);
  assert.equal(requests.filter(request => request.url.startsWith('https://evil.test')).length, 0);
  payload = url => url.endsWith('/interactions/mock')
    ? Response.json(completed({mime_type:undefined, uri:'files/mock:download'}))
    : new Response('<html>not video</html>', {headers:{'Content-Type':'text/html'}});
  assert.equal((await download(event())).statusCode, 502);
});
test('observed video/unknown response accepts bounded MP4 ftyp and serves video/mp4', async () => {
  reset();
  for (const bytes of [fileTypeBox(), fileTypeBox('zzzz', ['mp42']), fileTypeBox('mp42', [])]) {
    payload = (url, options) => {
      if (url.endsWith('/interactions/mock')) return Response.json(completed({mime_type:undefined, uri:'files/mock:download?alt=media'}));
      assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/files/mock:download?alt=media');
      assert.equal(options.headers['x-goog-api-key'], 'mock-key');
      assert.equal(options.redirect, 'error');
      return new Response(bytes, {headers:{'Content-Type':'video/unknown'}});
    };
    const response = await download(event());
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['Content-Type'], 'video/mp4');
    assert.deepEqual(response.body, bytes);
  }
  assert.equal(requests.filter(request => request.options.method === 'POST').length, 0);
});
test('video/unknown rejects non-MP4 brands, malformed and unbounded ftyp boxes', async () => {
  reset();
  const wrongBox = fileTypeBox(); wrongBox.write('moov', 4);
  const invalidSizes = [0, 1, 12, 19, 24, 0xffffffff].map(size => {
    const bytes = fileTypeBox(); bytes.writeUInt32BE(size, 0); return bytes;
  });
  const excessiveBox = Buffer.alloc(4100); fileTypeBox().copy(excessiveBox);
  excessiveBox.writeUInt32BE(excessiveBox.length, 0);
  const minorVersionOnly = fileTypeBox('zzzz', []); minorVersionOnly.write('mp42', 12);
  for (const bytes of [Buffer.alloc(0), Buffer.from('{"error":"private detail"}'),
    Buffer.from('<html>not video</html>'), fileTypeBox().subarray(0, 15),
    fileTypeBox('avif', ['mif1']), fileTypeBox('qt  ', []), minorVersionOnly,
    wrongBox, excessiveBox, ...invalidSizes]) {
    payload = url => url.endsWith('/interactions/mock')
      ? Response.json(completed({mime_type:undefined, uri:'files/mock:download'}))
      : new Response(bytes, {headers:{'Content-Type':'video/unknown'}});
    const response = await download(event());
    assert.equal(response.statusCode, 502);
    assert.equal(read(response).error, 'Google gaf een ongeldige videodownload.');
    assert.doesNotMatch(response.body, /private detail|<html>/);
  }
});
test('unknown-video fallback preserves MIME, size, URL and redirect restrictions', async () => {
  reset();
  for (const mime of ['application/json', 'text/html', 'application/octet-stream', 'video/webm', 'video/mp4-invalid']) {
    payload = url => url.endsWith('/interactions/mock')
      ? Response.json(completed({uri:'files/mock:download'}))
      : new Response(fileTypeBox(), {headers:{'Content-Type':mime}});
    assert.equal((await download(event())).statusCode, 502);
  }
  const oversized = Buffer.alloc(MAX_DOWNLOAD_BYTES + 1); fileTypeBox().copy(oversized);
  payload = url => url.endsWith('/interactions/mock')
    ? Response.json(completed({uri:'files/mock:download'}))
    : new Response(oversized, {headers:{'Content-Type':'video/unknown'}});
  assert.match(read(await download(event())).error, /te groot/);
  payload = completed({uri:'https://evil.test/video.mp4'});
  assert.equal((await download(event())).statusCode, 502);
  assert.equal(requests.filter(request => request.url.startsWith('https://evil.test')).length, 0);
  payload = (url, options) => {
    if (url.endsWith('/interactions/mock')) return Response.json(completed({uri:'files/mock:download'}));
    assert.equal(options.redirect, 'error');
    return new Response(null, {status:302, headers:{Location:'https://evil.test/video.mp4'}});
  };
  assert.equal((await download(event())).statusCode, 502);
});
test('production-sized, eight-second-sized and exact-cap downloads fit the raw streaming budget', async () => {
  reset();
  for (const size of [PRODUCTION_VIDEO_BYTES, 8 * 1024 * 1024, MAX_DOWNLOAD_BYTES]) {
    const bytes = Buffer.alloc(size); fileTypeBox().copy(bytes);
    for (const source of ['video/mp4', 'video/unknown']) {
      payload = url => url.endsWith('/interactions/mock')
        ? Response.json(completed({mime_type:undefined, uri:'files/mock:download'}))
        : new Response(bytes, {headers:{'Content-Type':source}});
      const response = await download(event());
      assert.equal(response.statusCode, 200, `${source}: ${size} bytes`);
      assert.equal(response.isBase64Encoded, undefined);
      assert.equal(response.headers['Content-Type'], 'video/mp4');
      assert.deepEqual(response.body, bytes);
      const streamed = await require('./netlify/functions/download-veo-video.cjs').default(
        new Request('https://studio.test/.netlify/functions/download-veo-video?operation=interactions/mock'));
      assert.equal(streamed.status, 200);
      assert.ok(streamed.body instanceof ReadableStream);
      assert.equal(streamed.headers.get('Content-Length'), String(size));
      assert.deepEqual(Buffer.from(await streamed.arrayBuffer()), bytes);
      assert.ok(size < MAX_STREAMED_RESPONSE_BYTES);
    }
  }
  assert.equal(requests.filter(request => request.options.method === 'POST').length, 0);
});
test('cap-plus-one URI downloads are rejected for MP4 and validated unknown-video sources', async () => {
  reset();
  const bytes = Buffer.alloc(MAX_DOWNLOAD_BYTES + 1); fileTypeBox().copy(bytes);
  for (const source of ['video/mp4', 'video/unknown']) {
    payload = url => url.endsWith('/interactions/mock')
      ? Response.json(completed({mime_type:undefined, uri:'files/mock:download'}))
      : new Response(bytes, {headers:{'Content-Type':source}});
    const response = await download(event());
    assert.equal(response.statusCode, 502, source);
    assert.equal(read(response).error,
      'Deze video is te groot om via de videodienst te downloaden. Neem contact op met de ondersteuning.');
  }
  assert.equal(requests.filter(request => request.options.method === 'POST').length, 0);
});
test('the new environment-key alias is also redacted from historical Veo diagnostics', () => {
  reset(); process.env.GOOGLE_DEVELOPER_API_KEY = 'private-alias-key';
  const {failureDetails} = require('./netlify/lib/veo-failure.cjs');
  const result = failureDetails({error:{message:'Authentication failed: private-alias-key'}});
  assert.doesNotMatch(JSON.stringify(result), /private-alias-key/);
});
test('historical Veo operation status and downloads remain compatible', async () => {
  reset();
  payload = url => url.includes('/operations/')
    ? Response.json({done:true, response:{generatedVideos:[{video:{uri:'https://generativelanguage.googleapis.com/v1beta/files/legacy:download'}}]}})
    : new Response('legacy-mp4', {headers:{'Content-Type':'video/mp4'}});
  const legacy = event('GET', 'operations/legacy');
  assert.equal(read(await status(legacy)).state, 'completed');
  assert.equal((await download(legacy)).body.toString(), 'legacy-mp4');
});
test('completed without supported video is not provider failure and does not invent output formats', async () => {
  reset(); await start(post(input));
  for (const output of [{status:'completed'}, {status:'completed', steps:[]},
    {status:'completed', output_video:{uri:'files/mock:download'}},
    {status:'completed', steps:[{type:'model_output', content:[{type:'video', mime_type:'video/webm', uri:'files/mock:download'}]}]}]) {
    payload = output;
    const response = await status(event());
    assert.equal(response.statusCode, 200);
    assert.equal(read(response).state, 'completed');
    assert.equal(read(response).outputAvailable, false);
    assert.equal(read(response).category, 'output-unavailable');
    assert.match(read(response).message, /voltooid.*niet beschikbaar of niet herkend/);
    assert.doesNotMatch(response.body, /kon deze video niet genereren|output_video|files\/mock/);
    const video = await download(event());
    assert.equal(video.statusCode, 502);
    assert.equal(read(video).category, 'output-unavailable');
    assert.equal(records.at(-1).operationState, 'completed');
    assert.equal(records.at(-1).videoCount, 0);
  }
  const totals = usage.summarize(records).totals.veo;
  assert.equal(totals.completed, 1); assert.equal(totals.videos, 0); assert.equal(totals.failed, 0);
  assert.equal(requests.filter(request => request.options.method === 'POST').length, 1);
});
test('confirmed failure and unknown status diagnostics never expose provider details', async () => {
  reset();
  for (const state of ['failed', 'cancelled', 'incomplete', 'requires_action', 'bogus']) {
    payload = {status:state, error:{message:'mock-key private prompt data:image/png;base64,YWJj'}};
    const response = await status(event());
    assert.equal(response.statusCode, ['failed', 'cancelled'].includes(state) ? 200 : 502);
    assert.equal(read(response).state, ['failed', 'cancelled'].includes(state) ? 'failed' : 'unknown');
    assert.doesNotMatch(response.body, /mock-key|private prompt|YWJj/);
  }
});
test('streaming entrypoints preserve validation, pending and safe timeout errors', async () => {
  for (const file of ['download-veo-video', 'download-veo-test']) {
    reset();
    const serve = require(`./netlify/functions/${file}.cjs`).default;
    const url = `https://studio.test/.netlify/functions/${file}?operation=interactions/mock`;
    assert.equal((await serve(new Request(url, {method:'POST'}))).status, 405);
    assert.equal((await serve(new Request(url.replace('interactions/mock', 'invalid')))).status, 400);
    delete process.env.GEMINI_API_KEY;
    assert.equal((await serve(new Request(url))).status, 500);
    process.env.GEMINI_API_KEY = 'mock-key';
    payload = {status:'in_progress'};
    assert.equal((await serve(new Request(url))).status, 409);
    payload = url => url.endsWith('/interactions/mock')
      ? Response.json(completed({uri:'files/mock:download'}))
      : new Response(new ReadableStream({start(controller) {
        controller.error(Object.assign(new Error('mock-key private detail'), {name:'TimeoutError'}));
      }}), {headers:{'Content-Type':'video/mp4'}});
    const response = await serve(new Request(url));
    assert.equal(response.status, 502);
    const message = await response.text();
    assert.match(message, /duurde te lang/);
    assert.doesNotMatch(message, /mock-key|private detail/);
    assert.equal(requests.filter(request => request.options.method === 'POST').length, 0);
  }
});

test('status and downloads do not need a second paid generation', async () => {
  reset(); await start(post(input));
  payload = completed({data:Buffer.from('fake-mp4').toString('base64')});
  await status(event()); await download(event()); await download(event());
  assert.equal(requests.filter(request => request.options.method === 'POST').length, 1);
});
