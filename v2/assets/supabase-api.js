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
    if (r && r.error) {
      var perm = r.error.code === '42501' || /owner/i.test(r.error.message || '');
      throw new Error(perm ? 'Only the owner can do this.' : 'Something went wrong. Please try again.');
    }
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
        assistant_name: shop.assistant_name || '', staff_discount_limit: 0 },
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

    // Shop data that is real now: items, customers, people.
    if (path === '/products' && method === 'GET') {
      var prods = dataOf(await sb.from('products').select('*').is('deleted_at', null));
      return reply(200, { items: (prods || []).map(mapProduct) });
    }
    if (path === '/customers' && method === 'GET') {
      var custs = dataOf(await sb.from('customers').select('*'));
      return reply(200, { items: (custs || []).map(function (c) { return { id: c.id, name: c.name || '', phone: c.phone || '', balance: 0 }; }) });
    }
    if (path === '/team' && method === 'GET' || path === '/v2/staff' && method === 'GET') {
      var mem = dataOf(await sb.from('staff').select('id,name,email,role,active').eq('shop_id', shopId));
      var list = (mem || []).map(function (x) {
        return { id: x.id, name: x.name || '', email: x.email || '', role: appRole(x.role), v2role: x.role, status: x.active ? 'active' : 'suspended' };
      });
      return reply(200, path === '/team' ? { members: list } : list);
    }
    if (path === '/dashboard' && method === 'GET') {
      var dp = dataOf(await sb.from('products').select('*').is('deleted_at', null));
      var items = (dp || []).map(mapProduct);
      return reply(200, {
        today: emptyDay(), yesterday: { sales: 0, bills: 0 },
        udhar: { total: 0, people: 0 },
        low_stock: items.filter(function (p) { return p.reorder > 0 && p.stock <= p.reorder; }),
        setup: { items: items.length }, tasks_due: 0
      });
    }
    if (path === '/reports' && method === 'GET') {
      return reply(200, { totals: { revenue: 0, bills: 0, expenses: 0, profit: 0 }, daily: [], top: [], expenses_by_category: [] });
    }
    if (path === '/zreport' && method === 'GET') {
      return reply(200, { date: B.today(), shop: '', bills: 0, total: 0, cash_sales: 0, upi_sales: 0, credit_given: 0, udhar_cash: 0, expenses: 0, expenses_cash: 0, cash_in_hand: 0 });
    }
    if (path === '/v2/audit' && method === 'GET') return reply(200, []);
    if (path === '/v2/udhar' && method === 'GET') return reply(200, { total: 0, overdue_total: 0, people: [], items: [] });
    if (path === '/v2/summary' && method === 'GET') return reply(200, { date: (qs && qs.get('date')) || B.today(), sales: 0, bills: 0, expenses: 0, profit: 0, collected: 0, items: [] });

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
