import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {apiKey, requestJSON, networkFailure} = require('../lib/omni-video.cjs');
const {INTERACTION_ID_PATTERN} = require('../lib/video-response.cjs');
const {handler:status} = require('./veo-test-status.cjs');
const {download} = require('./download-veo-test.cjs');
const {serveDownload} = require('../lib/video-stream.cjs');
const origins = new Set(['https://oomagent-portal-demo-2026.ceesdingler.chatgpt.site','http://127.0.0.1:8897']);
const MODEL = 'gemini-omni-1.2-flash';

export default async function(request) {
  const origin = request.headers.get('origin');
  const headers = {'Cache-Control':'no-store, private','Vary':'Origin'};
  const json = (code, body) => Response.json(body, {status:code, headers});
  if (!origins.has(origin)) return json(403,{error:'Deze website heeft geen toegang tot de moodfilm-generator.'});
  Object.assign(headers, {'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type'});
  if (request.method === 'OPTIONS') return new Response(null,{status:204,headers});
  if (!['GET','POST'].includes(request.method)) return json(405,{error:'Methode niet toegestaan.'});
  const url = new URL(request.url);
  const event = {httpMethod:request.method,headers:Object.fromEntries(request.headers),queryStringParameters:Object.fromEntries(url.searchParams)};
  if (request.method === 'GET') {
    if (url.searchParams.get('download') === '1') {
      const result = await serveDownload(request, download, 'moodfilm');
      const merged = new Headers(result.headers);
      for (const [key,value] of Object.entries(headers)) merged.set(key,value);
      merged.set('Content-Disposition','attachment; filename="oomagent-moodfilm.mp4"');
      return new Response(result.body,{status:result.status,headers:merged});
    }
    const result = await status(event,undefined,'moodfilm');
    return new Response(result.body,{status:result.statusCode,headers:{...result.headers,...headers}});
  }
  if (!apiKey()) return json(503,{error:'De Google-videokoppeling is niet ingesteld.'});
  const raw = await request.text();
  if (raw.length > 5 * 1024 * 1024) return json(413,{error:'De referentiebeelden zijn samen te groot.'});
  let input;
  try { input = JSON.parse(raw); } catch { return json(400,{error:'Ongeldige aanvraag.'}); }
  if (!Array.isArray(input.images) || input.images.length < 1 || input.images.length > 6 || typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 12000)
    return json(400,{error:'Gebruik 1 tot 6 moodboardbeelden en een filmbeschrijving.'});
  const images=[];let total=0;
  for (const source of input.images) {
    const match = typeof source === 'string' && source.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]*={0,2})$/);
    if (!match || !match[2]) return json(400,{error:'Gebruik geldige JPG-, PNG- of WebP-beelden.'});
    const bytes=Buffer.from(match[2],'base64');total+=bytes.length;
    const valid=match[1]==='image/png' ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : match[1]==='image/jpeg' ? bytes[0]===255&&bytes[1]===216&&bytes[2]===255 : bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
    if (!valid || bytes.toString('base64')!==match[2] || total>3*1024*1024) return json(400,{error:'De moodboardbeelden zijn ongeldig of te groot.'});
    images.push({type:'image',mime_type:match[1],data:match[2]});
  }
  try {
    const prompt = 'Create one cinematic 8-second landscape mood film from ALL the supplied moodboard reference images. Animate the subjects, environments and visual motifs, with deliberate camera movement and coherent transitions between shots. Preserve their art direction, palette and subject identity. Do not show a moodboard, collage, frames, captions, logos or a slideshow of still photos. Use natural ambient audio, no voiceover. Creative brief:\n'+input.prompt.trim();
    const {data,failure}=await requestJSON(event,{feature:'moodfilm',requestType:'generate',model:MODEL,durationSeconds:8,resolution:'720p',aspectRatio:'16:9'},'interactions',{
      method:'POST',body:JSON.stringify({model:MODEL,background:true,store:true,input:[...images,{type:'text',text:prompt}],response_format:{type:'video',aspect_ratio:'16:9',duration:'8s',resolution:'720p',delivery:'uri'}})
    });
    if (failure) return new Response(failure.body,{status:failure.statusCode,headers:{...failure.headers,...headers}});
    if (typeof data?.id!=='string'||!INTERACTION_ID_PATTERN.test(data.id)) return json(502,{error:'Google gaf geen geldig videoaanvraagnummer. Start niet automatisch opnieuw.'});
    return json(202,{operation:'interactions/'+data.id,model:MODEL,durationSeconds:8});
  } catch(error) {
    const result=networkFailure(error);
    return new Response(result.body,{status:result.statusCode,headers:{...result.headers,...headers}});
  }
}
