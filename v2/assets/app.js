
(()=>{'use strict';
const $=(s,r=document)=>r.querySelector(s);
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const inr=n=>'₹'+(Math.round((+n||0)*100)/100).toLocaleString('en-IN',{maximumFractionDigits:2});
const qn=n=>(Math.round((+n||0)*1000)/1000).toString();
const S={me:null,lang:localStorage.getItem('bg_lang')||'en',products:[],customers:[],cart:[],cartCust:null,discount:0,cat:'',q:'',stockQ:'',stockCat:'',stockLow:false,repDays:7,page:''};
const t=k=>{const L=I18N[S.lang]||{};if(S.me&&S.me.shop&&S.me.shop.category==='creator'&&L['c_'+k])return L['c_'+k];return L[k]||I18N.en[k]||k;};
const isCreator=()=>!!(S.me&&S.me.shop&&S.me.shop.category==='creator');
const IST=330*60000;
const today=()=>new Date(Date.now()+IST).toISOString().slice(0,10);
const dshort=iso=>{const d=new Date(new Date(iso).getTime()+IST);return d.toISOString().slice(8,10)+'/'+d.toISOString().slice(5,7)};
const dtime=iso=>{const d=new Date(new Date(iso).getTime()+IST);const h=d.getUTCHours();return dshort(iso)+' '+((h%12)||12)+':'+String(d.getUTCMinutes()).padStart(2,'0')+(h<12?' am':' pm')};
async function api(path,method='GET',body){
  const o={method,credentials:'same-origin',headers:{}};
  if(method!=='GET'){o.headers['content-type']='application/json';o.body=JSON.stringify(body||{});}
  let r;try{r=await fetch('/api'+path,o);}catch(e){throw new Error('No internet connection. Please check and try again.');}
  // Only a real expired sign-in logs the owner out. The data layer marks that case with x-bg-session: gone.
  // Any other 401 (a plan, billing or admin call that failed) is an ordinary error: the page shows a message and a retry.
  if(r.status===401&&S.me&&r.headers.get('x-bg-session')==='gone'){S.me=null;render();throw new Error('Please sign in again.');}
  const ct=r.headers.get('content-type')||'';
  const d=ct.includes('json')?await r.json():await r.text();
  if(!r.ok){
    if(r.status===401&&S.me)throw new Error(t('bl_fail'));
    throw new Error((d&&d.error)||'Something went wrong. Please try again.');
  }
  return d;
}
function toast(m){const e=document.createElement('div');e.className='toast';e.textContent=m;document.body.appendChild(e);setTimeout(()=>e.remove(),2600);}
const IC={
home:'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
sell:'M6 6h15l-2 9H8L6 3H3M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm9 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
khata:'M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0zM4 21c0-4 4-6 8-6s8 2 8 6',
stock:'M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8',
expenses:'M3 7h18v12H3zM3 11h18M7 15h3',
reports:'M4 20V10M10 20V4M16 20v-7M22 20H2',
suppliers:'M1 6h13v10H1zM14 10h5l3 3v3h-8zM6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm12 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
tasks:'M9 11l3 3 8-8M4 12v7h14',
bills:'M6 2h12v20l-3-2-3 2-3-2-3 2zM9 7h6M9 11h6M9 15h4',
store:'M3 9l1-5h16l1 5M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M5 12v8h14v-8',
settings:'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2-1.2L14 3h-4l-.6 2.7a7 7 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5A7 7 0 0 0 5 12a7 7 0 0 0 .1 1.2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2 1.2L10 21h4l.6-2.7a7 7 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z',
more:'M5 12h.01M12 12h.01M19 12h.01',
team:'M17 20v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M10 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM21 20v-2a4 4 0 0 0-3-3.9M16 2.1a4 4 0 0 1 0 7.8',
privacy:'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
plans:'M12 2.5l2.9 6.1 6.6.9-4.8 4.6 1.2 6.6L12 17.6 6.1 20.7l1.2-6.6-4.8-4.6 6.6-.9z',
};
const ic=n=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${IC[n]}"/></svg>`;
const LOGO=`<svg width="34" height="34" viewBox="0 0 64 64"><rect width="64" height="64" rx="15" fill="#fff"/><path d="M32 50V31" stroke="#0A192F" stroke-width="5" stroke-linecap="round"/><path d="M32 33C32 23 24 18 15 19c0 10 7 16 17 14Z" fill="#0A192F"/><path d="M32 29c0-8 6-13 15-12 0 9-6 14-15 12Z" fill="#F59E0B"/></svg>`;
const LOGOD=LOGO.replace('fill="#fff"','fill="#0A192F"').replace('stroke="#0A192F"','stroke="#fff"').replace('M32 33C32 23 24 18 15 19c0 10 7 16 17 14Z" fill="#0A192F"','M32 33C32 23 24 18 15 19c0 10 7 16 17 14Z" fill="#fff"');
const CATS=[['kirana','Kirana / grocery'],['cafe','Café / tea stall'],['salon','Salon / parlour'],['bakery','Bakery / sweets'],['pharmacy','Pharmacy'],['hardware','Hardware / other retail'],['creator','Creator / social media manager']];
const EXPCATS=['Milk & Dairy','Stock purchase','Shop rent','Staff wages','Electricity','Transport','Repairs','Packaging','Other'];
const EXPCATS_CREATOR=[['Tools & software','c_exp_tools'],['Gear & equipment','c_exp_gear'],['Ads & promotion','c_exp_ads'],['Internet & phone','c_exp_internet'],['Travel','c_exp_travel'],['Freelancers & editors','c_exp_freelance'],['Other','c_exp_other']];
const isOwner=()=>S.me&&S.me.role==='owner';
const NAV=()=>[['home','home'],['sell','sell'],['bills','bills'],['khata','khata'],['stock','stock'],['expenses','expenses'],['reports','reports'],['suppliers','suppliers'],['tasks','tasks'],['store','store'],...(isOwner()?[['plans','plans'],['team','team'],['privacy','privacy'],['settings','settings']]:[])];
const TABS=[['home','home'],['sell','sell'],['khata','khata'],['stock','stock'],['more','more']];

/* ---------- modal ---------- */
function modal(html,{onclose}={}){
  const o=document.createElement('div');o.className='ov';o.innerHTML=`<div class="sheet">${html}</div>`;
  o.addEventListener('mousedown',e=>{if(e.target===o)close()});
  function close(){o.remove();onclose&&onclose();}
  o.close=close;document.body.appendChild(o);
  const f=$('input:not([type=checkbox]):not([type=hidden])',o);if(f&&innerWidth>900)f.focus();
  return o;
}
function formData(el){const o={};el.querySelectorAll('[name]').forEach(i=>{o[i.name]=i.type==='checkbox'?i.checked:i.value});return o;}
function waLink(phone,text){let p=String(phone||'').replace(/\D/g,'');if(p.length===10)p='91'+p;return 'https://wa.me/'+(p?p:'')+'?text='+encodeURIComponent(text);}
const upiLink=(amt)=>S.me.shop.upi_id?`upi://pay?pa=${encodeURIComponent(S.me.shop.upi_id)}&pn=${encodeURIComponent(S.me.shop.name)}&am=${amt}&cu=INR`:'';

/* ---------- boot ---------- */
async function boot(){
  try{S.me=await api('/me');S.lang=S.me.shop.lang||S.lang;}catch(e){S.me=null;}
  render();
}
addEventListener('hashchange',()=>render());
function go(h){if(location.hash===h)render();else location.hash=h;}
async function render(){
  if(!S.me){return renderAuth();}
  // Owners answer the sign-up questions once, before Home (see v2-signup.js).
  if(window.BGV2&&BGV2.gate&&BGV2.gate())return;
  const page=(location.hash.replace(/^#\//,'')||'home').split('/');S.page=page[0];
  document.documentElement.lang=S.lang;
  const nav=NAV();
  $('#app').innerHTML=`<div class="shell"><aside class="side"><div class="brand">${LOGO}<div>BizGrow<small>${esc(S.me.shop.name)}</small></div></div>
  <nav class="nav">${nav.map(([k,i])=>`<a href="#/${k}" class="${S.page===k?'on':''}${k==='plans'?' plans-link':''}">${ic(i)}<span>${t(k)}</span></a>`).join('')}</nav>
  ${isCreator()?clipsSide():`<a class="sidecta" target="_blank" rel="noopener" href="${revoLink('growing my business')}"><b>Consult RÊVO</b><span>Website · WhatsApp · Reels</span></a>`}<div class="who"><b>${esc(S.me.user.name)}</b><span class="muted">${S.me.role==='owner'?'Owner':S.me.role==='manager'?'Manager':'Staff'}</span><br><button data-act="logout">${t('signout')}</button></div></aside>
  <main class="main" id="view"><div class="empty">…</div></main>
  <nav class="tabbar">${TABS.map(([k,i])=>`<a href="#/${k}" class="${(S.page===k||(k==='more'&&['suppliers','tasks','store','orders','team','privacy','settings','reports','expenses','plans'].includes(S.page)))?'on':''}">${ic(i)}<span>${t(k)}</span></a>`).join('')}</nav></div>`;
  const v=$('#view');
  try{
    const P={home:pHome,sell:pSell,bills:pBills,khata:pKhata,stock:pStock,expenses:pExpenses,reports:pReports,suppliers:pSuppliers,tasks:pTasks,store:pStore,orders:pOrders,more:pMore,team:pTeam,privacy:pPrivacy,settings:pSettings,plans:pPlan}[S.page]||pHome;
    await P(v,page.slice(1));
    if(window.BGV2&&BGV2.after)BGV2.after(S.page,v,page.slice(1));
    if(S.page==='home'){if(isOwner()&&!S.me.onboarded&&!sessionStorage.getItem('bg_skipob'))setTimeout(onboarding,300);else if(S.me.onboarded||!isOwner()){clearTimeout(S.popT);S.popT=setTimeout(revoPopup,3500);}}
  }catch(e){v.innerHTML=`<div class="err">${esc(e.message)}</div><button class="btn" data-act="reload">Try again</button>`;}
  window.scrollTo(0,0);
}
document.addEventListener('click',async e=>{
  const el=e.target.closest('[data-act]');if(!el)return;
  const f=ACT[el.dataset.act];if(!f)return;
  e.preventDefault();
  try{await f(el,e);}catch(err){toast(err.message);}
});
document.addEventListener('submit',async e=>{
  const f=e.target.closest('[data-form]');if(!f)return;e.preventDefault();
  const btn=$('button[type=submit]',f);const er=$('.err',f);if(er)er.remove();
  if(btn)btn.disabled=true;
  try{await FORM[f.dataset.form](f,formData(f));}
  catch(err){const d=document.createElement('div');d.className='err';d.textContent=err.message;f.prepend(d);}
  finally{if(btn)btn.disabled=false;}
});
const ACT={}, FORM={};

/* ---------- auth ---------- */
async function renderAuth(){
  const m=location.hash.match(/^#\/join\/([a-f0-9]+)/);
  let invite=null;
  if(m){try{invite=await api('/invite/'+m[1]);invite.token=m[1];}catch(e){invite={error:e.message};}}
  const cfg=await api('/config').catch(()=>({reset_email:false}));
  const resetTok=(location.hash.match(/^#\/reset\/([a-f0-9]+)/)||[])[1];
  let mode=invite&&!invite.error?'signup':(sessionStorage.getItem('bg_mode')||'signup');
  if(mode==='forgot'&&!cfg.reset_email)mode='login';
  if(resetTok)mode='reset';
  const inv=!!(invite&&!invite.error);
  const ul=['Billing, stock and udhar in one simple app','Free for ever. No ads. No loan spam.','Works on your phone, tablet or computer','Your data stays yours — you can download or delete it any time'];
  // Title and subtitle, in the shop's language. Invite and reset/forgot keep their own wording.
  const title=resetTok?'Choose a new password':mode==='forgot'?'Forgot your password?':inv?'Join '+esc(invite.shop):mode==='login'?t('sign_in'):t('create_account');
  const sub=resetTok?'Pick a new password for your account. This link works once.':mode==='forgot'?'We will email you a link to set a new password.':inv?'Create your login to start working with the team.':t(mode==='login'?'sub_signin':'sub_signup');
  const plain=!!(inv||resetTok||mode==='forgot');
  // First visit: the landing with the big buttons (Apple, Google, email). Email opens the form below.
  if(!invite&&!resetTok&&!sessionStorage.getItem('bg_mode')){$('#app').innerHTML=landingHTML();const ll=document.getElementById('authLang');if(ll)ll.onchange=()=>{S.lang=ll.value;localStorage.setItem('bg_lang',S.lang);document.documentElement.lang=S.lang;renderAuth();};return;}
  const switchLink=plain?'':(mode==='login'
    ?`<div class="auth-switch">${t('no_account_q')} <button type="button" class="link" data-act="mode" data-m="signup">${t('switch_signup')}</button></div>`
    :`<div class="auth-switch">${t('have_account')} <button type="button" class="link" data-act="mode" data-m="login">${t('switch_signin')}</button></div>`);
  const terms=(mode==='login'||mode==='signup')?`<p class="auth-terms">${t('terms_line').replace('{t}',`<a href="#" class="auth-terms-name" data-act="terms-notice">${t('terms_link')}</a>`).replace('{p}',`<a href="#" data-act="privacy-notice">${t('privacy_link')}</a>`)}</p>`:'';
  const langs=Object.entries(LANGS).map(([k,n])=>`<option value="${k}" ${S.lang===k?'selected':''}>${n}</option>`).join('');
  $('#app').innerHTML=`<div class="auth"><div class="l"><div><div class="row" style="gap:10px;font-weight:800;font-size:22px;font-family:'Plus Jakarta Sans'">${LOGO}BizGrow</div>
  <h1>Run your shop.<br>Effortlessly.</h1><p>Simple counter billing, smart stock alerts and daily accounts for kirana stores, cafés, salons and workshops.</p><ul>${ul.map(x=>`<li>${x}</li>`).join('')}</ul></div>
  <div class="foot">Empower Businesses. Strengthen India. · Powered by RÊVO</div></div>
  <div class="r"><div class="box">
   <div class="auth-top"><div class="auth-m-brand">${LOGO}BizGrow</div><select class="in auth-lang" id="authLang" aria-label="Language">${langs}</select></div>
   ${invite&&invite.error?`<div class="err">${esc(invite.error)}</div>`:''}
   <h2 class="auth-title">${title}</h2><p class="auth-sub">${sub}</p>
   ${mode==='reset'?`<form data-form="reset"><input type="hidden" name="token" value="${resetTok}"><div class="f"><label>New password</label><input class="in" name="password" type="password" autocomplete="new-password" minlength="8" required></div><button class="btn block" type="submit">Save new password</button></form>`
   :mode==='forgot'?`<form data-form="forgot"><div class="f"><label>${t('email')}</label><input class="in" name="email" type="email" autocomplete="email" required></div><button class="btn block" type="submit">Send reset link</button></form><div class="mt small"><button type="button" class="link" data-act="mode" data-m="login">Back to sign in</button></div>`
   :mode==='login'?`<form data-form="login"><div class="f"><label>${t('email')}</label><input class="in" name="email" type="email" autocomplete="email" required></div>
     <div class="f"><label>${t('password')}</label><input class="in" name="password" type="password" autocomplete="current-password" required></div>
     ${cfg.reset_email?`<div class="mb small" style="text-align:right;margin-top:-4px"><button type="button" class="link" data-act="mode" data-m="forgot">Forgot password?</button></div>`:''}
     <button class="btn block auth-submit" type="submit">${t('signin')}</button></form>`
   :`<form data-form="signup"><input type="hidden" name="invite" value="${invite&&!invite.error?invite.token:''}">
     <div class="f"><label>${t('your_name')}</label><input class="in" name="name" autocomplete="name" required></div>
     <div class="f"><label>${t('email')}</label><input class="in" name="email" type="email" autocomplete="email" required></div>
     <div class="f"><label>${t('password')}</label><input class="in" name="password" type="password" autocomplete="new-password" minlength="8" required><div class="hint">${t('pw_hint')}</div></div>
     <label class="chk f"><input type="checkbox" name="consent"><span>${t('consent_text').replace('{p}',`<a href="#" data-act="privacy-notice">${t('privacy_link')}</a>`)}</span></label>
     <button class="btn block auth-submit" type="submit">${t('signup')}</button></form>`}
   ${switchLink}
   ${plain?'':`<div class="mt small"><button type="button" class="link" data-act="auth-back">${t('auth_back')}</button></div>`}
   ${terms}
  </div></div></div>`;
  if(window.BGV2&&BGV2.authDone)BGV2.authDone(mode);
  const al=$('#authLang');
  if(al)al.onchange=()=>{S.lang=al.value;localStorage.setItem('bg_lang',S.lang);document.documentElement.lang=S.lang;renderAuth();};
}
ACT.mode=el=>{sessionStorage.setItem('bg_mode',el.dataset.m);renderAuth();};
// The landing screen: a big logo, the BizGrow name and three buttons. Apple and Google try the live sign-in; email opens the form.
const LAST_LOGIN=()=>localStorage.getItem('bg_last_login')||'';
function landingHTML(){
  const last=LAST_LOGIN();
  const logoSrc=(document.querySelector('link[rel="apple-touch-icon"]')||{}).href||'/assets/icon-192.png';
  const btn=(k,label,act)=>`<button type="button" class="w-btn" data-act="${act}">${esc(label)}${last===k?`<span class="w-last">${t('auth_last')}</span>`:''}</button>`;
  const langs=Object.entries(LANGS).map(([k,n])=>`<option value="${k}" ${S.lang===k?'selected':''}>${n}</option>`).join('');
  return `<div class="welcome"><div class="w-top"><select class="w-lang" id="authLang" aria-label="Language">${langs}</select></div><div class="w-mid"><img class="w-logo" src="${logoSrc}" width="112" height="112" alt="BizGrow logo"><h1 class="w-name">BizGrow</h1><p class="w-sub">${t('auth_sub')}</p></div>
  <div class="w-btns">${btn('apple',t('auth_apple'),'pick-apple')}${btn('google',t('auth_google'),'pick-google')}${btn('email',t('auth_email'),'pick-email')}</div>
  <p class="w-legal"><a href="#" data-act="privacy-notice">${t('auth_privacy')}</a> · <a href="#" data-act="terms-notice">${t('auth_terms')}</a></p></div>`;
}
ACT['pick-email']=()=>{localStorage.setItem('bg_last_login','email');sessionStorage.setItem('bg_mode','login');renderAuth();};
ACT['pick-google']=()=>pickOAuth('google');
ACT['pick-apple']=()=>pickOAuth('apple');
async function pickOAuth(p){
  const before=LAST_LOGIN();
  localStorage.setItem('bg_last_login',p);
  let ok=false;
  try{ok=!!(window.BGV2&&BGV2.oauth&&await BGV2.oauth(p));}catch(e){ok=false;}
  if(!ok){if(before)localStorage.setItem('bg_last_login',before);else localStorage.removeItem('bg_last_login');toast(t('auth_soon').replace('{p}',p==='apple'?'Apple':'Google'));}
}
ACT['auth-back']=()=>{sessionStorage.removeItem('bg_mode');renderAuth();};
ACT['terms-notice']=()=>modal(`<h2>${t('auth_terms')}</h2><p class="small">${t('auth_terms_body')}</p><button class="btn block mt" onclick="this.closest('.ov').close()">OK</button>`);
ACT['privacy-notice']=()=>modal(`<h2>Privacy Notice (v1.0)</h2>
<p class="small">BizGrow is built to follow India's Digital Personal Data Protection Act, 2023.</p>
<ul class="small" style="padding-left:18px;margin:10px 0;line-height:1.7"><li><b>What we keep:</b> your name, email, shop details, and the items, bills, customers, expenses and notes you enter.</li><li><b>Why:</b> only to run billing, udhar, stock and reports for your shop.</li><li><b>What we never do:</b> no ads, no selling your or your customers' phone numbers, no loan offers.</li><li><b>Your rights:</b> download everything, correct it, or delete your account — in Privacy.</li><li><b>Complaints:</b> raise a grievance inside the app (Privacy → Grievance).</li></ul>
<p class="small muted">Your customers' details are held for you as your records. Please use them only for your shop's business.</p><button class="btn block mt" onclick="this.closest('.ov').close()">OK</button>`);
FORM.login=async(f,d)=>{await api('/login','POST',d);await boot();go('#/home');};
FORM.forgot=async(f,d)=>{await api('/password/forgot','POST',d);modal('<h2>Check your email</h2><p class="muted">If that email has an account, a reset link is on its way. The link expires in 30 minutes and works once.</p><button class="btn block mt" onclick="this.closest(\'.ov\').close()">OK</button>');};
FORM.reset=async(f,d)=>{await api('/password/reset','POST',d);sessionStorage.setItem('bg_mode','login');history.replaceState(null,'',location.pathname);toast('Password changed. Sign in with your new password.');renderAuth();};
FORM.signup=async(f,d)=>{if(!d.consent)throw new Error('Please accept the Privacy Notice to continue.');await api('/signup','POST',d);await boot();go('#/home');};
ACT.logout=async()=>{await api('/logout','POST');S.me=null;sessionStorage.removeItem('bg_mode');S.cart=[];location.hash='';render();};
ACT.reload=()=>render();


/* ---------- RÊVO prompts ---------- */
const REVO_WA='917588825725';
const revoLink=topic=>`https://wa.me/${REVO_WA}?text=${encodeURIComponent(`Hi RÊVO, I use BizGrow for ${S.me.shop.name}. I'd like to talk about: ${topic}`)}`;
const REVO={
  store:{tag:'RÊVO Systems',title:'Want your own shop website?',body:'A branded website with your name, photos, online orders and payments. Built for you by RÊVO.',cta:'Get a RÊVO Systems website',topic:'a branded website / online store'},
  khata:{tag:'RÊVO Systems',title:'Reminders that send themselves',body:'Automatic WhatsApp reminders to everyone who owes you, at the time you choose.',cta:'Ask about automatic reminders',topic:'automatic WhatsApp reminders'},
  reports:{tag:'Consult RÊVO',title:'Not sure what the numbers mean?',body:'Talk to a RÊVO consultant about cutting costs, pricing your items and growing profit.',cta:'Consult RÊVO',topic:'a business review / consulting'},
  grow:{tag:'RÊVO Clips',title:'Get more customers',body:'Reels, posters and Instagram set-up made for your shop by RÊVO Clips.',cta:'Grow with RÊVO Clips',topic:'social media content (reels, posters)'},
  home:{tag:'RÊVO',title:'Build more with RÊVO',body:'Website, WhatsApp automation, social media and business consulting for your shop.',cta:'Talk to RÊVO',topic:'growing my business'},
  stock:{tag:'RÊVO Systems',title:'Order from suppliers automatically',body:'Low-stock alerts that message your supplier for you. We can set this up.',cta:'Ask RÊVO Systems',topic:'automatic supplier reordering'},
};
function revoCard(k){if(isCreator())return ['home','khata','stock','reports'].includes(k)?clipsCard():'';const r=REVO[k];if(!r)return '';return `<div class="revo"><div class="rv-tag">${r.tag}</div><div class="grow"><b>${r.title}</b><div class="small">${r.body}</div></div><a class="btn warn sm" target="_blank" rel="noopener" href="${revoLink(r.topic)}">${r.cta}</a></div>`;}
function revoLock(label,k){return `<div class="lockrow"><span>🔒</span><div class="grow"><b>${label}</b><div class="small muted">Part of RÊVO Systems. Not included in free BizGrow.</div></div><a class="btn sm warn" target="_blank" rel="noopener" href="${revoLink(REVO[k].topic)}">Unlock with RÊVO</a></div>`;}
/* ---------- RÊVO Clips (creator mode only) ---------- */
const clipsTopic='short-form video editing, podcast clipping and social media design';
const clipsLink=()=>`https://wa.me/${REVO_WA}?text=${encodeURIComponent(`Hi RÊVO Clips, I use BizGrow for ${S.me.shop.name}. I'd like to talk about: ${clipsTopic}`)}`;
const clipsSide=()=>`<a class="sidecta" target="_blank" rel="noopener" href="${clipsLink()}"><b>${t('c_clips_cta')}</b><span>${t('c_clips_tag')}</span></a>`;
const clipsCard=()=>sessionStorage.getItem('bg_clips_x')?'':`<div class="revo"><div class="rv-tag">${t('c_clips_tag')}</div><div class="grow"><b>${t('c_clips_title')}</b><div class="small">${t('c_clips_body')}</div></div><a class="btn warn sm" target="_blank" rel="noopener" href="${clipsLink()}">${t('c_clips_cta')}</a><button class="link" data-clips-x aria-label="close">✕</button></div>`;
let clipsLast=Date.now()-3*60e3;
function clipsPopup(){
  const el=document.createElement('div');el.className='revopop';
  el.innerHTML=`<button class="x" aria-label="close">✕</button><div class="rv-tag">${t('c_clips_tag')}</div><b>${t('c_clips_title')}</b><div class="small">${t('c_clips_pop')}</div><div class="row mt"><a class="btn warn sm" target="_blank" rel="noopener" href="${clipsLink()}">${t('c_clips_cta')}</a><button class="link" data-snooze>${t('c_not_now')}</button></div>`;
  document.body.appendChild(el);
  const off=()=>{sessionStorage.setItem('bg_clips_x','1');el.remove();};
  el.querySelector('.x').onclick=off;el.querySelector('[data-snooze]').onclick=off;
  setTimeout(()=>el.remove(),20000);
}
function clipsTick(){
  if(!isCreator()||sessionStorage.getItem('bg_clips_x')||!['home','khata','stock','reports'].includes(S.page))return;
  if(document.querySelector('.ov,.revopop'))return;
  const ae=document.activeElement;if(ae&&/^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName))return;
  if(Date.now()-clipsLast<5*60e3)return;
  clipsLast=Date.now();clipsPopup();
}
setInterval(clipsTick,60e3);
document.addEventListener('click',e=>{const x=e.target.closest('[data-clips-x]');if(x){sessionStorage.setItem('bg_clips_x','1');const c=x.closest('.revo');c&&c.remove();}});
function revoPopup(){
  if(isCreator())return;
  if(sessionStorage.getItem('bg_pop')||+localStorage.getItem('bg_pop_until')>Date.now())return;
  const pr=(S.me.answers&&S.me.answers.problems)||[];
  const pool=[];
  if(pr.includes('customers'))pool.push('grow');if(pr.includes('profit'))pool.push('reports');if(pr.includes('udhar'))pool.push('khata');if(pr.includes('stock'))pool.push('stock');
  const k=pool.length?pool[Math.floor(Math.random()*pool.length)]:['home','reports','grow'][Math.floor(Math.random()*3)];
  const r=REVO[k];sessionStorage.setItem('bg_pop','1');
  const el=document.createElement('div');el.className='revopop';
  el.innerHTML=`<button class="x" aria-label="close">✕</button><div class="rv-tag">${r.tag}</div><b>${r.title}</b><div class="small">${r.body}</div><div class="row mt"><a class="btn warn sm" target="_blank" rel="noopener" href="${revoLink(r.topic)}">${r.cta}</a><button class="link" data-snooze>Not now</button></div>`;
  document.body.appendChild(el);
  el.querySelector('.x').onclick=()=>el.remove();
  el.querySelector('[data-snooze]').onclick=()=>{localStorage.setItem('bg_pop_until',Date.now()+3*864e5);el.remove();};
  setTimeout(()=>el.remove(),20000);
}

/* ---------- first-time setup ---------- */
const PROBS=[['stock','Stock runs out without me noticing'],['udhar','Money owed to me is hard to collect'],['profit','I don\'t know my real profit'],['billing','Billing is slow or messy'],['customers','I want more customers'],['records','My records are on paper / scattered']];
function onboarding(){
  if(document.querySelector('[data-obwiz]'))return;
  const A={problems:[]};let step=0;
  const o=modal('<div id="obx"></div>');o.dataset.obwiz='1';
  const sheet=o.querySelector('.sheet');
  const opt=(name,vals)=>vals.map(([v,l])=>`<button type="button" class="chip big ${A[name]===v?'on':''}" data-ob="${name}" data-v="${v}">${l}</button>`).join('');
  const steps=[
   ()=>`<h2>What kind of business do you run?</h2><p class="muted small mb">We'll set up the right items and screens for you.</p><div class="chips wrapchips">${opt('category',CATS)}</div>`,
   ()=>`<h2>How many people work in your shop?</h2><div class="chips wrapchips">${opt('size',[['solo','Just me'],['small','2 to 3 people'],['team','4 or more']])}</div>`,
   ()=>`<h2>How do you keep your accounts today?</h2><div class="chips wrapchips">${opt('tracking',[['paper','Notebook / register'],['app','Another app'],['excel','Excel / phone notes'],['none','I don\'t really']])}</div>`,
   ()=>`<h2>What troubles you most?</h2><p class="muted small mb">Pick all that apply. We'll show you what helps.</p><div class="chips wrapchips">${PROBS.map(([v,l])=>`<button type="button" class="chip big ${A.problems.includes(v)?'on':''}" data-ob="problems" data-v="${v}">${l}</button>`).join('')}</div>`,
   ()=>`<h2>Last step</h2><div class="f"><label>Shop phone number</label><input class="in" id="ob-phone" type="tel" value="${esc(S.me.shop.phone||'')}"></div><div class="f"><label>Your UPI ID (optional)</label><input class="in" id="ob-upi" placeholder="name@bank" value="${esc(S.me.shop.upi_id||'')}"><div class="hint">So customers can pay you from udhar reminders.</div></div>${A.category==='creator'?'':'<label class="chk f"><input type="checkbox" id="ob-kit" checked><span>Add a ready-made item list for my type of shop (I can change prices)</span></label>'}`];
  const draw=()=>{
    const last=step===steps.length-1;
    $('#obx',o).innerHTML=`<div class="row sp mb small muted"><span>Step ${step+1} of ${steps.length}</span><button class="link" data-ob-skip>Skip for now</button></div><div class="obbar"><i style="width:${(step+1)/steps.length*100}%"></i></div>${steps[step]()}<div class="row mt">${step?'<button class="btn sec" data-ob-back>Back</button>':''}<button class="btn grow" data-ob-next>${last?'Finish':'Next'}</button></div>`;
  };
  A.category=S.me.shop.category||'kirana';
  o.addEventListener('click',async e=>{
    const b=e.target.closest('[data-ob]');
    if(b){const n=b.dataset.ob,v=b.dataset.v;if(n==='problems'){const i=A.problems.indexOf(v);i>=0?A.problems.splice(i,1):A.problems.push(v);}else A[n]=v;draw();return;}
    if(e.target.closest('[data-ob-back]')){step--;draw();return;}
    if(e.target.closest('[data-ob-skip]')){sessionStorage.setItem('bg_skipob','1');await api('/onboarding','PUT',{skipped:true,category:A.category}).catch(()=>{});o.close();return;}
    if(e.target.closest('[data-ob-next]')){
      if(step<steps.length-1){step++;draw();return;}
      const btn=e.target.closest('[data-ob-next]');btn.disabled=true;
      try{
        await api('/onboarding','PUT',{...A,phone:$('#ob-phone',o).value,upi_id:$('#ob-upi',o).value});
        if($('#ob-kit',o)&&$('#ob-kit',o).checked){const have=await api('/products');if(!have.items.length)await api('/starter','POST',{kit:A.category});}
        S.me=await api('/me');o.close();toast('You are all set 🎉');render();
      }catch(err){btn.disabled=false;toast(err.message);}
    }
  });
  draw();
}

/* ---------- helpers ---------- */
const head=(title,sub,actions='')=>`<div class="top"><div><h1>${title}</h1>${sub?`<p>${sub}</p>`:''}</div><div class="row wrap">${actions}</div></div>`;
const emptyBox=(a,b,btn='')=>`<div class="empty"><b>${a}</b>${b}${btn?`<div class="mt">${btn}</div>`:''}</div>`;
async function loadProducts(){S.products=(await api('/products')).items;}
async function loadCustomers(){S.customers=(await api('/customers')).items;}
const greet=()=>{const h=new Date(Date.now()+IST).getUTCHours();return h<12?'Good morning':h<17?'Good afternoon':'Good evening';};

/* ---------- on-screen translation for literal English phrases (hi, mr, gu) ---------- */
const TXC={};
function txPattern(lang){
  if(TXC[lang]!==undefined)return TXC[lang];
  const d=(window.I18N_TX||{})[lang];
  if(!d){TXC[lang]=null;return null;}
  const keys=Object.keys(d).sort((x,y)=>y.length-x.length);
  const re=new RegExp(keys.map(k=>'(?<![A-Za-z])'+k.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?![A-Za-z])').join('|'),'g');
  TXC[lang]={d,re};return TXC[lang];
}
function txText(s){const P=txPattern(S.lang);if(!P||!/[A-Za-z]/.test(s))return s;return s.replace(P.re,m=>P.d[m]||m);}
function txNode(root){
  if(!root||S.lang==='en'||!txPattern(S.lang))return;
  if(root.nodeType===3){const v=root.nodeValue;const nv=txText(v);if(nv!==v)root.nodeValue=nv;return;}
  if(root.nodeType!==1)return;
  const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode:n=>(n.parentNode&&/^(SCRIPT|STYLE|TEXTAREA)$/.test(n.parentNode.nodeName))?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT});
  const list=[];let n;while((n=w.nextNode()))list.push(n);
  for(const x of list){const v=x.nodeValue;const nv=txText(v);if(nv!==v)x.nodeValue=nv;}
  root.querySelectorAll&&root.querySelectorAll('[placeholder],[aria-label],[title]').forEach(el=>{for(const at of ['placeholder','aria-label','title']){const v=el.getAttribute(at);if(v&&/[A-Za-z]/.test(v)){const nv=txText(v);if(nv!==v)el.setAttribute(at,nv);}}});
}
new MutationObserver(ms=>{if(S.lang==='en')return;for(const m of ms)for(const nd of m.addedNodes)txNode(nd);}).observe(document.body,{childList:true,subtree:true});

/* ---------- barcode scan: camera (BarcodeDetector, or ZXing when missing) with typed fallback ---------- */
const ZXING_URL='https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js';
let zxingP=null;
function loadZXing(){if(window.ZXing)return Promise.resolve(window.ZXing);if(!zxingP)zxingP=new Promise((res,rej)=>{const s=document.createElement('script');s.src=ZXING_URL;s.onload=()=>window.ZXing?res(window.ZXing):rej(new Error('scanner'));s.onerror=()=>rej(new Error('scanner'));document.head.appendChild(s);});return zxingP;}
function openScanner({title,onCode}){
  let stream=null,timer=null,reader=null,closed=false,last='',lastAt=0;
  function stop(){closed=true;clearInterval(timer);try{reader&&reader.reset();}catch(e){}if(stream)stream.getTracks().forEach(t=>t.stop());}
  const o=modal(`<h2>${esc(title||t('scan_title'))}</h2>
    <div class="scanbox"><video id="scanv" playsinline muted autoplay></video><div class="scanline"></div></div>
    <p class="small muted" id="scanmsg">${t('scan_starting')}</p>
    <div class="f"><label>${t('scan_or_type')}</label><div class="row"><input class="in grow" style="min-width:0" id="scan-manual" autocomplete="off" placeholder="${t('scan_type_ph')}"><button type="button" class="btn" style="flex:none" data-scan-use>${t('scan_use')}</button></div></div>
    <div class="row mt"><button type="button" class="btn sec block" data-scan-close>${t('scan_done')}</button></div>`,{onclose:stop});
  const msg=m=>{const e=$('#scanmsg',o);if(e)e.textContent=m;};
  const video=$('#scanv',o);
  function emit(code){
    code=String(code||'').trim();if(!code)return;
    const now=Date.now();const same=code===last&&now-lastAt<1200;last=code;lastAt=now;
    if(same)return;
    onCode(code);
  }
  o.querySelector('[data-scan-close]').onclick=()=>o.close();
  const use=()=>{const i=$('#scan-manual',o);const v=i.value.trim();if(v){i.value='';emit(v);i.focus();}};
  o.querySelector('[data-scan-use]').onclick=use;
  $('#scan-manual',o).addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();use();}});
  (async()=>{
    if(!(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia)){msg(t('scan_no_device'));return;}
    try{stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});}
    catch(err){const n=err&&err.name;msg(n==='NotAllowedError'||n==='PermissionDeniedError'?t('scan_denied'):(n==='NotFoundError'||n==='OverconstrainedError')?t('scan_no_cam'):t('scan_cam_fail'));return;}
    if(closed){stream.getTracks().forEach(tr=>tr.stop());return;}
    video.srcObject=stream;try{await video.play();}catch(e){}
    msg(t('scan_point'));
    if('BarcodeDetector' in window){
      let det;try{det=new BarcodeDetector({formats:['ean_13','ean_8','upc_a','upc_e','code_128','code_39','qr_code','itf']});}catch(e){det=new BarcodeDetector();}
      timer=setInterval(async()=>{if(closed||video.readyState<2)return;try{const r=await det.detect(video);if(r.length)emit(r[0].rawValue);}catch(e){}},350);
    }else{
      msg(t('scan_loading'));
      try{const Z=await loadZXing();if(closed)return;const rd=new Z.MultiFormatReader();const cv=document.createElement('canvas');const cx=cv.getContext('2d',{willReadFrequently:true});msg(t('scan_point'));
        timer=setInterval(()=>{if(closed||video.readyState<2||!video.videoWidth)return;cv.width=video.videoWidth;cv.height=video.videoHeight;cx.drawImage(video,0,0);
          try{const res=rd.decode(new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(cv))));emit(res.getText());}catch(e){}},300);
      }catch(e){if(!closed)msg(t('scan_lib_fail'));}
    }
  })();
  return o;
}

