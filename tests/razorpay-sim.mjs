// Razorpay API simulator test for worker/billing.mjs. No network, no real keys: a small fake Razorpay (orders,
// payments, a basic-auth check, injected faults) and a fake database whose billing_mark_paid rules copy
// supabase/patch-17.sql. Fake key values only.
// What this proves: the Worker sends the right requests, reads the answers it should, refuses tampering,
// and never shows raw error text. What it does NOT prove: that Razorpay's real servers answer the same way.
// That is the TEST-MODE run in docs/PAYMENTS-GUIDE.md (Part 4).
// Run: node tests/razorpay-sim.mjs   (from the repo folder)
import assert from 'node:assert/strict';
import { handleBilling, hmacHex } from '../worker/billing.mjs';

const KEY_ID = 'rzp_test_SIMKEYID';
const KEY_SECRET = 'sim_key_secret_7f3a';
const WEBHOOK_SECRET = 'sim_webhook_secret_9c1d';
const PRICE = 49900;
const OWNER = 'user-owner-1';
const STAFF = 'user-staff-2';
const SHOP = 'shop-1';
const RZ = 'https://api.razorpay.com/v1';
const ENV = {
  SUPABASE_URL: 'https://db.example.test',
  SUPABASE_ANON_KEY: 'anon_test',
  SUPABASE_SERVICE_KEY: 'service_test',
  RAZORPAY_KEY_ID: KEY_ID,
  RAZORPAY_KEY_SECRET: KEY_SECRET,
  RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET
};
const TRY_AGAIN_START = 'Payment could not be confirmed right now';
// Text that must never reach a member: secrets, the fake Razorpay's raw descriptions, the fake database's raw detail.
const NEVER_SHOWN = [KEY_SECRET, WEBHOOK_SECRET, 'service_test', 'Authentication failed', 'SIM-RAW'];
const ALL_BODIES = [];

