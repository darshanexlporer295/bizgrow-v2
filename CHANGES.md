# BizGrow v2 - what changed (status: stage 1 build, demo and real sign-in code, tested in a browser)

## Stage 9: online orders only through the Worker (opt-in patch-10, lockdown, anonymous-access review)

### What was built
- `supabase/patch-10-lockdown.sql` (new, OPTIONAL, not run by anything automatically). Takes `place_store_order` away from the public web key and from signed-in users, and gives it to the server role (`service_role`) only. Also removes the public (anonymous) role's direct table access on every table in the public schema. Safe to run twice.
- `supabase/patch-10-rollback.sql` (new). Gives `place_store_order` back to the public and signed-in roles, exactly as patch-08 set it. Does not give the public role table access back (it was never used and Row Level Security blocked every row anyway). Safe to run twice.
- `worker/index.mjs`: the Worker places orders with the server key (Worker secret `SUPABASE_SERVICE_KEY`) when it is set, and with the public key when it is not, so nothing breaks before the secret is added. The key is trimmed, is never sent to the browser, never logged, and never echoed in a reply.
- Unchanged on purpose: `public_store_catalogue` (shop page), `track_store_order` (order tracking), the owner app (signed-in functions and tables), demo mode, and the WhatsApp order text.

### Order of steps for the shop owner (also in `docs/SETUP-STEPS.md`, Part 6)
1. Add the Worker secret `SUPABASE_SERVICE_KEY` (Cloudflare, type Secret, Deploy). Do this first.
2. Check that the security check box shows on the shop link and that a test order goes through.
3. Only then run `patch-10-lockdown.sql` in the Supabase SQL Editor.
4. To undo, run `patch-10-rollback.sql` in the same place.

### Database
- Nothing in the live project was touched. All tests ran on scratch databases in the local test Postgres (19.0), with the stand-in login functions from `supabase/tests/local-auth-shim.sql`.
- Base checks (no patch-10): `supabase/tests/run-checks.cjs --scratch` passes **46 of 46**. C03 still asserts that the public role can place an order, which is correct before patch-10.
- Lockdown run (`run-checks.cjs --scratch --lockdown`): the base set, then patch-10 twice, `lockdown-checks.sql` **8 of 8** (anonymous direct call refused with a permission error; server role places an order; anonymous tracking and shop reads still work; no anonymous table access; signed-in users cannot call the order function; server role can; owner functions and signed-in table access unchanged), then rollback twice and `rollback-checks.sql` **3 of 3** (anonymous and signed-in roles can call it again; a real anonymous order places after rollback; server role still has it).
- Default-privilege simulation (a scratch database where Supabase-style default grants give the public role access to every new table and function): patch-10 removes the public role's execute on `place_store_order` and all its table access (0 tables left), and keeps `public_store_catalogue` and `track_store_order` public.

### Worker
- `stage9-worker-smoke.mjs` (kept outside the repo, with the other smoke tests): **12 of 12 passed**. Covers the server key used for both headers, the public key fallback when the secret is missing or blank, trimming, the key not in the order body or any reply, plain refusal messages kept, a permission error turned into the generic reply, and the bot-check reply with no key.
- `stage8-worker-smoke.mjs`: **27 of 27 passed** (unchanged).

### Browser smoke suites (demo mode, phone width)
- `stage4-smoke.js` 22 passed, `stage5-smoke.js` 20, `stage6-smoke.js` 27, `stage7-smoke.js` 23, `stage8-smoke.js` 21 passed, all with 0 FAIL lines. `stage3-smoke.js` exits with code 0 and prints no check lines (as before).

### Public (anonymous) surface review
What the public key can reach, checked on a clean scratch database and on one with Supabase-style default grants:
- Before patch-10: the public role can run exactly three functions, all `security definer`: `public_store_catalogue`, `place_store_order`, `track_store_order`. Table access: none on the clean database, but the default-grant simulation gives the public role table access to `tasks` and `staff_invites` (RLS blocks every row for it).
- After patch-10: the public role can run `public_store_catalogue` and `track_store_order` only, with no table access.

