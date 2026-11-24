/**
 * BizGrow v2: sign-up list in a Google Sheet (prep only, not connected yet).
 *
 * What it does: a web app that adds one row to the sheet for each finished sign-up.
 * Only the future server calls this web app. The app in the browser never does.
 *
 * Setup (see docs/SETUP-STEPS.md):
 *   1. Paste this whole file into the script editor of the Google Sheet.
 *   2. In Project Settings, add two Script Properties:
 *        SHARED_SECRET  = a long random text you make up (keep it private)
 *        SHEET_NAME     = Signups   (optional, defaults to the first tab)
 *   3. Deploy as a web app. Copy the web app address into the server's secret settings.
 *
 * The placeholder below is never a real secret. The script refuses to run while it is in place.
 */

var PLACEHOLDER_SECRET = 'PASTE_A_RANDOM_SECRET_HERE';

var HEADERS = [
  'Timestamp', 'Shop name', 'Trade', 'City', 'Team size', 'Biggest problem',
  'Customers who owe money', 'Phone or email', 'Consent wording version'
];

function doPost(e) {
  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty('SHARED_SECRET');
  if (!secret || secret === PLACEHOLDER_SECRET) {
    return reply({ ok: false, error: 'Setup is not finished' });
  }

  var body = {};
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return reply({ ok: false, error: 'Bad request' });
  }

  // The shared secret must match. Anything else is refused.
  if (String(body.secret || '') !== secret) {
    return reply({ ok: false, error: 'Not allowed' });
  }

  var row = [
    new Date(),
    clean(body.shop_name),
    clean(body.trade),
    clean(body.city),
    clean(body.team_size),
    clean(body.problem),
    clean(body.udhar_customers),
    clean(body.contact),
    clean(body.consent_version)
  ];

  var sheet = getSheet(props.getProperty('SHEET_NAME'));
  if (sheet.getLastRow() === 0) sheet.appendRow(HEADERS);
  sheet.appendRow(row);
  return reply({ ok: true });
}

// Opens the named tab, or the first tab if no name is set.
function getSheet(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = name ? ss.getSheetByName(name) : null;
  return sheet || ss.getSheets()[0];
}

// Keeps each cell short and stops a value starting with = from running as a formula.
function clean(v) {
  var s = String(v === undefined || v === null ? '' : v).slice(0, 200);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