function jsonRes(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

// Injected faults. 'timeout' and 'network' throw the way fetch does; the others return a bad answer.
function fault(kind) {
  if (kind === 'timeout') throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  if (kind === 'network') throw new TypeError('fetch failed');
  if (kind === 'malformed') return new Response('<html>SIM-RAW gateway page</html>', { status: 200 });
  return jsonRes(Number(kind), { error: { code: 'SERVER_ERROR', description: 'SIM-RAW ' + kind + ' Authentication failed' } });
}

function razorpayFetch(w, u, init) {
  const path = u.slice(RZ.length);
  const method = init.method || 'GET';
  const auth = (init.headers || {}).authorization || '';
  w.rz.calls.push({ method, path, auth, timed: !!init.signal, body: init.body });
  // The fake Razorpay knows the real key pair and checks the basic auth the Worker sends.
  const want = 'Basic ' + Buffer.from(KEY_ID + ':' + KEY_SECRET).toString('base64');
  if (auth !== want) return jsonRes(401, { error: { code: 'BAD_REQUEST_ERROR', description: 'Authentication failed' } });
  const service = path.startsWith('/orders') ? 'orders' : 'payments';
  if (w.faults[service]) return fault(w.faults[service]);
  if (method === 'POST' && path === '/orders') {
    const b = JSON.parse(init.body);
    if (!Number.isInteger(b.amount) || b.amount < 100 || b.currency !== 'INR' || String(b.receipt).length > 40) {
      return jsonRes(400, { error: { code: 'BAD_REQUEST_ERROR', description: 'SIM-RAW bad order' } });
    }
    const id = 'order_SIM' + (Object.keys(w.rz.orders).length + 1);
    w.rz.orders[id] = { id, entity: 'order', amount: b.amount, currency: b.currency, receipt: b.receipt, status: 'created' };
    return jsonRes(200, w.rz.orders[id]);
  }
  if (method === 'GET' && path.startsWith('/payments/')) {
    const id = decodeURIComponent(path.slice('/payments/'.length));
    const p = w.rz.payments[id];
    if (!p) return jsonRes(400, { error: { code: 'BAD_REQUEST_ERROR', description: 'The id provided does not exist' } });
    return jsonRes(200, p);
  }
  return jsonRes(404, { error: { code: 'NOT_FOUND', description: 'SIM-RAW no route' } });
}

// The fake database. billing_mark_paid mirrors supabase/patch-17.sql: same-payment repeat is ok, a different
// payment on a paid order is refused, the amount and currency must match, a verify must come from the owner.
function markPaid(w, a) {
  const row = Object.values(w.db.rows).find(r => r.order === a.p_order);
  if (!row) return jsonRes(400, { code: '22023', message: 'Payment not found.' });
  if (row.status === 'paid') {
    if (row.payment === a.p_payment) return jsonRes(200, { ok: true, status: 'paid', plan: row.plan });
    return jsonRes(400, { code: '22023', message: 'This order was already paid.' });
  }
  if (a.p_amount !== row.amount || String(a.p_currency || '').toUpperCase() !== row.currency) {
    return jsonRes(400, { code: '22023', message: 'Amount does not match this plan.' });
  }
  if (a.p_source === 'verify' && a.p_user_id !== OWNER) {
    return jsonRes(403, { code: '42501', message: 'Only the shop owner can confirm this payment.' });
  }
  const shop = w.db.shops[row.shop];
  row.status = 'paid';
  row.payment = a.p_payment;
  if (shop.plan === row.plan) return jsonRes(200, { ok: true, status: 'paid', plan: row.plan, plan_changed: false });
  shop.plan = row.plan;
  w.db.planUpdates++;
  return jsonRes(200, { ok: true, status: 'paid', plan: row.plan, plan_changed: true });
}

function dbFetch(w, name, args) {
  w.db.calls.push({ name, args });
  if (w.faults.db && w.faults.db.rpc === name) return fault(w.faults.db.kind);
  const bad = msg => jsonRes(400, { code: '22023', message: msg });
  if (name === 'billing_begin_order') {
    if (args.p_user_id !== OWNER) return bad('Only the shop owner can take payments for this shop.');
    const id = '00000000-0000-4000-8000-' + String(w.db.seq++).padStart(12, '0');
    w.db.rows[id] = { id, order: null, payment: null, status: 'pending', amount: PRICE, currency: 'INR', plan: 'growth', shop: args.p_shop };
    return jsonRes(200, { ok: true, payment_id: id, amount_paise: PRICE, currency: 'INR', plan: 'growth' });
  }
  if (name === 'billing_attach_order') {
    const row = w.db.rows[args.p_payment];
    if (!row) return bad('Payment not found.');
    row.order = args.p_order;
    return jsonRes(200, { ok: true });
  }
  if (name === 'billing_mark_paid') return markPaid(w, args);
  return jsonRes(404, { code: 'PGRST202', message: 'SIM-RAW no function' });
}

function world(faults = {}, envOverride = {}) {
  const w = {
    env: { ...ENV, ...envOverride },
    faults,
    rz: { orders: {}, payments: {}, calls: [] },
    db: { rows: {}, shops: { [SHOP]: { plan: 'free' } }, calls: [], seq: 1, planUpdates: 0 }
  };
  w.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith(RZ)) return razorpayFetch(w, u, init);
    if (u.includes('/auth/v1/user')) {
      const tok = (init.headers || {}).authorization || '';
      if (tok === 'Bearer user_token') return jsonRes(200, { id: OWNER });
      if (tok === 'Bearer staff_token') return jsonRes(200, { id: STAFF });
      return jsonRes(401, { message: 'bad token' });
    }
    if (u.includes('/rest/v1/rpc/')) return dbFetch(w, u.split('/rpc/')[1], JSON.parse(init.body));
    return jsonRes(500, { message: 'SIM-RAW no route' });
  };
  return w;
}

// Sends one request through the Worker and keeps the answer. Every answer is kept for the leak sweep.
async function call(w, path, { method = 'POST', body, raw, headers = {}, token = 'user_token' } = {}) {
  const h = { ...headers };
  if (token) h.authorization = 'Bearer ' + token;
  const init = { method, headers: h };
  if (raw !== undefined) init.body = raw;
  else if (body !== undefined) { init.body = JSON.stringify(body); h['content-type'] = 'application/json'; }
  const res = await handleBilling(new Request('https://bizgrow.example.test' + path, init), w.env, path, { fetch: w.fetch });
  const text = await res.text();
  ALL_BODIES.push(text);
  let json = null;
  try { json = JSON.parse(text); } catch (e) { json = null; }
  return { status: res.status, text, json };
}

