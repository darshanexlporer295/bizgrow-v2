/* BizGrow v2: owner's evening summary. What happened today, with a WhatsApp share button. Owner and manager only. */
(function () {
  'use strict';
  var B = window.BGV2; if (!B) return;
  function esc(s) { return B.esc(s); }

  function shareText(s) {
    var lines = [
      B.S.me.shop.name + ' - ' + B.tx('v2_sum_title') + ' (' + s.date.split('-').reverse().join('/') + ')',
      B.tx('v2_sum_bills') + ': ' + s.bills,
      B.tx('v2_sum_udhar') + ': ' + B.inr(s.udhar_added),
      B.tx('v2_sum_disc') + ': ' + B.inr(s.discounts_given),
      B.tx('v2_sum_rec') + ': ' + B.inr(s.payments_recovered),
      B.tx('v2_sum_edits') + ': ' + s.edits,
      B.tx('v2_sum_deletes') + ': ' + s.deletes
    ];
    if (s.delete_lines && s.delete_lines.length) lines.push(B.tx('v2_sum_recent') + ':', s.delete_lines.join('\n'));
    return lines.join('\n');
  }

  B.on('summary', async function (v) {
    if (!B.can('summary')) { v.innerHTML = B.head(B.tx('v2_sum_title'), '', '') + '<p class="muted">' + esc(B.tx('v2_forbidden')) + '</p>'; return; }
    var s;
    try { s = await B.api('/v2/summary?date=' + B.today()); } catch (e) { B.toast(B.tx('v2_forbidden')); return; }
    var money = B.can('view_money');
    function tile(label, val) {
      return '<div class="v2-tile"><span class="muted small">' + esc(label) + '</span><b>' + esc(val) + '</b></div>';
    }
    var h = B.head(B.tx('v2_sum_title'), B.tx('v2_sum_sub'), '');
    h += '<section class="card"><div class="v2-tiles">' +
      tile(B.tx('v2_sum_bills'), String(s.bills)) +
      (money ? tile(B.tx('v2_sum_udhar'), B.inr(s.udhar_added)) : '') +
      (money ? tile(B.tx('v2_sum_disc'), B.inr(s.discounts_given)) : '') +
      (money ? tile(B.tx('v2_sum_rec'), B.inr(s.payments_recovered)) : '') +
      tile(B.tx('v2_sum_edits'), String(s.edits)) +
      tile(B.tx('v2_sum_deletes'), String(s.deletes)) +
      '</div></section>';
    if (s.delete_lines && s.delete_lines.length) {
      h += '<section class="card mt"><h3>' + esc(B.tx('v2_sum_recent')) + '</h3><div class="list">' +
        s.delete_lines.map(function (l) { return '<div class="li"><span class="grow">' + esc(l) + '</span></div>'; }).join('') + '</div></section>';
    }
    h += '<section class="card mt"><a class="btn big block" target="_blank" rel="noopener" href="https://wa.me/?text=' +
      encodeURIComponent(shareText(s)) + '">' + esc(B.tx('v2_sum_share')) + '</a></section>';
    v.innerHTML = h;
  });

  // Add the link to the More list (owner and manager see it).
  B.on('more', function (v) {
    var list = v.querySelector('.list'); if (list && B.can('summary')) B.addMoreLinks(list);
  });
})();