/* ---------- home ---------- */
async function pHome(v){
  const d=await api('/dashboard');
  const diff=d.yesterday.sales>0?Math.round((d.today.sales-d.yesterday.sales)/d.yesterday.sales*100):null;
  const setup=d.setup;const fresh=setup.items===0;
  v.innerHTML=head(`${greet()}, ${esc(S.me.user.name.split(' ')[0])}`,esc(S.me.shop.name)+' · '+new Date(Date.now()+IST).toUTCString().slice(0,11).replace(',',''),`<a class="btn" href="#/sell">${ic('sell').replace('<svg','<svg width="18" height="18"')} ${t('new_sale')}</a>`)+
  (fresh?`<div class="card mb"><h3>Let's set up your shop — 3 quick steps</h3>
   <div class="step ${setup.items?'done':''}"><div class="n">1</div><div class="grow"><b>${isCreator()?'Add your services':'Add your items'}</b><div class="muted small">${isCreator()?'List what you offer (reels, podcast clips, design) with your rates. You can change them any time.':'Add your items one by one: cloth, yarn, raw material, with rate and unit.'}</div></div><a class="btn sm" href="#/stock">Add items</a></div>
   <div class="step"><div class="n">2</div><div class="grow"><b>Make your first bill</b><div class="muted small">Tap items, choose Cash or UPI. That's it.</div></div><a class="btn sm sec" href="#/sell">Sell</a></div>
   <div class="step"><div class="n">3</div><div class="grow"><b>Add your UPI ID</b><div class="muted small">So customers can pay you from WhatsApp reminders.</div></div>${isOwner()?'<a class="btn sm sec" href="#/settings">Settings</a>':''}</div></div>`:'')+
  `<div class="grid g4 mb">
   <div class="card kpi"><div class="k">${t('sales_today')}</div><div class="v num">${inr(d.today.sales)}</div><div class="s">${d.today.bills} ${d.today.bills===1&&S.lang==='en'?'bill':t('bills').toLowerCase()}${diff!==null?` · <span class="${diff>=0?'up':'dn'}">${diff>=0?'▲':'▼'} ${Math.abs(diff)}% vs yesterday</span>`:''}</div></div>
   <div class="card kpi"><div class="k">${t('spent')}</div><div class="v num">${inr(d.today.expenses)}</div><div class="s"><a href="#/expenses">Add expense</a></div></div>
   ${isOwner()?`<div class="card kpi"><div class="k">${t('profit')}</div><div class="v num">${inr(d.today.profit)}</div><div class="s">Sales − cost of items − expenses</div></div>`:`<div class="card kpi"><div class="k">Collected today</div><div class="v num">${inr(d.today.collected)}</div></div>`}
   <div class="card kpi"><div class="k">${t('to_collect')}</div><div class="v num">${inr(d.udhar.total)}</div><div class="s">${d.udhar.people?d.udhar.people+' customer'+(d.udhar.people>1?'s':'')+' · <a href="#/khata">View</a>':t('all_clear')}</div></div></div>
   <div class="grid g2"><div class="card"><h3>${t('low_stock')}</h3>${d.low_stock.length?`<div class="list">${d.low_stock.map(p=>`<div class="li"><div class="grow"><div class="t">${esc(p.name)}</div><div class="d">Reorder at ${qn(p.reorder)} ${esc(p.unit)}</div></div><span class="badge ${p.stock<=0?'red':'amber'}">${p.stock<=0?'Finished':qn(p.stock)+' '+esc(p.unit)+' left'}</span></div>`).join('')}</div>`:emptyBox('Stock looks fine','Items below their reorder level will show here.')}</div>
   <div class="card"><h3>Quick actions</h3><div class="grid g2">
    <a class="btn sec" href="#/sell">${t('new_sale')}</a><a class="btn sec" href="#/expenses">Add expense</a><a class="btn sec" href="#/khata">${t('khata')}</a><a class="btn sec" href="#/reports">${t('day_end')}</a></div>
    ${d.tasks_due?`<div class="okmsg mt">You have ${d.tasks_due} task${d.tasks_due>1?'s':''} due. <a href="#/tasks">Open</a></div>`:''}</div></div>${revoCard('home')}`;
}

