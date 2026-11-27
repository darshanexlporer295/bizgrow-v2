// Worker smoke test for worker/billing.mjs. No network: Razorpay, Supabase and the login check are mocked.
// Run: node /workspace/agent/gh-push-bizgrow-v2/tests/billing-worker-smoke.mjs
// The secrets below are fake test values, used only with the vectors below.
import assert from 'node:assert/strict';
import { handleBilling, verifyPaymentSignature, verifyWebhookSignature, billingOn } from '../worker/billing.mjs';

const KEY_SECRET = 'test_key_secret_123';
const WEBHOOK_SECRET = 'test_webhook_secret_456';
const PAY_SIG = '574561db4e9ed5bae19f5020b83afa7aac5786f20830daec9365d5bec2efa43d';
const WH_BODY = '{"event":"payment.captured","payload":{"payment":{"entity":{"id":"pay_TESTVEC001","order_id":"order_TESTVEC001","amount":49900,"currency":"INR","status":"captured"}}}}';
const WH_SIG = 'f644cea730b0ae257b7fdc31c4b51b9d42438153a672d46ae8ce2bf68798a82c';

const ENV_ON = {
  SUPABASE_URL: 'https://db.example.test',
  SUPABASE_ANON_KEY: 'anon_test',
  SUPABASE_SERVICE_KEY: 'service_test',
  RAZORPAY_KEY_ID: 'rzp_test_TESTKEY',
  RAZORPAY_KEY_SECRET: KEY_SECRET,
  RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET
};
const ENV_OFF = { SUPABASE_URL: 'https://db.example.test', SUPABASE_ANON_KEY: 'anon_test' };

// A fake network. Each call is recorded; routes decide the reply.
function fakeNet(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method || 'GET', body: init.body, headers: init.headers || {} });
    for (const [match, reply] of routes) {
      if (u.includes(match)) {
        const out = typeof reply === 'function' ? reply(u, init) : reply;
        return new Response(JSON.stringify(out.body), { status: out.status || 200, headers: { 'content-type': 'application/json' } });
      }
    }
    return new Response('{"message":"no route"}', { status: 500 });
  };
  return { fetchImpl, calls };
}

function req(path, { method = 'POST', body, raw, headers = {} } = {}) {
  const init = { method, headers: { ...headers } };
  if (raw !== undefined) init.body = raw;
  else if (body !== undefined) { init.body = JSON.stringify(body); init.headers['content-type'] = 'application/json'; }
  return new Request('https://bizgrow.example.test' + path, init);
}

const OWNER_AUTH = ['/auth/v1/user', { body: { id: 'user-owner-1' } }];
const PAY_ROW = { ok: true, payment_id: 'b3f1c2d4-0000-4000-8000-000000000001', amount_paise: 49900, currency: 'INR', plan: 'growth' };

let passed = 0;
const results = [];
async function check(name, fn) {
  try { await fn(); passed++; results.push(['PASS', name]); }
  catch (e) { results.push(['FAIL', name + ' :: ' + e.message]); }
}

await check('signature vector for checkout matches', async () => {
  assert.equal(await verifyPaymentSignature(KEY_SECRET, 'order_TESTVEC001', 'pay_TESTVEC001', PAY_SIG), true);
});
await check('checkout signature rejects a changed payment id', async () => {
  assert.equal(await verifyPaymentSignature(KEY_SECRET, 'order_TESTVEC001', 'pay_TESTVEC002', PAY_SIG), false);
});
await check('checkout signature rejects the webhook secret', async () => {
  assert.equal(await verifyPaymentSignature(WEBHOOK_SECRET, 'order_TESTVEC001', 'pay_TESTVEC001', PAY_SIG), false);
});
await check('webhook signature vector matches the raw body', async () => {
  assert.equal(await verifyWebhookSignature(WEBHOOK_SECRET, WH_BODY, WH_SIG), true);
});
await check('webhook signature fails if one byte of the body changes', async () => {
  assert.equal(await verifyWebhookSignature(WEBHOOK_SECRET, WH_BODY.replace('49900', '49901'), WH_SIG), false);
});
await check('webhook signature fails with the key secret', async () => {
  assert.equal(await verifyWebhookSignature(KEY_SECRET, WH_BODY, WH_SIG), false);
});

