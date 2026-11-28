# Online store - spec and acceptance criteria

Status: stage 10 (suppliers in the app, limits per connection, one combined SQL file; stage 8 bot check and stage 9 lockdown remain as before). Each criterion is a yes or no question. "Check" names the automated SQL check in `supabase/tests/store-checks.sql` (C01 to C46). "Demo check" names the headless browser run for the stage (`stage4-smoke.js`, `stage5-smoke.js`, `stage6-smoke.js`, `stage7-smoke.js`, `stage8-smoke.js`; 360 px, demo mode). Stage 8 also has a Worker check (`stage8-worker-smoke.mjs`, Cloudflare test keys, outside the repo). Criteria with no check are marked "review" and must be confirmed by reading the code or by hand.

How the owner turns the store on: from the **Store** page (not Settings). The store is off until the owner turns it on.

## A. Who can see what

1. Can an anonymous visitor (no sign-in) read the `store_orders` table directly? Must be **no**. Check: C01.
2. Can an anonymous visitor run the staff or owner order functions (`list_store_orders`, `set_store_order_status`, `cancel_new_store_orders`)? Must be **no**. Check: C02.
3. Can an anonymous visitor read the public store for a shop that is on, and place an order? Must be **yes**. Check: C03.
4. Does the public store response contain no cost price (`buy_price`) anywhere, and leave out items with no stock? Must be **yes** for both. Check: C04.
5. Is `max_qty` in the public store the stock left for each item, capped at 999? Must be **yes**. Check: C05.
6. Can a person with no role in the shop see its orders? Must be **no**. Check: C26.

## B. Stock check when placing an order

7. If an order asks for more than the stock left, is the order refused with a message that names the item and the amount left (for example "Only 5 kg of Cotton Thread is left. Please lower the quantity.")? Must be **yes**. Checks: C06, C07.
8. Does a refused order leave no order row behind? Must be **yes**. Check: C08.
9. Does the public store page show "Up to N at a time" under each item, and stop the plus button at N? Must be **yes**. Demo check: "plus stops at the cap", "plus button disabled at cap".
10. Does an order that is refused for being over the cap show the message in the store (not a blank page)? Must be **yes**. Demo check: "order over the cap is refused with a clear message".

## C. Order total and the WhatsApp message

11. Does the order function return the saved lines and the saved total, and do the line totals add up to the total? Must be **yes**. Check: C09.
12. Is the WhatsApp message built from those returned lines and total (not from the prices cached on the page)? Must be **yes**. Demo check: "WhatsApp message has order line with quantity", "WhatsApp message has total line". Review: `v2/assets/v2-store.js`, function `buildMessage` uses the returned `lines`.

## D. Spam limits

13. Can a phone number that the shop has not seen place more than 2 orders in 60 minutes? Must be **no** (the third is refused). Check: C10.
14. Can a known customer's number place more than 3 orders in 10 minutes? Must be **no**. Known means a customer with the same number (spaces and country code ignored), or a number that has an accepted, packed or delivered order. Check: C11.
15. Can the whole shop take more than 300 orders in one hour? Must be **no**. Review only (no check yet).
16. Can the owner cancel all new (junk) orders in one step? Must be **yes**, and only the owner can do it. Checks: C20, C21.
17. Does the bulk cancel leave accepted, packed and delivered orders alone? Must be **yes**. Check: C21.
18. Does each bulk-cancelled order get an audit line showing "changed from new to cancelled (bulk cancel)"? Must be **yes**. Check: C22.

## E. Order status

19. Can staff (cashier, manager) move an order from new to accepted, and from accepted to packed, and from packed to delivered? Must be **yes**. Checks: C12, C15 (new to accepted and packed to delivered in the same way).
20. Can staff cancel a new order? Must be **yes**. Check: C19 (the setup cancels a new order as staff).
21. Can staff cancel an accepted or packed order? Must be **yes**. Review only: the rule is in `set_store_order_status` (patch-07.sql); no SQL check yet.
22. Can staff reopen a delivered order, reopen a cancelled order, or skip a step (for example accepted to delivered)? Must be **no**; the message is "Only the owner can reopen an order or skip a step". Checks: C13, C14, C16, C19.
23. Can the owner reopen a delivered order? Must be **yes**. Check: C17.
24. Does each status change write an audit line that records the old status and the new status? Must be **yes**. Check: C18.
25. Does setting an order to the status it already has do nothing and show no error? Must be **yes**. Review only (the function returns `changed: false`).

## F. Orders list