const createOrder = w => call(w, '/api/billing/create-order', { body: { shop_id: SHOP, plan: 'growth' } });

// The customer pays at checkout: Razorpay records a payment on the order.
function pay(w, orderId, { amount = PRICE, status = 'captured', order = orderId } = {}) {
  const id = 'pay_SIM' + (Object.keys(w.rz.payments).length + 1);
  w.rz.payments[id] = { id, entity: 'payment', order_id: order, amount, currency: 'INR', status, method: 'card' };
  return id;
}

const sign = (secret, orderId, paymentId) => hmacHex(secret, orderId + '|' + paymentId);

async function verify(w, orderId, paymentId, sig) {
  return call(w, '/api/billing/verify', {
    body: { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: sig || await sign(KEY_SECRET, orderId, paymentId) }
  });
}

function captured(paymentId, orderId, amount = PRICE, type = 'payment.captured') {
  return { event: type, payload: { payment: { entity: { id: paymentId, order_id: orderId, amount, currency: 'INR', status: 'captured' } } } };
}

async function hook(w, evt, { secret = WEBHOOK_SECRET } = {}) {
  const raw = JSON.stringify(evt);
  return call(w, '/api/billing/webhook', { raw, headers: { 'x-razorpay-signature': await hmacHex(secret, raw) }, token: null });
}

const rowOf = (w, orderId) => Object.values(w.db.rows).find(r => r.order === orderId);
const dbCallsNamed = (w, name) => w.db.calls.filter(c => c.name === name).length;

const results = [];
async function check(name, fn) {
  try { await fn(); results.push(['PASS', name]); }
  catch (e) { results.push(['FAIL', name + ' :: ' + e.message]); }
}

// ---- A. Creating the order at Razorpay ----

await check('order create sends the key pair as basic auth, with a timeout, and the amount from the database', async () => {
  const w = world();
  const r = await createOrder(w);
  assert.equal(r.status, 200);
  const call0 = w.rz.calls[0];
  assert.equal(call0.auth, 'Basic ' + Buffer.from(KEY_ID + ':' + KEY_SECRET).toString('base64'));
  assert.equal(call0.timed, true);
  const sent = JSON.parse(call0.body);
  assert.equal(sent.amount, PRICE);
  assert.equal(sent.currency, 'INR');
  assert.equal(r.json.keyId, KEY_ID);
  assert.ok(r.json.orderId.startsWith('order_SIM'));
  assert.equal(r.text.includes(KEY_SECRET), false);
});

await check('order create with a wrong key secret in the Worker is refused by Razorpay; no order is attached', async () => {
  const w = world({}, { RAZORPAY_KEY_SECRET: 'wrong_secret_000' });
  const r = await createOrder(w);
  assert.equal(r.status, 502);
  assert.ok(r.json.error.startsWith(TRY_AGAIN_START));
  assert.equal(dbCallsNamed(w, 'billing_attach_order'), 0);
  assert.equal(r.text.includes('Authentication failed'), false);
});

for (const kind of ['401', '429', '500', 'timeout', 'network', 'malformed']) {
  await check(`order create when Razorpay answers ${kind}: plain try-again message, nothing attached`, async () => {
    const w = world({ orders: kind });
    const r = await createOrder(w);
    assert.equal(r.status, 502);
    assert.ok(r.json.error.startsWith(TRY_AGAIN_START), 'message was: ' + r.json.error);
    assert.equal(dbCallsNamed(w, 'billing_attach_order'), 0);
    assert.equal(r.text.includes('SIM-RAW'), false);
    assert.equal(r.text.includes('Authentication failed'), false);
  });
}

await check('a staff login is refused by the database with its plain message, and Razorpay is not called', async () => {
  const w = world();
  const r = await call(w, '/api/billing/create-order', { body: { shop_id: SHOP, plan: 'growth' }, token: 'staff_token' });
  assert.equal(r.status, 400);
  assert.equal(r.json.error, 'Only the shop owner can take payments for this shop.');
  assert.equal(w.rz.calls.length, 0);
});

// ---- B. Confirming a checkout (verify) ----

