const { createHash, timingSafeEqual } = require('node:crypto');
const { readSummary } = require('../lib/usage.cjs');
const headers = {'Content-Type':'application/json', 'Cache-Control':'no-store', 'Vary':'Authorization', 'X-Content-Type-Options':'nosniff'};
const reply = (statusCode, body, extra = {}) => ({statusCode, headers:{...headers,...extra}, body:JSON.stringify(body)});
function authorized(event, password) {
  if (!password) return false;
  const auth = event.headers?.authorization || event.headers?.Authorization || '';
  if (!auth.startsWith('Basic ') || auth.length > 4096) return false;
  let credentials;
  try { credentials = Buffer.from(auth.slice(6), 'base64').toString('utf8'); } catch { return false; }
  const digest = value => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(credentials), digest(`usage:${password}`));
}
function createHandler({read = readSummary, password = () => process.env.USAGE_DASHBOARD_PASSWORD} = {}) {
  return async event => {
    if (event.httpMethod !== 'GET') return reply(405, {error:'Methode niet toegestaan'}, {Allow:'GET'});
    if (!password()) return reply(503, {error:'Het wachtwoord voor het gebruiksdashboard is niet ingesteld op de server.'});
    if (!authorized(event, password())) return reply(401, {error:'Voer het wachtwoord voor het gebruiksdashboard in.'});
    try { return reply(200, await read(event)); }
    catch { return reply(503, {error:'De opslag van gebruiksgegevens is momenteel niet beschikbaar. Genereren blijft werken. Probeer het opnieuw.'}); }
  };
}
exports.handler = createHandler();
exports.createHandler = createHandler;
exports.authorized = authorized;
