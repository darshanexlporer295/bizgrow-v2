/* BizGrow v2: staff page. Replaces the Team page content (owner only). Invite, change role, suspend or activate, remove, and a demo switch of user. */
(function () {
  'use strict';
  var B = window.BGV2; if (!B) return;
  var ROLES = ['manager', 'cashier', 'stock-keeper', 'accountant'];
  var RL = { owner: 'v2_role_owner', manager: 'v2_role_manager', cashier: 'v2_role_cashier', 'stock-keeper': 'v2_role_stock', accountant: 'v2_role_accountant' };
  var DL = { owner: 'v2_desc_owner', manager: 'v2_desc_manager', cashier: 'v2_desc_cashier', 'stock-keeper': 'v2_desc_stock', accountant: 'v2_desc_accountant' };
  function esc(s) { return B.esc(s); }
  function $(id) { return document.getElementById(id); }

  function rowHtml(u) {
    var isOwner = u.role === 'owner';
    var h = '<div class="v2-row"><div class="grow"><b>' + esc(u.name) + '</b>' + (u.you ? ' <span class="muted small">(' + esc(B.tx('v2_you')) + ')</span>' : '') +
      '<small class="muted">' + esc(B.tx(DL[u.role] || 'v2_desc_owner')) + '</small>' +
      '<small class="' + (u.status === 'suspended' ? 'v2-err' : 'muted') + '">' + esc(B.tx(u.status === 'suspended' ? 'v2_suspended' : 'v2_active')) + '</small></div>';
    h += '<div class="v2-staffctl">';
    if (isOwner) h += '<span class="bold small">' + esc(B.tx(RL.owner)) + '</span>';
    else {
      h += '<select class="in" data-sv="role" data-id="' + u.id + '" aria-label="' + esc(B.tx('v2_role')) + '">' +
        ROLES.map(function (r) { return '<option value="' + r + '"' + (r === u.role ? ' selected' : '') + '>' + esc(B.tx(RL[r])) + '</option>'; }).join('') + '</select>';
      h += '<div class="row"><button class="btn sec sm" data-v2="status" data-id="' + u.id + '" data-s="' + (u.status === 'suspended' ? 'active' : 'suspended') + '">' +
        esc(B.tx(u.status === 'suspended' ? 'v2_activate' : 'v2_suspend')) + '</button>' +
        '<button class="btn sec sm" data-v2="remove" data-id="' + u.id + '">' + esc(B.tx('v2_remove')) + '</button></div>';
    }
    return h + '</div></div>';
  }

  B.on('team', async function (v) {
    var list;
    try { list = await B.api('/v2/staff'); } catch (e) { return; }
    var h = B.head(B.tx('v2_staff_title'), B.tx('v2_staff_sub'), '<button class="btn" data-v2="add">' + esc(B.tx('v2_add_staff')) + '</button>');
    h += '<section class="card"><div class="list">' + list.map(rowHtml).join('') + '</div></section>';
    h += '<section class="card mt"><h3>' + esc(B.tx('v2_switch_title')) + '</h3><p class="muted small">' + esc(B.tx('v2_demo_note')) + '</p><div class="v2-party">' +
      list.filter(function (u) { return u.status !== 'suspended'; }).map(function (u) {
        return '<button class="btn sec sm" data-v2="switch" data-id="' + u.id + '">' + esc(u.name) + ' · ' + esc(B.tx(RL[u.role] || 'v2_role_owner')) + '</button>';
      }).join('') + '</div></section>';
    v.innerHTML = h;
  });

  function refreshPage() { B.render(); }

  // Change a role from the select box.
  document.addEventListener('change', async function (e) {
    var el = e.target; if (!el.getAttribute || el.getAttribute('data-sv') !== 'role') return;
    try { await B.api('/v2/staff/' + el.getAttribute('data-id'), 'PUT', { role: el.value }); B.toast(B.tx('v2_saved')); refreshPage(); }
    catch (err) { B.toast(err.message || B.tx('v2_forbidden')); refreshPage(); }
  });

  function addModal() {
    var o = B.modal('<h2>' + esc(B.tx('v2_add_staff').replace(/^\+\s*/, '')) + '</h2>' +
      '<div class="f"><label>' + esc(B.tx('v2_name')) + '</label><input class="in" id="v2-st-name" maxlength="60"></div>' +
      '<div class="f"><label>' + esc(B.tx('v2_email')) + '</label><input class="in" id="v2-st-email" type="email"></div>' +
      '<div class="f"><label>' + esc(B.tx('v2_role')) + '</label><select class="in" id="v2-st-role">' +
      ROLES.map(function (r) { return '<option value="' + r + '">' + esc(B.tx(RL[r])) + ' - ' + esc(B.tx(DL[r])) + '</option>'; }).join('') + '</select></div>' +
      '<p class="v2-err" id="v2-st-msg"></p><button class="btn big block" data-v2="add-save">' + esc(B.tx('v2_invite')) + '</button>');
    return o;
  }
  function confirmRemove(id, name) {
    var o = B.modal('<h2>' + esc(B.tx('v2_remove')) + '</h2><p class="mb">' + esc(name) + '</p><p class="muted small mb">' + esc(B.tx('v2_remove_q')) + '</p>' +
      '<button class="btn big block" data-v2="remove-yes" data-id="' + id + '" style="background:var(--danger)">' + esc(B.tx('v2_remove')) + '</button>' +
      '<button class="btn sec block" data-v2="cancel-ov">' + esc(B.tx('v2_cancel')) + '</button>');
    return o;
  }

  document.addEventListener('click', async function (e) {
    var el = e.target.closest && e.target.closest('[data-v2]'); if (!el) return;
    var k = el.getAttribute('data-v2'), id = el.getAttribute('data-id');
    try {
      if (k === 'add') return addModal();
      if (k === 'add-save') {
        var nm = B.vtext(($('v2-st-name') || {}).value, 60, 'v2_name_req');
        if (!nm.ok) return ($('v2-st-msg').textContent = nm.msg);
        var em = String(($('v2-st-email') || {}).value || '').trim();
        if (!/^\S+@\S+\.\S+$/.test(em)) return ($('v2-st-msg').textContent = B.tx('v2_email_bad'));
        await B.api('/v2/staff', 'POST', { name: nm.v, email: em, role: $('v2-st-role').value });
        el.closest('.ov').close(); B.toast(B.tx('v2_invited')); return refreshPage();
      }
      if (k === 'status') { await B.api('/v2/staff/' + id, 'PUT', { status: el.getAttribute('data-s') }); return refreshPage(); }
      if (k === 'remove') return confirmRemove(id, el.closest('.v2-row').querySelector('b').textContent);
      if (k === 'remove-yes') { await B.api('/v2/staff/' + id, 'DELETE'); el.closest('.ov').close(); B.toast(B.tx('v2_saved')); return refreshPage(); }
      if (k === 'cancel-ov') return el.closest('.ov').close();
      if (k === 'switch') {
        await B.api('/v2/switch', 'POST', { id: +id });
        B.S.me = await B.api('/me');
        location.hash = '#/home'; return B.render();
      }
    } catch (err) { B.toast(err.message || B.tx('v2_forbidden')); }
  });
})();
