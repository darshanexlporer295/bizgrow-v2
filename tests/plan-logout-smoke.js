// Regression check: the Plan page never signs the owner out on a failed load.
// Runs in the demo (mock backend) at phone width. Usage: node plan-logout-smoke.js
const { open } = require('/workspace/agent/bizgrow-v2-build/cdp.js');
const BASE = (process.env.BIZGROW_BASE || 'file:///workspace/agent/gh-push-bizgrow-v2/v2/dist/bizgrow-v2.html') + '?demo=1';
const out = [];
const check = (name, ok, extra) => out.push((ok ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? ' (' + extra + ')' : ''));

// Replace window.fetch for one /api path with a canned answer. Everything else goes to the page's own fetch.
const fakeApi = (path, status, extraHeader) => `(function(){
  if(!window.__realFetch) window.__realFetch = window.fetch;
  window.__realFetch_hits = 0;
  window.fetch = function(input, init){
    var u = typeof input === 'string' ? input : ((input && input.url) || '');
    if (u.split('?')[0] === ${JSON.stringify(path)}) {
      window.__realFetch_hits++;
      var h = { 'content-type': 'application/json' };
      ${extraHeader ? `h[${JSON.stringify(extraHeader[0])}] = ${JSON.stringify(extraHeader[1])};` : ''}
      return Promise.resolve(new Response(JSON.stringify({ error: 'Please sign in with Google.' }), { status: ${status}, headers: h }));
    }
    return window.__realFetch.apply(window, arguments);
  };
  return 'faked';
})()`;
const restore = `(function(){ if(window.__realFetch){ window.fetch = window.__realFetch; } return 'restored'; })()`;

(async () => {
  const b = await open({ width: 360, height: 740, mobile: true });
  try {
    await b.nav(BASE + '#/home');
    await b.ev("BGV2.api('/login','POST',{email:'demo@bizgrow.test',password:'demo-pass-123'}).then(()=>BGV2.api('/me')).then(me=>{BGV2.S.me=me;BGV2.S.lang=me.lang||'en';})");
    await b.sleep(400);
    const signedIn = await b.ev("!!BGV2.S.me");
    check('demo owner signed in', signedIn === true);

    // 0. Before anything is cached: a failed admin check on the Plan page shows an inline message with a retry, not a sign-out.
    await b.ev("location.hash='#/home'"); await b.sleep(300);
    await b.ev(fakeApi('/api/admin/me', 401));
    await b.ev("location.hash='#/settings/plan'"); await b.sleep(900);
    const extraOk = await b.ev("!!BGV2.S.me && !document.querySelector('.auth')");
    check('admin check failure keeps the owner on the page', extraOk === true);
    const planRetry = await b.ev("!!document.querySelector('#view [data-act=plan-retry]')");
    check('admin check failure shows an inline retry', planRetry === true);
    await b.ev(restore);
    await b.ev("document.querySelector('#view [data-act=plan-retry]').click()"); await b.sleep(900);
    const retryGone = await b.ev("!document.querySelector('#view [data-act=plan-retry]')");
    check('retry clears the message when the check works', retryGone === true);

    // 1. Normal load of the Plan page shows the plan cards.
    await b.ev("location.hash='#/settings/plan'"); await b.sleep(900);
    const cardsOk = await b.ev("document.querySelectorAll('#view .plans .card').length");
    check('plan page loads normally', cardsOk > 0, cardsOk);

    // 2. The plan call fails with an ordinary 401 (no real sign-out signal). The owner stays on the page.
    await b.ev(fakeApi('/api/plan', 401));
    await b.ev("location.hash='#/home'"); await b.sleep(300);
    await b.ev("location.hash='#/settings/plan'"); await b.sleep(900);
    const hits = await b.ev("window.__realFetch_hits || 0");
    check('simulated plan failure was hit', hits > 0, hits);
    const stillIn = await b.ev("!!BGV2.S.me");
    check('plan failure keeps the owner signed in', stillIn === true);
    const notAuth = await b.ev("!document.querySelector('.auth')");
    check('plan failure does not show the sign-in page', notAuth === true);
    const errText = await b.ev("(document.querySelector('#view .err')||{}).textContent||''");
    check('plan failure shows a friendly message', /went wrong|Please try again/i.test(errText), errText.slice(0, 80));
    const retryBtn = await b.ev("!!document.querySelector('#view [data-act=reload]')");
    check('plan failure shows a Try again button', retryBtn === true);
    await b.ev(restore);

    // 3. Retry works once the plan answers again.
    await b.ev("document.querySelector('#view [data-act=reload]').click()"); await b.sleep(900);
    const back = await b.ev("document.querySelectorAll('#view .plans .card').length");
    check('Try again redraws the plan page', back > 0, back);

    // 5. A real expired session still signs the owner out (the one case that may log out).
    await b.ev("location.hash='#/home'"); await b.sleep(300);
    await b.ev(fakeApi('/api/plan', 401, ['x-bg-session', 'gone']));
    await b.ev("location.hash='#/settings/plan'"); await b.sleep(900);
    const outNow = await b.ev("!BGV2.S.me && !!document.querySelector('.auth')");
    check('expired session still signs out', outNow === true);
    await b.ev(restore);

    check('no page errors at end', b.logs.length === 0, b.logs.join(' || ').slice(0, 300));
  } catch (e) { out.push('ERR ' + e.message + ' ' + JSON.stringify(b.logs).slice(0, 300)); }
  console.log(out.join('\n'));
  const fails = out.filter(x => !x.startsWith('PASS')).length;
  await b.close(); process.exit(fails ? 1 : 0);
})();