await check('payment is off when keys are missing', async () => {
  assert.equal(billingOn(ENV_OFF), false);
  const { fetchImpl, calls } = fakeNet([]);
  const cfg = await handleBilling(req('/api/billing/config', { method: 'GET' }), ENV_OFF, '/api/billing/config', { fetch: fetchImpl });
  const body = await cfg.json();
  assert.equal(body.enabled, false);
  assert.match(body.message, /coming soon/);
  const co = await handleBilling(req('/api/billing/create-order', { body: { shop_id: 's', plan: 'growth' } }), ENV_OFF, '/api/billing/create-order', { fetch: fetchImpl });
  assert.equal(co.status, 503);
  assert.equal(calls.length, 0, 'no network call when payment is off');
});

await check('config says on and sends no secret', async () => {
  const { fetchImpl } = fakeNet([]);
  const res = await handleBilling(req('/api/billing/config', { method: 'GET' }), ENV_ON, '/api/billing/config', { fetch: fetchImpl });
  const text = await res.text();
  assert.match(text, /"enabled":true/);
  assert.equal(text.includes(KEY_SECRET) || text.includes(WEBHOOK_SECRET) || text.includes('service_test'), false);
});

await check('webhook with a valid signature upgrades through the database once', async () => {
  let rpcBody = null;
  const { fetchImpl, calls } = fakeNet([
    ['/rest/v1/rpc/billing_mark_paid', (u, init) => { rpcBody = JSON.parse(init.body); return { body: { ok: true, status: 'paid', plan: 'growth' } }; }]
  ]);
  const res = await handleBilling(req('/api/billing/webhook', { raw: WH_BODY, headers: { 'x-razorpay-signature': WH_SIG } }), ENV_ON, '/api/billing/webhook', { fetch: fetchImpl });
  assert.equal(res.status, 200);
  assert.equal(rpcBody.p_order, 'order_TESTVEC001');
  assert.equal(rpcBody.p_amount, 49900);
  assert.equal(rpcBody.p_currency, 'INR');
  assert.equal(rpcBody.p_source, 'webhook');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers.authorization, 'Bearer service_test', 'database call uses the service key');
});

await check('webhook with a bad signature changes nothing', async () => {
  const { fetchImpl, calls } = fakeNet([]);
  const res = await handleBilling(req('/api/billing/webhook', { raw: WH_BODY, headers: { 'x-razorpay-signature': '00'.repeat(32) } }), ENV_ON, '/api/billing/webhook', { fetch: fetchImpl });
  assert.equal(res.status, 400);
  assert.equal(calls.length, 0);
});

await check('webhook is refused when the webhook secret is not set', async () => {
  const env = { ...ENV_ON, RAZORPAY_WEBHOOK_SECRET: '' };
  const { fetchImpl, calls } = fakeNet([]);
  const res = await handleBilling(req('/api/billing/webhook', { raw: WH_BODY, headers: { 'x-razorpay-signature': WH_SIG } }), env, '/api/billing/webhook', { fetch: fetchImpl });
  assert.equal(res.status, 503);
  assert.equal(calls.length, 0);
});

await check('a repeated webhook is answered the same way (idempotent in the database)', async () => {
  const { fetchImpl } = fakeNet([
    ['/rest/v1/rpc/billing_mark_paid', { body: { ok: true, status: 'paid', plan: 'growth' } }]
  ]);
  const a = await handleBilling(req('/api/billing/webhook', { raw: WH_BODY, headers: { 'x-razorpay-signature': WH_SIG } }), ENV_ON, '/api/billing/webhook', { fetch: fetchImpl });
  const b = await handleBilling(req('/api/billing/webhook', { raw: WH_BODY, headers: { 'x-razorpay-signature': WH_SIG } }), ENV_ON, '/api/billing/webhook', { fetch: fetchImpl });
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
});

