/* BizGrow v2: privacy extras. Export all data as a file, and delete all data after typing DELETE.
   The original download link and erase form are replaced so they use the demo routes. */
(function () {
  'use strict';
  var B = window.BGV2; if (!B) return;
  function esc(s) { return B.esc(s); }

  // Replace the plain download link with a button that saves a JSON file.
  B.on('privacy', function (v) {
    var a = v.querySelector('a[href="/api/privacy/download"]');
    if (!a) return;
    var card = a.closest('.card');
    a.outerHTML = '<button class="btn" data-v2="export">' + esc(B.tx('v2_exp_btn')) + '</button>';
    var p = card && card.querySelector('p'); if (p) p.textContent = B.tx('v2_exp_sub');
    var h = card && card.querySelector('h3'); if (h) h.textContent = B.tx('v2_exp_title');
  });

  // Delete card: use the v2 wording in the current language.
  B.ACT.erase = function () {
    return B.modal('<h2 style="color:var(--danger)">' + esc(B.tx('v2_del_title')) + '</h2>' +
      '<p class="muted small mb">' + esc(B.tx('v2_del_sub')) + '</p>' +
      '<form data-form="erase"><div class="f"><label>' + esc(B.tx('v2_del_type')) + '</label>' +
      '<input class="in" name="confirm" autocomplete="off"></div>' +
      '<button class="btn red big block" type="submit">' + esc(B.tx('v2_del_btn')) + '</button></form>');
  };

  B.FORM.erase = async function (f, d) {
    if (String(d.confirm || '').trim() !== 'DELETE') return B.formErr(f, B.tx('v2_del_type'));
    try {
      await B.api('/v2/erase', 'POST', { confirm: 'DELETE' });
    } catch (err) { return B.formErr(f, err.message || B.tx('v2_forbidden')); }
    f.closest('.ov').close();
    B.toast(B.tx('v2_del_done'));
    B.S.me = null; location.hash = ''; B.render();
  };

  document.addEventListener('click', async function (e) {
    var el = e.target.closest && e.target.closest('[data-v2="export"]'); if (!el) return;
    try {
      var data = await B.api('/v2/export');
      var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = 'bizgrow-my-data.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    } catch (err) { B.toast(err.message || B.tx('v2_forbidden')); }
  });
})();
