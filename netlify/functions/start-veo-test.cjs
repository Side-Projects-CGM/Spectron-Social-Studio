/** @typedef {{images:Array<{mimeType:string, data:string}>, prompt:string, aspectRatio:string}} VideoInput */
const { apiKey, reply, requestJSON, networkFailure } = require('../lib/omni-video.cjs');
const { INTERACTION_ID_PATTERN } = require('../lib/video-response.cjs');
const MODEL = 'gemini-omni-1.1-flash';
const DURATION_SECONDS = 8;
const { parseReferenceImages, REFERENCE_INSTRUCTION } = require('../lib/video-references.cjs');
const {uploadsForEvent, UploadError} = require('../lib/video-reference-uploads.cjs');

/** @param {string | undefined} body @returns {VideoInput | {error:string}} */
function validateInput(body) {
  let input;
  try { input = JSON.parse(body || '{}'); }
  catch { return {error:'De aanvraaggegevens moeten geldige JSON bevatten.'}; }
  const references = parseReferenceImages(input);
  const prompt = typeof input?.prompt === 'string' ? input.prompt.trim() : '';
  if (references.error) return references;
  if (!prompt || prompt.length > 4000) return {error:'Voer een beschrijving van 1 tot 4000 tekens in.'};
  if (!['16:9', '9:16'].includes(input.aspectRatio)) return {error:'De beeldverhouding moet 16:9 of 9:16 zijn.'};
  return {images:references.images, prompt, aspectRatio:input.aspectRatio};
}
/** @param {VideoInput} input */
function generationRequest({images, prompt, aspectRatio}) {
  return {
    model:MODEL, background:true, store:true,
    // Natural-language reference guidance avoids locking an image to the first frame.
    input:[...images.map(image => ({type:'image', data:image.data, mime_type:image.mimeType})),
      {type:'text', text:`${prompt}\n\n${REFERENCE_INSTRUCTION}`}],
    response_format:{type:'video', aspect_ratio:aspectRatio, duration:`${DURATION_SECONDS}s`, resolution:'720p', delivery:'uri'}
  };
}
/** @param {import('../lib/omni-video.cjs').VideoEvent} event @param {unknown} context @param {string} feature */
exports.handler = async function handler(event, context, feature = 'veo-test') {
  if (event.httpMethod !== 'POST') return reply(405, {error:'Methode niet toegestaan.'});
  if (!apiKey()) return reply(500, {error:'De API-sleutel voor Google-video is niet ingesteld op de server.', category:'configuration'});
  let body=event.body, upload, uploads;
  try {
    let raw;try{raw=JSON.parse(body||'{}');}catch{ /* The normal validator reports malformed JSON. */ }
    if(raw?.upload!==undefined){
      try{
        if(raw.images!==undefined||raw.image!==undefined)throw new UploadError(400,'Gebruik óf een foto-upload óf losse foto’s.');
        if(typeof raw.prompt!=='string'||!raw.prompt.trim()||raw.prompt.trim().length>4000||!['16:9','9:16'].includes(raw.aspectRatio))throw new UploadError(400,'Controleer de videobeschrijving en het formaat.');
        uploads=uploadsForEvent(event);upload=raw.upload;
        const images=await uploads.consume(upload);
        body=JSON.stringify({images,prompt:raw.prompt,aspectRatio:raw.aspectRatio});
      }catch(error){return reply(error instanceof UploadError?error.status:503,{error:error instanceof UploadError?error.message:'De foto-upload kon niet worden gelezen. Er is geen video gestart.',category:'invalid-upload'});}
    }
    const input = validateInput(body);
    if (input.error) return reply(400, {error:input.error, category:'invalid-input'});
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
  finally {
    if(uploads&&upload){
      try{await uploads.remove(upload);}catch{console.warn('[video] Temporary photo cleanup pending; expiry sweep will retry.');}
    }
  }
};