await check('webhook amount mismatch from the database is refused, plan not changed', async () => {
  const { fetchImpl } = fakeNet([
    ['/rest/v1/rpc/billing_mark_paid', { status: 400, body: { code: 'P0001', message: 'Amount does not match this plan.' } }]
  ]);
  const res = await handleBilling(req('/api/billing/webhook', { raw: WH_BODY, headers: { 'x-razorpay-signature': WH_SIG } }), ENV_ON, '/api/billing/webhook', { fetch: fetchImpl });
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.error, 'Amount does not match this plan.');
});

await check('create-order takes the price from the database, not the browser', async () => {
  let begin = null, orderBody = null, attach = null;
  const { fetchImpl } = fakeNet([
    OWNER_AUTH,
    ['/rest/v1/rpc/billing_begin_order', (u, init) => { begin = JSON.parse(init.body); return { body: PAY_ROW }; }],
    ['api.razorpay.com/v1/orders', (u, init) => { orderBody = JSON.parse(init.body); return { body: { id: 'order_NEW123', status: 'created' } }; }],
    ['/rest/v1/rpc/billing_attach_order', (u, init) => { attach = JSON.parse(init.body); return { body: { ok: true } }; }]
  ]);
  const res = await handleBilling(req('/api/billing/create-order', {
    body: { shop_id: 'shop-1', plan: 'GROWTH', amount: 1 },
    headers: { authorization: 'Bearer user_token' }
  }), ENV_ON, '/api/billing/create-order', { fetch: fetchImpl });
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.equal(begin.p_user_id, 'user-owner-1');
  assert.equal(begin.p_plan, 'growth');
  assert.equal(orderBody.amount, 49900);
  assert.equal(orderBody.currency, 'INR');
  assert.ok(orderBody.receipt.length <= 40);
  assert.equal(attach.p_order, 'order_NEW123');
  assert.equal(out.orderId, 'order_NEW123');
  assert.equal(out.keyId, 'rzp_test_TESTKEY');
  assert.equal(JSON.stringify(out).includes(KEY_SECRET), false);
});

await check('create-order without a login is refused before any database call', async () => {
  const { fetchImpl, calls } = fakeNet([]);
  const res = await handleBilling(req('/api/billing/create-order', { body: { shop_id: 's', plan: 'growth' } }), ENV_ON, '/api/billing/create-order', { fetch: fetchImpl });
  assert.equal(res.status, 401);
  assert.equal(calls.length, 0);
});

await check('create-order when the database refuses (not owner) shows its plain message only', async () => {
  const { fetchImpl } = fakeNet([
    OWNER_AUTH,
    ['/rest/v1/rpc/billing_begin_order', { status: 400, body: { code: 'P0001', message: 'Only the shop owner can pay for a plan.' } }]
  ]);
  const res = await handleBilling(req('/api/billing/create-order', {
    body: { shop_id: 'shop-1', plan: 'growth' }, headers: { authorization: 'Bearer t' }
  }), ENV_ON, '/api/billing/create-order', { fetch: fetchImpl });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'Only the shop owner can pay for a plan.');
});

await check('verify with a bad signature is refused and nothing is read or changed', async () => {
  const { fetchImpl, calls } = fakeNet([OWNER_AUTH]);
  const res = await handleBilling(req('/api/billing/verify', {
    body: { razorpay_order_id: 'order_TESTVEC001', razorpay_payment_id: 'pay_TESTVEC001', razorpay_signature: 'ff'.repeat(32) },
    headers: { authorization: 'Bearer t' }
  }), ENV_ON, '/api/billing/verify', { fetch: fetchImpl });
  assert.equal(res.status, 400);
  assert.equal(calls.filter(c => c.url.includes('billing_mark_paid')).length, 0);
  assert.equal(calls.filter(c => c.url.includes('/payments/')).length, 0);
});

