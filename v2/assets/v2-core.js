/* BizGrow v2 layer: shared helpers and the one hook every v2 feature uses.
   Loaded after app.js. Uses window.BGV2 that app.js exposes. Demo only. */
(function () {
  'use strict';
  var B = window.BGV2;
  if (!B) return;
  var list = [];

  // Each feature file calls V2.on(pages, fn). fn(view, args, page) runs after that page renders.
  B.on = function (pages, fn) { list.push({ pages: pages, fn: fn }); };
  B.after = function (page, view, args) {
    list.forEach(function (h) {
      if (h.pages === '*' || h.pages.indexOf(page) >= 0) {
        try { h.fn(view, args || [], page); } catch (e) { /* a broken add-on must not break the page */ }
      }
    });
    addNavLinks();
  };

  // Text in the member's language, with {name}-style slots filled in. Falls back to English.
  B.tx = function (k, vars) {
    var d = (window.I18N && window.I18N[B.S.lang]) || {};
    var s = d[k] || (window.I18N && window.I18N.en && window.I18N.en[k]) || k;
    if (vars) Object.keys(vars).forEach(function (n) { s = s.split('{' + n + '}').join(vars[n]); });
    return s;
  };
  B.qn = function (n) { return (Math.round((+n || 0) * 1000) / 1000).toString(); };
  B.today = function () { return new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10); };
  B.assistant = function () { return (B.S.me && B.S.me.shop && B.S.me.shop.assistant_name) || 'Chotu'; };
  B.v2role = function () { return (B.S.me && B.S.me.v2role) || 'owner'; };

  // What each role may do in the screens. Mirrors the rules the demo backend enforces.
  // Same keys as the demo backend, so the screens and the server agree.
  var PERM = {
    owner: ['sale', 'sale.edit', 'sale.delete', 'discount', 'backdate', 'product', 'customer', 'payment', 'expense', 'task', 'supplier', 'team', 'settings', 'view_money', 'audit', 'audit.undo', 'summary', 'export', 'erase', 'stock_override', 'orders'],
    manager: ['sale', 'sale.edit', 'sale.delete', 'discount', 'backdate', 'product', 'customer', 'payment', 'expense', 'task', 'supplier', 'view_money', 'audit', 'audit.undo', 'summary', 'orders'],
    cashier: ['sale', 'customer', 'payment', 'discount', 'orders'],
    'stock-keeper': ['product', 'supplier'],
    accountant: ['view_money', 'audit', 'summary']
  };
  B.can = function (p) { return (PERM[B.v2role()] || []).indexOf(p) >= 0; };

  // Re-load the lists the billing and khata screens use.
  B.refresh = async function () {
    B.S.products = (await B.api('/products')).items;
    B.S.customers = (await B.api('/customers')).items;
  };

  // Put a card under the page heading (or at the top if there is none).
  B.placeTop = function (v, html) {
    var top = v.querySelector(".top");
    if (top) top.insertAdjacentHTML("afterend", html); else v.insertAdjacentHTML("afterbegin", html);
  };

  // A small helper to make a button-looking link for the v2 screens.
  B.btn = function (label, act, extra) {
    return '<button class="btn ' + (extra || '') + '" data-act="' + act + '">' + label + '</button>';
  };

  // Menu items for the new pages. Added to the sidebar and the More list, not a new menu.
  var NAV = [
    { key: 'audit', label: 'v2_nav_audit', roles: ['owner', 'manager', 'accountant'] },
    { key: 'summary', label: 'v2_nav_summary', roles: ['owner', 'manager', 'accountant'] },
    { key: 'orders', label: 'orders', roles: ['owner', 'manager', 'cashier'] }
  ];
  B.navItems = function () {
    return NAV.filter(function (n) { return B.can(n.key); });
  };
  function addNavLinks() {
    var side = document.querySelector('.nav');
    if (side && !side.querySelector('[data-v2-nav]')) {
      B.navItems().forEach(function (n) {
        var a = document.createElement('a');
        a.href = '#/' + n.key; a.setAttribute('data-v2-nav', n.key);
        a.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M9 5h11M9 12h11M9 19h11M4 5h.01M4 12h.01M4 19h.01"/></svg><span>' + B.esc(B.tx(n.label)) + '</span>';
        if (B.S.page === n.key) a.className = 'on';
        side.appendChild(a);
      });
    }
  }
  B.addMoreLinks = function (listEl) {
    if (!listEl || listEl.querySelector('[data-v2-more]')) return;
    B.navItems().forEach(function (n) {
      var a = document.createElement('a');
      a.className = 'li'; a.href = '#/' + n.key; a.style.color = 'inherit'; a.setAttribute('data-v2-more', n.key);
      a.innerHTML = '<span class="grow bold">' + B.esc(B.tx(n.label)) + '</span><span class="muted">›</span>';
      listEl.appendChild(a);
    });
  };
})();
