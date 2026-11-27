/* BizGrow v2: "Have a promo code?", online payment (Razorpay through the Worker) and the platform owner's promo screen.
   Shown on the Plan page (#/settings/plan). The owner-only promo screen is #/settings/plan/promos.
   Loaded after app.js (window.BGV2). Plan prices and rules live in the database (patch-14, patch-15). */
(function () {
  'use strict';
  var B = window.BGV2;
  if (!B) return;
  var esc = B.esc, t = B.t;
  var RZP_SRC = 'https://checkout.razorpay.com/v1/checkout.js';
  var adminBox = null;
  var adminKnown = null;
  var adminPlanNames = {};

  function fill(s, k, v) { return String(s).split('{' + k + '}').join(String(v)); }
  function dayText(iso) {
    try { return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }); }
    catch (e) { return String(iso || '').slice(0, 10); }
  }
  function errText(e) { return (e && e.message) || t('bl_fail'); }

  function loadRazorpay() {
    if (window.Razorpay) return Promise.resolve();
    return new Promise(function (ok, bad) {
      var s = document.createElement('script');
      s.src = RZP_SRC;
      s.onload = function () { ok(); };
      s.onerror = function () { bad(new Error(t('bl_fail'))); };
      document.head.appendChild(s);
    });
  }

  // Only a good answer is remembered. A failed check throws, so the page can show a retry instead of "no access".
  async function isAdmin() {
    if (adminKnown !== null) return adminKnown;
    var r = await B.api('/admin/me');
    adminKnown = !!(r && r.admin);
    return adminKnown;
  }

  // Inline message and a Try again button. Used instead of a sign-out when a plan or admin load fails.
  function retryBox(message, action) {
    return '<div class="card mt"><p class="small">' + esc(message) + '</p>' +
      '<div class="mt"><button class="btn sec sm" data-act="' + action + '">' + esc(t('bl_retry')) + '</button></div></div>';
  }

  // ---------- Plan page: promo card, pay buttons, link for the platform owner ----------
  // The Plan page is reached from #/settings/plan and from #/plans (sidebar and More).
  function onPlanScreen() { return B.S.page === 'plans' || B.S.page === 'settings'; }

  async function planExtras(v) {
    var cur, list, cfg, admin;
    try {
      var got = await Promise.all([
        B.api('/plan'),
        B.api('/plans'),
        B.api('/billing/config').catch(function () { return { enabled: false }; }),
        isAdmin()
      ]);
      cur = got[0]; list = (got[1] && got[1].items) || []; cfg = got[2] || {}; admin = got[3];
    } catch (e) {
      // The user may have moved to another page while this loaded.
      if (!v.isConnected || !onPlanScreen()) return;
      var failBox = document.createElement('div');
      failBox.className = 'bg-billing';
      failBox.innerHTML = retryBox(t('bl_plan_fail'), 'plan-retry');
      v.appendChild(failBox);
      return;
    }
    // The user may have moved to another page while this loaded.
    if (!v.isConnected || !onPlanScreen()) return;

    var box = document.createElement('div');
    box.className = 'bg-billing';
    var html = '';
    // A paid or promo plan with an end date: a gentle note with the days left. Free shops show nothing.
    if (cur && cur.plan_until_text && cur.days_left != null && cur.code !== 'free') {
      var nLeft = Number(cur.days_left);
      var key = nLeft <= 0 ? 'bl_ends_today' : (nLeft === 1 ? 'bl_ends_tomorrow' : 'bl_ends_in');
      var note = fill(fill(fill(t(key), 'plan', cur.name || cur.code), 'n', nLeft), 'date', cur.plan_until_text);
      note = fill(note, 'back', cur.back_to_name || 'Free');
      html += '<div class="card mt" role="status"><p class="small" style="margin:0">' + esc(note) + '</p></div>';
    }
    // Only the shop owner can use a code or pay (the database and the Worker check this too).
    if (B.isOwner()) {
      html += '<div class="card mt"><h3 style="margin:0">' + esc(t('bl_pay_title')) + '</h3>' +
        '<p class="small muted mt">' + esc(cfg.enabled ? t('bl_pay_sub') : t('bl_pay_soon_note')) + '</p></div>' +
        '<div class="card mt"><h3 style="margin:0">' + esc(t('bl_promo_title')) + '</h3>' +
        '<p class="small muted mt">' + esc(t('bl_promo_sub')) + '</p>' +
        '<div class="row mt" style="gap:8px"><input id="blCode" class="in" style="flex:1;text-transform:uppercase" maxlength="30" autocomplete="off" autocapitalize="characters" placeholder="' + esc(t('bl_promo_ph')) + '">' +
        '<button class="btn" data-act="bill-promo">' + esc(t('bl_promo_btn')) + '</button></div>' +
        '<div id="blPromoMsg" class="small mt" role="status"></div></div>';
    }
    if (admin) {
      html += '<div class="card mt"><a class="link" href="#/settings/plan/promos">' + esc(t('bl_admin_link')) + '</a></div>';
    }
    box.innerHTML = html;
    v.appendChild(box);
    if (B.isOwner()) fillPlanActions(v, cur, list, cfg);
  }

  // Each plan card (app.js leaves an empty slot for the owner) gets: Pay first when payments are on,
  // or a disabled "Online payment coming soon" when they are off. The manual request stays as the secondary button.
  function fillPlanActions(v, cur, list, cfg) {
    var curOrder = cur.sort_order || 0;
    var slots = v.querySelectorAll('.plan-act');
    for (var i = 0; i < slots.length; i++) {
      var el = slots[i];
      var code = el.getAttribute('data-plan-code');
      var p = list.filter(function (x) { return x.code === code; })[0];
      if (!p || p.code === cur.code) continue;
      var h = '';
      if (p.sort_order > curOrder) {
        if (cfg.enabled) {
          h += '<button class="btn" data-act="bill-pay" data-plan="' + esc(p.code) + '">' +
            esc(fill(t('bl_pay_btn'), 'plan', p.name)) + '</button>';
        } else {
          h += '<button class="btn sec" disabled>' + esc(t('bl_pay_soon')) + '</button>';
        }
      }
      h += '<div class="mt"><button class="btn sec sm" data-act="planreq" data-plan="' + esc(p.code) + '">' +
        esc(t('s3_ask_upgrade')) + '</button></div>';
      el.innerHTML = h;
    }
  }

  // Promo code redemption.
  B.ACT['bill-promo'] = async function () {
    var inp = document.getElementById('blCode');
    var msg = document.getElementById('blPromoMsg');
    var code = inp ? inp.value.replace(/\s+/g, '').toUpperCase() : '';
    if (!code) { if (msg) msg.textContent = t('bl_promo_need'); return; }
    try {
      var r = await B.api('/promo/redeem', 'POST', { code: code });
      if (r && r.ok) {
        var text = fill(t('bl_promo_ok'), 'plan', r.plan_name || r.plan);
        if (r.plan_until) text += ' ' + fill(t('bl_promo_until'), 'date', dayText(r.plan_until));
        B.toast(text);
        B.S.me = await B.api('/me');
        B.render();
        return;
      }
      if (msg) msg.textContent = (r && r.message) || t('bl_fail');
    } catch (e) {
      if (msg) msg.textContent = errText(e);
    }
  };

  // Online payment: create the order on the server, open Razorpay checkout, confirm on the server.
  B.ACT['bill-pay'] = async function (el) {
    var plan = el.dataset.plan;
    el.disabled = true;
    try {
      var o = await B.api('/billing/create-order', 'POST', { shop_id: B.S.me.shop.id, plan: plan });
      await loadRazorpay();
      var rz = new window.Razorpay({
        key: o.keyId,
        amount: o.amount,
        currency: o.currency,
        order_id: o.orderId,
        name: 'BizGrow',
        description: o.plan,
        prefill: { name: (B.S.me.user && B.S.me.user.name) || '' },
        handler: function (resp) { confirmPay(resp, o.plan); },
        modal: { ondismiss: function () { el.disabled = false; } }
      });
      rz.open();
    } catch (e) {
      el.disabled = false;
      B.toast(errText(e));
    }
  };

  async function confirmPay(resp, planCode) {
    try {
      var r = await B.api('/billing/verify', 'POST', {
        razorpay_order_id: resp.razorpay_order_id,
        razorpay_payment_id: resp.razorpay_payment_id,
        razorpay_signature: resp.razorpay_signature
      });
      B.toast(r && r.status === 'pending' ? t('bl_pay_pending') : fill(t('bl_pay_done'), 'plan', planCode));
      B.S.me = await B.api('/me');
      B.render();
    } catch (e) {
      B.toast(errText(e));
    }
  }

  // ---------- Platform owner: make, list and switch off promo codes ----------
  function adminBack() { return '<a class="link" href="#/settings/plan">← ' + esc(t('bl_back')) + '</a>'; }

  async function adminScreen(v) {
    v.innerHTML = '';
    adminBox = document.createElement('div');
    adminBox.className = 'bg-billing';
    v.appendChild(adminBox);
    var admin;
    try { admin = await isAdmin(); }
    catch (e) {
      adminBox.innerHTML = adminBack() + retryBox(t('bl_plan_fail'), 'plan-retry');
      return;
    }
    if (!admin) {
      adminBox.innerHTML = adminBack() + '<div class="card mt"><p>' + esc(t('bl_no_access')) + '</p></div>';
      return;
    }
    await drawAdmin();
  }

  async function drawAdmin() {
    if (!adminBox) return;
    var plans, codes;
    try {
      var got = await Promise.all([B.api('/plans'), B.api('/admin/promos')]);
      plans = (got[0] && got[0].items) || [];
      codes = (got[1] && got[1].items) || [];
    } catch (e) {
      adminBox.innerHTML = adminBack() + retryBox(errText(e), 'plan-retry');
      return;
    }
    adminPlanNames = {};
    plans.forEach(function (p) { adminPlanNames[p.code] = p.name; });
    var planOpts = plans.map(function (p) { return '<option value="' + esc(p.code) + '">' + esc(p.name) + '</option>'; }).join('');
    var form = '<div class="card mt"><h3 style="margin:0">' + esc(t('bl_adm_new')) + '</h3>' +
      '<div class="mt"><label class="small">' + esc(t('bl_adm_code')) + '</label><input id="blNewCode" class="in" maxlength="30" style="text-transform:uppercase" autocomplete="off"></div>' +
      '<div class="mt"><label class="small">' + esc(t('bl_adm_plan')) + '</label><select id="blNewPlan" class="in">' + planOpts + '</select></div>' +
      '<div class="mt"><label class="small">' + esc(t('bl_adm_dur')) + '</label><select id="blNewDur" class="in">' +
        '<option value="30">' + esc(t('bl_adm_d30')) + '</option>' +
        '<option value="90">' + esc(t('bl_adm_d90')) + '</option>' +
        '<option value="365">' + esc(t('bl_adm_d365')) + '</option>' +
        '<option value="forever">' + esc(t('bl_adm_forever')) + '</option></select></div>' +
      '<div class="mt"><label class="small">' + esc(t('bl_adm_max')) + '</label><input id="blNewMax" class="in" type="number" min="1" max="10000" value="1"></div>' +
      '<div class="mt"><label class="small">' + esc(t('bl_adm_exp')) + '</label><input id="blNewExp" class="in" type="date"></div>' +
      '<div class="mt"><button class="btn" data-act="bill-promo-make">' + esc(t('bl_adm_make')) + '</button></div></div>';

    var rows = codes.length ? codes.map(function (c) {
      var planName = (plans.filter(function (p) { return p.code === c.plan; })[0] || {}).name || c.plan;
      var length = c.duration_days == null ? t('bl_forever') : c.duration_days + ' d';
      var until = c.expires_at ? ' · ' + t('bl_until_label') + ' ' + dayText(c.expires_at) : '';
      var used = fill(fill(t('bl_adm_used'), 'n', c.used_count), 'm', c.max_uses);
      var left = Math.max(0, Number(c.max_uses || 0) - Number(c.used_count || 0));
      used += ' · ' + fill(t('bl_adm_left'), 'n', left);
      return '<div class="li"><div class="grow"><b>' + esc(c.code) + '</b><div class="small muted">' + esc(planName) + ' · ' +
        esc(length) + until + '</div>' +
        '<div class="small">' + esc(used) + '</div>' +
        '<div class="mt"><button class="btn sec sm" data-act="bill-promo-who" data-id="' + esc(c.id) + '">' + esc(t('bl_adm_who')) + '</button></div>' +
        '<div class="who-list"></div></div>' +
        '<div><span class="badge ' + (c.active ? '' : ' amber') + '">' + esc(c.active ? t('bl_adm_on') : t('bl_adm_off')) + '</span>' +
        '<div class="mt"><button class="btn sec sm" data-act="bill-promo-toggle" data-id="' + esc(c.id) + '" data-active="' + (c.active ? 'true' : 'false') + '">' +
        esc(c.active ? t('bl_adm_switch_off') : t('bl_adm_switch_on')) + '</button></div></div></div>';
    }).join('') : '<p class="small muted">' + esc(t('bl_adm_none')) + '</p>';

    adminBox.innerHTML = adminBack() + B.head(t('bl_adm_title'), t('bl_adm_sub')) + form +
      '<div class="card mt"><h3 style="margin:0">' + esc(t('bl_adm_list')) + '</h3><div class="list mt">' + rows + '</div></div>';
  }

  // Who used a code: the shop, the plan it got, the end date, and when it was used.
  B.ACT['bill-promo-who'] = async function (el) {
    var box = el.parentNode && el.parentNode.parentNode ? el.parentNode.parentNode.querySelector('.who-list') : null;
    if (!box) return;
    if (box.getAttribute('data-open') === 'true') {
      box.setAttribute('data-open', 'false'); box.innerHTML = ''; el.textContent = t('bl_adm_who'); return;
    }
    el.disabled = true;
    try {
      var r = await B.api('/admin/promos/usage', 'POST', { id: el.dataset.id });
      var items = (r && r.items) || [];
      box.innerHTML = items.length ? items.map(function (u) {
        var key = u.plan_until ? 'bl_adm_who_row' : 'bl_adm_who_row_good';
        var line = fill(fill(fill(fill(t(key), 'shop', u.shop_name || '-'), 'plan', adminPlanNames[u.plan] || u.plan || '-'), 'date', u.plan_until ? dayText(u.plan_until) : ''), 'when', dayText(u.redeemed_at));
        return '<div class="small mt">' + esc(line) + '</div>';
      }).join('') : '<p class="small muted mt">' + esc(t('bl_adm_who_none')) + '</p>';
      box.setAttribute('data-open', 'true');
      el.textContent = t('bl_adm_who_hide');
    } catch (e) {
      box.innerHTML = '<p class="small mt">' + esc(errText(e)) + '</p>';
    } finally {
      el.disabled = false;
    }
  };

  B.ACT['bill-promo-make'] = async function () {
    function val(id) { var el = document.getElementById(id); return el ? el.value : ''; }
    var dur = val('blNewDur');
    var exp = val('blNewExp');
    var body = {
      code: val('blNewCode').replace(/\s+/g, '').toUpperCase(),
      plan: val('blNewPlan'),
      duration_days: dur === 'forever' ? null : Number(dur),
      max_uses: Number(val('blNewMax')),
      expires_at: exp ? new Date(exp + 'T23:59:59+05:30').toISOString() : null
    };
    try {
      var r = await B.api('/admin/promos', 'POST', body);
      B.toast(fill(t('bl_adm_made'), 'code', (r && r.code) || body.code));
      await drawAdmin();
    } catch (e) { B.toast(errText(e)); }
  };

  B.ACT['bill-promo-toggle'] = async function (el) {
    try {
      await B.api('/admin/promos/active', 'POST', { id: el.dataset.id, active: el.dataset.active !== 'true' });
      await drawAdmin();
    } catch (e) { B.toast(errText(e)); }
  };

  // Try again on the Plan page and the promo screen: redraw the screen. Never signs anyone out.
  B.ACT['plan-retry'] = function () { B.render(); };

  // Hook: app.js calls BGV2.after(page, view, subpath) after each screen is drawn.
  var before = B.after;
  B.after = function (page, v, sub) {
    if (before) before(page, v, sub);
    // #/plans is the sidebar and More entry to the same Plan page (see app.js).
    if (page === 'plans' && v) { planExtras(v); return; }
    if (page !== 'settings' || !v || !sub || sub[0] !== 'plan') return;
    if (sub[1] === 'promos') { adminScreen(v); return; }
    if (!sub[1]) planExtras(v);
  };
})();
