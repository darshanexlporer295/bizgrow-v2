// BizGrow v2 Worker (stage 8, stage 10). It serves the static site from ./v2 and answers these public store routes:
//   GET  /api/public/bot-check  tells the page whether the bot check is on, and the public site key.
//   POST /api/public/order      checks the Turnstile token (when the secret is set), then places the order.
//   POST /api/public/track      looks up an order's status for the customer (stage 10: limited per connection).
// The secret key lives only in Cloudflare (Worker secret TURNSTILE_SECRET_KEY). It is never sent to the
// browser, never written to a file, and never echoed in a reply. With no secret, the bot check is off and
// orders still go through (fail open), and the bot-check route says enabled:false.
// Stage 9: the database calls use the server key (Worker secret SUPABASE_SERVICE_KEY) when it is set.
// Until that secret is added, the public key (SUPABASE_ANON_KEY) is used, so nothing breaks.
// Stage 10 (supabase/patch-12.sql): orders and tracking are limited per connection. The Worker sends a one-way
// code made from the visitor's connection address and today's date. The address itself is never stored or sent.
// Until patch-12 is run, the new functions are missing and the Worker falls back to the old ones, so nothing breaks.
// The server key is never sent to the browser, never logged, and never echoed in a reply.

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const NO_STORE = { 'content-type': 'application/json', 'cache-control': 'no-store' };
const GENERIC_ERROR = 'Something went wrong. Please try again.';

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: NO_STORE });
}

function txt(v) { return v == null ? (v === null ? null : '') : String(v); }

function secretOn(env) {
  return typeof env.TURNSTILE_SECRET_KEY === 'string' && env.TURNSTILE_SECRET_KEY.trim() !== '';
}

// Returns true (passed), false (refused), or 'unreachable' (could not ask Cloudflare).
async function verifyTurnstile(env, token, ip) {
  if (!token) return false;
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET_KEY.trim());
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  let res;
  try { res = await fetch(SITEVERIFY_URL, { method: 'POST', body: form }); } catch (e) { return 'unreachable'; }
  if (res.status >= 500) return 'unreachable';
  const out = await res.json().catch(() => null);
  if (!out || typeof out.success !== 'boolean') return 'unreachable';
  return out.success === true;
}

// The key the Worker uses to call the database: the server key when set, else the public key.
function serverKey(env) {
  const svc = typeof env.SUPABASE_SERVICE_KEY === 'string' ? env.SUPABASE_SERVICE_KEY.trim() : '';
  if (svc) return svc;
  return String(env.SUPABASE_ANON_KEY || '').trim();
}

function botCheckInfo(env) {
  const on = secretOn(env);
  return { enabled: on, siteKey: on ? String(env.TURNSTILE_SITE_KEY || '') : '' };
}

// One-way code for this connection and today (UTC): SHA-256 of "address|date", in hex.
// The address is read, hashed, and dropped here. It is never stored, logged, or sent to the database.
async function clientKey(request) {
  const ip = request.headers.get('CF-Connecting-IP') || '';
  if (!ip) return null;
  const day = new Date().toISOString().slice(0, 10);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip + '|' + day));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

// Calls one database function. Returns { res, data }; data is the parsed reply or null.
async function callRpc(env, name, args) {
  const base = String(env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = serverKey(env);
  const res = await fetch(base + '/rest/v1/rpc/' + name, {
    method: 'POST',
    headers: { apikey: key, authorization: 'Bearer ' + key, 'content-type': 'application/json' },
    body: JSON.stringify(args)
  });
  const data = await res.json().catch(() => null);
  return { res, data };
}

// True when the database says the function does not exist yet (before patch-12 is run).
function missingFunction(r) {
  if (r.res.status === 404) return true;
  return !!(r.data && r.data.code === 'PGRST202');
}

// Plain messages raised by the database come through; anything else gets a generic reply.
function dbError(r) {
  const code = r.data && r.data.code ? String(r.data.code) : '';
  if ((code === 'P0001' || code === '22023') && r.data.message) return String(r.data.message);
  return GENERIC_ERROR;
}

async function placeOrder(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { body = null; }
  if (!body || typeof body !== 'object') return json(400, { ok: false, error: 'Please check the details and try again.' });

  if (secretOn(env)) {
    const token = typeof body.turnstile_token === 'string' ? body.turnstile_token : '';
    const passed = await verifyTurnstile(env, token, request.headers.get('CF-Connecting-IP'));
    if (passed === 'unreachable') {
      return json(503, { ok: false, code: 'bot_check', error: 'The security check could not be reached. Please try again.' });
    }
    if (!passed) {
      return json(403, { ok: false, code: 'bot_check', error: 'Please complete the security check and try again.' });
    }
  }

  const args = {
    p_slug: txt(body.shop), p_name: txt(body.name), p_phone: txt(body.phone), p_note: txt(body.note),
    p_items: Array.isArray(body.items) ? body.items : []
  };
  let r;
  try {
    const key = await clientKey(request);
    r = await callRpc(env, 'place_store_order_for_client', Object.assign({}, args, { p_client_key: key }));
    if (missingFunction(r)) {
      r = await callRpc(env, 'place_store_order', args);
    }
  } catch (e) {
    return json(503, { ok: false, error: GENERIC_ERROR });
  }
  if (!r.res.ok) return json(400, { ok: false, error: dbError(r) });
  return json(200, r.data || { ok: false, error: GENERIC_ERROR });
}

async function trackOrder(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { body = null; }
  if (!body || typeof body !== 'object') return json(400, { ok: false, error: 'Please check the details and try again.' });

  const args = { p_slug: txt(body.shop), p_ref: txt(body.ref), p_phone: txt(body.phone) };
  let r;
  try {
    const key = await clientKey(request);
    r = await callRpc(env, 'track_store_order_for_client', Object.assign({}, args, { p_client_key: key }));
    if (missingFunction(r)) {
      r = await callRpc(env, 'track_store_order', args);
    }
  } catch (e) {
    return json(503, { ok: false, error: GENERIC_ERROR });
  }
  if (!r.res.ok) return json(400, { ok: false, error: dbError(r) });
  return json(200, r.data || { ok: false, error: GENERIC_ERROR });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/public/bot-check') {
      if (request.method !== 'GET') return json(405, { error: 'Use GET' });
      return json(200, botCheckInfo(env));
    }
    if (url.pathname === '/api/public/order') {
      if (request.method !== 'POST') return json(405, { ok: false, error: 'Use POST' });
      return placeOrder(request, env);
    }
    if (url.pathname === '/api/public/track') {
      if (request.method !== 'POST') return json(405, { ok: false, error: 'Use POST' });
      return trackOrder(request, env);
    }
    if (url.pathname.indexOf('/api/') === 0) return json(404, { error: 'Not found' });
    return env.ASSETS.fetch(request);
  }
};
