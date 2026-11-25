/* BizGrow v2: printable invoice for a bill or an online order.
   BGV2_INV.doc(inv) returns one self-contained page: shop name and details, number, date, customer,
   items with quantity and price, discount, total, paid, balance, UPI, a Print button and a WhatsApp share link.
   It fits a 360px phone and prints clean (the buttons are hidden on paper).
   BGV2_INV.open(win, inv) writes the page into a window the caller already opened. It does not print by itself.
   Used by the bill links (demo and live adapters) and by the Invoice button on each online order (v2-store.js).
   Loaded after the i18n files, so its own wording is merged in only where a language has no entry yet. */
(function () {
  'use strict';
  var W = window;

  var TXT = {
    en: {
      inv_title: 'Invoice', inv_bill: 'Bill', inv_ref: 'Ref {ref}', inv_print: 'Print / Save as PDF',
      inv_share: 'Share on WhatsApp', inv_items: 'Items', inv_qty: 'Qty', inv_price: 'Price', inv_amount: 'Amount',
      inv_discount: 'Discount', inv_total: 'Total', inv_paid: 'Paid', inv_balance: 'Balance (udhar)',
      inv_customer: 'Customer', inv_walkin: 'Walk-in customer', inv_phone: 'Phone', inv_upi: 'Pay by UPI',
      inv_thanks: 'Thank you!', inv_note: 'Note', inv_cancelled: 'Cancelled', inv_myshop: 'My shop',
      inv_button: 'Invoice',
      inv_popup: 'Your browser blocked the new tab. Allow pop-ups for this page and try again.'
    },
    hi: {
      inv_title: 'इनवॉइस', inv_bill: 'बिल', inv_ref: 'संदर्भ {ref}', inv_print: 'प्रिंट / PDF सेव करें',
      inv_share: 'WhatsApp पर भेजें', inv_items: 'सामान', inv_qty: 'मात्रा', inv_price: 'भाव', inv_amount: 'रकम',
      inv_discount: 'छूट', inv_total: 'कुल', inv_paid: 'जमा', inv_balance: 'बाकी (उधार)',
      inv_customer: 'ग्राहक', inv_walkin: 'नकद ग्राहक', inv_phone: 'फोन', inv_upi: 'UPI से भुगतान',
      inv_thanks: 'धन्यवाद!', inv_note: 'नोट', inv_cancelled: 'रद्द', inv_myshop: 'मेरी दुकान',
      inv_button: 'इनवॉइस',
      inv_popup: 'ब्राउज़र ने नया टैब रोक दिया। इस पेज के लिए पॉप-अप चालू करें और फिर कोशिश करें।'
    },
    mr: {
      inv_title: 'इनव्हॉइस', inv_bill: 'बिल', inv_ref: 'संदर्भ {ref}', inv_print: 'प्रिंट / PDF जतन करा',
      inv_share: 'WhatsApp वर पाठवा', inv_items: 'वस्तू', inv_qty: 'संख्या', inv_price: 'दर', inv_amount: 'रक्कम',
      inv_discount: 'सूट', inv_total: 'एकूण', inv_paid: 'भरले', inv_balance: 'शिल्लक (उधार)',
      inv_customer: 'ग्राहक', inv_walkin: 'रोख ग्राहक', inv_phone: 'फोन', inv_upi: 'UPI ने पैसे द्या',
      inv_thanks: 'धन्यवाद!', inv_note: 'नोंद', inv_cancelled: 'रद्द', inv_myshop: 'माझे दुकान',
      inv_button: 'इनव्हॉइस',
      inv_popup: 'ब्राउझरने नवीन टॅब अडवला. या पानासाठी पॉप-अप चालू करा आणि पुन्हा प्रयत्न करा.'
    },
    gu: {
      inv_title: 'ઇન્વૉઇસ', inv_bill: 'બિલ', inv_ref: 'સંદર્ભ {ref}', inv_print: 'પ્રિન્ટ / PDF સાચવો',
      inv_share: 'WhatsApp પર મોકલો', inv_items: 'વસ્તુઓ', inv_qty: 'જથ્થો', inv_price: 'ભાવ', inv_amount: 'રકમ',
      inv_discount: 'છૂટ', inv_total: 'કુલ', inv_paid: 'ચૂકવ્યા', inv_balance: 'બાકી (ઉધાર)',
      inv_customer: 'ગ્રાહક', inv_walkin: 'રોકડ ગ્રાહક', inv_phone: 'ફોન', inv_upi: 'UPI થી ચૂકવો',
      inv_thanks: 'આભાર!', inv_note: 'નોંધ', inv_cancelled: 'રદ', inv_myshop: 'મારી દુકાન',
      inv_button: 'ઇન્વૉઇસ',
      inv_popup: 'બ્રાઉઝરે નવી ટેબ રોકી. આ પેજ માટે પોપ-અપ ચાલુ કરો અને ફરી પ્રયત્ન કરો.'
    }
  };
  W.I18N = W.I18N || {};
  Object.keys(TXT).forEach(function (lang) {
    W.I18N[lang] = W.I18N[lang] || {};
    Object.keys(TXT[lang]).forEach(function (k) { if (!(k in W.I18N[lang])) W.I18N[lang][k] = TXT[lang][k]; });
  });

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) { return '₹' + (Math.round((+n || 0) * 100) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 }); }
  function qty(n) { return String(Math.round((+n || 0) * 1000) / 1000); }
  function digits(s) { return String(s || '').replace(/\D/g, ''); }

  // Text in the member's language, with {name} slots filled in. Falls back to the English words.
  function tx(k, vars) {
    var B = W.BGV2, s = B && B.tx ? B.tx(k) : k;
    if (!s || s === k) s = (TXT.en[k] || k);
    if (vars) Object.keys(vars).forEach(function (n) { s = s.split('{' + n + '}').join(vars[n]); });
    return s;
  }

  // Plain date and time in India time. A date with no time shows the date only.
  function when(iso) {
    if (!iso) return '';
    var s = String(iso), dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(s);
    var d = new Date(dateOnly ? s + 'T12:00:00+05:30' : s);
    if (isNaN(d)) return s;
    var o = { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' };
    if (!dateOnly) { o.hour = '2-digit'; o.minute = '2-digit'; o.hour12 = true; }
    return d.toLocaleString('en-IN', o);
  }

  function waHref(phone, text) {
    var p = digits(phone); if (p.length === 10) p = '91' + p;
    return 'https://wa.me/' + p + '?text=' + encodeURIComponent(text);
  }

  // What is still owed. Only bills have a paid amount; an online order has none until it is taken.
  function dueOf(inv) { return inv.paid == null ? 0 : Math.max(0, (+inv.total || 0) - (+inv.paid || 0)); }

  function headLine(inv) {
    return inv.kind === 'order' ? tx('inv_ref', { ref: inv.ref }) : tx('inv_bill') + ' #' + inv.ref;
  }

  // Text for WhatsApp: the same facts as the page, without HTML.
  function shareText(inv) {
    var shop = inv.shop || {}, due = dueOf(inv), L = [];
    L.push('*' + (shop.name || tx('inv_myshop')) + '*');
    L.push(tx('inv_title') + ' · ' + headLine(inv) + (when(inv.when) ? ' · ' + when(inv.when) : ''));
    L.push('');
    (inv.lines || []).forEach(function (l) {
      L.push(l.name + ' × ' + qty(l.qty) + (l.unit ? ' ' + l.unit : '') + ' = ' + money(l.amount));
    });
    if (+inv.discount) L.push(tx('inv_discount') + ': -' + money(inv.discount));
    L.push('', '*' + tx('inv_total') + ': ' + money(inv.total) + '*');
    if (inv.paid != null) L.push(tx('inv_paid') + ': ' + money(inv.paid));
    if (due > 0) L.push('*' + tx('inv_balance') + ': ' + money(due) + '*');
    if (shop.upi_id && (inv.kind === 'order' || due > 0)) L.push(tx('inv_upi') + ': ' + shop.upi_id);
    L.push('', tx('inv_thanks'));
    return L.join('\n');
  }

  function row(label, value, big) {
    return '<div' + (big ? ' class="big"' : '') + '><span>' + esc(label) + '</span><span>' + esc(value) + '</span></div>';
  }

  function doc(inv) {
    var shop = inv.shop || {}, due = dueOf(inv), isOrder = inv.kind === 'order';
    var dt = when(inv.when);
    var lines = (inv.lines || []).map(function (l) {
      return '<tr><td class="name">' + esc(l.name) + '</td>' +
        '<td class="n">' + esc(qty(l.qty)) + (l.unit ? ' ' + esc(l.unit) : '') + '</td>' +
        '<td class="n">' + esc(money(l.price)) + '</td><td class="n">' + esc(money(l.amount)) + '</td></tr>';
    }).join('');

    var totals = '';
    if (+inv.discount) totals += row(tx('inv_discount'), '-' + money(inv.discount));
    totals += row(tx('inv_total'), money(inv.total), true);
    if (inv.paid != null) totals += row(tx('inv_paid'), money(inv.paid));
    if (due > 0) totals += row(tx('inv_balance'), money(due), true);

    var cust = '';
    if (inv.customer) cust = tx('inv_customer') + ': ' + inv.customer + (inv.phone ? ' · ' + inv.phone : '');
    else if (!isOrder) cust = tx('inv_walkin');

    var upi = (shop.upi_id && (isOrder || due > 0))
      ? '<p class="muted">' + esc(tx('inv_upi')) + ': ' + esc(shop.upi_id) + '</p>' : '';
    var note = inv.note ? '<p class="muted"><b>' + esc(tx('inv_note')) + ':</b> ' + esc(inv.note) + '</p>' : '';
    var cancelled = inv.cancelled ? '<p class="cancel">' + esc(tx('inv_cancelled')) + '</p>' : '';

    var css = '*{box-sizing:border-box}' +
      'body{font-family:Arial,"Noto Sans Devanagari","Noto Sans Gujarati",sans-serif;color:#111;margin:0;padding:12px;background:#f4f6f9;font-size:15px}' +
      '.bar{display:flex;gap:8px;flex-wrap:wrap;max-width:640px;margin:0 auto 12px}' +
      '.bar button,.bar a{flex:1 1 140px;min-height:44px;border-radius:10px;border:1.5px solid #0A192F;background:#fff;color:#0A192F;font:inherit;font-weight:700;display:flex;align-items:center;justify-content:center;text-align:center;text-decoration:none;cursor:pointer;padding:6px 10px}' +
      '.bar .wa{background:#25D366;border-color:#25D366;color:#fff}' +
      '.page{background:#fff;max-width:640px;margin:0 auto;padding:16px;border:1px solid #ddd;border-radius:10px}' +
      '.head{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;border-bottom:2px solid #111;padding-bottom:10px}' +
      'h1{font-size:20px;margin:0 0 4px;overflow-wrap:anywhere}' +
      '.title{text-align:right;font-size:17px;font-weight:700;overflow-wrap:anywhere}' +
      '.muted{color:#555;font-size:13px;overflow-wrap:anywhere}' +
      '.cancel{color:#B91C1C;font-weight:700}' +
      '.cust{margin:10px 0 4px;font-size:14px;overflow-wrap:anywhere}' +
      'table{width:100%;border-collapse:collapse;margin-top:8px;font-size:14px}' +
      'th,td{padding:6px 4px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top}' +
      'th{font-size:13px;color:#333}' +
      'td.name{overflow-wrap:anywhere;word-break:break-word;max-width:44vw}' +
      '.n{text-align:right;white-space:nowrap}' +
      '.tot{margin:10px 0 0 auto;max-width:300px}' +
      '.tot div{display:flex;justify-content:space-between;gap:12px;padding:3px 0}' +
      '.tot .big{font-weight:700;font-size:17px;border-top:2px solid #111;margin-top:4px;padding-top:6px}' +
      '.foot{margin-top:14px;font-size:14px;text-align:center;color:#333}' +
      '@media (max-width:360px){body{font-size:14px;padding:8px}th,td{font-size:13px;padding:5px 3px}.page{padding:12px}}' +
      '@media print{body{background:#fff;padding:0}.page{border:0;max-width:none;padding:0;border-radius:0}.bar{display:none}@page{margin:10mm}}';

    var bar = '<div class="bar"><button type="button" onclick="window.print()">' + esc(tx('inv_print')) + '</button>' +
      '<a class="wa" target="_blank" rel="noopener" href="' + esc(waHref(inv.phone, shareText(inv))) + '">' +
      esc(tx('inv_share')) + '</a></div>';

    var page = '<div class="page">' +
      '<div class="head"><div><h1>' + esc(shop.name || tx('inv_myshop')) + '</h1>' +
      (shop.address ? '<div class="muted">' + esc(shop.address) + '</div>' : '') +
      (shop.phone ? '<div class="muted">' + esc(tx('inv_phone')) + ': ' + esc(shop.phone) + '</div>' : '') +
      (shop.gstin ? '<div class="muted">GSTIN: ' + esc(shop.gstin) + '</div>' : '') +
      '</div><div class="title">' + esc(tx('inv_title')) + '<div class="muted">' + esc(headLine(inv)) + '</div>' +
      (dt ? '<div class="muted">' + esc(dt) + '</div>' : '') + '</div></div>' +
      cancelled +
      (cust ? '<div class="cust">' + esc(cust) + '</div>' : '') +
      '<table><thead><tr><th>' + esc(tx('inv_items')) + '</th><th class="n">' + esc(tx('inv_qty')) + '</th>' +
      '<th class="n">' + esc(tx('inv_price')) + '</th><th class="n">' + esc(tx('inv_amount')) + '</th></tr></thead>' +
      '<tbody>' + lines + '</tbody></table>' +
      '<div class="tot">' + totals + '</div>' + upi + note +
      '<div class="foot">' + esc(tx('inv_thanks')) + '</div></div>';

    return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>' + esc(tx('inv_title') + ' ' + headLine(inv)) + '</title>' +
      '<style>' + css + '</style></head><body>' + bar + page + '</body></html>';
  }

  function open(win, inv) {
    win.document.open(); win.document.write(doc(inv)); win.document.close();
  }

  function line(i) {
    var q = +i.qty || 0, p = +i.price || 0;
    return { name: i.name, qty: q, unit: i.unit || '', price: p, amount: Math.round(q * p * 100) / 100 };
  }

  // A saved bill. items: [{name, qty, price, unit}] (the sale's own item list).
  function bill(sale, items, shop) {
    return {
      kind: 'bill', shop: shop || {}, ref: sale.bill_no,
      when: sale.created_at || sale.date, customer: sale.customer_name || '', phone: sale.customer_phone || '',
      lines: (items || []).map(line), discount: sale.discount || 0,
      total: sale.total, paid: sale.paid == null ? 0 : sale.paid, note: sale.note || ''
    };
  }

  // An online order, from the rows the Orders page already has (lines have line_total).
  function order(o, shop) {
    return {
      kind: 'order', shop: shop || {}, ref: o.ref, when: o.created_at,
      customer: o.name || '', phone: o.phone || '',
      lines: (o.lines || []).map(function (l) {
        var q = +l.qty || 0, amt = +l.line_total || 0;
        return { name: l.name, qty: q, unit: l.unit || '', price: q ? Math.round(amt / q * 100) / 100 : 0, amount: amt };
      }),
      discount: 0, total: o.total, paid: null, note: o.note || '', cancelled: o.status === 'cancelled'
    };
  }

  W.BGV2_INV = { doc: doc, open: open, bill: bill, order: order, shareText: shareText };
})();