Findings (not closed in stage 9 unless marked fixed):
1. **Fixed by patch-10 (opt-in).** `place_store_order` could be called directly with the public key from any page. Now only the server role can call it.
2. **Fixed by patch-10 (opt-in), small.** Public role had table grants on `tasks` and `staff_invites` through default grants. RLS blocked all rows, so no data leaked, but the door is now closed.
3. **Open, product decision.** Per-shop cap of 300 orders an hour counts every anonymous order. One anonymous visitor with new phone numbers can fill the cap and stop the shop taking online orders for up to an hour. The Turnstile check (once its secret is set) makes scripted attempts harder; a lower cap per phone or a cap that ignores refused tries needs the owner's choice.
4. **Open, product decision.** `track_store_order` logs every try, including refused ones, and the 300-per-shop-per-hour try cap counts all tries. One anonymous visitor can block tracking for a whole shop for up to an hour. Log rows are trimmed per shop only after two hours.
5. **Open, by design for now.** The Worker has no rate limit of its own and fails open when `TURNSTILE_SECRET_KEY` is empty (orders go through with no check). Per-number limits (criteria 13 to 15) are the only protection until the secret is set.
6. **Open, future patch.** New tables created later by the database owner can get the public role's default table access again in Supabase. Patch-10 only covers the tables that exist today. A later patch should change the default privileges for the public schema.
7. **Reviewed, no change.** `tasks` "shop add" insert policy is limited to owner and manager with `WITH CHECK`, so it is correct (the policy has no USING part, which is normal for inserts).
8. **Informational, by design.** `public_store_catalogue` shows the shop's name, phone and city to anyone with the link, as the shop page always did. No cost prices or other stock fields are shown.
9. **Informational.** Anyone who knows a customer's phone number can use up its tracking tries for 15 minutes (see spec section H).

### Changed
- `supabase/patch-10-lockdown.sql` (new), `supabase/patch-10-rollback.sql` (new).
- `supabase/tests/lockdown-checks.sql` (new), `supabase/tests/rollback-checks.sql` (new), `supabase/tests/local-auth-shim.sql` (adds the server role for tests only), `supabase/tests/run-checks.cjs` (new `--lockdown` mode; the base run is unchanged).
- `worker/index.mjs`: server key selection and header comment.
- `docs/specs/online-store.md`: new section N (criteria 67 to 73), section H updated, how to run the checks updated.
- `docs/SETUP-STEPS.md`: new Part 6 (server key, test, run patch-10 only after the check is seen working, undo).

### Deploy and live check
- Workers Builds deploys on push to main. Nothing in the live database is changed until the owner runs patch-10.

### Live check (after the deploy of commit fdc7561)
- `/api/public/bot-check` answers `{"enabled":false,"siteKey":""}` (the Turnstile secret and the server key are not set yet, so the check is off and orders use the public key, as before).
- The live `/dist/bizgrow-v2` page is byte-for-byte the committed build.
- An order for an unknown store returns the plain reply "This store is not open right now" (HTTP 400) and writes nothing.
- The live database is untouched: patch-10 has not been run on it. The owner runs it only after the steps in `docs/SETUP-STEPS.md`, Part 6.
- The same replies come back from the old and the new Worker code, so these checks do not show which Worker version is live. The Worker tests (`stage9-worker-smoke.mjs`) cover the new key choice.

### Known limits
- Tested on the local Postgres copy with a stand-in login function, not on the live Supabase project. The member's own run of patch-10 is the first run on the live project.
- The service key is only in Cloudflare and in Supabase. It must never be pasted into chat, a file or the repo.

## Stage 8: bot check (Cloudflare Turnstile) on the public order form (Worker added)

