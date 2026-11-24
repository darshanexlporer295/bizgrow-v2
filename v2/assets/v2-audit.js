/* BizGrow v2: audit log page. Who changed what, and when. Owner and manager can undo a delete. */
(function () {
  'use strict';
  var B = window.BGV2; if (!B) return;
  var ACT = { create: 'v2_act_create', edit: 'v2_act_edit', delete: 'v2_act_delete', discount: 'v2_act_discount', 'back-date': 'v2_act_backdate', 'role change': 'v2_act_role', undo: 'v2_act_undo' };
  function esc(s) { return B.esc(s); }
  function when(at) {
    var d = new Date(at); if (isNaN(d)) return '';
    return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
  }

  function rowHtml(a) {
    var canUndo = B.can('audit.undo') && a.action === 'delete' && !a.undone;
    return '<div class="v2-row"><div class="grow"><b>' + esc(a.label) + '</b>' +
      '<small class="muted">' + esc(B.tx(ACT[a.action] || 'v2_act_edit')) + ' · ' + esc(a.by) + ' · ' + esc(when(a.at)) + '</small>' +
      (a.undone ? '<small class="muted">' + esc(B.tx('v2_undone')) + '</small>' : '') + '</div>' +
      (canUndo ? '<button class="btn sec sm" data-v2="undo" data-id="' + a.id + '">' + esc(B.tx('v2_undo')) + '</button>' : '') + '</div>';
  }

  async function load(v) {
    var list;
    try { list = await B.api('/v2/audit'); } catch (e) { B.toast(B.tx('v2_forbidden')); return; }
    var h = B.head(B.tx('v2_audit_title'), B.tx('v2_audit_sub'), '');
    h += '<section class="card"><div class="list">' +
      (list.length ? list.map(rowHtml).join('') : '<p class="muted">' + esc(B.tx('v2_nothing_yet')) + '</p>') +
      '</div></section>';
    v.innerHTML = h;
  }

  B.on('audit', async function (v) {
    if (!B.can('audit')) { v.innerHTML = B.head(B.tx('v2_audit_title'), '', '') + '<p class="muted">' + esc(B.tx('v2_forbidden')) + '</p>'; return; }
    await load(v);
  });

  document.addEventListener('click', async function (e) {
    var el = e.target.closest && e.target.closest('[data-v2="undo"]'); if (!el) return;
    el.disabled = true;
    try {
      await B.api('/v2/audit/' + el.getAttribute('data-id') + '/undo', 'POST');
      B.toast(B.tx('v2_undone'));
      var v = document.getElementById('view'); if (v && B.S.page === 'audit') await load(v);
    } catch (err) { B.toast(err.message || B.tx('v2_forbidden')); el.disabled = false; }
  });

  // Add the link to the More list (the sidebar link is added by the core file).
  B.on('more', function (v) {
    var list = v.querySelector('.list'); if (list) B.addMoreLinks(list);
  });
})();