await check('verify with a good signature and a captured payment upgrades', async () => {
  let mark = null;
  const { fetchImpl } = fakeNet([
    OWNER_AUTH,
    ['api.razorpay.com/v1/payments/pay_TESTVEC001', { body: { id: 'pay_TESTVEC001', order_id: 'order_TESTVEC001', amount: 49900, currency: 'INR', status: 'captured' } }],
    ['/rest/v1/rpc/billing_mark_paid', (u, init) => { mark = JSON.parse(init.body); return { body: { ok: true, status: 'paid', plan: 'growth' } }; }]
  ]);
  const res = await handleBilling(req('/api/billing/verify', {
    body: { razorpay_order_id: 'order_TESTVEC001', razorpay_payment_id: 'pay_TESTVEC001', razorpay_signature: PAY_SIG },
    headers: { authorization: 'Bearer t' }
  }), ENV_ON, '/api/billing/verify', { fetch: fetchImpl });
  assert.equal(res.status, 200);
  assert.equal(mark.p_source, 'verify');
  assert.equal(mark.p_user_id, 'user-owner-1');
  assert.equal(mark.p_amount, 49900);
});

await check('verify with a payment not yet captured waits, does not upgrade', async () => {
  const { fetchImpl, calls } = fakeNet([
    OWNER_AUTH,
    ['api.razorpay.com/v1/payments/pay_TESTVEC001', { body: { id: 'pay_TESTVEC001', order_id: 'order_TESTVEC001', amount: 49900, currency: 'INR', status: 'authorized' } }]
  ]);
  const res = await handleBilling(req('/api/billing/verify', {
    body: { razorpay_order_id: 'order_TESTVEC001', razorpay_payment_id: 'pay_TESTVEC001', razorpay_signature: PAY_SIG },
    headers: { authorization: 'Bearer t' }
  }), ENV_ON, '/api/billing/verify', { fetch: fetchImpl });
  assert.equal(res.status, 202);
  assert.equal(calls.filter(c => c.url.includes('billing_mark_paid')).length, 0);
});

await check('Razorpay failure gives a generic message, no raw error text', async () => {
  const { fetchImpl } = fakeNet([
    OWNER_AUTH,
    ['/rest/v1/rpc/billing_begin_order', { body: PAY_ROW }],
    ['api.razorpay.com/v1/orders', { status: 400, body: { error: { description: 'Authentication failed for rzp_test_TESTKEY' } } }]
  ]);
  const res = await handleBilling(req('/api/billing/create-order', {
    body: { shop_id: 'shop-1', plan: 'growth' }, headers: { authorization: 'Bearer t' }
  }), ENV_ON, '/api/billing/create-order', { fetch: fetchImpl });
  assert.equal(res.status, 502);
  const text = await res.text();
  assert.equal(text.includes('rzp_test'), false);
  assert.equal(text.includes('Authentication'), false);
});

await check('database unreachable on create-order gives the plain try-again message', async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes('/auth/v1/user')) return new Response(JSON.stringify(OWNER_AUTH[1].body), { status: 200, headers: { 'content-type': 'application/json' } });
    throw new Error('connect ECONNREFUSED 10.0.0.1:5432 secret-host');
  };
  const res = await handleBilling(req('/api/billing/create-order', { body: { shop_id: 'shop-1', plan: 'growth' }, headers: { authorization: 'Bearer user_token' } }), ENV_ON, '/api/billing/create-order', { fetch: fetchImpl });
  assert.equal(res.status, 400);
  const text = await res.text();
  assert.ok(!text.includes('ECONNREFUSED') && !text.includes('secret-host'), 'raw error leaked');
  assert.ok(text.includes('Payment could not be confirmed'));
});

await check('unknown billing path is not handled here', async () => {
  const res = await handleBilling(req('/api/billing/nope', { method: 'GET' }), ENV_ON, '/api/billing/nope', {});
  assert.equal(res, null);
});

for (const [s, n] of results) console.log(s, n);
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
