const { trackedFetch } = require('../lib/usage.cjs');
const omniVideo = require('../lib/omni-video.cjs');
const { readVideoBytes, videoResult, serveDownload } = require('../lib/video-stream.cjs');
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const OPERATION_PATTERN = /^(?:operations\/[A-Za-z0-9._-]+|models\/[A-Za-z0-9._-]+\/operations\/[A-Za-z0-9._-]+)$/;
const GOOGLE_HOSTS = new Set(['generativelanguage.googleapis.com','storage.googleapis.com']);
function reply(statusCode, body) { return {statusCode, headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)}; }
function validVideoUri(value) { try { const url = new URL(value); return GOOGLE_HOSTS.has(url.hostname) && (url.hostname === 'storage.googleapis.com' || url.pathname.startsWith('/v1beta/')); } catch { return false; } }
function extractVideoUri(result) { return result?.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri || result?.response?.generatedVideos?.[0]?.video?.uri || ''; }
async function download(event, context, feature='veo-test') {
  if (event.httpMethod !== 'GET') return reply(405,{error:'Method not allowed.'});
  const operation = event.queryStringParameters?.operation || '';
  if (operation.startsWith('interactions/')) return omniVideo.download(event, feature);
  if (!OPERATION_PATTERN.test(operation)) return reply(400,{error:'Invalid video operation name.'});
  const apiKey = omniVideo.apiKey();
  if (!apiKey) return reply(500,{error:'GEMINI_API_KEY is not configured on the server.'});
  try {
    const statusResponse = await trackedFetch(event, {provider:'veo', feature, requestType:'status', operation}, `${API_BASE}/${operation}`,{headers:{'x-goog-api-key':apiKey},signal:AbortSignal.timeout(20000)});
    let status = null; try { status = await statusResponse.json(); } catch {}
    if (!statusResponse.ok) return reply(statusResponse.status === 401 || statusResponse.status === 403 ? statusResponse.status : 502,{error:'Google operation status could not be read.'});
    if (!status || typeof status !== 'object' || Array.isArray(status) || (status.done !== undefined && typeof status.done !== 'boolean')) return reply(502,{error:'Google returned an invalid operation status.'});
    if (status.done !== true) return reply(409,{error:'The Veo video is not ready yet.'});
    if (status.error) return reply(422,{error:/safety|blocked|unsafe|policy/i.test(JSON.stringify(status.error)) ? 'Google safety checks blocked this video request.' : 'Google reported that the video request failed.'});
    const videoUri = extractVideoUri(status);
    if (!validVideoUri(videoUri)) return reply(502,{error:'Google returned an unavailable or unsafe video reference.'});
    const videoResponse = await trackedFetch(event, {provider:'veo', feature, requestType:'download', operation}, videoUri,{headers:new URL(videoUri).hostname === 'generativelanguage.googleapis.com' ? {'x-goog-api-key':apiKey} : {},signal:AbortSignal.timeout(60000)});
    if (!videoResponse.ok) return reply(502,{error:'The generated video is unavailable or has expired.'});
    if (!(videoResponse.headers?.get('Content-Type') || '').toLowerCase().startsWith('video/mp4')) return reply(502,{error:'Google returned an invalid video response.'});
    const bytes = await readVideoBytes(videoResponse);
    if (!bytes.length) return reply(502,{error:'Google returned an empty video.'});
    return videoResult(bytes, 'veo-test.mp4');
  } catch (error) { return reply(502,{error:error instanceof RangeError ? 'This video is too large to download through the video service. Please contact support.' : error?.name === 'TimeoutError' ? 'The video download timed out.' : 'The video download failed.'}); }
}

exports.download = download;
exports.default = request => serveDownload(request, download, 'veo-test');
