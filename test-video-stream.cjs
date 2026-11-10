const {test} = require('node:test');
const assert = require('node:assert/strict');
const {MAX_DOWNLOAD_BYTES, readVideoBytes, videoResult, serveDownload} = require('./netlify/lib/video-stream.cjs');

test('raw MP4 stream preserves bytes above the old limit and uses bounded chunks', async () => {
  const bytes = Buffer.alloc(8 * 1024 * 1024, 17);
  const response = await serveDownload(new Request('https://studio.test/download?operation=interactions/mock'),
    async (event, context, feature) => {
      assert.equal(event.httpMethod, 'GET');
      assert.equal(event.queryStringParameters.operation, 'interactions/mock');
      assert.equal(feature, 'ai-video');
      return videoResult(bytes);
    }, 'ai-video');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'video/mp4');
  assert.equal(response.headers.get('Content-Length'), String(bytes.length));
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.match(response.headers.get('Content-Disposition'), /attachment.*\.mp4/);
  const chunks = [];
  for await (const chunk of response.body) {
    assert.ok(chunk.byteLength <= 64 * 1024);
    chunks.push(chunk);
  }
  assert.deepEqual(Buffer.concat(chunks), bytes);
});

test('HTTP error status and JSON body survive without becoming MP4', async () => {
  for (const code of [400, 405, 409, 422, 429, 500, 502]) {
    const response = await serveDownload(new Request('https://studio.test/download', {method:'POST'}),
      async event => {
        assert.equal(event.httpMethod, 'POST');
        return {statusCode:code, headers:{'Content-Type':'application/json', 'Cache-Control':'no-store'},
          body:JSON.stringify({error:'Safe message'})};
      }, 'veo-test');
    assert.equal(response.status, code);
    assert.equal(response.headers.get('Content-Type'), 'application/json');
    assert.deepEqual(await response.json(), {error:'Safe message'});
  }
});

test('upstream length above the cap cancels before reading', async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({cancel() { cancelled = true; }}),
    {headers:{'Content-Length':String(MAX_DOWNLOAD_BYTES + 1)}});
  await assert.rejects(readVideoBytes(response), RangeError);
  assert.equal(cancelled, true);
});

for (const declared of [undefined, '1']) test(`actual bytes enforce cap with ${declared ? 'incorrect' : 'missing'} Content-Length`, async () => {
  let cancelled = false, reads = 0;
  const response = new Response(new ReadableStream({
    pull(controller) {
      reads++;
      controller.enqueue(new Uint8Array(1024 * 1024));
    },
    cancel() { cancelled = true; }
  }), {headers:declared ? {'Content-Length':declared} : {}});
  await assert.rejects(readVideoBytes(response), RangeError);
  assert.equal(cancelled, true);
  assert.ok(reads <= 20, 'reader must stop instead of consuming an unbounded source');
});

test('bounded reader retains exact-cap bytes and handles empty media', async () => {
  const bytes = Buffer.alloc(MAX_DOWNLOAD_BYTES, 23);
  assert.deepEqual(await readVideoBytes(new Response(bytes)), bytes);
  assert.equal((await readVideoBytes(new Response(null))).length, 0);
});

test('upstream timeout propagates instead of returning a partial success', async () => {
  const timeout = Object.assign(new Error('private provider detail'), {name:'TimeoutError'});
  const response = new Response(new ReadableStream({start(controller) { controller.error(timeout); }}));
  await assert.rejects(readVideoBytes(response), {name:'TimeoutError'});
});
