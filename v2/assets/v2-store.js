/* BizGrow v2: online store. Three parts:
   1. Owner: the Store page (turn on/off, link, share, preview).
   2. Team: the Orders page (new-orders badge, status, reply on WhatsApp).
   3. Public: the store a buyer opens from the link (?shop=...). No sign-in.
   Loaded after app.js. Uses window.BGV2 that app.js exposes. */
(function () {
  'use strict';
  var B = window.BGV2; if (!B) return;

  var ORDER_STATUSES = ['new', 'accepted', 'packed', 'delivered', 'cancelled'];
  // The normal next steps. Anything else (reopen, skip a step) is owner-only; the server enforces it too.
  var ORDER_NEXT = { new: ['accepted', 'cancelled'], accepted: ['packed', 'cancelled'], packed: ['delivered', 'cancelled'], delivered: [], cancelled: [] };
  var esc = B.esc;

  // Small styles for the public page and the order cards. Mobile first, 44px tap targets.
  var CSS = '' +
    '.ps{max-width:640px;margin:0 auto;padding:14px 14px 48px;color:#0F172A}' +
    '.ps h1{font-size:22px;margin:0 0 4px;overflow-wrap:anywhere}' +
    '.ps-meta{font-size:14px;color:#64748B}.ps-meta a{color:#0A192F}' +
    '.ps-intro{color:#475569;font-size:15px;margin:10px 0 0}' +
    '.ps-search{width:100%;min-height:44px;padding:10px 12px;border:1px solid #CBD5E1;border-radius:10px;font-size:16px;box-sizing:border-box;margin:12px 0;font-family:inherit}' +
    '.ps-list{display:flex;flex-direction:column;gap:8px}' +
    '.ps-item{display:flex;align-items:center;gap:10px;background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:10px 12px}' +
    '.ps-info{flex:1;min-width:0}.ps-info b{display:block;font-size:16px;overflow-wrap:anywhere}.ps-info small{color:#64748B;font-size:13px}' +
    '.ps-btn{min-height:44px;min-width:44px;border-radius:10px;border:1px solid #CBD5E1;background:#fff;color:#0A192F;font-size:16px;font-weight:600;cursor:pointer;padding:0 12px;font-family:inherit}' +
    '.ps-add{background:#0A192F;color:#fff;border-color:#0A192F}' +
    '.ps-step{display:flex;align-items:center;gap:6px}.ps-step span{min-width:28px;text-align:center;font-weight:700}' +
    '.ps-card{background:#fff;border:1px solid #E2E8F0;border-radius:14px;padding:14px;margin-top:14px}' +
    '.ps-card h2{font-size:17px;margin:0 0 8px}' +
    '.ps-line{display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #F1F5F9;font-size:15px}' +
    '.ps-line .ps-grow{flex:1;min-width:0;overflow-wrap:anywhere}' +
    '.ps-total{display:flex;justify-content:space-between;font-weight:700;font-size:16px;padding-top:10px}' +
    '.ps-field{display:block;margin-bottom:10px;font-size:14px;color:#334155}' +
    '.ps-field input,.ps-field textarea{display:block;width:100%;min-height:44px;margin-top:4px;padding:10px 12px;border:1px solid #CBD5E1;border-radius:10px;font-size:16px;box-sizing:border-box;font-family:inherit}' +
    '.ps-send{width:100%;min-height:48px;border:0;border-radius:12px;background:#0A192F;color:#fff;font-size:16px;font-weight:700;cursor:pointer;font-family:inherit}' +
    '.ps-send:disabled{opacity:.6;cursor:default}' +
    '.ps-msg{color:#B91C1C;font-size:14px;margin:10px 0 0}' +
    '.ps-done{background:#ECFDF5;border:1px solid #A7F3D0;border-radius:12px;padding:14px;margin-top:14px;font-size:15px}' +
    '.ps-wa{display:inline-flex;align-items:center;justify-content:center;min-height:44px;margin-top:8px;padding:0 16px;border-radius:10px;background:#25D366;color:#fff;font-weight:700;text-decoration:none}' +
    '.ord-lines{padding-left:18px;line-height:1.7;margin:8px 0}' +
    '.ord-chips{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 14px}' +
    '.ord-chips .btn{min-height:44px}' +
    '.ord select.in{min-height:44px}';
  (function addCss() {
    var s = document.createElement('style'); s.id = 'v2-store-css'; s.textContent = CSS;
    document.head.appendChild(s);
  })();

  function inrf(n) { return '₹' + (Math.round((+n || 0) * 100) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 }); }
  function digits(s) { return String(s || '').replace(/\D/g, ''); }
  function waUrl(phone, text) {
    var p = digits(phone); if (p.length === 10) p = '91' + p;
    return 'https://wa.me/' + (p ? p : '') + '?text=' + encodeURIComponent(text);
  }
  function storeLink(slug) { return location.origin + location.pathname + '?shop=' + encodeURIComponent(slug); }
  function when(at) {
    var d = new Date(at); if (isNaN(d)) return '';
    return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
  }
  function fetchPublicStore(slug) {
    return fetch('/api/public/store?shop=' + encodeURIComponent(slug)).then(function (r) {
      if (!r.ok) throw new Error('bad');
      return r.json();
    });
  }

  /* ---------- 1. Owner: the Store page ---------- */
  B.on('store', function (v) { renderStore(v); });

  function renderStore(v) {
    var sh = B.S.me.shop, on = !!(sh.store_enabled && sh.store_slug);
    var link = on ? storeLink(sh.store_slug) : '';
    var body = '';
    if (on) {
      body += '<div class="okmsg">' + esc(B.tx('st_live')) + '</div>' +
        '<div class="f"><label>' + esc(B.tx('st_link')) + '</label><input class="in" readonly value="' + esc(link) + '" onclick="this.select()"></div>' +
        '<div class="row wrap">' +
        '<a class="btn" target="_blank" rel="noopener" href="' + esc(waUrl('', B.tx('wa_store', { shop: sh.name, link: link }))) + '">' + esc(B.tx('st_share')) + '</a>' +
        '<button class="btn sec" data-act="storepreview">' + esc(B.tx('st_preview')) + '</button>' +
        (B.isOwner() ? '<button class="btn red" data-act="storeoff">' + esc(B.tx('st_turn_off')) + '</button>' : '') +
        '</div>';
    } else {
      body += '<p class="mb">' + esc(B.tx('st_off')) + '</p>';
      if (B.isOwner()) {
        body += sh.phone
          ? '<button class="btn" data-act="storeon">' + esc(B.tx('st_turn_on')) + '</button>'
          : '<div class="err">' + esc(B.tx('st_need_phone')) + '</div><a class="btn" href="#/settings">' + esc(B.tx('st_open_settings')) + '</a>';
      } else {
        body += '<p class="muted">' + esc(B.tx('st_ask_owner')) + '</p>';
      }
    }
    body += '<p class="muted small mt">' + esc(B.tx('st_privacy')) + '</p>';
    v.innerHTML = B.head(B.tx('st_title'), B.tx('st_sub'), '') + '<section class="card" style="max-width:640px">' + body + '</section>';
  }

  async function setStore(on) {
    await B.api('/store', 'PUT', { enabled: on });
    B.S.me = await B.api('/me');
    B.toast(B.tx(on ? 'st_on_done' : 'st_off_done'));
    B.render();
  }
  B.ACT.storeon = function () { return setStore(true); };
  B.ACT.storeoff = function () { return setStore(false); };
  B.ACT.storepreview = async function () {
    var sh = B.S.me.shop;
    var r = null;
    try { r = await fetchPublicStore(sh.store_slug); } catch (e) { r = null; }
    var items = (r && r.items) || [];
    var list = items.length
      ? '<div class="list">' + items.map(function (p) {
          return '<div class="li"><div class="grow"><div class="t">' + esc(p.name) + '</div><div class="d">' + esc(B.tx('st_in_stock')) + '</div></div><b class="num">' + inrf(p.price) + (p.unit ? ' / ' + esc(p.unit) : '') + '</b></div>';
        }).join('') + '</div>'
      : '<p class="muted">' + esc(B.tx('st_no_items')) + '</p>';
    B.modal('<h2>' + esc(sh.name) + '</h2><p class="muted small mb">' + esc(B.tx('st_preview_sub')) + '</p>' + list);
  };

  /* ---------- 2. Team: the Orders page ---------- */
  var ordStatus = '', ordHide = false, ordItems = [], ordMore = false;
  var lastFetch = 0, lastNew = null;

  B.on('orders', function (v) { renderOrders(v, false); });

  function ordQuery(before) {
    var p = new URLSearchParams();
    if (ordStatus) p.set('status', ordStatus);
    if (ordHide) p.set('hide_cancelled', '1');
    if (before) p.set('before', before);
    var s = p.toString();
    return '/orders' + (s ? '?' + s : '');
  }

  // Newest first, 50 at a time. "older" adds the next page after the last one shown.
  async function renderOrders(v, older) {
    var title = B.head(B.tx('ord_title'), B.tx('ord_sub'), '');
    if (!B.can('orders')) { v.innerHTML = title + '<p class="muted">' + esc(B.tx('ord_forbidden')) + '</p>'; return; }
    var last = older && ordItems.length ? ordItems[ordItems.length - 1].created_at : '';
    var r;
    try { r = await B.api(ordQuery(last)); }
    catch (e) { v.innerHTML = title + '<div class="err">' + esc(e.message) + '</div>'; return; }
    lastNew = r.new_count || 0; lastFetch = Date.now(); paintBadges(lastNew);
    ordItems = older ? ordItems.concat(r.items || []) : (r.items || []);
    ordMore = !!r.has_more;
    var chips = [''].concat(ORDER_STATUSES).map(function (s) {
      return '<button class="btn ' + (ordStatus === s ? '' : 'sec ') + '" data-v2s="filter" data-status="' + s + '">' +
        esc(B.tx(s ? 'ord_' + s : 'ord_all')) + '</button>';
    }).join('');
    var tools = '<div class="ord-chips">' +
      '<button class="btn sec" data-v2s="hide">' + esc(B.tx(ordHide ? 'ord_show_cancelled' : 'ord_hide_cancelled')) + '</button>' +
      (B.isOwner() && lastNew > 0 ? '<button class="btn red" data-v2s="cancelnew">' + esc(B.tx('ord_cancel_new', { n: lastNew })) + '</button>' : '') +
      '</div>';
    var more = ordMore ? '<div class="ord-chips"><button class="btn sec" data-v2s="older">' + esc(B.tx('ord_older')) + '</button></div>' : '';
    v.innerHTML = title + '<div class="ord-chips">' + chips + '</div>' + tools +
      (ordItems.length ? ordItems.map(orderHtml).join('') + more : '<section class="card"><p class="muted">' + esc(B.tx('ord_none')) + '</p></section>');
  }

  function orderHtml(o) {
    var phone = digits(o.phone);
    var lines = (o.lines || []).map(function (l) {
      return '<li>' + esc(l.name) + ' × ' + esc(B.qn(l.qty)) + (l.unit ? ' ' + esc(l.unit) : '') + ' = ' + inrf(l.line_total) + '</li>';
    }).join('');
    return '<section class="card ord" style="max-width:640px">' +
      '<div class="row sp"><div><b>' + esc(o.name) + '</b><div class="small muted">' + esc(B.tx('ord_ref', { ref: o.ref })) + ' · ' + esc(when(o.created_at)) + '</div></div>' +
      '<span class="badge ' + (o.status === 'new' ? 'amber' : 'gray') + '">' + esc(B.tx('ord_' + o.status)) + '</span></div>' +
      '<div class="small mt">' + esc(o.phone) + ' · ' + esc(B.tx('ord_items', { n: o.item_count })) + ' · <b>' + esc(B.tx('ord_total')) + ' ' + inrf(o.total) + '</b></div>' +
      (lines ? '<ul class="small ord-lines">' + lines + '</ul>' : '') +
      (o.note ? '<p class="small"><b>' + esc(B.tx('ord_note')) + ':</b> ' + esc(o.note) + '</p>' : '') +
      '<div class="row wrap mt"><label class="small" style="flex:1 1 180px">' + esc(B.tx('ord_status')) +
      '<select class="in" data-v2s="status" data-id="' + esc(o.id) + '">' +
      ORDER_STATUSES.map(function (s) {
        var ok = B.isOwner() || s === o.status || (ORDER_NEXT[o.status] || []).indexOf(s) >= 0;
        return '<option value="' + s + '"' + (s === o.status ? ' selected' : '') + (ok ? '' : ' disabled') + '>' + esc(B.tx('ord_' + s)) + '</option>';
      }).join('') +
      '</select></label>' +
      '<a class="btn sec" target="_blank" rel="noopener" href="' + esc(waUrl(phone, B.tx('ord_reply_text', { name: o.name, ref: o.ref }))) + '">' + esc(B.tx('ord_reply')) + '</a>' +
      '<a class="btn sec" href="tel:' + esc(phone) + '">' + esc(B.tx('ord_call')) + '</a></div></section>';
  }

  document.addEventListener('change', async function (e) {
    var el = e.target.closest && e.target.closest('[data-v2s="status"]'); if (!el) return;
    try {
      await B.api('/orders/' + encodeURIComponent(el.getAttribute('data-id')) + '/status', 'PUT', { status: el.value });
      B.toast(B.tx('ord_saved'));
    } catch (err) { B.toast(err.message); }
    var v = document.getElementById('view');
    if (v && B.S.page === 'orders') renderOrders(v);
    refreshBadge(true);
  });

  document.addEventListener('click', async function (e) {
    var el = e.target.closest && e.target.closest('[data-v2s]'); if (!el) return;
    var act = el.getAttribute('data-v2s');
    if (['filter', 'hide', 'older', 'cancelnew'].indexOf(act) < 0) return;
    var v = document.getElementById('view'); if (!v) return;
    if (act === 'filter') { ordStatus = el.getAttribute('data-status') || ''; return renderOrders(v, false); }
    if (act === 'hide') { ordHide = !ordHide; return renderOrders(v, false); }
    if (act === 'older') { return renderOrders(v, true); }
    // Owner only: marks every order still in "new" as cancelled (used for junk orders).
    if (!B.isOwner() || !lastNew) return;
    if (!window.confirm(B.tx('ord_cancel_new_confirm', { n: lastNew }))) return;
    el.disabled = true;
    try {
      var r = await B.api('/orders/cancel-new', 'POST', {});
      B.toast(B.tx('ord_cancel_new_done', { n: r.cancelled || 0 }));
    } catch (err) { B.toast(err.message); }
    refreshBadge(true);
    renderOrders(v, false);
  });

  // The new-orders badge on the Orders link (sidebar and More list).
  function paintBadges(n) {
    document.querySelectorAll('[data-v2-nav="orders"], [data-v2-more="orders"]').forEach(function (a) {
      var old = a.querySelector('[data-v2-badge]'); if (old) old.parentNode.removeChild(old);
      if (n > 0) {
        var b = document.createElement('span');
        b.className = 'badge amber'; b.setAttribute('data-v2-badge', ''); b.style.marginLeft = 'auto';
        b.textContent = String(n);
        a.appendChild(b);
      }
    });
  }
  function refreshBadge(force) {
    if (!B.S.me || !B.can('orders')) return;
    if (!force && lastNew !== null && Date.now() - lastFetch < 30000) { paintBadges(lastNew); return; }
    lastFetch = Date.now();
    B.api('/orders?status=new').then(function (r) { lastNew = r.new_count || 0; paintBadges(lastNew); }).catch(function () {});
  }
  // Runs after the page is drawn, so the sidebar link exists by then.
  B.on('*', function () { setTimeout(function () { refreshBadge(false); }, 0); });
  setInterval(function () { if (B.S.me) refreshBadge(true); }, 120000);

  /* ---------- 3. Public: the store a buyer opens from the link ---------- */
  var PS = { slug: '', shop: null, items: [], cart: {}, lang: 'en', q: '' };

  function T(k, vars) {
    var d = (window.I18N && window.I18N[PS.lang]) || {};
    var s = d[k] || (window.I18N && window.I18N.en && window.I18N.en[k]) || k;
    if (vars) Object.keys(vars).forEach(function (n) { s = s.split('{' + n + '}').join(vars[n]); });
    return s;
  }
  function $(sel) { return document.querySelector(sel); }

  // Called by app.js on load. Returns true when it took over the page (a store link).
  B.publicStore = function () {
    var slug = (new URLSearchParams(location.search).get('shop') || '').trim();
    if (!slug) return false;
    PS.slug = slug;
    var app = document.getElementById('app');
    app.innerHTML = '<div class="ps"><p class="muted">' + esc(T('pub_loading')) + '</p></div>';
    loadPublic(app);
    return true;
  };

  async function loadPublic(app) {
    var r = null;
    try { r = await fetchPublicStore(PS.slug); } catch (e) {
      app.innerHTML = '<div class="ps"><div class="ps-card">' + esc(T('pub_error')) + '</div></div>';
      return;
    }
    if (!r || !r.found) {
      app.innerHTML = '<div class="ps"><div class="ps-card">' + esc(T('pub_closed')) + '</div></div>';
      return;
    }
    PS.shop = r.shop || {};
    PS.items = r.items || [];
    PS.lang = (window.I18N && window.I18N[PS.shop.lang]) ? PS.shop.lang : 'en';
    document.documentElement.lang = PS.lang;
    document.title = PS.shop.name || 'BizGrow';
    paintPublic(app);
  }

  function paintPublic(app) {
    var sh = PS.shop;
    var phone = sh.phone ? '<a href="tel:' + esc(digits(sh.phone)) + '">' + esc(sh.phone) + '</a>' : '';
    app.innerHTML = '<div class="ps">' +
      '<header><h1>' + esc(sh.name || '') + '</h1><div class="ps-meta">' + esc(sh.city || '') + (sh.city && phone ? ' · ' : '') + phone + '</div></header>' +
      '<p class="ps-intro">' + esc(T('pub_intro')) + '</p>' +
      '<input id="psSearch" class="ps-search" type="search" placeholder="' + esc(T('pub_search')) + '" aria-label="' + esc(T('pub_search')) + '">' +
      '<div id="psList" class="ps-list"></div>' +
      '<section class="ps-card" id="psCart"></section>' +
      '<section class="ps-card" id="psForm">' +
      '<label class="ps-field">' + esc(T('pub_name')) + '<input id="psName" autocomplete="name" maxlength="60"></label>' +
      '<label class="ps-field">' + esc(T('pub_phone')) + '<input id="psPhone" type="tel" inputmode="numeric" autocomplete="tel" maxlength="20"></label>' +
      '<label class="ps-field">' + esc(T('pub_note')) + '<textarea id="psNote" rows="2" maxlength="300"></textarea></label>' +
      '<button id="psSend" class="ps-send" data-ps="send" type="button">' + esc(T('pub_send')) + '</button>' +
      '<div id="psMsg" class="ps-msg" role="alert"></div>' +
      '</section>' +
      '<div id="psDone"></div>' +
      '</div>';
    $('#psSearch').addEventListener('input', function (e) { PS.q = e.target.value; renderList(); });
    renderList(); renderCart();
  }

  function cartQty(id) { return PS.cart[String(id)] || 0; }

  // The most one order may take for an item: the stock the server reports (max_qty), never more than 9999.
  function maxQty(item) {
    if (item.max_qty === undefined || item.max_qty === null) return 9999;
    var m = Math.floor(Number(item.max_qty)); if (!isFinite(m) || m < 0) m = 0;
    return Math.min(m, 9999);
  }

  function renderList() {
    var box = $('#psList'); if (!box) return;
    var q = PS.q.trim().toLowerCase();
    var rows = PS.items.filter(function (it) {
      return !q || String(it.name || '').toLowerCase().indexOf(q) >= 0 || String(it.category || '').toLowerCase().indexOf(q) >= 0;
    });
    if (!rows.length) { box.innerHTML = '<p class="muted">' + esc(T('pub_none')) + '</p>'; return; }
    box.innerHTML = rows.map(function (it) {
      var id = esc(String(it.id));
      var per = it.unit ? T('pub_per', { price: inrf(it.price), unit: it.unit }) : inrf(it.price);
      var cap = maxQty(it);
      if (it.max_qty !== undefined && it.max_qty !== null) per += ' · ' + T('pub_max', { n: B.qn(cap) });
      var q2 = cartQty(it.id);
      var ctrl = q2 > 0
        ? '<div class="ps-step"><button type="button" class="ps-btn" data-ps="dec" data-id="' + id + '" aria-label="' + esc(T('pub_less')) + '">−</button>' +
          '<span>' + esc(B.qn(q2)) + '</span><button type="button" class="ps-btn" data-ps="inc" data-id="' + id + '" aria-label="' + esc(T('pub_more')) + '"' + (q2 >= cap ? ' disabled' : '') + '>+</button></div>'
        : '<button type="button" class="ps-btn ps-add" data-ps="add" data-id="' + id + '"' + (cap < 1 ? ' disabled' : '') + '>' + esc(T('pub_add')) + '</button>';
      return '<div class="ps-item"><div class="ps-info"><b>' + esc(it.name) + '</b><small>' + esc(per) + '</small></div>' + ctrl + '</div>';
    }).join('');
  }

  function cartLines() {
    return Object.keys(PS.cart).map(function (k) {
      var item = PS.items.find(function (i) { return String(i.id) === k; });
      return item ? { item: item, qty: PS.cart[k] } : null;
    }).filter(Boolean);
  }

  function renderCart() {
    var box = $('#psCart'); if (!box) return;
    var lines = cartLines();
    if (!lines.length) { box.innerHTML = '<h2>' + esc(T('pub_cart')) + '</h2><p class="muted">' + esc(T('pub_cart_empty')) + '</p>'; return; }
    var total = 0;
    var rows = lines.map(function (l) {
      var lt = Math.round(l.item.price * l.qty * 100) / 100; total += lt;
      return '<div class="ps-line"><div class="ps-grow">' + esc(l.item.name) + ' × ' + esc(B.qn(l.qty)) + (l.item.unit ? ' ' + esc(l.item.unit) : '') +
        ' = <b>' + inrf(lt) + '</b></div><button type="button" class="ps-btn" data-ps="rm" data-id="' + esc(String(l.item.id)) + '">' + esc(T('pub_remove')) + '</button></div>';
    }).join('');
    box.innerHTML = '<h2>' + esc(T('pub_cart')) + ' (' + esc(T('pub_items', { n: lines.length })) + ')</h2>' + rows +
      '<div class="ps-total"><span>' + esc(T('pub_total')) + '</span><span>' + inrf(total) + '</span></div>';
  }

  function setQty(id, qty) {
    var k = String(id);
    var item = PS.items.find(function (i) { return String(i.id) === k; });
    var n = Math.min(qty, item ? maxQty(item) : 9999);
    if (n <= 0) delete PS.cart[k]; else PS.cart[k] = n;
  }

  function showMsg(text) { var m = $('#psMsg'); if (m) m.textContent = text || ''; }

  // Built from the lines and total the order function saved and returned, not from the page's cached prices.
  function buildMessage(ref, name, phone, note, lines, total) {
    var out = [T('pub_wa_head', { ref: ref }), '', T('pub_wa_name') + ': ' + name, T('pub_wa_phone') + ': ' + phone];
    lines.forEach(function (l) {
      out.push('- ' + l.name + ' x ' + B.qn(l.qty) + (l.unit ? ' ' + l.unit : '') + ' = ' + inrf(l.line_total));
    });
    out.push(T('pub_wa_total') + ': ' + inrf(total));
    if (note) out.push(T('pub_wa_note') + ': ' + note);
    return out.join('\n');
  }

  async function sendOrder() {
    showMsg('');
    var name = ($('#psName').value || '').trim();
    var phone = digits($('#psPhone').value);
    var note = ($('#psNote').value || '').trim();
    var lines = cartLines();
    if (!lines.length) return showMsg(T('pub_need_items'));
    if (name.length < 2) return showMsg(T('pub_need_name'));
    if (phone.length < 10 || phone.length > 13) return showMsg(T('pub_need_phone'));

    // Open the WhatsApp window now, inside the tap, so phones do not block it.
    var w = null; try { w = window.open('', '_blank'); } catch (e) { w = null; }
    var btn = $('#psSend'); btn.disabled = true; btn.textContent = T('pub_sending');
    var reset = function () { btn.disabled = false; btn.textContent = T('pub_send'); };

    var res, data = {};
    try {
      res = await fetch('/api/public/order', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ shop: PS.slug, name: name, phone: phone, note: note,
          items: lines.map(function (l) { return { product_id: l.item.id, qty: l.qty }; }) })
      });
      data = await res.json().catch(function () { return {}; });
    } catch (e) {
      if (w && !w.closed) w.close();
      reset(); return showMsg(T('pub_error'));
    }
    if (!res.ok || !data.ok) {
      if (w && !w.closed) w.close();
      reset(); return showMsg(data.error || T('pub_error'));
    }

    var total = data.total != null ? Number(data.total) : 0;
    var savedLines = Array.isArray(data.lines) ? data.lines : [];
    var url = waUrl(PS.shop.phone, buildMessage(data.ref, name, phone, note, savedLines, total));
    if (w && !w.closed) { try { w.location.href = url; } catch (e) { /* the button below still works */ } }
    PS.cart = {};
    renderList(); renderCart(); reset();
    $('#psDone').innerHTML = '<div class="ps-done"><b>' + esc(T('pub_sent', { ref: data.ref })) + '</b><br>' +
      '<a class="ps-wa" target="_blank" rel="noopener" href="' + esc(url) + '">' + esc(T('pub_send')) + '</a></div>';
    $('#psDone').scrollIntoView ? $('#psDone').scrollIntoView({ block: 'center' }) : null;
  }

  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-ps]'); if (!el) return;
    var act = el.getAttribute('data-ps');
    var id = el.getAttribute('data-id');
    if (act === 'send') { sendOrder(); return; }
    var cur = cartQty(id);
    if (act === 'add' || act === 'inc') setQty(id, cur + 1);
    else if (act === 'dec') setQty(id, cur - 1);
    else if (act === 'rm') setQty(id, 0);
    else return;
    renderList(); renderCart();
  });
})();
