/* BizGrow v2: sign-up questions, sign-up consent, privacy notice and the consent switch on the Privacy page.
   Six questions, one per screen, after an owner signs up (or logs in before finishing), before Home.
   Only the optional questions can be skipped. Demo only: answers are kept in this browser through the mock API,
   in the shape the future server will use. Loaded after app.js and v2-privacy.js. */
(function () {
  'use strict';
  var B = window.BGV2; if (!B) return;
  function esc(s) { return B.esc(s); }
  function $(s) { return document.querySelector(s); }

  // Consent wording version. Bump it (and mock-api.js CONSENT_VERSION) whenever the consent or notice text changes.
  var CONSENT_VERSION = 'signup-consent-v1';
  var LANG_NAMES = { en: 'English', hi: 'हिन्दी', mr: 'मराठी', gu: 'ગુજરાતી' };

  // Config lists. To add a trade later (for example manufacturer or wholesale), add its key here and a
  // su_trade_<key> line in v2-i18n-signup.js. The server list must match.
  var CONFIG = {
    trades: ['textile', 'plastic', 'chemical', 'agri', 'other'],
    teams: ['just_me', '2_5', '6_20', '20_plus'],
    problems: ['udhar', 'stock', 'accounts', 'staff', 'other'],
    owe: ['0_10', '10_50', '50_plus']
  };

  // The six questions, in order. Only the optional ones (required: false) can be skipped.
  var STEPS = [
    { key: 'shop_name', type: 'text', required: true, max: 60 },
    { key: 'trade', type: 'choice', required: true, list: CONFIG.trades, prefix: 'su_trade_' },
    { key: 'city', type: 'text', required: false, max: 40 },
    { key: 'team_size', type: 'choice', required: false, list: CONFIG.teams, prefix: 'su_team_' },
    { key: 'problem', type: 'choice', required: false, list: CONFIG.problems, prefix: 'su_problem_' },
    { key: 'udhar_customers', type: 'choice', required: false, list: CONFIG.owe, prefix: 'su_owe_' }
  ];

  var W = null; // state of the questions while they are on screen

  function hasAnswer(o, k) { return !!o && o[k] !== undefined && o[k] !== null && o[k] !== ''; }

  // Called by app.js before the normal screens. Returns true when the questions took over the screen.
  B.gate = function () {
    var me = B.S.me;
    if (!me || me.signup_done !== false) { W = null; return false; }
    if (!W) {
      W = { i: 0, a: Object.assign({}, me.signup_answers || {}), busy: false };
      var first = -1;
      for (var j = 0; j < STEPS.length; j++) { if (!hasAnswer(W.a, STEPS[j].key)) { first = j; break; } }
      W.i = first < 0 ? STEPS.length - 1 : first;
    }
    draw();
    return true;
  };

  function draw() {
    var s = STEPS[W.i], n = W.i + 1, total = STEPS.length, cur = W.a[s.key];
    document.documentElement.lang = B.S.lang;
    var langs = Object.keys(LANG_NAMES).map(function (k) {
      return '<option value="' + k + '"' + (B.S.lang === k ? ' selected' : '') + '>' + LANG_NAMES[k] + '</option>';
    }).join('');
    var dots = STEPS.map(function (x, j) {
      return '<span class="su-dot' + (j < W.i ? ' done' : '') + (j === W.i ? ' on' : '') + '"></span>';
    }).join('');
    var back = W.i > 0 ? '<button type="button" class="btn sec" data-act="su-back">' + esc(B.tx('su_back')) + '</button>' : '<span></span>';
    var skip = s.required ? '' : '<button type="button" class="btn sec" data-act="su-skip">' + esc(B.tx('su_skip')) + '</button>';
    var body;
    if (s.type === 'text') {
      var ph = s.key === 'shop_name' ? 'su_name_ph' : 'su_city_ph';
      var last = W.i === STEPS.length - 1;
      body = '<form data-form="su" class="su-form">' +
        '<input class="in su-in" name="' + s.key + '" value="' + esc(cur || '') + '" placeholder="' + esc(B.tx(ph)) + '"' +
        ' autocomplete="off" maxlength="' + s.max + '"' + (s.required ? ' required' : '') + ' aria-label="' + esc(B.tx('su_q' + n)) + '">' +
        '<div class="su-nav">' + back + skip + '<button type="submit" class="btn">' + esc(B.tx(last ? 'su_finish' : 'su_next')) + '</button></div></form>';
    } else {
      body = '<div class="su-opts">' + s.list.map(function (v) {
        return '<button type="button" class="su-opt" aria-pressed="' + (cur === v) + '" data-act="su-pick" data-v="' + v + '">' + esc(B.tx(s.prefix + v)) + '</button>';
      }).join('') + '</div><div class="su-nav">' + back + skip + '<span></span></div>';
    }
    var html =
      '<div class="su-wrap"><div class="su-box">' +
        '<div class="su-top"><div class="su-brand">BizGrow</div>' +
        '<select class="in su-lang" id="suLang" aria-label="' + esc(B.tx('su_lang_name')) + '">' + langs + '</select></div>' +
        '<div class="su-dots" aria-hidden="true">' + dots + '</div>' +
        '<div class="su-count">' + esc(B.tx('su_progress', { n: n, total: total })) + '</div>' +
        '<h2 class="su-title">' + esc(B.tx('su_q' + n)) + '</h2>' +
        '<p class="su-hint">' + esc(B.tx('su_q' + n + '_hint')) + '</p>' +
        body +
        '<div class="su-out"><button type="button" class="linkbtn" data-act="logout">' + esc(B.tx('su_signout')) + '</button></div>' +
      '</div></div>';
    $('#app').innerHTML = html;
    var sel = document.getElementById('suLang');
    if (sel) sel.onchange = function () {
      B.S.lang = sel.value; localStorage.setItem('bg_lang', sel.value);
      B.api('/language', 'PUT', { lang: sel.value }).catch(function () { /* demo: keep going */ });
      draw();
    };
  }

  // Save one answer (or a skip) and move on. The last question also marks the sign-up finished.
  async function answer(value) {
    if (!W || W.busy) return;
    var s = STEPS[W.i], partial = {};
    if (value !== undefined && value !== '') { partial[s.key] = value; W.a[s.key] = value; }
    var last = W.i === STEPS.length - 1;
    W.busy = true;
    try {
      if (last) await B.api('/signup/answers', 'PUT', { answers: partial, done: true });
      else if (Object.keys(partial).length) await B.api('/signup/answers', 'PUT', { answers: partial, done: false });
    } catch (err) {
      W.busy = false; B.toast(err.message || B.tx('su_need_name')); return;
    }
    W.busy = false;
    if (last) return finish();
    W.i++; draw();
  }

  async function finish() {
    try { B.S.me = await B.api('/me'); }
    catch (e) { B.S.me = Object.assign({}, B.S.me, { signup_done: true }); }
    W = null;
    B.toast(B.tx('su_done'));
    B.go('#/home');
  }

  B.ACT['su-pick'] = function (el) { answer(el.dataset.v); };
  B.ACT['su-skip'] = function () { if (W && !STEPS[W.i].required) answer(undefined); };
  B.ACT['su-back'] = function () { if (W && W.i > 0 && !W.busy) { W.i--; draw(); } };

  // Text questions post their form here. The required ones must have something typed.
  B.FORM.su = async function (f, d) {
    var s = STEPS[W.i];
    var v = String(d[s.key] || '').trim();
    if (s.required && !v) throw new Error(B.tx(s.key === 'shop_name' ? 'su_need_name' : 'su_need_trade'));
    await answer(v);
  };

  // Sign-up form: the box must be ticked. The shop name and trade are now asked in the questions.
  B.FORM.signup = async function (f, d) {
    if (!d.consent) throw new Error(B.tx('su_consent_need'));
    var lang = B.S.lang;
    await B.api('/signup', 'POST', d);
    await B.api('/language', 'PUT', { lang: lang }).catch(function () { /* demo: keep going */ });
    B.S.me = await B.api('/me');
    B.S.lang = (B.S.me.shop && B.S.me.shop.lang) || lang;
    B.go('#/home');
  };

  // ---- privacy notice (sign-up link and the Privacy page) ----
  var NOTICE = [['pn_collect_h', 'pn_collect'], ['pn_who_h', 'pn_who'], ['pn_why_h', 'pn_why'], ['pn_out_h', 'pn_out'], ['pn_contact_h', 'pn_contact'], ['pn_record_h', 'pn_record']];
  function noticeBody() {
    return NOTICE.map(function (p) {
      return '<h4>' + esc(B.tx(p[0])) + '</h4><p>' + esc(B.tx(p[1], { v: CONSENT_VERSION })) + '</p>';
    }).join('');
  }
  B.ACT['privacy-notice'] = function () {
    B.modal('<h2>' + esc(B.tx('pn_title')) + '</h2><p class="small muted mb">' + esc(B.tx('pn_intro')) + '</p>' +
      '<div class="su-notice">' + noticeBody() + '</div>' +
      '<button class="btn block mt" onclick="this.closest(\'.ov\').close()">OK</button>');
  };

  function when(iso) {
    var loc = { en: 'en-IN', hi: 'hi-IN', mr: 'mr-IN', gu: 'gu-IN' }[B.S.lang] || 'en-IN';
    try { return new Date(iso).toLocaleString(loc, { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }); }
    catch (e) { return String(iso || ''); }
  }

  // Privacy page: the consent switch (top) and the full notice (bottom).
  B.on('privacy', function (v) {
    var rec = (B.S.me && B.S.me.consent) || null;
    var on = !!(rec && rec.granted);
    var consentCard =
      '<div class="card" style="margin-bottom:14px"><h3>' + esc(B.tx('pv_consent_title')) + '</h3>' +
      '<p class="muted small mb">' + esc(B.tx('pv_consent_sub')) + '</p>' +
      '<label class="sw"><input type="checkbox" role="switch" data-v2="consent"' + (on ? ' checked' : '') + '>' +
      '<span class="sw-track" aria-hidden="true"></span><span class="bold">' + esc(B.tx(on ? 'pv_on' : 'pv_off')) + '</span></label>' +
      '<p class="muted small mt">' + (rec ? esc(B.tx('pv_record', { when: when(rec.at), v: rec.text_version || CONSENT_VERSION })) : esc(B.tx('pv_record_none'))) + '</p></div>';
    B.placeTop(v, consentCard);
    var grid = v.querySelector('.grid');
    var notice = '<div class="card su-wide"><h3>' + esc(B.tx('pv_notice_title')) + '</h3>' +
      '<p class="muted small mb">' + esc(B.tx('pv_notice_sub')) + '</p>' +
      '<div class="su-notice">' + noticeBody() + '</div></div>';
    if (grid) grid.insertAdjacentHTML('beforeend', notice);
  });

  // The switch records every change as a dated entry.
  document.addEventListener('change', async function (e) {
    var el = e.target;
    if (!el || !el.matches || !el.matches('[data-v2="consent"]')) return;
    var granted = el.checked;
    el.disabled = true;
    try {
      var r = await B.api('/consent', 'POST', { granted: granted });
      B.S.me.consent = r.consent;
      B.toast(B.tx(granted ? 'pv_on' : 'pv_off'));
      B.render();
    } catch (err) {
      el.checked = !granted;
      B.toast(err.message || B.tx('pv_off'));
    } finally { el.disabled = false; }
  });
})();
