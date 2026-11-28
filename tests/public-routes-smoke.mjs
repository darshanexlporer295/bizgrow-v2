// Public order and track routes check (no network). Cloudflare's Turnstile check and the database are mocked:
// globalThis.fetch is replaced for those calls only.
// Checks: Turnstile pass, fail, no token, unreachable (network error), server error and bad reply;
// fail closed with no secret (503 on order and track); fail closed with no connection address;
// the per-connection code is a one-way hash (no raw address sent); the database limit messages come through;
// no fallback to the older order and track functions when the newer ones are missing (503, and the old names
// are never called); the bot-check route still reports enabled true or false.
// Usage: node tests/public-routes-smoke.mjs   (run from the repo folder; exits 1 on any failure)
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const workerModule = await import(path.join(here, '..', 'worker', 'index.mjs'));
const worker = workerModule.default;
const { limitAllow, limitReset } = workerModule;

const SECRET = 'ts-secret-test-3c91';
const SB = 'https://db.example.test';
const ANON = 'anon-test-key-2b8e';
const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const out = [];
const check = (name, ok, extra) => out.push((ok ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? ' (' + extra + ')' : ''));

const realFetch = globalThis.fetch;
let siteMode = 'pass';   // 'pass' | 'fail' | 'throw' | 'down' (500) | 'junk'
let siteCalls = [];
let dbMode = 'ok';       // 'ok' | 'limit' (database raises the per-connection message) | 'missing' (function not there)
let dbCalls = [];        // { name, key }
globalThis.fetch = async (input, init) => {
  const u = String(input);
  if (u === SITEVERIFY) {
    const secret = init.body.get('secret');
    siteCalls.push({ secret });
    if (siteMode === 'throw') throw new Error('network down');
    if (siteMode === 'down') return new Response('oops', { status: 500 });
    if (siteMode === 'junk') return new Response('<html>not json</html>', { status: 200 });
    return Response.json({ success: siteMode === 'pass' && secret === SECRET });
  }
  const m = u.match(/^https:\/\/db\.example\.test\/rest\/v1\/rpc\/(\w+)$/);
  if (m) {
    const args = JSON.parse(init.body);
    dbCalls.push({ name: m[1], key: args.p_client_key === undefined ? '(none)' : args.p_client_key });
    if (dbMode === 'missing') return Response.json({ code: 'PGRST202', message: 'Could not find the function' }, { status: 404 });
    if (dbMode === 'limit') {
      return Response.json({ code: 'P0001', message: 'Too many orders from this connection for now. Please wait a while, or call the shop.' }, { status: 400 });
    }
    if (m[1].indexOf('place_store_order') === 0) return Response.json({ ok: true, ref: 'ORD-TEST-1' });
    return Response.json({ ok: true, status: 'packed' });
  }
  throw new Error('unexpected outbound call in test: ' + u);
};

const ENV = { TURNSTILE_SECRET_KEY: SECRET, TURNSTILE_SITE_KEY: 'site-public-1', SUPABASE_URL: SB, SUPABASE_ANON_KEY: ANON, ASSETS: { fetch: async () => new Response('asset', { status: 200 }) } };
const ENV_NO_SECRET = Object.assign({}, ENV, { TURNSTILE_SECRET_KEY: '' });
const IP = '203.0.113.50';

const orderReq = (ip, token) => new Request('https://bizgrow.example/api/public/order', {
  method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, ip ? { 'CF-Connecting-IP': ip } : {}),
  body: JSON.stringify({ shop: 'ravi-kirana', name: 'Test Buyer', phone: '9000000001', note: '', items: [{ id: 1, qty: 1 }], turnstile_token: token === undefined ? 'tok-ok' : token }) });
const trackReq = (ip, token) => new Request('https://bizgrow.example/api/public/track', {
  method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, ip ? { 'CF-Connecting-IP': ip } : {}),
  body: JSON.stringify({ shop: 'ravi-kirana', ref: 'ORD-TEST-1', phone: '9000000001', turnstile_token: token === undefined ? 'tok-ok' : token }) });
const reset = () => { siteCalls = []; dbCalls = []; limitReset(); };
const run = (req, env) => worker.fetch(req, env || ENV);

