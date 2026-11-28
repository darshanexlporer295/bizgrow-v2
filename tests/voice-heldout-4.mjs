// Held-out voice check, fourth set. Written after set 3 was scored and after its one miss was seen, so set 3 is no
// longer clean. These phrases were written before any change to the parser for this round. Run once as it stands;
// do not edit the phrases to make them pass. Mixes half amounts, 'two-two' lists, payment words, UPI and cash, stock
// lines, Hinglish, and lines with no order.
// Usage: node tests/voice-heldout-4.mjs   (run from the repo folder)
// measure for this round. Run once as it stands; do not edit the phrases to make them pass. Phrases cover half
// and quarter amounts, spoken mis-hearings, plural and possessive forms, payments, stock and no-order lines.
// Usage: node tests/voice-heldout-4.mjs   (run from the repo folder)
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
  { l: 'mr', t: 'रमेश ला पाच साबण', intent: 'sale', lines: [[7, 5]], party: 101 },
  { l: 'mr', t: 'दीड लिटर दूध', intent: 'sale', lines: [[4, 1.5]] },
  { l: 'mr', t: 'मोहनकडून दोनशे रुपये जमा झाले', intent: 'payment', lines: [], party: 104, amount: 200 },
  { l: 'mr', t: 'दोन पॅकेट बिस्किट उधार कमल', intent: 'udhar', lines: [[5, 2]], party: 103, method: 'udhar' },
  { l: 'mr', t: 'तांदूळ दहा किलो स्टॉकमध्ये टाका', intent: 'stock_in', lines: [[8, 10]] },
  { l: 'mr', t: 'आज काही विकले नाही', intent: 'none', lines: [] },
  // Hindi
  { l: 'hi', t: 'मोहन ने ढाई सौ दिए', intent: 'payment', lines: [], party: 104, amount: 250 },
  { l: 'hi', t: 'दो किलो चावल और एक चीनी', intent: 'sale', lines: [[8, 2], [2, 1]] },
  { l: 'hi', t: 'गीता को एक साबुन उधार', intent: 'udhar', lines: [[7, 1]], party: 105, method: 'udhar' },
  { l: 'hi', t: 'रमेश के लिए तीन चाय', intent: 'sale', lines: [[3, 3]], party: 101 },
  { l: 'hi', t: 'नया माल आया बीस नमक', intent: 'stock_in', lines: [[10, 20]] },
  // Gujarati
  { l: 'gu', t: 'તેલ બે લિટર', intent: 'sale', lines: [[6, 2]] },
  { l: 'gu', t: 'સુનીતા ને બે કિલો ખાંડ ઉધાર', intent: 'udhar', lines: [[2, 2]], party: 102, method: 'udhar' },
  { l: 'gu', t: 'રમેશ એ સો રૂપિયા ભર્યા', intent: 'payment', lines: [], party: 101, amount: 100 },
  { l: 'gu', t: 'સાબુ અને બિસ્કિટ બે બે', intent: 'sale', lines: [[7, 2], [5, 2]] },
  { l: 'gu', t: 'કમલ શાહ ને પચાસ રૂપિયા જમા', intent: 'payment', lines: [], party: 103, amount: 50 },
  // English and Hinglish
  { l: 'en', t: 'Mohan ka ek ghee udhar', intent: 'udhar', lines: [[13, 1]], party: 104, method: 'udhar' },
  { l: 'en', t: 'two oil one salt', intent: 'sale', lines: [[6, 2], [10, 1]] },
  { l: 'en', t: 'Gita paid 80 upi', intent: 'payment', lines: [], party: 105, amount: 80, method: 'upi' },
  { l: 'en', t: 'stock mein dal 5 kilo add karo', intent: 'stock_in', lines: [[9, 5]] },
  { l: 'en', t: 'just say hello to everyone', intent: 'none', lines: [] }
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
console.log('== voice held-out set 4: ' + C.length + ' phrases (clean: not used for tuning)');
for (const l of Object.keys(tally)) console.log(l.padEnd(4) + ' n=' + tally[l].n + '  pass ' + tally[l].ok);
for (const f of fails) console.log('  MISS [' + f.c.l + '] ' + f.c.t + ' -> ' + f.miss.join(', '));
console.log('== voice-heldout-4: PASS=' + (C.length - fails.length) + ' FAIL=' + fails.length);
process.exit(fails.length <= C.length / 4 ? 0 : 1);