### What was built
- The public store checkout shows a Cloudflare Turnstile check box just above the Send order button. Sending needs a passed check.
- The order request now goes through a small Cloudflare Worker (`worker/index.mjs`) that sits in front of the site. It checks the token with Cloudflare on the server, and only then places the order with the same database function as before.
- Fail open until the secret is set: while the Worker secret `TURNSTILE_SECRET_KEY` is empty, the Worker skips the check, the page shows no box, and orders work as before. `GET /api/public/bot-check` returns `enabled: false` in that case. This is deliberate, so a missing secret never blocks sales. Turn the check on by setting the secret (see `docs/SETUP-STEPS.md`, Part 5).
- A missing, refused or expired check: the order is not placed. A refused check gets the friendly reply "Please complete the security check and try again." (HTTP 403, code `bot_check`). If the check service cannot be reached the reply is HTTP 503 with the same code.
- The page shows a friendly message and resets the check, so the shopper can retry. Expired and error callbacks clear the token. A used token is not reused.
- The WhatsApp order text is unchanged.
- Labels in English, Hindi, Marathi and Gujarati (new `pub_bot_need` and `pub_bot_fail` keys in `v2-i18n-store.js`). The Hindi, Marathi and Gujarati wording is a first draft.

### Database
- No SQL change. No database file or secret was touched.

### Changed
- `worker/index.mjs` (new): routes `GET /api/public/bot-check` and `POST /api/public/order`. Other `/api/` paths return 404. Everything else is served from `v2/`.
- `wrangler.jsonc` (new, repo root): Worker name `bizgrow-v2`, main file, assets folder `./v2`, and public settings only (Turnstile site key, Supabase address, publishable key). No secret is in the repo.
- `v2/assets/supabase-api.js`: `/public/order` and `/public/bot-check` are answered by the Worker, not by the browser calling the database directly.
- `v2/assets/v2-store.js`: check box above Send order, token sent with the order, check reset after each reply, 360 px layout for the box.
- `v2/assets/mock-api.js`: the demo answers the bot-check route with the check off (demo has no Worker).
- `v2/assets/v2-i18n-store.js`: two new keys in four languages.
- `v2/dist/bizgrow-v2.html` rebuilt with `build.js`.
- `docs/specs/online-store.md` (section M, criteria 62 to 66; known gap for the bot check removed; new limits noted), `docs/SETUP-STEPS.md` (Part 5: add the Turnstile secret).

### Deploy
- Workers Builds still runs `npx wrangler deploy --assets=./v2 --compatibility-date=2026-11-01 --name bizgrow-v2` on push to main. The new `wrangler.jsonc` adds the Worker entry point and public settings to that deploy. A dry run of the same deploy succeeded.
- The Worker secret is set in the Cloudflare dashboard, not in files. It is expected to survive later deploys; re-check the checkout box after the first deploy that follows setting it.

### Tests
- `stage8-worker-smoke.mjs` (kept outside the repo with the other smoke tests): the Worker run against Cloudflare's test secrets, with the Turnstile check and the database stubbed. **27 of 27 passed.**
- `stage8-smoke.js` (outside the repo): headless browser, demo mode, 360 px, with a stand-in check widget and Cloudflare's test values. Covers the box position, no sideways scrolling, no token (no order sent), a good token (order placed, WhatsApp text correct, widget reset), a used token not reused, a refused check and retry, expired and error callbacks, and the check off (order goes through). **21 of 21 passed.** Screenshot at 360 px checked: the box fits above Send order.
- Earlier suites re-run against the new build: `stage4-smoke.js` (22 of 22), `stage5-smoke.js` (20 of 20), `stage6-smoke.js` (27 of 27), `stage7-smoke.js` (23 of 23). `stage3-smoke.js`, `stage3-test.js` and `store-smoke.js` exit with code 0 and print no failures.

