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
  if (event.httpMethod !== 'GET') return reply(405,{error:'Methode niet toegestaan.'});
  const operation = event.queryStringParameters?.operation || '';
  if (operation.startsWith('interactions/')) return omniVideo.download(event, feature);
  if (!OPERATION_PATTERN.test(operation)) return reply(400,{error:'Ongeldig videoaanvraagnummer.'});
  const apiKey = omniVideo.apiKey();
  if (!apiKey) return reply(500,{error:'GEMINI_API_KEY is niet ingesteld op de server.'});
  try {
    const statusResponse = await trackedFetch(event, {provider:'veo', feature, requestType:'status', operation}, `${API_BASE}/${operation}`,{headers:{'x-goog-api-key':apiKey},signal:AbortSignal.timeout(20000)});
    let status = null; try { status = await statusResponse.json(); } catch {}
    if (!statusResponse.ok) return reply(statusResponse.status === 401 || statusResponse.status === 403 ? statusResponse.status : 502,{error:'De aanvraagstatus bij Google kon niet worden gelezen.'});
    if (!status || typeof status !== 'object' || Array.isArray(status) || (status.done !== undefined && typeof status.done !== 'boolean')) return reply(502,{error:'Google gaf een ongeldige aanvraagstatus.'});
    if (status.done !== true) return reply(409,{error:'De Veo-video is nog niet klaar.'});
    if (status.error) return reply(422,{error:/safety|blocked|unsafe|policy/i.test(JSON.stringify(status.error)) ? 'De veiligheidscontrole van Google heeft deze videoaanvraag geblokkeerd.' : 'Google heeft gemeld dat de videoaanvraag is mislukt.'});
    const videoUri = extractVideoUri(status);
    if (!validVideoUri(videoUri)) return reply(502,{error:'Google gaf een niet-beschikbare of onveilige videoverwijzing.'});
    const videoResponse = await trackedFetch(event, {provider:'veo', feature, requestType:'download', operation}, videoUri,{headers:new URL(videoUri).hostname === 'generativelanguage.googleapis.com' ? {'x-goog-api-key':apiKey} : {},signal:AbortSignal.timeout(60000)});
    if (!videoResponse.ok) return reply(502,{error:'De gegenereerde video is niet beschikbaar of verlopen.'});
    if (!(videoResponse.headers?.get('Content-Type') || '').toLowerCase().startsWith('video/mp4')) return reply(502,{error:'Google gaf een ongeldig videoantwoord.'});
    const bytes = await readVideoBytes(videoResponse);
    if (!bytes.length) return reply(502,{error:'Google gaf een lege video.'});
    return videoResult(bytes, 'veo-test.mp4');
  } catch (error) { return reply(502,{error:error instanceof RangeError ? 'Deze video is te groot om via de videodienst te downloaden. Neem contact op met de ondersteuning.' : error?.name === 'TimeoutError' ? 'Het downloaden van de video duurde te lang.' : 'Het downloaden van de video is mislukt.'}); }
}

exports.download = download;
exports.default = request => serveDownload(request, download, 'veo-test');
