# BizGrow v2 - what changed (status: stage 1 build, demo and real sign-in code, tested in a browser)

## Stage 5: orders take stock (patch-08, latest)

### What was built
- Placing an order from the online store takes its stock in the database, in the same step that saves the order. If any line is short at that moment, the whole order is refused and nothing is saved.
- An order holds its stock while it is new, accepted, packed or delivered. Cancelling it puts the stock back. Reopening a cancelled order takes the stock again; if the stock is gone, the reopen is refused with the same "out of stock" or "Only N left" message as the store.
- Taking and putting back are safe to repeat: a flag on each order records whether it holds stock, so stock is taken once and put back once.
- Owner bulk cancel of new orders puts their stock back.
- The demo (mock backend) follows the same rules.
- Database: `supabase/patch-08.sql` (new, safe to run again). `supabase/schema.sql` includes the same changes for fresh installs. `run-checks.cjs` runs patch-08 twice. New checks C27 to C38 in `store-checks.sql`.

### Orders placed before patch-08
- They never took stock, so they still do not. Cancelling one leaves stock as it is. Reopening one takes stock if it is there, the same as a new order.

### Tests (local Postgres, scratch databases only)
- Fresh empty database, full run (schema, patch-07 twice, patch-08 twice, checks): **38 of 38 passed**.
- Fresh install from `schema.sql` alone: **38 of 38 passed**.
- Headless browser, demo mode, 360 px (`stage5-smoke.js`): **24 of 24 checks passed**, no page errors. Covers the take on placing, the refusal, cancel and reopen, the refused reopen when stock is gone, and bulk cancel.
- Headless browser, demo mode, 360 px (`stage4-smoke.js`): **22 of 22 checks passed**. Its bulk step now restocks the items first, because placed orders take stock.
- Not run on the live Supabase project yet. Two sessions placing orders at the same moment were not tested.

### Known limits
- The existing sale function (`create_sale`, not changed in this stage) locks items in cart order, so a rare deadlock with an online order at the same moment is possible. Postgres stops one of them with an error; no wrong stock is written.

## Stage 4: online store hardening (patch-07)

### What was built
- Stock cap: the public store shows "Up to N at a time" for each item (stock left, capped at 999). An order asking for more than the stock left is refused, and the message names the item and the amount left.
- Status steps: new, accepted, packed, delivered. Cancel is allowed from new, accepted or packed. Any other change (reopen, skip a step) is owner only. The audit line records the old and the new status.
- WhatsApp order text is built from the lines and total saved by the order function, not from prices cached on the page.
- Spam limits: a known number (already a customer, or with an accepted, packed or delivered order) can place 3 orders in 10 minutes. A number the shop has not seen can place 2 orders in 60 minutes. The whole shop is capped at 300 orders an hour.
- Owner bulk cancel of new (junk) orders: "Cancel all new orders (n)". Each one gets an audit line "(bulk cancel)".
- Orders screen: 50 orders per page, newest first, "Load older orders", and a "Hide cancelled" toggle.
- Turnstile bot check: NOT built. Listed as future work in `docs/specs/online-store.md`.

### Changed
- `supabase/patch-07.sql` (new, safe to run again). The same content is folded into `supabase/schema.sql`.
- `supabase/tests/store-checks.sql`, `supabase/tests/run-checks.cjs`, `supabase/tests/local-auth-shim.sql` (new): 26 SQL checks. The shim is a local test helper only and is never run on the live project.
- `docs/specs/online-store.md` (new): numbered yes/no acceptance criteria, mapped to the checks.
- `v2/assets/mock-api.js`, `v2/assets/supabase-api.js`, `v2/assets/v2-store.js`, `v2/assets/v2-i18n-store.js`: the demo and the real adapter now match the database rules. `v2/dist/bizgrow-v2.html` rebuilt.
- `README.md`: build command and how to run the checks.

### Database (run once)
1. Supabase SQL Editor, New query, paste `supabase/patch-07.sql`, Run. It is safe to run again.

### Testing done
- Local Postgres 19 (embedded copy on this machine, a scratch database, not the live project). `supabase/tests/run-checks.cjs --scratch` loads the schema, runs `patch-07.sql` twice, then the checks: **26 of 26 checks passed** (C01 to C26).
- Headless browser, demo mode, 360 px (`stage4-smoke.js`): **22 of 22 checks passed**, no page errors. Covers the stock cap and "Up to N at a time", the over-cap refusal, the WhatsApp text (line and total), 52 orders from 26 buyers, paging with "Load older orders", newest first, the status steps and the audit line, the hide toggle, and bulk cancel.
- Not run on the live Supabase project yet. The live site has not been checked against the new SQL.

### Known gaps
- The Turnstile bot check is not built.
- The shop-wide 300 orders an hour cap has no automated check yet.
- Cancel from accepted or packed has no automated check yet (the rule is in the function).

### Correction to an earlier commit message
- Commit `cd09b6a` says the store is turned on from Settings. That is wrong. It is turned on from the **Store** page. The commit is not rewritten; this note corrects it.

## Online store (patch-06)

### What was built
- Owner turns the online store on from the Store page (or the More list). A link is made once and kept: `?shop=<short name>` on the live address. Share it on WhatsApp, preview it, or turn it off.
- Public store page (no sign-in): shop name, phone, city, in-stock items with selling price and unit, search, cart with plus and minus, name, phone and optional note. "Send order on WhatsApp" opens the shop's number with the order text. No payments.
- Orders screen (owner, manager, cashier): All and per-status filters, each order with items, total and note; status select (new, accepted, packed, delivered, cancelled); reply on WhatsApp; call. New-orders count shows on the Orders link.
- Cost prices and customer details are never sent to the public page.
- Convert an order to a bill: not included in this round.
- Text in English, Hindi, Marathi and Gujarati (`v2/assets/v2-i18n-store.js`).

