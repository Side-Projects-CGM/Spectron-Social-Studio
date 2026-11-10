const FALLBACK = 'Google heeft gemeld dat de videoaanvraag is mislukt.';

// Diagnostics retain the provider's reason, but never credentials.
function redact(value) {
  let text = String(value);
  for (const key of [process.env.GEMINI_API_KEY, process.env.GOOGLE_API_KEY, process.env.GOOGLE_DEVELOPER_API_KEY]) {
    if (key) text = text.split(key).join('[redacted]');
  }
  return text.replace(/AIza[\w-]+/g, '[redacted]')
    .replace(/((?:api[_-]?key|key|token|authorization|credential|password)\s*["']?\s*[:=]\s*["']?)[^\s,"'&}]+/gi, '$1[redacted]')
    .replace(/Bearer\s+[^\s,"'}]+/gi, 'Bearer [redacted]');
}

function failureDetails(result) {
  const response = result?.response || {};
  const generated = response.generateVideoResponse || response;
  const reasons = generated.raiMediaFilteredReasons || response.raiMediaFilteredReasons;
  const messages = [typeof result?.error === 'string' ? result.error : result?.error?.message,
    ...(Array.isArray(reasons) ? reasons : typeof reasons === 'string' ? [reasons] : [])]
    .filter(value => typeof value === 'string' && value.trim());
  const reason = redact(JSON.stringify({error:result?.error || null,
    raiMediaFilteredReasons:reasons || [],
    raiMediaFilteredCount:generated.raiMediaFilteredCount ?? response.raiMediaFilteredCount ?? null,
    ...(!messages.length ? {reason:'Operation finished without a generated video.'} : {})}));
  // Only reason text reaches clients. Drop sentences containing implementation details.
  const safe = messages.map(redact).flatMap(text => text.split(/\n|(?<=[.!?])\s+/))
    .filter(text => !/\[redacted\]|https?:|data:|api[_ -]?key|token|credential|authorization|stack|trace|\binternal\b|\bbackend\b|\brequest[_ -]?id\b|\bproject[_ -]?id\b|\bat\s+\S+\s*\(|\b(?:projects|operations|models|files)\/|[{}<>]|[A-Za-z]:\\|\/(?:usr|var|home|internal)\//i.test(text))
    .filter(text => !/\b[A-Z][A-Z_]+\b/.test(text))
    .map(text => text.trim()).filter(Boolean).join(' ').slice(0, 600);
  const safety = /safety|blocked|unsafe|policy|filtered/i.test(messages.join(' ')) || generated.raiMediaFilteredCount > 0;
  const contentFiltered = (generated.raiMediaFilteredCount ?? response.raiMediaFilteredCount ?? 0) > 0 || (Array.isArray(reasons) ? reasons.length > 0 : Boolean(reasons)) || /guardrails|third[- ]party content|content filter/i.test(messages.join(' '));
  const hint = /too small|resolution|dimensions/i.test(safe) ? 'Gebruik een grotere afbeelding met voldoende resolutie.'
    : /\b(?:child|children|minor|adult)\b/i.test(safe) ? 'Gebruik een andere productfoto zonder minderjarigen.' : '';
  const message = contentFiltered ? "Deze afbeelding of beschrijving is geblokkeerd door het inhoudsfilter van Google, bijvoorbeeld vanwege merklogo’s of beschermde personages. Probeer een andere productfoto zonder beeldmateriaal van derden." : safe ? `${safety ? 'De veiligheidscontrole van Google heeft deze videoaanvraag geblokkeerd.' : FALLBACK} ${hint}`.trim()
    : safety ? 'De veiligheidscontrole van Google heeft deze videoaanvraag geblokkeerd.' : FALLBACK;
  return {reason, message, category:contentFiltered ? 'content-filter' : 'generation-failed'};
}

// Allowlist error fields only: never persist inputs, model output or media.
function interactionFailureDetails(result) {
  function safe(value, limit) {
    if (typeof value !== 'string' && typeof value !== 'number') return '';
    const text = String(value)
      .replace(/((?:api[_ -]?key|key|token|authorization|credential|password|prompt)\s*["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi, '$1[redacted]')
      .replace(/Bearer\s+[^\s,"'}]+/gi, 'Bearer [redacted]')
      .replace(/https?:\/\/[^\s"'<>]+|data:[^\s"'<>]+/gi, '[redacted]')
      .replace(/[A-Za-z0-9+/=_-]{128,}/g, '[redacted]');
    return redact(text).replace(/[\r\n\t\x00-\x1f\x7f]/g, ' ').slice(0, limit);
  }
  const errors = [...(Array.isArray(result?.errors) ? result.errors : []), result?.error]
    .filter(error => typeof error === 'string' || (error && typeof error === 'object'))
    .slice(0, 5)
    .map(error => typeof error === 'string' ? {message:safe(error, 800)}
      : {code:safe(error.code, 96), status:safe(error.status, 96), message:safe(error.message, 800)});
  return {reason:JSON.stringify({status:safe(result?.status, 96), errors,
    ...(!errors.some(error => error.code || error.status || error.message)
      ? {reason:'Google reported failure without an error reason.'} : {})})};
}

module.exports = {failureDetails, interactionFailureDetails};
