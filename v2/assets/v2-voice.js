/* BizGrow v2: the voice bill. Mic card on Home, a confirm sheet, and the assistant rename.
   A bill is never saved straight from speech. The member always taps Save on the confirm sheet.
   Listening: the assistant says hello (unless muted or the browser cannot speak), then the browser
   listens with interim results. It restarts itself while nothing is heard, and stops when the member
   taps the mic again or the speaker pauses after words. The typed box is always there as a fallback. */
(function () {
  'use strict';
  var B = window.BGV2; if (!B) return;
  var LOC = { en: 'en-IN', hi: 'hi-IN', mr: 'mr-IN', gu: 'gu-IN' };
  var MAXLINES = 30;
  var MUTE_KEY = 'bg_v2_voice_mute';
  var MIC = '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';

  // Plain messages for the helper. English is the fallback.
  var VT = {
    en: {
      greet: 'Yes? Speak.', bolo: 'Listening… bolo',
      allow: 'Allow the microphone when the browser asks, then speak.',
      denied: 'The microphone is blocked for this site. Allow it in the browser settings, then tap the mic again.',
      nomic: 'No microphone was found on this device. Type instead.',
      net: 'Voice needs an internet connection. Type instead.',
      nosound: 'I did not hear anything. Tap the mic and speak again.',
      noapi: 'Voice does not work in this browser. Type instead.',
      failed: 'Voice stopped. Tap the mic to try again, or type instead.',
      checking: 'Checking what you said…', retry: 'Online voice did not work. Speak again.',
      mute_on: 'Hello sound: on (tap to mute)', mute_off: 'Hello sound: muted (tap to turn on)'
    },
    hi: {
      greet: 'बोलिए?', bolo: 'Listening… bolo',
      allow: 'ब्राउज़र पूछे तो माइक्रोफ़ोन की अनुमति दें, फिर बोलें।',
      denied: 'इस साइट के लिए माइक्रोफ़ोन बंद है। ब्राउज़र की सेटिंग में अनुमति दें, फिर माइक दबाएं।',
      nomic: 'इस फ़ोन या लैपटॉप पर माइक्रोफ़ोन नहीं मिला। लिखकर बताएं।',
      net: 'आवाज़ के लिए इंटरनेट चाहिए। लिखकर बताएं।',
      nosound: 'कुछ सुनाई नहीं दिया। माइक दबाकर फिर बोलें।',
      noapi: 'इस ब्राउज़र में आवाज़ काम नहीं करती। लिखकर बताएं।',
      failed: 'आवाज़ रुक गई। माइक दबाकर फिर कोशिश करें, या लिखकर बताएं।',
      checking: 'आपकी बात जांची जा रही है…', retry: 'ऑनलाइन आवाज़ नहीं चली। फिर से बोलें।',
      mute_on: 'नमस्ते की आवाज़: चालू (बंद करने के लिए दबाएं)', mute_off: 'नमस्ते की आवाज़: बंद (चालू करने के लिए दबाएं)'
    },
    mr: {
      greet: 'बोला?', bolo: 'ऐकत आहे… बोला',
      allow: 'ब्राउझर विचारल्यावर मायक्रोफोनला परवानगी द्या, मग बोला.',
      denied: 'या साइटसाठी मायक्रोफोन बंद आहे. ब्राउझरच्या सेटिंगमध्ये परवानगी द्या, मग पुन्हा माइक दाबा.',
      nomic: 'या फोनवर मायक्रोफोन सापडला नाही. लिहून सांगा.',
      net: 'आवाजासाठी इंटरनेट लागते. लिहून सांगा.',
      nosound: 'काही ऐकू आले नाही. माइक दाबा आणि पुन्हा बोला.',
      noapi: 'या ब्राउझरमध्ये आवाज चालत नाही. लिहून सांगा.',
      failed: 'आवाज थांबला. माइक दाबून पुन्हा प्रयत्न करा, किंवा लिहून सांगा.',
      checking: 'तुम्ही काय सांगितले ते तपासत आहे…', retry: 'ऑनलाइन आवाज चालली नाही. पुन्हा बोला.',
      mute_on: 'स्वागत आवाज: चालू (बंद करण्यासाठी दाबा)', mute_off: 'स्वागत आवाज: बंद (चालू करण्यासाठी दाबा)'
    },
    gu: {
      greet: 'બોલો?', bolo: 'સાંભળી રહ્યો છું… બોલો',
      allow: 'બ્રાઉઝર પૂછે ત્યારે માઇક્રોફોનની પરવાનગી આપો, પછી બોલો.',
      denied: 'આ સાઇટ માટે માઇક્રોફોન બંધ છે. બ્રાઉઝરની સેટિંગમાં પરવાનગી આપો, પછી માઇક ફરી દબાવો.',
      nomic: 'આ ફોન કે લેપટોપમાં માઇક્રોફોન મળ્યો નથી. લખીને કહો.',
      net: 'અવાજ માટે ઇન્ટરનેટ જોઈએ. લખીને કહો.',
      nosound: 'કંઈ સંભળાયું નહીં. માઇક દબાવીને ફરી બોલો.',
      noapi: 'આ બ્રાઉઝરમાં અવાજ ચાલતો નથી. લખીને કહો.',
      failed: 'અવાજ બંધ થયો. ફરી માઇક દબાવો, અથવા લખીને કહો.',
      checking: 'તમે જે કહ્યું તે તપાસું છું…', retry: 'ઓનલાઈન અવાજ ચાલ્યો નહીં. ફરી બોલો.',
      mute_on: 'સ્વાગત અવાજ: ચાલુ (બંધ કરવા દબાવો)', mute_off: 'સ્વાગત અવાજ: બંધ (ચાલુ કરવા દબાવો)'
    }
  };

  function esc(s) { return B.esc(s); }
  function speechClass() { return window.SpeechRecognition || window.webkitSpeechRecognition || null; }
  function $(id) { return document.getElementById(id); }
  function vt(k, vars) {
    var d = VT[voiceLang()] || VT.en;
    var s = d[k] || VT.en[k] || '';
    if (vars) Object.keys(vars).forEach(function (n) { s = s.split('{' + n + '}').join(vars[n]); });
    return s;
  }
  function isCode(c) { return typeof c === 'string' && Object.prototype.hasOwnProperty.call(LOC, c); }
  // Chotu speaks the app language. The member picks that once, in Settings.
  function voiceLang() {
    return isCode(B.S.lang) ? B.S.lang : 'en';
  }
  function langOf() { return LOC[voiceLang()] || 'en-IN'; }
  function canSpeak() { return !!(window.speechSynthesis && typeof window.SpeechSynthesisUtterance === 'function'); }
  function clearSpeech() { try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) { /* nothing to stop */ } }
  function focusType() { var ti = $('v2-type'); if (ti) ti.focus(); }

  var MUTE_MEM = null;
  function isMuted() {
    if (MUTE_MEM !== null) return MUTE_MEM;
    try { return localStorage.getItem(MUTE_KEY) === '1'; } catch (e) { return false; }
  }
  function setMuted(v) {
    MUTE_MEM = !!v;
    try { localStorage.setItem(MUTE_KEY, v ? '1' : '0'); } catch (e) { /* storage blocked: the choice lasts for this visit */ }
  }
  function muteLabel() { return vt(isMuted() ? 'mute_off' : 'mute_on'); }


  // Home card, shown to anyone who can make a bill.
  B.on('home', function (v) {
    if (v.querySelector('.v2-voice') || !B.can('sale')) return;
    var rename = B.can('settings') ? '<button class="linkbtn" data-v2="rename">' + esc(B.tx('v2_chotu_title')) + '</button>' : '';
    B.placeTop(v,
      '<section class="card v2-voice">' +
      '<h2>' + esc(B.tx('v2_voice_title', { name: B.assistant() })) + '</h2>' +
      '<p class="muted small">' + esc(B.tx('v2_voice_hint')) + '</p>' +
      '<button class="v2-mic" data-v2="mic" aria-pressed="false">' + MIC + '<span>' + esc(B.tx('v2_mic')) + '</span></button>' +
      '<div class="v2-type"><input class="in" id="v2-type" maxlength="200" placeholder="' + esc(B.tx('v2_type_here')) + '">' +
      '<button class="btn" data-v2="check">' + esc(B.tx('v2_check')) + '</button></div>' +
      '<p class="v2-msg" id="v2-voice-msg" role="status"></p>' +
      '<button class="linkbtn v2-mute" data-v2="mute" aria-pressed="' + (isMuted() ? 'true' : 'false') + '">' + esc(muteLabel()) + '</button>' +
      '<p class="muted small">' + esc(B.tx('v2_try')) + ': <i>"Ramesh ko 2 kg atta, 50 rupees udhar"</i></p>' +
      rename + '</section>');
  });

  function msg(t) { var m = $('v2-voice-msg'); if (m) m.textContent = t || ''; }

  // ---- listening ----
  // run.rec is the one live recognition object. It is kept here so the browser does not lose it.
  // Every callback checks that it is still the current one, so an old session cannot change the screen.
  var run = { on: false, stopping: false, id: 0, rec: null, finals: '', interim: '', empty: 0, err: '', timer: null, mode: 'browser' };

  function paintMic(on) {
    var b = document.querySelector('[data-v2="mic"]'); if (!b) return;
    b.classList.toggle('on', !!on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    var sp = b.querySelector('span'); if (sp) sp.textContent = on ? vt('bolo') : B.tx('v2_mic');
  }

  // Pick a voice for the language if one is installed. If none is, the browser's default is used with the language set.
  function pickVoice(lang) {
    var list = [];
    try { list = window.speechSynthesis.getVoices() || []; } catch (e) { list = []; }
    var l = lang.toLowerCase(), base = l.split('-')[0], i;
    for (i = 0; i < list.length; i++) if ((list[i].lang || '').toLowerCase() === l) return list[i];
    for (i = 0; i < list.length; i++) if ((list[i].lang || '').toLowerCase().indexOf(base) === 0) return list[i];
    return null;
  }

  // Say the greeting, then call done once. Done also runs if speech fails or never ends.
  function speak(text, done) {
    var S = window.speechSynthesis, U = window.SpeechSynthesisUtterance;
    var fin = false, timer = null;
    function end() { if (fin) return; fin = true; clearTimeout(timer); done(); }
    if (!canSpeak()) { end(); return; }
    try {
      S.cancel();
      var u = new U(text);
      u.lang = langOf(); u.rate = 0.95; u.pitch = 1; u.volume = 1;
      var v = pickVoice(u.lang); if (v) u.voice = v;
      u.onend = end; u.onerror = end;
      timer = setTimeout(function () { clearSpeech(); end(); }, 8000);
      S.speak(u);
    } catch (e) { end(); }
  }

  // Ask the browser whether the microphone is already allowed, blocked or still to be asked. Unknown counts as allowed.
  function permState(cb) {
    try {
      if (navigator.permissions && navigator.permissions.query) {
        navigator.permissions.query({ name: 'microphone' }).then(function (p) { cb(p.state); }, function () { cb(''); });
        return;
      }
    } catch (e) { /* fall through */ }
    cb('');
  }

  function stopWith(key) {
    clearTimeout(run.timer); run.timer = null;
    run.on = false; run.stopping = false; run.rec = null;
    paintMic(false); clearSpeech(); msg(vt(key));
    if (key === 'nomic' || key === 'noapi') focusType();
  }

  // Turn what was heard into the text box and check it as a bill. Nothing is saved here.
  function finishRun() {
    clearTimeout(run.timer); run.timer = null;
    var text = (run.finals || run.interim || '').trim();
    run.on = false; run.stopping = false; run.rec = null; run.finals = ''; run.interim = '';
    paintMic(false);
    if (!text) { msg(vt('nosound')); return; }
    var box = $('v2-type'); if (box) box.value = text;
    msg('');
    review(text);
  }

  // The member tapped the mic again. Let the browser finish the last words, then check them.
  function stopUser() {
    if (!run.on) return;
    run.on = false; paintMic(false); clearSpeech();
    var r = run.rec;
    if (!r) { msg(''); return; }
    run.stopping = true;
    try { r.stop(); } catch (e) { run.stopping = false; run.rec = null; finishRun(); return; }
    run.timer = setTimeout(function () { run.rec = null; finishRun(); }, 1500);
  }

  function startRec(id) {
    if (!run.on || id !== run.id) return;
    var R = speechClass();
    if (!R) { stopWith('noapi'); return; }
    var r;
    try { r = new R(); } catch (e) { stopWith('noapi'); return; }
    r.lang = langOf(); r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
    run.rec = r; run.err = '';
    r.onstart = function () { if (run.rec === r) msg(vt('bolo')); };
    r.onresult = function (ev) {
      if (run.rec !== r) return;
      var fin = '', mid = '';
      for (var i = ev.resultIndex || 0; i < ev.results.length; i++) {
        var res = ev.results[i], tr = (res && res[0] && res[0].transcript) || '';
        if (res.isFinal) fin += tr + ' '; else mid += tr;
      }
      if (fin.trim()) { run.finals = (run.finals + ' ' + fin).trim(); run.empty = 0; }
      run.interim = mid.trim();
      var box = $('v2-type'); if (box) box.value = (run.finals + ' ' + run.interim).trim();
    };
    r.onerror = function (ev) { if (run.rec === r) run.err = (ev && ev.error) || 'failed'; };
    r.onend = function () {
      if (run.rec !== r) return;
      run.rec = null;
      var k = run.err; run.err = '';
      if (run.stopping) { finishRun(); return; }
      if (!run.on) return;
      if (run.finals || run.interim) { finishRun(); return; }   // the speaker paused after words: check them
      if (k === 'not-allowed' || k === 'service-not-allowed') { stopWith('denied'); return; }
      if (k === 'audio-capture') { stopWith('nomic'); return; }
      if (k === 'network') { stopWith('net'); return; }
      if (k === 'no-speech' || k === '' || k === 'aborted') {
        run.empty++;
        if (run.empty < 3) { startRec(run.id); return; }   // keep listening a little longer
        stopWith('nosound'); return;
      }
      stopWith('failed');
    };
    permState(function (state) {
      if (run.rec !== r || !run.on) return;
      if (state === 'denied') { run.rec = null; stopWith('denied'); return; }
      msg(state === 'prompt' ? vt('allow') : vt('bolo'));
      try { r.start(); } catch (e) { run.rec = null; stopWith('failed'); }
    });
  }

  // ---- online recognition (through the Worker to the speech service) ----
  // One short clip is recorded with MediaRecorder, sent to /api/voice/transcribe, and checked like typed words.
  // When voice online is off, the browser cannot record, or the call fails, the browser recognition above takes over.
  // The speech key is never in this page. The request goes to the original fetch, not the demo stand-in.
  var sv = { state: null, mr: null, stream: null, chunks: [], timer: null, busy: false };   // state: null unknown, true or false
  var MAX_REC_MS = 25000;
  function recordOK() { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder); }
  function apiFetch() { return window.BGV2_fetch || window.fetch.bind(window); }
  function stopTracks(s) { try { if (s) s.getTracks().forEach(function (t) { t.stop(); }); } catch (e) { /* already stopped */ } }

  // Asks the Worker once whether voice online is on. Any problem counts as off, and the browser recognition is used.
  function checkOnline() {
    // Opened as a local file, there is no Worker to ask, so voice online stays off without a failed call.
    if (!recordOK() || location.protocol === 'file:') { sv.state = false; return; }
    apiFetch()('/api/voice/config', { method: 'GET', credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { sv.state = !!(d && d.enabled === true); }, function () { sv.state = false; });
  }

  function pickType() {
    var list = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    try {
      if (!window.MediaRecorder || !window.MediaRecorder.isTypeSupported) return '';
      for (var i = 0; i < list.length; i++) if (window.MediaRecorder.isTypeSupported(list[i])) return list[i];
    } catch (e) { /* use the browser default */ }
    return '';
  }

  // Product names help the speech service with odd words. Customer names are never sent.
  function productTerms() {
    var out = [], seen = {};
    (B.S.products || []).forEach(function (p) {
      var n = String((p && p.name) || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 64);
      if (n && !seen[n] && out.length < 50) { seen[n] = true; out.push(n); }
    });
    return out;
  }

  function endRun() {
    clearTimeout(run.timer); run.timer = null;
    run.on = false; run.stopping = false; run.rec = null; run.finals = ''; run.interim = '';
    paintMic(false);
  }

  // The browser recognition takes over after an online failure. The member speaks again.
  // The member may already have tapped the mic off while the clip was checked (stopOnline clears run.on),
  // so the listening state is set again here; otherwise the failed check would leave "Checking" on screen.
  function fallbackBrowser(id) {
    if (id !== run.id) return;   // the member left the page or started again
    run.mode = 'browser';
    if (!speechClass()) { stopWith('failed'); return; }
    if (!run.on) { run.on = true; run.stopping = false; run.finals = ''; run.interim = ''; run.empty = 0; paintMic(true); }
    msg(vt('retry'));
    startRec(id);
  }

  function startOnline(id) {
    if (!run.on || id !== run.id) return;
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      if (!run.on || id !== run.id) { stopTracks(stream); return; }
      var mr, type = pickType();
      try { mr = type ? new window.MediaRecorder(stream, { mimeType: type }) : new window.MediaRecorder(stream); }
      catch (e) { stopTracks(stream); fallbackBrowser(id); return; }
      sv.stream = stream; sv.mr = mr; sv.chunks = [];
      mr.ondataavailable = function (ev) { if (ev && ev.data && ev.data.size) sv.chunks.push(ev.data); };
      mr.onstop = function () { onOnlineStop(id, mr); };
      try { mr.start(); } catch (e) { sv.mr = null; stopTracks(stream); sv.stream = null; fallbackBrowser(id); return; }
      msg(vt('bolo'));
      sv.timer = setTimeout(stopOnline, MAX_REC_MS);
    }, function () { fallbackBrowser(id); });
  }

  // The member tapped the mic again, or the clip reached its time limit. Stops the recording and checks it.
  function stopOnline() {
    clearTimeout(sv.timer); sv.timer = null;
    if (!run.on) return;
    run.on = false; paintMic(false);
    var mr = sv.mr;
    if (!mr) { msg(''); return; }
    try { mr.stop(); } catch (e) { sv.mr = null; stopTracks(sv.stream); sv.stream = null; msg(vt('nosound')); }
  }

  function onOnlineStop(id, mr) {
    var chunks = sv.chunks; sv.chunks = []; sv.mr = null;
    stopTracks(sv.stream); sv.stream = null;
    if (id !== run.id) return;   // the member left the page or started again
    var type = (mr && mr.mimeType) || (chunks[0] && chunks[0].type) || 'audio/webm';
    var blob = new Blob(chunks, { type: type });
    if (blob.size < 1000) { endRun(); msg(vt('nosound')); return; }
    msg(vt('checking'));
    sendOnline(blob, type, id);
  }

  function sendOnline(blob, type, id) {
    sv.busy = true;
    var fd = new FormData();
    var ext = type.indexOf('mp4') >= 0 ? 'mp4' : (type.indexOf('ogg') >= 0 ? 'ogg' : 'webm');
    fd.append('audio', blob, 'speech.' + ext);
    fd.append('language', langOf());
    fd.append('keyterms', JSON.stringify(productTerms()));
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 25000);
    apiFetch()('/api/voice/transcribe', { method: 'POST', body: fd, credentials: 'same-origin', signal: ctl ? ctl.signal : undefined })
      .then(function (r) { return r.json().catch(function () { return null; }).then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (x) {
        clearTimeout(timer); sv.busy = false;
        if (id !== run.id) return;
        var d = x.d || {};
        var tr = x.ok && d.ok === true && typeof d.transcript === 'string' ? d.transcript.trim() : '';
        if (tr) { endRun(); var box = $('v2-type'); if (box) box.value = tr; msg(''); review(tr); return; }
        if (d.code === 'empty') { endRun(); msg(vt('nosound')); return; }
        fallbackBrowser(id);
      }, function () { clearTimeout(timer); sv.busy = false; fallbackBrowser(id); });
  }

  function listen() {
    if (run.on) { if (run.mode === 'sarvam') stopOnline(); else stopUser(); return; }
    var online = sv.state === true && recordOK();
    if (!online && !speechClass()) { msg(vt('noapi')); focusType(); return; }
    if (run.rec) { var old = run.rec; run.rec = null; try { old.abort(); } catch (e) { /* already ended */ } }
    clearTimeout(run.timer); run.timer = null;
    run.id++; run.on = true; run.stopping = false; run.finals = ''; run.interim = ''; run.empty = 0; run.err = '';
    run.mode = online ? 'sarvam' : 'browser';
    paintMic(true);
    var id = run.id;
    var go = function () { if (run.mode === 'sarvam') startOnline(id); else startRec(id); };
    if (isMuted() || !canSpeak()) { msg(''); go(); return; }
    var hello = vt('greet', { name: B.assistant() });
    msg(hello);
    // The greeting ends first, so the microphone does not hear the assistant's own voice.
    speak(hello, go);
  }

  // Leaving the page ends any listening, recording, or pending check.
  window.addEventListener('hashchange', function () {
    if (!run.on && !run.rec && !sv.busy && !sv.mr) return;
    run.id++; run.on = false; run.stopping = false;
    var r = run.rec; run.rec = null; clearTimeout(run.timer); run.timer = null;
    if (r) { try { r.abort(); } catch (e) { /* already ended */ } }
    clearTimeout(sv.timer); sv.timer = null;
    if (sv.mr) { var m = sv.mr; sv.mr = null; try { m.stop(); } catch (e) { /* already stopped */ } }
    stopTracks(sv.stream); sv.stream = null; sv.chunks = [];
    clearSpeech();
  });

  checkOnline();

  // Turn the words into a bill to check. Nothing is saved here.
  async function review(txt) {
    txt = String(txt || '').trim();
    if (!B.can('sale')) { msg(B.tx('v2_view_only')); return; }
    if (!txt) { msg(B.tx('v2_nothing')); return; }
    if (!B.S.products || !B.S.products.length || !B.S.customers || !B.S.customers.length) { try { await B.refresh(); } catch (e) { /* use what we have */ } }
    var p = B.parse(txt);
    if (!p.lines.length) { msg(B.tx('v2_nothing')); return; }
    if (p.lines.length > MAXLINES) { msg(B.tx('v2_too_many')); return; }
    openConfirm(p);
  }
  B.voiceReview = review;

  // ---- confirm sheet ----
  function openConfirm(p) {
    var st = {
      heard: p.heard, amount: p.amount, date: B.today(), more: false, override: false,
      method: p.method || 'cash', party: p.party.status === 'one' ? p.party.customer : null,
      choosing: p.party.status === 'choose', options: p.party.options || [],
      lines: p.lines.map(function (l) { return { product_id: l.product_id, name: l.name, stock: l.stock, qty: String(l.qty), price: String(l.price) }; })
    };
    if (st.method === 'udhar' && !st.party) st.choosing = true;
    var o = B.modal('<div class="v2-cf"></div>');
    var sheet = o.querySelector('.v2-cf');
    function paint() { sheet.innerHTML = html(st); refresh(); }
    o.addEventListener('click', function (e) {
      var el = e.target.closest('[data-vc]'); if (!el) return;
      var k = el.getAttribute('data-vc');
      if (k === 'cancel') { o.close(); return; }
      if (k === 'party') { var id = +el.getAttribute('data-id'); st.party = id ? st.options.filter(function (c) { return c.id === id; })[0] : null; st.choosing = false; paint(); return; }
      if (k === 'change') { st.choosing = true; paint(); return; }
      if (k === 'method') { st.method = el.getAttribute('data-m'); if (st.method === 'udhar' && !st.party) st.choosing = true; if (st.method !== 'udhar' && st.choosing && !st.party) st.choosing = false; paint(); return; }
      if (k === 'more') { st.more = !st.more; paint(); return; }
      if (k === 'rm') { st.lines.splice(+el.getAttribute('data-i'), 1); paint(); return; }
      if (k === 'save') { save(o, st); return; }
    });
    o.addEventListener('input', function (e) {
      var el = e.target; var k = el.getAttribute && el.getAttribute('data-vc');
      if (k === 'qty' || k === 'price') { st.lines[+el.getAttribute('data-i')][k] = el.value; refresh(); }
      if (k === 'date') { st.date = el.value; refresh(); }
      if (k === 'override') { st.override = el.checked; refresh(); }
    });
    function totalOf() {
      return st.lines.reduce(function (s, l) { var q = B.vnum(l.qty), pr = B.vnum(l.price, { zero: true }); return s + (q.ok && pr.ok ? q.n * pr.n : 0); }, 0);
    }
    // Problems that stop Save. Returns a message or ''.
    function problem() {
      if (!st.lines.length) return B.tx('v2_need_line');
      if (st.lines.length > MAXLINES) return B.tx('v2_too_many');
      for (var i = 0; i < st.lines.length; i++) {
        var l = st.lines[i];
        if (!B.vnum(l.qty).ok) return l.name + ': ' + B.tx('v2_num_err');
        if (!B.vnum(l.price, { zero: true }).ok) return l.name + ': ' + B.tx('v2_num_err');
      }
      if (st.method === 'udhar' && !st.party) return B.tx('v2_which_party');
      var short = shortLines(st);
      if (short.length && !(st.override && B.can('stock_override'))) return B.tx('v2_short', { name: short[0].name, stock: B.qn(short[0].stock) });
      if (st.date > B.today()) return B.tx('v2_date_future');
      return '';
    }
    function refresh() {
      var sum = sheet.querySelector('.v2-cf-sum'); if (!sum) return;
      var pr = problem(); var tot = totalOf();
      sum.innerHTML = '<div class="v2-total"><span>' + esc(B.tx('v2_total')) + '</span><b>' + esc(B.inr(tot)) + '</b></div>' +
        (st.amount != null && Math.round(st.amount) !== Math.round(tot) ? '<p class="muted small">' + esc(B.tx('v2_said_amount', { amount: B.inr(st.amount) })) + '</p>' : '') +
        (pr ? '<p class="v2-err" role="alert">' + esc(pr) + '</p>' : '') +
        '<p class="v2-err" id="v2-cf-err"></p>';
      var btn = sheet.querySelector('[data-vc="save"]'); if (btn) btn.disabled = !!pr;
    }
    paint();
    st.paintFn = paint;
    B.cfState = st;
    return o;
  }

  function shortLines(st) {
    return st.lines.filter(function (l) { var q = B.vnum(l.qty); return q.ok && l.product_id && l.stock != null && q.n > l.stock; });
  }

  function html(st) {
    var h = '<h2>' + esc(B.tx('v2_check_title')) + '</h2>';
    h += '<p class="muted small">' + esc(B.tx('v2_heard')) + ': <i>"' + esc(st.heard) + '"</i></p>';
    // Party
    if (st.choosing) {
      h += '<p class="bold">' + esc(B.tx('v2_which_party')) + '</p><div class="v2-party">';
      st.options.slice(0, 8).forEach(function (c) { h += '<button class="btn sec" data-vc="party" data-id="' + c.id + '">' + esc(c.name) + '</button>'; });
      if (st.method !== 'udhar') h += '<button class="btn sec" data-vc="party" data-id="0">' + esc(B.tx('v2_cash_customer')) + '</button>';
      h += '</div>';
    } else {
      h += '<div class="v2-for"><div><span class="muted small">' + esc(B.tx('v2_for')) + '</span><div class="bold">' +
        esc(st.party ? st.party.name : B.tx('v2_cash_customer')) + '</div></div><button class="linkbtn" data-vc="change">' + esc(B.tx('v2_change')) + '</button></div>';
    }
    // Lines
    h += '<div class="v2-lines">';
    st.lines.forEach(function (l, i) {
      var short = l.product_id && l.stock != null && (B.vnum(l.qty).ok ? B.vnum(l.qty).n : 0) > l.stock;
      h += '<div class="v2-line"><div class="grow"><b>' + esc(l.name) + '</b>' +
        (short ? '<small class="v2-err">' + esc(B.tx('v2_stock_left', { stock: B.qn(l.stock) })) + '</small>' : '') + '</div>' +
        '<label class="v2-f">' + esc(B.tx('v2_qty')) + '<input class="in" inputmode="decimal" data-vc="qty" data-i="' + i + '" value="' + esc(l.qty) + '"></label>' +
        '<label class="v2-f">' + esc(B.tx('v2_price')) + '<input class="in" inputmode="decimal" data-vc="price" data-i="' + i + '" value="' + esc(l.price) + '"></label>' +
        '<button class="iconbtn" data-vc="rm" data-i="' + i + '" aria-label="' + esc(B.tx('v2_remove')) + '">&times;</button></div>';
    });
    h += '</div>';
    h += '<div class="v2-cf-sum"></div>';
    // How paid
    h += '<div class="v2-how">';
    [['cash', 'v2_cash'], ['upi', 'v2_upi'], ['udhar', 'v2_udhar']].forEach(function (m) {
      h += '<button class="btn ' + (st.method === m[0] ? '' : 'sec') + '" data-vc="method" data-m="' + m[0] + '">' + esc(B.tx(m[1])) + '</button>';
    });
    h += '</div>';
    // More options: back-date and owner stock override are hidden here
    h += '<button class="linkbtn" data-vc="more">' + esc(B.tx('v2_more')) + (st.more ? ' ▲' : ' ▼') + '</button>';
    if (st.more) {
      h += '<div class="v2-more">';
      if (B.can('backdate')) h += '<label class="f">' + esc(B.tx('v2_bill_date')) + '<input class="in" type="date" data-vc="date" max="' + B.today() + '" value="' + esc(st.date) + '"></label>';
      if (B.can('stock_override') && shortLines(st).length) h += '<label class="v2-check"><input type="checkbox" data-vc="override"' + (st.override ? ' checked' : '') + '> ' + esc(B.tx('v2_allow_neg')) + '</label>';
      h += '</div>';
    }
    h += '<button class="btn big block" data-vc="save">' + esc(B.tx('v2_save_bill')) + '</button>';
    h += '<button class="btn sec block" data-vc="cancel">' + esc(B.tx('v2_cancel')) + '</button>';
    return h;
  }

  async function save(o, st) {
    var body = {
      items: st.lines.map(function (l) { return { product_id: l.product_id, name: l.name, price: B.vnum(l.price, { zero: true }).n, qty: B.vnum(l.qty).n }; }),
      method: st.method
    };
    if (st.method === 'udhar' && st.party) body.customer_id = st.party.id;
    if (st.date && st.date !== B.today()) body.date = st.date;
    if (st.override && B.can('stock_override')) body.stock_override = true;
    try {
      await B.api('/sales', 'POST', body);
      o.close(); B.toast(B.tx('v2_saved'));
      await B.refresh(); B.render();
    } catch (e) {
      var err = o.querySelector('#v2-cf-err'); if (err) err.textContent = e.message || B.tx('v2_forbidden');
    }
  }

  // Rename the helper (owner only). Default name stays Chotu.
  function rename() {
    var o = B.modal('<h2>' + esc(B.tx('v2_chotu_title')) + '</h2><p class="muted small mb">' + esc(B.tx('v2_chotu_sub')) +
      '</p><div class="f"><label>' + esc(B.tx('v2_name')) + '</label><input class="in" id="v2-rn" maxlength="20" value="' + esc(B.assistant()) + '"></div>' +
      '<p class="v2-err" id="v2-rn-msg"></p><button class="btn big block" data-v2="rename-save">' + esc(B.tx('v2_chotu_save')) + '</button>');
    return o;
  }
  document.addEventListener('click', async function (e) {
    var el = e.target.closest && e.target.closest('[data-v2]'); if (!el) return;
    var k = el.getAttribute('data-v2');
    if (k === 'mic') return listen();
    if (k === 'mute') {
      setMuted(!isMuted());
      if (isMuted()) clearSpeech();
      el.textContent = muteLabel();
      el.setAttribute('aria-pressed', isMuted() ? 'true' : 'false');
      return;
    }
    if (k === 'check') return review(($('v2-type') || {}).value);
    if (k === 'rename') return rename();
    if (k === 'rename-save') {
      var name = (($('v2-rn') || {}).value || '').trim();
      var r = B.vtext(name, 20, 'v2_name_req');
      if (!r.ok) { $('v2-rn-msg').textContent = r.msg; return; }
      try {
        await B.api('/v2/settings', 'PUT', { assistant_name: name });
        B.S.me.shop.assistant_name = name;
        el.closest('.ov').close(); B.toast(B.tx('v2_saved')); B.render();
      } catch (err) { $('v2-rn-msg').textContent = err.message || B.tx('v2_forbidden'); }
    }
  });
})();