### Changed
- `supabase/patch-06.sql` (new, safe to run again); the same content is folded into `supabase/schema.sql`.
- `assets/v2-store.js` (new): Store page, Orders page, public store page.
- `assets/supabase-api.js`, `assets/mock-api.js`: routes `/public/store`, `/public/order`, `/store`, `/orders`, `/orders/:id/status`. The store switch no longer lives in the business save.
- `assets/app.js`: old store card and upsell removed; the Store and Orders pages hand off to the new file.
- `assets/v2-core.js`: Orders added to the menu, with the team roles.
- `index.html`: loads the two new files. `dist/bizgrow-v2.html` rebuilt.

### Database (run once)
1. Supabase SQL Editor, New query, paste `supabase/patch-06.sql`, Run.

### Testing done
- Headless browser, demo mode, 360 px and 1280 px: owner turns the store on; the public link opens without sign-in; cart and order placed; the order appears in Orders with the badge; status change saved. No page errors. Stage 1 to 3 pages at 360 px render with no errors.
- Not tested on the real database (the SQL was checked for syntax only).

## Stage 1: real sign-in with Supabase (latest)

### What was built
- Connected to the BizGrow Supabase project (Mumbai). Connection settings live in `v2/assets/config.js` and hold only the public (publishable) key. No secret or service key is in any file.
- Sign-in is Google only, through Supabase Auth with PKCE. The sign-in screen shows one large "Continue with Google" button. Email and password forms are hidden in real mode. No password flows.
- The Google return address is built from the live page address (origin plus path). Session is restored on reload. Sign-out ends the Supabase session.
- First login creates the shop and the owner's staff row, through the `create_my_shop` function (`supabase/patch-01.sql`).
- Sign-up wizard: a consent step comes first (unticked by default). Answers are saved to `signup_answers` and the consent to `consent_records`, with the text version. The owner's shop name, trade and city are copied to the shop through `update_my_shop`.
- Privacy screen: switching consent off writes a new `consent_records` row with granted = false. The table has no update rule, so rows are only added, never changed.
- Home loads for an empty shop. Reads for things not built yet return empty lists. Writes not built yet show a plain "comes in the next stage" message and change nothing.
- Demo mode stays. It runs when the config is empty, and `?demo=1` forces it even when the config is set.
- supabase-js 2.119.2 UMD is vendored at `v2/assets/vendor/supabase.js` (no runtime CDN for it). sha256 8816af04d9915dbba1882d6f84f0b402dc40268063a63d9c66d24f52f371c263.

### Changed in v2/
- `assets/app.js`: boot now runs on DOMContentLoaded (before, the first `/me` call was made while the page was still loading, so it reached the demo stand-in). One hook added in `renderAuth()`: `BGV2.authDone(mode)`, which does nothing in demo mode.
- `assets/supabase-api.js` (new): real-mode adapter. It wraps `fetch` for `/api` calls only and does nothing in demo mode.
- `assets/config.js` (new), `assets/v2-supabase.css` (new): big sign-in button and the consent step.
- `index.html`: loads config, the vendored library and the adapter; links the new stylesheet.
- `dist/bizgrow-v2.html`: rebuilt as one file (the new stylesheet is inlined; the hyv-type and hyv-layout meta tags and the storage shim are kept; the shim is used only when storage is blocked).

### Database (run once, in order)
1. `supabase/schema.sql` (from the previous round).
2. `supabase/patch-01.sql`: adds `signup_answers.done`, the `create_my_shop` and `update_my_shop` functions, and grants them to signed-in users only.
3. In Supabase Authentication settings: turn on Google, and add the live site address to the allowed redirect addresses. The Google client ID and secret are entered in Supabase only, never in a file.

### Testing done
- agent-browser at 390 x 844, real mode: the sign-in screen shows "Continue with Google", no email or password fields, no page errors, and no text below 12px.
- Clicking the Google button goes to Google's sign-in page, with the return path set to the Supabase callback.
- Demo mode (`?demo=1`): signed in as the demo owner, reached Home, 0 page errors, no text below 12px.
- Single file (`dist/bizgrow-v2.html`): demo mode works when opened with `?demo=1`; real mode shows the Google button.

### Not tested (be careful)
- A real Google sign-in from start to finish. The test browser cannot complete a Google login.
- First login creating a shop on the live project, the consent step on the live project, and the owner's shop edit.
- `patch-01.sql` has not been run on the live project, and has not been syntax-checked against a real Postgres.
- Row-level security has not been checked on the live project. From this build environment the sandbox network gateway has no credentials for the project's API host, so the live API could not be called.
- Opening the single file from disk (file://) cannot sign in with Google. Use the live site address.

### Known gaps (stage 1)
- The barcode scanner library still loads from a public CDN in `assets/app.js`. This was already in the original app. It should be vendored in a later stage.
- Hindi, Marathi and Gujarati text for the new sign-in and consent screens is a first draft and needs a native-speaker check.

### STAGE 2 TODO (not started)
- Sales and bills (create, edit, back-dated entries, stock effect).
- Udhar (credit ledger, payments, reminders) on real data.
- Stock (products, stock in and out, low-stock alerts) on real data.
- Expenses (add, categories, reports).
- Staff (invite by email, roles, suspend, remove) on real data.
- Audit log (write and show) on real data.
- Summary (evening summary, daily totals) on real data.
- Exports (Excel and PDF downloads) on real data.
- Dashboard and reports numbers on real data (now zero until the screens above exist).

## Previous round: sign-up, consent and database files

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
