// Held-out voice check, third set. Written after sets 1 and 2 were used to fix the parser, so it is the clean
// measure for this round. Run once as it stands; do not edit the phrases to make them pass. Phrases cover half
// and quarter amounts, spoken mis-hearings, plural and possessive forms, payments, stock and no-order lines.
// Usage: node tests/voice-heldout-3.mjs   (run from the repo folder)
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
  { l: 'mr', t: 'अडीच किलो साखर', intent: 'sale', lines: [[2, 2.5]] },
  { l: 'mr', t: 'दीड किलो तांदूळ', intent: 'sale', lines: [[8, 1.5]] },
  { l: 'mr', t: 'सुनीताला एक तेल उधार', intent: 'udhar', lines: [[6, 1]], party: 102, method: 'udhar' },
  { l: 'mr', t: 'कांद्या दोन किलो', intent: 'sale', lines: [[11, 2]] },
  { l: 'mr', t: 'कमल शाह कडून तीनशे रुपये जमा', intent: 'payment', lines: [], party: 103, amount: 300 },
  { l: 'mr', t: 'गीता ला चार लिटर दूध उधार', intent: 'udhar', lines: [[4, 4]], party: 105, method: 'udhar' },
  { l: 'mr', t: 'मीठ आणि साखर प्रत्येकी एक', intent: 'sale', lines: [[10, 1], [2, 1]] },
  { l: 'mr', t: 'मोहन जोशी ला पाच किलो डाळ', intent: 'sale', lines: [[9, 5]], party: 104 },
  // Hindi
  { l: 'hi', t: 'रमेश को सात सौ रुपये जमा किए', intent: 'payment', lines: [], party: 101, amount: 700 },
  { l: 'hi', t: 'पाव किलो घी', intent: 'sale', lines: [[13, 0.25]] },
  { l: 'hi', t: 'ढाई किलो चीनी उधार सुनीता', intent: 'udhar', lines: [[2, 2.5]], party: 102, method: 'udhar' },
  { l: 'hi', t: 'बिस्किट चार पैकेट और साबुन दो', intent: 'sale', lines: [[5, 4], [7, 2]] },
  { l: 'hi', t: 'कमल के लिए नमक तीन', intent: 'sale', lines: [[10, 3]], party: 103 },
  { l: 'hi', t: 'आलू बारह किलो', intent: 'sale', lines: [[12, 12]] },
  { l: 'hi', t: 'गीता को तेल एक उधार', intent: 'udhar', lines: [[6, 1]], party: 105, method: 'udhar' },
  { l: 'hi', t: 'स्टॉक में पांच किलो चावल डालो', intent: 'stock_in', lines: [[8, 5]] },
  // Gujarati
  { l: 'gu', t: 'કમલ શાહ ને દોઢ કિલો ઘી ઉધાર', intent: 'udhar', lines: [[13, 1.5]], party: 103, method: 'udhar' },
  { l: 'gu', t: 'ખાંડ અઢી કિલો', intent: 'sale', lines: [[2, 2.5]] },
  { l: 'gu', t: 'બટાકા અને ડુંગળી ત્રણ ત્રણ', intent: 'sale', lines: [[12, 3], [11, 3]] },
  { l: 'gu', t: 'મોહન જોશી ને પાંચસો રૂપિયા આપ્યા', intent: 'payment', lines: [], party: 104, amount: 500 },
  { l: 'gu', t: 'દાળ એક કિલો રમેશ ઉધાર', intent: 'udhar', lines: [[9, 1]], party: 101, method: 'udhar' },
  { l: 'gu', t: 'સાબુ છ', intent: 'sale', lines: [[7, 6]] },
  // English and Hinglish
  { l: 'en', t: 'Sunita ka 2 kilo atta udhar', intent: 'udhar', lines: [[1, 2]], party: 102, method: 'udhar' },
  { l: 'en', t: 'half kilo ghee for Kamal', intent: 'sale', lines: [[13, 0.5]], party: 103 },
  { l: 'en', t: 'Gita paid 150 cash', intent: 'payment', lines: [], party: 105, amount: 150 },
  { l: 'en', t: 'three oil and four soap', intent: 'sale', lines: [[6, 3], [7, 4]] },
  { l: 'en', t: 'add 12 packets biscuit to stock', intent: 'stock_in', lines: [[5, 12]] },
  { l: 'en', t: 'namaste kaise ho', intent: 'none', lines: [] },
  { l: 'en', t: 'Ramesh udhar 2 milk and 1 tea', intent: 'udhar', lines: [[4, 2], [3, 1]], party: 101, method: 'udhar' }
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
console.log('== voice held-out set 3: ' + C.length + ' phrases (clean: not used for tuning)');
for (const l of Object.keys(tally)) console.log(l.padEnd(4) + ' n=' + tally[l].n + '  pass ' + tally[l].ok);
for (const f of fails) console.log('  MISS [' + f.c.l + '] ' + f.c.t + ' -> ' + f.miss.join(', '));
console.log('== voice-heldout-3: PASS=' + (C.length - fails.length) + ' FAIL=' + fails.length);
process.exit(fails.length <= C.length / 4 ? 0 : 1);
