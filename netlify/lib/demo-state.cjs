const { randomUUID, createHash, createHmac, timingSafeEqual } = require('node:crypto');
const { getStore, connectLambda } = require('@netlify/blobs');

const LIMITS = Object.freeze({text:50, image:30, video:10});
const COOKIE = '__Host-studio-presenter';
const SESSION_MS = 8 * 60 * 60 * 1000;
const ID = /^[a-f0-9-]{36}$/;
class DemoError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const digest = value => createHash('sha256').update(value).digest('hex');
function equal(a, b) { return timingSafeEqual(Buffer.from(digest(a)), Buffer.from(digest(b))); }
function openDemoStore(event) {
  if (event?.blobs) connectLambda(event);
  // Authorization and quotas must never use eventual consistency.
  return getStore({name:'social-studio-demo', consistency:'strong'});
}

function createDemoState({store, password, secret, origin, now = Date.now, uuid = randomUUID, removeInteraction} = {}) {
  if (!store || typeof password !== 'string' || password.length < 12 || typeof secret !== 'string' || secret.length < 32) {
    throw new DemoError(503, 'De demo is nog niet veilig geconfigureerd.');
  }
  let site;
  try { site = new URL(origin); } catch { throw new DemoError(503, 'De demo-URL is niet geconfigureerd.'); }
  const local = ['localhost', '127.0.0.1'].includes(site.hostname);
  if (site.origin !== origin || (site.protocol !== 'https:' && !(local && site.protocol === 'http:'))) {
    throw new DemoError(503, 'De demo-URL is ongeldig.');
  }
  const cookieName = local ? 'studio-presenter-local' : COOKIE;
  const sign = value => createHmac('sha256', secret).update(value).digest('base64url');
  const day = () => new Date(now()).toISOString().slice(0,10); // UTC, site-wide.

  // Compare-and-swap prevents parallel functions from overspending or overwriting revocation.
  async function mutate(key, change) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const previous = await store.getWithMetadata(key, {type:'json'});
      if (previous && !previous.etag) throw new DemoError(503, 'Veilige opslagcontrole ontbreekt. Er is geen nieuwe AI-aanvraag gestart.');
      const next = change(previous ? structuredClone(previous.data) : null);
      const result = await store.setJSON(key, next, previous ? {onlyIfMatch:previous.etag} : {onlyIfNew:true});
      if (result.modified) return next;
    }
    throw new DemoError(503, 'De demo is druk. Probeer opnieuw; er is geen nieuwe AI-aanvraag gestart.');
  }
  function checkOrigin(event) {
    if (event.headers?.origin !== origin) throw new DemoError(403, 'Verzoek van een onbekende website geweigerd.');
  }
  function signedIdentity(event) {
    const cookie = (event.headers?.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(cookieName + '='));
    const token = cookie?.slice(cookieName.length + 1) || '';
    const [id, expiry, signature, extra] = token.split('.');
    if (extra || !ID.test(id || '') || !/^\d+$/.test(expiry || '') || !signature || !equal(signature, sign(`${id}.${expiry}`))) return null;
    return {id, expires:Number(expiry)};
  }
  function authenticate(event) {
    const identity = signedIdentity(event);
    if (!identity || identity.expires <= now()) throw new DemoError(401, 'Log in om de demo te gebruiken.');
    return {owner:digest(identity.id), expires:identity.expires};
  }
  async function login(event, supplied) {
    checkOrigin(event);
    // A persistent site-wide throttle also applies across cold starts and IP changes.
    const hour = new Date(now()).toISOString().slice(0,13);
    await mutate(`login/${hour}`, value => {
      const attempts = (value?.attempts || 0) + 1;
      if (attempts > 60) throw new DemoError(429, 'Te veel inlogpogingen. Probeer het later opnieuw.');
      return {attempts};
    });
    if (typeof supplied !== 'string' || supplied.length > 1024 || !equal(supplied, password)) throw new DemoError(401, 'Onjuist wachtwoord.');
    // Retain the signed presenter identity for cleanup after reauthentication; authorization still expires after 8h.
    const value = `${signedIdentity(event)?.id || uuid()}.${now() + SESSION_MS}`;
    return `${cookieName}=${value}.${sign(value)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${30 * 24 * 60 * 60}${local ? '' : '; Secure'}`;
  }
  async function createWorkspace(auth) {
    const id = uuid();
    const record = {owner:auth.owner, expires:auth.expires, status:'active', operations:[], activeVideo:null, inFlight:[]};
    const result = await store.setJSON(`workspaces/${id}`, record, {onlyIfNew:true});
    if (!result.modified) throw new DemoError(503, 'De demosessie kon niet worden aangemaakt.');
    return id;
  }
  function requireOwner(value, auth, active = true) {
    if (!value || value.owner !== auth.owner || (active && value.expires <= now())) throw new DemoError(404, 'Demosessie niet gevonden of verlopen.');
    if (active && value.status !== 'active') throw new DemoError(410, 'Deze demosessie is gereset.');
    return value;
  }
  function key(id) {
    if (!ID.test(id || '')) throw new DemoError(400, 'Ongeldige demosessie.');
    return `workspaces/${id}`;
  }
  async function workspace(auth, id) {
    return requireOwner(await store.get(key(id), {type:'json'}), auth);
  }
  async function reserve(kind) {
    if (!(kind in LIMITS)) throw new DemoError(400, 'Onbekend generatietype.');
    return mutate(`limits/${day()}`, value => {
      const counts = value || {text:0, image:0, video:0};
      if (counts[kind] >= LIMITS[kind]) throw new DemoError(429, 'De daglimiet voor deze demo is bereikt.');
      counts[kind]++;
      return counts;
    });
  }
  async function begin(auth, id, kind) {
    if (!(kind in LIMITS)) throw new DemoError(400, 'Onbekend generatietype.');
    const ticket = uuid();
    await mutate(key(id), value => {
      requireOwner(value, auth);
      if (value.inFlight.length >= 4) throw new DemoError(429, 'Wacht tot de lopende aanvragen klaar zijn.');
      if (kind === 'video' && value.activeVideo) throw new DemoError(409, 'Er loopt al een videoaanvraag in deze demosessie.');
      value.inFlight.push(ticket);
      if (kind === 'video') value.activeVideo = ticket;
      return value;
    });
    try { await reserve(kind); }
    catch (error) {
      await mutate(key(id), value => {
        requireOwner(value, auth, false);
        value.inFlight = value.inFlight.filter(t => t !== ticket);
        if (value.activeVideo === ticket) value.activeVideo = null;
        return value;
      });
      throw error;
    }
    // No refund after reservation: uncertain provider outcomes must not enable extra spending.
    return ticket;
  }
  async function finish(auth, id, ticket, {operation, definitelyFailed = false} = {}) {
    if (operation && !/^interactions\/[A-Za-z0-9_-]+$/.test(operation)) throw new DemoError(502, 'Ongeldige Google-aanvraagreferentie.');
    const result = await mutate(key(id), value => {
      requireOwner(value, auth, false);
      if (!value.inFlight.includes(ticket)) throw new DemoError(409, 'Onbekende generatieaanvraag.');
      value.inFlight = value.inFlight.filter(t => t !== ticket);
      if (operation && !value.operations.includes(operation)) value.operations.push(operation);
      if (value.activeVideo === ticket) value.activeVideo = operation || (definitelyFailed ? null : 'unknown');
      return value;
    });
    // A reset racing an accepted start must not return its operation to the next customer.
    if (result.status !== 'active') throw new DemoError(410, 'Deze demosessie is gereset; het resultaat wordt niet getoond.');
  }
  async function authorizeOperation(auth, id, operation) {
    const value = await workspace(auth, id);
    if (!value.operations.includes(operation)) throw new DemoError(404, 'Video niet gevonden in deze demosessie.');
  }
  async function completeVideo(auth, id, operation) {
    await mutate(key(id), value => {
      requireOwner(value, auth);
      if (!value.operations.includes(operation)) throw new DemoError(404, 'Video niet gevonden in deze demosessie.');
      if (value.activeVideo === operation) value.activeVideo = null;
      return value;
    });
  }
  async function reset(auth, id) {
    const storageKey = key(id);
    const existing = await store.get(storageKey, {type:'json'});
    if (!existing) return {complete:true}; // Idempotent retry after successful deletion.
    const revoked = await mutate(storageKey, value => {
      requireOwner(value, auth, false);
      value.status = 'revoked';
      return value;
    });
    // Never erase the registry while a start response could still add a provider resource.
    if (revoked.inFlight.length) return {complete:false, reason:'requests-pending'};
    if (revoked.activeVideo === 'unknown') return {complete:false, reason:'provider-outcome-unknown'};
    let failed = false;
    for (const operation of revoked.operations) {
      try {
        if (typeof removeInteraction !== 'function') throw new Error('Provider deletion unavailable');
        await removeInteraction(operation);
      } catch { failed = true; }
    }
    if (failed) return {complete:false, reason:'provider-cleanup-failed'};
    await store.delete(storageKey);
    return {complete:true};
  }
  return {login, authenticate, checkOrigin, createWorkspace, workspace, begin, finish, authorizeOperation, completeVideo, reset};
}
module.exports = {createDemoState, openDemoStore, DemoError, LIMITS};