/* ---------- sell ---------- */
const cartSub=()=>S.cart.reduce((s,i)=>s+i.qty*i.price,0);
async function pSell(v){
  await Promise.all([loadProducts(),loadCustomers()]);
  const cats=[...new Set(S.products.map(p=>p.category).filter(Boolean))];
  v.innerHTML=head(t('new_sale'),'Tap an item to add it to the bill')+`<div id="sellPlanNote" class="mb"></div><div class="pos"><div>
   <div class="row mb"><input class="in grow" style="min-width:0" id="pq" placeholder="${t('search')} / scan barcode" value="${esc(S.q)}" autocomplete="off"><button class="btn sec" style="flex:none" data-act="scanbill">📷 ${t('scan_btn')}</button><button class="btn sec" style="flex:none" data-act="addcustom">+ Other</button></div>
   ${cats.length?`<div class="chips"><button class="chip ${!S.cat?'on':''}" data-act="cat" data-c="">All</button>${cats.map(c=>`<button class="chip ${S.cat===c?'on':''}" data-act="cat" data-c="${esc(c)}">${esc(c)}</button>`).join('')}</div>`:''}
   <div class="tiles" id="tiles"></div></div>
   <div class="card cart" id="cartcard"><h3>${t('cart')}</h3><div id="cartbox"></div></div></div><button class="cartbar hide" id="cartbar" data-act="gocart"></button>`;
  drawTiles();drawCart();planNote('#sellPlanNote');
  $('#pq').addEventListener('input',e=>{S.q=e.target.value;drawTiles();});
  $('#pq').addEventListener('keydown',e=>{if(e.key==='Enter'){const q=S.q.trim().toLowerCase();const hit=S.products.find(p=>p.sku&&p.sku.toLowerCase()===q)||(visible().length===1&&visible()[0]);if(hit){addToCart(hit.id);S.q='';e.target.value='';drawTiles();}}});
}
const visible=()=>S.products.filter(p=>(!S.cat||p.category===S.cat)&&(!S.q||(p.name+' '+(p.sku||'')).toLowerCase().includes(S.q.toLowerCase())));
const isOut=p=>p.unit!=='service'&&p.stock<=0;
const isLow=p=>p.unit!=='service'&&(p.stock<=0||(p.reorder>0&&p.stock<=p.reorder));
function drawTiles(){
  const el=$('#tiles');if(!el)return;
  if(!S.products.length){el.innerHTML=emptyBox('No items yet','Add your items first, then billing takes one tap.','<a class="btn" href="#/stock">Add items</a>');return;}
  let list=visible();if(!S.q&&!S.cat){const q=list.filter(p=>p.quick);if(q.length)list=[...q,...list.filter(p=>!p.quick)];}
  el.innerHTML=list.length?list.map(p=>`<button class="tile" data-act="tile" data-id="${p.id}"><b>${esc(p.name)}</b><span>${inr(p.price)}${isOut(p)?` · <span class="low">${t('out_of_stock')}</span>`:isLow(p)?` · <span class="low">${qn(p.stock)} left</span>`:''}</span></button>`).join(''):`<div class="muted">No match. Use "+ Other item" to add it to this bill.</div>`;
}
ACT.gocart=()=>{const c=$('#cartcard');if(c)c.scrollIntoView({behavior:'smooth',block:'start'});};
ACT.cat=el=>{S.cat=el.dataset.c;drawTiles();document.querySelectorAll('.chip').forEach(c=>c.classList.toggle('on',c.dataset.c===S.cat));};
ACT.tile=el=>addToCart(el.dataset.id);
function addToCart(id){const p=S.products.find(x=>String(x.id)===String(id));if(!p)return;const l=S.cart.find(i=>String(i.product_id)===String(id));if(l)l.qty+=1;else S.cart.push({product_id:p.id,name:p.name,price:p.price,qty:1});drawCart();}
ACT.addcustom=()=>{const o=modal(`<h2>Other item</h2><form data-form="custom"><div class="f"><label>${t('name')}</label><input class="in" name="name" required></div><div class="frow"><div class="f"><label>${t('price')} (₹)</label><input class="in" name="price" type="number" step="any" min="0" inputmode="decimal" required></div><div class="f"><label>${t('qty')}</label><input class="in" name="qty" type="number" step="any" min="0.001" value="1" inputmode="decimal"></div></div><button class="btn block" type="submit">${t('add')}</button></form>`);o.dataset.k='custom';};
FORM.custom=(f,d)=>{S.cart.push({product_id:null,name:d.name,price:+d.price||0,qty:+d.qty||1});f.closest('.ov').close();drawCart();};
function drawCart(){
  const el=$('#cartbox');if(!el)return;
  const sub=cartSub(),disc=Math.min(sub,Math.max(0,+S.discount||0)),tot=sub-disc;
  const cb=$('#cartbar');if(cb){const n=S.cart.reduce((s,i)=>s+i.qty,0);cb.classList.toggle('hide',!S.cart.length);cb.innerHTML=`<span>${qn(n)} item${n===1?'':'s'}</span><b>View bill · ${inr(tot)}</b>`;}
  el.innerHTML=S.cart.length?`${S.cart.map((i,ix)=>`<div class="cl"><div class="grow"><div class="bold">${esc(i.name)}</div><div class="muted small">${inr(i.price)} each</div></div>
   <div class="stepper"><button data-act="qty" data-i="${ix}" data-d="-1" aria-label="less">−</button><span>${qn(i.qty)}</span><button data-act="qty" data-i="${ix}" data-d="1" aria-label="more">+</button></div><div class="bold right" style="min-width:70px">${inr(i.qty*i.price)}</div></div>`).join('')}
   <div class="row sp mt small"><span class="muted">${t('discount')} (₹)</span><input class="in" id="disc" type="number" min="0" inputmode="decimal" style="width:100px;min-height:36px;padding:6px 10px" value="${S.discount||''}"></div>
   <div class="totalrow num"><span>${t('total')}</span><span>${inr(tot)}</span></div>
   <div class="pay"><button class="btn big" data-act="pay" data-m="cash">${t('cash')}</button><button class="btn" data-act="pay" data-m="upi">${t('upi')}</button><button class="btn warn" data-act="pay" data-m="udhar">${t('on_udhar')}</button></div>
   <button class="link mt" data-act="clearcart">Clear bill</button>`:`<div class="empty">${t('empty_cart')}</div>`;
  const dd=$('#disc');if(dd)dd.addEventListener('change',e=>{S.discount=+e.target.value||0;drawCart();});
}
ACT.qty=el=>{const i=S.cart[+el.dataset.i];i.qty=Math.round((i.qty+ +el.dataset.d)*1000)/1000;if(i.qty<=0)S.cart.splice(+el.dataset.i,1);drawCart();};
ACT.clearcart=()=>{S.cart=[];S.discount=0;drawCart();};
ACT.pay=async el=>{
  if(!S.cart.length)return toast('Add an item first');
  const m=el.dataset.m;
  if(m==='udhar')return pickCustomer();
  await finishSale({method:m});
};
function pickCustomer(){
  const o=modal(`<h2>Who is taking it on udhar?</h2><input class="in mb" id="cq" placeholder="${t('search')} ${t('customer').toLowerCase()}…"><div id="cl" class="list" style="max-height:280px;overflow:auto"></div>
   <button class="btn sec block mt" data-act="newcust-sale">+ New customer</button>`);
  const draw=()=>{const q=($('#cq',o).value||'').toLowerCase();const l=S.customers.filter(c=>c.name.toLowerCase().includes(q));$('#cl',o).innerHTML=l.length?l.map(c=>`<button class="li" style="width:100%;text-align:left" data-act="udhar-to" data-id="${c.id}"><div class="avatar">${esc(c.name[0]||'?').toUpperCase()}</div><div class="grow"><div class="t">${esc(c.name)}</div><div class="d">${c.balance>0?'Already owes '+inr(c.balance):esc(c.phone||'')}</div></div></button>`).join(''):'<div class="muted small" style="padding:10px 0">No customer found.</div>';};
  $('#cq',o).addEventListener('input',draw);draw();
}
ACT['udhar-to']=async el=>{const o=el.closest('.ov');const c=S.customers.find(x=>String(x.id)===String(el.dataset.id));if(!c){toast('Customer not found. Please pick again.');return;}
  const sub=cartSub(),tot=sub-Math.min(sub,S.discount||0);
  o.querySelector('.sheet').innerHTML=`<h2>Udhar for ${esc(c.name)}</h2><form data-form="udhar-sale"><input type="hidden" name="cid" value="${c.id}"><div class="f"><label>Bill total</label><div class="num bold" style="font-size:24px">${inr(tot)}</div></div><div class="f"><label>Paid now (₹) — leave 0 if nothing paid</label><input class="in" name="paid" type="number" min="0" max="${tot}" step="any" value="0" inputmode="decimal"></div><button class="btn block" type="submit">Save bill</button></form>`;};
