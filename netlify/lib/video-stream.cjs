// Leave headroom below Netlify's 20 MB streamed-response limit.
const MAX_DOWNLOAD_BYTES = 18 * 1024 * 1024;

async function readVideoBytes(response) {
  if (Number(response.headers.get('Content-Length')) > MAX_DOWNLOAD_BYTES) {
    await response.body?.cancel();
    throw new RangeError('Video exceeds download limit');
  }
  const chunks = [];
  let size = 0;
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_DOWNLOAD_BYTES) {
        await reader.cancel();
        throw new RangeError('Video exceeds download limit');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, size);
}

function videoResult(bytes, filename = 'spectron-ai-video.mp4') {
  return {statusCode:200, headers:{'Content-Type':'video/mp4',
    'Content-Disposition':`attachment; filename="${filename}"`, 'Cache-Control':'no-store'}, body:bytes};
}

async function serveDownload(request, download, feature) {
  const event = {httpMethod:request.method,
    queryStringParameters:Object.fromEntries(new URL(request.url).searchParams)};
  const result = await download(event, undefined, feature);
  if (result.statusCode !== 200) {
    return new Response(result.body, {status:result.statusCode, headers:result.headers});
  }
  // Validate/bound upstream media before sending headers, then send raw chunks:
  // no base64 Lambda response envelope or 6 MB buffered-response limit.
  let offset = 0;
  const bytes = result.body;
  const body = new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) { controller.close(); return; }
      const end = Math.min(offset + 64 * 1024, bytes.length);
      controller.enqueue(bytes.subarray(offset, end));
      offset = end;
    }
  });
  return new Response(body, {status:200, headers:{...result.headers,
    'Content-Length':String(bytes.length), 'X-Content-Type-Options':'nosniff'}});
}

module.exports = {MAX_DOWNLOAD_BYTES, readVideoBytes, videoResult, serveDownload};
