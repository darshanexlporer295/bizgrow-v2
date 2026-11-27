// Voice check (no browser, no network). Sarvam is mocked: globalThis.fetch is replaced for the speech call.
// Checks: the Worker's two voice routes (config and transcribe), size and language limits, the rate limit,
// the request it sends to the speech service (header, fields, product-name hints only), that the key never
// reaches a reply, and the Hindi, Marathi and Gujarati word additions in the parser.
// Usage: node tests/voice-smoke.mjs   (run from the repo folder; exits 1 on any failure)
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const worker = (await import(path.join(here, '..', 'worker', 'index.mjs'))).default;

const KEY = 'sarvam-test-key-4d2e';
const out = [];
const check = (name, ok, extra) => out.push((ok ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? ' (' + extra + ')' : ''));

const realFetch = globalThis.fetch;
let sarvamCalls = [];
let sarvamReply = () => Response.json({ request_id: 'r1', transcript: 'दो किलो आटा', language_code: 'hi-IN' });
globalThis.fetch = async (input, init) => {
  const u = String(input);
  if (u === 'https://api.sarvam.ai/speech-to-text') {
    sarvamCalls.push({ url: u, headers: init.headers, body: init.body });
    return sarvamReply();
  }
  throw new Error('unexpected outbound call in test');
};

const ENV_ON = { SARVAM_API_KEY: KEY, ASSETS: { fetch: async () => new Response('asset', { status: 200 }) } };
const ENV_OFF = { ASSETS: ENV_ON.ASSETS };
const IP = '203.0.113.9';

function voiceForm(over) {
  const f = new FormData();
  const o = Object.assign({ audio: new Blob([new Uint8Array(4000)], { type: 'audio/webm' }), language: 'hi-IN' }, over || {});
  if (o.audio !== null) f.append('audio', o.audio, 'speech.webm');
  if (o.language !== null) f.append('language', o.language);
  if (o.keyterms !== undefined) f.append('keyterms', o.keyterms);
  return f;
}
const post = (form, ip) => new Request('https://bizgrow.example/api/voice/transcribe', {
  method: 'POST', body: form, headers: { 'CF-Connecting-IP': ip || IP } });
const run = (req, env) => worker.fetch(req, env || ENV_ON);