FORM['udhar-sale']=async(f,d)=>{const o=f.closest('.ov');await finishSale({method:'cash',customer_id:d.cid,paid:+d.paid||0});o.close();};
ACT['newcust-sale']=el=>{const o=el.closest('.ov');o.querySelector('.sheet').innerHTML=`<h2>New customer</h2><form data-form="newcust-sale"><div class="f"><label>${t('name')}</label><input class="in" name="name" required></div><div class="f"><label>${t('phone')}</label><input class="in" name="phone" type="tel" inputmode="tel"></div><button class="btn block" type="submit">${t('save')}</button></form>`;};
FORM['newcust-sale']=async(f,d)=>{const r=await api('/customers','POST',d);await loadCustomers();const o=f.closest('.ov');o.close();const c=S.customers.find(x=>x.id===r.id);const fake=document.createElement('div');pickCustomer();document.querySelector(`[data-act="udhar-to"][data-id="${r.id}"]`).click();};
async function finishSale(extra){
  const sub=cartSub(),disc=Math.min(sub,S.discount||0);
  const r=await api('/sales','POST',{items:S.cart,discount:disc,...extra});
  const cart=S.cart,discount=disc;S.cart=[];S.discount=0;
  await loadProducts();
  receipt(r,cart,discount,extra);
  drawCart();drawTiles();
}
function slipText(r,cart,discount,cname){
  const L=[`*${S.me.shop.name}*`,`${t('m_bill')} #${r.bill_no} · ${dtime(new Date().toISOString())}`,''];
  cart.forEach(i=>L.push(`${i.name} × ${qn(i.qty)} = ${inr(i.qty*i.price)}`));
  if(discount)L.push(`${t('m_discount')}: -${inr(discount)}`);
  L.push('',`*${t('m_total')}: ${inr(r.total)}*`);
  if(r.due>0)L.push(`${t('m_paid')}: ${inr(r.paid)}`,`*${t('m_balance')}: ${inr(r.due)}*`);
  const u=r.due>0?upiLink(r.due):'';if(u)L.push('',`${t('m_pay_upi')}: ${S.me.shop.upi_id}`);
  L.push('',t('m_thanks'));return L.join('\n');
}
function receipt(r,cart,discount,extra){
  const cust=extra.customer_id?S.customers.find(c=>c.id===extra.customer_id):null;
  const o=modal(`<div class="row sp"><h2>✓ Bill saved</h2><span class="badge">#${r.bill_no}</span></div>
   <div class="slip printable" id="slip"><div style="text-align:center"><b>${esc(S.me.shop.name)}</b><br>${esc(S.me.shop.address||'')}${S.me.shop.phone?'<br>Ph: '+esc(S.me.shop.phone):''}</div><hr>
   ${cart.map(i=>`<div class="r"><span>${esc(i.name)} × ${qn(i.qty)}</span><span>${inr(i.qty*i.price)}</span></div>`).join('')}<hr>
   ${discount?`<div class="r"><span>Discount</span><span>-${inr(discount)}</span></div>`:''}<div class="r"><b>TOTAL</b><b>${inr(r.total)}</b></div>
   ${r.due>0?`<div class="r"><span>Paid</span><span>${inr(r.paid)}</span></div><div class="r"><b>Balance (udhar)</b><b>${inr(r.due)}</b></div>`:`<div class="r"><span>Paid by</span><span>${extra.method==='upi'?'UPI':'Cash'}</span></div>`}<hr><div style="text-align:center">Thank you!</div></div>
   <div class="grid g2 mt"><a class="btn" target="_blank" rel="noopener" href="${waLink(cust&&cust.phone,slipText(r,cart,discount))}">${t('share_whatsapp')}</a><button class="btn sec" onclick="window.print()">${t('print')}</button></div>
   <div id="planNote"></div>
   <a class="btn sec block mt" target="_blank" rel="noopener" href="/api/invoice/${r.id}">Invoice / GST bill (PDF)</a>
   <button class="btn sec block mt" onclick="this.closest('.ov').close()">New sale</button>`);
  planNote();
}
/* the bill text for WhatsApp, from a saved bill (same layout as the slip) */
function billText(s,items){
  const L=[`*${S.me.shop.name}*`,`${t('m_bill')} #${s.bill_no} · ${dtime(s.created_at)}`];
  if(s.customer_name)L.push(`${t('s3_bill_for')}: ${s.customer_name}`);
  L.push('');
  items.forEach(i=>L.push(`${i.name} × ${qn(i.qty)} = ${inr(i.qty*i.price)}`));
  if(s.discount)L.push(`${t('m_discount')}: -${inr(s.discount)}`);
  L.push('',`*${t('m_total')}: ${inr(s.total)}*`);
  const due=s.total-s.paid;
  if(due>0)L.push(`${t('m_paid')}: ${inr(s.paid)}`,`*${t('m_balance')}: ${inr(due)}*`);
  if(due>0&&S.me.shop.upi_id)L.push('',`${t('m_pay_upi')}: ${S.me.shop.upi_id}`);
  L.push('',t('m_thanks'));return L.join('\n');
}