await check('checkout happy path: order, payment, signature and capture upgrade the shop once', async () => {
  const w = world();
  const o = await createOrder(w);
  const pid = pay(w, o.json.orderId);
  const r = await verify(w, o.json.orderId, pid);
  assert.equal(r.status, 200);
  assert.equal(r.json.plan_changed, true);
  assert.equal(w.db.shops[SHOP].plan, 'growth');
  assert.equal(w.db.planUpdates, 1);
  assert.equal(rowOf(w, o.json.orderId).status, 'paid');
  assert.ok(w.rz.calls.some(c => c.method === 'GET' && c.path === '/payments/' + pid && c.timed));
});

await check('verify with a signature made from another key secret is refused before Razorpay is read', async () => {
  const w = world();
  const o = await createOrder(w);
  const pid = pay(w, o.json.orderId);
  const r = await verify(w, o.json.orderId, pid, await sign('other_secret_555', o.json.orderId, pid));
  assert.equal(r.status, 400);
  assert.equal(w.rz.calls.filter(c => c.method === 'GET').length, 0);
  assert.equal(w.db.shops[SHOP].plan, 'free');
});

await check('verify where Razorpay says the payment failed waits and changes nothing', async () => {
  const w = world();
  const o = await createOrder(w);
  const pid = pay(w, o.json.orderId, { status: 'failed' });
  const r = await verify(w, o.json.orderId, pid);
  assert.equal(r.status, 202);
  assert.equal(r.json.status, 'pending');
  assert.equal(dbCallsNamed(w, 'billing_mark_paid'), 0);
  assert.equal(w.db.shops[SHOP].plan, 'free');
});

await check('tamper: Razorpay reports a smaller amount than the plan; the database refuses and the order stays pending', async () => {
  const w = world();
  const o = await createOrder(w);
  const pid = pay(w, o.json.orderId, { amount: 100 });
  const r = await verify(w, o.json.orderId, pid);
  assert.equal(r.status, 409);
  assert.equal(r.json.error, 'Amount does not match this plan.');
  assert.equal(rowOf(w, o.json.orderId).status, 'pending');
  assert.equal(w.db.planUpdates, 0);
});

await check('verify with a Razorpay timeout on the payment read gives the plain message and changes nothing', async () => {
  const w = world({ payments: 'timeout' });
  const o = await createOrder(w);
  const pid = pay(w, o.json.orderId);
  const r = await verify(w, o.json.orderId, pid);
  assert.equal(r.status, 502);
  assert.ok(r.json.error.startsWith(TRY_AGAIN_START));
  assert.equal(w.db.planUpdates, 0);
});

await check('verify when the database times out gives the plain message and the order stays pending', async () => {
  const w = world({ db: { rpc: 'billing_mark_paid', kind: 'timeout' } });
  const o = await createOrder(w);
  const pid = pay(w, o.json.orderId);
  const r = await verify(w, o.json.orderId, pid);
  assert.equal(r.status, 409);
  assert.ok(r.json.error.startsWith(TRY_AGAIN_START));
  assert.equal(rowOf(w, o.json.orderId).status, 'pending');
});

await check('verify when the database answers 500 shows no internal detail', async () => {
  const w = world({ db: { rpc: 'billing_mark_paid', kind: '500' } });
  const o = await createOrder(w);
  const pid = pay(w, o.json.orderId);
  const r = await verify(w, o.json.orderId, pid);
  assert.equal(r.status, 409);
  assert.equal(r.text.includes('SIM-RAW'), false);
  assert.ok(r.json.error.startsWith(TRY_AGAIN_START));
});

await check('verify with a second, different payment on a paid order is refused and not applied', async () => {
  const w = world();
  const o = await createOrder(w);
  const first = pay(w, o.json.orderId);
  assert.equal((await verify(w, o.json.orderId, first)).status, 200);
  const second = pay(w, o.json.orderId);
  const r = await verify(w, o.json.orderId, second);
  assert.equal(r.status, 409);
  assert.equal(r.json.error, 'This order was already paid.');
  assert.equal(w.db.planUpdates, 1);
  assert.equal(rowOf(w, o.json.orderId).payment, first);
});

