// Online payments for plan upgrades (Razorpay). Imported by worker/index.mjs.
//
//   GET  /api/billing/config        says whether online payment is on (keys are set). No secrets are sent.
//   POST /api/billing/create-order  owner asks to pay for a plan. The amount comes from the database plan config.
//   POST /api/billing/verify        browser reports a finished checkout. Checked with the key secret, then the payment is read back from Razorpay.
//   POST /api/billing/webhook       Razorpay tells us a payment was captured. Checked with the webhook secret (raw body).
//
// Secrets (Cloudflare Worker secrets, never in the repo): RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET,
// RAZORPAY_WEBHOOK_SECRET. The database call uses SUPABASE_SERVICE_KEY only (no anon fallback).
// When the keys are not set, the Pay button says "coming soon" and nothing here changes a plan.
// Card details never reach this Worker or the database: Razorpay's checkout keeps them.

const RAZORPAY_API = 'https://api.razorpay.com/v1';
const RAZORPAY_TIMEOUT_MS = 15000;
const NO_STORE = { 'content-type': 'application/json', 'cache-control': 'no-store' };
const SOON = 'Online payment coming soon. You can still pay by the manual way or use a promo code.';
const TRY_AGAIN = 'Payment could not be confirmed right now. Please try again. If money was taken, it will be added to your plan automatically.';

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: NO_STORE });
}

function clean(v) { return typeof v === 'string' ? v.trim() : ''; }

// HMAC-SHA256 as lowercase hex, using Web Crypto (available in Workers and in Node 20+).
export async function hmacHex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(String(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(String(message)));
  return Array.from(new Uint8Array(sig), b => b.toString(16).padStart(2, '0')).join('');
}