/* ---------- bills: list by day, open a bill, edit or delete (owner) ---------- */
async function pBills(v,args){
  const day=/^\d{4}-\d{2}-\d{2}$/.test((args&&args[0])||'')?args[0]:today();
  const r=await api('/sales?from='+day+'&to='+day);
  v.innerHTML=head(t('bills'),'Tap a bill to see it'+(isOwner()?', edit or delete':''),`<input type="date" class="in" style="width:auto" value="${day}" onchange="location.hash='#/bills/'+this.value">`)+
  `<div class="card">${r.items.length?`<div class="list">${r.items.map(s=>`<button class="li" style="width:100%;text-align:left" data-act="bill-open" data-id="${s.id}"><div class="grow"><div class="t">Bill #${s.bill_no} · ${esc(s.customer_name||'Walk-in')}</div><div class="d">${dtime(s.created_at)} · ${s.method==='upi'?'UPI':'Cash'}${s.total-s.paid>0?' · udhar '+inr(s.total-s.paid):''}</div></div><b class="num">${inr(s.total)}</b></button>`).join('')}</div>`:emptyBox('No bills on this day','Bills you save will show here.')}</div>`;
}
ACT['bill-open']=async el=>{const d=await api('/sales/'+el.dataset.id);const s=d.sale;await loadCustomers();const cu=s.customer_id?S.customers.find(c=>c.id===s.customer_id):null;
  modal(`<div class="row sp"><h2>Bill #${s.bill_no}</h2><span class="muted small">${dtime(s.created_at)}</span></div>
  <p class="muted small">${esc(s.customer_name||'Walk-in')}</p>
  <div class="slip printable">${d.items.map(i=>`<div class="r"><span>${esc(i.name)} × ${qn(i.qty)}</span><span>${inr(i.qty*i.price)}</span></div>`).join('')}<hr>
  ${s.discount?`<div class="r"><span>Discount</span><span>-${inr(s.discount)}</span></div>`:''}<div class="r"><b>TOTAL</b><b>${inr(s.total)}</b></div>
  <div class="r"><span>Paid (${s.method==='upi'?'UPI':'Cash'})</span><span>${inr(s.paid)}</span></div>
  ${s.total-s.paid>0?`<div class="r"><b>Balance (udhar)</b><b>${inr(s.total-s.paid)}</b></div>`:''}</div>
  <div class="grid g2 mt"><a class="btn" target="_blank" rel="noopener" href="${waLink(cu&&cu.phone,billText(s,d.items))}">${t('s3_share_bill')}</a><button class="btn sec" onclick="window.print()">${t('s3_print')}</button></div>
  <a class="btn sec block mt" target="_blank" rel="noopener" href="/api/invoice/${s.id}">Invoice / GST bill (PDF)</a>
  ${isOwner()?`<div class="grid g2 mt"><button class="btn sec" data-act="bill-edit" data-id="${s.id}">${t('edit')}</button><button class="btn red" data-act="bill-del" data-id="${s.id}" data-no="${s.bill_no}" data-total="${s.total}">Delete</button></div>`:''}`);
};
ACT['bill-edit']=async el=>{const o=el.closest('.ov');const d=await api('/sales/'+el.dataset.id);const s=d.sale;await loadCustomers();o.close();
  modal(`<h2>${t('edit')} bill #${s.bill_no}</h2><p class="muted small mb">Items and the total stay as they are. You can change who it is for, how it was paid, and how much was paid now.</p>
  <form data-form="bill-edit"><input type="hidden" name="id" value="${s.id}">
  <div class="f"><label>${t('customer')}</label><select class="in" name="customer_id"><option value="">Walk-in (no customer)</option>${S.customers.map(c=>`<option value="${c.id}" ${c.id===s.customer_id?'selected':''}>${esc(c.name)}</option>`).join('')}</select></div>
  <div class="f"><label>Name on bill (walk-in only)</label><input class="in" name="customer_name" value="${esc(s.customer_id?'':(s.customer_name||''))}"></div>
  <div class="f"><label>How did they pay?</label><select class="in" name="method"><option value="cash" ${s.method!=='upi'?'selected':''}>${t('cash')}</option><option value="upi" ${s.method==='upi'?'selected':''}>${t('upi')}</option></select></div>
  <div class="f"><label>Paid (₹) — bill total is ${inr(s.total)}</label><input class="in" name="paid" type="number" min="0" max="${s.total}" step="any" inputmode="decimal" value="${s.paid}" required></div>
  <button class="btn block" type="submit">${t('save')}</button></form>`);
};
FORM['bill-edit']=async(f,d)=>{await api('/sales/'+d.id,'PUT',{customer_id:d.customer_id||null,customer_name:d.customer_name,method:d.method,paid:d.paid});f.closest('.ov').close();toast('Bill updated');render();};
ACT['bill-del']=async el=>{if(!confirm('Delete bill #'+el.dataset.no+' ('+inr(+el.dataset.total)+')? Its items go back to stock and any udhar from it is removed. This cannot be undone.'))return;await api('/sales/'+el.dataset.id,'DELETE');el.closest('.ov').close();toast('Bill deleted');render();};

/* ---------- khata ---------- */
/* ---------- reminders: click-to-send batch (no WhatsApp Business account needed; the user taps Send in WhatsApp) ---------- */
const REM_TPL={polite:'wa_reminder',firm:'rem_firm',friendly:'rem_friendly'};
const REM_TPL_NAME={polite:'Polite',firm:'Firm',friendly:'Friendly'};
const remKey=()=>'bg_rem_'+new Date().toISOString().slice(0,10);
function remText(tpl,c,amt){const base=t(REM_TPL[tpl]).replace('{name}',c.name).replace('{shop}',S.me.shop.name).replace('{amount}',inr(amt));const up=S.me.shop.upi_id?t('wa_upi').replace('{upi}',S.me.shop.upi_id)+' ':'';return base+' '+up+t('m_thanks');}
async function pReminders(v){
  if(planLocked(await planNow().catch(()=>null),'udhar_reminders')){v.innerHTML=head('Send reminders','Open WhatsApp with each message ready, then tap Send there.')+lockCard('udhar_reminders');return;}
  await loadCustomers();
  const tpl=S.remTpl&&REM_TPL[S.remTpl]?S.remTpl:'polite';
  const days=c=>c.last_credit?Math.floor((Date.now()-new Date(c.last_credit))/864e5):null;
  const owing=S.customers.filter(c=>c.balance>0).sort((a,b)=>b.balance-a.balance);
  const rows=S.remOnly?owing.filter(c=>(days(c)||0)>=7):owing;
  const opened=JSON.parse(localStorage.getItem(remKey())||'[]');
  v.innerHTML=head('Send reminders','Open WhatsApp with each message ready, then tap Send there.')+
   `<div class="card mb"><p class="small">BizGrow opens WhatsApp with the message ready. You tap Send in WhatsApp. Sending on its own needs a WhatsApp Business account, which BizGrow does not use yet.</p>
    <div class="row wrap mt">${Object.keys(REM_TPL).map(k=>`<button class="btn sm ${k===tpl?'':'sec'}" data-act="rtpl" data-k="${k}">${REM_TPL_NAME[k]}</button>`).join('')}</div>
    <div class="row wrap mt">${[[false,t('s3_all')],[true,t('s3_overdue_only')]].map(([k,l])=>`<button class="btn sm ${!!S.remOnly===k?'':'sec'}" data-act="remfilter" data-k="${k?1:0}">${l}</button>`).join('')}</div></div>
   <div class="card">${rows.length?`<div class="row sp mb"><span class="small muted">${t('s3_opened_of').replace('{n}',opened.length).replace('{m}',rows.length)}</span><button class="btn sm" data-act="remnext">${t('s3_open_next')}</button></div><div class="list">${rows.map(c=>{const d=days(c);const done=opened.includes(c.id);
     return `<div class="li"><div class="grow"><div class="t">${esc(c.name)}</div><div class="d">${inr(c.balance)}${d!=null&&d>=1?` · ${d} day${d>1?'s':''} since last udhar`:''}</div></div>${c.phone?`<a class="btn sm ${done?'sec':''}" target="_blank" rel="noopener" data-rem="${c.id}" href="${waLink(c.phone,remText(tpl,c,c.balance))}">${done?'Opened':t('s3_remind_wa')}</a>`:`<a class="btn sec sm" href="#/khata/${c.id}">${t('s3_add_phone')}</a>`}</div>`;}).join('')}</div>`
     :emptyBox(S.remOnly?t('s3_nobody_overdue'):'Nobody owes you right now','Reminders show here when a customer has udhar pending.','<a class="btn sec" href="#/khata">Back to khata</a>')}</div>`;
}
ACT.remfilter=el=>{S.remOnly=el.dataset.k==='1';render();};
ACT.remnext=()=>{const opened=JSON.parse(localStorage.getItem(remKey())||'[]');const next=[...document.querySelectorAll('a[data-rem]')].find(a=>!opened.includes(a.dataset.rem));if(!next){toast(t('s3_all_done'));return;}next.click();};
ACT.rtpl=el=>{S.remTpl=el.dataset.k;render();};
document.addEventListener('click',e=>{const a=e.target.closest&&e.target.closest('a[data-rem]');if(!a)return;const k=remKey();const arr=JSON.parse(localStorage.getItem(k)||'[]');if(!arr.includes(a.dataset.rem)){arr.push(a.dataset.rem);localStorage.setItem(k,JSON.stringify(arr));}a.textContent='Opened';a.classList.add('sec');});