### Live check (after the deploy of commit 470a50e)
- `/api/public/bot-check` answers `{"enabled":false,"siteKey":""}` (the secret is not set yet, so the check is off).
- The live `dist/bizgrow-v2.html` is byte-for-byte the committed build.
- An order for an unknown store returns the plain reply "This store is not open right now" (HTTP 400) and writes nothing.

### Known limits
- The tests use Cloudflare's test keys. The real check has to be seen on the live page once the secret is set.
- While the secret is empty there is no bot check (fail open, by design).
- The public key in the page config and the order function `place_store_order` stay callable by anyone who reads that config. The check makes automated orders harder but does not close that route. Closing it means removing public permission to run the order function, a later database step that has not been done and must be agreed first.

## Stage 7: order tracking for customers and a new-orders banner (patch-09)

### What was built
- **Track your order** box on the public store. A customer enters the order reference and the phone number they used, and sees only the status: Received (new), Accepted by the shop, Packed, Delivered or Cancelled. No name, phone, items or total is shown.
- A wrong phone, a wrong reference, an unknown store and a closed store all get the same plain "could not find an order" message, so the box cannot be used to check whether an order exists.
- Rate limit: 10 tries per phone number in 15 minutes, and 300 tries per store in an hour. A refused try still counts, and the reply is a plain "too many tries, please wait" message.
- After an order is sent, the done box has a "Track this order" button that fills the box with that reference and phone.
- Owner side: a yellow banner shows how many orders are new (status new), on Home (with an "Open orders" button) and on the Orders page (with a "Show new orders" button that filters to them). The sidebar and More-list badge from stage 4 is unchanged.
- Labels in English, Hindi, Marathi and Gujarati (new `ord_banner_*`, `ord_show_new`, `ord_open`, `pub_track_*`, `pub_st_*` keys in `v2-i18n-store.js`). The Hindi, Marathi and Gujarati wording is a first draft.

### Database (new file, run once)
- `supabase/patch-09.sql` (new, safe to run again). Adds `store_track_log` (a hashed phone key per try, kept two hours, no grants, no policies) and `track_store_order(p_slug, p_ref, p_phone)`, the only function the public role can call for tracking.
- `supabase/tests/run-checks.cjs` runs patch-09 twice. `supabase/tests/store-checks.sql` has new checks C39 to C46 (checks now run C01 to C46).
- `supabase/schema.sql` is not changed, so a fresh install from it alone has no tracking. Run `patch-09.sql` after it to get tracking.

### Changed
- `supabase/patch-09.sql` (new), `supabase/tests/run-checks.cjs`, `supabase/tests/store-checks.sql`.
- `v2/assets/v2-store.js` (Track box, Track this order, banners, CSS), `v2/assets/v2-i18n-store.js` (new keys in four languages), `v2/assets/mock-api.js` (demo `/public/track` route, in memory only), `v2/assets/supabase-api.js` (`/public/track` calls `track_store_order`). `v2/dist/bizgrow-v2.html` rebuilt with `build.js`.
- `docs/specs/online-store.md` (criteria K 51 to 58 and L 59 to 61; checks C01 to C46; patch-09 in the run list).

### Tests
- Local Postgres, scratch database only: fresh reset, schema, patch-07 twice, patch-08 twice, patch-09 twice, then all checks: **46 of 46 passed**.
- Headless browser, demo mode, 360 px (`stage7-smoke.js`, kept outside the repo with the other smoke tests): **23 of 23 checks passed**, no page errors. Covers both banners and the filter button, the right and wrong reference and phone, the reply keys, the 11th-try refusal, the Track box status and the plain no message, the empty-box message, the 360 px fit, and Track this order filling the box.
- Re-run of `stage4-smoke.js` (22 of 22), `stage6-smoke.js` (27 of 27) and `stage5-smoke.js` (20 of 20 checks, no failures). No page errors.

### Known limits
- Anyone who knows a customer's phone number can use up its 10 tries and block that number's tracking for 15 minutes. The reference is only 6 characters, so the phone plus the rate limit is the real protection.
- The per-store limit (300 an hour) and the two-hour clearing of the try log have no automated check yet.
- The live Supabase project has not run patch-09 yet. Until the owner runs it, tracking shows "could not find an order" for everyone.

