/* BizGrow v2: udhar (credit) view. Due dates, days late, party ledger, advance, and reminder drafts.
   Shown on the Khata page (list) and on each customer page (ledger). Reminders open WhatsApp with a draft the member can edit. */
(function () {
  'use strict';
  var B = window.BGV2; if (!B) return;
  var LANGS = [['en', 'English'], ['hi', 'हिन्दी'], ['mr', 'मराठी'], ['gu', 'ગુજરાતી']];
  var people = {};

  function esc(s) { return B.esc(s); }
  // Text in a chosen language (not always the app language).
  function tl(L, k, vars) {
    var d = (window.I18N && window.I18N[L]) || {};
    var s = d[k] || (window.I18N && window.I18N.en && window.I18N.en[k]) || k;
    if (vars) Object.keys(vars).forEach(function (n) { s = s.split('{' + n + '}').join(vars[n]); });
    return s;
  }
  function lateText(n) { return n > 0 ? B.tx('v2_days_late', { n: String(n) }) : B.tx('v2_on_time'); }
  function fmtDate(s) { return s ? String(s).split('-').reverse().join('/') : '-'; }

  function loadUdhar() { return B.api('/v2/udhar'); }

  // Khata list: totals and every person who owes money, with their due date and days late.
  B.on('khata', async function (v, args) {
    if (args && args[0]) return;
    var d; try { d = await loadUdhar(); } catch (e) { return; }
    people = {};
    d.people.forEach(function (p) { people[p.customer_id] = p; });
    var money = d.total != null;
    var h = '<section class="card v2-udhar"><h3>' + esc(B.tx('v2_udhar_title')) + '</h3>' +
      '<p class="muted small">' + esc(B.tx('v2_udhar_sub')) + '</p>';
    if (money) h += '<div class="v2-totals"><div><span class="muted small">' + esc(B.tx('v2_total_due')) + '</span><b>' + esc(B.inr(d.total)) + '</b></div>' +
      '<div><span class="muted small">' + esc(B.tx('v2_overdue_total')) + '</span><b class="v2-err">' + esc(B.inr(d.overdue_total)) + '</b></div></div>';
    if (!d.people.length) h += '<p class="muted">' + esc(B.tx('v2_no_udhar')) + '</p>';
    d.people.forEach(function (p) {
      h += '<div class="v2-row"><div class="grow"><b>' + esc(p.name) + '</b><small class="' + (p.overdue ? 'v2-err' : 'muted') + '">' +
        esc(B.tx('v2_due')) + ': ' + esc(fmtDate(p.oldest_due)) + ' · ' + esc(lateText(p.days_late)) +
        (p.advance > 0 ? ' · ' + esc(B.tx('v2_advance')) + ' ' + esc(B.inr(p.advance)) : '') + '</small></div>' +
        '<div class="v2-amt"><b>' + esc(B.inr(p.balance)) + '</b></div>' +
        '<button class="btn sec sm" data-v2="rem" data-id="' + p.customer_id + '">' + esc(B.tx('v2_reminder')) + '</button></div>';
    });
    h += '</section>';
    B.placeTop(v, h);
  });

  // Customer page: a ledger of their open bills, advance, and a reminder button.
  B.on('khata', async function (v, args) {
    if (!args || !args[0]) return;
    var id = +args[0];
    var d; try { d = await loadUdhar(); } catch (e) { return; }
    var p = d.people.filter(function (x) { return x.customer_id === id; })[0];
    people[id] = p || people[id];
    var h = '<section class="card v2-udhar"><h3>' + esc(B.tx('v2_ledger_title')) + '</h3>';
    if (!p) h += '<p class="muted">' + esc(B.tx('v2_no_udhar')) + '</p>';
    else {
      h += '<div class="v2-totals"><div><span class="muted small">' + esc(B.tx('v2_balance')) + '</span><b>' + esc(B.inr(p.balance)) + '</b></div>' +
        '<div><span class="muted small">' + esc(B.tx('v2_advance')) + '</span><b>' + esc(B.inr(p.advance)) + '</b></div></div>';
      h += '<div class="v2-ledger">';
      p.bills.forEach(function (b) {
        h += '<div class="v2-row"><div class="grow"><b>' + esc(b.bill_no) + '</b><small class="muted">' + esc(fmtDate(b.date)) +
          ' · ' + esc(B.tx('v2_due')) + ' ' + esc(fmtDate(b.due_date)) + ' · ' + esc(lateText(b.days_late)) + '</small>' +
          '<small class="muted">' + esc(B.tx('v2_paid_so_far')) + ' ' + esc(B.inr(b.paid)) + ' / ' + esc(B.inr(b.total)) + '</small></div>' +
          '<div class="v2-amt"><b>' + esc(B.inr(b.due)) + '</b></div></div>';
      });
      h += '</div><button class="btn block" data-v2="rem" data-id="' + id + '">' + esc(B.tx('v2_reminder')) + '</button>';
    }
    h += '</section>';
    B.placeTop(v, h);
  });

  // Reminder draft: pick language and tone, edit, then open WhatsApp.
  function draft(L, tone, p) {
    var late = p.days_late > 0 ? tl(L, 'v2_late_suffix', { n: String(p.days_late) }) : '';
    return tl(L, tone === 'firm' ? 'v2_rem_firm' : 'v2_rem_polite', {
      name: p.name, shop: B.S.me.shop.name, amount: B.inr(p.balance), late: late
    });
  }
  function waHref(p, text) {
    var digits = String(p.phone || '').replace(/\D/g, '').slice(-10);
    return digits.length === 10 ? 'https://wa.me/91' + digits + '?text=' + encodeURIComponent(text) : '';
  }
  function openRem(p) {
    var o = B.modal('<h2>' + esc(B.tx('v2_reminder')) + '</h2>' +
      '<p class="bold">' + esc(p.name) + ' · ' + esc(B.inr(p.balance)) + '</p>' +
      '<div class="f"><label>' + esc(B.tx('v2_lang')) + '</label><select class="in" data-rv="lang">' +
      LANGS.map(function (l) { return '<option value="' + l[0] + '"' + (l[0] === B.S.lang ? ' selected' : '') + '>' + l[1] + '</option>'; }).join('') + '</select></div>' +
      '<div class="f"><label>' + esc(B.tx('v2_tone')) + '</label><select class="in" data-rv="tone">' +
      '<option value="polite">' + esc(B.tx('v2_polite')) + '</option><option value="firm">' + esc(B.tx('v2_firm_opt')) + '</option></select></div>' +
      '<div class="f"><label>' + esc(B.tx('v2_draft')) + '</label><textarea class="in" rows="6" data-rv="text"></textarea></div>' +
      '<p class="muted small">' + esc(B.tx('v2_draft_note')) + '</p>' +
      '<p class="v2-err" id="v2-rem-msg"></p>' +
      '<a class="btn big block" id="v2-rem-go" target="_blank" rel="noopener">' + esc(B.tx('v2_open_wa')) + '</a>');
    var ta = o.querySelector('[data-rv="text"]');
    var go = o.querySelector('#v2-rem-go');
    function sync() {
      var text = ta.value; var href = waHref(p, text);
      if (href) { go.href = href; go.removeAttribute('aria-disabled'); o.querySelector('#v2-rem-msg').textContent = ''; }
      else { go.removeAttribute('href'); go.setAttribute('aria-disabled', 'true'); o.querySelector('#v2-rem-msg').textContent = B.tx('v2_no_phone'); }
    }
    function redraft() {
      var L = o.querySelector('[data-rv="lang"]').value, tone = o.querySelector('[data-rv="tone"]').value;
      ta.value = draft(L, tone, p); sync();
    }
    o.addEventListener('change', function (e) { if (e.target.getAttribute && e.target.getAttribute('data-rv')) redraft(); });
    ta.addEventListener('input', sync);
    redraft();
  }

  document.addEventListener('click', async function (e) {
    var el = e.target.closest && e.target.closest('[data-v2="rem"]'); if (!el) return;
    var id = +el.getAttribute('data-id');
    var p = people[id];
    if (!p) { try { var d = await loadUdhar(); p = d.people.filter(function (x) { return x.customer_id === id; })[0]; } catch (err) { } }
    if (!p) return B.toast(B.tx('v2_no_udhar'));
    openRem(p);
  });
})();