async function pKhata(v,args){
  if(args[0]==='reminders')return pReminders(v);
  if(args[0])return pCustomer(v,args[0]);
  await loadCustomers();
  const tot=S.customers.reduce((s,c)=>s+Math.max(0,c.balance),0);
  const list=[...S.customers].sort((a,b)=>b.balance-a.balance);
  v.innerHTML=head(t('khata'),'Money your customers owe you',`${tot>0?'<a class="btn sec" href="#/khata/reminders">Send reminders</a>':''}<button class="btn" data-act="newcust">+ ${t('customer')}</button>`)+
   `<div class="card kpi mb"><div class="k">${t('to_collect')}</div><div class="v num">${inr(tot)}</div></div>
   <div class="card"><input class="in mb" id="kq" placeholder="${t('search')}…">${list.length?`<div class="list" id="kl"></div>`:emptyBox('No customers yet','Add customers to keep their udhar (credit) record.','<button class="btn" data-act="newcust">Add customer</button>')}</div>${revoCard('khata')}`;
  const draw=()=>{const q=($('#kq').value||'').toLowerCase();const el=$('#kl');if(!el)return;el.innerHTML=list.filter(c=>c.name.toLowerCase().includes(q)||(c.phone||'').includes(q)).map(c=>{
    const od=c.balance>0&&c.last_credit?Math.floor((Date.now()-new Date(c.last_credit))/864e5):0;
    return `<a class="li" href="#/khata/${c.id}" style="color:inherit"><div class="avatar">${esc(c.name[0]||'?').toUpperCase()}</div><div class="grow"><div class="t">${esc(c.name)}</div><div class="d">${esc(c.phone||'No phone')}${c.balance>0&&od>=1?` · last udhar ${od} day${od>1?'s':''} ago`:''}</div></div><div class="right"><div class="bold ${c.balance>0?'dn':''}">${c.balance>0?inr(c.balance):c.balance<0?'Advance '+inr(-c.balance):'Clear'}</div></div></a>`}).join('');};
  if($('#kq')){$('#kq').addEventListener('input',draw);draw();}
}
ACT.newcust=()=>modal(`<h2>New customer</h2><form data-form="newcust"><div class="f"><label>${t('name')}</label><input class="in" name="name" required></div><div class="f"><label>${t('phone')}</label><input class="in" name="phone" type="tel" inputmode="tel"><div class="hint">Needed to send WhatsApp reminders</div></div><div class="f"><label>${t('note')}</label><input class="in" name="note"></div><button class="btn block" type="submit">${t('save')}</button></form>`);
FORM.newcust=async(f,d)=>{const r=await api('/customers','POST',d);f.closest('.ov').close();go('#/khata/'+r.id);};
async function pCustomer(v,id){
  const d=await api('/customers/'+id);const c=d.customer;
  const od=d.ledger.find(x=>x.kind==='credit');const days=od&&d.balance>0?Math.floor((Date.now()-new Date(od.created_at))/864e5):0;
  const msg=`${t('wa_reminder').replace('{name}',c.name).replace('{shop}',S.me.shop.name).replace('{amount}',inr(d.balance))} ${S.me.shop.upi_id?t('wa_upi').replace('{upi}',S.me.shop.upi_id)+' ':''}${t('m_thanks')}`;
  v.innerHTML=`<a class="link" href="#/khata">← ${t('khata')}</a>`+head(esc(c.name),esc(c.phone||'No phone saved'),`<button class="btn sec" data-act="editcust" data-id="${c.id}">${t('edit')}</button>`)+
   `<div class="grid g21"><div class="card"><div class="row sp mb"><h3 style="margin:0">History</h3><button class="link" data-act="addcredit" data-id="${c.id}">+ Add old udhar</button></div>
   ${d.ledger.length?`<div class="list">${d.ledger.map(x=>`<div class="li"><div class="grow"><div class="t">${x.kind==='credit'?esc(x.note||'Udhar'):'Payment received'+(x.method?' ('+(x.method==='upi'?'UPI':'cash')+')':'')}</div><div class="d">${dtime(x.created_at)}${x.kind==='payment'&&x.note?' · '+esc(x.note):''}</div></div><div class="bold ${x.kind==='credit'?'dn':'up'}">${x.kind==='credit'?'+':'−'}${inr(x.amount)}</div></div>`).join('')}</div>`:emptyBox('No entries yet','Udhar bills and payments will show here.')}</div>
   <div class="card"><div class="k muted small">${d.balance>0?'Owes you':d.balance<0?'Advance paid':'Balance'}</div><div class="num bold ${d.balance>0?'dn':''}" style="font-size:32px">${inr(Math.abs(d.balance))}</div>${days>=7&&d.balance>0?`<div class="badge amber mt">Pending for ${days} days</div>`:''}
   <div class="grid mt">${d.balance>0?`<button class="btn" data-act="receive" data-id="${c.id}" data-bal="${d.balance}">${t('record_payment')}</button>${c.phone?`<a class="btn sec" target="_blank" rel="noopener" href="${waLink(c.phone,msg)}">${t('s3_remind_wa')}</a>`:`<p class="small">${t('s3_no_phone')}</p><button class="btn sec" data-act="editcust" data-id="${c.id}">${t('s3_add_phone')}</button>`}`:''}</div>
   ${c.note?`<p class="muted small mt">${esc(c.note)}</p>`:''}${isOwner()?`<button class="link mt" style="color:var(--danger)" data-act="delcust" data-id="${c.id}">Delete customer</button>`:''}</div></div>`;
}
ACT.receive=el=>modal(`<h2>${t('record_payment')}</h2><form data-form="receive"><input type="hidden" name="id" value="${el.dataset.id}"><div class="f"><label>${t('amount')} (₹)</label><input class="in" name="amount" type="number" step="any" min="0" value="${el.dataset.bal}" inputmode="decimal" required></div><div class="f"><label>How did they pay?</label><select class="in" name="method"><option value="cash">${t('cash')}</option><option value="upi">${t('upi')}</option></select></div><div class="f"><label>${t('note')}</label><input class="in" name="note"></div><button class="btn block" type="submit">${t('save')}</button></form>`);
FORM.receive=async(f,d)=>{await api('/customers/'+d.id+'/payment','POST',d);f.closest('.ov').close();toast('Payment saved');render();};
ACT.addcredit=el=>modal(`<h2>Add old udhar</h2><p class="muted small mb">For money the customer already owed before you started using BizGrow.</p><form data-form="addcredit"><input type="hidden" name="id" value="${el.dataset.id}"><div class="f"><label>${t('amount')} (₹)</label><input class="in" name="amount" type="number" step="any" min="0" inputmode="decimal" required></div><div class="f"><label>${t('note')}</label><input class="in" name="note" placeholder="e.g. Old balance"></div><button class="btn block" type="submit">${t('save')}</button></form>`);
FORM.addcredit=async(f,d)=>{await api('/customers/'+d.id+'/credit','POST',d);f.closest('.ov').close();render();};
ACT.editcust=async el=>{const d=await api('/customers/'+el.dataset.id);const c=d.customer;modal(`<h2>${t('edit')}</h2><form data-form="editcust"><input type="hidden" name="id" value="${c.id}"><div class="f"><label>${t('name')}</label><input class="in" name="name" value="${esc(c.name)}" required></div><div class="f"><label>${t('phone')}</label><input class="in" name="phone" value="${esc(c.phone||'')}" type="tel"></div><div class="f"><label>${t('note')}</label><input class="in" name="note" value="${esc(c.note||'')}"></div><button class="btn block" type="submit">${t('save')}</button></form>`);};
FORM.editcust=async(f,d)=>{await api('/customers/'+d.id,'PUT',d);f.closest('.ov').close();render();};
ACT.delcust=async el=>{if(!confirm('Delete this customer and their udhar history? This cannot be undone.'))return;await api('/customers/'+el.dataset.id,'DELETE');go('#/khata');};

/* ---------- stock ---------- */
async function pStock(v){
  await loadProducts();
  const cats=[...new Set(S.products.map(p=>p.category).filter(Boolean))];
  const low=S.products.filter(isLow);
  v.innerHTML=head(t('stock'),S.products.length+' items'+(low.length?' · '+low.length+' running low':''),`<button class="btn" data-act="additem">+ ${t('add_item')}</button>`)+
   (false?`<div class="card mb"><h3>Start fast with a ready-made list</h3><p class="muted small mb">We add common items with usual prices. You can change prices and delete anything afterwards.</p><div class="row wrap">${CATS.filter(c=>c[0]!=='creator').map(c=>`<button class="btn sec sm" data-act="starter" data-k="${c[0]}">${c[1]}</button>`).join('')}</div></div>`:'')+
   `<div class="card"><div class="row mb wrap"><input class="in grow" style="min-width:140px" id="sq" placeholder="${t('search')}…" value="${esc(S.stockQ)}">${low.length?`<button class="chip ${S.stockLow?'on':''}" data-act="lowonly">Running low (${low.length})</button>`:''}</div>
   ${cats.length?`<div class="chips"><button class="chip ${!S.stockCat?'on':''}" data-act="scat" data-c="">All</button>${cats.map(c=>`<button class="chip ${S.stockCat===c?'on':''}" data-act="scat" data-c="${esc(c)}">${esc(c)}</button>`).join('')}</div>`:''}
   <div id="sl"></div></div>${revoCard('stock')}`;
  const draw=()=>{const q=S.stockQ.toLowerCase();let l=S.products.filter(p=>(!q||(p.name+' '+(p.sku||'')).toLowerCase().includes(q))&&(!S.stockCat||p.category===S.stockCat));if(S.stockLow)l=l.filter(isLow);
   $('#sl').innerHTML=l.length?`<div class="list">${l.map(p=>`<div class="li"><div class="grow"><div class="t">${esc(p.name)}</div><div class="d">${inr(p.price)} / ${esc(p.unit)}${p.category?' · '+esc(p.category):''}${isOwner()&&p.cost?' · cost '+inr(p.cost):''}</div></div>
   <span class="badge ${isOut(p)?'red':isLow(p)?'amber':''}">${isOut(p)?t('out_of_stock'):qn(Math.max(0,p.stock))+' '+esc(p.unit)}</span><button class="btn sec sm" data-act="adjust" data-id="${p.id}">± Stock</button><button class="btn sec sm" data-act="edititem" data-id="${p.id}">${t('edit')}</button></div>`).join('')}</div>`:emptyBox('Nothing here','Try a different search, or add an item.');};
  $('#sq').addEventListener('input',e=>{S.stockQ=e.target.value;draw();});draw();
}
ACT.scat=el=>{S.stockCat=el.dataset.c;render();};ACT.lowonly=()=>{S.stockLow=!S.stockLow;render();};
ACT.starter=async el=>{const r=await api('/starter','POST',{kit:el.dataset.k});toast(r.added+' items added');render();};
const itemForm=(p={})=>`<form data-form="item"><input type="hidden" name="id" value="${p.id||''}"><div class="f"><label>${t('name')}</label><input class="in" name="name" value="${esc(p.name||'')}" required></div>
 <div class="frow"><div class="f"><label>Selling price (₹)</label><input class="in" name="price" type="number" step="any" min="0" inputmode="decimal" value="${p.price??''}" required></div><div class="f"><label>Unit</label><input class="in" name="unit" value="${esc(p.unit||'pc')}" placeholder="pc, kg, pack"></div></div>
 ${isOwner()?`<div class="frow"><div class="f"><label>Your cost (₹)</label><input class="in" name="cost" type="number" step="any" min="0" inputmode="decimal" value="${p.cost??''}"><div class="hint">Used to show profit. Only you can see it.</div></div>`:'<div class="frow"><div></div>'}${p.id?'<div></div>':`<div class="f"><label>Stock now</label><input class="in" name="stock" type="number" step="any" inputmode="decimal" value="0"></div>`}</div>
 <div class="frow"><div class="f"><label>Warn me when stock is below</label><input class="in" name="reorder" type="number" step="any" min="0" inputmode="decimal" value="${p.reorder??0}"></div><div class="f"><label>Group (optional)</label><input class="in" name="category" value="${esc(p.category||'')}" placeholder="e.g. Dairy"></div></div>
 <div class="frow"><div class="f"><label>Barcode / code (optional)</label><div class="row"><input class="in grow" style="min-width:0" name="sku" value="${esc(p.sku||'')}" autocomplete="off"><button type="button" class="btn sec" style="flex:none" data-act="scanfill">📷 ${t('scan_btn')}</button></div></div><div class="f"><label>GST % (optional)</label><select class="in" name="gst_rate">${[0,5,12,18,28,3,0.25,0.1].map(g=>`<option value="${g}" ${(+p.gst_rate||0)===g?'selected':''}>${g?g+'%':'No GST'}</option>`).join('')}</select></div><div class="f"><label>HSN / SAC code (optional)</label><input class="in" name="hsn" value="${esc(p.hsn||'')}"></div><label class="chk f" style="align-self:end;padding-bottom:12px"><input type="checkbox" name="quick" ${p.quick?'checked':''}><span>Show first on Sell screen</span></label></div>
 <button class="btn block" type="submit">${t('save')}</button>${p.id?`<button type="button" class="link mt" style="color:var(--danger)" data-act="delitem" data-id="${p.id}">Delete item</button>`:''}</form>`;
ACT.additem=()=>modal(`<h2>${t('add_item')}</h2>`+itemForm());
ACT.edititem=el=>modal(`<h2>${t('edit')}</h2>`+itemForm(S.products.find(p=>String(p.id)===String(el.dataset.id))));
FORM.item=async(f,d)=>{if(d.id)await api('/products/'+d.id,'PUT',d);else await api('/products','POST',d);f.closest('.ov').close();render();};
ACT.delitem=async el=>{if(!confirm('Delete this item? Past bills are not affected.'))return;await api('/products/'+el.dataset.id,'DELETE');el.closest('.ov').close();render();};
ACT.adjust=async el=>{const p=S.products.find(x=>String(x.id)===String(el.dataset.id));const h=await api('/products/'+p.id+'/history');
  modal(`<h2>${esc(p.name)}</h2><p class="muted mb">In stock: <b>${qn(p.stock)} ${esc(p.unit)}</b></p><form data-form="adjust"><input type="hidden" name="id" value="${p.id}">
  <div class="f"><label>How many to add (+) or remove (−)?</label><input class="in" name="change" type="number" step="any" inputmode="decimal" placeholder="e.g. 10 or -2" required></div>
  <div class="f"><label>Reason</label><select class="in" name="reason"><option>New stock received</option><option>Damaged / expired</option><option>Counted again (correction)</option><option>Used at home</option></select></div><button class="btn block" type="submit">${t('save')}</button></form>
  ${h.items.length?`<h3 class="mt">Recent changes</h3><div class="list">${h.items.slice(0,8).map(x=>`<div class="li"><div class="grow small">${esc(x.reason||'')}<div class="muted">${dtime(x.created_at)}</div></div><b class="${x.change<0?'dn':'up'}">${x.change>0?'+':''}${qn(x.change)}</b></div>`).join('')}</div>`:''}`);};
FORM.adjust=async(f,d)=>{await api('/products/'+d.id+'/adjust','POST',d);f.closest('.ov').close();render();};

