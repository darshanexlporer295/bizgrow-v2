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
3. Nothing is deleted. Running it a second time is safe.
4. Open the live site in a new tab, and do a hard refresh (on a phone: close the tab and open it again).
5. Test: place one order from the shop link, check its tracking, and add and then delete a test supplier in the Suppliers screen. Delete the test supplier afterwards.

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
| `run-all-pending.sql` | patch-08, 09, 11, 12 and 13 joined, in order | Run tomorrow |
| `patch-10-lockdown.sql` | Only the server can place orders | Optional, last |
| `patch-10-rollback.sql` | Undo of patch-10 | Only if needed |

`run-all-pending.sql` is made by joining the patch files in the order above. If a patch file changes, the combined file is rebuilt the same way.