26. Does the Orders page show at most 50 orders at a time, newest first? Must be **yes**. Checks: C23, C24. Demo check: "orders newest first", "orders page shows first page (up to 50)".
27. Does "Load older orders" add the next page, with every order seen once? Must be **yes**. Check: C23. Demo check: "older page adds more orders".
28. Does the "Hide cancelled" button hide cancelled orders, and does its label change to "Show cancelled"? Must be **yes**. Check: C25. Demo check: "hide toggle label changes", "cancelled orders hidden while filter on".
29. Does the Orders page work at 360 px with no page errors in demo mode? Must be **yes**. Demo check: "no page errors at end".

## G. Database file

30. Can `supabase/patch-07.sql` be run twice on the same database without an error? Must be **yes**. Checked: `run-checks.cjs` runs it twice, and the run passes.
31. Does a fresh database built from `supabase/schema.sql` pass all checks (C01 to C46, with patch-07, patch-08 and patch-09 applied)? Must be **yes**. Checked on a local Postgres copy (see CHANGES.md). Not yet checked on the live Supabase project.

## I. Stock taken by orders (stage 5, `supabase/patch-08.sql`)

An order takes its stock when it is placed, in the same step that saves it. It holds that stock until it is cancelled, and cancelling puts it back. Orders placed before patch-08 never took stock; cancelling one leaves stock as it is.

32. Does placing an order take its stock in the database, in the same step as saving the order? Must be **yes**. Check: C27.
33. Does a refused order (more than is left) leave stock unchanged? Must be **yes**. Check: C28.
34. Is an order for an item with no stock refused with a message that names the item? Must be **yes**. Check: C29.
35. Does cancelling an order put its stock back? Must be **yes**. Check: C30.
36. Is putting stock back safe to repeat (cancelling twice does not add stock twice)? Must be **yes**. Check: C31.
37. Does reopening a cancelled order take its stock again, and is it refused with a clear message when the stock is gone (the order stays cancelled)? Must be **yes**. Checks: C32, C33.
38. Is taking stock safe to repeat (taking twice does not take twice)? Must be **yes**. Check: C34.
39. Does cancelling a delivered order put its stock back? Must be **yes**. Check: C35.
40. Does bulk cancel of new orders put their stock back? Must be **yes**. Check: C36.
41. Does stock stay equal to the starting stock minus the open orders, with the taken flag matching each order's status? Must be **yes**. Check: C37.
42. Does the stock take refuse a short order by itself, as a second check behind the per-line check? Must be **yes**. Check: C38.
43. Does the demo show the same stock rules (take, refuse, put back on cancel, reopen, bulk cancel)? Must be **yes**. Demo check: `stage5-smoke.js`, 24 of 24.

## J. Invoice for a bill and for an online order (stage 6, no database change)

44. Does each bill open a printable invoice from its bill view, showing the shop name, bill number, date, items with quantity and price, total, paid, balance (when part is paid) and a WhatsApp share link? Must be **yes**. Demo check: `stage6-smoke.js` ("bill link writes an invoice page", "invoice lists every item", "balance is shown when part is paid").
45. Does each online order on the Orders page have an Invoice button that opens the same kind of page, with the buyer's name, the items, the total and the note? Must be **yes**. Demo check: "each order card has an Invoice button", "order invoice names the buyer", "order invoice shows the note".
46. Does the WhatsApp share text carry the shop name, the total and the balance? Must be **yes**. Demo check: "WhatsApp text has the total and balance", "WhatsApp text names the shop".
47. Does the invoice fit a 360 px phone with no sideways scrolling, including a very long item name? Must be **yes**. Demo check: "invoice fits 360 px without sideways scroll".
48. Does the printed page hide the Print and share buttons (print rules)? Must be **yes**. Demo check: "invoice has print rules that hide the buttons". Not checked on paper or in a PDF printer yet.
49. Do the invoice labels show in Hindi when the member's language is Hindi, and in English otherwise? Must be **yes**. Demo check: "Hindi labels show". Marathi and Gujarati labels are in the file but not checked by a test yet.
50. Does the invoice need no database change (it reads the bill or order that already exists)? Must be **yes**. Review only: no SQL file is changed in stage 6.

## K. Order tracking for customers (stage 7, `supabase/patch-09.sql`)

A customer enters the order reference and the phone number they ordered with, and sees only the status (new, accepted, packed, delivered or cancelled). The function is `track_store_order`. It is the only thing the public (anonymous) role can call for tracking.

