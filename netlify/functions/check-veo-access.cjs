const { trackedFetch } = require('../lib/usage.cjs');
const MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
function reply(statusCode, body, extraHeaders = {}) { return {statusCode, headers:{'Content-Type':'application/json', ...extraHeaders}, body:JSON.stringify(body)}; }
exports.handler = async function handler(event) {
  if (event.httpMethod !== 'GET') return reply(405, {error:'Methode niet toegestaan.'}, {Allow:'GET'});
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return reply(500, {error:'GEMINI_API_KEY is niet ingesteld op de server.'});
  try {
    const response = await trackedFetch(event, {provider:'veo', feature:'veo-access-check', requestType:'diagnostic'}, MODELS_URL, {method:'GET', headers:{'x-goog-api-key':apiKey}, signal:AbortSignal.timeout(20000)});
    if (response.status === 401) return reply(401, {error:'De ingestelde Gemini API-sleutel is ongeldig.'});
    if (response.status === 403) return reply(403, {error:'De ingestelde Gemini API-sleutel mag geen Gemini-modellen opvragen.'});
    if (response.status === 429) return reply(429, {error:'Het API-quotum of de factureringslimiet van Gemini is bereikt.'});
    if (!response.ok) return reply(502, {error:'De toegang tot Google Gemini-modellen kon niet worden gecontroleerd.'});
    let result;
    try { result = await response.json(); } catch { return reply(502, {error:'Google gaf een ongeldig antwoord op de modellenlijst.'}); }
    if (!result || !Array.isArray(result.models)) return reply(502, {error:'Google gaf een ongeldig antwoord op de modellenlijst.'});
    const models = result.models.map(model => model && typeof model.name === 'string' ? model.name : null).filter(name => name && name.toLowerCase().includes('veo'));
    if (!models.length) return reply(200, {success:true, veoAvailable:false, models:[], message:'Er zijn geen Veo-modellen beschikbaar voor deze API-sleutel.'});
    return reply(200, {success:true, veoAvailable:true, models});
  } catch (error) {
    return reply(502, {error:error?.name === 'TimeoutError' ? 'Het opvragen van de Google Gemini-modellen duurde te lang.' : 'Het opvragen van de Google Gemini-modellen is mislukt.'});
  }
};
