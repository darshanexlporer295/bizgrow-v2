// Voice accuracy check (no browser, no network, no paid service).
// Runs a built-in corpus of realistic spoken or typed bill phrases in Hindi, Marathi, Gujarati and English
// through the parser, and compares the result with the expected meaning. The same corpus is run through the
// parser as it was before the upgrade (tests/voice-baseline/v2-parse-before.js) so the report shows before and after.
// Usage: node tests/voice-accuracy.mjs   (run from the repo folder; prints the report; exits 1 if the corpus is
// too small or the new parser fails more than 1 in 5 phrases)
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..');

// Shop used by the test: six customers and thirteen items. Names are in the shop's spelling.
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

// Each entry: l = language, t = what was said, intent = expected meaning, lines = [[item id, quantity]],
// party = expected customer id (or 0 for "no single customer"), method, amount = expected numbers when given.
const C = [
  // ---------- Hindi (hi) ----------
  { l: 'hi', t: '2 किलो आटा', intent: 'sale', lines: [[1, 2]] },
  { l: 'hi', t: 'पांच चीनी', intent: 'sale', lines: [[2, 5]] },
  { l: 'hi', t: 'चाय 3 रुपये', intent: 'sale', lines: [[3, 1]], amount: 3 },
  { l: 'hi', t: 'एक दूध और दो बिस्किट', intent: 'sale', lines: [[4, 1], [5, 2]] },
  { l: 'hi', t: 'दो तेल', intent: 'sale', lines: [[6, 2]] },
  { l: 'hi', t: 'तीन साबुन', intent: 'sale', lines: [[7, 3]] },
  { l: 'hi', t: 'चार किलो चावल', intent: 'sale', lines: [[8, 4]] },
  { l: 'hi', t: 'एक किलो दाल', intent: 'sale', lines: [[9, 1]] },
  { l: 'hi', t: 'आधा किलो घी', intent: 'sale', lines: [[13, 0.5]] },
  { l: 'hi', t: 'नमक दो पैकेट', intent: 'sale', lines: [[10, 2]] },
  { l: 'hi', t: 'दस रुपये का नमक', intent: 'sale', lines: [[10, 1]], amount: 10 },
  { l: 'hi', t: 'बीस रुपये का नमक', intent: 'sale', lines: [[10, 1]], amount: 20 },
  { l: 'hi', t: 'एक किलो आलू और दो किलो प्याज', intent: 'sale', lines: [[12, 1], [11, 2]] },
  { l: 'hi', t: 'दो चाय, एक बिस्किट', intent: 'sale', lines: [[3, 2], [5, 1]] },
  { l: 'hi', t: 'चाय दो पैकेट', intent: 'sale', lines: [[3, 2]] },
  { l: 'hi', t: 'दूध दो लीटर', intent: 'sale', lines: [[4, 2]] },
  { l: 'hi', t: 'चावल पांच किलो', intent: 'sale', lines: [[8, 5]] },
  { l: 'hi', t: 'आलू चार किलो', intent: 'sale', lines: [[12, 4]] },
  { l: 'hi', t: 'सात साबुन', intent: 'sale', lines: [[7, 7]] },
  { l: 'hi', t: 'आठ दूध', intent: 'sale', lines: [[4, 8]] },
  { l: 'hi', t: 'नौ चाय', intent: 'sale', lines: [[3, 9]] },
  { l: 'hi', t: 'रमेश को 2 किलो आटा, 50 रुपये उधार', intent: 'udhar', lines: [[1, 2]], party: 101, method: 'udhar', amount: 50 },
  { l: 'hi', t: 'सुनीता को तीन चाय उधार', intent: 'udhar', lines: [[3, 3]], party: 102, method: 'udhar' },
  { l: 'hi', t: 'कमल के लिए एक दूध उधार लिखो', intent: 'udhar', lines: [[4, 1]], party: 103, method: 'udhar' },
  { l: 'hi', t: 'मोहन को दो किलो चीनी उधार', intent: 'udhar', lines: [[2, 2]], party: 104, method: 'udhar' },
  { l: 'hi', t: 'गीता को एक तेल और दो साबुन उधार', intent: 'udhar', lines: [[6, 1], [7, 2]], party: 105, method: 'udhar' },
  { l: 'hi', t: 'मोहन की उधारी में दो चाय', intent: 'udhar', lines: [[3, 2]], party: 104, method: 'udhar' },
  { l: 'hi', t: 'उधार में मोहन को दो किलो आटा', intent: 'udhar', lines: [[1, 2]], party: 104, method: 'udhar' },
  { l: 'hi', t: 'कमल को तीन साबुन और एक नमक उधार', intent: 'udhar', lines: [[7, 3], [10, 1]], party: 103, method: 'udhar' },
  { l: 'hi', t: 'रमेश ने पांच सौ रुपये जमा किए', intent: 'payment', lines: [], party: 101, amount: 500 },
  { l: 'hi', t: 'सुनीता ने 200 जमा किए', intent: 'payment', lines: [], party: 102, amount: 200 },
  { l: 'hi', t: 'मोहन ने पैसे भरले', intent: 'payment', lines: [], party: 104 },
  { l: 'hi', t: 'कमल का उधार 300 रुपये जमा', intent: 'payment', lines: [], party: 103, amount: 300 },
  { l: 'hi', t: 'स्टॉक में दस किलो चीनी जोड़ो', intent: 'stock_in', lines: [[2, 10]] },
  { l: 'hi', t: 'माल आया पांच किलो आटा', intent: 'stock_in', lines: [[1, 5]] },
  { l: 'hi', t: 'दो लीटर तेल स्टॉक में', intent: 'stock_in', lines: [[6, 2]] },
  { l: 'hi', t: 'रमेश को एक किलो शक्कर उधार', intent: 'udhar', lines: [[2, 1]], party: 101, method: 'udhar' },
  { l: 'hi', t: 'सुनीता को चावल पांच किलो उधार', intent: 'udhar', lines: [[8, 5]], party: 102, method: 'udhar' },
  { l: 'hi', t: 'सुनीता ने दो किलो आटा लिया', intent: 'sale', lines: [[1, 2]], party: 102 },
  { l: 'hi', t: 'रमेश के नाम पर तीन चाय', intent: 'sale', lines: [[3, 3]], party: 101 },
  { l: 'hi', t: 'ये बिल सेव करो', intent: 'none', lines: [] },

  // ---------- Marathi (mr) ----------
  { l: 'mr', t: 'दोन किलो पीठ', intent: 'sale', lines: [[1, 2]] },
  { l: 'mr', t: 'पाच किलो साखर', intent: 'sale', lines: [[2, 5]] },
  { l: 'mr', t: 'एक चहा आणि दोन बिस्कीट', intent: 'sale', lines: [[3, 1], [5, 2]] },
  { l: 'mr', t: 'तीन दूध', intent: 'sale', lines: [[4, 3]] },
  { l: 'mr', t: 'दोन लीटर तेल', intent: 'sale', lines: [[6, 2]] },
  { l: 'mr', t: 'चार साबण', intent: 'sale', lines: [[7, 4]] },
  { l: 'mr', t: 'पाच किलो तांदूळ', intent: 'sale', lines: [[8, 5]] },
  { l: 'mr', t: 'एक किलो डाळ', intent: 'sale', lines: [[9, 1]] },
  { l: 'mr', t: 'अर्धा किलो तूप', intent: 'sale', lines: [[13, 0.5]] },
  { l: 'mr', t: 'सहा मीठ', intent: 'sale', lines: [[10, 6]] },
  { l: 'mr', t: 'दोन किलो कांदा', intent: 'sale', lines: [[11, 2]] },
  { l: 'mr', t: 'तीन किलो बटाटा', intent: 'sale', lines: [[12, 3]] },
  { l: 'mr', t: 'सात साबण', intent: 'sale', lines: [[7, 7]] },
  { l: 'mr', t: 'आठ दूध', intent: 'sale', lines: [[4, 8]] },
  { l: 'mr', t: 'नऊ चहा', intent: 'sale', lines: [[3, 9]] },
  { l: 'mr', t: 'दहा रुपये चे मीठ', intent: 'sale', lines: [[10, 1]], amount: 10 },
  { l: 'mr', t: 'वीस रुपयांचे बिस्कीट', intent: 'sale', lines: [[5, 1]], amount: 20 },
  { l: 'mr', t: 'एक किलो आलू आणि दोन किलो कांदा', intent: 'sale', lines: [[12, 1], [11, 2]] },
  { l: 'mr', t: 'चहा दोन पुडे', intent: 'sale', lines: [[3, 2]] },
  { l: 'mr', t: 'सुनीता ला अडीच किलो साखर', intent: 'sale', lines: [[2, 2.5]], party: 102 },
  { l: 'mr', t: 'मोहन ला दीड किलो आटा उधार', intent: 'udhar', lines: [[1, 1.5]], party: 104, method: 'udhar' },
  { l: 'mr', t: 'रमेश ला दोन किलो पीठ उधार', intent: 'udhar', lines: [[1, 2]], party: 101, method: 'udhar' },
  { l: 'mr', t: 'सुनीता ला तीन चहा उधार', intent: 'udhar', lines: [[3, 3]], party: 102, method: 'udhar' },
  { l: 'mr', t: 'कमल ला एक दूध आणि दोन साबण उधार', intent: 'udhar', lines: [[4, 1], [7, 2]], party: 103, method: 'udhar' },
  { l: 'mr', t: 'मोहन ची उधारी दोन किलो साखर', intent: 'udhar', lines: [[2, 2]], party: 104, method: 'udhar' },
  { l: 'mr', t: 'गीता कडे एक तेल उधार', intent: 'udhar', lines: [[6, 1]], party: 105, method: 'udhar' },
  { l: 'mr', t: 'गीता चा उधार तांदूळ पाच किलो', intent: 'udhar', lines: [[8, 5]], party: 105, method: 'udhar' },
  { l: 'mr', t: 'रमेश ने पाच सौ रुपये जमा केले', intent: 'payment', lines: [], party: 101, amount: 500 },
  { l: 'mr', t: 'सुनीता ने दोन सौ रुपये दिले', intent: 'payment', lines: [], party: 102, amount: 200 },
  { l: 'mr', t: 'मोहन ने पैसे भरले', intent: 'payment', lines: [], party: 104 },
  { l: 'mr', t: 'कमल ची उधार पन्नास रुपये जमा', intent: 'payment', lines: [], party: 103, amount: 50 },
  { l: 'mr', t: 'स्टॉक मध्ये दहा किलो साखर', intent: 'stock_in', lines: [[2, 10]] },
  { l: 'mr', t: 'माल आला पाच किलो पीठ', intent: 'stock_in', lines: [[1, 5]] },
  { l: 'mr', t: 'दोन लीटर तेल स्टॉक', intent: 'stock_in', lines: [[6, 2]] },
  { l: 'mr', t: 'रमेश ला सहा पुडे बिस्कीट', intent: 'sale', lines: [[5, 6]], party: 101 },
  { l: 'mr', t: 'पन्नास रुपये तेल उधार', intent: 'udhar', lines: [[6, 1]], party: 0, method: 'udhar', amount: 50 },
  { l: 'mr', t: 'कोणतेही बिल नाही', intent: 'none', lines: [] },

  // ---------- Gujarati (gu) ----------
  { l: 'gu', t: 'બે કિલો લોટ', intent: 'sale', lines: [[1, 2]] },
  { l: 'gu', t: 'પાંચ ખાંડ', intent: 'sale', lines: [[2, 5]] },
  { l: 'gu', t: 'એક ચા અને બે બિસ્કિટ', intent: 'sale', lines: [[3, 1], [5, 2]] },
  { l: 'gu', t: 'ત્રણ દૂધ', intent: 'sale', lines: [[4, 3]] },
  { l: 'gu', t: 'બે લીટર તેલ', intent: 'sale', lines: [[6, 2]] },
  { l: 'gu', t: 'ચાર સાબુ', intent: 'sale', lines: [[7, 4]] },
  { l: 'gu', t: 'પાંચ કિલો ચોખા', intent: 'sale', lines: [[8, 5]] },
  { l: 'gu', t: 'એક કિલો દાળ', intent: 'sale', lines: [[9, 1]] },
  { l: 'gu', t: 'અડધો કિલો ઘી', intent: 'sale', lines: [[13, 0.5]] },
  { l: 'gu', t: 'છ મીઠું', intent: 'sale', lines: [[10, 6]] },
  { l: 'gu', t: 'બે કિલો ડુંગળી', intent: 'sale', lines: [[11, 2]] },
  { l: 'gu', t: 'ત્રણ કિલો બટાકા', intent: 'sale', lines: [[12, 3]] },
  { l: 'gu', t: 'સાત સાબુ', intent: 'sale', lines: [[7, 7]] },
  { l: 'gu', t: 'આઠ દૂધ', intent: 'sale', lines: [[4, 8]] },
  { l: 'gu', t: 'નવ ચા', intent: 'sale', lines: [[3, 9]] },
  { l: 'gu', t: 'વીસ રૂપિયા ની બિસ્કિટ', intent: 'sale', lines: [[5, 1]], amount: 20 },
  { l: 'gu', t: 'એક કિલો બટાકા અને બે કિલો ડુંગળી', intent: 'sale', lines: [[12, 1], [11, 2]] },
  { l: 'gu', t: 'ચા બે પેકેટ', intent: 'sale', lines: [[3, 2]] },
  { l: 'gu', t: 'દોઢ કિલો ખાંડ', intent: 'sale', lines: [[2, 1.5]] },
  { l: 'gu', t: 'અઢી કિલો ચોખા', intent: 'sale', lines: [[8, 2.5]] },
  { l: 'gu', t: 'રમેશ ને બે કિલો લોટ ઉધાર', intent: 'udhar', lines: [[1, 2]], party: 101, method: 'udhar' },
  { l: 'gu', t: 'સુનિતા ને ત્રણ ચા ઉધાર', intent: 'udhar', lines: [[3, 3]], party: 102, method: 'udhar' },
  { l: 'gu', t: 'કમલ માટે એક દૂધ અને બે સાબુ ઉધાર', intent: 'udhar', lines: [[4, 1], [7, 2]], party: 103, method: 'udhar' },
  { l: 'gu', t: 'મોહન ની ઉધારી બે ખાંડ', intent: 'udhar', lines: [[2, 2]], party: 104, method: 'udhar' },
  { l: 'gu', t: 'ગીતા ના નામે એક તેલ ઉધાર', intent: 'udhar', lines: [[6, 1]], party: 105, method: 'udhar' },
  { l: 'gu', t: 'મોહન ને ત્રણ ઘી ઉધાર', intent: 'udhar', lines: [[13, 3]], party: 104, method: 'udhar' },
  { l: 'gu', t: 'રમેશે પાંચ સો રૂપિયા જમા કર્યા', intent: 'payment', lines: [], party: 101, amount: 500 },
  { l: 'gu', t: 'સુનિતા એ બે સો રૂપિયા ચૂકવ્યા', intent: 'payment', lines: [], party: 102, amount: 200 },
  { l: 'gu', t: 'મોહન એ પૈસા ચૂકવ્યા', intent: 'payment', lines: [], party: 104 },
  { l: 'gu', t: 'કમલ ની બાકી પચાસ રૂપિયા જમા', intent: 'payment', lines: [], party: 103, amount: 50 },
  { l: 'gu', t: 'સ્ટોક માં દસ કિલો ખાંડ ઉમેરો', intent: 'stock_in', lines: [[2, 10]] },
  { l: 'gu', t: 'માલ આવ્યો પાંચ કિલો લોટ', intent: 'stock_in', lines: [[1, 5]] },
  { l: 'gu', t: 'બે લીટર તેલ સ્ટોક', intent: 'stock_in', lines: [[6, 2]] },
  { l: 'gu', t: 'રમેશ ને દસ રૂપિયા નું મીઠું', intent: 'sale', lines: [[10, 1]], party: 101, amount: 10 },
  { l: 'gu', t: 'એક દાળ બે મીઠું', intent: 'sale', lines: [[9, 1], [10, 2]] },
  { l: 'gu', t: 'કમલ નો એક લોટ', intent: 'sale', lines: [[1, 1]], party: 103 },
  { l: 'gu', t: 'પચાસ રૂપિયા ઉધાર ગીતા માટે ત્રણ ચા', intent: 'udhar', lines: [[3, 3]], party: 105, method: 'udhar', amount: 50 },
  { l: 'gu', t: 'સુનિતા ને બે કિલો ખાંડ', intent: 'sale', lines: [[2, 2]], party: 102 },
  { l: 'gu', t: 'બિલ બનાવો', intent: 'none', lines: [] },

  // ---------- English and Hinglish (en) ----------
  { l: 'en', t: '2 kg atta', intent: 'sale', lines: [[1, 2]] },
  { l: 'en', t: 'five sugar', intent: 'sale', lines: [[2, 5]] },
  { l: 'en', t: 'one tea and two biscuits', intent: 'sale', lines: [[3, 1], [5, 2]] },
  { l: 'en', t: 'three milk', intent: 'sale', lines: [[4, 3]] },
  { l: 'en', t: 'two liter oil', intent: 'sale', lines: [[6, 2]] },
  { l: 'en', t: 'four soap', intent: 'sale', lines: [[7, 4]] },
  { l: 'en', t: '5 kilo rice', intent: 'sale', lines: [[8, 5]] },
  { l: 'en', t: 'one kilo dal', intent: 'sale', lines: [[9, 1]] },
  { l: 'en', t: 'half kg ghee', intent: 'sale', lines: [[13, 0.5]] },
  { l: 'en', t: 'six salt', intent: 'sale', lines: [[10, 6]] },
  { l: 'en', t: 'two kilo onion', intent: 'sale', lines: [[11, 2]] },
  { l: 'en', t: 'three kilo potato', intent: 'sale', lines: [[12, 3]] },
  { l: 'en', t: 'nine tea', intent: 'sale', lines: [[3, 9]] },
  { l: 'en', t: 'eight milk', intent: 'sale', lines: [[4, 8]] },
  { l: 'en', t: 'ten biscuits', intent: 'sale', lines: [[5, 10]] },
  { l: 'en', t: 'twenty rupees salt', intent: 'sale', lines: [[10, 1]], amount: 20 },
  { l: 'en', t: '2.5 kg sugar', intent: 'sale', lines: [[2, 2.5]] },
  { l: 'en', t: '0.5 kg salt', intent: 'sale', lines: [[10, 0.5]] },
  { l: 'en', t: 'ghee one kilo', intent: 'sale', lines: [[13, 1]] },
  { l: 'en', t: 'bill two potato one onion', intent: 'sale', lines: [[12, 2], [11, 1]] },
  { l: 'en', t: 'Ramesh 2 kg atta udhar 50 rupees', intent: 'udhar', lines: [[1, 2]], party: 101, method: 'udhar', amount: 50 },
  { l: 'en', t: 'Sunita three tea on credit', intent: 'udhar', lines: [[3, 3]], party: 102, method: 'udhar' },
  { l: 'en', t: 'Kamal one milk and two soap udhar', intent: 'udhar', lines: [[4, 1], [7, 2]], party: 103, method: 'udhar' },
  { l: 'en', t: 'Mohan two kilo sugar udhar', intent: 'udhar', lines: [[2, 2]], party: 104, method: 'udhar' },
  { l: 'en', t: 'Gita one oil credit', intent: 'udhar', lines: [[6, 1]], party: 105, method: 'udhar' },
  { l: 'en', t: 'udhar Sunita 3 sugar', intent: 'udhar', lines: [[2, 3]], party: 102, method: 'udhar' },
  { l: 'en', t: 'Ramesh paid 500 rupees', intent: 'payment', lines: [], party: 101, amount: 500 },
  { l: 'en', t: 'Sunita paid 200 cash', intent: 'payment', lines: [], party: 102, amount: 200 },
  { l: 'en', t: 'Mohan payment received 300', intent: 'payment', lines: [], party: 104, amount: 300 },
  { l: 'en', t: 'Kamal jama 150', intent: 'payment', lines: [], party: 103, amount: 150 },
  { l: 'en', t: 'Ramesh baki jama 100 rupees', intent: 'payment', lines: [], party: 101, amount: 100 },
  { l: 'en', t: 'stock add 10 kg sugar', intent: 'stock_in', lines: [[2, 10]] },
  { l: 'en', t: 'stock came two liter oil', intent: 'stock_in', lines: [[6, 2]] },
  { l: 'en', t: 'add 5 kilo atta to stock', intent: 'stock_in', lines: [[1, 5]] },
  { l: 'en', t: 'tea two packets', intent: 'sale', lines: [[3, 2]] },
  { l: 'en', t: 'sugar 3 pack', intent: 'sale', lines: [[2, 3]] },
  { l: 'en', t: 'bill: one dal, two rice', intent: 'sale', lines: [[9, 1], [8, 2]] },
  { l: 'en', t: 'Ramesh two atta', intent: 'sale', lines: [[1, 2]], party: 101 },
  { l: 'en', t: 'rice five kilo', intent: 'sale', lines: [[8, 5]] },
  { l: 'en', t: 'bill to Kamal, milk 1 liter', intent: 'sale', lines: [[4, 1]], party: 103 },
  { l: 'en', t: 'hello how are you', intent: 'none', lines: [] }
];