try {
  // Config route
  let r = await run(new Request('https://x.example/api/voice/config'), ENV_ON);
  let body = await r.json();
  check('config: on when key set', r.status === 200 && body.enabled === true && body.maxSeconds > 0);
  check('config: does not reveal the key', !JSON.stringify(body).includes(KEY));
  r = await run(new Request('https://x.example/api/voice/config'), ENV_OFF);
  body = await r.json();
  check('config: off when key missing', r.status === 200 && body.enabled === false);
  r = await run(new Request('https://x.example/api/voice/config', { method: 'POST' }), ENV_ON);
  check('config: POST refused', r.status === 405);

  // Transcribe: voice off
  sarvamCalls = [];
  r = await run(post(voiceForm()), ENV_OFF);
  body = await r.json();
  check('transcribe: 503 voice_off when key missing', r.status === 503 && body.code === 'voice_off' && sarvamCalls.length === 0);

  // Transcribe: happy path, with product-name hints
  sarvamCalls = [];
  const terms = ['Atta 10kg', 'Tea  ', 'Atta 10kg', 'x'.repeat(100)];
  r = await run(post(voiceForm({ keyterms: JSON.stringify(terms) }), '198.51.100.1'), ENV_ON);
  body = await r.json();
  check('transcribe: ok with transcript', r.status === 200 && body.ok === true && body.transcript === 'दो किलो आटा', body.code);
  check('transcribe: language returned', body.language_code === 'hi-IN');
  const call = sarvamCalls[0];
  check('transcribe: one call to the speech service', sarvamCalls.length === 1);
  check('transcribe: key sent in the api-subscription-key header', call && call.headers['api-subscription-key'] === KEY);
  const f = call && call.body;
  check('transcribe: sends file, model, mode and language', f instanceof FormData && f.get('file') instanceof Blob &&
    f.get('model') === 'saaras:v4' && f.get('mode') === 'transcribe' && f.get('language_code') === 'hi-IN');
  const sent = f ? JSON.parse(f.get('keyterms')) : null;
  check('transcribe: keyterms are de-duplicated, trimmed and length-limited', Array.isArray(sent) && sent.length === 3 &&
    sent[0] === 'Atta 10kg' && sent[1] === 'Tea' && sent.every(t => t.length <= 64));
  check('transcribe: key never in the reply', !JSON.stringify(body).includes(KEY));

  // Auto-detect and the other languages are accepted
  for (const lang of ['unknown', 'en-IN', 'mr-IN', 'gu-IN']) {
    sarvamCalls = [];
    r = await run(post(voiceForm({ language: lang }), '198.51.100.' + (10 + ['unknown', 'en-IN', 'mr-IN', 'gu-IN'].indexOf(lang))), ENV_ON);
    check('transcribe: language ' + lang + ' accepted', r.status === 200 && sarvamCalls[0] && sarvamCalls[0].body.get('language_code') === lang);
  }
  r = await run(post(voiceForm({ language: 'fr-FR' }), '198.51.100.30'), ENV_ON);
  check('transcribe: other language refused', r.status === 400 && (await r.json()).code === 'bad_language');

  // Missing audio, too big
  r = await run(post(voiceForm({ audio: null }), '198.51.100.31'), ENV_ON);
  check('transcribe: no audio refused', r.status === 400 && (await r.json()).code === 'no_audio');
  r = await run(post(voiceForm({ audio: new Blob([new Uint8Array(0)]) }), '198.51.100.32'), ENV_ON);
  check('transcribe: empty audio refused', r.status === 400);
  const big = new Blob([new Uint8Array(1024 * 1024 + 10)], { type: 'audio/webm' });
  sarvamCalls = [];
  r = await run(post(voiceForm({ audio: big }), '198.51.100.33'), ENV_ON);
  check('transcribe: too big refused with 413', r.status === 413 && (await r.json()).code === 'too_big' && sarvamCalls.length === 0);

  // Speech service failures fall back quietly: 503 failed, no raw error text, no key
  sarvamReply = () => new Response('secret detail ' + KEY, { status: 500 });
  r = await run(post(voiceForm(), '198.51.100.40'), ENV_ON);
  let txt = await r.text();
  check('transcribe: service 500 gives failed (503)', r.status === 503 && txt.indexOf('"failed"') > 0);
  check('transcribe: service error text and key not echoed', txt.indexOf('secret detail') < 0 && txt.indexOf(KEY) < 0);
  sarvamReply = () => Response.json({ error: { code: 'insufficient_quota_error' } }, { status: 429 });
  r = await run(post(voiceForm(), '198.51.100.41'), ENV_ON);
  check('transcribe: quota error gives failed (503)', r.status === 503 && (await r.json()).code === 'failed');
  sarvamReply = () => { throw new Error('network down'); };
  r = await run(post(voiceForm(), '198.51.100.42'), ENV_ON);
  check('transcribe: network error gives failed (503)', r.status === 503 && (await r.json()).code === 'failed');
  sarvamReply = () => Response.json({ transcript: '   ' });
  r = await run(post(voiceForm(), '198.51.100.43'), ENV_ON);
  check('transcribe: empty transcript gives empty (200, ok false)', r.status === 200 && (await r.json()).code === 'empty');
  sarvamReply = () => Response.json({ request_id: 'r2', transcript: 'दो किलो आटा', language_code: 'hi-IN' });

  // Rate limit: 20 per minute per connection, then 429
  let codes = [];
  for (let i = 0; i < 21; i++) {
    r = await run(post(voiceForm(), '192.0.2.77'), ENV_ON);
    codes.push(r.status);
  }
  check('rate limit: 20 allowed, the 21st refused', codes.slice(0, 20).every(c => c === 200) && codes[20] === 429, codes.slice(-2).join(','));
  r = await run(post(voiceForm(), '192.0.2.78'), ENV_ON);
  check('rate limit: another connection is not blocked', r.status === 200);

  // Other methods and the old routes still work
  r = await run(new Request('https://x.example/api/voice/transcribe', { method: 'GET' }), ENV_ON);
  check('transcribe: GET refused', r.status === 405);
  r = await run(new Request('https://x.example/api/public/bot-check'), ENV_ON);
  check('existing bot-check route unchanged', r.status === 200 && (await r.json()).enabled === false);

  // Parser: the Hindi, Marathi and Gujarati word additions
  const code = fs.readFileSync(path.join(here, '..', 'v2', 'assets', 'v2-parse.js'), 'utf8');
  const sandbox = { window: {} };
  sandbox.window.BGV2 = { S: { customers: [], products: [
    { id: 1, name: 'Atta 10kg', price: 40, cost: 30, stock: 50 },
    { id: 2, name: 'Sugar', price: 45, cost: 38, stock: 50 },
    { id: 3, name: 'Tea', price: 120, cost: 100, stock: 50 },
    { id: 4, name: 'Milk', price: 30, cost: 25, stock: 50 }
  ] } };
  vm.runInNewContext(code, sandbox);
  const P = sandbox.window.BGV2.parse;
  let p = P('2 किलो आटा');
  check('parse: Hindi atta with a Hindi unit gives 2 of product 1', p.lines.length === 1 && p.lines[0].product_id === 1 && p.lines[0].qty === 2, JSON.stringify(p.lines.map(l => [l.product_id, l.qty])));
  p = P('पांच चीनी, दूध 1');
  check('parse: Hindi sugar and milk', p.lines.some(l => l.product_id === 2 && l.qty === 5) && p.lines.some(l => l.product_id === 4 && l.qty === 1));
  p = P('चाय 3 रुपये');
  check('parse: Hindi tea word maps to tea', p.lines.length === 1 && p.lines[0].product_id === 3, JSON.stringify(p.lines.map(l => l.product_id)));
  p = P('2 kilo atta');
  check('parse: English kilo unit still works', p.lines.length === 1 && p.lines[0].qty === 2);
  p = P('બે કિલો લોટ');
  check('parse: Gujarati two kilo atta', p.lines.length === 1 && p.lines[0].product_id === 1 && p.lines[0].qty === 2, JSON.stringify(p.lines.map(l => [l.product_id, l.qty])));
  p = P('પાંચ ખાંડ ને એક દૂધ');
  check('parse: Gujarati sugar and milk', p.lines.some(l => l.product_id === 2 && l.qty === 5) && p.lines.some(l => l.product_id === 4 && l.qty === 1), JSON.stringify(p.lines.map(l => [l.product_id, l.qty])));
  p = P('ચા ત્રણ');
  check('parse: Gujarati tea word maps to tea', p.lines.length === 1 && p.lines[0].product_id === 3 && p.lines[0].qty === 3, JSON.stringify(p.lines.map(l => [l.product_id, l.qty])));
  p = P('2 kg atta, 50 rupees udhar');
  check('parse: existing example unchanged', p.lines.length === 1 && p.lines[0].qty === 2 && p.method === 'udhar' && p.amount === 50);
} catch (e) {
  out.push('FAIL unexpected error: ' + String(e && e.message || e).split('\n')[0]);
} finally {
  globalThis.fetch = realFetch;
}

const fails = out.filter(s => s.startsWith('FAIL')).length;
console.log(out.join('\n'));
console.log('== voice-smoke: PASS=' + (out.length - fails) + ' FAIL=' + fails);
process.exit(fails ? 1 : 0);
