/* BizGrow v2: real sign-in and shop data through Supabase (stage 1).
   Runs when config.js has a project address and key, and the page is not opened with ?demo=1.
   Otherwise this file does nothing and the demo stand-in (mock-api.js) runs as before.
   Only the public (publishable) key is used. Never add a secret key to this file.
   Loaded after v2-signup.js. Reads of things not built yet return empty lists; writes not built yet
   return a plain "coming in the next stage" message. */
(function () {
  'use strict';
  var B = window.BGV2; if (!B) return;
  var CFG = window.BGV2_CONFIG || {};
  var FORCE_DEMO = /(^|[?&])demo=1(&|$)/.test(location.search);
  var REAL = !FORCE_DEMO && !!(CFG.supabaseUrl && CFG.supabaseAnonKey && window.supabase && window.supabase.createClient);
  B.real = REAL;
  if (!REAL) return; // demo mode: nothing below runs

  var sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
    auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true }
  });
  var CONSENT_VERSION = 'signup-consent-v1';
  var ANSWER_KEYS = ['shop_name', 'trade', 'city', 'team_size', 'problem', 'udhar_customers'];
  var COMING = 'This comes in the next stage. Nothing was changed.';
  var SIGN_IN = 'Please sign in with Google.';

  function $(s) { return document.querySelector(s); }
  function esc(s) { return B.esc(s); }
  function reply(status, body) {
    return new Response(JSON.stringify(body), { status: status, headers: { 'content-type': 'application/json' } });
  }
  function fail(status, msg) { return reply(status, { error: msg }); }
  function nowIso() { return new Date().toISOString(); }
  function appRole(v) { return v === 'owner' ? 'owner' : (v === 'manager' || v === 'accountant') ? 'manager' : 'staff'; }
  function txt(v) { return v == null ? (v === null ? null : '') : String(v); }

  // Save the four shop details that patch-02 adds: phone, UPI ID, address and assistant name.
  // A value that was not sent (null) keeps the old one. A blank value clears it.
  // If the database update has not been run yet, this does not crash: it throws a plain message.
  var PROFILE_MISSING = ' cannot be saved yet, because the shop database needs one more update. Nothing else was lost.';
  async function saveProfile(shopId, f, what) {
    var r = await sb.rpc('update_my_shop_profile', {
      p_shop: shopId,
      p_phone: f.phone === undefined ? null : txt(f.phone),
      p_upi_id: f.upi_id === undefined ? null : txt(f.upi_id),
      p_address: f.address === undefined ? null : txt(f.address),
      p_assistant_name: f.assistant_name === undefined ? null : txt(f.assistant_name)
    });
    if (!r || !r.error) return;
    var c = r.error.code || '', m = r.error.message || '';
    if (c === '22023') throw new Error(m || 'Please check the details and try again.');
    if (c === '42501' || /owner/i.test(m)) throw new Error('Only the owner can do this.');
    if (c === '42883' || c === '42703' || c === 'PGRST202' || c === 'PGRST204' || /does not exist|could not find|schema cache/i.test(m)) {
      throw new Error(what + PROFILE_MISSING);
    }
    throw new Error('Something went wrong. Please try again.');
  }

  // Turn a database answer into data, or a plain message. Raw database text is never shown.
  function dataOf(r) {
    if (r && r.error) throw dbErr(r.error);
    return r ? r.data : null;
  }

  async function session() {
    var r = await sb.auth.getSession();
    return (r && r.data && r.data.session) || null;
  }

  // Remove the one-time sign-in code from the address bar after it has been used.
  function tidyUrl() {
    if (/[?&](code|error|error_description)=/.test(location.search)) {
      history.replaceState(null, '', location.pathname + location.hash);
    }
  }

  async function loadStaff(uid) {
    var rows = dataOf(await sb.from('staff').select('id,shop_id,name,email,role,active')
      .eq('auth_user_id', uid).eq('active', true).order('created_at', { ascending: true }).limit(1));
    return (rows && rows[0]) || null;
  }

  async function loadSignup(uid) {
    var rows = dataOf(await sb.from('signup_answers').select('*')
      .eq('auth_user_id', uid).order('created_at', { ascending: false }).limit(1));
    return (rows && rows[0]) || null;
  }

  async function loadConsent(uid) {
    var rows = dataOf(await sb.from('consent_records').select('granted,granted_at,text_version')
      .eq('auth_user_id', uid).order('granted_at', { ascending: false }).limit(1));
    var c = rows && rows[0];
    return c ? { granted: !!c.granted, at: c.granted_at, text_version: c.text_version } : null;
  }

  // Signed in? Then the shop exists (created on first login) and the screens get the same shape as the demo.
  async function getMe() {
    var s = await session();
    if (!s) return null;
    tidyUrl();
    var u = s.user, meta = u.user_metadata || {};
    var st = await loadStaff(u.id);
    if (!st) {
      var lang = localStorage.getItem('bg_lang') || 'en';
      dataOf(await sb.rpc('create_my_shop', { p_name: 'My shop', p_trade: null, p_city: null, p_lang: lang, p_owner_name: meta.full_name || meta.name || null }));
      st = await loadStaff(u.id);
      if (!st) throw new Error('Could not set up your shop. Please try again.');
    }
    var shops = dataOf(await sb.from('shops').select('*').eq('id', st.shop_id).limit(1));
    var shop = (shops && shops[0]) || {};
    var row = await loadSignup(u.id);
    var answers = {};
    if (row) ANSWER_KEYS.forEach(function (k) { if (row[k] != null) answers[k] = row[k]; });
    return {
      user: { id: u.id, name: st.name || meta.full_name || u.email || '', email: u.email || st.email || '', phone: '' },
      role: appRole(st.role), v2role: st.role,
      shop: { id: shop.id, name: shop.name || 'My shop', phone: shop.phone || '', address: shop.address || '', gstin: shop.gstin || '', city: shop.city || '',
        trade: shop.trade || '', upi_id: shop.upi_id || '', category: '', lang: shop.lang || 'en', store_enabled: false, onboarded: true,
        assistant_name: shop.assistant_name || '', staff_discount_limit: shop.staff_discount_limit == null ? 50 : num(shop.staff_discount_limit) },
      onboarded: true, answers: {}, lang: shop.lang || 'en',
      signup_done: !!(row && row.done), signup_answers: answers,
      consent: await loadConsent(u.id)
    };
  }

  function mapProduct(p) {
    return { id: p.id, name: p.name || '', sku: p.sku || '', category: p.category || 'General', unit: p.unit || 'pc',
      price: +p.sell_price || 0, cost: +p.buy_price || 0, stock: +p.stock_qty || 0, reorder: +p.low_stock_at || 0, deleted_at: null };
  }

  function emptyDay() { return { sales: 0, bills: 0, expenses: 0, profit: 0, collected: 0 }; }

  // ---------- Stage 2: shop data through the database functions and table reads ----------
  // Every path below returns the same shape as mock-api.js. Errors are plain English; raw database text is never shown.
  var PATCH_NOTE = 'This needs one database update first. Run the update in Supabase once, then try again.';
  var MISSING_CODE = /^(42883|42703|42P01|PGRST202|PGRST204|PGRST205)$/;
  var MONEY = ['owner', 'manager', 'accountant'];
  var SALE_COLS = 'id,bill_no,total,paid,payment_mode,discount,sale_date,due_date,created_at,customer_id,customers(name)';

  function dbErr(e) {
    var c = (e && e.code) || '', m = (e && e.message) || '';
    if (MISSING_CODE.test(c) || /schema cache|does not exist|could not find the function/i.test(m)) return new Error(PATCH_NOTE);
    if (/permission denied|row-level security/i.test(m)) return new Error('Your role cannot do this. Ask the owner.');
    if (c === '42501' || c === 'P0001' || c === '22023') return new Error(m || 'Please check the details and try again.');
    return new Error('Something went wrong. Please try again.');
  }
  function rpc(name, args) { return sb.rpc(name, args).then(function (r) { if (r.error) throw dbErr(r.error); return r.data; }); }
  function q(p) { return p.then(function (r) { if (r.error) throw dbErr(r.error); return r.data; }); }
  function countOf(p) { return p.then(function (r) { if (r.error) throw dbErr(r.error); return r.count || 0; }); }
  function istToday() { return new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10); }
  function addDays(d, n) { var t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
  function billLabel(n) { return 'B' + String(n).padStart(4, '0'); }
  function num(v) { return +v || 0; }
  function phoneOf(p) { return p ? String(p).replace(/\s+/g, '') : ''; }
  function badPhone(p) { return !!p && !/^\d{10}$/.test(p); }
  var OK = function () { return reply(200, { ok: true }); };

  function saleOut(b) {
    return { id: b.id, bill_no: billLabel(b.bill_no), total: num(b.total), paid: num(b.paid), method: b.payment_mode,
      customer_name: (b.customers && b.customers.name) || '', customer_id: b.customer_id || null, discount: num(b.discount),
      created_at: b.created_at, date: b.sale_date, due_date: b.due_date || null, note: '' };
  }
  function custOut(c, money) {
    return { id: c.id, name: c.name || '', phone: c.phone || '', note: c.note || '', balance: money ? num(c.balance) : null,
      advance: money ? num(c.advance) : null, last_credit: c.last_credit || null };
  }
  // Product fields the screen sends; anything not sent keeps the stored value.
  // The database function resets some fields on update when they are empty, so the stored values are passed back.
  async function productWrite(shopId, id, b, cur) {
    var e = cur || {};
    function pick(k, old) { return b[k] !== undefined ? b[k] : old; }
    var name = String(pick('name', e.name) || '').trim();
    return rpc('upsert_product', {
      p_shop: shopId, p_id: id || null, p_name: name,
      p_category: pick('category', e.category) || 'General', p_unit: pick('unit', e.unit) || 'pc',
      p_buy: num(pick('cost', e.buy_price)), p_sell: num(pick('price', e.sell_price)),
      p_stock: num(pick('stock', e.stock_qty)), p_reorder: num(pick('reorder', e.low_stock_at)),
      p_sku: pick('sku', e.sku) || null, p_gst: num(e.gst_rate), p_hsn: e.hsn || null, p_quick: !!e.quick,
      p_stock_override: !!b.stock_override
    });
  }
  function csvOf(rows) {
    return '﻿' + rows.map(function (r) {
      return r.map(function (c) { var s = c == null ? '' : String(c); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',');
    }).join('\r\n');
  }

  // Shop routes. Returns a Response, or null when the path is not one of these.
  async function shopRoute(path, method, body, qs, st) {
    var shopId = st.shop_id, owner = st.role === 'owner', money = MONEY.indexOf(st.role) >= 0, b = body || {};
    var today = istToday(), mm, id, sub, cur, rows, out;
    function need(ok, msg) { if (!ok) throw new Error(msg); }
    function ownerOnly() { need(owner, 'Only the owner can do this.'); }
    function moneyOnly() { need(money, 'Your role cannot see this. Ask the owner.'); }

    // Items (products)
    if (path === '/products') {
      if (method === 'GET') {
        rows = await q(sb.from('products').select('*').is('deleted_at', null).order('name'));
        return reply(200, { items: rows.map(mapProduct) });
      }
      if (method === 'POST') { need(b.name, 'Item name is needed'); return reply(200, { id: await productWrite(shopId, null, b, null) }); }
    }
    mm = path.match(/^\/products\/([0-9a-fA-F-]{36})(\/adjust|\/history)?$/);
    if (mm) {
      id = mm[1]; sub = mm[2] || '';
      if (sub === '' && method === 'PUT') {
        cur = await q(sb.from('products').select('*').eq('id', id).maybeSingle());
        need(cur, 'That item was not found.');
        await productWrite(shopId, id, b, cur);
        return OK();
      }
      if (sub === '' && method === 'DELETE') { await rpc('delete_product', { p_product: id }); return OK(); }
      if (sub === '/adjust' && method === 'POST') {
        await rpc('adjust_product_stock', { p_product: id, p_change: num(b.change), p_reason: String(b.reason || ''), p_override: !!b.override });
        return OK();
      }
      if (sub === '/history' && method === 'GET') {
        rows = await q(sb.from('audit_log').select('summary,created_at').eq('row_id', id).eq('table_name', 'products')
          .order('created_at', { ascending: false }).limit(20));
        return reply(200, { items: rows.map(function (r) { return { reason: r.summary || '', created_at: r.created_at }; }) });
      }
    }

    // People (customers) and udhar
    if (path === '/customers') {
      if (method === 'GET') {
        rows = await rpc('shop_customers', { p_shop: shopId });
        return reply(200, { items: (rows || []).map(function (c) { return custOut(c, money); }) });
      }
      if (method === 'POST') {
        need(b.name && String(b.name).trim(), 'Name is needed');
        need(!badPhone(phoneOf(b.phone)), 'Phone number must be 10 digits');
        id = await rpc('upsert_customer', { p_shop: shopId, p_id: null, p_name: String(b.name).trim(),
          p_phone: phoneOf(b.phone) || null, p_city: null, p_note: b.note || null });
        return reply(200, { id: id });
      }
    }
    mm = path.match(/^\/customers\/([0-9a-fA-F-]{36})(\/payment|\/credit)?$/);
    if (mm) {
      id = mm[1]; sub = mm[2] || '';
      if (sub === '' && method === 'GET') {
        out = await rpc('customer_detail', { p_customer: id });
        need(out && out.customer, 'That person was not found.');
        if (!money) {
          out.balance = null; out.customer.balance = null; out.customer.advance = null;
          out.ledger = (out.ledger || []).map(function (l) { return Object.assign({}, l, { amount: null }); });
        }
        return reply(200, out);
      }
      if (sub === '' && method === 'PUT') {
        cur = await q(sb.from('customers').select('*').eq('id', id).maybeSingle());
        need(cur, 'That person was not found.');
        var nm = b.name !== undefined ? String(b.name || '').trim() : cur.name;
        var ph = b.phone !== undefined ? phoneOf(b.phone) : (cur.phone || '');
        need(nm, 'Name is needed');
        need(!badPhone(ph), 'Phone number must be 10 digits');
        // city and note are kept as they are; the function would clear them when empty.
        await rpc('upsert_customer', { p_shop: shopId, p_id: id, p_name: nm, p_phone: ph || null, p_city: cur.city || null, p_note: cur.note || null });
        return OK();
      }
      if (sub === '' && method === 'DELETE') { await rpc('delete_customer', { p_customer: id }); return OK(); }
      if (sub === '/payment' && method === 'POST') {
        out = await rpc('record_udhar_payment', { p_shop: shopId, p_customer: id, p_amount: num(b.amount), p_mode: b.method || 'cash' });
        return reply(200, { ok: true, advance_added: num(out && out.advance_added) });
      }
      if (sub === '/credit' && method === 'POST') {
        await rpc('create_sale', { p_shop: shopId, p_items: [{ name: String(b.note || 'Udhar').trim().slice(0, 60) || 'Udhar', price: num(b.amount), qty: 1 }],
          p_discount: 0, p_method: 'udhar', p_customer_id: id, p_paid: 0, p_due_date: null, p_sale_date: today, p_stock_override: false });
        return OK();
      }
    }
    if (path === '/v2/udhar' && method === 'GET') {
      out = await rpc('shop_udhar', { p_shop: shopId });
      if (!money) {
        out.total = null; out.overdue_total = null;
        out.people = (out.people || []).map(function (p) {
          return Object.assign({}, p, { balance: null, bills: (p.bills || []).map(function (x) { return Object.assign({}, x, { total: null, paid: null, due: null }); }) });
        });
      }
      return reply(200, out);
    }

    // Sales (bills)
    if (path === '/sales') {
      if (method === 'GET') {
        var sq = sb.from('bills').select(SALE_COLS).is('deleted_at', null).order('sale_date', { ascending: false })
          .order('created_at', { ascending: false }).limit(1000);
        if (qs && qs.get('from')) sq = sq.gte('sale_date', qs.get('from'));
        if (qs && qs.get('to')) sq = sq.lte('sale_date', qs.get('to'));
        rows = await q(sq);
        return reply(200, { items: rows.map(saleOut) });
      }
      if (method === 'POST') {
        need(Array.isArray(b.items) && b.items.length, 'Add at least one item to the bill');
        out = await rpc('create_sale', {
          p_shop: shopId,
          p_items: b.items.map(function (i) { return { product_id: i.product_id || null, name: i.name || '', price: num(i.price), qty: num(i.qty) }; }),
          p_discount: num(b.discount), p_method: b.method, p_customer_id: b.customer_id || null,
          p_paid: b.paid == null ? null : num(b.paid), p_due_date: null, p_sale_date: b.date || null,
          p_stock_override: !!b.stock_override
        });
        return reply(200, out);
      }
    }
    mm = path.match(/^\/sales\/([0-9a-fA-F-]{36})$/);
    if (mm) {
      id = mm[1];
      if (method === 'GET') {
        cur = await q(sb.from('bills').select(SALE_COLS + ',bill_items(product_id,name,rate,cost,qty)').eq('id', id).maybeSingle());
        need(cur, 'That bill was not found.');
        var so = saleOut(cur);
        var lines = (cur.bill_items || []).map(function (i) { return { product_id: i.product_id || null, name: i.name || '', price: num(i.rate), cost: num(i.cost), qty: num(i.qty) }; });
        // The screens read the bill header either at the top level or under "sale", so both are sent.
        return reply(200, Object.assign({}, so, { items: lines, sale: Object.assign({}, so, { items: lines }) }));
      }
      if (method === 'PUT') {
        cur = await q(sb.from('bills').select('customer_id,payment_mode').eq('id', id).maybeSingle());
        need(cur, 'That bill was not found.');
        // Editing a bill changes only the payment method and the person. The amount paid is not changed here.
        await rpc('edit_sale', { p_sale: id, p_method: b.method || cur.payment_mode,
          p_customer_id: b.customer_id !== undefined ? (b.customer_id || null) : cur.customer_id, p_due_date: null });
        return OK();
      }
      if (method === 'DELETE') { await rpc('delete_sale', { p_sale: id }); return OK(); }
    }

    // Expenses
    if (path === '/expenses') {
      if (method === 'GET') {
        var eq = sb.from('expenses').select('id,category,amount,note,spent_on,method').is('deleted_at', null)
          .order('spent_on', { ascending: false });
        if (qs && qs.get('from')) eq = eq.gte('spent_on', qs.get('from'));
        if (qs && qs.get('to')) eq = eq.lte('spent_on', qs.get('to'));
        rows = await q(eq);
        return reply(200, { items: rows.map(function (x) { return { id: x.id, category: x.category || '', amount: num(x.amount), note: x.note || '', date: x.spent_on, method: x.method || '' }; }) });
      }
      if (method === 'POST') {
        need(num(b.amount) > 0, 'Amount must be a number above 0');
        id = await rpc('add_expense', { p_shop: shopId, p_category: b.category || 'Other', p_amount: num(b.amount),
          p_date: b.date || today, p_method: b.method || 'cash', p_note: b.note || null });
        return reply(200, { id: id });
      }
    }
    mm = path.match(/^\/expenses\/([0-9a-fA-F-]{36})$/);
    if (mm && method === 'DELETE') { await rpc('delete_expense', { p_expense: mm[1] }); return OK(); }

    // Tasks (owner and manager write; everyone in the shop reads)
    if (path === '/tasks') {
      if (method === 'GET') {
        rows = await q(sb.from('tasks').select('id,title,due_on,priority,done').is('deleted_at', null).order('due_on', { ascending: true }));
        return reply(200, { items: rows.map(function (t) { return { id: t.id, title: t.title, due: t.due_on || null, priority: t.priority, done: !!t.done }; }) });
      }
      if (method === 'POST') {
        need(String(b.title || '').trim(), 'Write what the task is.');
        await q(sb.from('tasks').insert({ shop_id: shopId, title: String(b.title).trim(), due_on: b.due || null, priority: b.priority || 'normal', done: false }));
        return OK();
      }
    }
    mm = path.match(/^\/tasks\/([0-9a-fA-F-]{36})$/);
    if (mm) {
      id = mm[1];
      if (method === 'PUT') {
        var tp = {};
        if (b.done !== undefined) tp.done = !!b.done;
        if (b.title !== undefined) tp.title = String(b.title).trim();
        if (b.due !== undefined) tp.due_on = b.due || null;
        if (b.priority !== undefined) tp.priority = b.priority;
        await q(sb.from('tasks').update(tp).eq('id', id));
        return OK();
      }
      if (method === 'DELETE') { await q(sb.from('tasks').update({ deleted_at: nowIso() }).eq('id', id)); return OK(); }
    }

    // Suppliers: read only (writes are in the next stage)
    if (path === '/suppliers' && method === 'GET') {
      rows = await q(sb.from('suppliers').select('id,name,phone').is('deleted_at', null).order('name'));
      return reply(200, { items: rows.map(function (s) { return { id: s.id, name: s.name || '', phone: s.phone || '', items: '', note: '' }; }) });
    }

    // Dashboard, reports and the day's summaries
    if (path === '/dashboard' && method === 'GET') {
      rows = await q(sb.from('products').select('*').is('deleted_at', null));
      var items = rows.map(mapProduct), up = await rpc('shop_udhar', { p_shop: shopId }), yest = addDays(today, -1);
      var tasksDue = await countOf(sb.from('tasks').select('id', { count: 'exact', head: true }).is('deleted_at', null).eq('done', false).lte('due_on', today));
      var dash = { today: { sales: null, bills: 0, expenses: null, profit: null, collected: null }, yesterday: { sales: null, bills: 0 },
        udhar: { total: null, people: (up.people || []).length }, low_stock: items.filter(function (p) { return p.reorder > 0 && p.stock <= p.reorder; }),
        setup: { items: items.length }, tasks_due: tasksDue };
      if (money) {
        var t = await rpc('day_summary', { p_shop: shopId, p_date: today }), y = await rpc('day_summary', { p_shop: shopId, p_date: yest });
        dash.today = { sales: num(t.sales), bills: num(t.bills), expenses: num(t.expenses), profit: num(t.profit), collected: num(t.collected) };
        dash.yesterday = { sales: num(y.sales), bills: num(y.bills) };
        dash.udhar.total = num(up.total);
      } else {
        dash.today.bills = await countOf(sb.from('bills').select('id', { count: 'exact', head: true }).eq('sale_date', today).is('deleted_at', null));
        dash.yesterday.bills = await countOf(sb.from('bills').select('id', { count: 'exact', head: true }).eq('sale_date', yest).is('deleted_at', null));
      }
      return reply(200, dash);
    }
    if (path === '/reports' && method === 'GET') {
      moneyOnly();
      var days = Math.max(1, Math.min(366, parseInt((qs && qs.get('days')) || '7', 10) || 7));
      var rFrom = addDays(today, -(days - 1));
      var bl = await q(sb.from('bills').select('total,sale_date,bill_items(name,amount,cost,qty)').is('deleted_at', null).gte('sale_date', rFrom).lte('sale_date', today));
      var ex = await q(sb.from('expenses').select('amount,category').is('deleted_at', null).gte('spent_on', rFrom).lte('spent_on', today));
      var rev = 0, cost = 0, expT = 0, byDay = {}, byName = {}, byCat = {};
      bl.forEach(function (x) {
        rev += num(x.total); byDay[x.sale_date] = (byDay[x.sale_date] || 0) + num(x.total);
        (x.bill_items || []).forEach(function (i) {
          cost += num(i.qty) * num(i.cost); byName[i.name] = (byName[i.name] || 0) + num(i.amount);
        });
      });
      ex.forEach(function (x) { expT += num(x.amount); byCat[x.category || 'Other'] = (byCat[x.category || 'Other'] || 0) + num(x.amount); });
      var daily = [];
      for (var k = 0; k < days; k++) { var dd = addDays(rFrom, k); daily.push({ d: dd, sales: byDay[dd] || 0 }); }
      return reply(200, {
        totals: { revenue: rev, bills: bl.length, expenses: expT, profit: rev - cost - expT },
        daily: daily,
        top: Object.keys(byName).map(function (n) { return { name: n, revenue: byName[n] }; })
          .sort(function (a, c) { return c.revenue - a.revenue; }).slice(0, 5),
        expenses_by_category: Object.keys(byCat).map(function (c) { return { category: c, amount: byCat[c] }; })
          .sort(function (a, c) { return c.amount - a.amount; })
      });
    }
    if (path === '/zreport' && method === 'GET') {
      moneyOnly();
      var zd = await rpc('day_summary', { p_shop: shopId, p_date: (qs && qs.get('date')) || today });
      return reply(200, { date: zd.date, shop: zd.shop || '', bills: num(zd.bills), sales: num(zd.sales), cash: num(zd.cash_sales),
        upi: num(zd.upi_sales), udhar: num(zd.udhar_added), discount: num(zd.discounts_given), expenses: num(zd.expenses) });
    }
    if (path === '/v2/summary' && method === 'GET') {
      need(owner || st.role === 'manager', 'Only the owner or manager can see this.');
      var sd = await rpc('day_summary', { p_shop: shopId, p_date: (qs && qs.get('date')) || today });
      return reply(200, { date: sd.date, udhar_added: num(sd.udhar_added), discounts_given: num(sd.discounts_given),
        payments_recovered: num(sd.payments_recovered), bills: num(sd.bills), edits: num(sd.edits), deletes: num(sd.deletes), delete_lines: Array.isArray(sd.delete_lines) ? sd.delete_lines : [] });
    }

    // Audit log and undo (owner and manager)
    if (path === '/v2/audit' && method === 'GET') {
      rows = await q(sb.from('audit_log').select('id,actor_id,action,table_name,row_id,summary,created_at,undone')
        .order('created_at', { ascending: false }).limit(200));
      var who = await q(sb.from('staff').select('id,name,role').eq('shop_id', shopId));
      var byId = {}; who.forEach(function (w) { byId[w.id] = w; });
      return reply(200, rows.map(function (a) {
        var w = byId[a.actor_id] || {};
        return { id: a.id, at: a.created_at, by: w.name || '', role: w.role || '', action: a.action, entity: a.table_name,
          entity_id: a.row_id, label: a.summary || '', before: null, after: null, undone: !!a.undone };
      }));
    }
    mm = path.match(/^\/v2\/audit\/([0-9a-fA-F-]{36})\/undo$/);
    if (mm && method === 'POST') { need(owner || st.role === 'manager', 'Only the owner or manager can undo this.'); await rpc('undo_audit', { p_entry: mm[1] }); return OK(); }

    // Team and staff (owner writes)
    if ((path === '/team' || path === '/v2/staff') && method === 'GET') {
      rows = await q(sb.from('staff').select('id,name,email,role,active,auth_user_id').eq('shop_id', shopId).is('deleted_at', null).order('created_at', { ascending: true }));
      var inv = await q(sb.from('staff_invites').select('id,name,email,role').eq('shop_id', shopId).is('claimed_at', null));
      var people = rows.map(function (x) {
        return { id: x.id, name: x.name || '', email: x.email || '', role: path === '/team' ? appRole(x.role) : x.role,
          status: x.active ? 'active' : 'suspended', you: x.id === st.id };
      }).concat(inv.map(function (x) {
        return { id: x.id, name: x.name || '', email: x.email || '', role: path === '/team' ? appRole(x.role) : x.role, status: 'invited', you: false };
      }));
      return reply(200, path === '/team' ? { members: people } : people);
    }
    if (path === '/team/invite' && method === 'POST') {
      ownerOnly();
      // The invite is by email; the person signs in with Google. No link token is made.
      out = await rpc('invite_staff', { p_shop: shopId, p_name: String(b.name || b.email || '').trim(), p_email: String(b.email || '').trim(), p_role: b.role || 'cashier' });
      return reply(200, { id: out, token: null });
    }
    if (path === '/v2/staff' && method === 'POST') {
      ownerOnly();
      out = await rpc('invite_staff', { p_shop: shopId, p_name: String(b.name || '').trim(), p_email: String(b.email || '').trim(), p_role: b.role });
      return reply(200, { id: out, token: null });
    }
    mm = path.match(/^\/v2\/staff\/([0-9a-fA-F-]{36})$/);
    if (mm) {
      ownerOnly();
      if (method === 'PUT') {
        await rpc('update_staff', { p_staff: mm[1], p_role: b.role || null, p_active: b.status === undefined ? null : b.status === 'active' });
        return OK();
      }
      if (method === 'DELETE') { await rpc('remove_staff', { p_staff: mm[1] }); return OK(); }
    }

    // Privacy: export and erase (owner only)
    if (path === '/v2/export' && method === 'GET') {
      ownerOnly();
      var all = await Promise.all(['shops', 'signup_answers', 'consent_records', 'staff', 'products', 'payments', 'expenses', 'tasks', 'suppliers', 'audit_log']
        .map(function (t) { return q(sb.from(t).select('*')); }));
      var custRows = await rpc('shop_customers', { p_shop: shopId });
      var billRows = await q(sb.from('bills').select('*,bill_items(*)'));
      return reply(200, { exported_at: nowIso(), note: 'Everything BizGrow holds for your shop, as it is stored.',
        shop: all[0][0] || null, signup_answers: all[1], consent_records: all[2], staff: all[3], products: all[4], customers: custRows,
        sales: billRows, payments: all[5], expenses: all[6], tasks: all[7], suppliers: all[8], audit: all[9] });
    }
    if (path === '/v2/erase' && method === 'POST') {
      ownerOnly();
      await rpc('erase_shop', { p_shop: shopId, p_confirm: b.confirm || '' });
      return OK();
    }
    return null;
  }

  // Downloads and printable pages behind the export and invoice links (owner only for exports).
  function download(name, text, type) {
    var url = URL.createObjectURL(new Blob([text], { type: type }));
    var l = document.createElement('a'); l.href = url; l.download = name;
    document.body.appendChild(l); l.click(); l.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function printPage(win, title, bodyHtml) {
    win.document.write('<!doctype html><html><head><meta charset="utf-8"><title>' + esc(title) + '</title>' +
      '<style>body{font-family:sans-serif;margin:24px;color:#111}table{border-collapse:collapse;width:100%}' +
      'td,th{border-bottom:1px solid #ccc;padding:6px;text-align:left;font-size:13px}</style></head><body>' + bodyHtml + '</body></html>');
    win.document.close();
    setTimeout(function () { win.print(); }, 300);
  }
  function tableHtml(head, rows) {
    return '<table><thead><tr>' + head.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + esc(c == null ? '' : c) + '</td>'; }).join('') + '</tr>'; }).join('') +
      '</tbody></table>';
  }
  var EXPORTS = {
    sales: { head: ['Date', 'Bill', 'Customer', 'Method', 'Total', 'Discount', 'Paid'], get: async function (shopId) {
      var rows = await q(sb.from('bills').select(SALE_COLS).is('deleted_at', null).order('sale_date', { ascending: false }).limit(5000));
      return rows.map(function (x) { var s = saleOut(x); return [s.date, s.bill_no, s.customer_name, s.method, s.total, s.discount, s.paid]; });
    } },
    expenses: { head: ['Date', 'Category', 'Amount', 'Method', 'Note'], get: async function () {
      var rows = await q(sb.from('expenses').select('spent_on,category,amount,method,note').is('deleted_at', null).order('spent_on', { ascending: false }));
      return rows.map(function (x) { return [x.spent_on, x.category, x.amount, x.method, x.note]; });
    } },
    products: { head: ['Name', 'SKU', 'Category', 'Unit', 'Cost', 'Price', 'Stock', 'Reorder at'], get: async function () {
      var rows = await q(sb.from('products').select('*').is('deleted_at', null).order('name'));
      return rows.map(function (x) { return [x.name, x.sku, x.category, x.unit, x.buy_price, x.sell_price, x.stock_qty, x.low_stock_at]; });
    } },
    customers: { head: ['Name', 'Phone', 'Note', 'Balance', 'Advance', 'Last credit'], get: async function (shopId) {
      var rows = await rpc('shop_customers', { p_shop: shopId });
      return (rows || []).map(function (x) { return [x.name, x.phone, x.note, x.balance, x.advance, x.last_credit]; });
    } },
    suppliers: { head: ['Name', 'Phone', 'GSTIN'], get: async function () {
      var rows = await q(sb.from('suppliers').select('name,phone,gstin').is('deleted_at', null).order('name'));
      return rows.map(function (x) { return [x.name, x.phone, x.gstin]; });
    } }
  };
  async function invoiceHtml(id) {
    var r = await realApi('/sales/' + id, 'GET');
    var d = await r.json();
    if (!r.ok || d.error) throw new Error(d.error || 'That bill was not found.');
    var shopName = (B.S && B.S.me && B.S.me.shop && B.S.me.shop.name) || 'My shop';
    var lines = (d.items || []).map(function (i) { return [i.name, i.qty, i.price, +(i.qty * i.price).toFixed(2)]; });
    return '<h2>' + esc(shopName) + '</h2><p>Bill ' + esc(d.bill_no) + ' &middot; ' + esc(d.date) + '</p>' +
      '<p>' + esc(d.customer_name || '') + '</p>' + tableHtml(['Item', 'Qty', 'Price', 'Amount'], lines) +
      '<p>Discount: ' + esc(d.discount) + '<br>Total: ' + esc(d.total) + '<br>Paid: ' + esc(d.paid) + '</p>';
  }

  // Capture-phase click on export and invoice links. The mock version of this listener stands down in real mode.
  document.addEventListener('click', function (ev) {
    var t = ev.target, a = t && t.closest ? t.closest('a[href^="/api/export"], a[href^="/api/invoice"]') : null;
    if (!a) return;
    ev.preventDefault(); ev.stopImmediatePropagation();
    var u = new URL(a.getAttribute('href'), location.origin);
    var parts = u.pathname.split('/'); // ['', 'api', 'export', table] or ['', 'api', 'invoice', id]
    var pdf = u.searchParams.get('format') === 'pdf';
    var win = (pdf || parts[2] === 'invoice') ? window.open('', '_blank') : null;
    (async function () {
      if (parts[2] === 'invoice') {
        if (!win) throw new Error('Allow pop-ups for this site to see the bill.');
        printPage(win, 'Bill', await invoiceHtml(parts[3]));
        return;
      }
      var kind = EXPORTS[parts[3]];
      if (!kind) throw new Error('This comes in the next stage. Nothing was changed.');
      var s = await session(), st = s && await loadStaff(s.user.id);
      if (!st || st.role !== 'owner') throw new Error('Only the owner can do this.');
      var rows = await kind.get(st.shop_id);
      if (pdf) {
        if (!win) throw new Error('Allow pop-ups for this site to see the file.');
        printPage(win, parts[3], tableHtml(kind.head, rows));
      } else {
        download('bizgrow-' + parts[3] + '.csv', csvOf([kind.head].concat(rows)), 'text/csv;charset=utf-8');
      }
    })().catch(function (e) {
      if (win) win.close();
      B.toast((e && e.message) || 'Something went wrong. Please try again.');
    });
  }, true);

  // Every /api call the screens make. Returns a Response.
  async function realApi(path, method, body, qs) {
    if (path === '/config') return reply(200, { reset_email: false });
    if (path === '/me') {
      var me;
      try { me = await getMe(); }
      catch (e) {
        var sess = await session();
        if (sess) { B.toast('Google sign-in worked, but your shop could not be opened. The database setup may be missing. Code: ' + String((e && e.message) || e).slice(0, 80)); }
        return fail(401, SIGN_IN);
      }
      return me ? reply(200, me) : fail(401, SIGN_IN);
    }
    if (path === '/logout' && method === 'POST') { await sb.auth.signOut(); return reply(200, { ok: true }); }
    if (/^\/(login|password|invite)/.test(path) || path === '/signup') {
      return fail(400, path.indexOf('/invite') === 0 ? 'This invite link is not valid.' : 'Sign in with Google. Email and password are not used here.');
    }

    var s = await session();
    if (!s) return fail(401, SIGN_IN);
    var uid = s.user.id;
    var st = await loadStaff(uid);
    if (!st) return fail(401, SIGN_IN);
    var shopId = st.shop_id, owner = st.role === 'owner';

    // Sign-up answers, consent and shop settings (the part that is real in stage 1).
    if (path === '/consent' && method === 'POST') {
      var granted = !!(body && body.granted), at = nowIso();
      dataOf(await sb.from('consent_records').insert({ auth_user_id: uid, shop_id: shopId, granted: granted, text_version: CONSENT_VERSION, granted_at: at }));
      return reply(200, { ok: true, consent: { granted: granted, at: at, text_version: CONSENT_VERSION } });
    }
    if (path === '/signup/answers' && method === 'PUT') {
      var part = (body && body.answers) || {}, fields = {};
      ANSWER_KEYS.forEach(function (k) { if (part[k] !== undefined) fields[k] = part[k] === '' ? null : part[k]; });
      var rec = Object.assign({}, fields, { shop_id: shopId, updated_at: nowIso() });
      if (body && body.done) rec.done = true;
      var existing = await loadSignup(uid);
      if (existing) dataOf(await sb.from('signup_answers').update(rec).eq('id', existing.id));
      else dataOf(await sb.from('signup_answers').insert(Object.assign(rec, { auth_user_id: uid })));
      if (fields.shop_name !== undefined || fields.trade !== undefined || fields.city !== undefined) {
        dataOf(await sb.rpc('update_my_shop', { p_shop: shopId, p_name: fields.shop_name || null, p_trade: fields.trade || null, p_city: fields.city || null, p_lang: null }));
      }
      return reply(200, { ok: true, signup_done: !!(body && body.done) });
    }
    if (path === '/language' && method === 'PUT') {
      if (owner && body && body.lang) dataOf(await sb.rpc('update_my_shop', { p_shop: shopId, p_name: null, p_trade: null, p_city: null, p_lang: body.lang }));
      return reply(200, { ok: true });
    }
    if (path === '/business' && method === 'PUT') {
      if (!owner) return fail(400, 'Only the owner can change the shop.');
      var b = body || {};
      dataOf(await sb.rpc('update_my_shop', { p_shop: shopId, p_name: b.name || null, p_trade: b.trade || null, p_city: b.city || null, p_lang: b.lang || null }));
      // The store button sends the whole shop back, so a missing database update must not block it.
      try { await saveProfile(shopId, { phone: b.phone, upi_id: b.upi_id, address: b.address }, 'Phone, UPI ID and address'); }
      catch (e) { if (/cannot be saved yet/.test(e.message)) return reply(200, { ok: true, warning: e.message }); throw e; }
      return reply(200, { ok: true });
    }
    if (path === '/v2/settings' && method === 'PUT') {
      if (!owner) return fail(400, 'Only the owner can change settings.');
      var sv = body || {};
      if (sv.assistant_name == null) return reply(200, { ok: true });
      var an = String(sv.assistant_name).trim();
      await saveProfile(shopId, { assistant_name: an }, 'The assistant name');
      return reply(200, { ok: true, assistant_name: an });
    }
    if ((path === '/onboarding' && method === 'PUT') || (path === '/starter' && method === 'POST')) return reply(200, { ok: true });

    // Shop data (stage 2): items, people, sales, expenses, tasks, reports, audit, staff and privacy.
    var shopRes = await shopRoute(path, method, body, qs, st);
    if (shopRes) return shopRes;

    // Later-stage reads: an empty list until they are built.
    if (method === 'GET' && !/^\/(v2\/export|privacy\/download)/.test(path)) return reply(200, { items: [] });

    // Later-stage writes and exports: a plain message, nothing changed.
    return fail(400, COMING);
  }

  // Keep the page's own fetch calls to the same "/api" addresses; answer them here.
  var baseFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : ((input && input.url) || '');
    if (url.indexOf('/api/') !== 0) return baseFetch(input, init);
    var u = new URL(url, location.origin);
    var path = u.pathname.slice(4);
    var method = ((init && init.method) || 'GET').toUpperCase();
    var body = null;
    if (init && init.body) { try { body = JSON.parse(init.body); } catch (e) { body = null; } }
    return realApi(path, method, body, u.searchParams).catch(function (e) {
      return fail(400, (e && e.message) || 'Something went wrong. Please try again.');
    });
  };

  // Google sign-in. Comes back to this same page address after the Google step.
  B.ACT['google-signin'] = async function () {
    if (location.protocol === 'file:') {
      B.toast('Google sign-in works only on the live website address. Open that address to sign in.');
      return;
    }
    var r = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + window.location.pathname }
    });
    if (r && r.error) throw new Error('Could not start Google sign-in. Please try again.');
  };

  // Called by app.js on the sign-in screen: keep only the Google button and the terms.
  B.authDone = function () {
    var box = document.querySelector('.auth .box');
    if (!box) return;
    box.querySelectorAll('form, .auth-switch, .or').forEach(function (el) { el.remove(); });
    var g = box.querySelector('.gbtn');
    if (g) {
      g.removeAttribute('disabled'); g.removeAttribute('aria-disabled'); g.removeAttribute('title');
      g.classList.add('big');
      g.setAttribute('data-act', 'google-signin');
      var em = g.querySelector('em'); if (em) em.remove();
    }
  };

  // First sign-up step for a new owner: ask for consent before the six questions. Unticked by default.
  function consentScreen() {
    var link = '<a href="#" data-act="privacy-notice">' + esc(B.tx('privacy_link')) + '</a>';
    document.documentElement.lang = B.S.lang;
    $('#app').innerHTML = '<div class="su-wrap"><div class="su-box rc-box">' +
      '<div class="su-top"><div class="su-brand">BizGrow</div></div>' +
      '<h2 class="su-title">' + esc(B.tx('pv_consent_title')) + '</h2>' +
      '<label class="chk rc-chk"><input type="checkbox" id="rcOk"><span>' + B.tx('consent_text').replace('{p}', link) + '</span></label>' +
      '<button type="button" class="btn block" id="rcGo" disabled data-act="real-consent">' + esc(B.tx('su_next')) + '</button>' +
      '<div class="su-out"><button type="button" class="linkbtn" data-act="logout">' + esc(B.tx('su_signout')) + '</button></div>' +
      '</div></div>';
    var cb = document.getElementById('rcOk'), go = document.getElementById('rcGo');
    cb.onchange = function () { go.disabled = !cb.checked; };
  }
  B.ACT['real-consent'] = async function () {
    var cb = document.getElementById('rcOk');
    if (!cb || !cb.checked) return;
    await B.api('/consent', 'POST', { granted: true });
    B.S.me = await B.api('/me');
    B.render();
  };
  var baseGate = B.gate;
  B.gate = function () {
    var me = B.S.me;
    if (me && me.signup_done === false && !(me.consent && me.consent.granted)) { consentScreen(); return true; }
    return baseGate ? baseGate() : false;
  };
})();
