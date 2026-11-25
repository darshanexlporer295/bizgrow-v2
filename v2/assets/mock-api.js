/* BizGrow v2 demo stand-in backend. Runs in the browser only.
   Intercepts fetch('/api/...') and answers with the same shapes the front-end expects.
   All data is EXAMPLE data kept in this browser's localStorage. No server, no real accounts. */
(function () {
  'use strict';
  var KEY = 'bgv2_demo_v1';
  var IST = 330 * 60000, DAY = 864e5;
  var mem = null;

  function nowIso() { return new Date().toISOString(); }
  function dayOf(iso) { return new Date(new Date(iso).getTime() + IST).toISOString().slice(0, 10); }
  function todayS() { return dayOf(nowIso()); }
  function addDays(s, n) { return new Date(new Date(s + 'T00:00:00Z').getTime() + n * DAY).toISOString().slice(0, 10); }
  function daysBetween(a, b) { return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / DAY); }
  function E(msg, status) { var e = new Error(msg); e.status = status || 400; return e; }
  function num(v) { if (typeof v === 'string' && v.trim() === '') return NaN; return typeof v === 'number' ? v : (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : NaN); }
  function posNum(v, label) { var n = num(v); if (!isFinite(n) || n <= 0) throw E(label + ' must be a number above 0'); return n; }
  function text(v, label, max) {
    v = String(v == null ? '' : v).trim();
    if (!v) throw E(label + ' is needed');
    if (v.length > (max || 60)) throw E(label + ' is too long (max ' + (max || 60) + ' letters)');
    return v;
  }

  // Consent wording version. Bump it when the sign-up consent or privacy notice text changes.
  var CONSENT_VERSION = 'signup-consent-v1';
  var TRADES = ['textile', 'plastic', 'chemical', 'agri', 'other'];
  var PROBLEMS = ['udhar', 'stock', 'accounts', 'staff', 'other'];
  var TEAMS = ['just_me', '2_5', '6_20', '20_plus'];
  var OWE = ['0_10', '10_50', '50_plus'];
  function pick(v, list, label) { if (list.indexOf(v) < 0) throw E(label + ' has an answer that is not on the list'); return v; }

  function seed() {
    var today = todayS();
    var st = {
      seq: 100,
      session: { uid: null },
      shop: { id: 1, name: 'Sharma General Store (example)', phone: '9800000000', address: 'Example Road, Pune', gstin: '', upi_id: 'sharma@upi', category: 'kirana', lang: 'en', store_enabled: false, store_slug: '', onboarded: true, assistant_name: 'Chotu', staff_discount_limit: 50 },
      users: [
        { id: 1, name: 'Demo Owner', email: 'owner@example.com', v2role: 'owner', status: 'active' },
        { id: 2, name: 'Sunita (cashier)', email: 'sunita@example.com', v2role: 'cashier', status: 'active' },
        { id: 3, name: 'Ravi (stock-keeper)', email: 'ravi@example.com', v2role: 'stock-keeper', status: 'active' },
        { id: 4, name: 'Meena (accountant)', email: 'meena@example.com', v2role: 'accountant', status: 'active' },
        { id: 5, name: 'Asha (manager)', email: 'asha@example.com', v2role: 'manager', status: 'active' }
      ],
      products: [
        { id: 1, name: 'Atta 5 kg', sku: 'ATTA5', category: 'Grocery', unit: 'pack', price: 240, cost: 205, stock: 12, reorder: 5, deleted_at: null },
        { id: 2, name: 'Sugar', sku: 'SUG1', category: 'Grocery', unit: 'kg', price: 46, cost: 40, stock: 3, reorder: 5, deleted_at: null },
        { id: 3, name: 'Tea 250 g', sku: 'TEA250', category: 'Grocery', unit: 'pack', price: 110, cost: 92, stock: 20, reorder: 6, deleted_at: null },
        { id: 4, name: 'Milk 500 ml', sku: 'MILK500', category: 'Dairy', unit: 'pack', price: 30, cost: 26, stock: 14, reorder: 10, deleted_at: null },
        { id: 5, name: 'Biscuits', sku: 'BISC', category: 'Snacks', unit: 'pack', price: 20, cost: 16, stock: 0, reorder: 8, deleted_at: null },
        { id: 6, name: 'Oil 1 L', sku: 'OIL1', category: 'Grocery', unit: 'bottle', price: 165, cost: 145, stock: 7, reorder: 4, deleted_at: null },
        { id: 7, name: 'Soap', sku: 'SOAP', category: 'Personal care', unit: 'pc', price: 40, cost: 31, stock: 25, reorder: 8, deleted_at: null }
      ],
      customers: [
        { id: 1, name: 'Ramesh Patil', phone: '9800011111', note: 'Example customer', advance: 0, created_at: nowIso(), deleted_at: null },
        { id: 2, name: 'Sunita Joshi', phone: '9800022222', note: 'Example customer', advance: 0, created_at: nowIso(), deleted_at: null },
        { id: 3, name: 'Imran Shaikh', phone: '9800033333', note: 'Example customer', advance: 0, created_at: nowIso(), deleted_at: null },
        { id: 4, name: 'Sharma ji', phone: '9800055555', note: 'Example customer', advance: 0, created_at: nowIso(), deleted_at: null }
      ],
      sales: [], payments: [], expenses: [], tasks: [
        { id: 1, title: 'Call supplier about atta delivery (example)', due: addDays(today, 1), priority: 'high', done: false },
        { id: 2, title: 'Check expiry dates on biscuits (example)', due: today, priority: 'normal', done: false }
      ], suppliers: [
        { id: 1, name: 'Patil Wholesale (example)', phone: '9800044444', items: 'Atta, sugar, oil', note: '' }
      ], audit: [], erased: false,
      signup: { done: true, answers: {} }, consents: []
    };
    var seqN = 1;
    function mk(cid, cname, method, lines, dateS, dueS, paid, disc) {
      var sub = 0, items = lines.map(function (l) { var p = st.products[l[0] - 1]; sub += p.price * l[1]; return { product_id: p.id, name: p.name, price: p.price, cost: p.cost, qty: l[1] }; });
      var total = sub - (disc || 0);
      return { id: seqN++, bill_no: 'EX-' + String(seqN).padStart(4, '0'), customer_id: cid, customer_name: cname, method: method, items: items, subtotal: sub, discount: disc || 0, total: total, paid: paid, date: dateS, due_date: dueS || null, created_at: new Date(new Date(dateS + 'T10:00:00Z').getTime() - IST).toISOString(), note: '', deleted_at: null, created_by: 1 };
    }
    for (var d = 0; d < 7; d++) {
      var ds = addDays(today, -d);
      st.sales.push(mk(null, '', d % 2 ? 'upi' : 'cash', [[1, 1], [4, 2]], ds, null, 0, 0));
      st.sales.push(mk(null, '', 'cash', [[3, 1], [7, 2]], ds, null, 0, 0));
      if (d % 2 === 0) st.sales.push(mk(null, '', 'upi', [[6, 1], [2, 2]], ds, null, 0, 0));
    }
    st.sales.push(mk(1, 'Ramesh Patil', 'udhar', [[1, 2]], addDays(today, -12), addDays(today, -4), 0, 0));
    st.sales.push(mk(3, 'Imran Shaikh', 'udhar', [[3, 1]], addDays(today, -30), addDays(today, -20), 0, 0));
    st.sales.push(mk(2, 'Sunita Joshi', 'udhar', [[6, 2]], addDays(today, -3), addDays(today, 27), 100, 0));
    st.sales.push(mk(1, 'Ramesh Patil', 'udhar', [[7, 3]], addDays(today, -1), addDays(today, 29), 0, 0));
    st.sales.forEach(function (s) { if (s.method !== 'udhar') s.paid = s.total; });
    // seed stock so the example looks used (stock already reflects only the listed cut)
    st.expenses.push({ id: 1, amount: 450, category: 'Electricity', note: 'Example', date: today, created_at: nowIso(), deleted_at: null });
    st.expenses.push({ id: 2, amount: 300, category: 'Transport', note: 'Example', date: addDays(today, -1), created_at: nowIso(), deleted_at: null });
    st.seq = 202;
    // Two example orders so the Orders screen and its new-orders badge can be seen in the demo.
    var exLine = function (p, q) { return { name: p.name, unit: p.unit, price: p.price, qty: q, line_total: p.price * q }; };
    var o1 = [exLine(st.products[0], 2), exLine(st.products[1], 1)];
    var o2 = [exLine(st.products[2], 5)];
    st.orders = [
      { id: 201, ref: refOf(201), name: 'Example buyer', phone: '9800011111', note: 'Please pack well', status: 'new', item_count: o1.length, total: sumLines(o1), created_at: nowIso(), lines: o1 },
      { id: 202, ref: refOf(202), name: 'Example retailer', phone: '9800022222', note: '', status: 'accepted', item_count: o2.length, total: sumLines(o2), created_at: nowIso(), lines: o2 }
    ];
    return st;
  }
  function seedEmpty() {
    var st = seed();
    st.products = []; st.customers = []; st.sales = []; st.expenses = []; st.tasks = []; st.suppliers = []; st.audit = [];
    st.payments = []; st.erased = true; st.consents = []; st.orders = [];
    st.shop.name = 'My shop (cleared demo)';
    st.users = st.users.slice(0, 1);
    return st;
  }
  function load() {
    if (mem) return mem;
    var st = null;
    try { var raw = localStorage.getItem(KEY); if (raw) st = JSON.parse(raw); } catch (e) { st = null; }
    if (!st) st = seed();
    // Saved demo data from earlier builds has no sign-up or consent fields yet.
    if (!st.signup) st.signup = { done: true, answers: {} };
    if (!st.consents) st.consents = [];
    if (!st.orders) st.orders = [];
    mem = st; return st;
  }
  function save(st) { mem = st; try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* in-memory fallback */ } }
  function nid(st) { st.seq += 1; return st.seq; }
  // Same shape as the real order reference: 6 characters, upper case.
  function refOf(n) { return (((n * 7919) % 16777216).toString(16)).toUpperCase().padStart(6, '0'); }
  function sumLines(ls) { return Math.round(ls.reduce(function (a, l) { return a + l.line_total; }, 0) * 100) / 100; }
  var STATUSES = ['new', 'accepted', 'packed', 'delivered', 'cancelled'];
  function slugOf(name) {
    var base = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'shop';
    return base + '-' + Math.random().toString(16).slice(2, 8);
  }

  function me(st) { return st.users.find(function (u) { return u.id === st.session.uid && !u.deleted_at; }); }
  function appRole(u) { return u.v2role === 'owner' ? 'owner' : (u.v2role === 'manager' ? 'manager' : (u.v2role === 'accountant' ? 'manager' : 'staff')); }
  var PERM = {
    owner: ['orders', 'sale', 'sale.edit', 'sale.delete', 'discount', 'backdate', 'product', 'customer', 'payment', 'expense', 'task', 'supplier', 'team', 'settings', 'view_money', 'audit', 'audit.undo', 'summary', 'export', 'erase', 'stock_override'],
    manager: ['orders', 'sale', 'sale.edit', 'sale.delete', 'discount', 'backdate', 'product', 'customer', 'payment', 'expense', 'task', 'supplier', 'view_money', 'audit', 'audit.undo', 'summary'],
    cashier: ['orders', 'sale', 'customer', 'payment', 'discount'],
    'stock-keeper': ['product', 'supplier'],
    accountant: ['view_money', 'audit', 'summary']
  };
  function can(u, p) { return (PERM[u.v2role] || []).indexOf(p) >= 0; }
  function need(st, p, msg) { var u = me(st); if (!u) throw E('Please log in again.', 401); if (!can(u, p)) throw E(msg || 'Your role does not allow this. Ask the owner.', 403); return u; }

  function audit(st, u, action, entity, entityId, label, before, after) {
    st.audit.unshift({ id: nid(st), at: nowIso(), by: u.name, role: u.v2role, action: action, entity: entity, entity_id: entityId, label: label, before: before || null, after: after || null, undone: false });
  }
  function liveSales(st) { return st.sales.filter(function (s) { return !s.deleted_at; }); }
  function balanceOf(st, cid) {
    var due = 0;
    liveSales(st).forEach(function (s) { if (s.customer_id === cid && s.method === 'udhar') due += Math.max(0, s.total - s.paid); });
    var c = st.customers.find(function (x) { return x.id === cid; });
    return Math.round((due - ((c && c.advance) || 0)) * 100) / 100;
  }
  function applyPayment(st, c, amount) {
    var rest = amount, allocs = [];
    liveSales(st).filter(function (s) { return s.customer_id === c.id && s.method === 'udhar' && s.total > s.paid; })
      .sort(function (a, b) { return a.created_at < b.created_at ? -1 : 1; })
      .forEach(function (s) { var take = Math.min(s.total - s.paid, rest); if (take > 0) { s.paid += take; rest -= take; allocs.push({ sale_id: s.id, amount: take }); } });
    if (rest > 0) c.advance = (c.advance || 0) + rest;
    return { allocs: allocs, advance_added: rest > 0 ? rest : 0 };
  }

  function custOut(st, c) { return { id: c.id, name: c.name, phone: c.phone, note: c.note, balance: balanceOf(st, c.id), advance: c.advance || 0, last_credit: (liveSales(st).filter(function (s) { return s.customer_id === c.id && s.method === 'udhar'; }).sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; })[0] || {}).date || null }; }

  function sumBy(arr, f) { return arr.reduce(function (s, x) { return s + f(x); }, 0); }

  function dashboard(st, u) {
    var today = todayS(), yest = addDays(today, -1);
    var ts = liveSales(st).filter(function (s) { return s.date === today; });
    var ys = liveSales(st).filter(function (s) { return s.date === yest; });
    var te = st.expenses.filter(function (x) { return !x.deleted_at && x.date === today; });
    var cost = sumBy(ts, function (s) { return sumBy(s.items, function (i) { return i.cost * i.qty; }); });
    var pays = st.payments.filter(function (p) { return dayOf(p.at) === today; });
    var collected = sumBy(ts, function (s) { return s.paid; }) + sumBy(pays, function (p) { return p.amount; });
    var canMoney = can(u, 'view_money');
    var udhar = null;
    if (canMoney) {
      var people = st.customers.filter(function (c) { return !c.deleted_at && balanceOf(st, c.id) > 0; });
      udhar = { total: Math.round(sumBy(people, function (c) { return balanceOf(st, c.id); })), people: people.length };
    }
    var salesToday = sumBy(ts, function (s) { return s.total; });
    var expToday = sumBy(te, function (x) { return x.amount; });
    return {
      today: { sales: salesToday, bills: ts.length, expenses: expToday, profit: canMoney ? salesToday - cost - expToday : null, collected: collected },
      yesterday: { sales: sumBy(ys, function (s) { return s.total; }), bills: ys.length },
      udhar: udhar || { total: null, people: 0 },
      low_stock: st.products.filter(function (p) { return !p.deleted_at && p.stock <= p.reorder; }),
      setup: { items: st.products.filter(function (p) { return !p.deleted_at; }).length },
      tasks_due: st.tasks.filter(function (t) { return !t.done && t.due <= today; }).length
    };
  }

  function validateItems(st, items, override, u) {
    if (!Array.isArray(items) || !items.length) throw E('Add at least one item to the bill');
    if (items.length > 30) throw E('A bill can have at most 30 items. Split it into two bills.');
    var need = {};
    var out = items.map(function (it) {
      var qty = posNum(it.qty, 'Quantity');
      if (qty > 9999) throw E('Quantity is too large');
      var price = posNum(it.price, 'Price');
      if (it.product_id != null) {
        var p = st.products.find(function (x) { return x.id === it.product_id && !x.deleted_at; });
        if (!p) throw E('"' + (it.name || 'An item') + '" is not in your stock list. Remove it and try again.');
        need[p.id] = (need[p.id] || 0) + qty;
        return { product_id: p.id, name: p.name, price: price, cost: p.cost, qty: qty };
      }
      var nm = text(it.name, 'Item name', 60);
      return { product_id: null, name: nm, price: price, cost: 0, qty: qty };
    });
    Object.keys(need).forEach(function (pid) {
      var p = st.products.find(function (x) { return x.id === +pid; });
      if (p.stock - need[pid] < 0 && !override) throw E('Only ' + p.stock + ' ' + p.unit + ' of ' + p.name + ' left. The owner can allow more.');
      if (p.stock - need[pid] < 0 && override && u.v2role !== 'owner') throw E('Only the owner can allow stock below zero', 403);
    });
    return { lines: out, stockNeed: need };
  }
  function applyStock(st, need, sign) { Object.keys(need).forEach(function (pid) { var p = st.products.find(function (x) { return x.id === +pid; }); if (p) p.stock = Math.round((p.stock + sign * need[pid]) * 1000) / 1000; }); }

  function createSale(st, u, b) {
    if (!can(u, 'sale')) throw E('Your role cannot make bills. Ask the owner.', 403);
    var ov = !!b.stock_override;
    var v = validateItems(st, b.items, ov, u);
    var sub = sumBy(v.lines, function (l) { return l.price * l.qty; });
    var disc = b.discount == null || b.discount === '' ? 0 : num(b.discount);
    if (!isFinite(disc) || disc < 0) throw E('Discount must be 0 or more');
    if (disc > sub) throw E('Discount cannot be more than the bill (' + Math.round(sub) + ')');
    if (disc > 0 && !can(u, 'discount')) throw E('Your role cannot give discounts', 403);
    if (disc > 0 && u.v2role === 'cashier' && disc > st.shop.staff_discount_limit) throw E('Discount above ₹' + st.shop.staff_discount_limit + ' needs the owner. Ask the owner.', 403);
    var method = b.method || 'cash';
    if (['cash', 'upi', 'udhar'].indexOf(method) < 0) throw E('Pick cash, UPI or udhar');
    var cust = null;
    if (method === 'udhar') {
      if (b.customer_id) cust = st.customers.find(function (c) { return c.id === +b.customer_id && !c.deleted_at; });
      if (!cust) throw E('Pick a customer for udhar');
    }
    var date = todayS();
    if (b.date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date)) throw E('Pick a valid date');
      if (b.date > date) throw E('The date cannot be in the future');
      if (b.date < date) { if (!can(u, 'backdate')) throw E('Only the owner or manager can back-date a bill', 403); date = b.date; }
    }
    var total = Math.round((sub - disc) * 100) / 100;
    var paid = method === 'udhar' ? Math.min(total, Math.max(0, num(b.paid) || 0)) : total;
    var dueS = method === 'udhar' ? addDays(date, 30) : null;
    if (method === 'udhar' && cust.advance > 0 && paid < total) { var use = Math.min(cust.advance, total - paid); paid += use; cust.advance -= use; }
    var s = { id: nid(st), bill_no: 'B' + String(st.sales.length + 1).padStart(4, '0'), customer_id: cust ? cust.id : null, customer_name: cust ? cust.name : '', method: method, items: v.lines, subtotal: sub, discount: disc, total: total, paid: paid, date: date, due_date: dueS, created_at: nowIso(), note: b.note ? String(b.note).slice(0, 120) : '', deleted_at: null, created_by: u.id, override: ov };
    st.sales.push(s);
    applyStock(st, v.stockNeed, -1);
    audit(st, u, 'create', 'sale', s.id, 'Bill ' + s.bill_no + ' ' + total, null, { deleted_at: null });
    if (disc > 0) audit(st, u, 'discount', 'sale', s.id, 'Discount ' + disc + ' on ' + s.bill_no, { discount: 0 }, { discount: disc });
    if (date !== todayS()) audit(st, u, 'back-date', 'sale', s.id, 'Back-dated ' + s.bill_no + ' to ' + date, { date: todayS() }, { date: date });
    return { id: s.id, bill_no: s.bill_no, total: total, paid: paid, method: method, date: date, due_date: dueS, discount: disc };
  }

  function route(method, path, b, qs) {
    var st = load();
    var parts = path.split('/').filter(Boolean);
    var k = parts[0] || '', id = parts[1] != null ? +parts[1] : null, sub = parts[2];

    // ---- session ----
    if (path === '/login' && method === 'POST') {
      if (!b.email || String(b.password || '').length < 8) throw E('Email or password is wrong', 401);
      st.session.uid = 1; save(st); return { ok: true };
    }
    if (path === '/signup' && method === 'POST') {
      if (!b.consent) throw E('Please tick the box to continue.');
      st.session.uid = 1;
      var signer = me(st); if (signer && b.name) signer.name = String(b.name).slice(0, 60);
      // Owners answer the sign-up questions next. Invited staff skip them.
      st.signup = { done: !!b.invite, answers: {} };
      st.consents.push({ granted: true, text_version: CONSENT_VERSION, at: nowIso() });
      save(st); return { ok: true };
    }
    if (path === '/logout' && method === 'POST') { st.session.uid = null; save(st); return { ok: true }; }
    if (path === '/password/forgot' || path === '/password/reset' || path === '/privacy/request' || path === '/privacy/erase') return { ok: true };
    if (path === '/config') return {};
    if (path === '/me') {
      var u = me(st); if (!u) throw E('Please log in', 401);
      return { user: { id: u.id, name: u.name, email: u.email, phone: '' }, role: appRole(u), v2role: u.v2role, shop: st.shop, onboarded: true, answers: {}, lang: st.shop.lang,
        signup_done: st.signup.done, signup_answers: st.signup.answers, consent: st.consents[st.consents.length - 1] || null };
    }
    // ---- online store (patch-06): the public page and orders. Anyone with the link, no sign-in. ----
    if (path === '/public/store' && method === 'GET') {
      var sl = String((qs && qs.get('shop')) || '');
      if (!st.shop.store_enabled || !st.shop.store_slug || sl !== st.shop.store_slug) return { found: false };
      return { found: true, shop: { name: st.shop.name, phone: st.shop.phone, city: st.shop.city || '', lang: st.shop.lang || 'en' },
        items: st.products.filter(function (p) { return !p.deleted_at && p.stock > 0; })
          .sort(function (a, b2) { return a.name.localeCompare(b2.name); })
          .map(function (p) { return { id: p.id, name: p.name, category: p.category, unit: p.unit, price: p.price }; }) };
    }
    if (path === '/public/order' && method === 'POST') {
      if (!st.shop.store_enabled || !st.shop.store_slug || String(b.shop || '') !== st.shop.store_slug) throw E('This store is not open right now');
      var on2 = String(b.name || '').trim().slice(0, 60);
      if (on2.length < 2) throw E('Please enter your name');
      var ph2 = String(b.phone || '').replace(/[^0-9]/g, '');
      if (ph2.length < 10 || ph2.length > 13) throw E('Please enter a valid phone number');
      var its = Array.isArray(b.items) ? b.items : [];
      if (!its.length) throw E('Your cart is empty');
      if (its.length > 40) throw E('Too many items in one order');
      var lines2 = its.map(function (it) {
        var pr2 = st.products.find(function (p) { return p.id === +it.product_id && !p.deleted_at && p.stock > 0; });
        if (!pr2) throw E('Some items are no longer in stock. Please refresh the store and try again.');
        var q2 = +it.qty; if (!(q2 > 0) || q2 > 9999) throw E('Please check the quantities');
        return { name: pr2.name, unit: pr2.unit, price: pr2.price, qty: q2, line_total: pr2.price * q2 };
      });
      var oid = nid(st);
      var ord = { id: oid, ref: refOf(oid), name: on2, phone: ph2, note: String(b.note || '').trim().slice(0, 300) || null, status: 'new',
        item_count: lines2.length, total: sumLines(lines2), created_at: nowIso(), lines: lines2 };
      st.orders.unshift(ord); save(st);
      return { ok: true, ref: ord.ref, item_count: ord.item_count, total: ord.total };
    }

    var cu = me(st); if (!cu && path !== '/config') throw E('Please log in', 401);

    // Sign-up questions (the wizard). Same shape the future server will use. Demo: kept in this browser only.
    if (path === '/signup/answers' && method === 'PUT') {
      if (!cu) throw E('Please log in', 401);
      var a = b.answers || {}, clean = {};
      if (a.shop_name != null) clean.shop_name = text(a.shop_name, 'Shop name', 60);
      if (a.trade != null) clean.trade = pick(a.trade, TRADES, 'Trade');
      if (a.city != null && String(a.city).trim() !== '') clean.city = text(a.city, 'City', 40);
      if (a.team_size != null) clean.team_size = pick(a.team_size, TEAMS, 'Team size');
      if (a.problem != null) clean.problem = pick(a.problem, PROBLEMS, 'Problem');
      if (a.udhar_customers != null) clean.udhar_customers = pick(a.udhar_customers, OWE, 'Customers who owe');
      st.signup.answers = Object.assign({}, st.signup.answers, clean);
      if (clean.shop_name) st.shop.name = clean.shop_name;
      if (b.done) {
        if (!st.signup.answers.shop_name || !st.signup.answers.trade) throw E('Shop name and trade are needed');
        st.signup.done = true;
      }
      save(st); return { ok: true, signup_done: st.signup.done };
    }
    // Consent switch on the Privacy screen. Every change is kept as a dated record.
    if (path === '/consent' && method === 'POST') {
      if (!cu) throw E('Please log in', 401);
      st.consents.push({ granted: !!b.granted, text_version: CONSENT_VERSION, at: nowIso() }); save(st);
      return { ok: true, consent: st.consents[st.consents.length - 1] };
    }
    if (path === '/language' && method === 'PUT') { st.shop.lang = b.lang || 'en'; save(st); return { ok: true }; }
    if (path === '/onboarding' && method === 'PUT') return { ok: true };
    if (path === '/business-type' && method === 'PUT') {
      need(st, 'settings', 'Only the owner can change shop details');
      var bt = String(b.business_type || '').trim();
      if (bt && ['textile_trader', 'yarn_fabric', 'raw_material', 'other'].indexOf(bt) < 0) throw E('Please pick a business type from the list');
      st.shop.business_type = bt; save(st); return { ok: true, business_type: bt };
    }
    if (path === '/business' && method === 'PUT') {
      need(st, 'settings', 'Only the owner can change shop details');
      if (b.name != null) st.shop.name = text(b.name, 'Shop name', 60);
      ['phone', 'address', 'gstin', 'upi_id'].forEach(function (f) { if (b[f] !== undefined) st.shop[f] = b[f]; });
      save(st); return { ok: true };
    }
    // Online store on or off. The link name is made once and kept (the real server does the same).
    if (path === '/store' && method === 'PUT') {
      need(st, 'settings', 'Only the owner can turn the online store on or off');
      st.shop.store_enabled = b.enabled === true;
      if (!st.shop.store_slug) st.shop.store_slug = slugOf(st.shop.name);
      save(st); return { ok: true, store_enabled: st.shop.store_enabled, store_slug: st.shop.store_slug };
    }
    // Online store orders: the shop's team sees them and moves them along.
    if (k === 'orders' && !parts[1] && method === 'GET') {
      need(st, 'orders', 'Your role cannot see orders. Ask the owner.');
      var sf = qs && qs.get('status');
      return { items: st.orders.filter(function (o) { return !sf || o.status === sf; }).slice(0, 200),
        new_count: st.orders.filter(function (o) { return o.status === 'new'; }).length };
    }
    if (k === 'orders' && id && sub === 'status' && method === 'PUT') {
      var ou = need(st, 'orders', 'Your role cannot change orders. Ask the owner.');
      var so = st.orders.find(function (o) { return o.id === id; }); if (!so) throw E('Order not found', 404);
      var ns = String(b.status || '');
      if (STATUSES.indexOf(ns) < 0) throw E('Unknown order status');
      so.status = ns; so.updated_at = nowIso();
      audit(st, ou, 'edit', 'order', id, 'Order ' + so.ref + ' marked ' + ns);
      save(st); return { ok: true, status: ns };
    }
    if (path === '/starter' && method === 'POST') { save(st); return { ok: true }; }
    if (path === '/dashboard') return dashboard(st, cu);

    // ---- products ----
    if (k === 'products' && !parts[1] && method === 'GET') return st.products.filter(function (p) { return !p.deleted_at; });
    if (k === 'products' && !parts[1] && method === 'POST') {
      need(st, 'product', 'Your role cannot change items');
      var pn = text(b.name, 'Item name', 60), pp = posNum(b.price, 'Price'), pc = num(b.cost); if (!isFinite(pc) || pc < 0) throw E('Cost must be 0 or more');
      var ps = num(b.stock || 0); if (!isFinite(ps)) throw E('Stock must be a number');
      if (ps < 0) throw E('Stock cannot be negative');
      var rl = num(b.reorder || 0); if (!isFinite(rl) || rl < 0) throw E('Reorder level must be 0 or more');
      var np = { id: nid(st), name: pn, sku: b.sku || '', category: b.category || 'General', unit: b.unit || 'pc', price: pp, cost: pc, stock: ps, reorder: rl, deleted_at: null };
      st.products.push(np); audit(st, cu, 'create', 'product', np.id, 'Item ' + pn, null, { deleted_at: null }); save(st); return { id: np.id };
    }
    if (k === 'products' && id && !sub && method === 'PUT') {
      need(st, 'product', 'Your role cannot change items');
      var pr = st.products.find(function (x) { return x.id === id && !x.deleted_at; }); if (!pr) throw E('Item not found', 404);
      var before = { name: pr.name, price: pr.price, cost: pr.cost, reorder: pr.reorder, stock: pr.stock };
      var nn = text(b.name, 'Item name', 60), npr = posNum(b.price, 'Price'), ncost = num(b.cost); if (!isFinite(ncost) || ncost < 0) throw E('Cost must be 0 or more');
      var nstock = num(b.stock); if (!isFinite(nstock)) throw E('Stock must be a number');
      if (nstock < 0 && !(b.stock_override && cu.v2role === 'owner')) throw E('Stock cannot go below zero. The owner can allow it.');
      var nrl = num(b.reorder); if (!isFinite(nrl) || nrl < 0) throw E('Reorder level must be 0 or more');
      pr.name = nn; pr.price = npr; pr.cost = ncost; pr.reorder = nrl; pr.stock = nstock; pr.unit = b.unit || pr.unit; pr.category = b.category || pr.category;
      audit(st, cu, 'edit', 'product', id, 'Item ' + nn, before, { name: nn, price: npr, cost: ncost, reorder: nrl, stock: nstock }); save(st); return { ok: true };
    }
    if (k === 'products' && id && !sub && method === 'DELETE') {
      need(st, 'product', 'Your role cannot delete items');
      var pd = st.products.find(function (x) { return x.id === id; }); if (pd) { pd.deleted_at = nowIso(); audit(st, cu, 'delete', 'product', id, 'Item ' + pd.name, { deleted_at: null }, { deleted_at: pd.deleted_at }); } save(st); return { ok: true };
    }
    if (k === 'products' && id && sub === 'adjust' && method === 'POST') {
      need(st, 'product', 'Your role cannot change stock');
      var pa = st.products.find(function (x) { return x.id === id && !x.deleted_at; }); if (!pa) throw E('Item not found', 404);
      var ch = num(b.change); if (!isFinite(ch) || ch === 0) throw E('Enter how many to add or take out (not zero)');
      var ns = pa.stock + ch;
      if (ns < 0 && !b.override) throw E('Stock cannot go below zero. Only ' + pa.stock + ' ' + pa.unit + ' left. The owner can allow it.');
      if (ns < 0 && cu.v2role !== 'owner') throw E('Only the owner can allow stock below zero', 403);
      var oldS = pa.stock; pa.stock = ns;
      audit(st, cu, 'edit', 'product', id, 'Stock ' + pa.name + ' ' + (ch > 0 ? '+' : '') + ch, { stock: oldS }, { stock: ns });
      save(st); return { ok: true };
    }
    if (k === 'products' && id && sub === 'history') {
      var ph = st.audit.filter(function (a) { return a.entity === 'product' && a.entity_id === id; }).slice(0, 20);
      return { items: ph.map(function (a) { return { reason: a.label, created_at: a.at }; }) };
    }

    // ---- customers ----
    if (k === 'customers' && !parts[1] && method === 'GET') return st.customers.filter(function (c) { return !c.deleted_at; }).map(function (c) { return custOut(st, c); });
    if (k === 'customers' && !parts[1] && method === 'POST') {
      need(st, 'customer', 'Your role cannot add customers');
      var cn = text(b.name, 'Customer name', 60); if (b.phone && !/^\d{10}$/.test(String(b.phone).replace(/\s/g, ''))) throw E('Phone should be 10 digits');
      var nc = { id: nid(st), name: cn, phone: String(b.phone || '').replace(/\s/g, ''), note: String(b.note || '').slice(0, 120), advance: 0, created_at: nowIso(), deleted_at: null };
      st.customers.push(nc); audit(st, cu, 'create', 'customer', nc.id, 'Customer ' + cn, null, { deleted_at: null }); save(st); return { id: nc.id };
    }
    if (k === 'customers' && id && !sub && method === 'GET') {
      var c1 = st.customers.find(function (c) { return c.id === id && !c.deleted_at; }); if (!c1) throw E('Customer not found', 404);
      var led = [];
      liveSales(st).filter(function (s) { return s.customer_id === id && s.method === 'udhar'; }).forEach(function (s) { led.push({ kind: 'credit', amount: s.total, created_at: s.created_at, note: s.bill_no }); });
      st.payments.filter(function (p) { return p.customer_id === id; }).forEach(function (p) { led.push({ kind: 'payment', amount: p.amount, created_at: p.at, note: p.method }); });
      led.sort(function (a, b2) { return a.created_at < b2.created_at ? -1 : 1; });
      return { customer: custOut(st, c1), balance: balanceOf(st, id), ledger: led };
    }
    if (k === 'customers' && id && !sub && method === 'PUT') {
      need(st, 'customer', 'Your role cannot edit customers');
      var c2 = st.customers.find(function (c) { return c.id === id && !c.deleted_at; }); if (!c2) throw E('Customer not found', 404);
      var before2 = { name: c2.name, phone: c2.phone };
      c2.name = text(b.name, 'Customer name', 60); c2.phone = String(b.phone || '').replace(/\s/g, '');
      audit(st, cu, 'edit', 'customer', id, 'Customer ' + c2.name, before2, { name: c2.name, phone: c2.phone }); save(st); return { ok: true };
    }
    if (k === 'customers' && id && !sub && method === 'DELETE') {
      need(st, 'customer', 'Your role cannot delete customers');
      var c3 = st.customers.find(function (c) { return c.id === id; }); if (c3 && balanceOf(st, id) > 0) throw E('This customer still owes money. Collect it first.');
      if (c3) { c3.deleted_at = nowIso(); audit(st, cu, 'delete', 'customer', id, 'Customer ' + c3.name, { deleted_at: null }, { deleted_at: c3.deleted_at }); }
      save(st); return { ok: true };
    }
    if (k === 'customers' && id && sub === 'payment' && method === 'POST') {
      need(st, 'payment', 'Your role cannot take payments');
      var c4 = st.customers.find(function (c) { return c.id === id && !c.deleted_at; }); if (!c4) throw E('Customer not found', 404);
      var amt = posNum(b.amount, 'Amount');
      var res = applyPayment(st, c4, amt);
      st.payments.push({ id: nid(st), customer_id: id, amount: amt, method: b.method || 'cash', at: nowIso(), by: cu.name, allocs: res.allocs, advance_added: res.advance_added });
      save(st); return { ok: true, advance_added: res.advance_added };
    }
    if (k === 'customers' && id && sub === 'credit' && method === 'POST') {
      need(st, 'customer', 'Your role cannot add udhar');
      var c5 = st.customers.find(function (c) { return c.id === id && !c.deleted_at; }); if (!c5) throw E('Customer not found', 404);
      var ca = posNum(b.amount, 'Amount'); var cn2 = String(b.note || 'Udhar').slice(0, 60);
      var cs = { id: nid(st), bill_no: 'U' + st.sales.length, customer_id: id, customer_name: c5.name, method: 'udhar', items: [{ product_id: null, name: cn2, price: ca, cost: 0, qty: 1 }], subtotal: ca, discount: 0, total: ca, paid: 0, date: todayS(), due_date: addDays(todayS(), 30), created_at: nowIso(), note: cn2, deleted_at: null, created_by: cu.id };
      st.sales.push(cs); audit(st, cu, 'create', 'sale', cs.id, 'Udhar ' + ca + ' for ' + c5.name, null, { deleted_at: null }); save(st); return { ok: true };
    }

    // ---- sales ----
    if (k === 'sales' && !parts[1] && method === 'GET') {
      var from = qs.get('from') || '0000', to = qs.get('to') || '9999';
      return liveSales(st).filter(function (s) { return s.date >= from && s.date <= to; }).sort(function (a, b2) { return a.created_at < b2.created_at ? 1 : -1; }).map(function (s) { return { id: s.id, bill_no: s.bill_no, total: s.total, paid: s.paid, method: s.method, customer_name: s.customer_name, customer_id: s.customer_id, discount: s.discount, created_at: s.created_at, date: s.date, note: s.note }; });
    }
    if (k === 'sales' && !parts[1] && method === 'POST') { var r0 = createSale(st, cu, b); save(st); return r0; }
    if (k === 'sales' && id && !sub && method === 'GET') {
      var s1 = st.sales.find(function (s) { return s.id === id && !s.deleted_at; }); if (!s1) throw E('Bill not found', 404);
      // Same shape as the real server: the bill fields, the items, and the bill again under sale.
      return Object.assign({}, s1, { items: s1.items, sale: Object.assign({}, s1, { items: s1.items }) });
    }
    if (k === 'sales' && id && !sub && method === 'PUT') {
      need(st, 'sale.edit', 'Only the owner or manager can edit a bill');
      var s2 = st.sales.find(function (s) { return s.id === id && !s.deleted_at; }); if (!s2) throw E('Bill not found', 404);
      var prev = { customer_id: s2.customer_id, customer_name: s2.customer_name, method: s2.method, paid: s2.paid };
      if (b.method && ['cash', 'upi', 'udhar'].indexOf(b.method) < 0) throw E('Pick cash, UPI or udhar');
      if (b.customer_id) { var cc = st.customers.find(function (c) { return c.id === +b.customer_id; }); if (cc) { s2.customer_id = cc.id; s2.customer_name = cc.name; } }
      if (b.method) s2.method = b.method;
      if (s2.method !== 'udhar') { s2.customer_id = s2.customer_id; s2.paid = s2.total; } else if (b.paid != null) { s2.paid = Math.min(s2.total, Math.max(0, num(b.paid) || 0)); }
      audit(st, cu, 'edit', 'sale', id, 'Bill ' + s2.bill_no, prev, { customer_id: s2.customer_id, method: s2.method, paid: s2.paid });
      save(st); return { ok: true };
    }
    if (k === 'sales' && id && !sub && method === 'DELETE') {
      need(st, 'sale.delete', 'Only the owner or manager can delete a bill');
      var s3 = st.sales.find(function (s) { return s.id === id && !s.deleted_at; }); if (!s3) throw E('Bill not found', 404);
      s3.deleted_at = nowIso();
      var need2 = {}; s3.items.forEach(function (i) { if (i.product_id) need2[i.product_id] = (need2[i.product_id] || 0) + i.qty; }); applyStock(st, need2, 1);
      audit(st, cu, 'delete', 'sale', id, 'Bill ' + s3.bill_no + ' ' + s3.total, { deleted_at: null }, { deleted_at: s3.deleted_at });
      save(st); return { ok: true };
    }

    // ---- expenses ----
    if (k === 'expenses' && !parts[1] && method === 'GET') {
      var ef = qs.get('from') || '0000', et = qs.get('to') || '9999';
      return st.expenses.filter(function (x) { return !x.deleted_at && x.date >= ef && x.date <= et; }).sort(function (a, b2) { return a.date < b2.date ? 1 : -1; });
    }
    if (k === 'expenses' && !parts[1] && method === 'POST') {
      need(st, 'expense', 'Your role cannot add expenses');
      var ea = posNum(b.amount, 'Amount'); var ecat = text(b.category || 'Other', 'Category', 40);
      var ex = { id: nid(st), amount: ea, category: ecat, note: String(b.note || '').slice(0, 120), date: b.date || todayS(), created_at: nowIso(), deleted_at: null };
      st.expenses.push(ex); audit(st, cu, 'create', 'expense', ex.id, 'Expense ' + ea + ' ' + ecat, null, { deleted_at: null }); save(st); return { id: ex.id };
    }
    if (k === 'expenses' && id && method === 'DELETE') {
      need(st, 'expense', 'Your role cannot delete expenses');
      var ed = st.expenses.find(function (x) { return x.id === id; }); if (ed) { ed.deleted_at = nowIso(); audit(st, cu, 'delete', 'expense', id, 'Expense ' + ed.amount, { deleted_at: null }, { deleted_at: ed.deleted_at }); }
      save(st); return { ok: true };
    }

    // ---- reports ----
    if (k === 'reports') {
      need(st, 'view_money', 'Reports are for the owner, manager or accountant');
      var days = +(qs.get('days') || 7), today2 = todayS(), from2 = addDays(today2, -(days - 1));
      var rs = liveSales(st).filter(function (s) { return s.date >= from2; });
      var rex = st.expenses.filter(function (x) { return !x.deleted_at && x.date >= from2; });
      var daily = [], top = {}, cats = {};
      for (var i = 0; i < days; i++) { var dd = addDays(from2, i); daily.push({ d: dd, sales: sumBy(rs.filter(function (s) { return s.date === dd; }), function (s) { return s.total; }) }); }
      rs.forEach(function (s) { s.items.forEach(function (it) { top[it.name] = (top[it.name] || 0) + it.price * it.qty; }); });
      rex.forEach(function (x) { cats[x.category] = (cats[x.category] || 0) + x.amount; });
      var rev = sumBy(rs, function (s) { return s.total; }), cost = sumBy(rs, function (s) { return sumBy(s.items, function (i2) { return i2.cost * i2.qty; }); }), exp = sumBy(rex, function (x) { return x.amount; });
      return {
        totals: { revenue: rev, bills: rs.length, expenses: exp, profit: rev - cost - exp },
        daily: daily,
        top: Object.keys(top).map(function (n) { return { name: n, revenue: top[n] }; }).sort(function (a, b2) { return b2.revenue - a.revenue; }).slice(0, 5),
        expenses_by_category: Object.keys(cats).map(function (n) { return { category: n, amount: cats[n] }; })
      };
    }
    if (path === '/zreport') {
      need(st, 'view_money', 'Day report is for the owner, manager or accountant');
      var zd = todayS(); var zs = liveSales(st).filter(function (s) { return s.date === zd; });
      var zx = st.expenses.filter(function (x) { return !x.deleted_at && x.date === zd; });
      return { date: zd, shop: st.shop.name, bills: zs.length, sales: sumBy(zs, function (s) { return s.total; }), cash: sumBy(zs.filter(function (s) { return s.method === 'cash'; }), function (s) { return s.paid; }), upi: sumBy(zs.filter(function (s) { return s.method === 'upi'; }), function (s) { return s.paid; }), udhar: sumBy(zs.filter(function (s) { return s.method === 'udhar'; }), function (s) { return s.total; }), discount: sumBy(zs, function (s) { return s.discount; }), expenses: sumBy(zx, function (x) { return x.amount; }) };
    }

    // ---- team (owner only writes) ----
    if (path === '/team' && method === 'GET') return { members: st.users.filter(function (u2) { return !u2.deleted_at; }).map(function (u2) { return { id: u2.id, name: u2.name, email: u2.email, role: appRole(u2), status: u2.status }; }) };
    if (path === '/team/invite' && method === 'POST') {
      need(st, 'team', 'Only the owner can invite staff');
      var tn = text(b.name || b.email || 'New staff', 'Name', 60); var tok = 'demo-' + nid(st);
      st.users.push({ id: nid(st), name: tn, email: b.email || '', v2role: b.role === 'manager' ? 'manager' : 'cashier', status: 'invited', token: tok });
      save(st); return { token: tok };
    }

    // ---- tasks / suppliers ----
    if (k === 'tasks' && !parts[1] && method === 'GET') return st.tasks.slice();
    if (k === 'tasks' && !parts[1] && method === 'POST') { need(st, 'task', 'Only owner or manager can add tasks'); st.tasks.push({ id: nid(st), title: text(b.title, 'Task', 120), due: b.due || todayS(), priority: b.priority || 'normal', done: false }); save(st); return { ok: true }; }
    if (k === 'tasks' && id && method === 'PUT') { need(st, 'task', 'Only owner or manager can change tasks'); var tk = st.tasks.find(function (x) { return x.id === id; }); if (tk) tk.done = !!b.done; save(st); return { ok: true }; }
    if (k === 'tasks' && id && method === 'DELETE') { need(st, 'task', 'Only owner or manager can delete tasks'); st.tasks = st.tasks.filter(function (x) { return x.id !== id; }); save(st); return { ok: true }; }
    if (k === 'suppliers' && !parts[1] && method === 'GET') return st.suppliers.slice();
    if (k === 'suppliers' && !parts[1] && method === 'POST') { need(st, 'supplier', 'Your role cannot add suppliers'); st.suppliers.push({ id: nid(st), name: text(b.name, 'Supplier name'), phone: String(b.phone || ''), items: String(b.items || '').slice(0, 120), note: String(b.note || '').slice(0, 120) }); save(st); return { ok: true }; }
    if (k === 'suppliers' && id && method === 'PUT') { need(st, 'supplier', 'Your role cannot change suppliers'); var sp = st.suppliers.find(function (x) { return x.id === id; }); if (sp) { sp.name = text(b.name, 'Supplier name'); sp.phone = String(b.phone || ''); sp.items = String(b.items || '').slice(0, 120); } save(st); return { ok: true }; }
    if (k === 'suppliers' && id && method === 'DELETE') { need(st, 'supplier', 'Your role cannot delete suppliers'); st.suppliers = st.suppliers.filter(function (x) { return x.id !== id; }); save(st); return { ok: true }; }

    // ---- v2 routes ----
    if (k === 'v2') return v2(st, cu, method, parts.slice(1), b, qs);
    throw E('Not available in the demo', 404);
  }

  function v2(st, cu, method, p, b, qs) {
    var a = p[0];
    if (a === 'udhar' && method === 'GET') {
      var today = todayS();
      var people = st.customers.filter(function (c) { return !c.deleted_at && balanceOf(st, c.id) > 0; }).map(function (c) {
        var bills = liveSales(st).filter(function (s) { return s.customer_id === c.id && s.method === 'udhar' && s.total > s.paid; }).sort(function (x, y) { return x.created_at < y.created_at ? -1 : 1; }).map(function (s) { var late = s.due_date ? Math.max(0, daysBetween(s.due_date, today)) : 0; return { id: s.id, bill_no: s.bill_no, date: s.date, due_date: s.due_date, total: s.total, paid: s.paid, due: s.total - s.paid, days_late: late }; });
        var oldest = bills[0] || {};
        var maxLate = Math.max.apply(null, [0].concat(bills.map(function (x) { return x.days_late; })));
        return { customer_id: c.id, name: c.name, phone: c.phone, balance: balanceOf(st, c.id), advance: c.advance || 0, oldest_due: oldest.due_date || null, days_late: maxLate, overdue: maxLate > 0, bills: bills };
      }).sort(function (x, y) { return (y.overdue - x.overdue) || (y.days_late - x.days_late) || (y.balance - x.balance); });
      var canMoney = can(cu, 'view_money');
      return { people: people, total: canMoney ? sumBy(people, function (x) { return x.balance; }) : null, overdue_total: canMoney ? sumBy(people.filter(function (x) { return x.overdue; }), function (x) { return x.balance; }) : null };
    }
    if (a === 'staff' && !p[1] && method === 'GET') return st.users.filter(function (u) { return !u.deleted_at; }).map(function (u) { return { id: u.id, name: u.name, email: u.email, role: u.v2role, status: u.status, you: u.id === cu.id }; });
    if (a === 'staff' && !p[1] && method === 'POST') {
      need(st, 'team', 'Only the owner can invite staff');
      var name = text(b.name, 'Name', 60); var email = String(b.email || '').trim();
      if (!/^\S+@\S+\.\S+$/.test(email)) throw E('Enter a valid email');
      if (ROLES.indexOf(b.role) < 0 || b.role === 'owner') throw E('Pick a role');
      if (st.users.some(function (u) { return !u.deleted_at && u.email === email; })) throw E('That email is already added');
      var nu = { id: nid(st), name: name, email: email, v2role: b.role, status: 'invited', token: 'demo-' + st.seq };
      st.users.push(nu); audit(st, cu, 'create', 'user', nu.id, 'Added ' + name + ' as ' + b.role, null, { deleted_at: null }); save(st);
      return { id: nu.id, token: nu.token };
    }
    if (a === 'staff' && p[1] && method === 'PUT') {
      need(st, 'team', 'Only the owner can change staff');
      var id = +p[1]; var tu = st.users.find(function (u) { return u.id === id && !u.deleted_at; }); if (!tu) throw E('Person not found', 404);
      if (tu.v2role === 'owner' && (b.status === 'suspended' || (b.role && b.role !== 'owner'))) throw E('The owner cannot be suspended or changed');
      var beforeU = { v2role: tu.v2role, status: tu.status, name: tu.name };
      if (b.name) tu.name = text(b.name, 'Name', 60);
      if (b.role) { if (ROLES.indexOf(b.role) < 0 || b.role === 'owner') throw E('Pick a role'); tu.v2role = b.role; }
      if (b.status) { if (['active', 'suspended'].indexOf(b.status) < 0) throw E('Bad status'); tu.status = b.status; }
      var actn = (b.role && b.role !== beforeU.v2role) ? 'role change' : 'edit';
      audit(st, cu, actn, 'user', id, tu.name + (actn === 'role change' ? ' to ' + tu.v2role : ' (' + tu.status + ')'), beforeU, { v2role: tu.v2role, status: tu.status, name: tu.name });
      save(st); return { ok: true };
    }
    if (a === 'staff' && p[1] && method === 'DELETE') {
      need(st, 'team', 'Only the owner can remove staff');
      var rid = +p[1]; var ru = st.users.find(function (u) { return u.id === rid; });
      if (!ru || ru.v2role === 'owner') throw E('The owner cannot be removed');
      ru.deleted_at = nowIso(); audit(st, cu, 'delete', 'user', rid, 'Removed ' + ru.name, { deleted_at: null }, { deleted_at: ru.deleted_at }); save(st); return { ok: true };
    }
    if (a === 'switch' && method === 'POST') {
      var sw = st.users.find(function (u) { return u.id === +b.id && !u.deleted_at && u.status !== 'suspended'; });
      if (!sw) throw E('This person is suspended or not found');
      st.session.uid = sw.id; save(st); return { ok: true, name: sw.name, v2role: sw.v2role };
    }
    if (a === 'audit' && !p[1] && method === 'GET') {
      if (!can(cu, 'audit')) throw E('Your role cannot see the audit log', 403);
      return st.audit.slice(0, 200);
    }
    if (a === 'audit' && p[1] && p[2] === 'undo' && method === 'POST') {
      if (!can(cu, 'audit.undo')) throw E('Only the owner or manager can undo', 403);
      var ae = st.audit.find(function (x) { return x.id === +p[1]; }); if (!ae) throw E('Entry not found', 404);
      if (ae.undone) throw E('Already undone');
      var coll = ae.entity === 'sale' ? st.sales : ae.entity === 'product' ? st.products : ae.entity === 'customer' ? st.customers : ae.entity === 'expense' ? st.expenses : ae.entity === 'user' ? st.users : null;
      var item = coll && coll.find(function (x) { return x.id === ae.entity_id; });
      if (!item) throw E('Nothing to undo');
      if (ae.action === 'create') { item.deleted_at = nowIso(); if (ae.entity === 'sale') { var nn2 = {}; item.items.forEach(function (i) { if (i.product_id) nn2[i.product_id] = (nn2[i.product_id] || 0) + i.qty; }); applyStock(st, nn2, 1); } }
      else if (ae.action === 'delete' && ae.entity === 'sale') { item.deleted_at = null; var nn3 = {}; item.items.forEach(function (i) { if (i.product_id) nn3[i.product_id] = (nn3[i.product_id] || 0) + i.qty; }); applyStock(st, nn3, -1); }
      else if (ae.before) { Object.assign(item, ae.before); }
      ae.undone = true;
      audit(st, cu, 'undo', ae.entity, ae.entity_id, 'Undid: ' + ae.label, null, null);
      save(st); return { ok: true };
    }
    if (a === 'summary' && method === 'GET') {
      if (!can(cu, 'summary')) throw E('Only the owner or manager can see the summary', 403);
      var day = qs.get('date') || todayS();
      var dayAudit = st.audit.filter(function (x) { return dayOf(x.at) === day && !x.undone; });
      var dayPays = st.payments.filter(function (x) { return dayOf(x.at) === day; });
      var daySales = liveSales(st).filter(function (s) { return s.date === day; });
      var udharAdded = sumBy(liveSales(st).filter(function (s) { return s.method === 'udhar' && s.created_at && dayOf(s.created_at) === day; }), function (s) { return s.total; });
      return {
        date: day,
        udhar_added: udharAdded,
        discounts_given: sumBy(liveSales(st).filter(function (s) { return dayOf(s.created_at) === day; }), function (s) { return s.discount; }),
        payments_recovered: sumBy(dayPays, function (x) { return x.amount; }),
        bills: daySales.length,
        edits: dayAudit.filter(function (x) { return x.action === 'edit' || x.action === 'role change'; }).length,
        deletes: dayAudit.filter(function (x) { return x.action === 'delete'; }).length,
        delete_lines: dayAudit.filter(function (x) { return x.action === 'delete'; }).slice(0, 5).map(function (x) { return x.by + ': ' + x.label; })
      };
    }
    if (a === 'export' && method === 'GET') {
      if (!can(cu, 'export')) throw E('Only the owner can download data', 403);
      return { exported_at: nowIso(), note: 'Example demo export. Stored only in this browser.', shop: st.shop, signup_answers: st.signup.answers, consent_records: st.consents, staff: st.users.filter(function (u) { return !u.deleted_at; }).map(function (u) { return { id: u.id, name: u.name, email: u.email, role: u.v2role, status: u.status }; }), products: st.products, customers: st.customers, sales: st.sales, payments: st.payments, expenses: st.expenses, tasks: st.tasks, suppliers: st.suppliers, audit: st.audit };
    }
    if (a === 'erase' && method === 'POST') {
      if (!can(cu, 'erase')) throw E('Only the owner can delete data', 403);
      if (b.confirm !== 'DELETE') throw E('Type DELETE to confirm');
      var fresh = seedEmpty(); fresh.session.uid = 1; save(fresh); return { ok: true };
    }
    if (a === 'settings' && method === 'PUT') {
      if (!can(cu, 'settings')) throw E('Only the owner can change settings', 403);
      if (b.assistant_name != null) st.shop.assistant_name = text(b.assistant_name, 'Assistant name', 20);
      save(st); return { ok: true, assistant_name: st.shop.assistant_name };
    }
    throw E('Not available in the demo', 404);
  }
  var ROLES = ['owner', 'manager', 'cashier', 'stock-keeper', 'accountant'];

  var origFetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    var url = typeof input === 'string' ? input : ((input && input.url) || '');
    if (url.indexOf('/api') !== 0) return origFetch(input, init);
    var method = ((init && init.method) || 'GET').toUpperCase();
    var body = {};
    if (init && init.body) { try { body = JSON.parse(init.body); } catch (e) { body = {}; } }
    var qi = url.indexOf('?');
    var path = (qi >= 0 ? url.slice(4, qi) : url.slice(4)) || '/';
    var qs = new URLSearchParams(qi >= 0 ? url.slice(qi + 1) : '');
    await new Promise(function (r) { setTimeout(r, 30); });
    var status = 200, data;
    try { data = route(method, path, body, qs); if (method === 'GET' && Array.isArray(data) && /^\/(products|customers|suppliers|tasks|expenses|sales)$/.test(path)) data = { items: data }; }
    catch (e) { status = e.status || 500; data = { error: e.status ? e.message : 'Something went wrong. Please try again.' }; }
    return new Response(JSON.stringify(data == null ? { ok: true } : data), { status: status, headers: { 'Content-Type': 'application/json' } });
  };

  // ---- downloads (demo): spreadsheet files and printable pages built from the demo data ----
  function hx(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function csvCell(v) { var s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function tableOf(k, st) {
    var live = function (x) { return !x.deleted_at; };
    if (k === 'sales') return { title: 'Sales', head: ['Date', 'Bill no', 'Customer', 'Payment', 'Total', 'Paid', 'Balance'], rows: liveSales(st).map(function (s) { return [s.date, s.bill_no, s.customer_name || 'Walk-in', s.method, s.total, s.paid, Math.max(0, s.total - s.paid)]; }) };
    if (k === 'expenses') return { title: 'Expenses', head: ['Date', 'Category', 'Amount', 'Note'], rows: st.expenses.filter(live).map(function (x) { return [x.date, x.category, x.amount, x.note || '']; }) };
    if (k === 'products') return { title: 'Products', head: ['Name', 'SKU', 'Category', 'Price', 'Cost', 'Stock', 'Reorder level'], rows: st.products.filter(live).map(function (p) { return [p.name, p.sku, p.category, p.price, p.cost, p.stock, p.reorder]; }) };
    if (k === 'customers') return { title: 'Customers', head: ['Name', 'Phone', 'Balance due'], rows: st.customers.filter(live).map(function (c) { return [c.name, c.phone, balanceOf(st, c.id)]; }) };
    if (k === 'suppliers') return { title: 'Suppliers', head: ['Name', 'Phone', 'Items'], rows: st.suppliers.filter(live).map(function (s) { return [s.name, s.phone, s.items]; }) };
    if (k === 'ledger') return { title: 'Udhar ledger', head: ['Date', 'Customer', 'Bill no', 'Total', 'Paid', 'Balance due'], rows: liveSales(st).filter(function (s) { return s.method === 'udhar' || s.total > s.paid; }).map(function (s) { return [s.date, s.customer_name || 'Walk-in', s.bill_no, s.total, s.paid, Math.max(0, s.total - s.paid)]; }) };
    return null;
  }
  function wrapPage(title, inner) {
    return '<!doctype html><html><head><meta charset="utf-8"><title>' + hx(title) + '</title><style>body{font-family:Arial,sans-serif;color:#111;margin:24px}h1{font-size:20px;margin:0 0 6px}table{border-collapse:collapse;width:100%;font-size:13px;margin-top:12px}th,td{border:1px solid #bbb;padding:6px;text-align:left}th{background:#f1f1f1}.m{color:#555;font-size:12px}.bar{margin-bottom:16px}@media print{.bar{display:none}}</style></head><body><div class="bar"><button onclick="window.print()">Print / Save as PDF</button></div>' + inner + '</body></html>';
  }
  function tablePage(t, st) {
    var head = '<tr>' + t.head.map(function (h) { return '<th>' + hx(h) + '</th>'; }).join('') + '</tr>';
    var body = t.rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + hx(c) + '</td>'; }).join('') + '</tr>'; }).join('');
    return wrapPage(t.title, '<h1>' + hx(t.title) + '</h1><p class="m">' + hx(st.shop.name) + ' · example demo data</p>' + (t.rows.length ? '<table><thead>' + head + '</thead><tbody>' + body + '</tbody></table>' : '<p>No rows yet.</p>'));
  }
  function invoicePage(s, st) {
    var items = (s.items || []).map(function (i) { return '<tr><td>' + hx(i.name) + '</td><td>' + i.qty + '</td><td>₹' + i.price + '</td><td>₹' + (i.qty * i.price) + '</td></tr>'; }).join('');
    var inner = '<h1>' + hx(st.shop.name) + '</h1><p class="m">' + hx(st.shop.address || '') + (st.shop.gstin ? ' · GSTIN ' + hx(st.shop.gstin) : '') + '</p>' +
      '<p><b>Bill #' + hx(s.bill_no) + '</b> · ' + hx(s.date) + ' · ' + hx(s.customer_name || 'Walk-in') + '</p>' +
      '<table><thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Amount</th></tr></thead><tbody>' + items + '</tbody></table>' +
      '<p>Total: <b>₹' + s.total + '</b><br>Paid: ₹' + s.paid + '<br>Balance (udhar): ₹' + Math.max(0, s.total - s.paid) + '</p><p class="m">Example demo bill.</p>';
    return wrapPage('Bill #' + s.bill_no, inner);
  }
  // Returns { html } for printable pages, { name, type, body } for spreadsheet files, { error } or null.
  function demoFile(href) {
    var st = load(); var u = me(st); if (!u) return null;
    var qi = href.indexOf('?'); var p = qi >= 0 ? href.slice(0, qi) : href;
    var q = new URLSearchParams(qi >= 0 ? href.slice(qi + 1) : '');
    var m = p.match(/^\/api\/export\/([a-z]+)$/);
    if (m) {
      if (!can(u, 'export')) return { error: 'Only the owner can download data' };
      var t = tableOf(m[1], st); if (!t) return null;
      if (q.get('format') === 'pdf') return { html: tablePage(t, st) };
      // Spreadsheet file: CSV with a byte-order mark so Excel shows names and rupee signs correctly.
      var csv = '﻿' + [t.head].concat(t.rows).map(function (r) { return r.map(csvCell).join(','); }).join('\r\n') + '\r\n';
      return { name: 'bizgrow-' + m[1] + '.csv', type: 'text/csv;charset=utf-8', body: csv };
    }
    m = p.match(/^\/api\/invoice\/(\d+)$/);
    if (m) {
      var s1 = st.sales.find(function (x) { return x.id === +m[1] && !x.deleted_at; });
      if (!s1) return { error: 'That bill is not in this browser any more.' };
      return { html: invoicePage(s1, st) };
    }
    return null;
  }
  document.addEventListener('click', function (e) {
    if (window.BGV2 && window.BGV2.real) return; // real mode: supabase-api.js answers these links
    var a = e.target && e.target.closest ? e.target.closest('a[href^="/api/export"], a[href^="/api/invoice"]') : null;
    if (!a) return;
    e.preventDefault(); e.stopPropagation();
    var say = function (m) { if (window.BGV2 && window.BGV2.toast) window.BGV2.toast(m); };
    var f = demoFile(a.getAttribute('href'));
    if (!f) return say('That file is not available in the demo.');
    if (f.error) return say(f.error);
    if (f.html) {
      var w = window.open('', '_blank');
      if (!w) return say('Your browser blocked the new tab. Allow pop-ups for this page and try again.');
      w.document.open(); w.document.write(f.html); w.document.close();
      return;
    }
    var url = URL.createObjectURL(new Blob([f.body], { type: f.type }));
    var x = document.createElement('a'); x.href = url; x.download = f.name;
    document.body.appendChild(x); x.click(); x.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }, true);

  // Exposed for the v2 layer (demo only)
  window.BGV2MOCK = {
    state: function () { return load(); },
    save: save,
    canDo: function (p) { var st = load(); var u = me(st); return !!u && can(u, p); },
    role: function () { var st = load(); var u = me(st); return u ? u.v2role : null; },
    userId: function () { return load().session.uid; },
    users: function () { return load().users.filter(function (u) { return !u.deleted_at; }); },
    reset: function () { save(seed()); }
  };
})();
