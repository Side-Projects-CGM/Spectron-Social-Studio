/** @typedef {{image:{mimeType:string, data:string}, prompt:string, aspectRatio:string}} VideoInput */
const { apiKey, reply, requestJSON, networkFailure } = require('../lib/omni-video.cjs');
const { INTERACTION_ID_PATTERN } = require('../lib/video-response.cjs');
const MODEL = 'gemini-omni-1.1-flash';
const DURATION_SECONDS = 4;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const IMAGE_PATTERN = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/;

/** @param {unknown} value @returns {{mimeType:string, data:string} | null} */
function parseImage(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(IMAGE_PATTERN);
  if (!match || match[2].length % 4 === 1) return null;
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES || bytes.toString('base64') !== match[2]) return null;
  return {mimeType:match[1], data:match[2]};
}
/** @param {string | undefined} body @returns {VideoInput | {error:string}} */
function validateInput(body) {
  let input;
  try { input = JSON.parse(body || '{}'); }
  catch { return {error:'De aanvraaggegevens moeten geldige JSON bevatten.'}; }
  const image = parseImage(input?.image);
  const prompt = typeof input?.prompt === 'string' ? input.prompt.trim() : '';
  if (!image) return {error:'Upload een niet-lege JPEG-, PNG- of WebP-afbeelding van maximaal 20 MB.'};
  if (!prompt || prompt.length > 4000) return {error:'Voer een beschrijving van 1 tot 4000 tekens in.'};
  if (!['16:9', '9:16'].includes(input.aspectRatio)) return {error:'De beeldverhouding moet 16:9 of 9:16 zijn.'};
  return {image, prompt, aspectRatio:input.aspectRatio};
}
/** @param {VideoInput} input */
function generationRequest({image, prompt, aspectRatio}) {
  return {
    model:MODEL, background:true, store:true,
    input:[{type:'image', data:image.data, mime_type:image.mimeType}, {type:'text', text:prompt}],
    generation_config:{video_config:{task:'image_to_video'}},
    response_format:{type:'video', aspect_ratio:aspectRatio, duration:`${DURATION_SECONDS}s`, resolution:'720p', delivery:'uri'}
  };
}
/** @param {import('../lib/omni-video.cjs').VideoEvent} event @param {unknown} context @param {string} feature */
exports.handler = async function handler(event, context, feature = 'veo-test') {
  if (event.httpMethod !== 'POST') return reply(405, {error:'Methode niet toegestaan.'});
  if (!apiKey()) return reply(500, {error:'De API-sleutel voor Google-video is niet ingesteld op de server.', category:'configuration'});
  const input = validateInput(event.body);
  if (input.error) return reply(400, {error:input.error, category:'invalid-input'});
  try {
    const details = {feature, requestType:'generate', model:MODEL, durationSeconds:DURATION_SECONDS,
      requestedSeconds:DURATION_SECONDS, resolution:'720p', aspectRatio:input.aspectRatio};
    const {data, failure} = await requestJSON(event, details, 'interactions', {
      method:'POST', body:JSON.stringify(generationRequest(input))
    });
    if (failure) return failure;
    if (typeof data?.id !== 'string' || !INTERACTION_ID_PATTERN.test(data.id)) {
      return reply(502, {error:'Google gaf een ongeldig videoaanvraagnummer.', category:'invalid-response'});
    }
    return reply(202, {success:true, operation:`interactions/${data.id}`});
  } catch (error) { return networkFailure(error); }
};
