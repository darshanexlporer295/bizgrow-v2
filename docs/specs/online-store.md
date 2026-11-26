# Online store - spec and acceptance criteria

Status: stage 7 (order tracking and new-orders banner). Each criterion is a yes or no question. "Check" names the automated SQL check in `supabase/tests/store-checks.sql` (C01 to C46). "Demo check" names the headless browser run for the stage (`stage4-smoke.js`, `stage5-smoke.js`, `stage6-smoke.js`, `stage7-smoke.js`; 360 px, demo mode). Criteria with no check are marked "review" and must be confirmed by reading the code or by hand.

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

## H. Known gaps and future work

- **Two sessions at once are not tested.** Stock is locked per item, so two orders for the last of an item should not both succeed, but no check runs two orders at the same moment. The existing sale function (`create_sale`) locks items in cart order, so a rare deadlock between a sale and an online order placed at the same moment is possible. Postgres would stop one of them with an error; no wrong stock is written.
- **Bot check (Turnstile) is not built.** It is planned as a future step on the public order form, to stop automated orders. Until then, the per-number limits (criteria 13 to 15) are the only protection.
- **Shop-wide cap check** (criterion 15) has no automated check yet.
- **Cancel from accepted or packed** (criterion 21) has no automated check yet.
- **Tracking and phone numbers.** Anyone who knows a customer's phone number can use up its 10 tries and block that number's tracking for 15 minutes. The order reference is only 6 characters, so the phone number plus the rate limit is the real protection.
- **Live project.** The SQL checks ran on a local Postgres copy with a stand-in for the Supabase login function. They have not been run on the live Supabase project.

## How to run the checks

From the repository root, on an empty scratch database only (never the live project):

    DATABASE_URL=postgres://user:pass@host:5432/scratch node supabase/tests/run-checks.cjs --scratch

The runner loads `supabase/tests/local-auth-shim.sql`, `supabase/schema.sql`, `supabase/patch-07.sql` (twice), `supabase/patch-08.sql` (twice) and `supabase/patch-09.sql` (twice), then `supabase/tests/store-checks.sql`, and prints PASS or FAIL for each check and a total.
