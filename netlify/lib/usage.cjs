const { failureDetails, interactionFailureDetails } = require('./veo-failure.cjs');
const { INTERACTION_PATTERN, INTERACTION_ID_PATTERN, interactionState, interactionVideo } = require('./video-response.cjs');
const { randomUUID } = require('node:crypto');
const { getStore, connectLambda } = require('@netlify/blobs');
const STORE = 'spectron-ai-usage';
const TIMEZONE = 'Africa/Johannesburg';

function namespace(env = process.env) {
  if (env.NETLIFY_DEV === 'true' || !env.CONTEXT || env.CONTEXT === 'dev') return 'local';
  if (env.CONTEXT === 'production') return 'production';
  return `preview-${String(env.DEPLOY_ID || env.CONTEXT).replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}
function openStore(event, signal) {
  // These functions use Netlify's Lambda-compatible signature, not the v2 Request API.
  if (event?.blobs) connectLambda(event);
  return getStore({name: STORE, fetch: (url, options) => fetch(url, {...options, signal})});
}
async function limited(work, milliseconds) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => work(controller.signal)),
      new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Usage storage timeout')); }, milliseconds); })
    ]);
  } finally { clearTimeout(timer); }
}
function count(value) { return Number.isSafeInteger(value) && value >= 0 ? value : null; }
function tokens(data) {
  const raw = data?.usageMetadata;
  const output = {};
  for (const key of ['promptTokenCount','candidatesTokenCount','totalTokenCount','thoughtsTokenCount','cachedContentTokenCount','toolUsePromptTokenCount']) output[key] = count(raw?.[key]);
  for (const key of ['promptTokensDetails','candidatesTokensDetails','cacheTokensDetails']) {
    if (Array.isArray(raw?.[key])) output[key] = raw[key].filter(x => typeof x?.modality === 'string' && count(x.tokenCount) !== null).map(x => ({modality: x.modality.slice(0, 30), tokenCount: x.tokenCount}));
  }
  return output;
}
function responseDetails(base, response, data) {
  const result = {httpStatus: response.status, outcome: response.ok ? 'succeeded' : 'failed'};
  if (base.provider === 'gemini') {
    result.tokens = tokens(data);
    if (response.ok && !(Array.isArray(data?.candidates) && data.candidates.some(c => c?.content?.parts?.length))) result.outcome = 'unknown';
  }
  if (base.provider === 'veo' && base.requestType === 'generate') {
    const operation = typeof data?.id === 'string' && INTERACTION_ID_PATTERN.test(data.id)
      ? `interactions/${data.id}` : data?.name;
    if (response.ok && typeof operation === 'string' && (INTERACTION_PATTERN.test(operation) || /^(?:operations\/[\w.-]+|models\/[\w.-]+\/operations\/[\w.-]+)$/.test(operation))) {
      result.operation = operation; result.outcome = 'submitted';
    } else if (response.ok) result.outcome = 'unknown';
  }
  if (base.requestType === 'status' && response.ok && INTERACTION_PATTERN.test(base.operation || '')) {
    result.operationState = interactionState(data);
    result.videoCount = result.operationState === 'completed' && interactionVideo(data) ? 1 : 0;
    if (result.operationState === 'failed') result.failureReason = interactionFailureDetails(data).reason;
  } else if (base.requestType === 'status' && response.ok) {
    const samples = data?.response?.generateVideoResponse?.generatedSamples || data?.response?.generatedVideos;
    result.videoCount = Array.isArray(samples) ? samples.filter(s => s?.video?.uri).length : 0;
    result.operationState = data?.done === true ? (data.error || !result.videoCount ? 'failed' : 'completed') : data?.done === false || (data && data.done === undefined) ? 'pending' : 'unknown';
    if (result.operationState === 'failed') result.failureReason = failureDetails(data).reason;
  }
  return result;
}
function createTracker({storeFactory = openStore, fetcher = (...args) => fetch(...args), writeTimeout = 700, logger = console} = {}) {
  async function save(event, key, value) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await limited(signal => storeFactory(event, signal).setJSON(key, value, {onlyIfNew: true}), writeTimeout);
        return true;
      } catch { /* Retry storage only. Never retry the paid request. */ }
    }
    logger.warn('[usage] Record could not be persisted', {id: value.id, phase: value.phase});
    return false;
  }
  async function trackedFetch(event, details, url, options) {
    const base = {version: 1, id: randomUUID(), timestamp: new Date().toISOString(), ...details};
    const prefix = `${namespace()}/events/${base.timestamp.slice(0,10)}/${base.id}`;
    await save(event, `${prefix}/request`, {...base, phase: 'request', outcome: 'unknown'});
    let response;
    try { response = await fetcher(url, options); }
    catch (error) {
      await save(event, `${prefix}/result`, {...base, phase:'result', outcome:'unknown', errorType: error?.name === 'TimeoutError' ? 'timeout' : 'network', finishedAt: new Date().toISOString()});
      throw error;
    }
    let data = null;
    // Read a clone: callers receive the original response, body, headers and status unchanged.
    if (details.requestType !== 'download' && typeof response.clone === 'function') {
      try { data = await response.clone().json(); } catch { /* Invalid/missing metadata is unknown. */ }
    }
    let result;
    try { result = responseDetails(base, response, data); }
    catch { result = {httpStatus:response.status, outcome:'unknown'}; }
    await save(event, `${prefix}/result`, {...base, phase:'result', ...result, finishedAt: new Date().toISOString()});
    return response;
  }
  return {trackedFetch};
}
function dateKey(timestamp) { return new Intl.DateTimeFormat('en-CA', {timeZone: TIMEZONE, year:'numeric', month:'2-digit', day:'2-digit'}).format(new Date(timestamp)); }
function weekKey(day) { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7); return d.toISOString().slice(0,10); }
function emptyTotals() { return {gemini:{attempts:0, succeeded:0, failed:0, unknown:0, inputTokens:0, outputTokens:0, totalTokens:0, thinkingTokens:0, cachedTokens:0, missingMetadata:0, inputUnknown:0, outputUnknown:0, totalUnknown:0}, veo:{attempts:0, submitted:0, completed:0, failed:0, pending:0, unknown:0, videos:0, requestedSeconds:0, estimatedCompletedSeconds:0, statusCalls:0, downloadCalls:0, diagnosticCalls:0}}; }
function add(totals, record) {
  if (record.provider === 'gemini') {
    const g = totals.gemini; g.attempts++; g[record.outcome === 'succeeded' ? 'succeeded' : record.outcome === 'failed' ? 'failed' : 'unknown']++;
    const t = record.tokens || {};
    for (const [field, key] of Object.entries({inputTokens:'promptTokenCount', outputTokens:'candidatesTokenCount', totalTokens:'totalTokenCount', thinkingTokens:'thoughtsTokenCount', cachedTokens:'cachedContentTokenCount'})) g[field] += count(t[key]) ?? 0;
    for (const [field, key] of Object.entries({inputUnknown:'promptTokenCount',outputUnknown:'candidatesTokenCount',totalUnknown:'totalTokenCount'})) if (count(t[key]) === null) g[field]++;
    if (['promptTokenCount','candidatesTokenCount','totalTokenCount'].some(k => count(t[k]) === null)) g.missingMetadata++;
  } else {
    const v = totals.veo;
    if (record.requestType !== 'generate') { const field = {status:'statusCalls',download:'downloadCalls',diagnostic:'diagnosticCalls'}[record.requestType]; if (field) v[field]++; return; }
    v.attempts++; v.requestedSeconds += record.requestedSeconds || 0;
    if (record.duplicateOperation) return;
    if (record.operation) v.submitted++;
    const state = record.state;
    v[['completed','failed','pending'].includes(state) ? state : 'unknown']++;
    if (state === 'completed') { v.videos += record.videoCount || 0; v.estimatedCompletedSeconds += (record.videoCount || 0) * (record.durationSeconds || 0); }
  }
}
function summarize(records) {
  const merged = new Map();
  for (const r of records) if (r?.version === 1 && r.id && !Number.isNaN(Date.parse(r.timestamp))) {
    const previous = merged.get(r.id);
    if (!previous || r.phase === 'result') merged.set(r.id, r);
  }
  const rows = [...merged.values()].sort((a,b) => a.timestamp.localeCompare(b.timestamp));
  const operations = new Map();
  for (const r of rows) if (r.requestType === 'status' && r.operation && ['completed','failed'].includes(r.operationState)) {
    operations.set(r.operation, {state:r.operationState, videoCount:r.videoCount || 0});
  }
  const totals = emptyTotals(), days = {}, weeks = {}, features = {};
  let incompleteRecords = 0;
  const countedOperations = new Set();
  for (const r of rows) {
    if (r.phase !== 'result') incompleteRecords++;
    if (r.provider === 'veo' && r.requestType === 'generate') {
      Object.assign(r, operations.get(r.operation) || {state:r.operation ? 'pending' : r.outcome === 'failed' ? 'failed' : 'unknown'});
      r.duplicateOperation = Boolean(r.operation && countedOperations.has(r.operation));
      if (r.operation) countedOperations.add(r.operation);
    }
    const day = dateKey(r.timestamp), week = weekKey(day);
    for (const group of [totals, days[day] ||= emptyTotals(), weeks[week] ||= emptyTotals(), features[r.feature] ||= emptyTotals()]) add(group, r);
  }
  // Operation names stay server-side. Polls/downloads are visible as calls, never new generations.
  const recent = rows.slice(-50).reverse().map(({operation, failureReason, ...r}) => r);
  return {timezone:TIMEZONE, trackingSince:rows[0]?.timestamp || null, generatedAt:new Date().toISOString(), totals, days, weeks, features, incompleteRecords, recent};
}
async function readSummary(event, storeFactory = openStore) {
  return limited(async signal => {
    const store = storeFactory(event, signal), records = [];
    // Process every list page; do not present a truncated scan as an all-time total.
    for await (const page of store.list({prefix:`${namespace()}/events/`, paginate:true})) {
      for (let i = 0; i < page.blobs.length; i += 20) {
        const batch = await Promise.all(page.blobs.slice(i,i+20).map(blob => store.get(blob.key, {type:'json'})));
        records.push(...batch.filter(Boolean));
      }
    }
    return {...summarize(records), environment:namespace()};
  }, 20000);
}
module.exports = {createTracker, trackedFetch:createTracker().trackedFetch, namespace, tokens, summarize, readSummary, openStore};
