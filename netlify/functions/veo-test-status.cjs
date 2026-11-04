const { trackedFetch } = require('../lib/usage.cjs');
const { failureDetails } = require('../lib/veo-failure.cjs');
const omniVideo = require('../lib/omni-video.cjs');
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const OPERATION_PATTERN = /^(?:operations\/[A-Za-z0-9._-]+|models\/[A-Za-z0-9._-]+\/operations\/[A-Za-z0-9._-]+)$/;
function reply(statusCode, body) { return {statusCode, headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)}; }
function extractVideoUri(result) { return result?.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri || result?.response?.generatedVideos?.[0]?.video?.uri || ''; }
exports.OPERATION_PATTERN = OPERATION_PATTERN; exports.extractVideoUri = extractVideoUri;
exports.handler = async function handler(event, context, feature='veo-test') {
  if (event.httpMethod !== 'GET') return reply(405,{error:'Methode niet toegestaan.'});
  const operation = event.queryStringParameters?.operation || '';
  if (operation.startsWith('interactions/')) return omniVideo.status(event, feature);
  if (!OPERATION_PATTERN.test(operation)) return reply(400,{error:'Ongeldig videoaanvraagnummer.'});
  const apiKey = omniVideo.apiKey();
  if (!apiKey) return reply(500,{error:'GEMINI_API_KEY is niet ingesteld op de server.'});
  try {
    const response = await trackedFetch(event, {provider:'veo', feature, requestType:'status', operation}, `${API_BASE}/${operation}`,{headers:{'x-goog-api-key':apiKey},signal:AbortSignal.timeout(20000)});
    let result = null; try { result = await response.json(); } catch {}
    if (!response.ok) return reply(response.status === 401 || response.status === 403 ? response.status : 502,{error:response.status === 403 ? 'De ingestelde Gemini API-sleutel heeft geen toegang tot deze aanvraag.' : response.status === 401 ? 'De ingestelde Gemini API-sleutel is ongeldig.' : 'De aanvraagstatus bij Google kon niet worden gelezen.'});
    if (!result || typeof result !== 'object' || Array.isArray(result) || (result.done !== undefined && typeof result.done !== 'boolean')) return reply(502,{error:'Google gaf een ongeldige aanvraagstatus.'});
    if (result.done !== true) return reply(200,{state:'pending',operation});
    if (result.error || !extractVideoUri(result)) {
      const failure = failureDetails(result);
      console.warn('[veo] Operation failed', {operation, reason:failure.reason});
      return reply(200,{state:'failed',operation,message:failure.message,category:failure.category});
    }
    return reply(200,{state:'completed',operation,videoReference:operation});
  } catch (error) { return reply(502,{error:error?.name === 'TimeoutError' ? 'Het opvragen van de aanvraagstatus bij Google duurde te lang.' : 'Het opvragen van de aanvraagstatus bij Google is mislukt.'}); }
};
