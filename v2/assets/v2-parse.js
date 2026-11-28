/* BizGrow v2: reads a spoken or typed bill line in English, Hindi, Marathi, Gujarati or Hinglish,
   for example "Ramesh ko 2 kg atta, 50 rupees udhar".
   Words written in Devanagari or Gujarati script are turned into Latin letters first. Each word is then
   matched by spelling (edit distance) and by a rough sound key, so common mis-hearings still find the item.
   It is free: no paid service is used. It never saves anything; the caller decides what to do. */
(function () {
  'use strict';
  var B = window.BGV2; if (!B) return;

  // ---------- script to Latin letters ----------
  var CONS = 'k kh g gh n ch chh j jh n t th d dh n t th d dh n n p ph b bh m y r r l l l v sh sh s h'.split(' ');
  var NUKTA = ['k', 'kh', 'g', 'z', 'r', 'rh', 'f', 'y'];
  var VOW = 'a a aa i ii u uu ri l e e e ai o o o au'.split(' ');
  var MATRA = 'aa i ii u uu ri rr e e e ai o o o au'.split(' ');
  function isCons(cp) { return (cp >= 0x915 && cp <= 0x939) || (cp >= 0x958 && cp <= 0x95F); }
  function consRoman(cp) { return cp >= 0x958 ? NUKTA[cp - 0x958] : CONS[cp - 0x915]; }

  // Turns Devanagari, Gujarati and plain text into lower case Latin letters and digits.
  function toRoman(s) {
    s = String(s || '');
    var t = '', i, cp, out = '', nx;
    for (i = 0; i < s.length; i++) {
      cp = s.charCodeAt(i);
      if (cp >= 0x0A80 && cp <= 0x0AFF) cp -= 0x180; // Gujarati letters and digits sit at the same spots as Devanagari
      t += String.fromCharCode(cp);
    }
    for (i = 0; i < t.length; i++) {
      cp = t.charCodeAt(i);
      if (isCons(cp)) {
        out += consRoman(cp);
        nx = i + 1 < t.length ? t.charCodeAt(i + 1) : 0;
        if (nx === 0x94D) { i++; }                                   // virama: no vowel
        else if (nx >= 0x93E && nx <= 0x94C) { out += MATRA[nx - 0x93E]; i++; }
        else if (nx && (isCons(nx) || (nx >= 0x904 && nx <= 0x914) || nx === 0x902 || nx === 0x901)) { out += 'a'; }
        // a consonant at the end of a word has no spoken vowel, so none is added
      } else if (cp >= 0x904 && cp <= 0x914) out += VOW[cp - 0x904];
      else if (cp === 0x902 || cp === 0x901) out += 'n';
      else if (cp === 0x903) out += 'h';
      else if (cp >= 0x93E && cp <= 0x94C) out += MATRA[cp - 0x93E];
      else if (cp >= 0x966 && cp <= 0x96F) out += String(cp - 0x966);
      else if (cp < 128 && /[a-zA-Z0-9]/.test(String.fromCharCode(cp))) out += String.fromCharCode(cp).toLowerCase();
    }
    return out;
  }

  // Rough sound key: drops vowels and merges look-alike letters (ch/sh/s, t/d, v/b, r/l, f/p, c/k).
  // "udhar", "udaar", "uddhar" all give "dl"; "chini", "cheeni" both give "sn".
  function skel(r) {
    var s = String(r || '').replace(/[^a-z]/g, '');
    s = s.replace(/chh|ch|sh/g, 's').replace(/c(?=[eiy])/g, 's').replace(/c|q/g, 'k').replace(/kh/g, 'k')
      .replace(/ph|f/g, 'p').replace(/th|dh|t|d/g, 'd').replace(/bh|v|w|b/g, 'b').replace(/gh/g, 'g')
      .replace(/jh|z|j/g, 'j').replace(/x/g, 'ks').replace(/r/g, 'l').replace(/h/g, '')
      .replace(/[aeiouy]/g, '').replace(/(.)\1+/g, '$1');
    return s;
  }

  // Edit distance between two strings.
  function lev(a, b) {
    if (a === b) return 0;
    var m = a.length, n = b.length, i, j, prev = [], cur = [], t;
    if (!m) return n; if (!n) return m;
    for (j = 0; j <= n; j++) prev[j] = j;
    for (i = 1; i <= m; i++) {
      cur[0] = i;
      for (j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
      }
      t = prev; prev = cur; cur = t;
    }
    return prev[n];
  }

  // How well a heard word matches a name word: 1 exact, 0.9 same sound, 0.85 minus 0.15 per letter wrong, else 0.
  function wordScore(r, w) {
    if (!r || !w) return 0;
    if (r === w) return 1;
    if (Math.min(r.length, w.length) < 3) return 0;
    var sk = skel(r);
    if (sk.length >= 2 && sk === skel(w)) return 0.9;
    var lim = r.length <= 3 ? 0 : (r.length <= 5 ? 1 : 2);
    var d = lev(r, w);
    return d <= lim ? 0.85 - 0.15 * d : 0;
  }

  // ---------- word lists (native script and Latin spellings; both are turned into Latin above) ----------
  var SYN_SRC = {
    sugar: ['sugar', 'chini', 'cheeni', 'shakkar', 'sakkar', 'sakhar', 'sakar', 'साखर', 'साकर', 'चीनी', 'शक्कर', 'ખાંડ', 'સાકર'],
    tea: ['tea', 'chai', 'chay', 'chaay', 'cha', 'चाय', 'चहा', 'ચા'],
    milk: ['milk', 'doodh', 'dudh', 'दूध', 'दुध', 'દૂધ'],
    oil: ['oil', 'tel', 'tail', 'तेल', 'તેલ'],
    soap: ['soap', 'sabun', 'saboon', 'साबुन', 'साबण', 'સાબુ'],
    biscuits: ['biscuits', 'biscut', 'biscuit', 'biskut', 'बिस्कुट', 'बिस्किट', 'बिस्कीट', 'બિસ્કિટ'],
    atta: ['atta', 'aata', 'aatta', 'आटा', 'पीठ', 'लोट', 'લોટ', 'આટો'],
    wheat: ['wheat', 'gehu', 'gehun', 'gehoon', 'गेहूं', 'गहू', 'ઘઉં'],
    rice: ['rice', 'chawal', 'chaval', 'bhat', 'bhaat', 'चावल', 'तांदूळ', 'भात', 'ચોખા'],
    dal: ['dal', 'daal', 'दाल', 'डाळ', 'दाळ', 'દાળ'],
    salt: ['salt', 'namak', 'mithu', 'नमक', 'मीठ', 'મીઠું'],
    onion: ['onion', 'pyaaz', 'pyaz', 'kanda', 'kande', 'kandya', 'प्याज', 'कांदा', 'कांदे', 'कांद्या', 'ડુંગળી'],
    potato: ['potato', 'aloo', 'alu', 'batata', 'batate', 'batatya', 'bateta', 'आलू', 'बटाटा', 'बटाटे', 'बटाट्या', 'બટાકા'],
    ghee: ['ghee', 'ghi', 'tup', 'घी', 'तूप', 'ઘી'],
    curd: ['curd', 'dahi', 'dahee', 'दही', ' દહીં'],
    haldi: ['haldi', 'haldee', 'हळद', 'हळदी', 'હળદર'],
    chilli: ['chilli', 'chili', 'mirchi', 'mirch', 'मिरची', 'મરચું'],
    bread: ['bread', 'pav', 'pao', 'ब्रेड', 'पाव', 'બ્રેડ'],
  };
  var SYN_R = {}, SYN_S = {};
  Object.keys(SYN_SRC).forEach(function (canon) {
    SYN_SRC[canon].forEach(function (form) {
      var r = toRoman(form);
      if (!r) return;
      SYN_R[r] = canon;
      var k = skel(r);
      if (k.length >= 2 && !SYN_S.hasOwnProperty(k)) SYN_S[k] = canon;
    });
  });
  // Canonical form of a word: its English name if it is a known synonym, otherwise itself.
  function canon(r) {
    if (SYN_R.hasOwnProperty(r)) return SYN_R[r];
    if (r.length >= 3) { var k = skel(r); if (k.length >= 2 && SYN_S.hasOwnProperty(k)) return SYN_S[k]; }
    return r;
  }

  var NUM_SRC = [
    [1, ['one', 'ek', 'एक', 'એક']],
    [2, ['two', 'do', 'don', 'दो', 'दोन', 'બે', 'be']],
    [3, ['three', 'teen', 'tin', 'तीन', 'ત્રણ']],
    [4, ['four', 'char', 'chaar', 'चार', 'ચાર']],
    [5, ['five', 'paanch', 'panch', 'paach', 'पाँच', 'पांच', 'पाच', 'પાંચ']],
    [6, ['six', 'chhe', 'chhah', 'chha', 'छह', 'छः', 'सहा', 'છ', 'सह']],
    [7, ['seven', 'saat', 'sat', 'सात', 'સાત']],
    [8, ['eight', 'aath', 'aat', 'आठ', 'આઠ']],
    [9, ['nine', 'nau', 'nav', 'nao', 'नौ', 'नऊ', 'નવ']],
    [10, ['ten', 'das', 'dus', 'दस', 'दहा', 'દસ']],
    [11, ['agyaarah', 'gyarah', 'gyaarah', 'ग्यारह', 'ગિયારા', 'અગિયાર']],
    [12, ['barah', 'baarah', 'बारह', 'બાર']],
    [13, ['terah', 'teraah', 'तेरह', 'તેર']],
    [14, ['chaudah', 'chaudaa', 'चौदह', 'ચૌદ']],
    [15, ['pandrah', 'pandraah', 'पंद्रह', 'पन्द्रह', 'પંદર']],
    [16, ['solah', 'solaah', 'सोलह', 'સોળ']],
    [17, ['satrah', 'satraah', 'सतरह', 'सत्रह', 'સત્તર']],
    [18, ['athaarah', 'athrah', 'अठारह', 'અઢાર']],
    [19, ['unnees', 'unees', 'उन्नीस', 'ઓગણીસ']],
    [20, ['bees', 'twenty', 'बीस', 'वीस', 'વીસ']],
    [30, ['tees', 'thirty', 'तीस', 'ત્રીસ']],
    [40, ['chaalis', 'chalis', 'चालीस', 'ચાલીસ']],
    [60, ['saath', 'saath', 'साठ', 'સાઠ']],
    [70, ['sattar', 'sitter', 'सत्तर', 'સિત્તેર']],
    [80, ['assi', 'assee', 'अस्सी', 'એંસી']],
    [90, ['nabbe', 'nabbey', 'नब्बे', 'નેવું']],
    [50, ['pachaas', 'pachas', 'पचास', 'पन्नास', 'પચાસ']],
    [200, ['donshe', 'donse', 'dosau', 'दोनशे', 'दोनसे', 'दोनशें', 'બસો']],
    [300, ['teenshe', 'tinshe', 'tinsau', 'तीनशे', 'तीनसे', 'तीनशें', 'ત્રણસો']],
    [400, ['chaarshe', 'charshe', 'charsau', 'चारशे', 'चारसे', 'चारशें', 'ચારસો']],
    [500, ['paanchshe', 'panchshe', 'paachshe', 'पाचशे', 'पांचशे', 'पाचसे', 'पाचशें', 'પાંચસો']],
    [600, ['sahashe', 'chhashe', 'सहाशे', 'छसो', 'છસો']],
    [700, ['saatshe', 'satshe', 'sataashe', 'सातशे', 'सातसे', 'સાતસો']],
    [800, ['aathshe', 'aatshe', 'आठशे', 'આઠસો']],
    [900, ['naushe', 'naoshe', 'naushe', 'नऊशे', 'नवशे', 'નવસો']],
    [0.25, ['paav', 'पाव', 'પાવ']],
    [0.5, ['adha', 'aadha', 'half', 'आधा', 'आधी', 'अर्धा', 'અડધો', 'અડધું']],
    [1.5, ['dedh', 'डेढ़', 'डेढ', 'दीड', 'દોઢ', 'ડેઢ']],
    [2.5, ['dhai', 'dhaai', 'ढाई', 'अढ़ाई', 'अडीच', 'અઢી']]
  ];
  var NUM_R = {};
  NUM_SRC.forEach(function (row) {
    row[1].forEach(function (form) {
      var r = toRoman(form); if (!r) return;
      NUM_R[r] = row[0];
    });
  });
  var MULT_R = {};
  [[100, ['sau', 'so', 'सौ', 'सो', 'સો']], [1000, ['hazaar', 'hazar', 'हजार', 'हज़ार', 'હજાર']], [100000, ['lakh', 'लाख', 'લાખ']]]
    .forEach(function (row) { row[1].forEach(function (f) { MULT_R[toRoman(f)] = row[0]; }); });

  function mkSet(words) {
    var set = Object.create(null), long = [];
    words.forEach(function (w) {
      var r = toRoman(w); if (!r) return;
      set[r] = true;
      if (r.length >= 5 && long.indexOf(r) < 0) long.push(r);
    });
    return { set: set, long: long };
  }
  // A word is in the set if it is spelled exactly, or (for longer words) is one or two letters off.
  function inSet(st, r) {
    if (st.set[r]) return true;
    if (r.length < 5) return false;
    var lim = r.length >= 8 ? 2 : 1, k;
    for (k = 0; k < st.long.length; k++) if (lev(r, st.long[k]) <= lim) return true;
    return false;
  }
  var UNITS = mkSet(['kg', 'kgs', 'g', 'gm', 'gms', 'gram', 'grams', 'ml', 'l', 'ltr', 'litre', 'liter', 'litres', 'liters',
    'पुडे', 'पुडा', 'पुडी', 'लीटर', 'લીટર',
    'kilo', 'kilos', 'killo', 'kilogram', 'kilograms', 'kilogrm', 'pack', 'packet', 'packets', 'pc', 'pcs', 'piece', 'pieces', 'nos', 'nag',
    'किलो', 'किलोग्राम', 'किलोंग्राम', 'ग्राम', 'लीटर', 'लिटर', 'पैकेट', 'पैकिट', 'नग', 'किलोओ',
    'કિલો', 'કિલોગ્રામ', 'ગ્રામ', 'લિટર', 'પેકેટ', 'નંગ']);
  var RUPEES = mkSet(['rupees', 'rupee', 'rupaye', 'rupaya', 'rupay', 'rupya', 'rupiya', 'rupaiya', 'rs', 'ru', 'rupaiye',
    'रुपये', 'रुपए', 'रुपया', 'रुपयाँ', 'रुपयां', 'रु', 'रू', 'रुपय', 'रुपयांचे', 'रुपयांची', 'रुपयांचा', 'रुपयाचे',
    'રૂપિયા', 'રૂપિયો']);
  var UDHAR = mkSet(['udhar', 'udhaar', 'udhari', 'udhaari', 'udaar', 'credit', 'khate', 'khata', 'khaata', 'khatyat', 'baki', 'baaki',
    'bakaya', 'उधार', 'उधारी', 'उधारे', 'बाकी', 'खाते', 'खाता', 'खात्यात', 'ઉધાર', 'ઉધારી', 'બાકી', 'ખાતે', 'ખાતામાં']);
  var PAY = mkSet(['jama', 'jamaa', 'paid', 'payment', 'pament', 'received', 'जमा', 'पेमेंट', 'पेड', 'भरले', 'भरला', 'bharle', 'bharla', 'bhare',
    'दिले', 'दिए', 'दिये', 'दिली',
    'chukaya', 'chukavla', 'chukvla', 'चुकवले', 'चुकाया', 'ચૂકવ્યા', 'ચુકવ્યા', 'જમા', 'ભર્યા', 'પેમેન્ટ',
    'આપ્યા', 'આપ્યું', 'આપ્યો']);
  // Gujarati 'gave' forms are exact matches only: fuzzy matching would read the Hindi 'aaya' (came) as 'aapyaa' (gave)
  ['આપ્યા', 'આપ્યું', 'આપ્યો'].forEach(function (w) { var rr = toRoman(w); PAY.long = PAY.long.filter(function (x) { return x !== rr; }); });
  var STOCK = mkSet(['stock', 'stok', 'maal', 'mal', 'माल', 'स्टॉक', 'स्टोक', 'aaya', 'aayi', 'aaye', 'aala', 'aali', 'add', 'आला', 'आली', 'आले',
    'jodo', 'joda', 'jodi', 'umero', 'ummero', 'उमेरो', 'आया', 'आयी', 'जोड़ो', 'ઉમેરો', 'ઉમેરા', 'આવ્યો', 'આવ્યા', 'આવી', 'સ્ટોક', 'સ્ટોક',
    'daalo', 'dalo', 'daalna', 'डालो', 'डाला', 'डालना', 'स्टॉकमध्ये', 'स्टॉकमध्ये', 'टाका', 'टाकायचा', 'टाकायचे']);
  var CASH = mkSet(['cash', 'naqad', 'nakad', 'nagad', 'naqd', 'rokad', 'rokda', 'roka', 'रोख', 'रोकड़', 'रोकड', 'नकद', 'नगद',
    'कैश', 'रोकडा', 'રોકડ', 'રોકડા', 'નકદ', 'કેશ']);
  // Words that mean "paid" or "money received" (kept apart from the Latin list above)
  var UPI = mkSet(['upi', 'online', 'यूपीआई', 'ऑनलाइन', 'ઓનલાઇન', 'ઓનલાઈન', 'gpay', 'phonepe', 'paytm']);
  var FILLER = {};
  ['ko', 'ka', 'ki', 'ke', 'aur', 'and', 'se', 'me', 'mein', 'ne', 'ni', 'nu', 'na', 'ma', 'thi', 'mate', 'ane', 'la', 'che', 'chi',
    'chya', 'madhe', 'sathi', 'liye', 'for', 'to', 'the', 'a', 'of', 'bill', 'likho', 'likh', 'lo', 'le', 'liya', 'hai', 'hain',
    'aani', 'kade', 'no', 'nu', 'ni',
    'de', 'dena', 'dijiye', 'apo', 'aapo', 'aapi', 'par', 'pe', 'kay', 'kya', 'bhi', 'को', 'का', 'की', 'के', 'और', 'से', 'में',
    'ने', 'लिए', 'बिल', 'ला', 'च्या', 'ची', 'चे', 'साठी', 'मध्ये', 'ને', 'નું', 'ની', 'માટે', 'અને', 'થી', 'માં', 'ના', 'બિલ', 'લખો', 'આપો',
    'सेव', 'करो', 'करा', 'कोणतेही', 'नाही', 'કરો', 'બનાવો', 'એ']
    .forEach(function (w) { FILLER[toRoman(w)] = true; });

  // Learned corrections for this shop: heard word (Latin) -> { k: 'p' or 'c', id }. Set by the voice page.
  B.fixes = B.fixes || {};

  // ---------- tokens and numbers ----------
  function tokenize(raw) {
    var s = String(raw || '');
    s = s.replace(/[०-९૦-૯]/g, function (c) {
      var cp = c.charCodeAt(0); return String(cp >= 0xAE6 ? cp - 0xAE6 : cp - 0x966);
    });
    s = s.replace(/₹/g, ' rs ');
    s = s.replace(/(\d)\.(\d)/g, '$1@$2').replace(/\./g, ' ').replace(/@/g, '.');
    s = s.replace(/(\d)([^\d\s.])/g, '$1 $2').replace(/([^\d\s.])(\d)/g, '$1 $2');
    var parts = s.split(/[\s,।॥!?;:"'()\[\]\/\\|\-]+/).filter(Boolean);
    var out = [];
    parts.forEach(function (p) {
      var r = toRoman(p);
      if (r) out.push({ raw: p, r: r });
    });
    return out;
  }
  function numAt(T, i) {
    var raw = T[i].raw, r = T[i].r, k;
    if (/^\d+(\.\d+)?$/.test(raw)) return parseFloat(raw);
    if (NUM_R.hasOwnProperty(r)) return NUM_R[r];
    return NaN;
  }
  function multAt(T, i) {
    var r = T[i].r;
    return MULT_R.hasOwnProperty(r) ? MULT_R[r] : 0;
  }
  // A number phrase such as "2", "ek", "dedh", "ek sau pachaas".
  function numberAt(T, kind, i) {
    if (kind[i]) return null;
    var v = numAt(T, i), j = i + 1, m, w;
    if (isNaN(v)) {
      // A bare hundred or thousand word ("sau rupaye", "so rupiya") counts as one of it
      if (!multAt(T, i)) return null;
      v = 1; j = i;
    }
    if (j < T.length && !kind[j] && (m = multAt(T, j))) {
      v = v * m; j++;
      if (m === 100 && j < T.length && !kind[j]) {
        w = numAt(T, j);
        if (!isNaN(w) && w < 100 && w % 1 === 0) { v += w; j++; }
      }
    }
    return { v: v, start: i, end: j, used: false };
  }

  // ---------- products and customers ----------
  // Name words are cached by name text, so no extra fields are added to the shop's own records.
  var NW_CACHE = {};
  // A name split into its words first (toRoman drops spaces), each word spelled in Latin letters
  function splitName(name) {
    return String(name || '').split(/[^\p{L}\p{N}]+/u).map(function (p) { return toRoman(p); }).filter(Boolean);
  }
  var POSS = ['aachya', 'aachi', 'aache', 'aacha', 'ichya', 'ichi', 'iche', 'ache', 'chya', 'chi', 'che', 'cha', 'chaa', 'ya', 'ne', 'na', 'laa', 'la', 'kaduun', 'kadun'];
  // Possible names with a possessive or case ending taken off (the stem, and the stem with a final 'a' added back)
  function possStems(r) {
    var out = [];
    POSS.forEach(function (suf) {
      if (r.length - suf.length >= 3 && r.slice(-suf.length) === suf) {
        var st = r.slice(0, -suf.length); out.push(st, st + 'a');
      }
    });
    return out;
  }

  function nameWords(name) {
    var key = String(name);
    if (!NW_CACHE.hasOwnProperty(key)) {
      NW_CACHE[key] = splitName(key).filter(function (w) { return w.length >= 2; }).map(canon);
    }
    return NW_CACHE[key];
  }
  function activeProducts() {
    return ((B.S && B.S.products) || []).filter(function (p) { return p && !p.deleted_at && p.name; });
  }
  function activeCustomers() {
    return ((B.S && B.S.customers) || []).filter(function (c) { return c && !c.deleted_at && c.name; });
  }

  // Products that a heard word could mean, best first. A learned correction always wins.
  function productCands(r, prods, fixes) {
    var rc = canon(r), fx = fixes[r], list = [];
    prods.forEach(function (p) {
      var best = 0, words = nameWords(p.name);
      words.forEach(function (w) { best = Math.max(best, wordScore(rc, w)); });
      if (fx && fx.k === 'p' && fx.id === p.id) best = 1;
      if (best >= 0.6) list.push({ p: p, score: best });
    });
    list.sort(function (a, b) { return b.score - a.score || String(a.p.name).localeCompare(String(b.p.name)); });
    return list;
  }

  // ---------- main parser ----------
  // Returns { heard, lines, party, method, amount, unknown, intent, quality, score }.
  // party.status is 'one' (use this customer), 'choose' (ask the member) or 'none' (no customer named).
  // Each line has heard (the spoken word), score and alts (up to 3 product candidates) for the one-tap fix.
  // intent is 'sale', 'udhar' (credit sale), 'payment' (money received), 'stock_in' or 'none'.
  B.parse = function (raw) {
    var T = tokenize(raw), n = T.length, i, r, k, ph;
    var kind = [], phrases = [], phrEnd = {}, phrStart = {};
    var prods = activeProducts(), custs = activeCustomers(), fixes = B.fixes || {};
    // True when a spoken word is a close match to one of the customers' name words
    var custWords = [];
    custs.forEach(function (c) { nameWords(c.name).forEach(function (w) { if (w.length >= 3) custWords.push(w); }); });
    function nameHit(r) {
      for (var k = 0; k < custWords.length; k++) { if (wordScore(r, custWords[k]) >= 0.85) return true; }
      return false;
    }
    var out = { heard: String(raw || '').trim(), lines: [], party: { status: 'none' }, method: null, amount: null,
      unknown: [], intent: 'none', quality: 1, score: 0 };
    var hasUdhar = false, hasPay = false, hasStock = false, hasCash = false, hasUpi = false;

    // A word one or two letters off a keyword counts only if it is not a strong item name
    // (so "chaay" stays tea, not a keyword), and an exact spelling always counts.
    function strongItem(r) {
      var c = productCands(r, prods, fixes);
      return c.length > 0 && c[0].score >= 0.85;
    }
    function kwHit(st, r) {
      if (st.set[r]) return true;
      return inSet(st, r) && !strongItem(r);
    }

    // 1. Words for rupees, credit, payment, stock and payment method
    for (i = 0; i < n; i++) {
      r = T[i].r;
      if (RUPEES.set[r] || kwHit(RUPEES, r)) kind[i] = 'rupee';
      else if (UNITS.set[r] || kwHit(UNITS, r)) kind[i] = 'unit';
      else if (kwHit(UDHAR, r)) { kind[i] = 'udhar'; hasUdhar = true; }
      else if (kwHit(PAY, r)) { kind[i] = 'pay'; hasPay = true; }
      else if (kwHit(STOCK, r)) { kind[i] = 'stock'; hasStock = true; }
      else if (kwHit(CASH, r)) { kind[i] = 'method'; hasCash = true; }
      else if (kwHit(UPI, r)) { kind[i] = 'method'; hasUpi = true; }
    }

    // 2. Number phrases (digits, number words, "ek sau pachaas")
    for (i = 0; i < n; i++) {
      if (kind[i]) continue;
      ph = numberAt(T, kind, i);
      if (!ph) continue;
      for (k = ph.start; k < ph.end; k++) kind[k] = 'num';
      phrases.push(ph);
      phrEnd[ph.end - 1] = ph;
      phrStart[ph.start] = ph;
      i = ph.end - 1;
    }

    // 3. Amount said in rupees (a check only; it does not set the price)
    phrases.forEach(function (p) {
      if (out.amount != null) return;
      if (kind[p.start - 1] === 'rupee' || kind[p.end] === 'rupee') {
        out.amount = p.v; p.used = true;
        for (k = p.start; k < p.end; k++) kind[k] = 'amount';
      }
    });

    // 3b. A payment said without the word "rupees" takes the first plain number
    if (out.amount == null && hasPay) {
      phrases.some(function (p) {
        if (p.used) return false;
        out.amount = p.v; p.used = true;
        for (k = p.start; k < p.end; k++) kind[k] = 'amount';
        return true;
      });
    }

    // 4. Products: each unclaimed word is compared with the shop's item names
    var prodTok = [];
    for (i = 0; i < n; i++) {
      if (kind[i]) continue;
      r = T[i].r;
      // Filler words that are spelled out exactly are never items ("માટે", "मध्ये" would otherwise fuzzy-match an item)
      if (FILLER.hasOwnProperty(r)) { kind[i] = 'filler'; continue; }
      // "चा" / "cha" straight after a customer's name is the Marathi possessive ("Gita cha udhar"), not tea
      if ((r === 'cha' || r === 'chaa' || r === 'chya') && i > 0 && T[i - 1] && nameHit(T[i - 1].r)) { kind[i] = 'filler'; continue; }
      var cands = productCands(r, prods, fixes);
      // A word that closely matches a customer's name is left for the customer step, unless an item matches strongly
      if (cands.length && cands[0].score < 0.85 && nameHit(r)) { cands = []; }
      if (cands.length) { kind[i] = 'prod'; prodTok.push({ i: i, cands: cands, qty: 1 }); }
      else if (FILLER.hasOwnProperty(r)) kind[i] = 'filler';
    }

    // 5. Quantity: the number just before the item (a unit word may sit between), else just after it
    prodTok.forEach(function (pt) {
      var j = pt.i - 1, q = null, p2;
      if (j >= 0 && kind[j] === 'unit') j--;
      if (j >= 0 && phrEnd[j] && !phrEnd[j].used) { q = phrEnd[j].v; phrEnd[j].used = true; }
      if (q == null) {
        p2 = phrStart[pt.i + 1];
        if (p2 && !p2.used) { q = p2.v; p2.used = true; }
      }
      pt.qty = (q != null && q > 0) ? q : 1;
      pt.explicit = q != null;
    });
    // "potato and onion three three": items with no number of their own get the repeated number that follows the list
    prodTok.forEach(function (pt) {
      if (pt.explicit) return;
      var j = pt.i + 1, p2, p3;
      while (j < n && (kind[j] === 'filler' || kind[j] === 'prod')) j++;
      p2 = phrStart[j]; p3 = p2 && phrStart[p2.end];
      if (p2 && p3 && p3.v === p2.v) pt.qty = p2.v;
    });

    // 6. Lines, merging the same product
    var seen = {};
    prodTok.forEach(function (pt) {
      var top = pt.cands[0].p;
      var alts = pt.cands.slice(0, 3).map(function (c) {
        return { product_id: c.p.id, name: c.p.name, price: c.p.price, cost: c.p.cost, stock: c.p.stock, score: Math.round(c.score * 100) / 100 };
      });
      if (seen[top.id]) { seen[top.id].qty += pt.qty; return; }
      seen[top.id] = { product_id: top.id, name: top.name, price: top.price, cost: top.cost, qty: pt.qty,
        stock: top.stock, heard: T[pt.i].raw, score: pt.cands[0].score, alts: alts };
      out.lines.push(seen[top.id]);
    });

    // 7. Customer: a full name in the text, or a word close to a name word (a learned correction wins)
    var fullText = ' ' + T.map(function (t) { return t.r; }).join(' ') + ' ';
    var found = [];
    custs.forEach(function (c) {
      var best = 0, tok = -1, full = splitName(c.name).join(' '), words = nameWords(c.name).filter(function (w) { return w.length >= 3; });
      if (full && fullText.indexOf(' ' + full + ' ') >= 0) { best = 1; }
      for (i = 0; i < n; i++) {
        if (kind[i]) continue;
        var fx = fixes[T[i].r], s = 0;
        if (fx && fx.k === 'c' && fx.id === c.id) s = 1;
        else {
          words.forEach(function (w) { s = Math.max(s, wordScore(T[i].r, w)); });
          // Marathi possessive on a name ('सुनिताचे' = Sunita's): try the name without the ending
          possStems(T[i].r).forEach(function (st) { words.forEach(function (w) { s = Math.max(s, 0.95 * wordScore(st, w)); }); });
        }
        if (s > best) { best = s; tok = i; }
      }
      if (best >= 0.69) found.push({ c: c, score: best, tok: tok, heard: tok >= 0 ? T[tok].raw : String(c.name) });
    });
    found.sort(function (a, b) { return b.score - a.score || String(a.c.name).localeCompare(String(b.c.name)); });
    if (found.length === 1 || (found.length > 1 && found[0].score >= 0.95 && found[1].score < 0.95)) {
      out.party = { status: 'one', customer: found[0].c, score: found[0].score, heard: found[0].heard, alts: found.slice(0, 3).map(function (f) { return f.c; }) };
      if (found[0].tok >= 0) kind[found[0].tok] = 'party';
    } else if (found.length > 1) {
      out.party = { status: 'choose', options: found.map(function (f) { return f.c; }), score: found[0].score, heard: found[0].heard, alts: found.slice(0, 3).map(function (f) { return f.c; }) };
      found.forEach(function (f) { if (f.tok >= 0) kind[f.tok] = 'party'; });
    } else if (hasUdhar) {
      out.party = { status: 'choose', options: custs.slice(), alts: [] };
    }

    // 8. Intent and method. With items, it is a bill (or stock). With no items, a payment word means money
    // received, even when "baki" (balance due) is said too.
    var lines = out.lines.length;
    if (hasCash) out.method = 'cash';
    if (hasUpi) out.method = 'upi';
    if (hasUdhar) out.method = 'udhar';
    if (lines > 0) {
      out.intent = hasStock ? 'stock_in' : (hasUdhar ? 'udhar' : 'sale');
    } else if (hasPay) out.intent = 'payment';
    else if (hasUdhar) out.intent = 'udhar';

    // 9. Words we did not use
    var unknownN = 0;
    for (i = 0; i < n; i++) {
      if (kind[i]) continue;
      unknownN++;
      if (out.unknown.indexOf(T[i].raw) < 0) out.unknown.push(T[i].raw);
    }
    out.quality = n ? Math.round(((n - unknownN) / n) * 100) / 100 : 1;
    var sc = 0;
    out.lines.forEach(function (l) { sc += l.score; });
    if (out.party.status === 'one') sc += out.party.score;
    if (out.intent !== 'none') sc += 0.5;
    if (out.amount != null) sc += 0.3;
    out.score = Math.round((sc - 0.25 * unknownN) * 100) / 100;
    return out;
  };

  // Of several recognised sentences, the one whose words best match the shop's items and customers.
  B.bestAlt = function (texts) {
    var best = null;
    (texts || []).forEach(function (t, idx) {
      if (!t || !String(t).trim()) return;
      var p = B.parse(t);
      if (!best || p.score > best.parse.score + 1e-9) best = { text: String(t), parse: p, index: idx };
    });
    return best;
  };

  // Record that a heard word means this product (k 'p') or customer (k 'c').
  B.learnFix = function (heard, k, id) {
    var key = toRoman(String(heard || '').trim());
    if (!key || key.length < 2 || key.indexOf(' ') >= 0) return null;
    B.fixes = B.fixes || {};
    B.fixes[key] = { k: k, id: id };
    return key;
  };
  B.setFixes = function (map) { B.fixes = map && typeof map === 'object' ? map : {}; };
  B.toRoman = toRoman;
})();
