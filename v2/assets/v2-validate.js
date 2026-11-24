/* BizGrow v2: front-end checks. Numbers must be positive numbers, text in a number box shows an error (never 0),
   discount cannot be more than the bill, names have a length limit, and a bill has at most 30 lines.
   The demo server checks the same things again. */
(function () {
  'use strict';
  var B = window.BGV2; if (!B) return;
  var MAXLINES = 30;

  // A positive number (or 0 when o.zero is set). Returns { ok, n } or { ok: false, msg }.
  B.vnum = function (raw, o) {
    o = o || {};
    var s = String(raw == null ? '' : raw).trim();
    if (!/^\d+(\.\d{1,2})?$/.test(s)) return { ok: false, msg: B.tx('v2_num_err') };
    var n = parseFloat(s);
    if (n <= 0 && !o.zero) return { ok: false, msg: B.tx('v2_num_err') };
    if (o.max != null && n > o.max) return { ok: false, msg: B.tx('v2_too_big', { max: B.qn(o.max) }) };
    return { ok: true, n: n };
  };

  // Text with a length limit. Returns { ok, v } or { ok: false, msg }.
  B.vtext = function (raw, max, emptyKey) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return { ok: false, msg: B.tx(emptyKey || 'v2_name_req') };
    if (s.length > max) return { ok: false, msg: B.tx('v2_too_long', { max: String(max) }) };
    return { ok: true, v: s };
  };

  // Show an error under a form, without closing it.
  function formErr(f, msg) {
    var p = f.querySelector('.v2-form-err');
    if (!p) { p = document.createElement('p'); p.className = 'v2-err v2-form-err'; p.setAttribute('role', 'alert'); f.insertBefore(p, f.querySelector('button[type=submit],button:last-of-type') || null); }
    p.textContent = msg;
  }
  B.formErr = formErr;

  // Discount box on the sell screen.
  function cartSub() { return (B.S.cart || []).reduce(function (s, l) { return s + (+l.price || 0) * (+l.qty || 0); }, 0); }
  function discMsg(v) {
    if (v === '' || v == null) return '';
    var n = parseFloat(v);
    if (isNaN(n) || n < 0) return B.tx('v2_num_err');
    if (n > cartSub()) return B.tx('v2_disc_big', { max: B.inr(cartSub()) });
    return '';
  }
  document.addEventListener('input', function (e) {
    var d = e.target; if (!d || d.id !== 'disc') return;
    var msg = discMsg(d.value);
    var err = document.getElementById('v2-disc-err');
    if (!err) {
      err = document.createElement('p'); err.id = 'v2-disc-err'; err.className = 'v2-err'; err.setAttribute('role', 'alert');
      var row = d.closest('.row'); if (row) row.insertAdjacentElement('afterend', err);
    }
    err.textContent = msg;
  });
  // Stop paying when the discount is wrong. Runs before the app's own click handler.
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-act="pay"]'); if (!b) return;
    var d = document.getElementById('disc'); if (!d) return;
    var msg = discMsg(d.value);
    if (msg) { e.stopImmediatePropagation(); e.preventDefault(); B.toast(msg); }
  }, true);

  // Add to bill: at most 30 lines, and no more than the stock we have (owner override is on the confirm sheet).
  var origTile = B.ACT.tile;
  B.ACT.tile = function (el) {
    var id = el.dataset.id;
    var inCart = (B.S.cart || []).filter(function (l) { return l.product_id == id; })[0];
    if (!inCart && (B.S.cart || []).length >= MAXLINES) return B.toast(B.tx('v2_too_many'));
    var p = (B.S.products || []).filter(function (x) { return x.id == id; })[0];
    if (p && p.stock != null) {
      var have = inCart ? inCart.qty : 0;
      if (have + 1 > p.stock) return B.toast(B.tx('v2_short', { name: p.name, stock: B.qn(p.stock) }));
    }
    return origTile(el);
  };

  // Custom item form: a text price shows an error instead of becoming 0.
  B.FORM.custom = function (f, d) {
    var nm = B.vtext(d.name, 60, 'v2_name_req'); if (!nm.ok) return formErr(f, nm.msg);
    var pr = B.vnum(d.price, { zero: true }); if (!pr.ok) return formErr(f, pr.msg);
    var q = B.vnum(d.qty || '1'); if (!q.ok) return formErr(f, q.msg);
    if ((B.S.cart || []).length >= MAXLINES) return formErr(f, B.tx('v2_too_many'));
    B.S.cart.push({ product_id: null, name: nm.v, price: pr.n, qty: q.n });
    f.closest('.ov').close();
    B.render();
  };
})();
