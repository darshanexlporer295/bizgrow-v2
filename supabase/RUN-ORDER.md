# Database: what to run, and in what order

Run each file in the Supabase dashboard: **SQL Editor**, then **New query**, paste the whole file, click **Run**. It should finish with "Success" and no red text. Every file here is safe to run more than once.

## Already on the live project (do not run again)

- `schema.sql`
- `patch-01.sql` to `patch-07.sql`

## Tomorrow morning: run this one file

1. Open `supabase/run-all-pending.sql` on the project's GitHub page. Copy all of it.
2. In Supabase, **SQL Editor**, **New query**, paste it, click **Run**. It contains, in this order:
   - `patch-08.sql`: online orders take stock out, and cancelling puts it back.
   - `patch-09.sql`: customers can track their order (tracking limits).
   - `patch-11.sql`: suppliers can be added, edited and deleted in the app.
   - `patch-12.sql`: order and tracking limits per connection (a 25-an-hour order limit and a 30-tries-per-15-minutes tracking limit).
   - `patch-13.sql`: tighter limits per connection (10 orders an hour, 10 tracking tries per 15 minutes), the connection code is required, and new objects in the public schema get no default rights for the public (anon) role.
   - `patch-14.sql`: plans (Free, Growth, All Features) and their limits. Existing shops get All Features; new shops start on Free. Upgrade requests are only recorded for the BizGrow team.
   - `patch-15.sql`: online payment for plan upgrades (Razorpay, set up later), promo codes, and plan end dates. Prices: Growth Rs 499 and All Features Rs 999 for 30 days (to be confirmed). Promo codes are made only by the BizGrow team.
   - `patch-16.sql`: fixes promo codes and payments for shops that were given All Features by default (they can now take a promo or pay). Records where each shop's plan came from. A promo for the plan a shop already has adds days to its end date. A lower plan is refused with a clear message.
   - `patch-18.sql`: promo guessing capped across accounts, the voice per-person limit in the database, and internal helper functions locked from anon. Safe to run again.
   - `patch-19.sql`: owner alert when an online payment does not raise the plan (shown on the plan screen). Safe to run again.
   - `patch-17.sql`: promo codes done properly. Codes ignore capital letters and spaces. A plan that reaches its end date goes back to Free on its own, even if nobody opens the app, and the shop's data is kept. Shops that were on All Features by default go back to Free when their promo ends. The plan screen shows how many days are left. The BizGrow team sees who used each code and how many uses are left. Codes can be switched off, and a code cannot be used twice by one shop.
3. Nothing is deleted. Running it a second time is safe.
4. Open the live site in a new tab, and do a hard refresh (on a phone: close the tab and open it again).
5. Only once, for the BizGrow team's own login (needed to make promo codes): open `supabase/make-platform-owner.sql` on GitHub, click the pencil icon, and check that the email on the line marked EDIT HERE is the BizGrow login email. It is already set to revobuildsit@gmail.com; change it only if your login uses another email. Then paste the whole file into **SQL Editor**, **New query**, and click **Run**. It stops with a clear message if the placeholder was not changed or the email has no login yet. Do not put the email in any other file.
6. Test: place one order from the shop link, check its tracking, and add and then delete a test supplier in the Suppliers screen. Delete the test supplier afterwards.

The live website and the server part (the Worker) are published by pushing to GitHub `main`. They do not need any step from you.

## Optional, last, and only after the bot check shows

- `patch-10-lockdown.sql`: only the store's server can place orders. Do not run it until **all** of these are true (the steps are in `docs/SETUP-STEPS.md`, Part 6):
  1. The security check box shows on the shop link.
  2. A test order goes through.
  3. The server key secret (`SUPABASE_SERVICE_KEY`) is added in Cloudflare.
- To undo it at any time: `patch-10-rollback.sql`. Orders then work the old way again. Nothing is deleted.

## File list

| File | What it does | Status |
| --- | --- | --- |
| `schema.sql` | Base tables and rules | Already run |
| `patch-01.sql` to `patch-07.sql` | Earlier steps | Already run |
| `patch-08.sql` | Online orders take stock | In `run-all-pending.sql` |
| `patch-09.sql` | Order tracking for customers | In `run-all-pending.sql` |
| `patch-11.sql` | Suppliers: add, edit, delete | In `run-all-pending.sql` |
| `patch-12.sql` | Limits per connection | In `run-all-pending.sql` |
| `patch-13.sql` | Tighter limits per connection, code required, no default public rights | In `run-all-pending.sql` |
| `patch-14.sql` | Plans and limits (Free, Growth, All Features); existing shops get All Features | In `run-all-pending.sql` |
| `patch-15.sql` | Payments for plan upgrades, promo codes, plan end dates | In `run-all-pending.sql` |
| `patch-16.sql` | Plan source (default, promo, paid, manual); promo and payment fixes for default shops | In `run-all-pending.sql` |
| `patch-17.sql` | Promo codes end to end: a plan ends at its end date and goes back to Free at read time; codes ignore case and spaces; plain messages; one-time fix for default shops | In `run-all-pending.sql` |
| `patch-18.sql` | Promo codes: a global cap on failed tries per code (50 an hour) and in total (300 an hour) across all accounts; voice: a shared per-person limit (20 a minute) in the database; internal helper functions are closed to the public and anon roles | In `run-all-pending.sql` |
| `patch-19.sql` | Owner alert: a payment that does not raise the plan shows a notice on the plan screen (plan and end date unchanged); the notice clears when a later payment raises the plan | In `run-all-pending.sql` |
| `patch-20.sql` | Whole-shop caps removed: the public order and tracking functions no longer stop every order or try for a whole store after 300 in an hour. Per phone and per connection limits stay | In `run-all-pending.sql` |
| `make-platform-owner.sql` | Marks the login revobuildsit@gmail.com as the BizGrow platform owner (for promo codes). Sign in once first | Run once, after the main file |
| `run-all-pending.sql` | patch-08 to patch-20 joined, in order | Run tomorrow |
| `patch-10-lockdown.sql` | Only the server can place orders | Optional, last |
| `patch-10-rollback.sql` | Undo of patch-10 | Only if needed |

`run-all-pending.sql` is made by joining the patch files in the order above. If a patch file changes, the combined file is rebuilt the same way.
