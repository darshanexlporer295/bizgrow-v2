// Held-out voice check: phrases in Marathi, Hindi and Gujarati (plus a few English and Hinglish lines) that were
// written as a separate set and were NOT used to tune the parser. Run it as it is, once, before any parser change,
// and record the number. Later sets (voice-heldout-2.mjs) follow the same rule.
// Usage: node tests/voice-heldout.mjs   (run from the repo folder; exits 1 if the parser fails more than 1 in 4)
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..');

// Same shop as tests/voice-accuracy.mjs.
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

// Same fields as the main corpus: t = what was said, intent, lines = [[item id, qty]], party, method, amount.
const C = [
  // Marathi
  { l: 'mr', t: 'दोन किलो साखर', intent: 'sale', lines: [[2, 2]] },
  { l: 'mr', t: 'रमेश ला दोन किलो आटा उधार', intent: 'udhar', lines: [[1, 2]], party: 101, method: 'udhar' },
  { l: 'mr', t: 'सुनीता ची तीन चहा उधार', intent: 'udhar', lines: [[3, 3]], party: 102, method: 'udhar' },
  { l: 'mr', t: 'पाच लिटर दूध', intent: 'sale', lines: [[4, 5]] },
  { l: 'mr', t: 'एक किलो कांदा आणि दोन बटाटा', intent: 'sale', lines: [[11, 1], [12, 2]] },
  { l: 'mr', t: 'तेल एक लिटर', intent: 'sale', lines: [[6, 1]] },
  { l: 'mr', t: 'मीठ दोन पॅकेट', intent: 'sale', lines: [[10, 2]] },
  { l: 'mr', t: 'डाळ दोन किलो', intent: 'sale', lines: [[9, 2]] },
  { l: 'mr', t: 'मोहन ला तीन साबण उधार', intent: 'udhar', lines: [[7, 3]], party: 104, method: 'udhar' },
  { l: 'mr', t: 'साखर एक किलो आणि चहा दोन', intent: 'sale', lines: [[2, 1], [3, 2]] },
  { l: 'mr', t: 'गीता साठी दोन लिटर तेल उधार', intent: 'udhar', lines: [[6, 2]], party: 105, method: 'udhar' },
  { l: 'mr', t: 'रमेश ने 500 रुपये दिले', intent: 'payment', lines: [], party: 101, amount: 500 },
  { l: 'mr', t: 'बिस्कीट पाच', intent: 'sale', lines: [[5, 5]] },
  { l: 'mr', t: 'तांदूळ तीन किलो', intent: 'sale', lines: [[8, 3]] },
  { l: 'mr', t: 'कमल शाह ला दोन साबण', intent: 'sale', lines: [[7, 2]], party: 103 },
  // Hindi
  { l: 'hi', t: 'मोहन के लिए दो किलो चीनी उधार', intent: 'udhar', lines: [[2, 2]], party: 104, method: 'udhar' },
  { l: 'hi', t: 'तीन किलो प्याज और दो किलो आलू', intent: 'sale', lines: [[11, 3], [12, 2]] },
  { l: 'hi', t: 'एक पैकेट नमक', intent: 'sale', lines: [[10, 1]] },
  { l: 'hi', t: 'सुनीता को दो साबुन उधार लिख दो', intent: 'udhar', lines: [[7, 2]], party: 102, method: 'udhar' },
  { l: 'hi', t: 'दो लीटर तेल', intent: 'sale', lines: [[6, 2]] },
  { l: 'hi', t: 'चावल दो किलो', intent: 'sale', lines: [[8, 2]] },
  { l: 'hi', t: 'रमेश ने तीन सौ रुपये जमा किए', intent: 'payment', lines: [], party: 101, amount: 300 },
  { l: 'hi', t: 'दाल पांच किलो', intent: 'sale', lines: [[9, 5]] },
  { l: 'hi', t: 'एक चाय और दो बिस्कुट', intent: 'sale', lines: [[3, 1], [5, 2]] },
  { l: 'hi', t: 'कमल को पचास रुपये जमा', intent: 'payment', lines: [], party: 103, amount: 50 },
  // Gujarati
  { l: 'gu', t: 'બે કિલો ખાંડ', intent: 'sale', lines: [[2, 2]] },
  { l: 'gu', t: 'રમેશ ને એક કિલો લોટ ઉધાર', intent: 'udhar', lines: [[1, 1]], party: 101, method: 'udhar' },
  { l: 'gu', t: 'ગીતા ને ત્રણ ચા ઉધાર', intent: 'udhar', lines: [[3, 3]], party: 105, method: 'udhar' },
  { l: 'gu', t: 'દૂધ ત્રણ લિટર', intent: 'sale', lines: [[4, 3]] },
  { l: 'gu', t: 'ડુંગળી બે કિલો અને બટાકા એક કિલો', intent: 'sale', lines: [[11, 2], [12, 1]] },
  { l: 'gu', t: 'મીઠું એક પેકેટ', intent: 'sale', lines: [[10, 1]] },
  { l: 'gu', t: 'સાબુ બે', intent: 'sale', lines: [[7, 2]] },
  { l: 'gu', t: 'દાળ પાંચ કિલો', intent: 'sale', lines: [[9, 5]] },
  { l: 'gu', t: 'ઘી અડધો કિલો', intent: 'sale', lines: [[13, 0.5]] },
  { l: 'gu', t: 'સુનીતા ને બે બિસ્કિટ ઉધાર', intent: 'udhar', lines: [[5, 2]], party: 102, method: 'udhar' },
  // English and Hinglish
  { l: 'en', t: 'two kilo rice for Sunita on credit', intent: 'udhar', lines: [[8, 2]], party: 102, method: 'udhar' },
  { l: 'en', t: 'Ramesh paid 300 cash', intent: 'payment', lines: [], party: 101, amount: 300 },
  { l: 'en', t: 'Gita ko 2 dudh udhar', intent: 'udhar', lines: [[4, 2]], party: 105, method: 'udhar' },
  { l: 'en', t: 'sugar four kilo', intent: 'sale', lines: [[2, 4]] }
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
console.log('== voice held-out set: ' + C.length + ' phrases (not used for tuning)');
for (const l of Object.keys(tally)) console.log(l.padEnd(4) + ' n=' + tally[l].n + '  pass ' + tally[l].ok);
for (const f of fails) console.log('  MISS [' + f.c.l + '] ' + f.c.t + ' -> ' + f.miss.join(', '));
const pass = C.length - fails.length;
console.log('== voice-heldout: PASS=' + pass + ' FAIL=' + fails.length);
process.exit(fails.length <= C.length / 4 ? 0 : 1);
