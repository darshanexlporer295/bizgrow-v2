# BizGrow v2 - what changed (status: demo build, tested in a browser)

## Latest round: sign-up, consent and database files

### New sign-up flow (v2/assets/v2-signup.js, v2/assets/v2-i18n-signup.js)
- A new user sees six short questions, one per screen, with large buttons and progress dots: shop name, trade (from a config list), city (optional), team size, the biggest problem (from a list), and udhar customers (optional). Language choice: English, Hindi, Marathi, Gujarati.
- Answers are saved through the mock API (PUT /signup/answers) in the shape a future server will use. Nothing is sent to a real server yet.
- Consent checkbox on the sign-up form is unticked by default. Continue stays blocked until it is ticked. Wording: "Your sign-up answers are shared with RÊVO (BizGrow's maker)... You can withdraw this any time in Privacy."
- A privacy notice (what is collected, who sees it, why, how long, how to contact) opens from the consent line and from the Privacy screen.
- The consent record stores a timestamp and the text version (signup-consent-v1).
- Privacy screen has a consent switch. Turning it off calls POST /consent.
- Hindi, Marathi and Gujarati wording is a first draft and needs a native-speaker check. The privacy notice has a [CONTACT EMAIL] placeholder that must be filled in.

### Changed in v2/
- assets/mock-api.js: routes POST /signup (needs consent), GET /me (returns signup done, answers, consent), PUT /signup/answers, POST /consent, PUT /language.
- assets/app.js: one line in render() that lets the sign-up gate take over until the questions are done.
- assets/styles.css: four small text sizes raised from 11px to 12px, so no text is below 12px.
- index.html: loads the two new scripts.
- dist/bizgrow-v2.html: rebuilt from the sources.

### New database and sign-up list files (for the later server step)
- supabase/schema.sql: tables for shops, staff, signup answers, consent records and the rest. Row Level Security is turned on explicitly for every table. Each table has its own policies by shop and by role (owner, manager, cashier, stock-keeper, accountant). Grants are given to the signed-in role only, and everything is revoked from the anonymous role. The file can be run again safely. It was checked for syntax only. It has NOT been run against a live Supabase project.
- google-sheet/apps-script.gs: receives sign-up rows through a web app. It needs a shared secret, refuses placeholder values, and guards against spreadsheet formula injection. Not executed yet.
- docs/SETUP-STEPS.md: plain numbered steps for the database, the Sheet, and where keys go (hosting settings only, never in files).

## Testing done (latest round)
- agent-browser at 390 x 844, English and Hindi: sign-up from the first screen through the six questions to Home, 15 of 15 checks each, no red errors.
- Consent: Continue is blocked while the box is unticked, and works once ticked.
- Route sweep after the sign-up gate: no errors.
- Text size: no text below 12px in the CSS or JS.
- Screenshots checked for layout (Hindi sign-up page and first question).
- Not tested: Marathi and Gujarati sign-up flows, the database file on a real Supabase project, the Apps Script on a real Google account, and any real server connection.

## Known gaps (latest round)
- Fresh database: no old demo data is moved.
- No real server yet. The app still stores data in the browser, and the sign-up answers are not sent to the Sheet or to Supabase.
- Privacy wording needs a lawyer's review before real customers sign up. The notice describes what the app does. It is not legal advice, and this project does not claim legal compliance.

## Copied, not changed
- original/ is the untouched copy of the front-end. Only addition there: assets/icon-512.png, fetched with a plain GET because the manifest names it.

## Changed in v2/
- assets/app.js (2 small patches)
  1. Added `window.BGV2={...}` just before the final `boot()` call, so the new layer can reuse existing actions, forms, api, render, toast, modal and helpers. (Moving it earlier caused a load-time error: "Cannot access 'head' before initialization".)
  2. After each page renders, calls `BGV2.after(S.page, v, args)` so the layer can add panels to existing screens.

## New in v2/
- assets/mock-api.js: stand-in backend in the browser (replaces /api). Example data only, stored in this browser under one key. Covers the routes the screens call, role rules (cashier cannot see totals, cannot delete bills, discount limit), back-date and owner stock rule, udhar with due dates and advance, staff, audit log with undo, export and delete-my-data.
- assets/v2-core.js: hook registry, role table (owner, manager, cashier, stock-keeper, accountant), nav links.
- assets/v2-parse.js: reads a typed or spoken sale line (English, Hinglish, digits, Devanagari and Gujarati digits) and matches product names.
- assets/v2-voice.js: Home "Talk to Chotu" card (tap and speak, or type), confirm sheet with Save and Cancel, rename of the voice helper. Loads products and customers first if they are empty.
- assets/v2-udhar.js: udhar list with days late and a reminder link.
- assets/v2-staff.js: invite, edit, suspend, remove, and a demo role switch.
- assets/v2-audit.js: audit log with undo (owner and manager only).
- assets/v2-summary.js: evening summary.
- assets/v2-privacy.js: export button and delete-my-data (type DELETE to confirm).
- assets/v2-validate.js: number, text and form error checks.
- assets/v2-i18n.js and v2-i18n-extra.js: new text in English, Hindi, Marathi and Gujarati, merged into the existing dictionary.
- assets/v2-layer.css: styles for the new panels, the mic pill, and hides the links the demo cannot serve (invoice, export files, /terms).
- index.html: loads the original scripts plus the v2 files in order.
- dist/bizgrow-v2.html: one self-contained file. CSS and scripts are inlined, the service worker is not registered, and the icons are embedded. This is the file to open.

## Testing done
- Smoke test on the bundle (dist/bizgrow-v2.html) at 390 x 844: 21 of 21 checks pass, no JS errors. Checks cover Home, typed sale to confirm to Save, udhar days late and reminder link, staff invite/suspend/remove, cashier restrictions, audit log and undo, evening summary, and Privacy export/delete buttons.
- Hindi switch passed on the multi-file build (not re-run on the bundle).
- Mic pill and Home screen checked by screenshot at 390 px wide.

## Known gaps (demo)
- Voice input depends on the browser. Typed input always works. Spoken input was not tested with a real microphone.
- No real server, accounts or passwords. Data stays in this browser and is lost if the browser's site data is cleared.
- Invoice, export-file and /terms links are hidden, not built.
- The staff remove check in the smoke test is loose (it checks the name is gone from the list). A manual check showed remove works.
- The export button was not clicked to download a file in the bundle; the export route answers with data.
- Not tested on a real phone, only at 390 px in a desktop browser.

## Fixes (latest round)
- Online store screen opens without a red error box.
- An unknown screen address now shows Home, not a red raw error ("Cannot read properties of undefined").
- New sale: the Scan and + Other buttons open their panels.
- Reports: "Download for accountant" shows the Excel and PDF buttons for sales, expenses, products, customers, suppliers and the ledger. In the demo they save a spreadsheet file, or open a printable page for PDF.
- Checked at 390 x 844 on the single-file bundle: every menu screen, plus an unknown address, with no JS errors.
