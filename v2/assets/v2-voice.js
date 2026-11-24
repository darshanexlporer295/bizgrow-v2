/* BizGrow v2: the voice bill. Mic card on Home, a confirm sheet, and the assistant rename.
   A bill is never saved straight from speech. The member always taps Save on the confirm sheet. */
(function () {
  'use strict';
  var B = window.BGV2; if (!B) return;
  var LOC = { en: 'en-IN', hi: 'hi-IN', mr: 'mr-IN', gu: 'gu-IN' };
  var MAXLINES = 30;
  var MIC = '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';

  function esc(s) { return B.esc(s); }
  function speechClass() { return window.SpeechRecognition || window.webkitSpeechRecognition || null; }
  function $(id) { return document.getElementById(id); }

  // Home card, shown to anyone who can make a bill.
  B.on('home', function (v) {
    if (v.querySelector('.v2-voice') || !B.can('sale')) return;
    var rename = B.can('settings') ? '<button class="linkbtn" data-v2="rename">' + esc(B.tx('v2_chotu_title')) + '</button>' : '';
    B.placeTop(v,
      '<section class="card v2-voice">' +
      '<h2>' + esc(B.tx('v2_voice_title', { name: B.assistant() })) + '</h2>' +
      '<p class="muted small">' + esc(B.tx('v2_voice_hint')) + '</p>' +
      '<button class="v2-mic" data-v2="mic">' + MIC + '<span>' + esc(B.tx('v2_mic')) + '</span></button>' +
      '<div class="v2-type"><input class="in" id="v2-type" maxlength="200" placeholder="' + esc(B.tx('v2_type_here')) + '">' +
      '<button class="btn" data-v2="check">' + esc(B.tx('v2_check')) + '</button></div>' +
      '<p class="v2-msg" id="v2-voice-msg" role="status"></p>' +
      '<p class="muted small">' + esc(B.tx('v2_try')) + ': <i>"Ramesh ko 2 kg atta, 50 rupees udhar"</i></p>' +
      rename + '</section>');
  });

  function msg(t) { var m = $('v2-voice-msg'); if (m) m.textContent = t || ''; }

  function listen() {
    var R = speechClass();
    if (!R) { msg(B.tx('v2_no_speech')); var ti = $('v2-type'); if (ti) ti.focus(); return; }
    var r;
    try { r = new R(); } catch (e) { msg(B.tx('v2_no_speech')); return; }
    r.lang = LOC[B.S.lang] || 'en-IN'; r.interimResults = false; r.maxAlternatives = 1;
    msg(B.tx('v2_listening'));
    r.onresult = function (ev) {
      var s = (ev.results && ev.results[0] && ev.results[0][0] && ev.results[0][0].transcript) || '';
      var ti = $('v2-type'); if (ti) ti.value = s;
      review(s);
    };
    r.onerror = function () { msg(B.tx('v2_no_speech')); };
    r.onend = function () { if ($('v2-voice-msg') && $('v2-voice-msg').textContent === B.tx('v2_listening')) msg(B.tx('v2_nothing')); };
    try { r.start(); } catch (e) { msg(B.tx('v2_no_speech')); }
  }

  // Turn the words into a bill to check. Nothing is saved here.
  async function review(txt) {
    txt = String(txt || '').trim();
    if (!B.can('sale')) { msg(B.tx('v2_view_only')); return; }
    if (!txt) { msg(B.tx('v2_nothing')); return; }
    if (!B.S.products || !B.S.products.length || !B.S.customers || !B.S.customers.length) { try { await B.refresh(); } catch (e) { /* use what we have */ } }
    var p = B.parse(txt);
    if (!p.lines.length) { msg(B.tx('v2_nothing')); return; }
    if (p.lines.length > MAXLINES) { msg(B.tx('v2_too_many')); return; }
    openConfirm(p);
  }
  B.voiceReview = review;

  // ---- confirm sheet ----
  function openConfirm(p) {
    var st = {
      heard: p.heard, amount: p.amount, date: B.today(), more: false, override: false,
      method: p.method || 'cash', party: p.party.status === 'one' ? p.party.customer : null,
      choosing: p.party.status === 'choose', options: p.party.options || [],
      lines: p.lines.map(function (l) { return { product_id: l.product_id, name: l.name, stock: l.stock, qty: String(l.qty), price: String(l.price) }; })
    };
    if (st.method === 'udhar' && !st.party) st.choosing = true;
    var o = B.modal('<div class="v2-cf"></div>');
    var sheet = o.querySelector('.v2-cf');
    function paint() { sheet.innerHTML = html(st); refresh(); }
    o.addEventListener('click', function (e) {
      var el = e.target.closest('[data-vc]'); if (!el) return;
      var k = el.getAttribute('data-vc');
      if (k === 'cancel') { o.close(); return; }
      if (k === 'party') { var id = +el.getAttribute('data-id'); st.party = id ? st.options.filter(function (c) { return c.id === id; })[0] : null; st.choosing = false; paint(); return; }
      if (k === 'change') { st.choosing = true; paint(); return; }
      if (k === 'method') { st.method = el.getAttribute('data-m'); if (st.method === 'udhar' && !st.party) st.choosing = true; if (st.method !== 'udhar' && st.choosing && !st.party) st.choosing = false; paint(); return; }
      if (k === 'more') { st.more = !st.more; paint(); return; }
      if (k === 'rm') { st.lines.splice(+el.getAttribute('data-i'), 1); paint(); return; }
      if (k === 'save') { save(o, st); return; }
    });
    o.addEventListener('input', function (e) {
      var el = e.target; var k = el.getAttribute && el.getAttribute('data-vc');
      if (k === 'qty' || k === 'price') { st.lines[+el.getAttribute('data-i')][k] = el.value; refresh(); }
      if (k === 'date') { st.date = el.value; refresh(); }
      if (k === 'override') { st.override = el.checked; refresh(); }
    });
    function totalOf() {
      return st.lines.reduce(function (s, l) { var q = B.vnum(l.qty), pr = B.vnum(l.price, { zero: true }); return s + (q.ok && pr.ok ? q.n * pr.n : 0); }, 0);
    }
    // Problems that stop Save. Returns a message or ''.
    function problem() {
      if (!st.lines.length) return B.tx('v2_need_line');
      if (st.lines.length > MAXLINES) return B.tx('v2_too_many');
      for (var i = 0; i < st.lines.length; i++) {
        var l = st.lines[i];
        if (!B.vnum(l.qty).ok) return l.name + ': ' + B.tx('v2_num_err');
        if (!B.vnum(l.price, { zero: true }).ok) return l.name + ': ' + B.tx('v2_num_err');
      }
      if (st.method === 'udhar' && !st.party) return B.tx('v2_which_party');
      var short = shortLines(st);
      if (short.length && !(st.override && B.can('stock_override'))) return B.tx('v2_short', { name: short[0].name, stock: B.qn(short[0].stock) });
      if (st.date > B.today()) return B.tx('v2_date_future');
      return '';
    }
    function refresh() {
      var sum = sheet.querySelector('.v2-cf-sum'); if (!sum) return;
      var pr = problem(); var tot = totalOf();
      sum.innerHTML = '<div class="v2-total"><span>' + esc(B.tx('v2_total')) + '</span><b>' + esc(B.inr(tot)) + '</b></div>' +
        (st.amount != null && Math.round(st.amount) !== Math.round(tot) ? '<p class="muted small">' + esc(B.tx('v2_said_amount', { amount: B.inr(st.amount) })) + '</p>' : '') +
        (pr ? '<p class="v2-err" role="alert">' + esc(pr) + '</p>' : '') +
        '<p class="v2-err" id="v2-cf-err"></p>';
      var btn = sheet.querySelector('[data-vc="save"]'); if (btn) btn.disabled = !!pr;
    }
    paint();
    st.paintFn = paint;
    B.cfState = st;
    return o;
  }

  function shortLines(st) {
    return st.lines.filter(function (l) { var q = B.vnum(l.qty); return q.ok && l.product_id && l.stock != null && q.n > l.stock; });
  }

  function html(st) {
    var h = '<h2>' + esc(B.tx('v2_check_title')) + '</h2>';
    h += '<p class="muted small">' + esc(B.tx('v2_heard')) + ': <i>"' + esc(st.heard) + '"</i></p>';
    // Party
    if (st.choosing) {
      h += '<p class="bold">' + esc(B.tx('v2_which_party')) + '</p><div class="v2-party">';
      st.options.slice(0, 8).forEach(function (c) { h += '<button class="btn sec" data-vc="party" data-id="' + c.id + '">' + esc(c.name) + '</button>'; });
      if (st.method !== 'udhar') h += '<button class="btn sec" data-vc="party" data-id="0">' + esc(B.tx('v2_cash_customer')) + '</button>';
      h += '</div>';
    } else {
      h += '<div class="v2-for"><div><span class="muted small">' + esc(B.tx('v2_for')) + '</span><div class="bold">' +
        esc(st.party ? st.party.name : B.tx('v2_cash_customer')) + '</div></div><button class="linkbtn" data-vc="change">' + esc(B.tx('v2_change')) + '</button></div>';
    }
    // Lines
    h += '<div class="v2-lines">';
    st.lines.forEach(function (l, i) {
      var short = l.product_id && l.stock != null && (B.vnum(l.qty).ok ? B.vnum(l.qty).n : 0) > l.stock;
      h += '<div class="v2-line"><div class="grow"><b>' + esc(l.name) + '</b>' +
        (short ? '<small class="v2-err">' + esc(B.tx('v2_stock_left', { stock: B.qn(l.stock) })) + '</small>' : '') + '</div>' +
        '<label class="v2-f">' + esc(B.tx('v2_qty')) + '<input class="in" inputmode="decimal" data-vc="qty" data-i="' + i + '" value="' + esc(l.qty) + '"></label>' +
        '<label class="v2-f">' + esc(B.tx('v2_price')) + '<input class="in" inputmode="decimal" data-vc="price" data-i="' + i + '" value="' + esc(l.price) + '"></label>' +
        '<button class="iconbtn" data-vc="rm" data-i="' + i + '" aria-label="' + esc(B.tx('v2_remove')) + '">&times;</button></div>';
    });
    h += '</div>';
    h += '<div class="v2-cf-sum"></div>';
    // How paid
    h += '<div class="v2-how">';
    [['cash', 'v2_cash'], ['upi', 'v2_upi'], ['udhar', 'v2_udhar']].forEach(function (m) {
      h += '<button class="btn ' + (st.method === m[0] ? '' : 'sec') + '" data-vc="method" data-m="' + m[0] + '">' + esc(B.tx(m[1])) + '</button>';
    });
    h += '</div>';
    // More options: back-date and owner stock override are hidden here
    h += '<button class="linkbtn" data-vc="more">' + esc(B.tx('v2_more')) + (st.more ? ' ▲' : ' ▼') + '</button>';
    if (st.more) {
      h += '<div class="v2-more">';
      if (B.can('backdate')) h += '<label class="f">' + esc(B.tx('v2_bill_date')) + '<input class="in" type="date" data-vc="date" max="' + B.today() + '" value="' + esc(st.date) + '"></label>';
      if (B.can('stock_override') && shortLines(st).length) h += '<label class="v2-check"><input type="checkbox" data-vc="override"' + (st.override ? ' checked' : '') + '> ' + esc(B.tx('v2_allow_neg')) + '</label>';
      h += '</div>';
    }
    h += '<button class="btn big block" data-vc="save">' + esc(B.tx('v2_save_bill')) + '</button>';
    h += '<button class="btn sec block" data-vc="cancel">' + esc(B.tx('v2_cancel')) + '</button>';
    return h;
  }

  async function save(o, st) {
    var body = {
      items: st.lines.map(function (l) { return { product_id: l.product_id, name: l.name, price: B.vnum(l.price, { zero: true }).n, qty: B.vnum(l.qty).n }; }),
      method: st.method
    };
    if (st.method === 'udhar' && st.party) body.customer_id = st.party.id;
    if (st.date && st.date !== B.today()) body.date = st.date;
    if (st.override && B.can('stock_override')) body.stock_override = true;
    try {
      await B.api('/sales', 'POST', body);
      o.close(); B.toast(B.tx('v2_saved'));
      await B.refresh(); B.render();
    } catch (e) {
      var err = o.querySelector('#v2-cf-err'); if (err) err.textContent = e.message || B.tx('v2_forbidden');
    }
  }

  // Rename the helper (owner only). Default name stays Chotu.
  function rename() {
    var o = B.modal('<h2>' + esc(B.tx('v2_chotu_title')) + '</h2><p class="muted small mb">' + esc(B.tx('v2_chotu_sub')) +
      '</p><div class="f"><label>' + esc(B.tx('v2_name')) + '</label><input class="in" id="v2-rn" maxlength="20" value="' + esc(B.assistant()) + '"></div>' +
      '<p class="v2-err" id="v2-rn-msg"></p><button class="btn big block" data-v2="rename-save">' + esc(B.tx('v2_chotu_save')) + '</button>');
    return o;
  }
  document.addEventListener('click', async function (e) {
    var el = e.target.closest && e.target.closest('[data-v2]'); if (!el) return;
    var k = el.getAttribute('data-v2');
    if (k === 'mic') return listen();
    if (k === 'check') return review(($('v2-type') || {}).value);
    if (k === 'rename') return rename();
    if (k === 'rename-save') {
      var name = (($('v2-rn') || {}).value || '').trim();
      var r = B.vtext(name, 20, 'v2_name_req');
      if (!r.ok) { $('v2-rn-msg').textContent = r.msg; return; }
      try {
        await B.api('/v2/settings', 'PUT', { assistant_name: name });
        B.S.me.shop.assistant_name = name;
        el.closest('.ov').close(); B.toast(B.tx('v2_saved')); B.render();
      } catch (err) { $('v2-rn-msg').textContent = err.message || B.tx('v2_forbidden'); }
    }
  });
})();
