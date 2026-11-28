// Held-out voice check, second set. Written after the first held-out set was scored and after the one "cha" fix,
// harder on purpose: plural item words, possessive endings on names, spelling variants, number words, a stock line
// and a line with no order in it. Not used for tuning: score it once as it stands and record the number.
// Usage: node tests/voice-heldout-2.mjs   (run from the repo folder)
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..');

const SHOP = {
  customers: [
    { id: 101, name: 'Ramesh Patil' }, { id: 102, name: 'Sunita Devi' }, { id: 103, name: 'Kamal Shah' },
    { id: 104, name: 'Mohan Joshi' }, { id: 105, name: 'Gita' }
  ],
  products: [
    { id: 1, name: 'Atta 10kg', price: 40, cost: 30, stock: 50 },
    { id: 2, name: 'Sugar', price: 45, cost: 38, stock: 50 },
    { id: 3, name: 'Tea', price: 120, cost: 100, stock: 50 },
    { id: 4, name: 'Milk', price: 30, cost: 25, stock: 50 },
    { id: 5, name: 'Biscuits', price: 10, cost: 8, stock: 50 },
    { id: 6, name: 'Oil', price: 150, cost: 130, stock: 50 },
    { id: 7, name: 'Soap', price: 35, cost: 28, stock: 50 },
    { id: 8, name: 'Rice', price: 60, cost: 52, stock: 50 },
    { id: 9, name: 'Dal', price: 110, cost: 95, stock: 50 },
    { id: 10, name: 'Salt', price: 20, cost: 15, stock: 50 },
    { id: 11, name: 'Onion', price: 30, cost: 22, stock: 50 },
    { id: 12, name: 'Potato', price: 25, cost: 18, stock: 50 },
    { id: 13, name: 'Ghee', price: 500, cost: 450, stock: 50 }
  ]
};

const C = [
  // Marathi
  { l: 'mr', t: 'कांदे तीन किलो', intent: 'sale', lines: [[11, 3]] },
  { l: 'mr', t: 'बटाटे दोन किलो', intent: 'sale', lines: [[12, 2]] },
  { l: 'mr', t: 'मिठ दोन पाकीट', intent: 'sale', lines: [[10, 2]] },
  { l: 'mr', t: 'सुनिताचे तीन लिटर दूध उधार', intent: 'udhar', lines: [[4, 3]], party: 102, method: 'udhar' },
  { l: 'mr', t: 'रमेश ला दस किलो आटा', intent: 'sale', lines: [[1, 10]], party: 101 },
  { l: 'mr', t: 'मोहन ला दोन पुडे बिस्किट उधार', intent: 'udhar', lines: [[5, 2]], party: 104, method: 'udhar' },
  { l: 'mr', t: 'कमल ने दोनशे रुपये दिले', intent: 'payment', lines: [], party: 103, amount: 200 },
  { l: 'mr', t: 'दोन लिटर तेल आणि एक साबण', intent: 'sale', lines: [[6, 2], [7, 1]] },
  // Hindi
  { l: 'hi', t: 'रमेश जी को चार किलो चावल उधार', intent: 'udhar', lines: [[8, 4]], party: 101, method: 'udhar' },
  { l: 'hi', t: 'दस किलो आटा', intent: 'sale', lines: [[1, 10]] },
  { l: 'hi', t: 'मोहन को पांच बिस्कुट', intent: 'sale', lines: [[5, 5]], party: 104 },
  { l: 'hi', t: 'दूध एक लीटर और चीनी आधा किलो', intent: 'sale', lines: [[4, 1], [2, 0.5]] },
  { l: 'hi', t: 'प्याज़ पांच किलो', intent: 'sale', lines: [[11, 5]] },
  { l: 'hi', t: 'दो सौ रुपये का तेल', intent: 'sale', lines: [[6, 1]], amount: 200 },
  { l: 'hi', t: 'सात साबुन कमल को उधार', intent: 'udhar', lines: [[7, 7]], party: 103, method: 'udhar' },
  // Gujarati
  { l: 'gu', t: 'રમેશ ભાઈ ને ત્રણ કિલો ખાંડ ઉધાર', intent: 'udhar', lines: [[2, 3]], party: 101, method: 'udhar' },
  { l: 'gu', t: 'લોટ દસ કિલો', intent: 'sale', lines: [[1, 10]] },
  { l: 'gu', t: 'ચા બે પેકેટ', intent: 'sale', lines: [[3, 2]] },
  { l: 'gu', t: 'મીઠું બે કિલો અને તેલ એક લિટર', intent: 'sale', lines: [[10, 2], [6, 1]] },
  { l: 'gu', t: 'મોહન ને દાળ બે કિલો', intent: 'sale', lines: [[9, 2]], party: 104 },
  { l: 'gu', t: 'બટાકા પાંચ કિલો', intent: 'sale', lines: [[12, 5]] },
  // English and Hinglish
  { l: 'en', t: 'Kamal ko 3 soap aur 1 ghee udhar likh do', intent: 'udhar', lines: [[7, 3], [13, 1]], party: 103, method: 'udhar' },
  { l: 'en', t: 'biscuit five packet', intent: 'sale', lines: [[5, 5]] },
  { l: 'en', t: 'Mohan paid 250 rupees', intent: 'payment', lines: [], party: 104, amount: 250 },
  { l: 'en', t: 'stock add 20 kg rice', intent: 'stock_in', lines: [[8, 20]] },
  { l: 'en', t: 'one dal Ramesh udhar', intent: 'udhar', lines: [[9, 1]], party: 101, method: 'udhar' },
  { l: 'en', t: 'thik hai', intent: 'none', lines: [] }
];

function loadParser(file) {
  const sandbox = { window: {} };
  sandbox.window.BGV2 = { S: JSON.parse(JSON.stringify(SHOP)) };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox);
  return sandbox.window.BGV2.parse;
}

function judge(c, parse) {
  const p = parse(c.t);
  const miss = [];
  const want = c.lines.map(([id, q]) => id + ':' + q).sort().join(' ');
  const got = p.lines.map(l => l.product_id + ':' + l.qty).sort().join(' ');
  if (want !== got) miss.push('items');
  if (p.intent !== c.intent) miss.push('meaning');
  if (c.party !== undefined) {
    const one = p.party && p.party.status === 'one' ? p.party.customer.id : 0;
    if (one !== c.party) miss.push('customer');
  }
  if (c.method !== undefined && p.method !== c.method) miss.push('method');
  if (c.amount !== undefined && p.amount !== c.amount) miss.push('amount');
  return { ok: miss.length === 0, miss, p };
}

const parse = loadParser(path.join(repo, 'v2', 'assets', 'v2-parse.js'));
const fails = [];
const tally = {};
for (const c of C) {
  const r = judge(c, parse);
  const t = tally[c.l] || (tally[c.l] = { n: 0, ok: 0 });
  t.n++; if (r.ok) t.ok++; else fails.push({ c, miss: r.miss, p: r.p });
}
console.log('== voice held-out set 2: ' + C.length + ' phrases (not used for tuning)');
for (const l of Object.keys(tally)) console.log(l.padEnd(4) + ' n=' + tally[l].n + '  pass ' + tally[l].ok);
for (const f of fails) console.log('  MISS [' + f.c.l + '] ' + f.c.t + ' -> ' + f.miss.join(', '));
console.log('== voice-heldout-2: PASS=' + (C.length - fails.length) + ' FAIL=' + fails.length);
process.exit(fails.length <= C.length / 4 ? 0 : 1);