await check('verify sent twice for the same payment: both answer 200, the plan changes once', async () => {
  const w = world();
  const o = await createOrder(w);
  const pid = pay(w, o.json.orderId);
  assert.equal((await verify(w, o.json.orderId, pid)).status, 200);
  assert.equal((await verify(w, o.json.orderId, pid)).status, 200);
  assert.equal(w.db.planUpdates, 1);
});

// ---- C. Webhooks from Razorpay ----

await check('webhook capture replayed three times: plan changes once, every answer is 200', async () => {
  const w = world();
  const o = await createOrder(w);
  const pid = pay(w, o.json.orderId);
  const evt = captured(pid, o.json.orderId);
  const statuses = [];
  for (let i = 0; i < 3; i++) statuses.push((await hook(w, evt)).status);
  assert.deepEqual(statuses, [200, 200, 200]);
  assert.equal(w.db.planUpdates, 1);
  assert.equal(rowOf(w, o.json.orderId).status, 'paid');
});

await check('webhook order.paid is handled the same way as payment.captured', async () => {
  const w = world();
  const o = await createOrder(w);
  const pid = pay(w, o.json.orderId);
  const r = await hook(w, captured(pid, o.json.orderId, PRICE, 'order.paid'));
  assert.equal(r.status, 200);
  assert.equal(w.db.shops[SHOP].plan, 'growth');
});

await check('webhook for a failed payment is ignored: 200, nothing read or changed', async () => {
  const w = world();
  const o = await createOrder(w);
  const pid = pay(w, o.json.orderId, { status: 'failed' });
  const r = await hook(w, captured(pid, o.json.orderId, PRICE, 'payment.failed'));
  assert.equal(r.status, 200);
  assert.equal(r.json.ignored, true);
  assert.equal(dbCallsNamed(w, 'billing_mark_paid'), 0);
  assert.equal(rowOf(w, o.json.orderId).status, 'pending');
});

await check('webhook amount that differs from the order is refused by the database; order stays pending', async () => {
  const w = world();
  const o = await createOrder(w);
  const pid = pay(w, o.json.orderId);
  const r = await hook(w, captured(pid, o.json.orderId, 100));
  assert.equal(r.status, 409);
  assert.equal(rowOf(w, o.json.orderId).status, 'pending');
  assert.equal(w.db.planUpdates, 0);
});

await check('webhook after a browser confirm is a no-op: the plan changed once and both answer 200', async () => {
  const w = world();
  const o = await createOrder(w);
  const pid = pay(w, o.json.orderId);
  assert.equal((await verify(w, o.json.orderId, pid)).status, 200);
  assert.equal((await hook(w, captured(pid, o.json.orderId))).status, 200);
  assert.equal(w.db.planUpdates, 1);
});

await check('webhook with no payment id is refused with no database call', async () => {
  const w = world();
  const r = await hook(w, { event: 'payment.captured', payload: { payment: { entity: { order_id: 'order_x', amount: PRICE, currency: 'INR' } } } });
  assert.equal(r.status, 400);
  assert.equal(dbCallsNamed(w, 'billing_mark_paid'), 0);
});

await check('webhook when the database is unreachable answers 409 with the plain message only', async () => {
  const w = world({ db: { rpc: 'billing_mark_paid', kind: 'network' } });
  const o = await createOrder(w);
  const pid = pay(w, o.json.orderId);
  const r = await hook(w, captured(pid, o.json.orderId));
  assert.equal(r.status, 409);
  assert.ok(r.json.error.startsWith(TRY_AGAIN_START));
  assert.equal(r.text.includes('fetch failed'), false);
});

// ---- D. Leak sweep over every answer above ----

await check('no answer in this run shows a secret, a raw Razorpay description or raw database text', async () => {
  assert.ok(ALL_BODIES.length > 20, 'the sweep saw too few answers: ' + ALL_BODIES.length);
  for (const text of ALL_BODIES) {
    for (const s of NEVER_SHOWN) assert.equal(text.includes(s), false, 'an answer contains a forbidden string');
  }
});

for (const [s, n] of results) console.log(s, n);
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`${results.length - failed} passed, ${failed} failed (answers checked for leaks: ${ALL_BODIES.length})`);
process.exit(failed ? 1 : 0);