51. Does entering the right reference and phone show the order's status? Must be **yes**. Checks: C40, C45. Demo check: "right reference and phone show the status", "the Track box shows the status for the right reference and phone".
52. Does the reply carry only `ok`, `ref` and `status` (no name, phone, items or total)? Must be **yes**. Checks: C42. Demo check: "the reply has only ok, ref and status".
53. Do a wrong phone, a wrong reference, an unknown store and a closed store all get the same plain no (no status, no order data)? Must be **yes**. Checks: C41, C44. Demo check: "a wrong phone returns nothing", "a wrong reference returns nothing", "an unknown store returns nothing", "a wrong phone shows the plain no message and no status".
54. Can the public (anonymous) role run only `track_store_order`, and not read the try log or the order tables? Must be **yes** for the function and **no** for both tables. Check: C39 (and C01 for the order tables).
55. Is tracking refused after 10 tries for one phone number in 15 minutes, with refused tries still counted, and does a refusal show no status? Must be **yes**. Checks: C46. Demo check: "the 11th try in a row is refused as too many tries", "the first 10 tries are plain no answers". The per-store limit (300 an hour) is review only (no check yet).
56. Does the try log keep only a hashed key for the phone (never the phone number), and clear entries older than two hours? Must be **yes**. Check: C43. The two-hour clearing is review only.
57. Does the Track box fit a 360 px phone without sideways scrolling, with no page errors? Must be **yes**. Demo check: "the public store fits 360 px without sideways scroll", "no page errors".
58. Does "Track this order" in the order-sent message fill the box with that order's reference and phone? Must be **yes**. Demo check: "Track this order fills the box with the reference and phone".

## L. New-orders banner for the owner (stage 7, no database change)

The owner sees how many orders are new (status new). The number is the same count the sidebar badge uses.

59. Does the Home page show a banner with the count of new orders and an "Open orders" button when some are waiting? Must be **yes**. Demo check: "Home shows the new-orders banner", "Home banner links to Orders".
60. Does the Orders page show the same banner when a filter other than New is selected, and does its button show only the new orders? Must be **yes**. Demo check: "Orders shows the new-orders banner", "the banner button filters to new orders and the banner goes".
61. Does the banner use the same count as the sidebar badge? Must be **yes**. Review only: both read `new_count` from `list_store_orders` (patch-06, patch-07 and schema.sql).

## M. Bot check on the public order form (stage 8, Cloudflare Turnstile, Worker, no database change)

The public order goes through a small Cloudflare Worker (`worker/index.mjs`) that checks the Turnstile token on the server before it calls `place_store_order`. The secret key is a Worker secret named `TURNSTILE_SECRET_KEY`. It is never in the repo, the page or the chat.

62. Does the checkout show the security check box just above the Send order button, and does the page fit at 360 px with no sideways scrolling? Must be **yes**. Demo check: "the checkout shows the security check box", "the check box sits just above the send button", "no sideways scrolling at 360 px". The widget itself is a stand-in in the demo.
63. Does the Worker refuse an order with no token, or a token Cloudflare does not accept, with HTTP 403 and code `bot_check`, before any order is written? Must be **yes**. Worker check: `stage8-worker-smoke.mjs` (Cloudflare test secrets, Supabase stubbed). Review: the Worker calls `siteverify` before the database call.
64. When the check is refused or missing, does the shopper see a friendly message and can they retry with a fresh check? Must be **yes**. Demo check: "no token: friendly message, no order sent", "refused check: friendly message, not the server text", "retry with a fresh check places the order".
65. Is the order refused (fail closed) when `TURNSTILE_SECRET_KEY` is empty, with no order written? Must be **yes** (changed 28 Nov 2026; it used to fail open). Worker check: order and track answer 503 `bot_check_off` (`tests/public-routes-smoke.mjs`, 27 of 27). The page still shows no box when the bot-check route says `enabled: false`. Demo check: "check off: no box is shown".
66. Does the WhatsApp order text stay the same as before the check was added? Must be **yes**. Demo check: "WhatsApp text has the name, the item line and the total".

## N. Online orders only through the Worker (stage 9, `supabase/patch-10-lockdown.sql`, opt-in)

Orders are placed by the Worker with the server key, not by the public key from the browser. `patch-10-lockdown.sql` is optional and is run by the owner only after the bot check box shows on the shop link and a test order goes through. `patch-10-rollback.sql` undoes it. Neither file runs in the base checks.

