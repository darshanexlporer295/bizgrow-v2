/* BizGrow v2: reads a spoken or typed bill line such as "Ramesh ko 2 kg atta, 50 rupees udhar".
   This is a simple word matcher for the demo. It knows English words, Hinglish words and digits.
   It does not parse Hindi, Marathi or Gujarati words yet, except the payment words. It never saves anything. */
(function () {
  'use strict';
  var B = window.BGV2; if (!B) return;

  var NUM = { ek: 1, one: 1, do: 2, two: 2, teen: 3, three: 3, char: 4, four: 4, paanch: 5, five: 5, chhe: 6, six: 6, saat: 7, seven: 7, aath: 8, eight: 8, nau: 9, nine: 9, das: 10, ten: 10 };
  var SYN = { chini: 'sugar', cheeni: 'sugar', chai: 'tea', doodh: 'milk', biscut: 'biscuits', biscuit: 'biscuits', tel: 'oil', sabun: 'soap', aata: 'atta' };
  var UNITS = ['kg', 'g', 'gm', 'gram', 'grams', 'ml', 'l', 'litre', 'liter', 'pack', 'packet', 'pc', 'pcs', 'bottle', 'nos', 'no'];
  var RUPEE = ['rupees', 'rupee', 'rupaye', 'rupay', 'rs', 'rs.', 'rupaya', 'रुपये', 'रुपए', 'रु', 'रुपया'];
  var METHOD = { udhar: 'udhar', credit: 'udhar', 'उधार': 'udhar', 'ઉધાર': 'udhar', upi: 'upi', online: 'upi', 'यूपीआई': 'upi', cash: 'cash', naqad: 'cash', nakad: 'cash', rokad: 'cash', 'रोख': 'cash', 'नकद': 'cash', 'રોકડ': 'cash' };
  var FILLER = ['ko', 'ka', 'ki', 'ke', 'aur', 'and', 'se', 'me', 'mein', 'ne', 'for', 'to', 'the', 'a', 'of', 'bill', 'likho', 'likh', 'do'];

  function norm(s) {
    return String(s || '').toLowerCase()
      .replace(/[०-९]/g, function (c) { return String('०१२३४५६७८९'.indexOf(c)); })
      .replace(/[૦-૯]/g, function (c) { return String('૦૧૨૩૪૫૬૭૮૯'.indexOf(c)); })
      .replace(/[,।!?]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function numOf(tok) {
    if (tok == null) return NaN;
    var t = tok.replace(/^₹/, '');
    if (/^\d+(\.\d+)?$/.test(t)) return parseFloat(t);
    return NUM.hasOwnProperty(t) ? NUM[t] : NaN;
  }
  function isRupee(tok) { return !!tok && (tok.charAt(0) === '₹' || RUPEE.indexOf(tok) >= 0); }
  function isUnit(tok) { return UNITS.indexOf(tok) >= 0; }

  // Find customers named in the text. Full name first, then a first name of 3+ letters.
  function partyMatches(text, toks) {
    var out = [];
    (B.S.customers || []).forEach(function (c) {
      if (c.deleted_at) return;
      var nm = String(c.name || '').toLowerCase();
      if (!nm) return;
      var first = nm.split(' ')[0];
      if (text.indexOf(nm) >= 0 || (first.length >= 3 && toks.indexOf(first) >= 0)) out.push(c);
    });
    return out;
  }

  // Returns { heard, lines, party, method, amount, unknown }.
  // party.status is 'one' (use this customer), 'choose' (ask the member), or 'none' (cash customer).
  B.parse = function (raw) {
    var text = norm(raw);
    var toks = text ? text.split(' ') : [];
    var used = {};
    var out = { heard: String(raw || '').trim(), lines: [], party: { status: 'none' }, method: null, amount: null, unknown: [] };

    // Payment word
    toks.forEach(function (t, i) { if (METHOD.hasOwnProperty(t) && !out.method) { out.method = METHOD[t]; used[i] = true; } });

    // Amount said in rupees (for a check only; it does not set the price)
    toks.forEach(function (t, i) {
      if (out.amount != null) return;
      var v = numOf(t);
      if (!isNaN(v) && (isRupee(toks[i + 1]) || isRupee(toks[i - 1]) || t.charAt(0) === '₹')) { out.amount = v; used[i] = true; }
    });

    // Products: the first word of the product name, plus a few local words.
    var prods = (B.S.products || []).filter(function (p) { return !p.deleted_at; });
    var seen = {};
    toks.forEach(function (t, i) {
      if (used[i]) return;
      var key = SYN[t] || t;
      var p = prods.filter(function (x) { return String(x.name).toLowerCase().split(' ')[0] === key; })[0];
      if (!p) return;
      var qty = null, j, k;
      // Quantity before the name, skipping a unit word ("2 kg atta")
      j = i - 1; if (j >= 0 && isUnit(toks[j]) && !used[j]) j--;
      if (j >= 0 && !used[j] && !isNaN(numOf(toks[j])) && !isRupee(toks[j + 1])) { qty = numOf(toks[j]); used[j] = true; }
      // Else quantity after the name ("atta 2 kg")
      if (qty == null) {
        k = i + 1; if (k < toks.length && isUnit(toks[k])) k++;
        if (k < toks.length && !used[k] && !isNaN(numOf(toks[k])) && !isRupee(toks[k + 1])) { qty = numOf(toks[k]); used[k] = true; }
      }
      used[i] = true;
      if (qty == null || !(qty > 0)) qty = 1;
      if (seen[p.id]) { seen[p.id].qty += qty; return; }
      seen[p.id] = { product_id: p.id, name: p.name, price: p.price, cost: p.cost, qty: qty, stock: p.stock };
      out.lines.push(seen[p.id]);
    });

    // Who is it for?
    var matches = partyMatches(text, toks);
    if (matches.length === 1) out.party = { status: 'one', customer: matches[0] };
    else if (matches.length > 1) out.party = { status: 'choose', options: matches };
    else if (out.method === 'udhar') out.party = { status: 'choose', options: (B.S.customers || []).filter(function (c) { return !c.deleted_at; }) };

    // Words we did not use
    toks.forEach(function (t, i) {
      if (used[i] || FILLER.indexOf(t) >= 0 || isUnit(t) || !isNaN(numOf(t)) || isRupee(t)) return;
      var isName = (B.S.customers || []).some(function (c) { return String(c.name).toLowerCase().indexOf(t) >= 0 && t.length >= 3; });
      if (!isName && out.unknown.indexOf(t) < 0) out.unknown.push(t);
    });
    return out;
  };
})();
