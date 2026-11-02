/** @typedef {{httpMethod:string, body?:string, queryStringParameters?:Record<string,string>, blobs?:string}} VideoEvent */
/** @typedef {import('./video-response.cjs').Interaction} Interaction */
/** @typedef {import('./video-response.cjs').VideoContent} VideoContent */

const { trackedFetch } = require('./usage.cjs');
const { INTERACTION_PATTERN, interactionVideo, interactionState } = require('./video-response.cjs');
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const REQUEST_TIMEOUT_MS = 20000;
const MAX_DOWNLOAD_BYTES = 4.25 * 1024 * 1024;
const MAX_FTYP_BYTES = 4096;
const MIN_FTYP_BYTES = 16;
const MP4_BRANDS = new Set(['isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1']);
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function apiKey() {
  return process.env.GOOGLE_DEVELOPER_API_KEY || process.env.GEMINI_API_KEY;
}
/** @param {number} statusCode @param {Record<string, unknown>} body */
function reply(statusCode, body) {
  return {statusCode, headers:{'Content-Type':'application/json', 'Cache-Control':'no-store'}, body:JSON.stringify(body)};
}
function headers() {
  return {'Content-Type':'application/json', 'x-goog-api-key':apiKey(), 'Api-Revision':'2026-05-20'};
}
/** @param {number} status */
function googleFailure(status) {
  const errors = {
    400:'Google rejected the video request. Check your image and prompt.',
    401:'The video service could not authenticate with Google.',
    403:'The configured API key is not permitted to use Google video generation.',
    404:'The Google video model or request was not found. It may have expired.',
    429:'Google usage limit reached. Please try again later.'
  };
  return reply(status === 429 ? 429 : 502, {error:errors[status] || 'Google could not complete the video request.'});
}
/** @param {{name?:string} | null} error */
function networkFailure(error) {
  return reply(502, {error:error?.name === 'TimeoutError'
    ? 'Google took too long to respond. The video request may still be running.'
    : 'The Google video service could not be reached. Please try again later.'});
}
/** @param {VideoEvent} event @param {Record<string, string|number>} details @param {string} path @param {RequestInit} options */
async function requestJSON(event, details, path, options = {}) {
  const response = await trackedFetch(event, {provider:'veo', ...details}, `${API_BASE}/${path}`, {
    ...options, headers:headers(), signal:AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  if (!response.ok) return {failure:googleFailure(response.status)};
  try { return {data:await response.json()}; }
  catch { return {failure:reply(502, {error:'Google returned an invalid video response.'})}; }
}
/** @param {VideoEvent} event */
function validateStatusRequest(event) {
  if (event.httpMethod !== 'GET') return reply(405, {error:'Method not allowed.'});
  if (!INTERACTION_PATTERN.test(event.queryStringParameters?.operation || '')) {
    return reply(400, {error:'Invalid video operation name.'});
  }
  if (!apiKey()) return reply(500, {error:'The Google video API key is not configured on the server.'});
}
/** @param {VideoEvent} event @param {string} feature */
async function readOperation(event, feature) {
  const operation = event.queryStringParameters.operation;
  return requestJSON(event, {feature, requestType:'status', operation}, operation);
}
/** @param {Interaction | null} result */
function failedGeneration(result) {
  // Never expose provider diagnostics, which can contain prompts or credentials.
  const filtered = /safety|blocked|policy|filter/i.test(JSON.stringify(result?.error || {}));
  return {state:'failed', category:filtered ? 'content-filter' : 'generation-failed',
    message:filtered ? "Google's content filter blocked this video. Try a different image or prompt."
      : result?.status === 'cancelled' ? 'The Google video request was cancelled.'
      : 'Google could not generate this video. Try a different image or prompt.'};
}
/** @param {VideoEvent} event @param {string} feature */
async function status(event, feature) {
  const invalid = validateStatusRequest(event);
  if (invalid) return invalid;
  try {
    const {data, failure} = await readOperation(event, feature);
    if (failure) return failure;
    const state = interactionState(data);
    const operation = event.queryStringParameters.operation;
    if (state === 'unknown') return reply(502, {state, operation, category:'monitoring-interrupted',
      error:'The video status could not be determined. Check this existing request again; no new video has been started.'});
    if (state === 'failed') return reply(200, {...failedGeneration(data), operation});
    if (state === 'completed' && !interactionVideo(data)) return reply(200, {state, operation,
      outputAvailable:false, category:'output-unavailable', message:unavailableOutputMessage()});
    return reply(200, {state, operation, ...(state === 'completed' ? {outputAvailable:true, videoReference:operation} : {})});
  } catch (error) { return networkFailure(error); }
}
function unavailableOutputMessage() {
  return 'Google reports this request completed, but its video output is unavailable or unrecognised. Check the existing request again or contact support.';
}
function oversizedVideo() {
  return reply(502, {error:'This video is too large to download through the video service. Please contact support.'});
}
/** @param {Buffer} bytes */
function videoReply(bytes) {
  if (!bytes.length) return reply(502, {error:'Google returned an empty video.'});
  if (bytes.length > MAX_DOWNLOAD_BYTES) return oversizedVideo();
  return {statusCode:200, isBase64Encoded:true, headers:{'Content-Type':'video/mp4',
    'Content-Disposition':'attachment; filename="spectron-ai-video.mp4"', 'Cache-Control':'no-store'},
    body:bytes.toString('base64')};
}
/** Validate the first normal-size ftyp box, not the video's decodability. @param {Buffer} bytes */
function hasMP4FileType(bytes) {
  if (bytes.length < MIN_FTYP_BYTES || bytes.toString('latin1', 4, 8) !== 'ftyp') return false;
  const size = bytes.readUInt32BE(0);
  if (size < MIN_FTYP_BYTES || size > MAX_FTYP_BYTES || size > bytes.length || size % 4 !== 0) return false;
  if (MP4_BRANDS.has(bytes.toString('latin1', 8, 12))) return true;
  for (let offset = MIN_FTYP_BYTES; offset < size; offset += 4) {
    if (MP4_BRANDS.has(bytes.toString('latin1', offset, offset + 4))) return true;
  }
  return false;
}
/** @param {string} uri @returns {string | null} */
function downloadUrl(uri) {
  try {
    const url = new URL(uri, `${API_BASE}/`);
    if (url.protocol !== 'https:' || url.hostname !== 'generativelanguage.googleapis.com'
      || url.port || url.username || url.password || !/^\/v1beta\/files\/[A-Za-z0-9_-]+:download$/.test(url.pathname)) return null;
    return `${url.origin}${url.pathname}?alt=media`;
  } catch { return null; }
}
/** @param {VideoEvent} event @param {string} feature @param {VideoContent} video */
async function downloadVideo(event, feature, video) {
  if (typeof video.data === 'string') {
    if (video.data.length > Math.ceil(MAX_DOWNLOAD_BYTES / 3) * 4) return oversizedVideo();
    if (!BASE64_PATTERN.test(video.data)) return reply(502, {error:'Google returned invalid video data.'});
    return videoReply(Buffer.from(video.data, 'base64'));
  }
  const url = downloadUrl(video.uri);
  if (!url) return reply(502, {error:'Google returned an unavailable video reference.'});
  const response = await trackedFetch(event, {provider:'veo', feature, requestType:'download',
    operation:event.queryStringParameters.operation}, url, {
    headers:headers(), redirect:'error', signal:AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  if (!response.ok) return googleFailure(response.status);
  const mime = (response.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (mime !== 'video/mp4' && mime !== 'video/unknown') {
    return reply(502, {error:'Google returned an invalid video download.'});
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_DOWNLOAD_BYTES) return oversizedVideo();
  if (mime === 'video/unknown' && !hasMP4FileType(bytes)) {
    return reply(502, {error:'Google returned an invalid video download.'});
  }
  return videoReply(bytes);
}
/** @param {VideoEvent} event @param {string} feature */
async function download(event, feature) {
  const invalid = validateStatusRequest(event);
  if (invalid) return invalid;
  try {
    const {data, failure} = await readOperation(event, feature);
    if (failure) return failure;
    const state = interactionState(data);
    if (state === 'pending') return reply(409, {error:'The video is not ready yet.'});
    if (state === 'failed') return reply(422, {error:failedGeneration(data).message});
    if (state !== 'completed') return reply(502, {error:'Google returned an invalid video status.'});
    const video = interactionVideo(data);
    if (!video) return reply(502, {error:unavailableOutputMessage(), category:'output-unavailable'});
    return await downloadVideo(event, feature, video);
  } catch (error) { return networkFailure(error); }
}

module.exports = {apiKey, reply, requestJSON, networkFailure, status, download};