/* ---------- expenses ---------- */
async function pExpenses(v){
  const to=today(),from=new Date(Date.now()+IST-29*864e5).toISOString().slice(0,10);
  const e=(await api(`/expenses?from=${from}&to=${to}`)).items;
  const todayT=e.filter(x=>x.date===to).reduce((s,x)=>s+x.amount,0),monthT=e.reduce((s,x)=>s+x.amount,0);
  v.innerHTML=head(t('expenses'),'Everything you spend on the shop',`<button class="btn" data-act="addexp">+ Add expense</button>`)+
   `<div class="grid g2 mb"><div class="card kpi"><div class="k">${t('today')}</div><div class="v num">${inr(todayT)}</div></div><div class="card kpi"><div class="k">Last 30 days</div><div class="v num">${inr(monthT)}</div></div></div>
   <div class="card">${e.length?`<div class="list">${e.map(x=>`<div class="li"><div class="grow"><div class="t">${esc(x.category)}</div><div class="d">${x.date.slice(8)}/${x.date.slice(5,7)} · ${x.method==='upi'?'UPI':'Cash'}${x.note?' · '+esc(x.note):''}</div></div><b>${inr(x.amount)}</b><button class="link" style="color:var(--danger)" data-act="delexp" data-id="${x.id}" aria-label="delete">✕</button></div>`).join('')}</div>`:emptyBox('No expenses yet','Add rent, milk, wages, electricity — so your profit is correct.','<button class="btn" data-act="addexp">Add expense</button>')}</div>`;
}
ACT.scanbill=()=>openScanner({title:t('scan_bill_title'),onCode:code=>{
  const hit=S.products.find(p=>p.sku&&p.sku.trim().toLowerCase()===code.toLowerCase());
  if(!hit){toast(t('scan_not_found').replace('{code}',code));return;}
  addToCart(hit.id);drawTiles();toast(t('scan_added').replace('{name}',hit.name));
}});
ACT.scanfill=el=>{const f=el.closest('form');const inp=f&&f.querySelector('[name=sku]');let sc=null;sc=openScanner({title:t('scan_item_title'),onCode:code=>{if(inp){inp.value=code;toast(t('scan_filled'));}if(sc)sc.close();}});};
ACT.addexp=()=>modal(`<h2>Add expense</h2><form data-form="exp"><div class="f"><label>What for?</label><select class="in" name="category">${isCreator()?EXPCATS_CREATOR.map(([c,k])=>`<option value="${c}">${t(k)}</option>`).join(''):EXPCATS.map(c=>`<option>${c}</option>`).join('')}</select></div><div class="frow"><div class="f"><label>${t('amount')} (₹)</label><input class="in" name="amount" type="number" step="any" min="0" inputmode="decimal" required></div><div class="f"><label>Date</label><input class="in" name="date" type="date" value="${today()}" max="${today()}"></div></div><div class="f"><label>Paid by</label><select class="in" name="method"><option value="cash">${t('cash')}</option><option value="upi">${t('upi')}</option></select></div><div class="f"><label>${t('note')} (optional)</label><input class="in" name="note"></div><button class="btn block" type="submit">${t('save')}</button></form>`);
FORM.exp=async(f,d)=>{await api('/expenses','POST',d);f.closest('.ov').close();render();};
ACT.delexp=async el=>{if(!confirm('Delete this expense?'))return;await api('/expenses/'+el.dataset.id,'DELETE');render();};

/* ---------- reports ---------- */
const repChips=()=>`<div class="chips" style="margin:0"><button class="chip ${S.repDays===7?'on':''}" data-act="rdays" data-d="7">${t('week')}</button><button class="chip ${S.repDays===30?'on':''}" data-act="rdays" data-d="30">${t('month')}</button><button class="chip ${S.repDays===90?'on':''}" data-act="rdays" data-d="90">90 days</button></div>`;
async function pReports(v){
  if(planLocked(await planNow().catch(()=>null),'full_reports')&&S.repDays>7){v.innerHTML=head(t('reports'),'How your shop is doing',repChips())+lockCard('full_reports');return;}
  const [r,z]=await Promise.all([api('/reports?days='+S.repDays),api('/zreport')]);
  const days=[];for(let i=S.repDays-1;i>=0;i--){const d=new Date(Date.now()+IST-i*864e5).toISOString().slice(0,10);const f=r.daily.find(x=>x.d===d);days.push({d,s:f?f.sales:0});}
  const max=Math.max(1,...days.map(x=>x.s));const show=S.repDays<=14?days:days.filter((_,i)=>i%Math.ceil(days.length/14)===0);
  const topMax=Math.max(1,...r.top.map(x=>x.revenue)),exMax=Math.max(1,...r.expenses_by_category.map(x=>x.amount));
  v.innerHTML=head(t('reports'),'How your shop is doing',repChips())+
  `<div class="grid g4 mb"><div class="card kpi"><div class="k">${t('revenue')}</div><div class="v num">${inr(r.totals.revenue)}</div><div class="s">${r.totals.bills} ${r.totals.bills===1?'bill':'bills'}</div></div>
   <div class="card kpi"><div class="k">${t('expenses')}</div><div class="v num">${inr(r.totals.expenses)}</div></div>
   ${r.totals.profit!==null?`<div class="card kpi"><div class="k">Profit</div><div class="v num ${r.totals.profit<0?'dn':''}">${inr(r.totals.profit)}</div><div class="s">After cost of items</div></div>`:''}
   <div class="card kpi"><div class="k">Average bill</div><div class="v num">${inr(r.totals.bills?r.totals.revenue/r.totals.bills:0)}</div></div></div>
  <div class="grid g21 mb"><div class="card"><h3>Daily sales</h3><div class="bars">${show.map(x=>`<div class="b" title="${inr(x.s)}"><i style="height:${Math.round(x.s/max*140)}px"></i><small>${x.d.slice(8)}</small></div>`).join('')}</div></div>
   <div class="card"><h3>${t('top_items')}</h3>${r.top.length?r.top.map(x=>`<div class="hb"><div class="row sp small"><span>${esc(x.name)}</span><b>${inr(x.revenue)}</b></div><div class="bar"><i style="width:${x.revenue/topMax*100}%"></i></div></div>`).join(''):'<div class="muted small">No sales in this period yet.</div>'}</div></div>
  <div class="grid g2 mb"><div class="card"><h3>${t('expense_split')}</h3>${r.expenses_by_category.length?r.expenses_by_category.map(x=>`<div class="hb s"><div class="row sp small"><span>${esc(x.category)}</span><b>${inr(x.amount)}</b></div><div class="bar"><i style="width:${x.amount/exMax*100}%"></i></div></div>`).join(''):'<div class="muted small">No expenses in this period.</div>'}</div>
   <div class="card"><h3>${t('day_end')} · ${z.date.slice(8)}/${z.date.slice(5,7)}</h3>
    <div class="list small"><div class="li"><span class="grow">${t('bills')}</span><b>${z.bills}</b></div><div class="li"><span class="grow">Total sales</span><b>${inr(z.total)}</b></div><div class="li"><span class="grow">Cash sales</span><b>${inr(z.cash_sales)}</b></div><div class="li"><span class="grow">UPI sales</span><b>${inr(z.upi_sales)}</b></div><div class="li"><span class="grow">Given on udhar</span><b>${inr(z.credit_given)}</b></div><div class="li"><span class="grow">Udhar cash received</span><b>${inr(z.udhar_cash)}</b></div><div class="li"><span class="grow">Cash expenses</span><b>−${inr(z.expenses_cash)}</b></div><div class="li"><span class="grow bold">${t('cash_in_hand')}</span><b class="num" style="font-size:18px">${inr(z.cash_in_hand)}</b></div></div>
    <div class="row mt"><button class="btn sec sm" onclick="window.print()">${t('print')}</button><a class="btn sm" target="_blank" rel="noopener" href="${waLink(S.me.shop.phone,`*${z.shop}* — ${t('day_end')} ${z.date}\n${t('bills')}: ${z.bills}\n${t('revenue')}: ${inr(z.total)} (${t('cash')} ${inr(z.cash_sales)}, UPI ${inr(z.upi_sales)})\n${t('m_udhar_given')}: ${inr(z.credit_given)}\n${t('expenses')}: ${inr(z.expenses)}\n*${t('cash_in_hand')}: ${inr(z.cash_in_hand)}*`)}">${t('share_whatsapp')}</a></div></div></div>
  ${isOwner()?`<div class="card"><h3>${t('export')}</h3><p class="muted small mb">Download as Excel, or open a clean PDF. Give these to your CA at month-end.</p><div class="stack">${['sales','expenses','products','customers','suppliers','ledger'].map(k=>`<div class="row wrap" style="align-items:center;gap:8px;margin-bottom:8px"><b style="min-width:92px">${k[0].toUpperCase()+k.slice(1)}</b><a class="btn sec sm" href="/api/export/${k}?format=xlsx" download>Excel</a><a class="btn sec sm" href="/api/export/${k}?format=pdf" target="_blank" rel="noopener">PDF</a></div>`).join('')}</div></div>`:''}${revoCard('reports')}`;
}
ACT.rdays=el=>{S.repDays=+el.dataset.d;render();};

/* ---------- suppliers ---------- */
async function pSuppliers(v){
  if(planLocked(await planNow().catch(()=>null),'suppliers')){v.innerHTML=head(t('suppliers'),'People you buy from')+lockCard('suppliers');return;}
  const l=(await api('/suppliers')).items;S.sup=l;
  v.innerHTML=head(t('suppliers'),'People you buy from',`<button class="btn" data-act="addsup">+ Add supplier</button>`)+`<div class="card">${l.length?`<div class="list">${l.map(s=>`<div class="li"><div class="avatar">${esc(s.name[0]||'?').toUpperCase()}</div><div class="grow"><div class="t">${esc(s.name)}</div><div class="d">${esc(s.items||'')}${s.note?' · '+esc(s.note):''}</div></div>${s.phone?`<a class="btn sec sm" href="tel:${esc(s.phone)}">Call</a><a class="btn sec sm" target="_blank" rel="noopener" href="${waLink(s.phone,t('wa_order').replace('{name}',s.name))}">WhatsApp</a>`:''}<button class="btn sec sm" data-act="editsup" data-id="${s.id}">${t('edit')}</button></div>`).join('')}</div>`:emptyBox('No suppliers yet','Save your wholesalers here so reordering is one tap.','<button class="btn" data-act="addsup">Add supplier</button>')}</div>${revoCard('stock')}`;
}
const supForm=(s={})=>`<form data-form="sup"><input type="hidden" name="id" value="${s.id||''}"><div class="f"><label>${t('name')}</label><input class="in" name="name" value="${esc(s.name||'')}" required></div><div class="f"><label>${t('phone')}</label><input class="in" name="phone" type="tel" value="${esc(s.phone||'')}"></div><div class="f"><label>What do they supply?</label><input class="in" name="items" value="${esc(s.items||'')}" placeholder="e.g. Atta, rice, oil"></div><div class="f"><label>${t('note')}</label><input class="in" name="note" value="${esc(s.note||'')}"></div><button class="btn block" type="submit">${t('save')}</button>${s.id?`<button type="button" class="link mt" style="color:var(--danger)" data-act="delsup" data-id="${s.id}">Delete supplier</button>`:''}</form>`;
ACT.addsup=()=>modal('<h2>Add supplier</h2>'+supForm());ACT.editsup=el=>modal('<h2>'+t('edit')+'</h2>'+supForm(S.sup.find(x=>String(x.id)===String(el.dataset.id))));
FORM.sup=async(f,d)=>{if(d.id)await api('/suppliers/'+d.id,'PUT',d);else await api('/suppliers','POST',d);f.closest('.ov').close();render();};
ACT.delsup=async el=>{if(!confirm('Delete this supplier?'))return;await api('/suppliers/'+el.dataset.id,'DELETE');el.closest('.ov').close();render();};

/* ---------- tasks ---------- */
async function pTasks(v){
  const l=(await api('/tasks')).items;
  v.innerHTML=head(t('tasks'),'Daily jobs for you and your staff',`<button class="btn" data-act="addtask">+ Add task</button>`)+`<div class="card">${l.length?`<div class="list">${l.map(x=>`<div class="li"><input type="checkbox" style="width:22px;height:22px" ${x.done?'checked':''} data-act="toggletask" data-id="${x.id}"><div class="grow" style="${x.done?'opacity:.5;text-decoration:line-through':''}"><div class="t">${esc(x.title)}</div><div class="d">${x.due?'Due '+x.due.slice(8)+'/'+x.due.slice(5,7):'No date'}</div></div><span class="badge ${x.priority==='high'?'red':x.priority==='low'?'gray':'amber'}">${x.priority}</span><button class="link" style="color:var(--danger)" data-act="deltask" data-id="${x.id}">✕</button></div>`).join('')}</div>`:emptyBox('No tasks','Add things like "Clean freezer" or "Call the milk supplier".','<button class="btn" data-act="addtask">Add task</button>')}</div>`;
}
ACT.addtask=()=>modal(`<h2>Add task</h2><form data-form="task"><div class="f"><label>What needs to be done?</label><input class="in" name="title" required></div><div class="frow"><div class="f"><label>Due date</label><input class="in" name="due" type="date"></div><div class="f"><label>Importance</label><select class="in" name="priority"><option value="medium">Medium</option><option value="high">High</option><option value="low">Low</option></select></div></div><button class="btn block" type="submit">${t('save')}</button></form>`);
FORM.task=async(f,d)=>{await api('/tasks','POST',d);f.closest('.ov').close();render();};
ACT.toggletask=async el=>{await api('/tasks/'+el.dataset.id,'PUT',{done:el.checked});render();};
ACT.deltask=async el=>{await api('/tasks/'+el.dataset.id,'DELETE');render();};