67. After patch-10, can the public (anonymous) role and signed-in users no longer call `place_store_order`, while the server role can? Must be **yes**. Check: `lockdown-checks.sql` L01 (anonymous call refused with a permission error), L06 (signed-in and public roles have no execute), L07 (server role has it).
68. After patch-10, does a server-role order still go through, and do tracking, the shop page and the owner's signed-in functions and tables still work? Must be **yes**. Check: L02 (server role places an order), L03 (anonymous tracking still works), L04 (anonymous shop page reads), L08 (owner functions and signed-in table access unchanged).
69. After patch-10, does the public role have no direct table access in the public schema? Must be **yes**. Check: L05. This also removes the default table access that tasks and staff_invites had in Supabase.
70. Is patch-10 safe to run twice, and does patch-10-rollback.sql restore public execute on `place_store_order` and leave the server role alone, also when run twice? Must be **yes**. Check: lockdown run applies patch-10 twice and the rollback twice; R01 to R03 pass.
71. Does the Worker use the server key (Worker secret `SUPABASE_SERVICE_KEY`) when it is set, fall back to the public key when it is not, and never show either key in a reply or in the bot-check route? Must be **yes**. Worker check: `stage9-worker-smoke.mjs`, 12 of 12.
72. Do the order, tracking and store pages still work in demo mode and at phone width, with no change to the page? Must be **yes**. Demo check: `stage4-smoke.js` to `stage8-smoke.js`, no FAIL lines.
73. Is patch-10 left out of the base run, so the base checks still pass 46 of 46 without it? Must be **yes**. Check: `run-checks.cjs --scratch` (46 of 46, C03 still expects the public role to place orders) and `run-checks.cjs --scratch --lockdown` for the lockdown and rollback sets.

Anonymous surface review (stage 9): the findings and what was left open are in `CHANGES.md`, Stage 9. Two items are product choices for the owner: the per-shop cap of 300 orders an hour, and the tracking cap that counts refused tries.

## O. Suppliers and limits per connection (stage 10, `supabase/patch-11.sql`, `supabase/patch-12.sql`)

74. Can the owner, manager and stock-keeper add and edit a supplier, and is a cashier refused? Must be **yes** for the first, **no** for the cashier. Check: S02, S03, S04.
75. Can only the owner or manager delete a supplier, and does a stock-keeper get a clear refusal? Must be **yes**. Check: S05, S06.
76. Once deleted, is a supplier gone from the list and refused for further edits or deletes? Must be **yes**. Check: S07, S12.
77. Are an empty name and a name over 60 characters refused with a clear message? Must be **yes**. Check: S08.
78. Can a user of another shop see or change these suppliers? Must be **no**. Check: S09.
79. Does every add, edit and delete write a line to the activity log? Must be **yes**. Check: S10.
80. Can the public (anonymous) role run the supplier functions? Must be **no**. Check: S11.
81. Does the supplier list show the items and the note, and do the old columns still load if the new ones are missing? Must be **yes** for both. Check: S12 (items and note). Review: `v2/assets/supabase-api.js` (the fallback). The supplier form in the app is not checked on a screen yet.
82. Does a 26th order from the same connection in one hour get refused, while another connection is not held back? Must be **yes** for both. Checks: K03, K04.
83. Does an order with no connection key count against no connection, and does an unknown store get the same answer as the old function? Must be **yes** for both. Checks: K05, K06.
84. Does the 31st tracking try from one connection in 15 minutes get a "wait" message, while another connection can still track? Must be **yes** for both. Checks: K07, K08.
85. Does the old tracking function still work, so the fallback is safe? Must be **yes**. Check: K09.
86. Does the Worker fall back to the old order and tracking functions when the new ones are missing, and only then? Must be **yes**. Worker check: `stage9-worker-smoke.mjs` (fallback check) and `stage8-worker-smoke.mjs` (section 10, tracking).

- **Live project.** Nothing in this stage has been run on the live Supabase project. Run `supabase/run-all-pending.sql` there and then check criteria 74 to 82 by hand (see `supabase/RUN-ORDER.md`).
- **Connection key.** A shared network (many phones behind one router) shares one limit.

## H. Known gaps and future work