## Fixes: public store wording (after the live shop check)

- A customer search with no match now says "No item matches that search. Try another word." Before, it said "No items are in stock right now", which was wrong. An empty list still shows the out-of-stock wording.
- The cart heading says "(1 item)" for one line, not "(1 items)". English, Hindi, Marathi and Gujarati (`pub_no_match`, `pub_item_one` in `v2-i18n-store.js`). The Hindi, Marathi and Gujarati wording is a first draft.
- `v2/assets/v2-store.js`, `v2/assets/v2-i18n-store.js`, `v2/dist/bizgrow-v2.html` (rebuilt with `build.js`). No database change.
- Tests: demo mode at 390 px (focused check: no-match wording, one and two item headings, no page errors). Re-run of `stage4-smoke.js` (22 of 22), `stage6-smoke.js` (27 of 27) and `stage5-smoke.js` (20 checks, all passed). No page errors.
- Live shop check (Bhakti Textile link, customer side, 390 px): cart, quantity, search, name and phone checks and the WhatsApp text all work. The final order was tested against a stub, so no real order was placed.

## Stage 6: printable and shareable invoice (no database change)

### What was built
- Each bill has an invoice page: shop name, address, phone and GSTIN when set, bill number, date, customer (or walk-in), items with quantity, price and amount, discount, total, paid, balance when part is paid, UPI when set, the note, and a footer.
- Each online order on the Orders page has an "Invoice" button that opens the same kind of page (order number, buyer, items, total, note). Cancelled orders are labelled as cancelled.
- The invoice has a Print / Save as PDF button and a WhatsApp share link with the shop name, the items, the total and the balance.
- Fits a 360 px phone without sideways scrolling. Print rules hide the buttons on paper.
- Labels are in English, Hindi, Marathi and Gujarati (new `inv_` keys, used only where the existing translation files have no key).
- One shared renderer, `v2/assets/v2-invoice.js` (new), used by the live bill path (`supabase-api.js`), the demo bill path (`mock-api.js`) and the order Invoice button (`v2-store.js`).
- The bill links keep their existing `/api/invoice/<id>` form. Clicking one opens the invoice in a new tab, as before.

### Changed
- `v2/assets/v2-invoice.js` (new), `v2/assets/supabase-api.js` (old invoice markup replaced by a call to the shared renderer), `v2/assets/mock-api.js` (demo bill page uses the shared renderer), `v2/assets/v2-store.js` (order Invoice button and `showInvoice`), `v2/index.html` (loads `v2-invoice.js`). `v2/dist/bizgrow-v2.html` rebuilt.
- No SQL change. There is no `patch-09.sql`. The bill and the order already hold every field the invoice shows.

### Tests
- Headless browser, demo mode, 360 px (`stage6-smoke.js`, kept outside the repo with the other smoke tests): **27 of 27 checks passed**, no page errors. Covers the bill link, every item listed, the balance line, the WhatsApp text, the 360 px fit with a very long item name, the order Invoice button, the buyer and note on the order invoice, and Hindi labels.
- Re-run of `stage5-smoke.js` (24 of 24) and `stage4-smoke.js` (22 of 22) after the change: both passed, no page errors.
- Checked in the demo UI: the "Invoice / GST bill (PDF)" link is visible after opening a bill, and the export links are visible on the Reports page.

### Not yet tested
- Real database bills and orders (needs the owner's sign-in and the store link `?shop=`). The live code path (`invoiceData` in `supabase-api.js`) is written but not run against the live project.
- Printing on paper or saving to PDF in a real browser print dialog.
- Marathi and Gujarati labels (in the file, not checked by a test).
- The live site has not been checked after the deploy yet (see the commit note).

## Stage 5: orders take stock (patch-08)

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