/* ---------- online store ---------- */
/* The store page, the public store and Orders are in v2-store.js (loaded after this file). */
async function pStore(v){ v.innerHTML=head(t('store'),t('st_sub'))+'<div class="card"><p class="muted">'+t('pub_loading')+'</p></div>'; }
async function pOrders(v){ v.innerHTML=head(t('orders'),t('ord_sub'))+'<div class="card"><p class="muted">'+t('pub_loading')+'</p></div>'; }

/* ---------- more (mobile) ---------- */
async function pMore(v){
  const items=[['bills','bills'],['reports','reports'],['expenses','expenses'],['suppliers','suppliers'],['tasks','tasks'],['store','store'],...(isOwner()?[['plans','plans'],['team','team'],['privacy','privacy'],['settings','settings']]:[])];
  // Plans (owners only) gets a navy row with a saffron label, so it stands out on the white list.
  const row=([k,i])=>k==='plans'
    ?`<a class="li plans-row" href="#/plans"><span>${ic(i).replace('<svg','<svg width="22" height="22"')}</span><span class="grow bold">${t(k)}</span>›</a>`
    :`<a class="li" href="#/${k}" style="color:inherit"><span style="color:var(--primary)">${ic(i).replace('<svg','<svg width="22" height="22"')}</span><span class="grow bold">${t(k)}</span>›</a>`;
  v.innerHTML=head(t('more'),'')+`<div class="card"><div class="list">${items.map(row).join('')}</div></div>
  <div class="card mt">${isOwner()?'':langPick('moreLang')}<button class="btn sec block" data-act="logout">${t('signout')}</button></div>`;
}
document.addEventListener('change',e=>{if(e.target.dataset&&e.target.dataset.act==='lang')ACT.lang(e.target);});
/* The one language dropdown. Choosing a language switches the whole app; it is saved on this device and on the shop. */
const langPick=id=>`<div class="f"><label for="${id}">${t('language')}</label><select class="in lang-pick" id="${id}" data-act="lang">${Object.entries(LANGS).map(([k,n])=>`<option value="${k}" ${S.lang===k?'selected':''}>${n}</option>`).join('')}</select></div>`;
ACT.lang=async el=>{const id=el.id;S.lang=el.value;localStorage.setItem('bg_lang',S.lang);api('/language','PUT',{lang:S.lang}).catch(()=>{});render();if(id)setTimeout(()=>{const n=document.getElementById(id);if(n)n.focus();},0);};

/* ---------- team ---------- */
async function pTeam(v){
  const m=(await api('/team')).members;
  v.innerHTML=head(t('team'),'Let staff use BizGrow with their own login',`<button class="btn" data-act="invite">+ Invite someone</button>`)+`<div class="card"><div class="list">${m.map(x=>`<div class="li"><div class="avatar">${esc(x.name[0]).toUpperCase()}</div><div class="grow"><div class="t">${esc(x.name)}</div><div class="d">${esc(x.email)}</div></div><span class="badge ${x.role==='owner'?'':'gray'}">${x.role}</span></div>`).join('')}</div>
  <p class="muted small mt"><b>Staff</b> can bill, take payments and see stock. <b>Manager</b> is the same. Only the <b>owner</b> sees cost prices, profit, settings and downloads.</p></div>`;
}
ACT.invite=()=>modal(`<h2>Invite someone</h2><form data-form="invite"><div class="f"><label>Their role</label><select class="in" name="role"><option value="staff">Staff (billing, stock)</option><option value="manager">Manager</option></select></div><button class="btn block" type="submit">Create invite link</button></form>`);
FORM.invite=async(f,d)=>{const r=await api('/team/invite','POST',d);const link=location.origin+'/#/join/'+r.token;f.closest('.sheet').innerHTML=`<h2>Share this link</h2><p class="muted small mb">It works once and expires in 7 days.</p><input class="in mb" readonly value="${link}" onclick="this.select()"><a class="btn block" target="_blank" rel="noopener" href="${waLink('',t('wa_join').replace('{shop}',S.me.shop.name).replace('{link}',link))}">${t('share_whatsapp')}</a>`;};

/* ---------- privacy ---------- */
async function pPrivacy(v){
  v.innerHTML=head(t('privacy'),'Your data, your control')+`<div class="grid g2"><div class="card"><h3>Download all my data</h3><p class="muted small mb">Everything BizGrow holds for your shop, as one file.</p><a class="btn" href="/api/privacy/download" download>Download</a></div>
  <div class="card"><h3>Raise a request or complaint</h3><form data-form="priv"><div class="f"><select class="in" name="kind"><option value="grievance">Complaint (grievance)</option><option value="correction">Correct my data</option><option value="access">Know what data you hold</option></select></div><div class="f"><textarea class="in" name="message" rows="3" placeholder="Tell us what happened" required></textarea></div><button class="btn" type="submit">Send</button></form></div>
  <div class="card"><h3>What we promise</h3><ul class="small" style="padding-left:18px;line-height:1.8"><li>No ads, ever</li><li>We never sell or share your customers' numbers</li><li>No loan offers or calls</li><li>You can delete everything any time</li></ul></div>
  <div class="card"><h3 style="color:var(--danger)">Delete my account</h3><p class="muted small mb">Permanently removes your shop, bills, customers and all logins. This cannot be undone.</p><button class="btn red" data-act="erase">Delete everything</button></div></div>`;
}
FORM.priv=async(f,d)=>{await api('/privacy/request','POST',d);f.reset();toast('Sent. We have recorded your request.');};
ACT.erase=()=>modal(`<h2 style="color:var(--danger)">Delete everything?</h2><p class="muted small mb">Type <b>DELETE</b> to confirm. Download your data first if you need it.</p><form data-form="erase"><div class="f"><input class="in" name="confirm" autocomplete="off"></div><button class="btn red block" type="submit">Delete permanently</button></form>`);
FORM.erase=async(f,d)=>{await api('/privacy/erase','POST',d);S.me=null;location.hash='';render();};

/* ---------- settings ---------- */
/* plans (patch-14): the shop's plan and usage come from GET /plan; the three plans from GET /plans. Wording is in v2-i18n-stage3.js. */
const planNow=()=>api('/plan');
const planName=code=>t('s3_pn_'+code);
const planLocked=(p,f)=>!!p&&!(p.features&&p.features[f]);
function lockCard(feature){return `<div class="card lock-card"><b>${t('s3_lk_title')}</b><p class="small mt">${t('s3_lk_'+feature)}</p><a class="btn sm mt" href="#/settings/plan">${t('s3_lk_btn')}</a></div>`;}
function meterHtml(p){if(p.bills_per_month==null)return '';const n=p.usage.bills,max=p.bills_per_month;const pct=Math.min(100,Math.round(n/max*100));return `<div class="mt"><div class="small">${t('s3_meter').replace('{n}',n).replace('{max}',max)}</div><div class="bar"><i style="width:${pct}%"></i></div></div>`;}
function billNotice(p){if(p.bills_per_month==null)return '';const n=p.usage.bills,max=p.bills_per_month;if(n>=max)return `<p class="small mt" style="color:#7a4a00">${t('s3_bills_limit').replace('{n}',max)}</p>`;if(n>=Math.ceil(max*0.8))return `<p class="small mt" style="color:#7a4a00">${t('s3_bills_near')}</p>`;return '';}
async function planNote(sel){const el=$(sel||'#planNote');if(!el)return;try{const p=await planNow();el.innerHTML=meterHtml(p)+billNotice(p);}catch(e){}}
async function pPlan(v){
  const [cur,list]=await Promise.all([planNow(),api('/plans')]);
  const req=cur.requested;
  const lim=n=>n==null?t('s3_unlimited'):String(n);
  const yn=b=>b?t('s3_yes'):t('s3_no');
  const rowsFor=p=>[
    [t('s3_row_bills'),p.bills_per_month==null?t('s3_unlimited'):t('s3_per_month').replace('{n}',p.bills_per_month)],
    [t('s3_row_people'),lim(p.max_people)],
    [t('s3_row_items'),lim(p.max_items)],
    [t('s3_row_store'),yn(p.features.online_store)],
    [t('s3_row_sup'),yn(p.features.suppliers)],
    [t('s3_row_rem'),yn(p.features.udhar_reminders)],
    [t('s3_row_voice'),yn(p.features.voice)],
    [t('s3_row_reports'),yn(p.features.full_reports)]
  ];
  const planCard=p=>{const isNow=p.code===cur.code;
    // Owner: the buttons (Pay first, then the manual request) are filled in by v2-billing.js, so the page never shows the manual button alone.
    const action=isNow?'':(isOwner()?`<div class="mt plan-act" data-plan-code="${esc(p.code)}"></div>`:`<p class="small muted mt">${t('s3_owner_only')}</p>`);
    return `<div class="card${isNow?' plan-now':''}"><div class="row sp"><h3 style="margin:0">${esc(planName(p.code))}</h3>${isNow?`<span class="badge amber">${t('s3_current')}</span>`:''}</div><div class="list small mt">${rowsFor(p).map(([k,val])=>`<div class="li"><span class="grow">${esc(k)}</span><b>${esc(val)}</b></div>`).join('')}</div>${action}</div>`;};
  // Opened from the sidebar or More (#/plans) there is no back link; #/settings/plan keeps its link back to Settings.
  v.innerHTML=(S.page==='plans'?'':`<a class="link" href="#/settings">← ${t('settings')}</a>`)+head(t('s3_plan_title'),t('s3_plan_sub'))+
  `<div class="card"><div class="row sp"><b>${esc(planName(cur.code))}</b><span class="badge amber">${t('s3_current')}</span></div>${meterHtml(cur)}${billNotice(cur)}</div>`+
  (req?`<div class="card mt"><p class="small">${esc(t('s3_req_sent').replace('{plan}',planName(req.to_plan)))}</p></div>`:'')+
  `<div class="plans mt" style="display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr))">${list.items.map(planCard).join('')}</div>`;
}
ACT.planreq=async el=>{try{await api('/plan/request','POST',{plan:el.dataset.plan});toast(t('s3_req_toast'));render();}catch(e){toast(e.message);}};
async function pSettings(v,args){
  if(args&&args[0]==='plan')return pPlan(v);
  const s=S.me.shop;
  const cur=s.business_type||localStorage.getItem('bg_biztype_'+s.id)||'';
  const bizOpts=[['','—'],...['textile_trader','yarn_fabric','raw_material','other'].map(k=>[k,t('s3_bt_'+k)])].map(([k,l])=>`<option value="${k}" ${cur===k?'selected':''}>${l}</option>`).join('');
  v.innerHTML=head(t('settings'),'Your shop details')+`<div class="card" style="max-width:640px">${langPick('setLang')}</div><div class="card mt" style="max-width:640px"><form data-form="settings"><div class="f"><label>${t('shop_name')}</label><input class="in" name="name" value="${esc(s.name)}" required></div>
  <div class="frow"><div class="f"><label>Shop ${t('phone').toLowerCase()}</label><input class="in" name="phone" type="tel" value="${esc(s.phone||'')}"></div></div>
  <div class="f"><label>Your UPI ID</label><input class="in" name="upi_id" value="${esc(s.upi_id||'')}" placeholder="name@bank"><div class="hint">Shown on udhar bills and reminders so customers can pay you.</div></div>
  <div class="f"><label>Address (on bills)</label><input class="in" name="address" value="${esc(s.address||'')}"></div>
  <div class="f"><label>GST number (optional)</label><input class="in" name="gstin" value="${esc(s.gstin||'')}"></div>
  <button class="btn" type="submit">${t('save')}</button></form></div><div class="card mt" style="max-width:640px"><h3>Setup questions</h3><p class="muted small mb">Change your answers about your shop any time.</p><button class="btn sec" data-act="redoob">Open setup</button></div>
  <div class="card mt" style="max-width:640px"><h3>${t('s3_biz_title')}</h3><p class="muted small mb">${t('s3_biz_sub')}</p><form data-form="biztype"><div class="f"><select class="in" name="business_type">${bizOpts}</select></div><button class="btn sec" type="submit">${t('save')}</button></form></div>
  <p class="small mt" style="max-width:640px"><a class="link" href="#/settings/plan">${t('s3_plan_link')}</a></p>`;
}
ACT.redoob=()=>onboarding();
FORM.biztype=async(f,d)=>{const v=d.business_type||'';localStorage.setItem('bg_biztype_'+S.me.shop.id,v);const r=await api('/business-type','PUT',{business_type:v});S.me=await api('/me');toast(r&&r.saved_here?t('s3_biz_local'):t('s3_biz_saved'));render();};
FORM.settings=async(f,d)=>{delete d.store_enabled;delete d.lang;const r=await api('/business','PUT',d);S.me=await api('/me');toast((r&&r.warning)||'Saved');render();};

window.BGV2={ACT,FORM,S,api,render,toast,isOwner:()=>isOwner(),esc,inr,t,head,modal,go,lockCard,planNow,planLocked};
document.addEventListener('DOMContentLoaded',()=>{if(window.BGV2&&BGV2.publicStore&&BGV2.publicStore())return;boot();});
if('serviceWorker' in navigator)addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));
})();
