// BizGrow v2 Worker (stage 8). It serves the static site from ./v2 and answers two public store routes:
//   GET  /api/public/bot-check  tells the page whether the bot check is on, and the public site key.
//   POST /api/public/order      checks the Turnstile token (when the secret is set), then places the order
//                               with the same database function the store already used.
// The secret key lives only in Cloudflare (Worker secret TURNSTILE_SECRET_KEY). It is never sent to the
// browser, never written to a file, and never echoed in a reply. With no secret, the bot check is off and
// orders still go through (fail open), and the bot-check route says enabled:false.
// Only the public (publishable) Supabase key is used here.

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const NO_STORE = { 'content-type': 'application/json', 'cache-control': 'no-store' };

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

function botCheckInfo(env) {
  const on = secretOn(env);
  return { enabled: on, siteKey: on ? String(env.TURNSTILE_SITE_KEY || '') : '' };
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

  const base = String(env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = String(env.SUPABASE_ANON_KEY || '');
  let res;
  try {
    res = await fetch(base + '/rest/v1/rpc/place_store_order', {
      method: 'POST',
      headers: { apikey: key, authorization: 'Bearer ' + key, 'content-type': 'application/json' },
      body: JSON.stringify({
        p_slug: txt(body.shop), p_name: txt(body.name), p_phone: txt(body.phone), p_note: txt(body.note),
        p_items: Array.isArray(body.items) ? body.items : []
      })
    });
  } catch (e) {
    return json(503, { ok: false, error: 'Something went wrong. Please try again.' });
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    // Plain messages raised by the function come through; anything else gets a generic reply.
    const code = data && data.code ? String(data.code) : '';
    if ((code === 'P0001' || code === '22023') && data.message) return json(400, { ok: false, error: String(data.message) });
    return json(400, { ok: false, error: 'Something went wrong. Please try again.' });
  }
  return json(200, data || { ok: false, error: 'Something went wrong. Please try again.' });
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
    if (url.pathname.indexOf('/api/') === 0) return json(404, { error: 'Not found' });
    return env.ASSETS.fetch(request);
  }
};