- **Two sessions at once are not tested.** Stock is locked per item, so two orders for the last of an item should not both succeed, but no check runs two orders at the same moment. The existing sale function (`create_sale`) locks items in cart order, so a rare deadlock between a sale and an online order placed at the same moment is possible. Postgres would stop one of them with an error; no wrong stock is written.
- **Bot check is off until the owner sets the secret.** The check is built (section M), and it now fails closed: with `TURNSTILE_SECRET_KEY` empty the Worker answers 503 and places no order (section P). Until the secret is set, the per-number limits (criteria 13 to 15) are the only protection.
- **Public order function (closed by patch-10, opt-in).** Until the owner runs `supabase/patch-10-lockdown.sql` (section N), the publishable key can still call `place_store_order` directly. The owner runs it only after the bot check box shows and a test order works. Undo with `supabase/patch-10-rollback.sql`.
- **Shop order cap can be used up.** The 300-orders-an-hour cap per shop counts every anonymous order, so one visitor can stop a shop taking online orders for up to an hour (CHANGES.md, Stage 9, finding 3). Product choice needed.
- **Tracking cap can block a shop.** Every tracking try, refused or not, counts toward the 300-an-hour cap per shop, so one visitor can block tracking for a whole shop for up to an hour (finding 4). Product choice needed.
- **Future tables.** Patch-10 covers today's tables only. A later patch should change the public schema's default privileges (finding 6).
- **Shop-wide cap check** (criterion 15) has no automated check yet.
- **Cancel from accepted or packed** (criterion 21) has no automated check yet.
- **Tracking and phone numbers.** Anyone who knows a customer's phone number can use up its 10 tries and block that number's tracking for 15 minutes. The order reference is only 6 characters, so the phone number plus the rate limit is the real protection.
- **Live project.** The SQL checks ran on a local Postgres copy with a stand-in for the Supabase login function. They have not been run on the live Supabase project.

## How to run the checks

From the repository root, on an empty scratch database only (never the live project):

    DATABASE_URL=postgres://user:pass@host:5432/scratch node supabase/tests/run-checks.cjs --scratch

The runner loads `supabase/tests/local-auth-shim.sql`, `supabase/schema.sql`, `supabase/patch-07.sql` (twice), `supabase/patch-08.sql` (twice), `supabase/patch-09.sql` (twice), `supabase/patch-11.sql` (twice) and `supabase/patch-12.sql` (twice), then runs `supabase/tests/store-checks.sql`, `supabase/tests/supplier-checks.sql` (S01 to S12) and `supabase/tests/client-limit-checks.sql` (K01 to K09), and prints PASS or FAIL for each check and a total. The base run does not include patch-10.

To test the stage 9 lockdown and its rollback as well, add `--lockdown` (same scratch database rules):

    DATABASE_URL=postgres://user:pass@host:5432/scratch node supabase/tests/run-checks.cjs --scratch --lockdown

This runs the same steps, then `supabase/patch-10-lockdown.sql` (twice), `supabase/tests/lockdown-checks.sql` (L01 to L09), `supabase/patch-10-rollback.sql` (twice) and `supabase/tests/rollback-checks.sql` (R01 to R03).

## P. Review fixes for public routes, 28 Nov 2026 (patch-12, patch-13, worker)

Checked by `tests/public-routes-smoke.mjs` (mocked Cloudflare and Supabase, 39 of 39 pass). The store page's new tracking check box has not been clicked in a browser yet (no browser test covers the tracking box).

- **Fail closed.** No `TURNSTILE_SECRET_KEY`: order and track return 503 `bot_check_off` and nothing is written. No connection address: 503, the limit cannot be skipped.
- **No fallback.** If the `_for_client` order or track function is missing, the Worker answers 503 and logs that `supabase/run-all-pending.sql` must be run. It never calls the older `place_store_order` or `track_store_order`.
- **Turnstile outcomes.** Pass places the order; fail (403) and no token place nothing; unreachable, server error and bad reply answer 503 and place nothing. The secret is sent to Cloudflare only.
- **Tracking now needs the bot check too** (it had none, so plain requests could spend the shop's tracking cap). The tracking box has its own check widget; each try uses a fresh single-use token.
- **Per visitor, in the database.** A visitor (a one-way hash of the connection address and the UTC day) can place 10 orders an hour and make 10 tracking tries per 15 minutes per shop. Refused tries are counted.
- **Per visitor, in the Worker (no dashboard rule needed).** The same numbers (10 orders an hour, 10 tracking tries per 15 minutes) are checked in the Worker before the database is called. Each Worker instance keeps its own count, so this is a first line, not the shared count. Tested: the 11th try is refused with no database call; another visitor is not affected; the window reopens.
- **Still open: the whole-shop cap.** `place_store_order` and `track_store_order` still refuse when the whole shop passes 300 orders (or 300 tracking tries) in an hour. Now that tracking needs a check, plain requests cannot spend it; only a visitor who passes the Cloudflare check can. Removing the cap, or raising it, needs a new SQL patch that changes the two functions. That patch was not written this round because no scratch Postgres could run the SQL checks (port 54329 down). The Cloudflare rate-limit rule on `/api/public/*` is still an option for the owner.
- **Live check.** Not run on the live project. The member must run `supabase/run-all-pending.sql` first (safe to repeat).