// Compares two hex strings without stopping early.
export function safeEqual(a, b) {
  const x = String(a || ''), y = String(b || '');
  if (x.length !== y.length || x.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

// Checkout proof: HMAC-SHA256 of "order_id|payment_id" with the KEY secret.
export async function verifyPaymentSignature(keySecret, orderId, paymentId, signature) {
  if (!keySecret || !orderId || !paymentId || !signature) return false;
  const expected = await hmacHex(keySecret, orderId + '|' + paymentId);
  return safeEqual(expected, String(signature).toLowerCase());
}

// Webhook proof: HMAC-SHA256 of the RAW request body with the WEBHOOK secret (not the key secret).
export async function verifyWebhookSignature(webhookSecret, rawBody, signature) {
  if (!webhookSecret || typeof rawBody !== 'string' || !signature) return false;
  const expected = await hmacHex(webhookSecret, rawBody);
  return safeEqual(expected, String(signature).toLowerCase());
}

function keysOn(env) {
  return !!(clean(env.RAZORPAY_KEY_ID) && clean(env.RAZORPAY_KEY_SECRET));
}

function dbKey(env) {
  return clean(env.SUPABASE_SERVICE_KEY);
}

// Online payment is on only when the checkout keys and the database service key are all set.
export function billingOn(env) {
  return keysOn(env) && !!dbKey(env);
}

function basicAuth(env) {
  return 'Basic ' + btoa(clean(env.RAZORPAY_KEY_ID) + ':' + clean(env.RAZORPAY_KEY_SECRET));
}

// Calls Razorpay. Returns { ok, status, data }. Raw error text is never passed on to members.
export async function razorpay(env, method, path, body, deps = {}) {
  const f = deps.fetch || fetch;
  let res;
  try {
    res = await f(RAZORPAY_API + path, {
      method,
      headers: { authorization: basicAuth(env), 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(RAZORPAY_TIMEOUT_MS)
    });
  } catch (e) {
    return { ok: false, status: 0, data: null };
  }
  const data = await res.json().catch(() => null);
  return { ok: res.status >= 200 && res.status < 300, status: res.status, data };
}

// Calls one database function with the service key. Returns { status, data }.
export async function serviceRpc(env, name, args, deps = {}) {
  const f = deps.fetch || fetch;
  const base = clean(env.SUPABASE_URL).replace(/\/+$/, '');
  const key = dbKey(env);
  let res;
  try {
    res = await f(base + '/rest/v1/rpc/' + name, {
      method: 'POST',
      headers: { apikey: key, authorization: 'Bearer ' + key, 'content-type': 'application/json' },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(RAZORPAY_TIMEOUT_MS)
    });
  } catch (e) {
    // Network failure or timeout: report it the same way as a refusal, with no raw error text.
    return { status: 0, data: null };
  }
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

// Who is calling: the Supabase login behind the bearer token. Returns the user id or null.
export async function signedInUser(request, env, deps = {}) {
  const auth = request.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const f = deps.fetch || fetch;
  const base = clean(env.SUPABASE_URL).replace(/\/+$/, '');
  let res;
  try {
    res = await f(base + '/auth/v1/user', {
      headers: { apikey: clean(env.SUPABASE_ANON_KEY), authorization: 'Bearer ' + token }
    });
  } catch (e) { return null; }
  if (res.status !== 200) return null;
  const who = await res.json().catch(() => null);
  return who && typeof who.id === 'string' ? who.id : null;
}

function dbMessage(r) {
  const code = r.data && r.data.code ? String(r.data.code) : '';
  if ((code === 'P0001' || code === '22023') && r.data.message) return String(r.data.message);
  return null;
}

// POST /api/billing/create-order
async function createOrder(request, env, deps) {
  if (!billingOn(env)) return json(503, { ok: false, code: 'off', error: SOON });
  const userId = await signedInUser(request, env, deps);
  if (!userId) return json(401, { ok: false, code: 'login', error: 'Please log in again and retry.' });
  const body = await request.json().catch(() => null);
  const shop = clean(body && body.shop_id);
  const plan = clean(body && body.plan).toLowerCase();
  if (!shop || !plan) return json(400, { ok: false, error: 'Choose a plan first.' });

  // The database checks that this user owns the shop and reads the price from the plan config.
  const begun = await serviceRpc(env, 'billing_begin_order', { p_user_id: userId, p_shop: shop, p_plan: plan }, deps);
  if (begun.status >= 400 || !begun.data || begun.data.ok !== true) {
    const msg = begun.data && begun.data.message ? String(begun.data.message) : null;
    return json(400, { ok: false, error: msg || TRY_AGAIN });
  }
  const pay = begun.data;

  const order = await razorpay(env, 'POST', '/orders', {
    amount: pay.amount_paise,
    currency: pay.currency,
    receipt: String(pay.payment_id).slice(0, 40),
    notes: { plan: String(pay.plan).slice(0, 40), shop_id: shop }
  }, deps);
  if (!order.ok || !order.data || typeof order.data.id !== 'string') return json(502, { ok: false, error: TRY_AGAIN });

  const attached = await serviceRpc(env, 'billing_attach_order', { p_payment: pay.payment_id, p_order: order.data.id }, deps);
  if (attached.status >= 400 || !attached.data || attached.data.ok !== true) return json(502, { ok: false, error: TRY_AGAIN });

  return json(200, {
    ok: true,
    keyId: clean(env.RAZORPAY_KEY_ID),
    orderId: order.data.id,
    amount: pay.amount_paise,
    currency: pay.currency,
    plan: pay.plan,
    name: 'BizGrow'
  });
}

// POST /api/billing/verify  body: { razorpay_order_id, razorpay_payment_id, razorpay_signature }
async function verifyPayment(request, env, deps) {
  if (!billingOn(env)) return json(503, { ok: false, code: 'off', error: SOON });
  const userId = await signedInUser(request, env, deps);
  if (!userId) return json(401, { ok: false, code: 'login', error: 'Please log in again and retry.' });
  const body = await request.json().catch(() => null);
  const orderId = clean(body && body.razorpay_order_id);
  const paymentId = clean(body && body.razorpay_payment_id);
  const signature = clean(body && body.razorpay_signature);
  const good = await verifyPaymentSignature(clean(env.RAZORPAY_KEY_SECRET), orderId, paymentId, signature);
  if (!good) return json(400, { ok: false, error: 'Payment could not be confirmed. Please check with us before trying again.' });

  // Read the payment back from Razorpay: the status and the amount must match what the database expects.
  const pay = await razorpay(env, 'GET', '/payments/' + encodeURIComponent(paymentId), undefined, deps);
  if (!pay.ok || !pay.data) return json(502, { ok: false, error: TRY_AGAIN });
  if (pay.data.order_id !== orderId) return json(400, { ok: false, error: TRY_AGAIN });
  if (pay.data.status !== 'captured') {
    return json(202, { ok: true, status: 'pending', message: 'Payment received. Your plan will update as soon as it is confirmed.' });
  }
  return finishPayment(env, {
    orderId, paymentId, amount: pay.data.amount, currency: pay.data.currency, source: 'verify', userId
  }, deps);
}

// Marks the order paid and upgrades the plan. Idempotent: a second call for the same payment changes nothing.
async function finishPayment(env, p, deps) {
  const r = await serviceRpc(env, 'billing_mark_paid', {
    p_order: p.orderId,
    p_payment: p.paymentId,
    p_amount: Number(p.amount),
    p_currency: String(p.currency || ''),
    p_source: p.source,
    p_user_id: p.userId || null
  }, deps);
  if (r.status >= 400 || !r.data || r.data.ok !== true) {
    return json(409, { ok: false, error: dbMessage(r) || TRY_AGAIN });
  }
  return json(200, { ok: true, status: r.data.status || 'paid', plan: r.data.plan || null, plan_changed: r.data.plan_changed !== false });
}

// POST /api/billing/webhook  (Razorpay sends the signature in X-Razorpay-Signature)
async function webhook(request, env, deps) {
  const secret = clean(env.RAZORPAY_WEBHOOK_SECRET);
  if (!secret) return json(503, { ok: false, code: 'off' });
  const raw = await request.text();
  const sig = request.headers.get('x-razorpay-signature') || '';
  const good = await verifyWebhookSignature(secret, raw, sig);
  if (!good) return json(400, { ok: false });

  let evt = null;
  try { evt = JSON.parse(raw); } catch (e) { return json(400, { ok: false }); }
  const type = evt && evt.event;
  if (type !== 'payment.captured' && type !== 'order.paid') return json(200, { ok: true, ignored: true });

  const entity = evt.payload && evt.payload.payment && evt.payload.payment.entity;
  if (!entity || !entity.id || !entity.order_id) return json(400, { ok: false });
  return finishPayment(env, {
    orderId: String(entity.order_id),
    paymentId: String(entity.id),
    amount: entity.amount,
    currency: entity.currency,
    source: 'webhook',
    userId: null
  }, deps);
}

// Returns a Response for /api/billing/* paths, or null for anything else.
export async function handleBilling(request, env, pathname, deps = {}) {
  if (pathname === '/api/billing/config') {
    if (request.method !== 'GET') return json(405, { error: 'Use GET' });
    return json(200, { enabled: billingOn(env), message: billingOn(env) ? '' : SOON });
  }
  if (pathname === '/api/billing/create-order') {
    if (request.method !== 'POST') return json(405, { ok: false, error: 'Use POST' });
    return createOrder(request, env, deps);
  }
  if (pathname === '/api/billing/verify') {
    if (request.method !== 'POST') return json(405, { ok: false, error: 'Use POST' });
    return verifyPayment(request, env, deps);
  }
  if (pathname === '/api/billing/webhook') {
    if (request.method !== 'POST') return json(405, { ok: false, error: 'Use POST' });
    return webhook(request, env, deps);
  }
  return null;
}
