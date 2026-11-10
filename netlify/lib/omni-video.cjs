/** @typedef {{httpMethod:string, body?:string, queryStringParameters?:Record<string,string>, blobs?:string}} VideoEvent */
/** @typedef {import('./video-response.cjs').Interaction} Interaction */
/** @typedef {import('./video-response.cjs').VideoContent} VideoContent */

const { trackedFetch } = require('./usage.cjs');
const { INTERACTION_PATTERN, interactionVideo, interactionState } = require('./video-response.cjs');
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const REQUEST_TIMEOUT_MS = 20000;
const { MAX_DOWNLOAD_BYTES, readVideoBytes, videoResult } = require('./video-stream.cjs');
const MAX_FTYP_BYTES = 4096;
const MIN_FTYP_BYTES = 16;
const MP4_BRANDS = new Set(['isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1']);
// Avoid repeated multi-character groups: V8 can overflow its regexp stack on large videos.
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

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
    400:'Google heeft de videoaanvraag geweigerd. Controleer je afbeelding en beschrijving.',
    401:'De videodienst kon zich niet aanmelden bij Google.',
    403:'De ingestelde API-sleutel heeft geen toegang tot videogeneratie bij Google.',
    404:'Het Google-videomodel of de aanvraag is niet gevonden. De aanvraag is mogelijk verlopen.',
    429:'De gebruikslimiet van Google is bereikt. Probeer het later opnieuw.'
  };
  return reply(status === 429 ? 429 : 502, {error:errors[status] || 'Google kon de videoaanvraag niet voltooien.'});
}
/** @param {{name?:string} | null} error */
function networkFailure(error) {
  return reply(502, {error:error?.name === 'TimeoutError'
    ? 'Het antwoord van Google duurde te lang. De videoaanvraag wordt mogelijk nog verwerkt.'
    : 'De Google-videodienst kon niet worden bereikt. Probeer het later opnieuw.'});
}
/** @param {VideoEvent} event @param {Record<string, string|number>} details @param {string} path @param {RequestInit} options */
async function requestJSON(event, details, path, options = {}) {
  const response = await trackedFetch(event, {provider:'veo', ...details}, `${API_BASE}/${path}`, {
    ...options, headers:headers(), signal:AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  if (!response.ok) return {failure:googleFailure(response.status)};
  try { return {data:await response.json()}; }
  catch { return {failure:reply(502, {error:'Google gaf een ongeldig videoantwoord.'})}; }
}
/** @param {VideoEvent} event */
function validateStatusRequest(event) {
  if (event.httpMethod !== 'GET') return reply(405, {error:'Methode niet toegestaan.'});
  if (!INTERACTION_PATTERN.test(event.queryStringParameters?.operation || '')) {
    return reply(400, {error:'Ongeldig videoaanvraagnummer.'});
  }
  if (!apiKey()) return reply(500, {error:'De API-sleutel voor Google-video is niet ingesteld op de server.'});
}
/** @param {VideoEvent} event @param {string} feature */
async function readOperation(event, feature) {
  const operation = event.queryStringParameters.operation;
  return requestJSON(event, {feature, requestType:'status', operation}, operation);
}
/** @param {Interaction | null} result */
function failedGeneration(result) {
  // Inspect documented errors[] as well as legacy error; never echo provider text.
  const errors = [...(Array.isArray(result?.errors) ? result.errors : []), result?.error];
  const diagnostics = errors.flatMap(error => typeof error === 'string' ? [error]
    : [error?.code, error?.message]).filter(value => typeof value === 'string').join(' ');
  const outputText = (Array.isArray(result?.steps) ? result.steps : [])
    .filter(step => step?.type === 'model_output')
    .flatMap(step => Array.isArray(step.content) ? step.content : [])
    .filter(content => content?.type === 'text' && typeof content.text === 'string')
    .map(content => content.text).join(' ');
  let category = 'generation-failed';
  let message = 'Google kon deze video niet genereren. Probeer een andere afbeelding of beschrijving.';
  if (/safety|blocked|policy|filter|guardrails|third[- ]party content/i.test(diagnostics + ' ' + outputText)) {
    category = 'content-filter';
    message = "Het inhoudsfilter van Google heeft deze video geblokkeerd. Probeer een andere productfoto of beschrijving zonder beeldmateriaal van derden.";
  } else if (/quota|resource[_ -]?exhausted|rate[_ -]?limit/i.test(diagnostics)) {
    category = 'quota';
    message = 'De gebruikslimiet van Google is bereikt. Probeer het later opnieuw.';
  } else if (/permission|access[_ -]?denied|forbidden/i.test(diagnostics)) {
    category = 'permission';
    message = 'De videodienst heeft geen toegang tot videogeneratie bij Google. Neem contact op met de ondersteuning.';
  } else if (/unauthenticated|authentication|unauthorized/i.test(diagnostics)) {
    category = 'authentication';
    message = 'De videodienst kon zich niet aanmelden bij Google. Neem contact op met de ondersteuning.';
  } else if (result?.status === 'cancelled') {
    category = 'cancelled';
    message = 'De Google-videoaanvraag is geannuleerd.';
  } else if (['incomplete', 'requires_action', 'requires_continuation'].includes(result?.status)) {
    category = 'incomplete';
    message = result.status === 'incomplete' ? 'Google gaf een onvolledig videoresultaat.'
      : 'Google vraagt om aanvullende invoer of voortzetting in plaats van een voltooide video. Neem contact op met de ondersteuning.';
  } else if (result?.status === 'completed') {
    category = 'missing-video';
    message = 'Google heeft de aanvraag voltooid zonder een downloadbare MP4-video. Probeer een andere afbeelding of beschrijving, of neem contact op met de ondersteuning.';
  }
  return {state:'failed', category, message};
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
      error:'De videostatus kon niet worden bepaald. Controleer deze bestaande aanvraag opnieuw; er is geen nieuwe video gestart.'});
    if (state === 'failed') return reply(200, {...failedGeneration(data), operation});
    if (state === 'completed' && !interactionVideo(data)) return reply(200, {state, operation,
      outputAvailable:false, category:'output-unavailable', message:unavailableOutputMessage()});
    return reply(200, {state, operation, ...(state === 'completed' ? {outputAvailable:true, videoReference:operation} : {})});
  } catch (error) { return networkFailure(error); }
}
function unavailableOutputMessage() {
  return 'Google meldt dat deze aanvraag is voltooid, maar het videoresultaat is niet beschikbaar of niet herkend. Controleer de bestaande aanvraag opnieuw of neem contact op met de ondersteuning.';
}
function oversizedVideo() {
  return reply(502, {error:'Deze video is te groot om via de videodienst te downloaden. Neem contact op met de ondersteuning.'});
}
/** @param {Buffer} bytes */
function videoReply(bytes) {
  if (!bytes.length) return reply(502, {error:'Google gaf een lege video.'});
  if (bytes.length > MAX_DOWNLOAD_BYTES) return oversizedVideo();
  return videoResult(bytes);
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
    if (video.data.length % 4 !== 0 || !BASE64_PATTERN.test(video.data)) return reply(502, {error:'Google gaf ongeldige videogegevens.'});
    return videoReply(Buffer.from(video.data, 'base64'));
  }
  const url = downloadUrl(video.uri);
  if (!url) return reply(502, {error:'Google gaf een niet-beschikbare videoverwijzing.'});
  const response = await trackedFetch(event, {provider:'veo', feature, requestType:'download',
    operation:event.queryStringParameters.operation}, url, {
    headers:headers(), redirect:'error', signal:AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  if (!response.ok) return googleFailure(response.status);
  const mime = (response.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (mime !== 'video/mp4' && mime !== 'video/unknown') {
    return reply(502, {error:'Google gaf een ongeldige videodownload.'});
  }
  let bytes;
  try { bytes = await readVideoBytes(response); }
  catch (error) { if (error instanceof RangeError) return oversizedVideo(); throw error; }
  if (bytes.length > MAX_DOWNLOAD_BYTES) return oversizedVideo();
  if (mime === 'video/unknown' && !hasMP4FileType(bytes)) {
    return reply(502, {error:'Google gaf een ongeldige videodownload.'});
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
    if (state === 'pending') return reply(409, {error:'De video is nog niet klaar.'});
    if (state === 'failed') return reply(422, {error:failedGeneration(data).message});
    if (state !== 'completed') return reply(502, {error:'Google gaf een ongeldige videostatus.'});
    const video = interactionVideo(data);
    if (!video) return reply(502, {error:unavailableOutputMessage(), category:'output-unavailable'});
    return await downloadVideo(event, feature, video);
  } catch (error) { return networkFailure(error); }
}

module.exports = {apiKey, reply, requestJSON, networkFailure, status, download};
