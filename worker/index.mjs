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
// Voice (speech-to-text): the Worker secret SARVAM_API_KEY is used only here, on the server.
//   GET  /api/voice/config      says whether voice is on (the key is set) and the max recording length.
//   POST /api/voice/transcribe  takes one short recording, sends it to the speech service, returns the text.
//   Limits: 1 MB per recording, 20 requests per minute per connection (best effort: each Worker instance
//   keeps its own count), 20 second timeout. When voice is off or a call fails, the page uses its own
//   browser recognition instead. Only product names are sent as hints; customer names never are.

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const NO_STORE = { 'content-type': 'application/json', 'cache-control': 'no-store' };
const GENERIC_ERROR = 'Something went wrong. Please try again.';

const SARVAM_URL = 'https://api.sarvam.ai/speech-to-text';
const SARVAM_MODEL = 'saaras:v4';
const VOICE_MAX_BYTES = 1024 * 1024;
const VOICE_MAX_SECONDS = 25;
const VOICE_LANGS = ['unknown', 'hi-IN', 'en-IN', 'mr-IN', 'gu-IN'];
const VOICE_RATE_MAX = 20;
const VOICE_RATE_WINDOW_MS = 60000;
const VOICE_TIMEOUT_MS = 20000;
const VOICE_FAILED = 'Voice typing did not work this time. Please try again or type it.';
const voiceHits = new Map();

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

function voiceKeyOn(env) {
  return typeof env.SARVAM_API_KEY === 'string' && env.SARVAM_API_KEY.trim() !== '';
}

// Counts requests per connection code for one minute. Returns false when the limit is passed.
function voiceRateOk(who) {
  const now = Date.now();
  if (voiceHits.size > 5000) voiceHits.clear();
  const h = voiceHits.get(who);
  if (!h || now - h.start >= VOICE_RATE_WINDOW_MS) { voiceHits.set(who, { start: now, count: 1 }); return true; }
  if (h.count >= VOICE_RATE_MAX) return false;
  h.count += 1;
  return true;
}

// Product-name hints only: plain text, up to 50 terms of up to 64 characters each.
function voiceTerms(v) {
  if (typeof v !== 'string' || !v) return [];
  let arr;
  try { arr = JSON.parse(v); } catch (e) { return []; }
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const t of arr) {
    if (typeof t !== 'string') continue;
    const s = t.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 64);
    if (s && out.indexOf(s) < 0) out.push(s);
    if (out.length >= 50) break;
  }
  return out;
}

async function transcribeVoice(request, env) {
  if (!voiceKeyOn(env)) return json(503, { ok: false, code: 'voice_off', error: VOICE_FAILED });
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > VOICE_MAX_BYTES + 8192) {
    return json(413, { ok: false, code: 'too_big', error: 'That recording is too long. Please try a shorter one.' });
  }
  const who = (await clientKey(request)) || 'anon';
  if (!voiceRateOk(who)) {
    return json(429, { ok: false, code: 'rate_limited', error: 'Too many voice tries. Wait a minute and try again.' });
  }

  let form;
  try { form = await request.formData(); } catch (e) { form = null; }
  if (!form) return json(400, { ok: false, code: 'bad_request', error: 'Please try again.' });
  const audio = form.get('audio');
  if (!audio || typeof audio === 'string' || !(audio.size > 0)) {
    return json(400, { ok: false, code: 'no_audio', error: 'No sound was recorded. Please try again.' });
  }
  if (audio.size > VOICE_MAX_BYTES) {
    return json(413, { ok: false, code: 'too_big', error: 'That recording is too long. Please try a shorter one.' });
  }
  const lang = typeof form.get('language') === 'string' ? form.get('language') : 'unknown';
  if (VOICE_LANGS.indexOf(lang) < 0) return json(400, { ok: false, code: 'bad_language', error: 'Please try again.' });

  const out = new FormData();
  const name = typeof audio.name === 'string' && audio.name ? audio.name : 'speech.webm';
  out.append('file', audio, name);
  out.append('model', SARVAM_MODEL);
  out.append('mode', 'transcribe');
  out.append('language_code', lang);
  const terms = voiceTerms(form.get('keyterms'));
  if (terms.length) out.append('keyterms', JSON.stringify(terms));

  let res;
  try {
    res = await fetch(SARVAM_URL, {
      method: 'POST',
      headers: { 'api-subscription-key': env.SARVAM_API_KEY.trim() },
      body: out,
      signal: AbortSignal.timeout(VOICE_TIMEOUT_MS)
    });
  } catch (e) {
    return json(503, { ok: false, code: 'failed', error: VOICE_FAILED });
  }
  if (!res.ok) return json(503, { ok: false, code: 'failed', error: VOICE_FAILED });
  const data = await res.json().catch(() => null);
  const transcript = data && typeof data.transcript === 'string' ? data.transcript.trim().slice(0, 500) : '';
  if (!transcript) return json(200, { ok: false, code: 'empty', error: 'I did not hear anything. Please try again.' });
  const got = data && typeof data.language_code === 'string' ? data.language_code.slice(0, 12) : lang;
  return json(200, { ok: true, transcript, language_code: got });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/voice/config') {
      if (request.method !== 'GET') return json(405, { error: 'Use GET' });
      return json(200, { enabled: voiceKeyOn(env), maxSeconds: VOICE_MAX_SECONDS });
    }
    if (url.pathname === '/api/voice/transcribe') {
      if (request.method !== 'POST') return json(405, { ok: false, error: 'Use POST' });
      return transcribeVoice(request, env);
    }
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
