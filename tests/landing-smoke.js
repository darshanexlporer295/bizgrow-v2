// Sign-in landing check in the demo at phone width: blue screen, logo, name, three big white buttons,
// links, last-used tag, email opens the form, back works, Apple/Google show the friendly message in demo.
// Usage: node tests/landing-smoke.js  (needs the cdp.js browser helper; set BIZGROW_BASE to a different build if needed)
const { open } = require('/workspace/agent/bizgrow-v2-build/cdp.js');
const BASE = (process.env.BIZGROW_BASE || 'file:///workspace/agent/gh-push-bizgrow-v2/v2/dist/bizgrow-v2.html') + '?demo=1';
const SHOTS = process.env.SHOTS_DIR || '/tmp/bizgrow-shots/';
const out = [];
const check = (name, ok, extra) => out.push((ok ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? ' (' + extra + ')' : ''));

(async () => {
  const b = await open({ width: 360, height: 740, mobile: true });
  try {
    await b.nav(BASE + '#/');
    await b.ev("sessionStorage.clear();localStorage.removeItem('bg_last_login');");
    await b.nav(BASE + '#/');
    await b.sleep(500);
    const w = await b.ev("(()=>{const e=document.querySelector('.welcome');if(!e)return null;const bt=[...e.querySelectorAll('.w-btn')];return {bg:getComputedStyle(e).backgroundColor,btns:bt.map(x=>x.innerText.trim().replace(/\\s+/g,' ')),btnBg:bt.map(x=>getComputedStyle(x).backgroundColor),btnRadius:bt.map(x=>getComputedStyle(x).borderRadius),btnH:bt.map(x=>Math.round(x.getBoundingClientRect().height)),logo:(document.querySelector('.w-logo')||{}).naturalWidth||0,logoSrc:((document.querySelector('.w-logo')||{}).src||'').slice(0,30),name:(document.querySelector('.w-name')||{}).textContent,links:[...e.querySelectorAll('.w-legal a')].map(a=>a.textContent.trim()),logoCentre:(()=>{const r=document.querySelector('.w-logo').getBoundingClientRect();return Math.round(r.left+r.width/2)})(),vw:innerWidth};})()");
    check('landing shown on first visit', !!w);
    if (w) {
      check('blue background (not dark)', w.bg === 'rgb(26, 95, 208)', w.bg);
      check('two buttons in order, no Apple', w.btns.length === 2 && /Continue with Google/.test(w.btns[0]) && /Continue with email/.test(w.btns[1]) && !/Apple/.test(w.btns.join(' ')), w.btns.join(' | '));
      const ic = await b.ev("(()=>{const bt=[...document.querySelectorAll('.welcome .w-btn')];return bt.map(x=>{const s=x.querySelector('.w-ico svg');const t=x.querySelector('.w-txt');if(!s||!t)return null;const a=s.getBoundingClientRect(),c=t.getBoundingClientRect();return {w:Math.round(a.width),h:Math.round(a.height),left:a.left<c.left,paths:s.querySelectorAll('path').length,fills:[...s.querySelectorAll('path')].map(p=>p.getAttribute('fill')).join(',')};});})()");
      check('each button has an icon left of its text, same size', ic && ic.length === 2 && ic.every(i => i && i.left && i.w === 22 && i.h === 22), JSON.stringify(ic));
      check('Google icon is the four-colour G', ic && ic[0] && ic[0].paths === 4 && /#EA4335/.test(ic[0].fills) && /#4285F4/.test(ic[0].fills) && /#FBBC05/.test(ic[0].fills) && /#34A853/.test(ic[0].fills), ic && ic[0] ? ic[0].fills : 'none');
      check('email icon is an envelope', ic && ic[1] && ic[1].paths === 1, ic && ic[1] ? ic[1].paths + ' path' : 'none');
      check('buttons white and rounded', w.btnBg.every(c => c === 'rgb(255, 255, 255)') && w.btnRadius.every(r => parseInt(r) >= 30), w.btnBg.join(',') + ' ' + w.btnRadius.join(','));
      check('buttons big enough to tap (>= 56 px)', w.btnH.every(h => h >= 56), w.btnH.join(','));
      check('logo is the real image and loaded', w.logo > 0 && /^data:image\/png|\/assets\//.test(w.logoSrc), w.logo + ' ' + w.logoSrc);
      check('logo centred', Math.abs(w.logoCentre - w.vw / 2) <= 3, w.logoCentre + ' of ' + w.vw);
      check('name written BizGrow', w.name === 'BizGrow', w.name);
      check('privacy and terms links', w.links.length === 2, w.links.join(' | '));
    }
    await b.shot(SHOTS + 'landing-360.png');

    // Apple/Google in demo: friendly message, no crash
    await b.ev("document.querySelector('[data-act=pick-google]').click()"); await b.sleep(400);
    const toastG = await b.ev("(([...document.querySelectorAll('.toast')].pop()||{}).textContent||'')");
    check('Google in demo shows friendly not-available message', /not available yet/i.test(toastG) && /Google/.test(toastG), toastG);
    const stillLanding = await b.ev("!!document.querySelector('.welcome')");
    check('still on landing after Google tap in demo', stillLanding === true);

    // Terms link opens notice
    await b.ev("document.querySelector('.w-legal a[data-act=terms-notice]').click()"); await b.sleep(400);
    const termsOpen = await b.ev("!!document.querySelector('.ov') && /Terms|शर्त|अटी|શરત/.test(document.querySelector('.ov').innerText)");
    check('Terms link opens the notice', termsOpen === true);
    await b.ev("(document.querySelector('.ov')||{close(){}}).close&&document.querySelector('.ov').close()"); await b.sleep(200);
    await b.ev("const o=document.querySelector('.ov');if(o)o.remove();"); await b.sleep(150);

    // Email opens the email form
    await b.ev("document.querySelector('[data-act=pick-email]').click()"); await b.sleep(600);
    const form = await b.ev("(()=>{const f=document.querySelector('form[data-form=login]');return {form:!!f,email:!!(f&&f.querySelector('input[name=email]')),pass:!!(f&&f.querySelector('input[name=password]')),google:!!document.querySelector('.gbtn'),landing:!!document.querySelector('.welcome'),back:!!document.querySelector('[data-act=auth-back]'),last:localStorage.getItem('bg_last_login')};})()");
    check('email opens the sign-in form', form.form && form.email && form.pass, JSON.stringify(form));
    check('email view has no landing and no Google row', !form.landing && !form.google);
    check('remembers email as last used', form.last === 'email', form.last);

    // Back returns to landing and shows the Last used tag on Email
    await b.ev("document.querySelector('[data-act=auth-back]').click()"); await b.sleep(600);
    const tag = await b.ev("(()=>{const e=[...document.querySelectorAll('.w-btn')].find(x=>x.dataset.act==='pick-email');return {landing:!!document.querySelector('.welcome'),tag:!!(e&&e.querySelector('.w-last')),txt:e?e.innerText.trim():''};})()");
    check('back returns to landing', tag.landing === true);
    check('Last used tag on email button', tag.tag === true, tag.txt);
    await b.shot(SHOTS + 'landing-360-last.png');

    // Email sign-up still reachable from the email form's switch
    await b.ev("document.querySelector('[data-act=pick-email]').click()"); await b.sleep(500);
    await b.ev("document.querySelector('[data-act=mode][data-m=signup]').click()"); await b.sleep(500);
    const signup = await b.ev("!!document.querySelector('form[data-form=signup]')");
    check('email sign-up form reachable', signup === true);
  } catch (e) {
    out.push('FAIL exception ' + e.message);
  } finally {
    console.log(out.join('\n'));
    console.log('TOTAL FAIL=' + out.filter(x => x.startsWith('FAIL')).length + ' PASS=' + out.filter(x => x.startsWith('PASS')).length);
    await b.close();
  }
})();