try {
  // Turnstile outcomes on order
  reset(); siteMode = 'pass';
  let r = await run(orderReq(IP, 'tok-ok'));
  let body = await r.json();
  check('turnstile pass: order placed (200)', r.status === 200 && body.ok === true, r.status);
  check('turnstile pass: the secret is sent to Cloudflare only', siteCalls.length === 1 && siteCalls[0].secret === SECRET);
  check('turnstile pass: secret not in the reply', !JSON.stringify(body).includes(SECRET));

  reset(); siteMode = 'fail';
  r = await run(orderReq(IP, 'tok-bad'));
  body = await r.json();
  check('turnstile fail: refused (403 bot_check)', r.status === 403 && body.code === 'bot_check', r.status);
  check('turnstile fail: no order written', dbCalls.length === 0);

  reset(); siteMode = 'pass';
  r = await run(orderReq(IP, ''));
  check('turnstile no token: refused (403), no Cloudflare call', r.status === 403 && siteCalls.length === 0 && dbCalls.length === 0, r.status);

  reset(); siteMode = 'throw';
  r = await run(orderReq(IP, 'tok-ok'));
  body = await r.json();
  check('turnstile unreachable (network error): 503 bot_check, no order', r.status === 503 && body.code === 'bot_check' && dbCalls.length === 0, r.status);

  reset(); siteMode = 'down';
  r = await run(orderReq(IP, 'tok-ok'));
  check('turnstile unreachable (server error): 503, no order', r.status === 503 && dbCalls.length === 0, r.status);

  reset(); siteMode = 'junk';
  r = await run(orderReq(IP, 'tok-ok'));
  check('turnstile unreachable (bad reply): 503, no order', r.status === 503 && dbCalls.length === 0, r.status);
  siteMode = 'pass';

  // Fail closed with no secret
  reset();
  r = await run(orderReq(IP, 'tok-ok'), ENV_NO_SECRET);
  body = await r.json();
  check('no secret: order refused with 503 bot_check_off', r.status === 503 && body.code === 'bot_check_off', r.status);
  check('no secret: no order and no Cloudflare call', dbCalls.length === 0 && siteCalls.length === 0);
  r = await run(trackReq(IP), ENV_NO_SECRET);
  body = await r.json();
  check('no secret: track refused with 503 bot_check_off', r.status === 503 && body.code === 'bot_check_off' && dbCalls.length === 0, r.status);
  r = await run(new Request('https://bizgrow.example/api/public/bot-check'), ENV_NO_SECRET);
  body = await r.json();
  check('no secret: bot-check says enabled false (page knows)', r.status === 200 && body.enabled === false);
  r = await run(new Request('https://bizgrow.example/api/public/bot-check'), ENV);
  body = await r.json();
  check('secret set: bot-check says enabled true with the public site key only', body.enabled === true && body.siteKey === 'site-public-1' && !JSON.stringify(body).includes(SECRET));

  // Per-connection code: one-way, no raw address, no address at all is refused
  reset(); siteMode = 'pass';
  await run(orderReq(IP, 'tok-ok'));
  const key1 = dbCalls[0] && dbCalls[0].key;
  check('visitor code: 64 hex characters', typeof key1 === 'string' && /^[0-9a-f]{64}$/.test(key1), key1 && key1.length);
  check('visitor code: the raw address is not sent', typeof key1 === 'string' && key1.indexOf('203.0.113') < 0);
  reset();
  await run(orderReq(IP, 'tok-ok'));
  check('visitor code: same address and day give the same code', dbCalls[0] && dbCalls[0].key === key1);
  reset();
  await run(orderReq('198.51.100.7', 'tok-ok'));
  check('visitor code: another address gives another code', dbCalls[0] && dbCalls[0].key !== key1);
  reset();
  r = await run(orderReq(null, 'tok-ok'));
  body = await r.json();
  check('no connection address: order refused (503), limit cannot be skipped', r.status === 503 && body.code === 'unavailable' && dbCalls.length === 0, r.status);
  reset();
  r = await run(trackReq(null));
  check('no connection address: track refused (503)', r.status === 503 && dbCalls.length === 0, r.status);

  // Per-connection limits from the database come through
  reset(); dbMode = 'limit';
  r = await run(orderReq('198.51.100.8', 'tok-ok'));
  body = await r.json();
  check('order limit: database message comes through (400)', r.status === 400 && /Too many orders/.test(body.error), r.status);
  r = await run(trackReq('198.51.100.8'));
  body = await r.json();
  check('track limit: database message comes through (400)', r.status === 400 && /Too many orders/.test(body.error), r.status);
  dbMode = 'ok';

  // No fallback to the older functions
  reset(); dbMode = 'missing';
  r = await run(orderReq('198.51.100.9', 'tok-ok'));
  body = await r.json();
  check('order: newer function missing gives 503 unavailable', r.status === 503 && body.code === 'unavailable', r.status);
  check('order: older place_store_order never called', dbCalls.every(c => c.name !== 'place_store_order'), dbCalls.map(c => c.name).join(','));
  reset();
  r = await run(trackReq('198.51.100.9'));
  check('track: newer function missing gives 503, older track_store_order never called', r.status === 503 && dbCalls.every(c => c.name !== 'track_store_order'));
  dbMode = 'ok';

  // Tracking now needs the bot check too (it used to have none, so plain requests spent the shop's tracking cap)
  reset(); siteMode = 'pass';
  r = await run(trackReq('198.51.100.20', 'tok-ok'));
  check('track bot check: a passed check is needed (200 with the status)', r.status === 200 && (await r.clone().json()).ok === true);
  reset(); siteMode = 'pass';
  r = await run(trackReq('198.51.100.21', ''));
  check('track bot check: no token refused (403), no database call', r.status === 403 && dbCalls.length === 0 && siteCalls.length === 0, r.status);
  reset(); siteMode = 'fail';
  r = await run(trackReq('198.51.100.22', 'tok-bad'));
  check('track bot check: failed check refused (403), no database call', r.status === 403 && dbCalls.length === 0, r.status);
  reset(); siteMode = 'throw';
  r = await run(trackReq('198.51.100.23', 'tok-ok'));
  check('track bot check: unreachable check gives 503 bot_check, no database call', r.status === 503 && dbCalls.length === 0, r.status);
  siteMode = 'pass';

  // In-Worker per-visitor limits (same numbers as the database: 10 orders an hour, 10 tracking tries per 15 minutes)
  reset();
  let okCount = 0;
  for (let i = 0; i < 10; i++) { const rr = await run(orderReq('198.51.100.30', 'tok-ok')); if (rr.status === 200) okCount++; }
  check('order limit in Worker: 10 orders from one connection are allowed', okCount === 10, okCount);
  const before = dbCalls.length;
  r = await run(orderReq('198.51.100.30', 'tok-ok'));
  body = await r.json();
  check('order limit in Worker: the 11th is refused (400) and never reaches the database', r.status === 400 && /Too many orders/.test(body.error) && dbCalls.length === before, r.status);
  reset();
  r = await run(orderReq('198.51.100.31', 'tok-ok'));
  check('order limit in Worker: another connection is not affected', r.status === 200, r.status);
  reset();
  let trackOk = 0;
  for (let i = 0; i < 10; i++) { const rr = await run(trackReq('198.51.100.32', 'tok-ok')); if (rr.status === 200) trackOk++; }
  const tBefore = dbCalls.length;
  r = await run(trackReq('198.51.100.32', 'tok-ok'));
  body = await r.json();
  check('track limit in Worker: 10 tries allowed, the 11th says limited (200, limited true) with no database call',
    trackOk === 10 && body.limited === true && dbCalls.length === tBefore, trackOk + ' then ' + r.status);
  const t0 = 1000000;
  limitReset();
  let ok2 = true;
  for (let i = 0; i < 10; i++) ok2 = ok2 && limitAllow('track', 'k1', t0 + i);
  check('limiter window: 10 in the window allowed, 11th refused', ok2 && limitAllow('track', 'k1', t0 + 10) === false);
  check('limiter window: after 15 minutes the visitor is allowed again', limitAllow('track', 'k1', t0 + 15 * 60 * 1000 + 1000) === true);
  check('limiter window: an hour-long order window is separate from tracking', limitAllow('order', 'k1', t0) === true);
  check('limiter: an unknown route or empty key is refused', limitAllow('nope', 'k1', t0) === false && limitAllow('order', '', t0) === false);

  // Normal paths still reach the newer functions
  reset();
  await run(trackReq('198.51.100.10'));
  check('track: uses the per-connection function', dbCalls.length === 1 && dbCalls[0].name === 'track_store_order_for_client');
  reset();
  await run(orderReq('198.51.100.11', 'tok-ok'));
  check('order: uses the per-connection function', dbCalls.length === 1 && dbCalls[0].name === 'place_store_order_for_client');

} catch (e) {
  out.push('FAIL unexpected error: ' + String(e && e.message || e).split('\n')[0]);
} finally {
  globalThis.fetch = realFetch;
}

const fails = out.filter(s => s.startsWith('FAIL')).length;
console.log(out.join('\n'));
console.log('== public-routes-smoke: PASS=' + (out.length - fails) + ' FAIL=' + fails);
process.exit(fails ? 1 : 0);