function loadParser(file) {
  const sandbox = { window: {} };
  sandbox.window.BGV2 = { S: JSON.parse(JSON.stringify(SHOP)) };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox);
  return sandbox.window.BGV2.parse;
}

// The parser before the upgrade has no intent field, so its meaning is read from its lines and method.
function meaningOf(p, before) {
  if (!before) return p.intent;
  if (!p.lines.length) return 'none';
  return p.method === 'udhar' ? 'udhar' : 'sale';
}

function judge(c, parse, before) {
  const p = parse(c.t);
  const miss = [];
  const want = c.lines.map(([id, q]) => id + ':' + q).sort().join(' ');
  const got = p.lines.map(l => l.product_id + ':' + l.qty).sort().join(' ');
  if (want !== got) miss.push('items');
  const intent = meaningOf(p, before);
  if (intent !== c.intent) miss.push('meaning');
  if (c.party !== undefined) {
    const one = p.party && p.party.status === 'one' ? p.party.customer.id : 0;
    if (one !== c.party) miss.push('customer');
  }
  if (c.method !== undefined && p.method !== c.method) miss.push('method');
  if (c.amount !== undefined && p.amount !== c.amount) miss.push('amount');
  return { ok: miss.length === 0, miss, p };
}

const after = loadParser(path.join(repo, 'v2', 'assets', 'v2-parse.js'));
const before = loadParser(path.join(here, 'voice-baseline', 'v2-parse-before.js'));
const LANGS = { hi: 'Hindi', mr: 'Marathi', gu: 'Gujarati', en: 'English and Hinglish' };
const tally = {};
let failsAfter = [];
let okBefore = 0, okAfter = 0;
for (const c of C) {
  const b = judge(c, before, true), a = judge(c, after, false);
  const t = tally[c.l] || (tally[c.l] = { n: 0, before: 0, after: 0 });
  t.n++;
  if (b.ok) { t.before++; okBefore++; }
  if (a.ok) { t.after++; okAfter++; } else failsAfter.push({ c, miss: a.miss, p: a.p });
}

const pct = (x, n) => (n ? Math.round((x / n) * 100) : 0) + '%';
console.log('== voice accuracy: ' + C.length + ' phrases in ' + Object.keys(LANGS).length + ' languages');
for (const l of Object.keys(LANGS)) {
  const t = tally[l];
  console.log(LANGS[l].padEnd(24) + ' n=' + String(t.n).padEnd(3) + ' before ' + pct(t.before, t.n).padStart(4) + '  after ' + pct(t.after, t.n).padStart(4));
}
console.log('All                      n=' + String(C.length).padEnd(3) + ' before ' + pct(okBefore, C.length).padStart(4) + '  after ' + pct(okAfter, C.length).padStart(4));
if (failsAfter.length) {
  console.log('-- phrases the new parser still gets wrong (what is missing):');
  for (const f of failsAfter) console.log('  [' + f.c.l + '] ' + f.c.t + ' -> ' + f.miss.join(', '));
}
const bad = failsAfter.length;
const pass = C.length >= 150 && bad <= C.length / 5;
console.log('== voice-accuracy: PASS=' + (C.length - bad) + ' FAIL=' + bad + (pass ? '' : ' (below the bar)'));
process.exit(pass ? 0 : 1);
