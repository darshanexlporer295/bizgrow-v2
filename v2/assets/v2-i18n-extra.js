/* BizGrow v2: more text for the v2 screens (en, hi, mr, gu). Loaded after v2-i18n.js and merged into window.I18N. */
(function () {
  'use strict';
  var X = {
    en: {
      v2_balance: 'Balance due', v2_cash_customer: 'Cash sale (no customer)', v2_check: 'Check', v2_check_title: 'Check the bill',
      v2_date_future: 'The date cannot be in the future.', v2_disc_big: 'Discount cannot be more than the bill ({max}).',
      v2_draft: 'Message (you can edit it)', v2_email_bad: 'Please type a proper email.', v2_for: 'For', v2_heard: 'I heard',
      v2_ledger_title: 'Ledger', v2_name_req: 'Please type a name.', v2_need_line: 'Add at least one item.',
      v2_no_udhar: 'No pending udhar.', v2_paid_so_far: 'Paid so far:', v2_said_amount: 'You said {amount}.',
      v2_short: 'Only {stock} of {name} is left.', v2_stock_left: '{stock} left', v2_tone: 'Tone',
      v2_too_big: 'Please type a number up to {max}.', v2_too_long: 'Too long. Keep it under {max} letters.'
    },
    hi: {
      v2_balance: 'बाकी रकम', v2_cash_customer: 'नकद बिक्री (ग्राहक का नाम नहीं)', v2_check: 'जाँचें', v2_check_title: 'बिल जाँचें',
      v2_date_future: 'तारीख आज से आगे की नहीं हो सकती।', v2_disc_big: 'छूट बिल से ज़्यादा नहीं हो सकती ({max})।',
      v2_draft: 'संदेश (आप बदल सकते हैं)', v2_email_bad: 'सही ईमेल लिखें।', v2_for: 'किसके लिए', v2_heard: 'मैंने सुना',
      v2_ledger_title: 'खाता', v2_name_req: 'नाम लिखें।', v2_need_line: 'कम से कम एक सामान जोड़ें।',
      v2_no_udhar: 'कोई उधार बाकी नहीं है।', v2_paid_so_far: 'अब तक दिए:', v2_said_amount: 'आपने {amount} बताए।',
      v2_short: '{name} सिर्फ {stock} बचा है।', v2_stock_left: '{stock} बचे', v2_tone: 'लहजा',
      v2_too_big: '{max} तक की संख्या लिखें।', v2_too_long: 'बहुत लंबा है। {max} अक्षरों से कम रखें।'
    },
    mr: {
      v2_balance: 'बाकी रक्कम', v2_cash_customer: 'रोख विक्री (ग्राहकाचे नाव नाही)', v2_check: 'तपासा', v2_check_title: 'बिल तपासा',
      v2_date_future: 'तारीख आजच्या पुढची असू शकत नाही.', v2_disc_big: 'सवलत बिलापेक्षा जास्त असू शकत नाही ({max}).',
      v2_draft: 'संदेश (तुम्ही बदलू शकता)', v2_email_bad: 'बरोबर ईमेल लिहा.', v2_for: 'कोणासाठी', v2_heard: 'मी ऐकले',
      v2_ledger_title: 'खाते', v2_name_req: 'नाव लिहा.', v2_need_line: 'किमान एक वस्तू जोडा.',
      v2_no_udhar: 'कोणतीही उधारी बाकी नाही.', v2_paid_so_far: 'आतापर्यंत दिले:', v2_said_amount: 'तुम्ही {amount} सांगितले.',
      v2_short: '{name} फक्त {stock} शिल्लक आहे.', v2_stock_left: '{stock} शिल्लक', v2_tone: 'सूर',
      v2_too_big: '{max} पर्यंतची संख्या लिहा.', v2_too_long: 'खूप मोठे आहे. {max} अक्षरांच्या आत ठेवा.'
    },
    gu: {
      v2_balance: 'બાકી રકમ', v2_cash_customer: 'રોકડ વેચાણ (ગ્રાહકનું નામ નથી)', v2_check: 'તપાસો', v2_check_title: 'બિલ તપાસો',
      v2_date_future: 'તારીખ આજ પછીની ન હોઈ શકે.', v2_disc_big: 'છૂટ બિલ કરતાં વધારે ન હોઈ શકે ({max}).',
      v2_draft: 'સંદેશ (તમે બદલી શકો)', v2_email_bad: 'સાચું ઈમેલ લખો.', v2_for: 'કોના માટે', v2_heard: 'મેં સાંભળ્યું',
      v2_ledger_title: 'ખાતું', v2_name_req: 'નામ લખો.', v2_need_line: 'ઓછામાં ઓછી એક વસ્તુ ઉમેરો.',
      v2_no_udhar: 'કોઈ ઉધાર બાકી નથી.', v2_paid_so_far: 'અત્યાર સુધી આપ્યા:', v2_said_amount: 'તમે {amount} કહ્યું.',
      v2_short: '{name} ફક્ત {stock} બચ્યું છે.', v2_stock_left: '{stock} બાકી', v2_tone: 'ભાષાશૈલી',
      v2_too_big: '{max} સુધીની સંખ્યા લખો.', v2_too_long: 'ઘણું લાંબું છે. {max} અક્ષરોથી ઓછું રાખો.'
    }
  };
  window.I18N = window.I18N || {};
  Object.keys(X).forEach(function (l) {
    window.I18N[l] = Object.assign(window.I18N[l] || {}, X[l]);
  });
})();
